//! Exact opt-in browser origins. Preflight does not authenticate business actions.
use axum::{
    Json, Router,
    extract::{Request, State},
    middleware::{self, Next},
    response::{IntoResponse, Response},
};
use http::{HeaderName, HeaderValue, Method, StatusCode};
use std::{collections::BTreeSet, sync::Arc, time::Duration};
use tower_http::cors::CorsLayer;
#[derive(Clone, Default)]
pub struct Origins(pub Arc<Vec<String>>);
impl Origins {
    pub fn parse(raw: &str) -> Result<Self, &'static str> {
        let values: Vec<String> =
            serde_json::from_str(raw).map_err(|_| "CORS origins must be a JSON array")?;
        if values.len() > 20 || values.iter().collect::<BTreeSet<_>>().len() != values.len() {
            return Err("CORS origins must be unique and bounded");
        }
        for v in &values {
            let u = reqwest::Url::parse(v).map_err(|_| "Invalid CORS origin")?;
            let loopback = matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
            if v.chars().any(char::is_whitespace)
                || v.contains('*')
                || !u.username().is_empty()
                || u.password().is_some()
                || u.query().is_some()
                || u.fragment().is_some()
                || u.path() != "/"
                || u.as_str().trim_end_matches('/') != v
                || (u.scheme() != "https" && !(u.scheme() == "http" && loopback))
                || HeaderValue::from_str(v).is_err()
            {
                return Err(
                    "CORS origins require canonical HTTPS or explicit HTTP loopback without a path",
                );
            }
        }
        Ok(Self(Arc::new(values)))
    }
    pub fn allowed(&self, headers: &http::HeaderMap) -> bool {
        let values = headers.get_all("origin").iter().collect::<Vec<_>>();
        values.is_empty()
            || (values.len() == 1
                && values[0]
                    .to_str()
                    .is_ok_and(|s| self.0.iter().any(|v| v == s)))
    }
}
async fn guard(State(origins): State<Origins>, request: Request, next: Next) -> Response {
    if !origins.allowed(request.headers()) {
        return (StatusCode::FORBIDDEN,[("vary","Origin")],Json(serde_json::json!({"error":"ORIGIN_NOT_ALLOWED","message":"Browser origin is not allowed"}))).into_response();
    }
    next.run(request).await
}
pub fn install(router: Router, origins: Origins) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(
            origins
                .0
                .iter()
                .map(|v| HeaderValue::from_str(v).expect("validated origin"))
                .collect::<Vec<_>>(),
        )
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers(
            [
                "authorization",
                "x-tenant-id",
                "content-type",
                "accept",
                "idempotency-key",
                "x-cortex-confirmation",
                "mcp-protocol-version",
                "mcp-session-id",
                "last-event-id",
            ]
            .map(HeaderName::from_static),
        )
        .expose_headers(
            [
                "content-disposition",
                "x-content-type-options",
                "www-authenticate",
                "retry-after",
                "mcp-session-id",
                "mcp-protocol-version",
            ]
            .map(HeaderName::from_static),
        )
        .max_age(Duration::from_secs(600));
    router
        .layer(cors)
        .layer(middleware::from_fn_with_state(origins, guard))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_exact_canonical_opt_in_origins() {
        for good in [
            r#"[]"#,
            r#"["https://app.example.com","http://localhost:5173","http://[::1]:5173"]"#,
        ] {
            assert!(Origins::parse(good).is_ok(), "{good}")
        }
        for bad in [
            r#"["*"]"#,
            r#"["http://remote.example"]"#,
            r#"["https://example.com/"]"#,
            r#"["https://example.com:443"]"#,
            r#"["https://user@example.com"]"#,
            r#"["https://example.com","https://example.com"]"#,
            r#"["null"]"#,
        ] {
            assert!(Origins::parse(bad).is_err(), "{bad}")
        }
    }
}
