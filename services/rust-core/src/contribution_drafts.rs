//! One private, explicitly saved contribution draft per member/domain.
//! Source permission and fingerprint are checked on every read and new save.
//! Receipts contain no text; replay cannot overwrite a newer draft.
use crate::{auth::Principal, canonical, error::CoreError, server::StateData};
use axum::{
    Json, Router,
    extract::{Path, State},
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
        message: "Read the current private contribution draft and source before saving",
    }
}
fn invalid() -> CoreError {
    error(StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION_FAILED")
}
fn present_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::deserialize(deserializer)
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Span {
    start: usize,
    end: usize,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Content {
    source_id: Uuid,
    source_hash: String,
    title: String,
    excerpt: String,
    reason: String,
    #[serde(deserialize_with = "present_option")]
    selection: Option<Span>,
}
impl Content {
    fn validate(&self) -> Result<(), CoreError> {
        if self.source_hash.len() != 64
            || !self
                .source_hash
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            || [
                (&self.title, 200),
                (&self.excerpt, 200000),
                (&self.reason, 2000),
            ]
            .iter()
            .any(|(s, n)| s.chars().count() > *n || s.contains('\0'))
            || self
                .selection
                .as_ref()
                .is_some_and(|s| s.end <= s.start || s.end > 9_007_199_254_740_991)
        {
            return Err(invalid());
        }
        Ok(())
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Save {
    #[serde(deserialize_with = "present_option")]
    content: Option<Content>,
    expected_revision: i64,
    idempotency_key: Uuid,
}
impl Save {
    fn validate(&self) -> Result<(), CoreError> {
        if self.expected_revision < 0 || self.expected_revision >= 9_007_199_254_740_991 {
            return Err(invalid());
        }
        if let Some(c) = &self.content {
            c.validate()?;
        }
        Ok(())
    }
}
pub fn routes() -> Router<StateData> {
    Router::new().route(
        "/v1/domains/{domain}/contribution-draft",
        get(read).post(save),
    )
}
async fn transaction<'a>(
    s: &'a StateData,
    p: &Principal,
    d: &str,
) -> Result<Transaction<'a, Postgres>, CoreError> {
    s.db.locked_permission_transaction(p, d, WRITERS, "Contribution permission required")
        .await
}
async fn source(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    c: &Content,
    check_selection: bool,
) -> Result<&'static str, CoreError> {
    let row=sqlx::query("SELECT content_hash, CASE WHEN $5 THEN char_length(content) ELSE NULL END AS total FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND allowed_subjects ? $4 FOR SHARE")
      .bind(&p.tenant).bind(d).bind(c.source_id.to_string()).bind(&p.subject).bind(check_selection && c.selection.is_some()).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?;
    let Some(row) = row else {
        return Ok("source_unavailable");
    };
    if row.get::<String, _>("content_hash") != c.source_hash {
        return Ok("source_changed");
    }
    if check_selection && let Some(span) = &c.selection {
        // Validate before converting to PostgreSQL's signed substring indices.
        // The excerpt limit remains 200000 Unicode characters; no source body
        // crosses the database boundary and no prefix is silently accepted.
        let total = row.get::<i32, _>("total") as usize;
        if span.end > total || span.end - span.start != c.excerpt.chars().count() {
            return Err(invalid());
        }
        let matches: bool = sqlx::query_scalar("SELECT convert_to(substring(content FROM $4 FOR $5), 'UTF8') = convert_to($6::text, 'UTF8') FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND id=$3")
            .bind(&p.tenant).bind(d).bind(c.source_id.to_string())
            .bind((span.start + 1) as i32).bind((span.end - span.start) as i32).bind(&c.excerpt)
            .fetch_one(&mut **tx).await.map_err(CoreError::sql)?;
        if !matches {
            return Err(invalid());
        }
    }
    Ok("available")
}
async fn read(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = Uuid::parse_str(&domain).map_err(|_| invalid())?.to_string();
    let mut tx = transaction(&s, &p, &d).await?;
    let row=sqlx::query("SELECT content,revision,to_jsonb(updated_at) AS updated FROM cf_contribution_drafts WHERE tenant_id=$1 AND domain_id=$2 AND author=$3")
      .bind(&p.tenant).bind(&d).bind(&p.subject).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    let mut result = json!({"content":null,"revision":0,"updated_at":null,"state":"empty"});
    if let Some(row) = row {
        result["revision"] = json!(row.get::<i64, _>("revision"));
        result["updated_at"] = row.get::<Value, _>("updated");
        if let Some(raw) = row.get::<Option<Value>, _>("content") {
            let c: Content =
                serde_json::from_value(raw.clone()).map_err(|_| CoreError::database())?;
            let state = source(&mut tx, &p, &d, &c, false).await?;
            result["state"] = json!(state);
            if state == "available" {
                result["content"] = raw;
            }
        }
    }
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    Ok(Json(result))
}
async fn save(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
    body: Result<Json<Save>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = Uuid::parse_str(&domain).map_err(|_| invalid())?.to_string();
    let Json(input) = body.map_err(|_| invalid())?;
    input.validate()?;
    let fingerprint = canonical::digest(
        &json!({"content":input.content,"expected_revision":input.expected_revision}),
    )
    .map_err(|_| invalid())?;
    let mut tx = transaction(&s, &p, &d).await?;
    let old=sqlx::query("SELECT id,request_hash,revision FROM cf_contribution_draft_receipts WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND idempotency_key=$4")
      .bind(&p.tenant).bind(&d).bind(&p.subject).bind(input.idempotency_key.to_string()).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    if let Some(old) = old {
        if old.get::<String, _>("request_hash") != fingerprint {
            return Err(error(StatusCode::CONFLICT, "IDEMPOTENCY_CONFLICT"));
        }
        // A receipt is content-free, but never bypass current access to the referenced source.
        if let Some(c) = &input.content
            && source(&mut tx, &p, &d, c, false).await? == "source_unavailable"
        {
            return Err(error(StatusCode::NOT_FOUND, "NOT_FOUND"));
        }
        let result =
            json!({"receipt_id":old.get::<String,_>("id"),"revision":old.get::<i64,_>("revision")});
        p.check_fresh()?;
        tx.commit().await.map_err(CoreError::sql)?;
        p.check_fresh()?;
        return Ok(Json(result));
    }
    if let Some(c) = &input.content {
        match source(&mut tx, &p, &d, c, true).await? {
            "available" => {}
            "source_changed" => return Err(error(StatusCode::CONFLICT, "SOURCE_CHANGED")),
            _ => return Err(error(StatusCode::NOT_FOUND, "NOT_FOUND")),
        }
    }
    let current:Option<i64>=sqlx::query_scalar("SELECT revision FROM cf_contribution_drafts WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 FOR UPDATE")
      .bind(&p.tenant).bind(&d).bind(&p.subject).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    if current.unwrap_or(0) != input.expected_revision {
        return Err(error(StatusCode::CONFLICT, "DRAFT_REVISION_CONFLICT"));
    }
    let next = input.expected_revision + 1;
    let receipt = Uuid::new_v4().to_string();
    let content = input
        .content
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(|_| invalid())?;
    sqlx::query("INSERT INTO cf_contribution_drafts(tenant_id,domain_id,author,content,revision) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,domain_id,author) DO UPDATE SET content=EXCLUDED.content,revision=EXCLUDED.revision,updated_at=clock_timestamp()")
      .bind(&p.tenant).bind(&d).bind(&p.subject).bind(content).bind(next).execute(&mut *tx).await.map_err(CoreError::sql)?;
    sqlx::query("INSERT INTO cf_contribution_draft_receipts(tenant_id,domain_id,author,idempotency_key,id,request_hash,revision) VALUES($1,$2,$3,$4,$5,$6,$7)")
      .bind(&p.tenant).bind(&d).bind(&p.subject).bind(input.idempotency_key.to_string()).bind(&receipt).bind(&fingerprint).bind(next).execute(&mut *tx).await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    Ok(Json(json!({"receipt_id":receipt,"revision":next})))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unicode_budget_and_invalid_fingerprints() {
        let mut c = Content {
            source_id: Uuid::new_v4(),
            source_hash: "a".repeat(64),
            title: "🧠".repeat(200),
            excerpt: "🧠".repeat(200000),
            reason: String::new(),
            selection: None,
        };
        assert!(c.validate().is_ok());
        c.excerpt.push('x');
        assert!(c.validate().is_err());
        c.excerpt.clear();
        c.source_hash = "g".repeat(64);
        assert!(c.validate().is_err());
    }
}
