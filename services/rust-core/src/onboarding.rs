//! Authenticated read-only MCP context and user-selected workflow guidance.
use crate::mcp::NativeMcp;
use rmcp::{ErrorData, RoleServer, model::*, service::RequestContext};
use serde_json::{Value, json};
use uuid::Uuid;
fn error() -> ErrorData {
    ErrorData::invalid_params("Invalid or inaccessible companion context", None)
}
fn data() -> Result<Value, ErrorData> {
    serde_json::from_str(include_str!("onboarding.json")).map_err(|_| error())
}
pub(crate) fn list<T: serde::de::DeserializeOwned>(
    kind: &str,
    request: Option<PaginatedRequestParams>,
) -> Result<T, ErrorData> {
    if request.is_some_and(|p| p.cursor.is_some()) {
        return Err(error());
    };
    serde_json::from_value(json!({kind:data()?[kind]})).map_err(|_| error())
}
fn uuid(v: &str) -> Result<String, ErrorData> {
    Uuid::parse_str(v)
        .map(|id| id.to_string())
        .map_err(|_| error())
}
pub(crate) async fn read(
    s: &NativeMcp,
    request: ReadResourceRequestParams,
    ctx: RequestContext<RoleServer>,
) -> Result<ReadResourceResponse, ErrorData> {
    s.context_headers(&ctx)?;
    let uri = request.uri;
    let (mime, text) = match uri.as_str() {
        "cortex://guide" => (
            "text/plain",
            data()?["guide"].as_str().ok_or_else(error)?.to_owned(),
        ),
        "cortex://workspace" => (
            "application/json",
            s.context_read(&ctx, "/v1/me").await?.to_string(),
        ),
        "cortex://actions" => (
            "application/json",
            s.context_read(&ctx, "/v1/interactions").await?.to_string(),
        ),
        _ => {
            let domain = uri
                .strip_prefix("cortex://domains/")
                .and_then(|s| s.strip_suffix("/context"))
                .ok_or_else(error)?;
            let domain = uuid(domain)?;
            let version = s
                .context_read(&ctx, &format!("/v1/domains/{domain}/version"))
                .await?;
            let preferences = s
                .context_read(&ctx, &format!("/v1/domains/{domain}/feedback-preferences"))
                .await?;
            (
                "application/json",
                json!({"version":version,"feedback_preferences":preferences}).to_string(),
            )
        }
    };
    s.context_headers(&ctx)?;
    let value: ReadResourceResult =
        serde_json::from_value(json!({"contents":[{"uri":uri,"mimeType":mime,"text":text}]}))
            .map_err(|_| error())?;
    Ok(value.into())
}
pub(crate) async fn prompt(
    s: &NativeMcp,
    request: GetPromptRequestParams,
    ctx: RequestContext<RoleServer>,
) -> Result<GetPromptResponse, ErrorData> {
    s.context_headers(&ctx)?;
    let definitions = data()?;
    let def = definitions["prompts"]
        .as_array()
        .and_then(|v| v.iter().find(|p| p["name"] == request.name))
        .ok_or_else(error)?;
    let args = serde_json::to_value(request.arguments).map_err(|_| error())?;
    let map = args.as_object().ok_or_else(error)?;
    let names = def["arguments"].as_array().ok_or_else(error)?;
    if map.len() != names.len()
        || !names.iter().all(|v| {
            map.get(v["name"].as_str().unwrap_or(""))
                .is_some_and(Value::is_string)
        })
    {
        return Err(error());
    };
    let domain = uuid(args["domain_id"].as_str().ok_or_else(error)?)?;
    let suffix = match request.name.as_str() {
        "ask_cortex" => {
            let question = args["question"].as_str().ok_or_else(error)?;
            if question.chars().count() > 4000
                || question
                    .chars()
                    .all(|c| c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c))
            {
                return Err(error());
            }
            s.context_read(&ctx, &format!("/v1/domains/{domain}/version"))
                .await?;
            format!(
                "\nUser-selected query data:\n{}\nUse api_knowledge_query with these data after checking its schema. Return evidence and the episode ID.",
                json!({"domain":domain,"question":question})
            )
        }
        "review_cortex_proposal" => {
            let proposal = uuid(args["proposal_id"].as_str().ok_or_else(error)?)?;
            s.context_read(&ctx, &format!("/v1/domains/{domain}/proposals/{proposal}"))
                .await?;
            format!(
                "\nUser-selected review data:\n{}\nRead api_proposals_read and api_proposals_diff. Explain evidence, base version and review revision. Prepare a concrete decision for the authorized user; obtain host confirmation before a sensitive command.",
                json!({"domain":domain,"proposal_id":proposal})
            )
        }
        "report_cortex_feedback" => {
            let episode = uuid(args["episode_id"].as_str().ok_or_else(error)?)?;
            s.context_read(&ctx, &format!("/v1/domains/{domain}/episodes/{episode}"))
                .await?;
            let preferences = s
                .context_read(&ctx, &format!("/v1/domains/{domain}/feedback-preferences"))
                .await?;
            format!(
                "\nAuthorized feedback context:\n{}\nInspect api_feedback_record_signal. Record only a supported signal with a known origin and a stable event key. If no actual signal exists, do not fabricate one.",
                json!({"domain":domain,"episode_id":episode,"preferences":preferences})
            )
        }
        _ => return Err(error()),
    };
    s.context_headers(&ctx)?;
    let text = format!(
        "{}{suffix}",
        definitions["guide"].as_str().ok_or_else(error)?
    );
    let result:GetPromptResult=serde_json::from_value(json!({"description":def["description"],"messages":[{"role":"user","content":{"type":"text","text":text}}]})).map_err(|_|error())?;
    Ok(result.into())
}
