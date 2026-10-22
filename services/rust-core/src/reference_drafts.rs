//! Private, source-backed preparation. Never an approved reference or a test verdict.
use crate::{auth::Principal, canonical, error::CoreError, server::StateData};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::get,
};
use http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;
const WRITERS: &[&str] = &["owner", "corpus_manager", "contributor", "agent"];
fn error(status: StatusCode, code: &'static str) -> CoreError {
    CoreError {
        status,
        code,
        message: "Read the current private question and its source before saving",
    }
}
fn invalid() -> CoreError {
    error(StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION_FAILED")
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Span {
    start: usize,
    end: usize,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Content {
    theme: String,
    question: String,
    criteria: String,
    source_id: Uuid,
    source_hash: String,
    excerpt: String,
    selection: Span,
}
impl Content {
    pub(crate) fn validate(&self) -> Result<(), CoreError> {
        if self.source_hash.len() != 64
            || !self
                .source_hash
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            || [
                (&self.theme, 200),
                (&self.question, 2000),
                (&self.criteria, 8000),
                (&self.excerpt, 10000),
            ]
            .iter()
            .any(|(s, n)| s.trim().is_empty() || s.chars().count() > *n || s.contains('\0'))
            || self.selection.end <= self.selection.start
            || self.selection.end > 9_007_199_254_740_991
        {
            return Err(invalid());
        }
        Ok(())
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Save {
    content: Content,
    expected_revision: i64,
    idempotency_key: Uuid,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Page {
    limit: Option<i64>,
    after: Option<Uuid>,
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route("/v1/domains/{domain}/reference-drafts", get(list))
        .route(
            "/v1/domains/{domain}/reference-draft-receipts/{command}",
            get(read_receipt),
        )
        .route(
            "/v1/domains/{domain}/reference-drafts/{question}",
            get(read).post(save),
        )
}
async fn read_receipt(
    State(s): State<StateData>,
    Path((domain, command)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = Uuid::parse_str(&domain).map_err(|_| invalid())?.to_string();
    let key = Uuid::parse_str(&command)
        .map_err(|_| invalid())?
        .to_string();
    let mut tx = transaction(&s, &p, &d).await?;
    // Only this actor's immutable receipt; deliberately no source/question text.
    // Current source revocation does not erase proof of a previous personal write.
    let r = sqlx::query("SELECT id,question_id,revision FROM cf_reference_draft_receipts WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND idempotency_key=$4")
        .bind(&p.tenant).bind(&d).bind(&p.subject).bind(&key)
        .fetch_optional(&mut *tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
    let result = json!({"command_id":key,"receipt":{"receipt_id":r.get::<String,_>("id"),"question_id":r.get::<String,_>("question_id"),"revision":r.get::<i64,_>("revision")}});
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    Ok(Json(result))
}
async fn transaction<'a>(
    s: &'a StateData,
    p: &Principal,
    d: &str,
) -> Result<Transaction<'a, Postgres>, CoreError> {
    s.db.locked_permission_transaction(p, d, WRITERS, "Reference preparation permission required")
        .await
}
pub(crate) async fn source(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    c: &Content,
    selection: bool,
) -> Result<(), CoreError> {
    // Lock and inspect metadata first. Only the bounded proof leaves PostgreSQL.
    let r=sqlx::query("SELECT content_hash, CASE WHEN $5 THEN char_length(content) ELSE NULL END AS total FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND allowed_subjects ? $4 FOR SHARE")
        .bind(&p.tenant).bind(d).bind(c.source_id.to_string()).bind(&p.subject).bind(selection).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
    if r.get::<String, _>("content_hash") != c.source_hash {
        return Err(error(StatusCode::CONFLICT, "SOURCE_CHANGED"));
    }
    if selection {
        let size = c
            .selection
            .end
            .checked_sub(c.selection.start)
            .ok_or_else(invalid)?;
        if size == 0
            || size > 10000
            || size != c.excerpt.chars().count()
            || c.selection.end > r.get::<i32, _>("total") as usize
        {
            return Err(invalid());
        }
        let start = i32::try_from(c.selection.start + 1).map_err(|_| invalid())?;
        let text: String = sqlx::query_scalar("SELECT substring(content FROM $4 FOR $5) FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND id=$3")
            .bind(&p.tenant).bind(d).bind(c.source_id.to_string()).bind(start).bind(size as i32)
            .fetch_one(&mut **tx).await.map_err(CoreError::sql)?;
        if text != c.excerpt {
            return Err(invalid());
        }
    }
    Ok(())
}
async fn list(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
    query: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = Uuid::parse_str(&domain).map_err(|_| invalid())?.to_string();
    let Query(page) = query.map_err(|_| invalid())?;
    let limit = page.limit.unwrap_or(20);
    if !(1..=20).contains(&limit) {
        return Err(invalid());
    }
    let mut tx = transaction(&s, &p, &d).await?;
    // Private author scope plus current source access/hash, before pagination.
    let rows=sqlx::query("SELECT q.id,q.content->>'theme' AS theme,q.content->>'question' AS question,q.revision,to_jsonb(q.updated_at) AS updated FROM cf_reference_drafts q JOIN cf_sources s ON s.tenant_id=q.tenant_id AND s.domain_id=q.domain_id AND s.id=q.content->>'source_id' WHERE q.tenant_id=$1 AND q.domain_id=$2 AND q.author=$3 AND s.allowed_subjects ? $3 AND s.content_hash=q.content->>'source_hash' AND ($4::text IS NULL OR q.id>$4) ORDER BY q.id LIMIT $5")
        .bind(&p.tenant).bind(&d).bind(&p.subject).bind(page.after.map(|v|v.to_string())).bind(limit+1).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let more = rows.len() > limit as usize;
    let items:Vec<Value>=rows.iter().take(limit as usize).map(|r|json!({"id":r.get::<String,_>("id"),"theme":r.get::<String,_>("theme"),"question":r.get::<String,_>("question"),"revision":r.get::<i64,_>("revision"),"updated_at":r.get::<Value,_>("updated")})).collect();
    let after = if more {
        items.last().map(|v| v["id"].clone())
    } else {
        None
    };
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    Ok(Json(json!({"items":items,"next_after":after})))
}
async fn read(
    State(s): State<StateData>,
    Path((domain, question)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = Uuid::parse_str(&domain).map_err(|_| invalid())?.to_string();
    let q = Uuid::parse_str(&question)
        .map_err(|_| invalid())?
        .to_string();
    let mut tx = transaction(&s, &p, &d).await?;
    let r=sqlx::query("SELECT content,revision,to_jsonb(updated_at) AS updated FROM cf_reference_drafts WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND id=$4")
        .bind(&p.tenant).bind(&d).bind(&p.subject).bind(&q).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
    let raw: Value = r.get("content");
    let c: Content = serde_json::from_value(raw.clone()).map_err(|_| CoreError::database())?;
    source(&mut tx, &p, &d, &c, false).await?;
    let result = json!({"id":q,"content":raw,"revision":r.get::<i64,_>("revision"),"updated_at":r.get::<Value,_>("updated"),"status":"draft","visibility":"personal"});
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    Ok(Json(result))
}
async fn save(
    State(s): State<StateData>,
    Path((domain, question)): Path<(String, String)>,
    headers: HeaderMap,
    body: Result<Json<Save>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = Uuid::parse_str(&domain).map_err(|_| invalid())?.to_string();
    let q = Uuid::parse_str(&question)
        .map_err(|_| invalid())?
        .to_string();
    let Json(input) = body.map_err(|_| invalid())?;
    input.content.validate()?;
    if input.expected_revision < 0 || input.expected_revision >= 9_007_199_254_740_991 {
        return Err(invalid());
    }
    let hash=canonical::digest(&json!({"question_id":q,"content":input.content,"expected_revision":input.expected_revision})).map_err(|_|invalid())?;
    let mut tx = transaction(&s, &p, &d).await?;
    source(&mut tx, &p, &d, &input.content, true).await?;
    let receipt=sqlx::query("SELECT id,question_id,request_hash,revision FROM cf_reference_draft_receipts WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND idempotency_key=$4")
        .bind(&p.tenant).bind(&d).bind(&p.subject).bind(input.idempotency_key.to_string()).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    if let Some(r) = receipt {
        if r.get::<String, _>("request_hash") != hash {
            return Err(error(StatusCode::CONFLICT, "IDEMPOTENCY_CONFLICT"));
        }
        let result = json!({"receipt_id":r.get::<String,_>("id"),"question_id":r.get::<String,_>("question_id"),"revision":r.get::<i64,_>("revision")});
        p.check_fresh()?;
        tx.commit().await.map_err(CoreError::sql)?;
        p.check_fresh()?;
        return Ok(Json(result));
    }
    let old=sqlx::query("SELECT content,revision FROM cf_reference_drafts WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND id=$4 FOR UPDATE")
        .bind(&p.tenant).bind(&d).bind(&p.subject).bind(&q).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    let mut revision = 0;
    if let Some(r) = old {
        revision = r.get("revision");
        let c: Content =
            serde_json::from_value(r.get("content")).map_err(|_| CoreError::database())?;
        source(&mut tx, &p, &d, &c, false).await?;
    }
    if revision != input.expected_revision {
        return Err(error(StatusCode::CONFLICT, "DRAFT_REVISION_CONFLICT"));
    }
    let next = revision + 1;
    let receipt = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO cf_reference_drafts(tenant_id,domain_id,author,id,content,revision) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,domain_id,author,id) DO UPDATE SET content=EXCLUDED.content,revision=EXCLUDED.revision,updated_at=clock_timestamp()")
        .bind(&p.tenant).bind(&d).bind(&p.subject).bind(&q).bind(serde_json::to_value(input.content).map_err(|_|invalid())?).bind(next).execute(&mut *tx).await.map_err(CoreError::sql)?;
    sqlx::query("INSERT INTO cf_reference_draft_receipts(tenant_id,domain_id,author,idempotency_key,id,question_id,request_hash,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(&p.tenant).bind(&d).bind(&p.subject).bind(input.idempotency_key.to_string()).bind(&receipt).bind(&q).bind(&hash).bind(next).execute(&mut *tx).await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    Ok(Json(
        json!({"receipt_id":receipt,"question_id":q,"revision":next}),
    ))
}
