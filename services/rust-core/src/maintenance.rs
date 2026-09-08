//! Signed publication and journal reconstruction against the immutable graph manifest.
use crate::{
    auth::Principal,
    changes::Change,
    error::CoreError,
    server::StateData,
    snapshot::{Concept, Snapshot},
};
use axum::{
    Json, Router,
    extract::{Path, State},
    response::{IntoResponse, Response},
    routing::post,
};
use http::{HeaderMap, StatusCode};
use serde_json::{Value, json};
use sqlx::Row;
use std::collections::BTreeMap;
use uuid::Uuid;
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Invalid maintenance arguments",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn stale() -> CoreError {
    CoreError {
        code: "STALE_PUBLICATION",
        message: "Published version changed during maintenance",
        status: StatusCode::CONFLICT,
    }
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route("/v1/domains/{domain}/publish", post(publish))
        .route("/v1/domains/{domain}/replay", post(replay))
        .route(
            "/v1/domains/{domain}/commits/{sequence}/compensate",
            post(compensate),
        )
}
async fn publish(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    axum::extract::RawQuery(q): axum::extract::RawQuery,
    p: Option<axum::Extension<crate::confirmation::ConfirmedAction>>,
    b: axum::body::Bytes,
) -> Response {
    command(s, d, None, h, q, p, b, "domain.publish").await
}
async fn replay(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    axum::extract::RawQuery(q): axum::extract::RawQuery,
    p: Option<axum::Extension<crate::confirmation::ConfirmedAction>>,
    b: axum::body::Bytes,
) -> Response {
    command(s, d, None, h, q, p, b, "domain.replay").await
}
async fn compensate(
    State(s): State<StateData>,
    Path((d, seq)): Path<(String, String)>,
    h: HeaderMap,
    axum::extract::RawQuery(q): axum::extract::RawQuery,
    p: Option<axum::Extension<crate::confirmation::ConfirmedAction>>,
    b: axum::body::Bytes,
) -> Response {
    command(s, d, Some(seq), h, q, p, b, "commits.compensate").await
}
#[allow(clippy::too_many_arguments)]
async fn command(
    s: StateData,
    d: String,
    seq: Option<String>,
    h: HeaderMap,
    q: Option<String>,
    proof: Option<axum::Extension<crate::confirmation::ConfirmedAction>>,
    body: axum::body::Bytes,
    action: &str,
) -> Response {
    let mut args = json!({"path":{"domain":d}});
    let raw = serde_json::from_slice::<Value>(&body);
    if let Some(seq) = &seq {
        args["path"]["sequence"] = seq.parse::<i64>().map(|n| json!(n)).unwrap_or(json!(seq));
        args["body"] = raw.as_ref().unwrap_or(&Value::Null).clone();
    }
    let result: Result<Value, CoreError> = async {
        let p = s.auth.authenticate(&h)?;
        let d = Uuid::parse_str(&d)
            .map_err(|_| CoreError::invalid_uuid())?
            .to_string();
        if q.is_some_and(|q| !q.is_empty()) {
            return Err(invalid());
        }
        let data = if seq.is_some() {
            Some(crate::proposals::parse_compensation(
                raw.map_err(|_| invalid())?,
            )?)
        } else {
            if !body.is_empty() {
                return Err(invalid());
            }
            None
        };
        let sequence = seq
            .map(|n| n.parse::<i64>().map_err(|_| invalid()))
            .transpose()?;
        let tx = s.db.locked_owner_transaction(&p, &d).await?;
        tx.commit().await.map_err(CoreError::sql)?;
        if !proof
            .as_ref()
            .is_some_and(|v| v.subject == p.subject && v.tenant == p.tenant && v.action == action)
        {
            if h.get_all("x-cortex-confirmation").iter().count() > 1 {
                return Err(invalid());
            }
            s.confirmation
                .as_ref()
                .ok_or_else(crate::confirmation::required)?
                .consume(
                    &p,
                    &d,
                    action,
                    &args,
                    h.get("x-cortex-confirmation").and_then(|v| v.to_str().ok()),
                )
                .await?;
        }
        match action {
            "domain.publish" => publish_next(&s, &p, &d).await,
            "domain.replay" => rebuild(&s, &p, &d).await,
            "commits.compensate" => {
                crate::proposals::compensate_service(
                    &s,
                    &p,
                    &d,
                    sequence.ok_or_else(invalid)?,
                    data.ok_or_else(invalid)?,
                )
                .await
            }
            _ => Err(invalid()),
        }
    }
    .await;
    match result{Ok(v)=>Json(v).into_response(),Err(e)if e.code=="CONFIRMATION_REQUIRED"=>(e.status,Json(json!({"error":e.code,"message":e.message,"confirmation_request":{"action":action,"command_hash":crate::confirmation::command_hash(action,&args).unwrap_or_default(),"transport_header":"X-Cortex-Confirmation","max_lifetime_seconds":300}}))).into_response(),Err(e)=>e.into_response()}
}
async fn publish_next(s: &StateData, p: &Principal, d: &str) -> Result<Value, CoreError> {
    let mut tx = s.db.locked_owner_transaction(p, d).await?;
    let r = sqlx::query(
        "SELECT accepted_version,published_version FROM cf_domains WHERE tenant_id=$1 AND id=$2",
    )
    .bind(&p.tenant)
    .bind(d)
    .fetch_one(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    let published = r.get::<i64, _>("published_version");
    if published == r.get::<i64, _>("accepted_version") {
        p.check_fresh()?;
        return Ok(json!({"published_version":published,"changed":false}));
    }
    let next = published.checked_add(1).ok_or_else(CoreError::database)?;
    let id: String = sqlx::query_scalar(
        "SELECT proposal_id FROM cf_commits WHERE tenant_id=$1 AND domain_id=$2 AND sequence=$3",
    )
    .bind(&p.tenant)
    .bind(d)
    .bind(next)
    .fetch_optional(&mut *tx)
    .await
    .map_err(CoreError::sql)?
    .ok_or_else(CoreError::database)?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    let result = s
        .graph
        .as_ref()
        .ok_or_else(CoreError::database)?
        .publish_target(p, d, &id, published)
        .await?;
    Ok(json!({"published_version":result["published_version"],"changed":result["changed"]}))
}
async fn rebuild(s: &StateData, p: &Principal, d: &str) -> Result<Value, CoreError> {
    let mut tx = s.db.locked_owner_transaction(p, d).await?;
    let version: i64 =
        sqlx::query_scalar("SELECT published_version FROM cf_domains WHERE tenant_id=$1 AND id=$2")
            .bind(&p.tenant)
            .bind(d)
            .fetch_one(&mut *tx)
            .await
            .map_err(CoreError::sql)?;
    let raw:Option<Value>=sqlx::query_scalar("SELECT snapshot FROM cf_graph_manifests WHERE tenant_id=$1 AND domain_id=$2 AND version=$3").bind(&p.tenant).bind(d).bind(version).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    let snapshot = raw
        .map(serde_json::from_value::<Snapshot>)
        .transpose()
        .map_err(|_| CoreError::database())?;
    if version > 0 && snapshot.is_none() {
        return Err(CoreError::database());
    }
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    let graph = if let Some(snapshot) = snapshot {
        s.graph
            .as_ref()
            .ok_or_else(CoreError::database)?
            .engine
            .read_snapshot(&snapshot)
            .await
            .map_err(|_| CoreError::database())?
    } else {
        Vec::new()
    };
    let graph = graph
        .into_iter()
        .map(|c| (c.concept_id, c))
        .collect::<BTreeMap<_, _>>();
    let mut tx = s.db.locked_owner_transaction(p, d).await?;
    let current: i64 =
        sqlx::query_scalar("SELECT published_version FROM cf_domains WHERE tenant_id=$1 AND id=$2")
            .bind(&p.tenant)
            .bind(d)
            .fetch_one(&mut *tx)
            .await
            .map_err(CoreError::sql)?;
    if current != version {
        return Err(stale());
    }
    let rows=sqlx::query("SELECT sequence,changes FROM cf_commits WHERE tenant_id=$1 AND domain_id=$2 AND sequence<=$3 ORDER BY sequence").bind(&p.tenant).bind(d).bind(version).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let mut state = BTreeMap::<Uuid, (Concept, i64)>::new();
    let mut expected = 0i64;
    for r in rows {
        expected = expected.checked_add(1).ok_or_else(CoreError::database)?;
        let sequence = r.get::<i64, _>("sequence");
        if sequence != expected {
            return Err(CoreError::database());
        }
        let changes: Vec<Change> =
            serde_json::from_value(r.get("changes")).map_err(|_| CoreError::database())?;
        for change in changes {
            match change {
                Change::PutConcept { concept } => {
                    state.insert(concept.concept_id, (concept, sequence));
                }
                Change::RetireConcept { concept_id } => {
                    state.remove(&concept_id);
                }
            }
        }
    }
    if expected != version {
        return Err(CoreError::database());
    }
    let journal = state
        .iter()
        .map(|(id, (c, _))| (*id, c))
        .collect::<BTreeMap<_, _>>();
    if crate::canonical::digest(&serde_json::to_value(&journal).map_err(|_| CoreError::database())?)
        .map_err(|_| CoreError::database())?
        != crate::canonical::digest(
            &serde_json::to_value(&graph).map_err(|_| CoreError::database())?,
        )
        .map_err(|_| CoreError::database())?
    {
        return Err(CoreError::database());
    }
    let sources = crate::retrieval::accessible(&mut tx, p, d).await?;
    let mut visible = graph
        .into_iter()
        .filter(|(_, c)| {
            c.sources
                .iter()
                .all(|span| sources.contains_key(&span.source_id))
        })
        .collect::<BTreeMap<_, _>>();
    let ids = visible
        .keys()
        .copied()
        .collect::<std::collections::BTreeSet<_>>();
    for c in visible.values_mut() {
        c.links.retain(|l| ids.contains(&l.target_id));
    }
    sqlx::query("DELETE FROM cf_concepts WHERE tenant_id=$1 AND domain_id=$2")
        .bind(&p.tenant)
        .bind(d)
        .execute(&mut *tx)
        .await
        .map_err(CoreError::sql)?;
    for (id, (c, sequence)) in state {
        sqlx::query("INSERT INTO cf_concepts(tenant_id,domain_id,id,payload,version) VALUES($1,$2,$3,$4,$5)").bind(&p.tenant).bind(d).bind(id.to_string()).bind(serde_json::to_value(c).map_err(|_|CoreError::database())?).bind(sequence).execute(&mut *tx).await.map_err(CoreError::sql)?;
    }
    let result = json!({"published_version":version,"concept_count":visible.len(),"state_hash":crate::canonical::digest(&serde_json::to_value(visible).map_err(|_|CoreError::database())?).map_err(|_|CoreError::database())?});
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(result)
}
