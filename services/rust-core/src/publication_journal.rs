//! Recent publication summaries with a fixed version fence and bounded ACL scan.
use crate::{error::CoreError, proposals, server::StateData};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::get,
};
use chrono::{DateTime, Utc};
use http::{HeaderMap, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

const SCAN_LIMIT: usize = 100;
const MAX_VERSION: i64 = 9_007_199_254_740_990;
fn twenty() -> usize {
    20
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Window {
    #[serde(default = "twenty")]
    limit: usize,
    before: Option<i64>,
    at_version: Option<i64>,
    since: Option<DateTime<Utc>>,
    until: Option<DateTime<Utc>>,
}
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Invalid publication window",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
impl Window {
    fn validate(&self) -> Result<(), CoreError> {
        if !(1..=50).contains(&self.limit)
            || self
                .before
                .is_some_and(|v| !(1..=MAX_VERSION + 1).contains(&v))
            || self
                .at_version
                .is_some_and(|v| !(0..=MAX_VERSION).contains(&v))
            || self.before.is_some() && self.at_version.is_none()
            || matches!((self.since,self.until), (Some(a),Some(b)) if a > b)
        {
            return Err(invalid());
        }
        Ok(())
    }
}
pub fn routes() -> Router<StateData> {
    Router::new().route("/v1/domains/{domain}/publications", get(read))
}
async fn read(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
    input: Result<Query<Window>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let principal = s.auth.authenticate(&headers)?;
    let domain = Uuid::parse_str(&domain)
        .map_err(|_| CoreError::invalid_uuid())?
        .to_string();
    let Query(q) = input.map_err(|_| invalid())?;
    q.validate()?;
    let mut tx = s.db.locked_owner_transaction(&principal, &domain).await?;
    let current: i64 =
        sqlx::query_scalar("SELECT published_version FROM cf_domains WHERE tenant_id=$1 AND id=$2")
            .bind(&principal.tenant)
            .bind(&domain)
            .fetch_one(&mut *tx)
            .await
            .map_err(CoreError::sql)?;
    let anchor = q.at_version.unwrap_or(current);
    if anchor > current || !(0..=MAX_VERSION).contains(&anchor) {
        return Err(invalid());
    }
    let before = q.before.unwrap_or(anchor + 1);
    if before > anchor + 1 {
        return Err(invalid());
    }
    // Metadata only: never fetch the commit's potentially large before_state here.
    // Include legacy rows without an audit; consumers must mark their time as unknown.
    let rows = sqlx::query("SELECT c.sequence,c.proposal_id,c.author,c.reason,c.digest,to_jsonb(c.created_at) AS created,p.publisher,to_jsonb(p.recorded_at) AS recorded FROM cf_commits c LEFT JOIN cf_publications p ON p.tenant_id=c.tenant_id AND p.domain_id=c.domain_id AND p.sequence=c.sequence WHERE c.tenant_id=$1 AND c.domain_id=$2 AND c.sequence <= $3 AND c.sequence < $4 AND ($5::timestamptz IS NULL OR p.recorded_at IS NULL OR p.recorded_at >= $5) AND ($6::timestamptz IS NULL OR p.recorded_at IS NULL OR p.recorded_at <= $6) ORDER BY c.sequence DESC LIMIT $7")
        .bind(&principal.tenant).bind(&domain).bind(anchor).bind(before).bind(q.since).bind(q.until)
        .bind((SCAN_LIMIT+1) as i64).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let mut items = Vec::new();
    let mut next = None;
    let mut scan_limited = false;
    for (i, r) in rows.iter().take(SCAN_LIMIT).enumerate() {
        let sequence: i64 = r.get("sequence");
        let proposal = proposals::row(&mut tx, &principal, &domain, r.get("proposal_id")).await?;
        match proposals::check_access_targeted(&mut tx, &principal, &domain, &proposal).await {
            Ok(()) => {
                let publisher = r.get::<Option<String>, _>("publisher");
                let publication = publisher
                    .map(|who| json!({"publisher":who,"recorded_at":r.get::<Value,_>("recorded")}));
                items.push(json!({"sequence":sequence,"proposal_id":r.get::<String,_>("proposal_id"),"author":r.get::<String,_>("author"),"reason":r.get::<String,_>("reason"),"digest":r.get::<String,_>("digest"),"created_at":r.get::<Value,_>("created"),"published":true,"publication":publication}));
            }
            Err(e) if e.status == StatusCode::NOT_FOUND => {}
            Err(e) => return Err(e),
        }
        principal.check_fresh()?;
        if items.len() == q.limit || i + 1 == SCAN_LIMIT {
            if i + 1 < rows.len() {
                next = Some(sequence);
            }
            scan_limited = i + 1 == SCAN_LIMIT && items.len() < q.limit && next.is_some();
            break;
        }
    }
    principal.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(
        json!({"domain_id":domain,"at_version":anchor,"since":q.since,"until":q.until,"items":items,"next_before":next,"scan_limited":scan_limited}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_ambiguous_or_unbounded_windows() {
        for value in [
            json!({"limit":0}),
            json!({"limit":51}),
            json!({"before":2}),
            json!({"at_version":-1}),
            json!({"at_version":0,"before":0}),
            json!({"since":"2026-10-03T00:00:00Z","until":"2026-10-02T00:00:00Z"}),
        ] {
            assert!(
                serde_json::from_value::<Window>(value)
                    .unwrap()
                    .validate()
                    .is_err()
            );
        }
        assert!(serde_json::from_value::<Window>(json!({"after":1})).is_err());
        assert!(
            serde_json::from_value::<Window>(json!({"at_version":12,"before":10,"limit":20}))
                .unwrap()
                .validate()
                .is_ok()
        );
    }
}
