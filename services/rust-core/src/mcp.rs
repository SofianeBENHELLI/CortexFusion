//! Contract-driven official MCP SDK transport, dispatching only native Rust operations.
use crate::{
    auth::Authenticator,
    confirmation::{ConfirmationVerifier, ConfirmedAction},
    database::Database,
    error::CoreError,
};
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
use std::{collections::BTreeMap, sync::Arc};
use tower::ServiceExt;
use uuid::Uuid;

pub const NATIVE: &[&str] = &[
    "api_system_health",
    "api_system_ready",
    "api_identity_read",
    "api_feedback_preferences",
    "api_feedback_configure",
    "api_feedback_record_signal",
    "api_feedback_signals",
    "api_feedback_summary",
    "api_responses_create",
    "api_responses_read",
    "api_responses_list",
    "api_conversations_create",
    "api_conversations_list",
    "api_conversations_read",
    "api_conversations_update",
    "api_conversations_messages",
    "api_conversations_query",
    "api_conversations_timeline",
    "api_knowledge_query",
    "api_episodes_list",
    "api_episodes_read",
    "api_episodes_feedback",
    "api_domain_version",
    "api_concepts_list",
    "api_concepts_read",
    "api_proposals_publish",
    "api_proposals_create",
    "api_proposals_diff",
    "api_proposals_list",
    "api_proposals_read",
    "api_proposals_approve",
    "api_proposals_review",
    "api_proposals_reviews",
    "api_sources_create",
    "api_sources_list",
    "api_sources_read",
    "api_sources_chunks",
];
struct Operation {
    tool: Tool,
    schema: jsonschema::Validator,
    method: http::Method,
    path: String,
    action: String,
    sensitive: bool,
}
#[derive(Clone)]
struct NativeMcp {
    http: Router,
    operations: Arc<BTreeMap<String, Operation>>,
    auth: Authenticator,
    db: Database,
    confirmation: Option<ConfirmationVerifier>,
}
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Arguments do not match the tool contract",
        status: http::StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn request_for(
    operation: &Operation,
    arguments: &Value,
    headers: &http::HeaderMap,
) -> Result<http::Request<Body>, CoreError> {
    if !operation.schema.is_valid(arguments) {
        return Err(invalid());
    }
    let mut path = operation.path.clone();
    if let Some(params) = arguments["path"].as_object() {
        for (key, value) in params {
            let value = value
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| value.to_string());
            // A path argument is always one segment, irrespective of future schema changes.
            if value.contains('/')
                || value.contains('\\')
                || value == "."
                || value == ".."
                || value.contains('?')
                || value.contains('#')
                || value.contains('%')
            {
                return Err(invalid());
            }
            path = path.replace(&format!("{{{key}}}"), &value);
        }
    }
    let mut url = reqwest::Url::parse(&format!("http://localhost{path}")).map_err(|_| invalid())?;
    if let Some(params) = arguments["query"].as_object() {
        for (key, value) in params {
            url.query_pairs_mut().append_pair(
                key,
                &value.as_str().map(str::to_owned).unwrap_or_else(|| {
                    if value.is_null() {
                        "None".into()
                    } else {
                        value.to_string()
                    }
                }),
            );
        }
    }
    let uri = if let Some(query) = url.query() {
        format!("{}?{query}", url.path())
    } else {
        url.path().into()
    };
    let body = if let Some(body) = arguments.get("body") {
        Body::from(serde_json::to_vec(body).map_err(|_| invalid())?)
    } else {
        Body::empty()
    };
    let mut request = http::Request::builder()
        .method(operation.method.clone())
        .uri(uri)
        .body(body)
        .map_err(|_| invalid())?;
    *request.headers_mut() = headers.clone();
    request.headers_mut().remove("content-length");
    request.headers_mut().remove("transfer-encoding");
    if arguments.get("body").is_some() {
        request.headers_mut().insert(
            "content-type",
            http::HeaderValue::from_static("application/json"),
        );
    }
    if let Some(params) = arguments["header"].as_object() {
        for (key, value) in params {
            // Identity and confirmation can only come from the transport.
            if [
                "authorization",
                "x-tenant-id",
                "x-cortex-confirmation",
                "host",
                "origin",
            ]
            .contains(&key.to_ascii_lowercase().as_str())
            {
                return Err(invalid());
            }
            request.headers_mut().insert(
                http::HeaderName::from_bytes(key.as_bytes()).map_err(|_| invalid())?,
                http::HeaderValue::from_str(value.as_str().ok_or_else(invalid)?)
                    .map_err(|_| invalid())?,
            );
        }
    }
    request.headers_mut().insert(
        http::header::ACCEPT,
        http::HeaderValue::from_static("application/json"),
    );
    Ok(request)
}
fn failure(error: CoreError, confirmation: Option<Value>) -> CallToolResponse {
    let mut value = json!({"http_status":error.status.as_u16(),"data":{"error":error.code,"message":error.message}});
    if let Some(request) = confirmation {
        value["confirmation_request"] = request;
    }
    CallToolResult::structured_error(value).into()
}
impl ServerHandler for NativeMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build()).with_instructions("CortexFusion native Rust migration candidate. Only listed operations are implemented. Sensitive actions require a trusted-host signed confirmation. Knowledge is subject to current source permissions.")
    }
    async fn list_tools(
        &self,
        request: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        if request.is_some_and(|r| r.cursor.is_some()) {
            return Err(ErrorData::invalid_params("Unknown cursor", None));
        }
        Ok(ListToolsResult {
            tools: NATIVE
                .iter()
                .map(|name| self.operations[*name].tool.clone())
                .collect(),
            ..Default::default()
        })
    }
    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.operations.get(name).map(|op| op.tool.clone())
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let Some(operation) = self.operations.get(request.name.as_ref()) else {
            return Ok(failure(
                CoreError {
                    code: "UNKNOWN_TOOL",
                    message: "Unknown action",
                    status: http::StatusCode::NOT_FOUND,
                },
                None,
            ));
        };
        let arguments = Value::Object(request.arguments.unwrap_or_default());
        let parts = context
            .extensions
            .get::<http::request::Parts>()
            .ok_or_else(|| ErrorData::internal_error("Missing HTTP identity context", None))?;
        let mut native = match request_for(operation, &arguments, &parts.headers) {
            Ok(r) => r,
            Err(e) => return Ok(failure(e, None)),
        };
        if operation.sensitive {
            let result: Result<crate::auth::Principal, CoreError> = async {
                let p = self.auth.authenticate(&parts.headers)?;
                let domain =
                    Uuid::parse_str(arguments["path"]["domain"].as_str().ok_or_else(invalid)?)
                        .map_err(|_| invalid())?
                        .to_string();
                let tx = crate::confirmation::authorize(&self.db, &p, &domain, &operation.action)
                    .await?;
                tx.commit().await.map_err(CoreError::sql)?;
                if parts
                    .headers
                    .get_all("x-cortex-confirmation")
                    .iter()
                    .count()
                    > 1
                {
                    return Err(invalid());
                }
                self.confirmation
                    .as_ref()
                    .ok_or_else(crate::confirmation::required)?
                    .consume(
                        &p,
                        &domain,
                        &operation.action,
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
                    let confirmation = if e.code == "CONFIRMATION_REQUIRED" {
                        Some(
                            json!({"action":operation.action,"command_hash":crate::confirmation::command_hash(&operation.action,&arguments).map_err(|_|ErrorData::internal_error("Invalid command",None))?,"transport_header":"X-Cortex-Confirmation","max_lifetime_seconds":300}),
                        )
                    } else {
                        None
                    };
                    return Ok(failure(e, confirmation));
                }
            };
            native.extensions_mut().insert(ConfirmedAction {
                subject: p.subject,
                tenant: p.tenant,
                action: operation.action.clone(),
            });
        }
        let response = self
            .http
            .clone()
            .oneshot(native)
            .await
            .map_err(|_| ErrorData::internal_error("Native operation unavailable", None))?;
        let status = response.status().as_u16();
        let bytes = to_bytes(response.into_body(), 4_000_000)
            .await
            .map_err(|_| ErrorData::internal_error("Native response exceeded bound", None))?;
        let mut data: Value = serde_json::from_slice(&bytes)
            .map_err(|_| ErrorData::internal_error("Invalid native response", None))?;
        let confirmation = data
            .as_object_mut()
            .and_then(|v| v.remove("confirmation_request"));
        let mut value = json!({"http_status":status,"data":data});
        if let Some(request) = confirmation {
            value["confirmation_request"] = request;
        }
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
    if request.headers().contains_key("origin") {
        return (http::StatusCode::FORBIDDEN, "Origin is not enabled").into_response();
    }
    next.run(request).await
}
fn operations() -> Result<BTreeMap<String, Operation>, CoreError> {
    let tools: Value =
        serde_json::from_str(include_str!("../../../packages/contracts/mcp-tools.json"))
            .map_err(|_| CoreError::database())?;
    let catalog: Value = serde_json::from_str(include_str!(
        "../../../packages/contracts/interactions.json"
    ))
    .map_err(|_| CoreError::database())?;
    let mut result = BTreeMap::new();
    for name in NATIVE {
        let raw = tools["tools"]
            .as_array()
            .ok_or_else(CoreError::database)?
            .iter()
            .find(|t| t["name"] == *name)
            .ok_or_else(CoreError::database)?;
        let meta = catalog["items"]
            .as_array()
            .ok_or_else(CoreError::database)?
            .iter()
            .find(|m| {
                m["action_id"]
                    .as_str()
                    .is_some_and(|action| format!("api_{}", action.replace('.', "_")) == *name)
            })
            .ok_or_else(CoreError::database)?;
        let tool: Tool = serde_json::from_value(raw.clone()).map_err(|_| CoreError::database())?;
        let schema = jsonschema::options()
            .should_validate_formats(true)
            .with_format("uuid", |value: &str| Uuid::parse_str(value).is_ok())
            .build(&raw["inputSchema"])
            .map_err(|_| CoreError::database())?;
        let method = http::Method::from_bytes(
            meta["method"]
                .as_str()
                .ok_or_else(CoreError::database)?
                .as_bytes(),
        )
        .map_err(|_| CoreError::database())?;
        result.insert(
            (*name).into(),
            Operation {
                tool,
                schema,
                method,
                path: meta["path"]
                    .as_str()
                    .ok_or_else(CoreError::database)?
                    .into(),
                action: meta["action_id"]
                    .as_str()
                    .ok_or_else(CoreError::database)?
                    .into(),
                sensitive: meta["confirmation_policy"] == "explicit_user_decision",
            },
        );
    }
    Ok(result)
}
pub fn mount(
    http: Router,
    auth: Authenticator,
    confirmation: Option<ConfirmationVerifier>,
    db: Database,
) -> Result<Router, CoreError> {
    let handler = NativeMcp {
        http: http.clone(),
        operations: Arc::new(operations()?),
        auth: auth.clone(),
        db,
        confirmation,
    };
    let config = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true)
        .with_max_request_body_bytes(1_000_000);
    let service = StreamableHttpService::new(
        move || Ok(handler.clone()),
        LocalSessionManager::default().into(),
        config,
    );
    Ok(http.merge(
        Router::new()
            .nest_service("/mcp", service)
            .layer(middleware::from_fn_with_state(auth, authenticate)),
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn contract_driven_routes_reject_forged_identity_and_traversal() {
        let operations = operations().unwrap();
        let headers = http::HeaderMap::new();
        assert!(
            request_for(
                &operations["api_identity_read"],
                &json!({"role":"owner"}),
                &headers
            )
            .is_err()
        );
        assert!(
            request_for(
                &operations["api_concepts_list"],
                &json!({"path":{"domain":"../admin"}}),
                &headers
            )
            .is_err()
        );
        let args = json!({"path":{"domain":Uuid::nil(),"proposal_id":Uuid::nil()},"body":{"expected_published_version":0}});
        let request = request_for(&operations["api_proposals_publish"], &args, &headers).unwrap();
        assert_eq!(request.method(), http::Method::POST);
        assert!(request.uri().path().ends_with("/publish"));
    }
}
