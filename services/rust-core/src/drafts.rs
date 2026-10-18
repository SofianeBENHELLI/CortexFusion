//! Personal, explicit saves. Current membership and conversation ownership are rechecked.
//! Receipts contain no draft text; a duplicate key never overwrites newer work.
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

fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Invalid draft parameters",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn conflict(code: &'static str) -> CoreError {
    CoreError {
        code,
        message: "Read the current draft before preparing another save",
        status: StatusCode::CONFLICT,
    }
}
fn key(value: &str) -> Result<String, CoreError> {
    if value == "new" {
        Ok(value.into())
    } else {
        Uuid::parse_str(value)
            .map(|v| v.to_string())
            .map_err(|_| invalid())
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Save {
    text: String,
    expected_revision: i64,
    idempotency_key: Uuid,
}
impl Save {
    fn validate(&self) -> Result<(), CoreError> {
        if self.text.chars().count() > 2000
            || self.expected_revision < 0
            || self.expected_revision >= 9_007_199_254_740_991
        {
            Err(invalid())
        } else {
            Ok(())
        }
    }
}
pub fn routes() -> Router<StateData> {
    Router::new().route(
        "/v1/domains/{domain}/conversation-drafts/{draft_key}",
        get(read).post(save),
    )
}
async fn transaction<'a>(
    s: &'a StateData,
    p: &Principal,
    d: &str,
    k: &str,
    write: bool,
) -> Result<Transaction<'a, Postgres>, CoreError> {
    let mut tx = if write {
        s.db.locked_permission_transaction(
            p,
            d,
            &["owner", "corpus_manager", "contributor", "viewer", "agent"],
            "Domain membership required",
        )
        .await?
    } else {
        s.db.transaction(p, d, false).await?
    };
    if k != "new" {
        crate::conversations::row(&mut tx, p, d, k, write).await?;
    }
    Ok(tx)
}
async fn read(
    State(s): State<StateData>,
    Path((domain, draft_key)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = Uuid::parse_str(&domain).map_err(|_| invalid())?.to_string();
    let k = key(&draft_key)?;
    let mut tx = transaction(&s, &p, &d, &k, false).await?;
    let row=sqlx::query("SELECT text,revision,to_jsonb(updated_at) AS updated FROM cf_workspace_drafts WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND draft_key=$4")
      .bind(&p.tenant).bind(&d).bind(&p.subject).bind(&k).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    let result = match row {
        Some(r) => {
            json!({"draft_key":k,"text":r.get::<String,_>("text"),"revision":r.get::<i64,_>("revision"),"updated_at":r.get::<Value,_>("updated")})
        }
        None => json!({"draft_key":k,"text":"","revision":0,"updated_at":null}),
    };
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    Ok(Json(result))
}
async fn save(
    State(s): State<StateData>,
    Path((domain, draft_key)): Path<(String, String)>,
    headers: HeaderMap,
    body: Result<Json<Save>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = Uuid::parse_str(&domain).map_err(|_| invalid())?.to_string();
    let k = key(&draft_key)?;
    let Json(input) = body.map_err(|_| invalid())?;
    input.validate()?;
    let fingerprint = canonical::digest(
        &json!({"draft_key":k,"text":input.text,"expected_revision":input.expected_revision}),
    )
    .map_err(|_| invalid())?;
    let mut tx = transaction(&s, &p, &d, &k, true).await?;
    let old=sqlx::query("SELECT id,request_hash,revision,draft_key FROM cf_workspace_draft_receipts WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND idempotency_key=$4")
      .bind(&p.tenant).bind(&d).bind(&p.subject).bind(input.idempotency_key.to_string()).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    if let Some(old) = old {
        if old.get::<String, _>("request_hash") != fingerprint {
            return Err(conflict("IDEMPOTENCY_CONFLICT"));
        }
        let result = json!({"receipt_id":old.get::<String,_>("id"),"draft_key":old.get::<String,_>("draft_key"),"revision":old.get::<i64,_>("revision")});
        p.check_fresh()?;
        tx.commit().await.map_err(CoreError::sql)?;
        return Ok(Json(result));
    }
    let revision:Option<i64>=sqlx::query_scalar("SELECT revision FROM cf_workspace_drafts WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND draft_key=$4 FOR UPDATE")
      .bind(&p.tenant).bind(&d).bind(&p.subject).bind(&k).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    if revision.unwrap_or(0) != input.expected_revision {
        return Err(conflict("DRAFT_REVISION_CONFLICT"));
    }
    let next = input.expected_revision + 1;
    let receipt = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO cf_workspace_drafts(tenant_id,domain_id,author,draft_key,text,revision) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,domain_id,author,draft_key) DO UPDATE SET text=EXCLUDED.text,revision=EXCLUDED.revision,updated_at=clock_timestamp()")
      .bind(&p.tenant).bind(&d).bind(&p.subject).bind(&k).bind(&input.text).bind(next).execute(&mut *tx).await.map_err(CoreError::sql)?;
    sqlx::query("INSERT INTO cf_workspace_draft_receipts(tenant_id,domain_id,author,idempotency_key,id,draft_key,request_hash,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
      .bind(&p.tenant).bind(&d).bind(&p.subject).bind(input.idempotency_key.to_string()).bind(&receipt).bind(&k).bind(&fingerprint).bind(next).execute(&mut *tx).await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    Ok(Json(
        json!({"receipt_id":receipt,"draft_key":k,"revision":next}),
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_unicode_bound_and_revisions() {
        let mut value = Save {
            text: "🧠".repeat(2000),
            expected_revision: 0,
            idempotency_key: Uuid::new_v4(),
        };
        assert!(value.validate().is_ok());
        value.text.push('x');
        assert!(value.validate().is_err());
        value.text.clear();
        value.expected_revision = -1;
        assert!(value.validate().is_err());
        value.expected_revision = 9_007_199_254_740_991;
        assert!(value.validate().is_err());
    }
    #[test]
    fn only_new_or_uuid_keys() {
        assert!(key("new").is_ok());
        assert!(key("../new").is_err());
        assert!(key("arbitrary").is_err());
        assert!(key(&Uuid::new_v4().to_string()).is_ok());
    }
}
