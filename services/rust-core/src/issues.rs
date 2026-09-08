//! Personal issue lifecycle; correction links never grant proposal access.
use crate::{auth::Principal, error::CoreError, retrieval, server::StateData};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, post},
};
use http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction, postgres::PgRow};
use uuid::Uuid;
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Arguments do not match the action contract",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn conflict(code: &'static str) -> CoreError {
    CoreError {
        code,
        message: "Refresh the issue or inspect the existing decision",
        status: StatusCode::CONFLICT,
    }
}
fn uuid(s: &str) -> Result<String, CoreError> {
    Uuid::parse_str(s)
        .map(|x| x.to_string())
        .map_err(|_| CoreError::invalid_uuid())
}
fn twenty() -> usize {
    20
}
#[derive(Deserialize)]
struct Page {
    #[serde(default = "twenty")]
    limit: usize,
    after: Option<Uuid>,
    status: Option<String>,
    episode_id: Option<Uuid>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Decision {
    action: String,
    expected_revision: i64,
    reason: String,
    idempotency_key: String,
    #[serde(default)]
    correction_proposal_id: Option<Uuid>,
}
fn view(r: &PgRow) -> Value {
    json!({"id":r.get::<String,_>("id"),"episode_id":r.get::<String,_>("episode_id"),"kind":r.get::<String,_>("kind"),"reason":r.get::<String,_>("reason"),"status":r.get::<String,_>("status"),"revision":r.get::<i64,_>("revision"),"created_at":r.get::<Value,_>("created")})
}
fn event(r: &PgRow) -> Value {
    json!({"id":r.get::<String,_>("id"),"issue_id":r.get::<String,_>("issue_id"),"author":r.get::<String,_>("author"),"previous_status":r.get::<String,_>("previous_status"),"status":r.get::<String,_>("status"),"revision":r.get::<i64,_>("revision"),"reason":r.get::<String,_>("reason"),"created_at":r.get::<Value,_>("created"),"correction_proposal_id":r.get::<Option<String>,_>("correction_proposal_id"),"correction_digest":r.get::<Option<String>,_>("correction_digest"),"correction_published_version":r.get::<Option<i64>,_>("correction_published_version")})
}
async fn issue(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    id: &str,
) -> Result<PgRow, CoreError> {
    let r=sqlx::query("SELECT *,to_jsonb(created_at) AS created FROM cf_issues WHERE tenant_id=$1 AND domain_id=$2 AND id=$3").bind(&p.tenant).bind(d).bind(id).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
    let sources = retrieval::accessible(tx, p, d).await?;
    retrieval::episode_row(tx, p, d, r.get("episode_id"), &sources).await?;
    Ok(r)
}
async fn correction(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    id: &str,
) -> Result<PgRow, CoreError> {
    let role: String = sqlx::query_scalar(
        "SELECT role FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3",
    )
    .bind(&p.tenant)
    .bind(d)
    .bind(&p.subject)
    .fetch_one(&mut **tx)
    .await
    .map_err(CoreError::sql)?;
    if !matches!(
        role.as_str(),
        "owner" | "corpus_manager" | "agent" | "contributor"
    ) {
        return Err(CoreError::not_found());
    }
    let r = crate::proposals::row(tx, p, d, id).await?;
    let sources = crate::proposals::sources(tx, p, d).await?;
    crate::proposals::check_access(tx, p, d, &r, &sources).await?;
    Ok(r)
}
async fn event_access(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    r: &PgRow,
) -> Result<(), CoreError> {
    if let Some(id) = r.get::<Option<String>, _>("correction_proposal_id") {
        correction(tx, p, d, &id).await?;
    }
    Ok(())
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route("/v1/domains/{domain}/issues", get(list))
        .route("/v1/domains/{domain}/issues/{ident}", get(read))
        .route("/v1/domains/{domain}/issues/{ident}/events", get(history))
        .route(
            "/v1/domains/{domain}/issues/{ident}/decisions",
            post(decide),
        )
}
async fn read(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let mut tx = retrieval::transaction(&s, &p, &d).await?;
    let result = view(&issue(&mut tx, &p, &d, &id).await?);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
fn validate_page(
    input: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Page, CoreError> {
    let Query(q) = input.map_err(|_| invalid())?;
    if !(1..=100).contains(&q.limit)
        || q.status.as_ref().is_some_and(|s| {
            !matches!(
                s.as_str(),
                "open" | "in_progress" | "resolved" | "dismissed"
            )
        })
    {
        return Err(invalid());
    }
    Ok(q)
}
async fn list(
    State(s): State<StateData>,
    Path(d): Path<String>,
    headers: HeaderMap,
    input: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let q = validate_page(input)?;
    let mut tx = retrieval::transaction(&s, &p, &d).await?;
    let sources = retrieval::accessible(&mut tx, &p, &d).await?;
    if let Some(id) = q.episode_id {
        retrieval::episode_row(&mut tx, &p, &d, &id.to_string(), &sources).await?;
    }
    let mut cursor = q.after.map(|x| x.to_string()).unwrap_or_default();
    let mut items = Vec::new();
    let mut next = Value::Null;
    'scan: loop {
        let rows=sqlx::query("SELECT i.*,to_jsonb(i.created_at) AS created,e.source_ids FROM cf_issues i JOIN cf_episodes e ON e.tenant_id=i.tenant_id AND e.domain_id=i.domain_id AND e.id=i.episode_id WHERE i.tenant_id=$1 AND i.domain_id=$2 AND e.subject=$3 AND i.id>$4 AND ($5='' OR i.status=$5) AND ($6='' OR i.episode_id=$6) ORDER BY i.id LIMIT 100").bind(&p.tenant).bind(&d).bind(&p.subject).bind(&cursor).bind(q.status.as_deref().unwrap_or("")).bind(q.episode_id.map(|x|x.to_string()).unwrap_or_default()).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
        let count = rows.len();
        for r in rows {
            cursor = r.get("id");
            if !retrieval::can_read(&r, &sources)? {
                continue;
            }
            if items.len() == q.limit {
                next = items
                    .last()
                    .map(|v: &Value| v["id"].clone())
                    .unwrap_or(Value::Null);
                break 'scan;
            }
            items.push(view(&r));
        }
        if count < 100 {
            break;
        }
        p.check_fresh()?;
    }
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(json!({"items":items,"next_after":next})))
}
async fn history(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    headers: HeaderMap,
    input: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let q = validate_page(input)?;
    let mut tx = retrieval::transaction(&s, &p, &d).await?;
    issue(&mut tx, &p, &d, &id).await?;
    let mut cursor = q.after.map(|x| x.to_string()).unwrap_or_default();
    let mut items = Vec::new();
    let mut next = Value::Null;
    'scan: loop {
        let rows=sqlx::query("SELECT *,to_jsonb(created_at) AS created FROM cf_issue_events WHERE tenant_id=$1 AND domain_id=$2 AND issue_id=$3 AND id>$4 ORDER BY id LIMIT 100").bind(&p.tenant).bind(&d).bind(&id).bind(&cursor).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
        let count = rows.len();
        for r in rows {
            cursor = r.get("id");
            match event_access(&mut tx, &p, &d, &r).await {
                Ok(()) => {}
                Err(e) if e.status == StatusCode::NOT_FOUND => continue,
                Err(e) => return Err(e),
            }
            if items.len() == q.limit {
                next = items
                    .last()
                    .map(|v: &Value| v["id"].clone())
                    .unwrap_or(Value::Null);
                break 'scan;
            }
            items.push(event(&r));
        }
        if count < 100 {
            break;
        }
        p.check_fresh()?;
    }
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(json!({"items":items,"next_after":next})))
}
async fn decide(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    headers: HeaderMap,
    input: Result<Json<Decision>, axum::extract::rejection::JsonRejection>,
) -> Result<(StatusCode, Json<Value>), CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let Json(data) = input.map_err(|_| invalid())?;
    if !matches!(
        data.action.as_str(),
        "start" | "resolve" | "dismiss" | "reopen"
    ) || data.expected_revision < 0
        || !(1..=2000).contains(&data.reason.chars().count())
        || !(8..=128).contains(&data.idempotency_key.chars().count())
        || (data.correction_proposal_id.is_some()
            && !matches!(data.action.as_str(), "start" | "resolve"))
    {
        return Err(invalid());
    }
    let mut normalized = serde_json::to_value(&data).map_err(|_| invalid())?;
    if data.correction_proposal_id.is_none() {
        normalized
            .as_object_mut()
            .ok_or_else(invalid)?
            .remove("correction_proposal_id");
    }
    normalized["issue"] = json!(id);
    let hash = crate::canonical::digest(&normalized).map_err(|_| invalid())?;
    let mut tx = retrieval::transaction(&s, &p, &d).await?;
    let r = issue(&mut tx, &p, &d, &id).await?;
    if let Some(existing)=sqlx::query("SELECT *,to_jsonb(created_at) AS created FROM cf_issue_events WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND idempotency_key=$4").bind(&p.tenant).bind(&d).bind(&p.subject).bind(&data.idempotency_key).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?{if existing.get::<String,_>("request_hash")!=hash{return Err(conflict("IDEMPOTENCY_CONFLICT"))}event_access(&mut tx,&p,&d,&existing).await?;let v=event(&existing);p.check_fresh()?;tx.commit().await.map_err(CoreError::sql)?;return Ok((StatusCode::CREATED,Json(v)))}
    let revision = r.get::<i64, _>("revision");
    if revision != data.expected_revision {
        return Err(conflict("STALE_ISSUE"));
    }
    let previous = r.get::<String, _>("status");
    let target = match (data.action.as_str(), previous.as_str()) {
        ("start", "open") => "in_progress",
        ("resolve", "open" | "in_progress") => "resolved",
        ("dismiss", "open" | "in_progress") => "dismissed",
        ("reopen", "resolved" | "dismissed") => "open",
        _ => return Err(conflict("INVALID_TRANSITION")),
    };
    let mut proposal_digest: Option<String> = None;
    let mut published: Option<i64> = None;
    if let Some(proposal) = data.correction_proposal_id {
        let c = correction(&mut tx, &p, &d, &proposal.to_string()).await?;
        let status = c.get::<String, _>("status");
        if matches!(
            status.as_str(),
            "rejected" | "superseded" | "changes_requested" | "deferred"
        ) {
            return Err(conflict("CORRECTION_NOT_ACTIVE"));
        }
        if status == "published" {
            published=sqlx::query_scalar("SELECT sequence FROM cf_commits WHERE tenant_id=$1 AND domain_id=$2 AND proposal_id=$3").bind(&p.tenant).bind(&d).bind(proposal.to_string()).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
            if published.is_none() {
                return Err(CoreError::database());
            }
        }
        if data.action == "resolve" && published.is_none() {
            return Err(conflict("CORRECTION_NOT_PUBLISHED"));
        }
        proposal_digest = Some(c.get("digest"));
    }
    let revision = revision
        .checked_add(1)
        .ok_or_else(|| conflict("STALE_ISSUE"))?;
    sqlx::query(
        "UPDATE cf_issues SET status=$1,revision=$2 WHERE tenant_id=$3 AND domain_id=$4 AND id=$5",
    )
    .bind(target)
    .bind(revision)
    .bind(&p.tenant)
    .bind(&d)
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    let row=sqlx::query("INSERT INTO cf_issue_events(tenant_id,domain_id,id,issue_id,author,previous_status,status,revision,reason,idempotency_key,request_hash,correction_proposal_id,correction_digest,correction_published_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *,to_jsonb(created_at) AS created").bind(&p.tenant).bind(&d).bind(Uuid::new_v4().to_string()).bind(&id).bind(&p.subject).bind(&previous).bind(target).bind(revision).bind(&data.reason).bind(&data.idempotency_key).bind(hash).bind(data.correction_proposal_id.map(|x|x.to_string())).bind(proposal_digest).bind(published).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    let result = event(&row);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok((StatusCode::CREATED, Json(result)))
}
