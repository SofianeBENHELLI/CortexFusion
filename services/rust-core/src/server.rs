//! Initial native routes. Unsupported operations are explicit during migration.
use crate::{auth::Authenticator, database::Database, error::CoreError};
use axum::{
    Json, Router,
    extract::{Path, State},
    routing::get,
};
use http::{HeaderMap, StatusCode};
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

#[derive(Clone)]
pub struct StateData {
    pub auth: Authenticator,
    pub db: Database,
    pub graph: Option<crate::graph::GraphService>,
}

pub fn router(state: StateData) -> Router {
    Router::new().route("/health",get(||async{Json(json!({"status":"ok","version":"0.1.0","mode":"extractive"}))}))
        .route("/v1/me",get(identity))
        .route("/v1/domains/{domain}/version",get(version))
        .route("/v1/domains/{domain}/concepts",get(concepts))
        .route("/v1/domains/{domain}/concepts/{concept_id}",get(concept))
        .fallback(||async{(StatusCode::NOT_IMPLEMENTED,Json(json!({"error":"MIGRATION_NOT_IMPLEMENTED","message":"This operation is not yet served by the native Rust candidate"})))})
        .with_state(state)
}
async fn version(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = Uuid::parse_str(&domain)
        .map_err(|_| CoreError {
            code: "VALIDATION_FAILED",
            message: "Invalid domain UUID",
            status: StatusCode::UNPROCESSABLE_ENTITY,
        })?
        .to_string();
    let mut tx = s.db.transaction(&p, &domain, false).await?;
    let row = sqlx::query(
        "SELECT accepted_version,published_version FROM cf_domains WHERE tenant_id=$1 AND id=$2",
    )
    .bind(&p.tenant)
    .bind(&domain)
    .fetch_optional(&mut *tx)
    .await
    .map_err(CoreError::sql)?
    .ok_or_else(CoreError::not_found)?;
    let data = json!({"domain_id":domain,"accepted_version":row.get::<i64,_>("accepted_version"),"published_version":row.get::<i64,_>("published_version")});
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(data))
}
async fn identity(
    State(s): State<StateData>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let mut tx = s.db.pool.begin().await.map_err(CoreError::sql)?;
    sqlx::query("SELECT set_config('cortex.tenant',$1,true)")
        .bind(&p.tenant)
        .execute(&mut *tx)
        .await
        .map_err(CoreError::sql)?;
    let rows=sqlx::query("SELECT d.id,d.name,m.role FROM cf_domains d JOIN cf_memberships m ON m.tenant_id=d.tenant_id AND m.domain_id=d.id WHERE d.tenant_id=$1 AND m.subject=$2 ORDER BY d.id").bind(&p.tenant).bind(&p.subject).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let mut domains = Vec::new();
    for row in rows {
        let role: String = row.get("role");
        // Candidate only advertises implemented capabilities; no model provider.
        let capabilities: Vec<&str> = vec!["inspect"];
        domains.push(json!({"id":row.get::<String,_>("id"),"name":row.get::<String,_>("name"),"role":role,"capabilities":capabilities}));
    }
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(
        json!({"subject":p.subject,"tenant_id":p.tenant,"domains":domains,"extraction_provider":null}),
    ))
}

async fn concepts(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = Uuid::parse_str(&domain)
        .map_err(|_| CoreError::invalid_uuid())?
        .to_string();
    let graph = s.graph.as_ref().ok_or_else(CoreError::database)?;
    Ok(Json(
        serde_json::to_value(graph.concepts(&p, &domain).await?)
            .map_err(|_| CoreError::database())?,
    ))
}
async fn concept(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = Uuid::parse_str(&domain)
        .map_err(|_| CoreError::invalid_uuid())?
        .to_string();
    let id = Uuid::parse_str(&id).map_err(|_| CoreError::invalid_uuid())?;
    let graph = s.graph.as_ref().ok_or_else(CoreError::database)?;
    let c = graph
        .concepts(&p, &domain)
        .await?
        .into_iter()
        .find(|c| c.concept_id == id)
        .ok_or_else(CoreError::concept_not_found)?;
    Ok(Json(
        serde_json::to_value(c).map_err(|_| CoreError::database())?,
    ))
}
