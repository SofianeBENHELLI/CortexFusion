//! Machine-readable native contract inventory, filtered from the shared reference.
use crate::{error::CoreError, server::StateData};
use axum::{Json, Router, extract::State, routing::get};
use http::HeaderMap;
use serde_json::{Value, json};
fn native(action: &str) -> bool {
    crate::mcp::NATIVE.contains(&format!("api_{}", action.replace('.', "_")).as_str())
}
pub(crate) fn extensions() -> Result<Value, CoreError> {
    serde_json::from_str(include_str!(
        "../../../packages/contracts/rust-extensions.json"
    ))
    .map_err(|_| CoreError::database())
}
pub fn catalog() -> Result<Value, CoreError> {
    let mut v: Value = serde_json::from_str(include_str!(
        "../../../packages/contracts/interactions.json"
    ))
    .map_err(|_| CoreError::database())?;
    v["items"]
        .as_array_mut()
        .ok_or_else(CoreError::database)?
        .extend(
            extensions()?["interactions"]
                .as_array()
                .ok_or_else(CoreError::database)?
                .iter()
                .cloned(),
        );
    v["items"]
        .as_array_mut()
        .ok_or_else(CoreError::database)?
        .retain(|item| item["operation_id"].as_str().is_some_and(native));
    Ok(v)
}
fn schema() -> Result<Value, CoreError> {
    let mut v: Value =
        serde_json::from_str(include_str!("../../../packages/contracts/openapi.json"))
            .map_err(|_| CoreError::database())?;
    let extra = extensions()?;
    v["paths"]
        .as_object_mut()
        .ok_or_else(CoreError::database)?
        .extend(
            extra["paths"]
                .as_object()
                .ok_or_else(CoreError::database)?
                .clone(),
        );
    v["components"]["schemas"]
        .as_object_mut()
        .ok_or_else(CoreError::database)?
        .extend(
            extra["schemas"]
                .as_object()
                .ok_or_else(CoreError::database)?
                .clone(),
        );
    let paths = v["paths"].as_object_mut().ok_or_else(CoreError::database)?;
    paths.retain(|_, ops| {
        if let Some(ops) = ops.as_object_mut() {
            ops.retain(|_, op| op["operationId"].as_str().is_some_and(native));
            !ops.is_empty()
        } else {
            false
        }
    });
    v["info"]["description"] = json!(
        "CortexFusion native Rust migration candidate. All 79 reference operations and 8 native graph and governance operations are implemented. Historical schemas are preserved; some detailed validation error shapes differ. Optional configured model calls require signed decisions. No frontend or production deployment is included."
    );
    Ok(v)
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route("/v1/interactions", get(interactions))
        .route("/openapi.json", get(openapi))
        .route(
            "/.well-known/oauth-protected-resource",
            get(protected_resource),
        )
}
async fn interactions(State(s): State<StateData>, h: HeaderMap) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let result = catalog()?;
    p.check_fresh()?;
    Ok(Json(result))
}
async fn openapi() -> Result<Json<Value>, CoreError> {
    Ok(Json(schema()?))
}

#[derive(Clone)]
pub struct PublicResource {
    pub metadata: Value,
    pub authority: String,
    pub origin: String,
    pub challenge: http::HeaderValue,
}
impl PublicResource {
    pub fn parse(resource: &str, issuer: &str, audience: &str) -> Result<Self, &'static str> {
        let url = reqwest::Url::parse(resource).map_err(|_| "Invalid public MCP URL")?;
        let auth = reqwest::Url::parse(issuer).map_err(|_| "Invalid authorization issuer")?;
        if url.scheme() != "https"
            || url.path() != "/mcp/"
            || url.as_str() != resource
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || resource != audience
            || auth.scheme() != "https"
            || auth.host_str().is_none()
            || !auth.username().is_empty()
            || auth.password().is_some()
            || auth.query().is_some()
            || auth.fragment().is_some()
            || issuer.chars().any(|c| c.is_whitespace() || c == '"')
        {
            return Err(
                "Public MCP requires canonical HTTPS /mcp/, clean HTTPS issuer and matching JWT audience",
            );
        }
        let origin = url.origin().ascii_serialization();
        let authority = origin
            .strip_prefix("https://")
            .ok_or("Invalid MCP authority")?
            .to_owned();
        let challenge = http::HeaderValue::from_str(&format!(
            "Bearer resource_metadata=\"{origin}/.well-known/oauth-protected-resource\""
        ))
        .map_err(|_| "Invalid challenge")?;
        Ok(Self {
            metadata: json!({"resource":resource,"authorization_servers":[issuer],"bearer_methods_supported":["header"],"resource_name":"Cortex Fusion"}),
            authority,
            origin,
            challenge,
        })
    }
}
async fn protected_resource(State(s): State<StateData>) -> Result<Json<Value>, CoreError> {
    s.public_resource
        .map(|r| Json(r.metadata))
        .ok_or(CoreError {
            code: "DISCOVERY_DISABLED",
            message: "Public MCP resource discovery is not configured",
            status: http::StatusCode::NOT_FOUND,
        })
}
pub fn install_challenge(router: Router, resource: Option<PublicResource>) -> Router {
    router.layer(axum::middleware::from_fn_with_state(resource, challenge))
}
async fn challenge(
    State(resource): State<Option<PublicResource>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    if (request.uri().path() == "/mcp" || request.uri().path().starts_with("/mcp/"))
        && let Some(r) = &resource
        && let Some(h) = request
            .headers()
            .get(http::header::HOST)
            .and_then(|v| v.to_str().ok())
    {
        let u = reqwest::Url::parse(&format!("https://{h}/"));
        let allowed = u.is_ok_and(|u| {
            matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
                || (u.username().is_empty()
                    && u.password().is_none()
                    && u.query().is_none()
                    && u.fragment().is_none()
                    && u.path() == "/"
                    && u.origin().ascii_serialization() == r.origin)
        });
        if !allowed {
            use axum::response::IntoResponse;
            return (
                http::StatusCode::FORBIDDEN,
                Json(
                    json!({"error":"HOST_NOT_ALLOWED","message":"MCP authority is not configured"}),
                ),
            )
                .into_response();
        }
    }
    let mut response = next.run(request).await;
    if response.status() == http::StatusCode::UNAUTHORIZED
        && let Some(r) = resource
    {
        response
            .headers_mut()
            .insert(http::header::WWW_AUTHENTICATE, r.challenge);
    }
    response
}
#[cfg(test)]
mod public_tests {
    use super::*;
    #[test]
    fn configured_resource_is_bound_to_audience_and_clean_urls() {
        let good = "https://cortex.example/mcp/";
        assert!(PublicResource::parse(good, "https://identity.example/", good).is_ok());
        for url in [
            "http://cortex.example/mcp/",
            "https://cortex.example/mcp",
            "https://CORTEX.example/mcp/",
            "https://user@cortex.example/mcp/",
            "https://cortex.example/mcp/?x=1",
            "https://cortex.example/mcp/#x",
        ] {
            assert!(PublicResource::parse(url, "https://identity.example/", url).is_err())
        }
        assert!(PublicResource::parse(good, "https://identity.example/", "other").is_err());
        for issuer in [
            "http://identity.example/",
            "https://x:y@identity.example/",
            "https://identity.example/?x=1",
        ] {
            assert!(PublicResource::parse(good, issuer, good).is_err())
        }
    }
}
