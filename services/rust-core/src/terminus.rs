//! Private bounded engine transport. Never exported directly as a product API.
use reqwest::{Client, Method, Url};
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("invalid engine configuration")]
    Configuration,
    #[error("engine transport outcome is uncertain")]
    Uncertain,
    #[error("engine rejected operation with HTTP {0}")]
    Rejected(u16),
    #[error("engine response is not valid JSON")]
    InvalidResponse,
    #[error("engine response exceeded the configured bound")]
    TooLarge,
}

#[derive(Clone)]
pub struct Terminus {
    client: Client,
    base: Url,
    user: String,
    password: String,
}
impl Terminus {
    pub fn new(base: &str, user: String, password: String) -> Result<Self, EngineError> {
        let url = Url::parse(base).map_err(|_| EngineError::Configuration)?;
        let local = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
        if !(url.scheme() == "https" || (url.scheme() == "http" && local))
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
            || user.is_empty()
            || password.is_empty()
        {
            return Err(EngineError::Configuration);
        }
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(3))
            .build()
            .map_err(|_| EngineError::Configuration)?;
        Ok(Self {
            client,
            base: url,
            user,
            password,
        })
    }
    pub async fn request(
        &self,
        method: Method,
        segments: &[&str],
        body: Option<&Value>,
        query: &[(&str, &str)],
    ) -> Result<(Value, Option<String>), EngineError> {
        if segments
            .iter()
            .any(|s| s.is_empty() || s.contains('/') || *s == "." || *s == "..")
        {
            return Err(EngineError::Configuration);
        }
        let mut url = self.base.clone();
        url.path_segments_mut()
            .map_err(|_| EngineError::Configuration)?
            .push("api")
            .extend(segments);
        let mutation = method != Method::GET && method != Method::HEAD;
        let mut request = self
            .client
            .request(method, url)
            .basic_auth(&self.user, Some(&self.password))
            .query(query);
        if let Some(body) = body {
            let encoded = serde_json::to_vec(body).map_err(|_| EngineError::Configuration)?;
            if encoded.len() > 4_000_000 {
                return Err(EngineError::TooLarge);
            }
            request = request
                .header("content-type", "application/json")
                .body(encoded);
        }
        let mut response = request.send().await.map_err(|_| EngineError::Uncertain)?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            if mutation && response.status().is_server_error() {
                return Err(EngineError::Uncertain);
            }
            return Err(EngineError::Rejected(status));
        }
        let version = response
            .headers()
            .get("terminusdb-data-version")
            .and_then(|h| h.to_str().ok())
            .map(str::to_owned);
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| EngineError::Uncertain)? {
            if bytes.len() + chunk.len() > 4_000_000 {
                return Err(if mutation {
                    EngineError::Uncertain
                } else {
                    EngineError::TooLarge
                });
            }
            bytes.extend_from_slice(&chunk);
        }
        let value = serde_json::from_slice(&bytes).map_err(|_| {
            if mutation {
                EngineError::Uncertain
            } else {
                EngineError::InvalidResponse
            }
        })?;
        Ok((value, version))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Router, extract::RawQuery, response::IntoResponse, routing::any};
    async fn engine(status: u16, body: &'static str) -> (Terminus, tokio::task::JoinHandle<()>) {
        let app = Router::new().fallback(any(move |query: RawQuery| async move {
            assert_eq!(query.0.as_deref(), Some("as_list=true"));
            (http::StatusCode::from_u16(status).unwrap(), body).into_response()
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (
            Terminus::new(&url, "admin".into(), "synthetic".into()).unwrap(),
            handle,
        )
    }
    #[tokio::test]
    async fn document_queries_are_sent_and_json_read() {
        let (engine, task) = engine(200, "[]").await;
        let result = engine
            .request(
                Method::GET,
                &["document", "admin", "db"],
                None,
                &[("as_list", "true")],
            )
            .await
            .unwrap();
        assert_eq!(result.0, serde_json::json!([]));
        task.abort();
    }
    #[tokio::test]
    async fn mutation_500_and_invalid_success_are_uncertain() {
        for (code, body) in [(503, "{}"), (200, "broken json")] {
            let (engine, task) = engine(code, body).await;
            assert!(matches!(
                engine
                    .request(
                        Method::POST,
                        &["document"],
                        Some(&serde_json::json!([])),
                        &[("as_list", "true")]
                    )
                    .await,
                Err(EngineError::Uncertain)
            ));
            task.abort();
        }
    }
    #[tokio::test]
    async fn engine_refusal_is_not_success() {
        let (engine, task) = engine(409, "{}").await;
        assert!(matches!(
            engine
                .request(Method::POST, &["apply"], None, &[("as_list", "true")])
                .await,
            Err(EngineError::Rejected(409))
        ));
        task.abort();
    }
    #[test]
    fn credentials_cannot_be_embedded_in_url_or_plaintext_remote() {
        for url in [
            "http://example.com",
            "http://admin:secret@localhost",
            "https://example.com?x=1",
        ] {
            assert!(Terminus::new(url, "a".into(), "b".into()).is_err());
        }
    }
}
