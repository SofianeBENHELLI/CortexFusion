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
use std::time::Duration;
use uuid::Uuid;

#[derive(Clone)]
pub struct StateData {
    pub auth: Authenticator,
    pub model_daily_limit: i64,
    pub synthesis: Option<crate::model_provider::OpenRouter>,
    pub extraction: Option<crate::model_provider::PassageProvider>,
    pub public_resource: Option<crate::discovery::PublicResource>,
    pub db: Database,
    /// Dedicated single-connection pool for the unauthenticated readiness probe.
    pub readiness: Database,
    pub graph: Option<crate::graph::GraphService>,
    pub confirmation: Option<crate::confirmation::ConfirmationVerifier>,
}

pub fn router(state: StateData) -> Router {
    Router::new().route("/health",get(||async{Json(json!({"status":"ok","version":"0.1.0","mode":"extractive"}))}))
        .route("/ready",get(crate::readiness::ready))
        .route("/v1/me",get(identity))
        .route("/v1/companion-guides",get(crate::onboarding::http_guides))
        .route("/v1/domains/{domain}/version",get(version))
        .route("/v1/domains/{domain}/concepts",get(concepts))
        .route("/v1/domains/{domain}/concepts/{concept_id}",get(concept))
        .route("/v1/domains/{domain}/proposals/{proposal_id}/publish",axum::routing::post(publish_target))
        .merge(crate::publication_recovery::routes())
        .merge(crate::graph_import::routes())
        .merge(crate::sources::routes())
        .merge(crate::proposals::routes())
        .merge(crate::retrieval::routes())
        .merge(crate::signals::routes())
        .merge(crate::cases::routes())
        .merge(crate::companions::routes())
        .merge(crate::conversations::routes())
        .merge(crate::drafts::routes())
        .merge(crate::contribution_drafts::routes())
        .merge(crate::reference_drafts::routes())
        .merge(crate::reference_reviews::routes())
        .merge(crate::agent_missions::routes())
        .merge(crate::tasks::routes())
        .merge(crate::work_overview::routes())
        .merge(crate::work_activity::routes())
        .merge(crate::issues::routes())
        .merge(crate::collections::routes())
        .merge(crate::imports::routes())
        .merge(crate::governance::routes())
        .merge(crate::publication_journal::routes())
        .merge(crate::graph_window::routes())
        .merge(crate::graph_map::routes())
        .merge(crate::graph_scene::routes())
        .merge(crate::source_access::routes())
        .merge(crate::discovery::routes())
        .merge(crate::model_receipts::routes())
        .merge(crate::maintenance::routes())
        .merge(crate::files::routes())
        .merge(crate::synthesis::routes())
        .merge(crate::extraction::routes())
        .fallback(||async{(StatusCode::NOT_IMPLEMENTED,Json(json!({"error":"MIGRATION_NOT_IMPLEMENTED","message":"This operation is not yet served by the native Rust candidate"})))})
        .with_state(state)
        .layer(axum::middleware::from_fn(request_deadline))
        .layer(axum::middleware::from_fn(log_failures))
}
/// Deadline for one HTTP operation, body read included. Model calls and graph
/// engine writes get longer ones. The MCP transport and streamed response bodies
/// sit outside these layers; MCP tool calls dispatch through this router and so
/// inherit their operation's deadline.
const DEFAULT_DEADLINE: Duration = Duration::from_secs(20);
const MODEL_DEADLINE: Duration = Duration::from_secs(60);
const PUBLICATION_DEADLINE: Duration = Duration::from_secs(120);
const MODEL_ROUTES: [&str; 3] = [
    "/v1/domains/{domain}/episodes/{episode_id}/syntheses",
    "/v1/domains/{domain}/sources/{source_id}/extract",
    "/v1/domains/{domain}/sources/{source_id}/extract-local",
];
const PUBLICATION_ROUTES: [&str; 7] = [
    "/v1/domains/{domain}/proposals/{proposal_id}/publish",
    "/v1/domains/{domain}/proposals/{proposal_id}/publication-attempts",
    "/v1/domains/{domain}/publish",
    "/v1/domains/{domain}/replay",
    "/v1/domains/{domain}/commits/{sequence}/compensate",
    "/v1/domains/{domain}/graph-import",
    "/v1/domains/{domain}/graph-import-attempts",
];
fn deadline(route: Option<&str>) -> Duration {
    match route {
        Some(r) if MODEL_ROUTES.contains(&r) => MODEL_DEADLINE,
        Some(r) if PUBLICATION_ROUTES.contains(&r) => PUBLICATION_DEADLINE,
        _ => DEFAULT_DEADLINE,
    }
}
/// Dropping the handler cancels its work at the next await; a command whose
/// outcome is then unknown is settled by its receipt or a same-key retry.
async fn request_deadline(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let route = request
        .extensions()
        .get::<axum::extract::MatchedPath>()
        .map(|m| m.as_str());
    match tokio::time::timeout(deadline(route), next.run(request)).await {
        Ok(response) => response,
        Err(_) => CoreError::request_timeout().into_response(),
    }
}
/// One stderr line per server-side failure (HTTP and MCP calls share this
/// router). Only method, path, status and latency: no query string, header or
/// body, and clients still receive the generic error body.
async fn log_failures(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let started = std::time::Instant::now();
    let response = next.run(request).await;
    if response.status().is_server_error() {
        eprintln!(
            "{method} {path} -> {} in {} ms",
            response.status().as_u16(),
            started.elapsed().as_millis()
        );
    }
    response
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
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    p.check_fresh()?;
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
    let rows=sqlx::query("SELECT d.id,d.name,m.role,m.roles,m.revision FROM cf_domains d JOIN cf_memberships m ON m.tenant_id=d.tenant_id AND m.domain_id=d.id WHERE d.tenant_id=$1 AND m.subject=$2 ORDER BY d.id").bind(&p.tenant).bind(&p.subject).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let mut domains = Vec::new();
    for row in rows {
        let role: String = row.get("role");
        // Advertise only capabilities available in this configured runtime.
        let mut capabilities = vec![
            "companion_guides",
            "query",
            "inspect",
            "personal_history",
            "personal_drafts",
            "feedback",
            "personal_issues",
        ];
        if s.synthesis.is_some() && s.confirmation.is_some() {
            capabilities.push("synthesize");
        }
        if matches!(
            role.as_str(),
            "owner" | "agent" | "contributor" | "corpus_manager"
        ) {
            capabilities.extend([
                "propose",
                "read_proposals",
                "contribution_drafts",
                "reference_drafts",
            ]);
        }
        if matches!(
            role.as_str(),
            "owner" | "corpus_manager" | "contributor" | "viewer"
        ) {
            capabilities.extend([
                "shared_cases",
                "case_tasks",
                "work_overview",
                "work_activity",
            ]);
        }
        if matches!(role.as_str(), "owner" | "corpus_manager" | "contributor") {
            capabilities.extend([
                "reference_reviews",
                "work_tasks",
                "expert_reviews",
                "work_brief",
                "task_receipts",
            ]);
        }
        if matches!(role.as_str(), "owner" | "corpus_manager" | "agent") {
            capabilities.push("agent_missions");
        }
        if matches!(role.as_str(), "owner" | "corpus_manager") {
            capabilities.push("coordinate_tasks");
            capabilities.push("coordinate_missions");
            capabilities.push("manage_corpus");
            capabilities.push("import_commands");
        }
        if role == "owner" && s.confirmation.is_some() {
            capabilities.extend(["review", "approve", "manage_members", "source_acl"]);
            if s.extraction.is_some() {
                capabilities.push("extract");
            }
            if s.graph.is_some() {
                capabilities.extend(["publish", "compensate"]);
            }
        }
        domains.push(json!({"id":row.get::<String,_>("id"),"name":row.get::<String,_>("name"),"role":role,"roles":row.get::<Vec<String>,_>("roles"),"membership_revision":row.get::<i32,_>("revision"),"capabilities":capabilities}));
    }
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(
        json!({"subject":p.subject,"tenant_id":p.tenant,"domains":domains,"extraction_provider":s.extraction.as_ref().map(|m|m.provider())}),
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
    Ok(Json(graph.read_concept(&p, &domain, id).await?))
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
#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, routing::post};
    use tower::ServiceExt;

    async fn call(path: &str, seconds: u64) -> (StatusCode, Value) {
        let wait = move || async move {
            tokio::time::sleep(Duration::from_secs(seconds)).await;
            Json(json!({"done": true}))
        };
        let app = Router::new()
            .route("/v1/me", post(wait))
            .route(
                "/v1/domains/{domain}/sources/{source_id}/extract",
                post(wait),
            )
            .route("/v1/domains/{domain}/publish", post(wait))
            .layer(axum::middleware::from_fn(request_deadline));
        let request = http::Request::post(path).body(Body::empty()).unwrap();
        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        (status, serde_json::from_slice(&body).unwrap())
    }

    #[tokio::test(start_paused = true)]
    async fn each_route_class_answers_until_its_deadline_then_times_out() {
        for (path, limit) in [
            ("/v1/me", 20),
            ("/v1/domains/d/sources/s/extract", 60),
            ("/v1/domains/d/publish", 120),
        ] {
            assert_eq!(call(path, limit - 1).await.0, StatusCode::OK, "{path}");
            let (status, body) = call(path, limit + 1).await;
            assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{path}");
            assert_eq!(body["error"], "REQUEST_TIMEOUT", "{path}");
        }
    }

    #[test]
    fn longer_deadlines_name_native_contract_routes() {
        let catalog = crate::discovery::catalog().unwrap();
        let paths: Vec<&str> = catalog["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|item| item["path"].as_str())
            .collect();
        for route in MODEL_ROUTES.iter().chain(&PUBLICATION_ROUTES) {
            assert!(paths.contains(route), "{route}");
        }
        assert_eq!(deadline(None), DEFAULT_DEADLINE);
    }
}
