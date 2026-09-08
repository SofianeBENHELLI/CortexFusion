//! Personal immutable companion receipts verify citation references, not generated claims.
use crate::{
    auth::Principal, error::CoreError, knowledge::SourceRef, retrieval, server::StateData,
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, post},
};
use http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Row, postgres::PgRow};
use std::collections::BTreeSet;
use uuid::Uuid;
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
        message: "Companion response not found",
        status: StatusCode::NOT_FOUND,
    }
}
fn uuid(s: &str) -> Result<String, CoreError> {
    Uuid::parse_str(s)
        .map(|v| v.to_string())
        .map_err(|_| CoreError::invalid_uuid())
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CompanionInput {
    answer_text: String,
    answer_kind: String,
    #[serde(default)]
    citations: Vec<SourceRef>,
    companion: String,
    model: Option<String>,
    idempotency_key: String,
}
impl CompanionInput {
    fn validate(&self) -> Result<(), CoreError> {
        let refs: BTreeSet<_> = self
            .citations
            .iter()
            .map(|r| (r.source_id, r.start, r.end))
            .collect();
        if !(1..=12000).contains(&self.answer_text.chars().count())
            || self
                .answer_text
                .trim_matches(|c: char| c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c))
                .is_empty()
            || !["answer", "abstention", "clarification"].contains(&self.answer_kind.as_str())
            || self.citations.len() > 50
            || refs.len() != self.citations.len()
            || (self.answer_kind == "answer" && self.citations.is_empty())
            || !(1..=100).contains(&self.companion.chars().count())
            || self
                .model
                .as_ref()
                .is_some_and(|s| !(1..=200).contains(&s.chars().count()))
            || !(8..=128).contains(&self.idempotency_key.chars().count())
        {
            return Err(invalid());
        }
        Ok(())
    }
}
pub(crate) fn references(episode: &PgRow, payload: &Value) -> Result<Vec<Value>, CoreError> {
    let result: Value = episode.get("result");
    let available = result["citations"]
        .as_array()
        .ok_or_else(CoreError::database)?;
    let refs: Vec<SourceRef> =
        serde_json::from_value(payload["citations"].clone()).map_err(|_| CoreError::database())?;
    refs.iter()
        .map(|r| {
            available
                .iter()
                .find(|c| {
                    c["source_id"].as_str() == Some(&r.source_id.to_string())
                        && c["start"].as_u64() == Some(r.start as u64)
                        && c["end"].as_u64() == Some(r.end as u64)
                })
                .cloned()
                .ok_or(CoreError {
                    code: "UNSUPPORTED_RESPONSE_REFERENCE",
                    message: "Use exact citation references returned in this episode",
                    status: StatusCode::UNPROCESSABLE_ENTITY,
                })
        })
        .collect()
}
pub(crate) fn view(row: &PgRow, episode: &PgRow) -> Result<Value, CoreError> {
    let payload: Value = row.get("payload");
    let citations = references(episode, &payload)?;
    Ok(
        json!({"id":row.get::<String,_>("id"),"episode_id":row.get::<String,_>("episode_id"),"served_version":episode.get::<i64,_>("served_version"),"response":payload,"reference_validation":if citations.is_empty(){"no_references"}else{"episode_references_checked"},"citations":citations,"semantic_validation":"not_performed","created_at":row.get::<Value,_>("created")}),
    )
}
fn twenty() -> usize {
    20
}
#[derive(Deserialize)]
struct PageInput {
    #[serde(default = "twenty")]
    limit: usize,
    after: Option<Uuid>,
    episode_id: Option<Uuid>,
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route(
            "/v1/domains/{domain}/episodes/{episode_id}/companion-responses",
            post(create),
        )
        .route(
            "/v1/domains/{domain}/companion-responses/{response_id}",
            get(read),
        )
        .route("/v1/domains/{domain}/companion-responses", get(list))
}
async fn create(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<(StatusCode, Json<Value>), CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let id = uuid(&id)?;
    let Json(raw) = body.map_err(|_| invalid())?;
    let input: CompanionInput = serde_json::from_value(raw).map_err(|_| invalid())?;
    input.validate()?;
    Ok((
        StatusCode::CREATED,
        Json(create_service(&s, &p, &domain, &id, input).await?),
    ))
}
pub(crate) async fn create_service(
    s: &StateData,
    p: &Principal,
    domain: &str,
    id: &str,
    input: CompanionInput,
) -> Result<Value, CoreError> {
    input.validate()?;
    let mut tx = retrieval::transaction(s, p, domain).await?;
    let sources = retrieval::accessible(&mut tx, p, domain).await?;
    let episode = retrieval::episode_row(&mut tx, p, domain, id, &sources).await?;
    let payload = serde_json::to_value(&input).map_err(|_| invalid())?;
    let mut fingerprint = payload.clone();
    fingerprint["episode_id"] = json!(id);
    let fingerprint = crate::canonical::digest(&fingerprint).map_err(|_| invalid())?;
    let old=sqlx::query("SELECT *,to_jsonb(created_at) AS created FROM cf_companion_responses WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND idempotency_key=$4").bind(&p.tenant).bind(domain).bind(&p.subject).bind(&input.idempotency_key).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    if let Some(row) = old {
        if row.get::<&str, _>("request_hash") != fingerprint {
            return Err(CoreError {
                code: "IDEMPOTENCY_CONFLICT",
                message: "Companion response key reused",
                status: StatusCode::CONFLICT,
            });
        }
        p.check_fresh()?;
        return view(&row, &episode);
    }
    references(&episode, &payload)?;
    let response_id = Uuid::new_v4().to_string();
    let row=sqlx::query("INSERT INTO cf_companion_responses(tenant_id,domain_id,id,subject,episode_id,payload,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *,to_jsonb(created_at) AS created").bind(&p.tenant).bind(domain).bind(response_id).bind(&p.subject).bind(id).bind(payload).bind(&input.idempotency_key).bind(fingerprint).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    let value = view(&row, &episode)?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(value)
}
async fn read(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let id = uuid(&id)?;
    let mut tx = retrieval::transaction(&s, &p, &domain).await?;
    let row=sqlx::query("SELECT *,to_jsonb(created_at) AS created FROM cf_companion_responses WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND subject=$4").bind(&p.tenant).bind(&domain).bind(&id).bind(&p.subject).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?.ok_or_else(missing)?;
    let sources = retrieval::accessible(&mut tx, &p, &domain).await?;
    let episode =
        retrieval::episode_row(&mut tx, &p, &domain, row.get("episode_id"), &sources).await?;
    let value = view(&row, &episode)?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(value))
}
async fn list(
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
    let mut tx = retrieval::transaction(&s, &p, &domain).await?;
    let sources = retrieval::accessible(&mut tx, &p, &domain).await?;
    if let Some(id) = input.episode_id {
        retrieval::episode_row(&mut tx, &p, &domain, &id.to_string(), &sources).await?;
    }
    let mut cursor = input.after.map(|v| v.to_string()).unwrap_or_default();
    let mut items = Vec::new();
    while items.len() <= input.limit {
        let rows=sqlx::query("SELECT *,to_jsonb(created_at) AS created FROM cf_companion_responses WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND id>$4 AND ($5='' OR episode_id=$5) ORDER BY id LIMIT 100").bind(&p.tenant).bind(&domain).bind(&p.subject).bind(&cursor).bind(input.episode_id.map(|v|v.to_string()).unwrap_or_default()).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
        let count = rows.len();
        if count == 0 {
            break;
        }
        for row in rows {
            cursor = row.get("id");
            match retrieval::episode_row(&mut tx, &p, &domain, row.get("episode_id"), &sources)
                .await
            {
                Ok(e) => items.push(view(&row, &e)?),
                Err(e) if e.status == StatusCode::NOT_FOUND => continue,
                Err(e) => return Err(e),
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
