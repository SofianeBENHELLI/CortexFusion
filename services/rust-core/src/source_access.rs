//! Signed source ACL replacement; published graph and personal receipts recheck these rights.
use crate::{error::CoreError, server::StateData};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::{IntoResponse, Response},
    routing::{get, put},
};
use http::{HeaderMap, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Invalid source access arguments",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    allowed_subjects: Vec<String>,
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route(
            "/v1/domains/{domain}/sources/{source_id}/access",
            put(change),
        )
        .route(
            "/v1/domains/{domain}/sources/{source_id}/access-events",
            get(history),
        )
}
fn twenty() -> usize {
    20
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Page {
    #[serde(default = "twenty")]
    limit: usize,
    after: Option<Uuid>,
}
async fn history(
    State(s): State<StateData>,
    Path((domain, source)): Path<(String, String)>,
    headers: HeaderMap,
    query: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = Uuid::parse_str(&domain)
        .map_err(|_| CoreError::invalid_uuid())?
        .to_string();
    let source = Uuid::parse_str(&source)
        .map_err(|_| CoreError::invalid_uuid())?
        .to_string();
    let Query(page) = query.map_err(|_| invalid())?;
    if !(1..=100).contains(&page.limit) {
        return Err(invalid());
    }
    let mut tx = s.db.locked_owner_transaction(&p, &domain).await?;
    let acl: Value = sqlx::query_scalar("SELECT allowed_subjects FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND allowed_subjects ? $4 FOR SHARE")
        .bind(&p.tenant).bind(&domain).bind(&source).bind(&p.subject).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
    let ordinal: i64 = if let Some(after) = page.after {
        sqlx::query_scalar("SELECT ordinal FROM cf_source_access_events WHERE tenant_id=$1 AND domain_id=$2 AND source_id=$3 AND id=$4")
            .bind(&p.tenant).bind(&domain).bind(&source).bind(after.to_string()).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?
    } else {
        0
    };
    let rows = sqlx::query("SELECT id,actor,actor_source,previous_allowed_subjects,allowed_subjects,to_jsonb(created_at) AS created FROM cf_source_access_events WHERE tenant_id=$1 AND domain_id=$2 AND source_id=$3 AND ordinal>$4 ORDER BY ordinal LIMIT $5")
        .bind(&p.tenant).bind(&domain).bind(&source).bind(ordinal).bind((page.limit+1) as i64).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let next = if rows.len() > page.limit {
        json!(rows[page.limit - 1].get::<String, _>("id"))
    } else {
        Value::Null
    };
    let items: Vec<Value> = rows
        .iter()
        .take(page.limit)
        .map(|r| {
            json!({
                "id":r.get::<String,_>("id"),
                "actor":r.get::<Option<String>,_>("actor"),
                "actor_source":r.get::<String,_>("actor_source"),
                "previous_allowed_subjects":r.get::<Value,_>("previous_allowed_subjects"),
                "allowed_subjects":r.get::<Value,_>("allowed_subjects"),
                "created_at":r.get::<Value,_>("created"),
            })
        })
        .collect();
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    Ok(Json(
        json!({"source_id":source,"current_allowed_subjects":acl,"history_scope":"changes_since_audit_migration","items":items,"next_after":next}),
    ))
}
async fn change(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
    axum::extract::RawQuery(query): axum::extract::RawQuery,
    proof: Option<axum::Extension<crate::confirmation::ConfirmedAction>>,
    body: axum::body::Bytes,
) -> Response {
    let action = "sources.access";
    let raw = serde_json::from_slice::<Value>(&body);
    let args =
        json!({"path":{"domain":d,"source_id":id},"body":raw.as_ref().unwrap_or(&Value::Null)});
    let result:Result<Value,CoreError>=async{let p=s.auth.authenticate(&h)?;let d=Uuid::parse_str(&d).map_err(|_|CoreError::invalid_uuid())?.to_string();let id=Uuid::parse_str(&id).map_err(|_|CoreError::invalid_uuid())?.to_string();let input:Input=serde_json::from_value(raw.map_err(|_|invalid())?).map_err(|_|invalid())?;if query.is_some_and(|q|!q.is_empty())||!(1..=100).contains(&input.allowed_subjects.len()){return Err(invalid())}
 let tx=s.db.locked_owner_transaction(&p,&d).await?;tx.commit().await.map_err(CoreError::sql)?;
 if !proof.as_ref().is_some_and(|v|v.subject==p.subject&&v.tenant==p.tenant&&v.action==action){if h.get_all("x-cortex-confirmation").iter().count()>1{return Err(invalid())}s.confirmation.as_ref().ok_or_else(crate::confirmation::required)?.consume(&p,&d,action,&args,h.get("x-cortex-confirmation").and_then(|v|v.to_str().ok())).await?;}
 let mut tx=s.db.locked_owner_transaction(&p,&d).await?;
 let source=sqlx::query("SELECT allowed_subjects FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 FOR UPDATE").bind(&p.tenant).bind(&d).bind(&id).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;let old:Vec<String>=serde_json::from_value(source.get("allowed_subjects")).map_err(|_|CoreError::database())?;if !old.contains(&p.subject){return Err(CoreError::not_found())}
 let members:Vec<String>=sqlx::query_scalar("SELECT subject FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 FOR SHARE").bind(&p.tenant).bind(&d).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;let acl=input.allowed_subjects.into_iter().collect::<std::collections::BTreeSet<_>>();if !acl.iter().all(|s|members.contains(s)){return Err(invalid())}
 sqlx::query("SELECT set_config('cortex.source_access_actor',$1,true)").bind(&p.subject).execute(&mut *tx).await.map_err(CoreError::sql)?;
 sqlx::query("UPDATE cf_sources SET allowed_subjects=$1 WHERE tenant_id=$2 AND domain_id=$3 AND id=$4").bind(json!(acl)).bind(&p.tenant).bind(&d).bind(&id).execute(&mut *tx).await.map_err(CoreError::sql)?;sqlx::query("UPDATE cf_domains SET accepted_version=accepted_version WHERE tenant_id=$1 AND id=$2").bind(&p.tenant).bind(&d).execute(&mut *tx).await.map_err(CoreError::sql)?;p.check_fresh()?;tx.commit().await.map_err(CoreError::sql)?;Ok(json!({"source_id":id,"allowed_subjects":acl}))}.await;
    match result{Ok(v)=>Json(v).into_response(),Err(e)if e.code=="CONFIRMATION_REQUIRED"=>(e.status,Json(json!({"error":e.code,"message":e.message,"confirmation_request":{"action":action,"command_hash":crate::confirmation::command_hash(action,&args).unwrap_or_default(),"transport_header":"X-Cortex-Confirmation","max_lifetime_seconds":300}}))).into_response(),Err(e)=>e.into_response()}
}
