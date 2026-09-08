//! Explicit opt-in against an isolated real engine, never silently substituted by mocks.
use cortex_rust_core::{snapshot::Concept, terminus::Terminus};
use reqwest::Method;
use serde_json::json;
use uuid::Uuid;

#[tokio::test]
#[ignore = "requires an isolated TerminusDB engine"]
async fn immutable_typed_snapshot_round_trip() {
    let engine = Terminus::new(
        "http://127.0.0.1:6363",
        "admin".into(),
        std::env::var("CORTEX_SPIKE_TERMINUS_PASSWORD")
            .expect("explicit synthetic engine password"),
    )
    .unwrap();
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let source = Uuid::new_v4();
    let concepts:Vec<Concept>=serde_json::from_value(json!([
        {"concept_id":a,"title":"Concept 🧠 A","body":"Preuve synthétique A.","maturity":"observed","sources":[{"source_id":source,"start":0,"end":20}],"links":[{"target_id":b,"kind":"structural","primary":true,"weight":0.125}]},
        {"concept_id":b,"title":"Concept B","body":"Preuve synthétique B.","maturity":"established","sources":[{"source_id":source,"start":21,"end":41}],"links":[]}
    ])).unwrap();
    let snapshot = engine
        .stage_snapshot(concepts)
        .await
        .expect("stage real typed graph");
    let baseline = engine.read_snapshot(&snapshot).await.unwrap();
    let reservation = Uuid::parse_str(&snapshot.database[12..]).unwrap();
    let reconciled = engine
        .reconcile_snapshot(reservation, snapshot.digest.clone(), snapshot.count)
        .await
        .unwrap();
    assert_eq!(reconciled.commit, snapshot.commit);
    assert_eq!(baseline.len(), 2);
    assert!(
        baseline
            .iter()
            .any(|c| c.concept_id == a && c.links[0].target_id == b)
    );
    // Mutate branch HEAD deliberately. Served immutable commit must not follow it.
    engine.request(Method::POST,&["document","admin",&snapshot.database,"local","branch","main"],Some(&json!([{"@id":format!("CortexConcept/{}",Uuid::new_v4()),"@type":"CortexConcept","title":"Unpublished","body":"Synthetic staging change","maturity":"emerging","sources":[],"links":[]}])),&[("author","synthetic-test"),("message","Not published")]).await.unwrap();
    assert_eq!(
        serde_json::to_value(engine.read_snapshot(&snapshot).await.unwrap()).unwrap(),
        serde_json::to_value(baseline).unwrap()
    );
    assert!(
        engine
            .reconcile_snapshot(reservation, snapshot.digest.clone(), snapshot.count)
            .await
            .is_err()
    );
    let mut tampered = snapshot.clone();
    tampered.digest = "0".repeat(64);
    assert!(engine.read_snapshot(&tampered).await.is_err());
    let empty = engine
        .stage_snapshot(vec![])
        .await
        .expect("empty typed graph");
    assert!(engine.read_snapshot(&empty).await.unwrap().is_empty());
    println!(
        "REAL_ENGINE_SNAPSHOT: typed graph, immutable read after HEAD change, digest rejection, empty graph passed; no product publication claimed"
    );
}
