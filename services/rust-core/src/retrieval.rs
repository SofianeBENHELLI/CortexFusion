//! Native source-backed retrieval, private episodes and explicit feedback.
use crate::{auth::Principal, error::CoreError, server::StateData, snapshot::Concept};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, post},
};
use http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction, postgres::PgRow};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;
pub(crate) const READERS: &[&str] = &["owner", "agent", "contributor", "corpus_manager", "viewer"];
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Arguments do not match the action contract",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn missing() -> CoreError {
    CoreError {
        code: "NOT_FOUND",
        message: "Episode not found",
        status: StatusCode::NOT_FOUND,
    }
}
fn uuid(s: &str) -> Result<String, CoreError> {
    Uuid::parse_str(s)
        .map(|v| v.to_string())
        .map_err(|_| CoreError::invalid_uuid())
}
pub(crate) async fn transaction<'a>(
    s: &'a StateData,
    p: &Principal,
    domain: &str,
) -> Result<Transaction<'a, Postgres>, CoreError> {
    s.db.locked_permission_transaction(p, domain, READERS, "Domain membership required")
        .await
}
fn default_chars() -> usize {
    8000
}
fn default_limit() -> usize {
    5
}
fn twenty() -> usize {
    20
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct QueryInput {
    question: String,
    #[serde(default = "default_chars")]
    max_chars: usize,
    #[serde(default = "default_limit")]
    limit: usize,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FeedbackInput {
    rating: String,
    #[serde(default)]
    explanation: String,
    idempotency_key: String,
}
#[derive(Deserialize)]
struct PageInput {
    #[serde(default = "twenty")]
    limit: usize,
    after: Option<Uuid>,
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route("/v1/domains/{domain}/query", post(query))
        .route("/v1/domains/{domain}/episodes", get(episodes))
        .route("/v1/domains/{domain}/episodes/{episode_id}", get(episode))
        .route(
            "/v1/domains/{domain}/episodes/{episode_id}/feedback",
            post(feedback),
        )
}
pub(crate) async fn accessible(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
) -> Result<BTreeMap<Uuid, PgRow>, CoreError> {
    sqlx::query("SELECT id,title,location,content_hash,content FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND allowed_subjects ? $3 FOR SHARE").bind(&p.tenant).bind(domain).bind(&p.subject).fetch_all(&mut **tx).await.map_err(CoreError::sql)?.into_iter().map(|r|Ok((Uuid::parse_str(r.get::<&str,_>("id")).map_err(|_|CoreError::database())?,r))).collect()
}
pub(crate) async fn issue(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    episode: &str,
    kind: &str,
    reason: &str,
) -> Result<(), CoreError> {
    sqlx::query("INSERT INTO cf_issues(tenant_id,domain_id,id,episode_id,kind,reason) VALUES($1,$2,$3,$4,$5,$6)").bind(&p.tenant).bind(domain).bind(Uuid::new_v4().to_string()).bind(episode).bind(kind).bind(reason).execute(&mut **tx).await.map_err(CoreError::sql)?;
    Ok(())
}
async fn query(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
    body: Result<Json<QueryInput>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let Json(input) = body.map_err(|_| invalid())?;
    if !(1..=2000).contains(&input.question.chars().count())
        || !(100..=20000).contains(&input.max_chars)
        || !(1..=10).contains(&input.limit)
    {
        return Err(invalid());
    }
    let (served, concepts) = if let Some(graph) = &s.graph {
        graph.published_concepts(&p, &domain).await?
    } else {
        let mut tx = transaction(&s, &p, &domain).await?;
        let version: i64 = sqlx::query_scalar(
            "SELECT published_version FROM cf_domains WHERE tenant_id=$1 AND id=$2",
        )
        .bind(&p.tenant)
        .bind(&domain)
        .fetch_one(&mut *tx)
        .await
        .map_err(CoreError::sql)?;
        if version != 0 {
            return Err(CoreError::database());
        }
        tx.commit().await.map_err(CoreError::sql)?;
        (0, Vec::new())
    };
    // Final source/identity checks and episode insertion share one authorization boundary.
    let mut tx = transaction(&s, &p, &domain).await?;
    let sources = accessible(&mut tx, &p, &domain).await?;
    let visible: Vec<Concept> = concepts
        .into_iter()
        .filter(|c| c.sources.iter().all(|r| sources.contains_key(&r.source_id)))
        .collect();
    let ids: BTreeSet<Uuid> = visible.iter().map(|c| c.concept_id).collect();
    let terms = crate::lexical::query_terms(&input.question);
    let mut ranked: Vec<(usize, Concept)> = visible
        .into_iter()
        .filter_map(|c| {
            let words = crate::lexical::words(&format!("{} {}", c.title, c.body));
            let score = terms.intersection(&words).count();
            (score > 0).then_some((score, c))
        })
        .collect();
    ranked.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.concept_id.cmp(&b.1.concept_id))
    });
    let mut selected = Vec::new();
    let mut citations = Vec::new();
    let mut snippets = Vec::new();
    let mut used = 0;
    let mut source_ids = BTreeSet::new();
    for (_, mut c) in ranked {
        if selected.len() >= input.limit {
            break;
        }
        let length = c.body.chars().count();
        if used + length > input.max_chars {
            continue;
        }
        c.links.retain(|l| ids.contains(&l.target_id));
        used += length;
        snippets.push(c.body.clone());
        for span in &c.sources {
            let source = sources.get(&span.source_id).ok_or_else(missing)?;
            let content: &str = source.get("content");
            citations.push(json!({"source_id":span.source_id,"title":source.get::<String,_>("title"),"location":source.get::<String,_>("location"),"content_hash":source.get::<String,_>("content_hash"),"start":span.start,"end":span.end,"excerpt":span.excerpt(content).map_err(|_|CoreError::database())?}));
            source_ids.insert(span.source_id);
        }
        selected.push(c);
    }
    let episode = Uuid::new_v4().to_string();
    let gap = snippets.is_empty();
    let result = json!({"episode_id":episode,"answer":if gap{"No matching approved evidence was found within the requested context budget.".to_owned()}else{snippets.join("\n\n")},"status":if gap{"knowledge_gap"}else{"evidence_found"},"mode":"extractive","served_version":served,"concepts":selected,"citations":citations,"processing":"local_no_model"});
    sqlx::query("INSERT INTO cf_episodes(tenant_id,domain_id,id,subject,question,result,source_ids,served_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(&p.tenant).bind(&domain).bind(&episode).bind(&p.subject).bind(&input.question).bind(&result).bind(json!(source_ids)).bind(served).execute(&mut *tx).await.map_err(CoreError::sql)?;
    if gap {
        issue(
            &mut tx,
            &p,
            &domain,
            &episode,
            "knowledge_gap",
            &input.question,
        )
        .await?;
    }
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
fn can_read(row: &PgRow, sources: &BTreeMap<Uuid, PgRow>) -> Result<bool, CoreError> {
    let ids: Vec<Uuid> =
        serde_json::from_value(row.get("source_ids")).map_err(|_| CoreError::database())?;
    Ok(ids.iter().all(|id| sources.contains_key(id)))
}
pub(crate) async fn episode_row(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    id: &str,
    sources: &BTreeMap<Uuid, PgRow>,
) -> Result<PgRow, CoreError> {
    let r = sqlx::query(
        "SELECT * FROM cf_episodes WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND subject=$4",
    )
    .bind(&p.tenant)
    .bind(domain)
    .bind(id)
    .bind(&p.subject)
    .fetch_optional(&mut **tx)
    .await
    .map_err(CoreError::sql)?
    .ok_or_else(missing)?;
    if !can_read(&r, sources)? {
        return Err(missing());
    }
    Ok(r)
}
async fn episode(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let id = uuid(&id)?;
    let mut tx = transaction(&s, &p, &domain).await?;
    let sources = accessible(&mut tx, &p, &domain).await?;
    let r = episode_row(&mut tx, &p, &domain, &id, &sources).await?;
    let result = r.get("result");
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
async fn episodes(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
    input: Result<Query<PageInput>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let Query(input) = input.map_err(|_| invalid())?;
    if !(1..=100).contains(&input.limit) {
        return Err(invalid());
    }
    let mut tx = transaction(&s, &p, &domain).await?;
    let sources = accessible(&mut tx, &p, &domain).await?;
    let mut cursor = input.after.map(|v| v.to_string()).unwrap_or_default();
    let mut items = Vec::new();
    while items.len() <= input.limit {
        let rows=sqlx::query("SELECT id,question,result,source_ids,served_version,to_jsonb(created_at) AS created FROM cf_episodes WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND id>$4 ORDER BY id LIMIT 100").bind(&p.tenant).bind(&domain).bind(&p.subject).bind(&cursor).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
        let count = rows.len();
        if count == 0 {
            break;
        }
        for r in rows {
            cursor = r.get("id");
            if can_read(&r, &sources)? {
                items.push(json!({"id":cursor,"question":r.get::<String,_>("question"),"result":r.get::<Value,_>("result"),"served_version":r.get::<i64,_>("served_version"),"created_at":r.get::<Value,_>("created")}));
            }
            if items.len() > input.limit {
                break;
            }
        }
        if count < 100 {
            break;
        }
    }
    let next = if items.len() > input.limit {
        items[input.limit - 1]["id"].clone()
    } else {
        Value::Null
    };
    items.truncate(input.limit);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(json!({"items":items,"next_after":next})))
}
async fn feedback(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Result<Json<FeedbackInput>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let id = uuid(&id)?;
    let Json(input) = body.map_err(|_| invalid())?;
    if !["helpful", "unhelpful"].contains(&input.rating.as_str())
        || input.explanation.chars().count() > 2000
        || !(8..=128).contains(&input.idempotency_key.chars().count())
    {
        return Err(invalid());
    }
    let mut tx = transaction(&s, &p, &domain).await?;
    let sources = accessible(&mut tx, &p, &domain).await?;
    episode_row(&mut tx, &p, &domain, &id, &sources).await?;
    let payload = serde_json::to_value(&input).map_err(|_| invalid())?;
    let mut fingerprint = payload.clone();
    fingerprint["episode"] = json!(id);
    let fingerprint = crate::canonical::digest(&fingerprint).map_err(|_| invalid())?;
    let existing=sqlx::query("SELECT id,request_hash FROM cf_feedback WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND idempotency_key=$4").bind(&p.tenant).bind(&domain).bind(&p.subject).bind(&input.idempotency_key).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    if let Some(r) = existing {
        if r.get::<&str, _>("request_hash") != fingerprint {
            return Err(CoreError {
                code: "IDEMPOTENCY_CONFLICT",
                message: "Feedback key reused",
                status: StatusCode::CONFLICT,
            });
        }
        p.check_fresh()?;
        return Ok(Json(json!({"feedback_id":r.get::<String,_>("id")})));
    }
    let feedback_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO cf_feedback(tenant_id,domain_id,id,episode_id,subject,payload,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(&p.tenant).bind(&domain).bind(&feedback_id).bind(&id).bind(&p.subject).bind(payload).bind(&input.idempotency_key).bind(fingerprint).execute(&mut *tx).await.map_err(CoreError::sql)?;
    if input.rating == "unhelpful" {
        issue(
            &mut tx,
            &p,
            &domain,
            &id,
            "disputed_answer",
            &input.explanation,
        )
        .await?;
    }
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(json!({"feedback_id":feedback_id})))
}
