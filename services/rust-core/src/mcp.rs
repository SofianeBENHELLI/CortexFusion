//! Official SDK transport invoking native Rust routes in-process, without Python.
use crate::{auth::Authenticator, error::CoreError};
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    middleware::{self, Next},
    response::{IntoResponse, Response},
};
use rmcp::{
    ErrorData, RoleServer, ServerHandler,
    model::*,
    service::RequestContext,
    transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
    },
};
use serde_json::{Value, json};
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

const NATIVE: &[&str] = &[
    "api_system_health",
    "api_identity_read",
    "api_domain_version",
    "api_concepts_list",
    "api_concepts_read",
    "api_proposals_publish",
];
#[derive(Clone)]
struct NativeMcp {
    http: Router,
    tools: Arc<Vec<Tool>>,
    auth: Authenticator,
    db: crate::database::Database,
    confirmation: Option<crate::confirmation::ConfirmationVerifier>,
}
fn argument_error() -> ErrorData {
    ErrorData::invalid_params(
        "Arguments must match the advertised native tool schema",
        None,
    )
}
fn route(name: &str, args: Value) -> Result<String, ErrorData> {
    let object = args.as_object().ok_or_else(argument_error)?;
    if name == "api_proposals_publish" {
        if object.len() != 2 {
            return Err(argument_error());
        }
        let path = args["path"].as_object().ok_or_else(argument_error)?;
        let body = args["body"].as_object().ok_or_else(argument_error)?;
        if path.len() != 2 || body.len() != 1 {
            return Err(argument_error());
        }
        let domain = Uuid::parse_str(
            path.get("domain")
                .and_then(Value::as_str)
                .ok_or_else(argument_error)?,
        )
        .map_err(|_| argument_error())?;
        let id = Uuid::parse_str(
            path.get("proposal_id")
                .and_then(Value::as_str)
                .ok_or_else(argument_error)?,
        )
        .map_err(|_| argument_error())?;
        let expected = body
            .get("expected_published_version")
            .and_then(Value::as_f64)
            .filter(|v| v.fract() == 0.0 && *v >= 0.0 && *v < 9223372036854775808.0)
            .ok_or_else(argument_error)?;
        let _ = expected;
        return Ok(format!("/v1/domains/{domain}/proposals/{id}/publish"));
    }
    if matches!(name, "api_system_health" | "api_identity_read") {
        if !object.is_empty() {
            return Err(argument_error());
        }
        return Ok(if name == "api_system_health" {
            "/health"
        } else {
            "/v1/me"
        }
        .into());
    }
    if !NATIVE.contains(&name) {
        return Err(ErrorData::invalid_params(
            "Tool is not implemented by the native Rust candidate",
            None,
        ));
    }
    if object.len() != 1 {
        return Err(argument_error());
    }
    let path = args["path"].as_object().ok_or_else(argument_error)?;
    let expected = if name == "api_concepts_read" { 2 } else { 1 };
    if path.len() != expected
        || path
            .keys()
            .any(|k| k != "domain" && !(name == "api_concepts_read" && k == "concept_id"))
    {
        return Err(argument_error());
    }
    let domain = Uuid::parse_str(path["domain"].as_str().ok_or_else(argument_error)?)
        .map_err(|_| argument_error())?;
    Ok(match name {
        "api_domain_version" => format!("/v1/domains/{domain}/version"),
        "api_concepts_list" => format!("/v1/domains/{domain}/concepts"),
        "api_concepts_read" => {
            let id = Uuid::parse_str(path["concept_id"].as_str().ok_or_else(argument_error)?)
                .map_err(|_| argument_error())?;
            format!("/v1/domains/{domain}/concepts/{id}")
        }
        _ => return Err(argument_error()),
    })
}
impl ServerHandler for NativeMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions("CortexFusion native Rust migration candidate. Only listed operations are implemented; Publication requires a trusted-host signed confirmation. Knowledge remains subject to current source access.")
    }
    async fn list_tools(
        &self,
        request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        if request.is_some_and(|r| r.cursor.is_some()) {
            return Err(argument_error());
        }
        Ok(ListToolsResult {
            tools: (*self.tools).clone(),
            ..Default::default()
        })
    }
    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.tools.iter().find(|t| t.name == name).cloned()
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let arguments = Value::Object(request.arguments.unwrap_or_default());
        let path = route(&request.name, arguments.clone())?;
        let parts = context
            .extensions
            .get::<http::request::Parts>()
            .ok_or_else(|| ErrorData::internal_error("Missing HTTP identity context", None))?;
        let mut http_request = http::Request::builder()
            .uri(path)
            .body(Body::empty())
            .map_err(|_| argument_error())?;
        *http_request.headers_mut() = parts.headers.clone();
        if request.name == "api_proposals_publish" {
            let action = "proposals.publish";
            let result: Result<crate::auth::Principal, CoreError> = async {
                let p = self.auth.authenticate(&parts.headers)?;
                let domain = Uuid::parse_str(
                    arguments["path"]["domain"]
                        .as_str()
                        .ok_or_else(CoreError::invalid_uuid)?,
                )
                .map_err(|_| CoreError::invalid_uuid())?
                .to_string();
                if parts
                    .headers
                    .get_all("x-cortex-confirmation")
                    .iter()
                    .count()
                    > 1
                {
                    return Err(CoreError::auth());
                }
                let tx = self.db.locked_owner_transaction(&p, &domain).await?;
                tx.commit().await.map_err(CoreError::sql)?;
                let verifier = self
                    .confirmation
                    .as_ref()
                    .ok_or_else(crate::confirmation::required)?;
                verifier
                    .consume(
                        &p,
                        &domain,
                        action,
                        &arguments,
                        parts
                            .headers
                            .get("x-cortex-confirmation")
                            .and_then(|h| h.to_str().ok()),
                    )
                    .await?;
                Ok(p)
            }
            .await;
            let p = match result {
                Ok(p) => p,
                Err(e) => {
                    let mut value = json!({"http_status":e.status.as_u16(),"data":{"error":e.code,"message":e.message}});
                    if e.code == "CONFIRMATION_REQUIRED" {
                        value["confirmation_request"] = json!({"action":action,"command_hash":crate::confirmation::command_hash(action,&arguments).map_err(|_|argument_error())?,"transport_header":"X-Cortex-Confirmation","max_lifetime_seconds":300});
                    }
                    return Ok(CallToolResult::structured_error(value).into());
                }
            };
            *http_request.method_mut() = http::Method::POST;
            *http_request.body_mut() =
                Body::from(serde_json::to_vec(&arguments["body"]).map_err(|_| argument_error())?);
            http_request
                .extensions_mut()
                .insert(crate::confirmation::ConfirmedAction {
                    subject: p.subject,
                    tenant: p.tenant,
                    action,
                });
        }
        let response = self
            .http
            .clone()
            .oneshot(http_request)
            .await
            .map_err(|_| ErrorData::internal_error("Native operation unavailable", None))?;
        let status = response.status().as_u16();
        let bytes = to_bytes(response.into_body(), 4_000_000)
            .await
            .map_err(|_| ErrorData::internal_error("Native response exceeded bound", None))?;
        let data: Value = serde_json::from_slice(&bytes)
            .map_err(|_| ErrorData::internal_error("Invalid native response", None))?;
        let value = json!({"http_status":status,"data":data});
        Ok(if status >= 400 {
            CallToolResult::structured_error(value)
        } else {
            CallToolResult::structured(value)
        }
        .into())
    }
}
async fn authenticate(State(auth): State<Authenticator>, request: Request, next: Next) -> Response {
    if let Err(error) = auth.authenticate(request.headers()) {
        return error.into_response();
    }
    // Local candidate has no browser origins enabled. Native clients omit Origin.
    if request.headers().contains_key("origin") {
        return (http::StatusCode::FORBIDDEN, "Origin is not enabled").into_response();
    }
    next.run(request).await
}
pub fn mount(
    http: Router,
    auth: Authenticator,
    confirmation: Option<crate::confirmation::ConfirmationVerifier>,
    db: crate::database::Database,
) -> Result<Router, CoreError> {
    let value: Value =
        serde_json::from_str(include_str!("../../../packages/contracts/mcp-tools.json"))
            .map_err(|_| CoreError::database())?;
    let tools: Vec<Tool> = value["tools"]
        .as_array()
        .ok_or_else(CoreError::database)?
        .iter()
        .filter(|t| t["name"].as_str().is_some_and(|n| NATIVE.contains(&n)))
        .cloned()
        .map(|t| serde_json::from_value(t).map_err(|_| CoreError::database()))
        .collect::<Result<_, _>>()?;
    if tools.len() != NATIVE.len() {
        return Err(CoreError::database());
    }
    let handler = NativeMcp {
        http: http.clone(),
        tools: Arc::new(tools),
        auth: auth.clone(),
        db,
        confirmation,
    };
    let config = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true)
        .with_max_request_body_bytes(64_000);
    let service = StreamableHttpService::new(
        move || Ok(handler.clone()),
        LocalSessionManager::default().into(),
        config,
    );
    let mcp = Router::new()
        .nest_service("/mcp", service)
        .layer(middleware::from_fn_with_state(auth, authenticate));
    Ok(http.merge(mcp))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_routes_do_not_accept_role_or_path_injection() {
        assert!(route("api_identity_read", json!({"role":"owner"})).is_err());
        assert!(
            route(
                "api_concepts_read",
                json!({"path":{"domain":"../admin","concept_id":Uuid::nil()}})
            )
            .is_err()
        );
        assert!(
            route(
                "api_concepts_list",
                json!({"path":{"domain":Uuid::nil()},"tenant":"forged"})
            )
            .is_err()
        );
        assert!(route("api_proposals_approve", json!({})).is_err());
        assert_eq!(
            route("api_domain_version", json!({"path":{"domain":Uuid::nil()}})).unwrap(),
            format!("/v1/domains/{}/version", Uuid::nil())
        );
    }
}
