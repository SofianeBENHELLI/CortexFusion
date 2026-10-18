//! Short-lived opaque cursors. Changes invalidate a traversal instead of silently skipping work.
use crate::{auth::Principal, error::CoreError};
use chrono::{DateTime, Utc};
use http::StatusCode;
use serde_json::Value;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

pub struct Window {
    pub work: i64,
    pub permissions: i64,
    pub as_of: DateTime<Utc>,
    pub position: Option<Value>,
}
fn stale() -> CoreError {
    CoreError {
        code: "WORKSPACE_CURSOR_STALE",
        message: "Restart this list: its scope, permissions, or work state changed",
        status: StatusCode::CONFLICT,
    }
}
pub async fn open(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    kind: &str,
    fingerprint: &str,
    after: Option<&str>,
) -> Result<Window, CoreError> {
    let current = sqlx::query("SELECT work_revision,membership_revision,clock_timestamp() AS as_of FROM cf_domains WHERE tenant_id=$1 AND id=$2")
        .bind(&p.tenant).bind(domain).fetch_one(&mut **tx).await.map_err(CoreError::sql)?;
    let work = current.get("work_revision");
    let permissions = current.get("membership_revision");
    if let Some(id) = after {
        Uuid::parse_str(id).map_err(|_| stale())?;
        let cursor = sqlx::query("SELECT * FROM cf_workspace_cursors WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND id=$4 AND kind=$5 AND fingerprint=$6 AND expires_at>clock_timestamp()")
            .bind(&p.tenant).bind(domain).bind(&p.subject).bind(id).bind(kind).bind(fingerprint).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?.ok_or_else(stale)?;
        if cursor.get::<i64, _>("work_revision") != work
            || cursor.get::<i64, _>("membership_revision") != permissions
        {
            return Err(stale());
        }
        Ok(Window {
            work,
            permissions,
            as_of: cursor.get("as_of"),
            position: Some(cursor.get("position")),
        })
    } else {
        Ok(Window {
            work,
            permissions,
            as_of: current.get("as_of"),
            position: None,
        })
    }
}
pub async fn next(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    kind: &str,
    fingerprint: &str,
    window: &Window,
    position: Option<Value>,
) -> Result<Option<String>, CoreError> {
    let Some(position) = position else {
        return Ok(None);
    };
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO cf_workspace_cursors(tenant_id,domain_id,subject,id,kind,fingerprint,position,work_revision,membership_revision,as_of,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10+interval '15 minutes')")
        .bind(&p.tenant).bind(domain).bind(&p.subject).bind(&id).bind(kind).bind(fingerprint).bind(position).bind(window.work).bind(window.permissions).bind(window.as_of).execute(&mut **tx).await.map_err(CoreError::sql)?;
    Ok(Some(id))
}
