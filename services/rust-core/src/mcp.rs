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
    "api_system_mcp_discovery",
    "api_syntheses_create",
    "api_sources_extract",
    "api_sources_extract_local",
    "api_files_upload",
    "api_files_process",
    "api_files_list",
    "api_files_read",
    "api_files_download",
    "api_files_retry",
    "api_files_cancel",
    "api_domain_publish",
    "api_domain_replay",
    "api_commits_compensate",
    "api_models_attempts",
    "api_models_attempt",
    "api_models_usage",
    "api_syntheses_read",
    "api_syntheses_list",
    "api_extractions_read",
    "api_interactions_list",
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
    "api_members_list",
    "api_members_change",
    "api_members_history",
    "api_commits_list",
    "api_domain_brief",
    "api_imports_create",
    "api_imports_list",
    "api_imports_read",
    "api_imports_process",
    "api_imports_cancel",
    "api_imports_retry",
    "api_collections_create",
    "api_collections_list",
    "api_collections_read",
    "api_issues_list",
    "api_issues_read",
    "api_issues_history",
    "api_issues_decide",
    "api_knowledge_query",
    "api_episodes_list",
    "api_episodes_read",
    "api_episodes_feedback",
    "api_domain_version",
    "api_concepts_list",
    "api_concepts_read",
    "api_proposals_publish",
    "api_graph_import_published",
    "api_graph_import_attempts",
    "api_graph_retry_import",
    "api_graph_import_events",
    "api_proposals_publication_attempts",
    "api_proposals_retry_publication",
    "api_proposals_publication_events",
    "api_proposals_create",
    "api_proposals_revise",
    "api_sources_propose",
    "api_proposals_diff",
    "api_proposals_list",
    "api_proposals_read",
    "api_proposals_approve",
    "api_proposals_review",
    "api_proposals_reviews",
    "api_sources_create",
    "api_sources_access",
    "api_sources_list",
    "api_sources_read",
    "api_sources_chunks",
];
pub const ALIASES: &[(&str, &str)] = &[
    ("query", "api_knowledge_query"),
    ("inspect_concept", "api_concepts_read"),
    ("propose", "api_proposals_create"),
    ("feedback", "api_episodes_feedback"),
    ("describe_actions", "api_interactions_list"),
    ("my_workspace", "api_identity_read"),
    ("list_sources", "api_sources_list"),
    ("read_source_chunks", "api_sources_chunks"),
    ("list_proposals", "api_proposals_list"),
    ("proposal_diff", "api_proposals_diff"),
    ("list_conversations", "api_conversations_list"),
    ("create_conversation", "api_conversations_create"),
    ("conversation_query", "api_conversations_query"),
    ("conversation_messages", "api_conversations_messages"),
    ("list_issues", "api_issues_list"),
    ("decide_issue", "api_issues_decide"),
];
fn alias_arguments(name: &str, v: &Value) -> Result<Value, CoreError> {
    let mut path = json!({});
    if let Some(d) = v.get("domain_id") {
        path["domain"] = d.clone()
    }
    let mut body = None;
    let mut query = serde_json::Map::new();
    match name {
        "query" => {
            body = Some(
                json!({"question":v["question"],"max_chars":v.get("max_chars").cloned().unwrap_or(json!(8000))}),
            )
        }
        "inspect_concept" => path["concept_id"] = v["concept_id"].clone(),
        "propose" => body = Some(v["proposal"].clone()),
        "feedback" => {
            path["episode_id"] = v["episode_id"].clone();
            body = Some(v["feedback"].clone())
        }
        "describe_actions" | "my_workspace" => {}
        "list_sources" | "list_proposals" | "list_conversations" | "list_issues" => {
            for key in ["q", "limit", "after", "archived", "status"] {
                if let Some(value) = v.get(key).filter(|v| !v.is_null()) {
                    query.insert(key.into(), value.clone());
                }
            }
        }
        "read_source_chunks" => {
            path["source_id"] = v["source_id"].clone();
            query.insert(
                "offset".into(),
                v.get("offset").cloned().unwrap_or(json!(0)),
            );
            query.insert("limit".into(), v.get("limit").cloned().unwrap_or(json!(3)));
        }
        "proposal_diff" => path["ident"] = v["proposal_id"].clone(),
        "create_conversation" => body = Some(v["conversation"].clone()),
        "conversation_query" => {
            path["ident"] = v["conversation_id"].clone();
            body = Some(v["question"].clone())
        }
        "conversation_messages" => {
            path["ident"] = v["conversation_id"].clone();
            for key in ["limit", "after"] {
                if let Some(value) = v.get(key) {
                    query.insert(key.into(), value.clone());
                }
            }
        }
        "decide_issue" => {
            path["ident"] = v["issue_id"].clone();
            body = Some(v["decision"].clone())
        }
        _ => return Err(invalid()),
    }
    let mut result = json!({});
    if !path.as_object().ok_or_else(invalid)?.is_empty() {
        result["path"] = path
    }
    if let Some(body) = body {
        result["body"] = body
    }
    if !query.is_empty() {
        result["query"] = Value::Object(query)
    }
    Ok(result)
}
struct Operation {
    tool: Tool,
    schema: jsonschema::Validator,
    method: http::Method,
    path: String,
    action: String,
    sensitive: bool,
    alias: Option<&'static str>,
}
#[derive(Clone)]
pub(crate) struct NativeMcp {
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
    let mapped = operation
        .alias
        .map(|name| alias_arguments(name, arguments))
        .transpose()?;
    let arguments = mapped.as_ref().unwrap_or(arguments);
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
                    if (operation.action.starts_with("proposals.publication_")
                        || operation.action.starts_with("graph.import_"))
                        && let Some(n) = value
                            .as_f64()
                            .filter(|n| n.fract() == 0.0 && *n >= 0.0 && *n < 9223372036854775808.0)
                    {
                        (n as i64).to_string()
                    } else if value.is_null() {
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
        ServerInfo::new(ServerCapabilities::builder().enable_tools().enable_resources().enable_prompts().build()).with_instructions("CortexFusion native Rust migration candidate. Only listed operations are implemented. Sensitive actions require a trusted-host signed confirmation. Knowledge is subject to current source permissions.")
    }
    async fn list_resources(
        &self,
        request: Option<PaginatedRequestParams>,
        ctx: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        self.context_headers(&ctx)?;
        crate::onboarding::list("resources", request)
    }
    async fn list_resource_templates(
        &self,
        request: Option<PaginatedRequestParams>,
        ctx: RequestContext<RoleServer>,
    ) -> Result<ListResourceTemplatesResult, ErrorData> {
        self.context_headers(&ctx)?;
        crate::onboarding::list("resourceTemplates", request)
    }
    async fn list_prompts(
        &self,
        request: Option<PaginatedRequestParams>,
        ctx: RequestContext<RoleServer>,
    ) -> Result<ListPromptsResult, ErrorData> {
        self.context_headers(&ctx)?;
        crate::onboarding::list("prompts", request)
    }
    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        ctx: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, ErrorData> {
        crate::onboarding::read(self, request, ctx).await
    }
    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        ctx: RequestContext<RoleServer>,
    ) -> Result<GetPromptResponse, ErrorData> {
        crate::onboarding::prompt(self, request, ctx).await
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
                .copied()
                .chain(ALIASES.iter().map(|(name, _)| *name))
                .map(|name| self.operations[name].tool.clone())
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
        let media_type = response
            .headers()
            .get(http::header::CONTENT_TYPE)
            .and_then(|x| x.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_owned();
        let bytes = to_bytes(response.into_body(), 4_000_000)
            .await
            .map_err(|_| ErrorData::internal_error("Native response exceeded bound", None))?;
        let mut data: Value = if media_type.contains("application/json") {
            serde_json::from_slice(&bytes)
                .map_err(|_| ErrorData::internal_error("Invalid native response", None))?
        } else {
            use base64::Engine;
            json!({"media_type":media_type,"base64":base64::engine::general_purpose::STANDARD.encode(&bytes)})
        };
        if operation.alias.is_some() && status < 400 {
            return Ok(CallToolResult::structured(data).into());
        }
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
async fn authenticate(
    State((auth, origins)): State<(Authenticator, crate::browser::Origins)>,
    request: Request,
    next: Next,
) -> Response {
    if request.headers().get_all(http::header::HOST).iter().count() > 1 {
        return (http::StatusCode::BAD_REQUEST, "Ambiguous MCP authority").into_response();
    }
    if let Err(error) = auth.authenticate(request.headers()) {
        return error.into_response();
    }
    if !origins.allowed(request.headers()) {
        return (http::StatusCode::FORBIDDEN, "Origin is not enabled").into_response();
    }
    next.run(request).await
}
fn operations() -> Result<BTreeMap<String, Operation>, CoreError> {
    let mut tools: Value =
        serde_json::from_str(include_str!("../../../packages/contracts/mcp-tools.json"))
            .map_err(|_| CoreError::database())?;
    let mut catalog: Value = serde_json::from_str(include_str!(
        "../../../packages/contracts/interactions.json"
    ))
    .map_err(|_| CoreError::database())?;
    let extra = crate::discovery::extensions()?;
    tools["tools"]
        .as_array_mut()
        .ok_or_else(CoreError::database)?
        .extend(
            extra["tools"]
                .as_array()
                .ok_or_else(CoreError::database)?
                .iter()
                .cloned(),
        );
    catalog["items"]
        .as_array_mut()
        .ok_or_else(CoreError::database)?
        .extend(
            extra["interactions"]
                .as_array()
                .ok_or_else(CoreError::database)?
                .iter()
                .cloned(),
        );
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
                alias: None,
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
    for (name, target) in ALIASES {
        let base = result.get(*target).ok_or_else(CoreError::database)?;
        let raw = tools["tools"]
            .as_array()
            .ok_or_else(CoreError::database)?
            .iter()
            .find(|t| t["name"] == *name)
            .ok_or_else(CoreError::database)?;
        let tool: Tool = serde_json::from_value(raw.clone()).map_err(|_| CoreError::database())?;
        let schema = jsonschema::options()
            .should_validate_formats(true)
            .with_format("uuid", |value: &str| Uuid::parse_str(value).is_ok())
            .build(&raw["inputSchema"])
            .map_err(|_| CoreError::database())?;
        let op = Operation {
            tool,
            schema,
            method: base.method.clone(),
            path: base.path.clone(),
            action: base.action.clone(),
            sensitive: base.sensitive,
            alias: Some(name),
        };
        // Historical convenience aliases never bypass a signed decision route.
        if op.sensitive {
            return Err(CoreError::database());
        }
        result.insert((*name).into(), op);
    }
    Ok(result)
}
pub fn mount(
    http: Router,
    auth: Authenticator,
    confirmation: Option<ConfirmationVerifier>,
    db: Database,
    origins: crate::browser::Origins,
    resource: Option<crate::discovery::PublicResource>,
) -> Result<Router, CoreError> {
    let handler = NativeMcp {
        http: http.clone(),
        operations: Arc::new(operations()?),
        auth: auth.clone(),
        db,
        confirmation,
    };
    let mut config = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true)
        .with_max_request_body_bytes(1_000_000)
        .with_allowed_origins(origins.0.iter().cloned());
    if let Some(r) = resource {
        config.allowed_hosts.push(r.authority);
    }
    let service = StreamableHttpService::new(
        move || Ok(handler.clone()),
        LocalSessionManager::default().into(),
        config,
    );
    Ok(
        http.merge(Router::new().nest_service("/mcp", service).layer(
            middleware::from_fn_with_state((auth, origins), authenticate),
        )),
    )
}
impl NativeMcp {
    pub(crate) fn context_headers(
        &self,
        ctx: &RequestContext<RoleServer>,
    ) -> Result<http::HeaderMap, ErrorData> {
        let headers = ctx
            .extensions
            .get::<http::request::Parts>()
            .ok_or_else(|| ErrorData::internal_error("Missing HTTP identity context", None))?
            .headers
            .clone();
        self.auth.authenticate(&headers).map_err(|_| {
            ErrorData::invalid_params("NOT_AUTHORIZED: Valid current identity required", None)
        })?;
        Ok(headers)
    }
    pub(crate) async fn context_read(
        &self,
        ctx: &RequestContext<RoleServer>,
        path: &str,
    ) -> Result<Value, ErrorData> {
        let headers = self.context_headers(ctx)?;
        let mut request = http::Request::builder()
            .method("GET")
            .uri(path)
            .body(Body::empty())
            .map_err(|_| ErrorData::invalid_params("Invalid context path", None))?;
        *request.headers_mut() = headers;
        let response = self
            .http
            .clone()
            .oneshot(request)
            .await
            .map_err(|_| ErrorData::internal_error("Context unavailable", None))?;
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 4_000_000)
            .await
            .map_err(|_| ErrorData::internal_error("Context exceeded bound", None))?;
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|_| ErrorData::internal_error("Invalid context response", None))?;
        if !status.is_success() {
            return Err(ErrorData::invalid_params(
                "Context not authorized or unavailable",
                Some(value),
            ));
        };
        self.context_headers(ctx)?;
        Ok(value)
    }
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
