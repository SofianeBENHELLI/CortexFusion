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

#[tokio::test]
#[ignore = "requires an isolated TerminusDB engine"]
async fn paged_snapshot_over_four_megabytes_preserves_cross_batch_cycles() {
    let engine = Terminus::new(
        "http://127.0.0.1:6363",
        "admin".into(),
        std::env::var("CORTEX_SPIKE_TERMINUS_PASSWORD")
            .expect("explicit synthetic engine password"),
    )
    .unwrap();
    let ids: Vec<_> = (0..180).map(|i| Uuid::from_u128(i + 1)).collect();
    let source = Uuid::new_v4();
    let values: Vec<Concept> = ids.iter().enumerate().map(|(i, id)| {
        serde_json::from_value(json!({
            "concept_id": id, "title": format!("Synthetic large snapshot {i}"),
            "body": "Synthetic evidence. ".repeat(1500), "maturity": "emerging",
            "sources": [{"source_id": source, "start": 0, "end": 1}],
            "links": [{"target_id": ids[(i + 1) % ids.len()], "kind": "associative", "primary": false, "weight": 0.5}],
        })).unwrap()
    }).collect();
    let encoded = serde_json::to_vec(&values).unwrap().len();
    assert!(encoded > 4_000_000);
    let expected = cortex_rust_core::snapshot::content_identity(values.clone()).unwrap();
    let snapshot = engine
        .stage_snapshot(values)
        .await
        .expect("stage paged real graph with cycles");
    assert_eq!((snapshot.digest.clone(), snapshot.count), expected);
    let actual = engine.read_snapshot(&snapshot).await.unwrap();
    assert_eq!(actual.len(), 180);
    for (i, concept) in actual.iter().enumerate() {
        assert_eq!(concept.concept_id, ids[i]);
        assert_eq!(concept.body.chars().count(), 30000);
        assert_eq!(concept.links.len(), 1);
        assert_eq!(concept.links[0].target_id, ids[(i + 1) % ids.len()]);
    }
    let reservation = Uuid::parse_str(&snapshot.database[12..]).unwrap();
    assert_eq!(
        engine
            .reconcile_snapshot(reservation, snapshot.digest.clone(), snapshot.count)
            .await
            .unwrap(),
        snapshot
    );
    println!(
        "REAL_ENGINE_PAGED_SNAPSHOT: 180 concepts, 180 cyclic relations, {encoded} concept JSON bytes verified; synthetic engine only, not a 10,000-concept frontend qualification"
    );
}
