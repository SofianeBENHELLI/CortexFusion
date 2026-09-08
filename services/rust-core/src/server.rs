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
    pub model_daily_limit: i64,
    pub db: Database,
    pub graph: Option<crate::graph::GraphService>,
    pub confirmation: Option<crate::confirmation::ConfirmationVerifier>,
}

pub fn router(state: StateData) -> Router {
    Router::new().route("/health",get(||async{Json(json!({"status":"ok","version":"0.1.0","mode":"extractive"}))}))
        .route("/ready",get(crate::readiness::ready))
        .route("/v1/me",get(identity))
        .route("/v1/domains/{domain}/version",get(version))
        .route("/v1/domains/{domain}/concepts",get(concepts))
        .route("/v1/domains/{domain}/concepts/{concept_id}",get(concept))
        .route("/v1/domains/{domain}/proposals/{proposal_id}/publish",axum::routing::post(publish_target))
        .merge(crate::sources::routes())
        .merge(crate::proposals::routes())
        .merge(crate::retrieval::routes())
        .merge(crate::signals::routes())
        .merge(crate::companions::routes())
        .merge(crate::conversations::routes())
        .merge(crate::issues::routes())
        .merge(crate::collections::routes())
        .merge(crate::imports::routes())
        .merge(crate::governance::routes())
        .merge(crate::source_access::routes())
        .merge(crate::discovery::routes())
        .merge(crate::model_receipts::routes())
        .merge(crate::maintenance::routes())
        .merge(crate::files::routes())
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
        let mut capabilities = vec![
            "query",
            "inspect",
            "personal_history",
            "feedback",
            "personal_issues",
        ];
        if matches!(
            role.as_str(),
            "owner" | "agent" | "contributor" | "corpus_manager"
        ) {
            capabilities.extend(["propose", "read_proposals"]);
        }
        if matches!(role.as_str(), "owner" | "corpus_manager") {
            capabilities.push("manage_corpus");
        }
        if role == "owner" && s.confirmation.is_some() {
            capabilities.extend(["review", "approve", "manage_members", "source_acl"]);
            if s.graph.is_some() {
                capabilities.extend(["publish", "compensate"]);
            }
        }
        domains.push(json!({"id":row.get::<String,_>("id"),"name":row.get::<String,_>("name"),"role":role,"capabilities":capabilities}));
    }
    p.check_fresh()?;
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

async fn publish_target(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
    axum::extract::RawQuery(query): axum::extract::RawQuery,
    proof: Option<axum::Extension<crate::confirmation::ConfirmedAction>>,
    body: axum::body::Bytes,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let action = "proposals.publish";
    let body_json = serde_json::from_slice::<Value>(&body);
    let arguments = json!({"path":{"domain":domain,"proposal_id":id},"body":body_json.as_ref().unwrap_or(&Value::Null)});
    let outcome: Result<Value, CoreError> = async {
        let p = s.auth.authenticate(&headers)?;
        let domain = Uuid::parse_str(&domain)
            .map_err(|_| CoreError::invalid_uuid())?
            .to_string();
        let id = Uuid::parse_str(&id)
            .map_err(|_| CoreError::invalid_uuid())?
            .to_string();
        let invalid = || CoreError {
            code: "VALIDATION_FAILED",
            message: "Arguments do not match the action contract",
            status: StatusCode::UNPROCESSABLE_ENTITY,
        };
        let data = body_json.map_err(|_| invalid())?;
        if query.is_some_and(|q| !q.is_empty()) || data.as_object().is_none_or(|o| o.len() != 1) {
            return Err(invalid());
        }
        let expected = data["expected_published_version"]
            .as_i64()
            .or_else(|| {
                data["expected_published_version"]
                    .as_f64()
                    .filter(|n| n.fract() == 0.0 && *n >= 0.0 && *n < 9223372036854775808.0)
                    .map(|n| n as i64)
            })
            .filter(|n| *n >= 0)
            .ok_or_else(invalid)?;
        let tx = s.db.locked_owner_transaction(&p, &domain).await?;
        tx.commit().await.map_err(CoreError::sql)?;
        let confirmed = proof
            .as_ref()
            .is_some_and(|x| x.subject == p.subject && x.tenant == p.tenant && x.action == action);
        if !confirmed {
            if headers.get_all("x-cortex-confirmation").iter().count() > 1 {
                return Err(invalid());
            }
            let token = headers
                .get("x-cortex-confirmation")
                .and_then(|h| h.to_str().ok());
            s.confirmation
                .as_ref()
                .ok_or_else(crate::confirmation::required)?
                .consume(&p, &domain, action, &arguments, token)
                .await?;
        }
        s.graph
            .as_ref()
            .ok_or_else(CoreError::database)?
            .publish_target(&p, &domain, &id, expected)
            .await
    }
    .await;
    match outcome {
        Ok(data) => Json(data).into_response(),
        Err(error) if error.code == "CONFIRMATION_REQUIRED" => {
            let hash = crate::confirmation::command_hash(action, &arguments).unwrap_or_default();
            (error.status,Json(json!({"error":error.code,"message":error.message,"confirmation_request":{"action":action,"command_hash":hash,"transport_header":"X-Cortex-Confirmation","max_lifetime_seconds":300}}))).into_response()
        }
        Err(error) => error.into_response(),
    }
}
