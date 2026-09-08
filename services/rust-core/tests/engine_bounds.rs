//! Transport limits distinguish a local refusal from an uncertain engine mutation.
use axum::{
    Router,
    body::{Body, Bytes, to_bytes},
    extract::Request,
    response::Response,
    routing::any,
};
use cortex_rust_core::{
    snapshot::Concept,
    terminus::{EngineError, Terminus},
};
use reqwest::Method;
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use uuid::Uuid;

struct EngineFixture {
    engine: Terminus,
    calls: Arc<AtomicUsize>,
    request_bytes: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for EngineFixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn fixture(bytes: Vec<u8>, chunked: bool) -> EngineFixture {
    let bytes = Bytes::from(bytes);
    let calls = Arc::new(AtomicUsize::new(0));
    let request_bytes = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let received = request_bytes.clone();
    let app = Router::new().fallback(any(move |request: Request| {
        let bytes = bytes.clone();
        let calls = observed.clone();
        let received = received.clone();
        async move {
            calls.fetch_add(1, Ordering::SeqCst);
            let body = to_bytes(request.into_body(), 4_000_001).await.unwrap();
            received.store(body.len(), Ordering::SeqCst);
            let body = if chunked {
                let chunks: Vec<_> = (0..bytes.len())
                    .step_by(65_537)
                    .map(|start| {
                        Ok::<_, std::convert::Infallible>(
                            bytes.slice(start..(start + 65_537).min(bytes.len())),
                        )
                    })
                    .collect();
                Body::from_stream(futures_util::stream::iter(chunks))
            } else {
                Body::from(bytes)
            };
            Response::new(body)
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    EngineFixture {
        engine: Terminus::new(&url, "admin".into(), "synthetic".into()).unwrap(),
        calls,
        request_bytes,
        task,
    }
}

#[tokio::test]
async fn exact_response_byte_limit_and_one_byte_excess_for_known_and_chunked_bodies() {
    for chunked in [false, true] {
        for excess in [false, true] {
            let content = "🧠".repeat(999_999) + if excess { "aaa" } else { "aa" };
            let body = serde_json::to_vec(&content).unwrap();
            assert_eq!(body.len(), 4_000_000 + usize::from(excess));
            let fixture = fixture(body, chunked).await;
            for method in [Method::GET, Method::POST] {
                let result = fixture
                    .engine
                    .request(method.clone(), &["document"], None, &[])
                    .await;
                if !excess {
                    assert_eq!(result.unwrap().0, Value::String(content.clone()));
                } else if method == Method::GET {
                    assert!(matches!(result, Err(EngineError::TooLarge)));
                } else {
                    assert!(matches!(result, Err(EngineError::Uncertain)));
                }
            }
            assert_eq!(fixture.calls.load(Ordering::SeqCst), 2);
        }
    }
}

#[tokio::test]
async fn outbound_limit_is_measured_in_encoded_bytes_and_refuses_before_network() {
    let fixture = fixture(b"{}".to_vec(), false).await;
    let at_limit = Value::String("a".repeat(3_999_998));
    fixture
        .engine
        .request(Method::POST, &["document"], Some(&at_limit), &[])
        .await
        .unwrap();
    assert_eq!(fixture.request_bytes.load(Ordering::SeqCst), 4_000_000);
    for oversized in [
        Value::String("a".repeat(3_999_999)),
        Value::String("🧠".repeat(1_000_000)),
    ] {
        assert!(matches!(
            fixture
                .engine
                .request(Method::POST, &["document"], Some(&oversized), &[])
                .await,
            Err(EngineError::TooLarge)
        ));
        assert_eq!(fixture.calls.load(Ordering::SeqCst), 1);
    }
}

#[tokio::test]
async fn oversized_snapshot_does_not_create_a_database_or_write_schema() {
    let fixture = fixture(b"{}".to_vec(), false).await;
    let concepts: Vec<Concept> = (1..=150)
        .map(|id| {
            serde_json::from_value(json!({
                "concept_id": Uuid::from_u128(id),
                "title": format!("Synthetic concept {id}"),
                "body": "a".repeat(30_000),
                "maturity": "observed",
                "sources": [{"source_id": Uuid::nil(), "start": 0, "end": 30_000}],
                "links": []
            }))
            .unwrap()
        })
        .collect();
    assert!(matches!(
        fixture
            .engine
            .stage_snapshot_reserved(Uuid::new_v4(), concepts)
            .await,
        Err(EngineError::TooLarge)
    ));
    assert_eq!(fixture.calls.load(Ordering::SeqCst), 0);
}
