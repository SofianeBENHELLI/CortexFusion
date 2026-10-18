//! Typed immutable graph snapshots. This module never changes the published pointer.
use crate::{
    canonical,
    knowledge::{Link, SourceRef},
    terminus::{EngineError, Terminus},
};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use uuid::Uuid;

// Transport budgets, not qualified product capacity. Keep the engine's 4 MB
// per-request guard; no full-domain JSON request/response is required here.
const WRITE_BATCH_BYTES: usize = 1_000_000;
// A single 200k-character body can encode to 1.2 MB (JSON control escapes).
// Isolate such records; the engine's 4 MB request and 64 MB snapshot guards stay.
const WRITE_DOCUMENT_BYTES: usize = 1_300_000;
pub const MAX_CONCEPT_BODY_CHARS: usize = 200_000;
const WRITE_BATCH_DOCUMENTS: usize = 128;
const READ_PAGE_DOCUMENTS: usize = 64;
const SNAPSHOT_BYTES: usize = 64_000_000;
const SNAPSHOT_CONCEPTS: usize = 100_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Concept {
    pub concept_id: Uuid,
    pub title: String,
    pub body: String,
    #[serde(default = "emerging")]
    pub maturity: String,
    pub sources: Vec<SourceRef>,
    #[serde(default)]
    pub links: Vec<Link>,
}
fn emerging() -> String {
    "emerging".into()
}
impl Concept {
    pub fn validate(&self) -> Result<(), EngineError> {
        if !(1..=200).contains(&self.title.chars().count())
            || !(1..=MAX_CONCEPT_BODY_CHARS).contains(&self.body.chars().count())
            || !["emerging", "observed", "established", "reference"]
                .contains(&self.maturity.as_str())
            || !(1..=30).contains(&self.sources.len())
            || self.links.len() > 100
        {
            return Err(EngineError::InvalidResponse);
        }
        for source in &self.sources {
            if source.start >= source.end {
                return Err(EngineError::InvalidResponse);
            }
        }
        for link in &self.links {
            link.validate().map_err(|_| EngineError::InvalidResponse)?;
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub database: String,
    pub commit: String,
    pub digest: String,
    pub count: usize,
}
impl Snapshot {
    pub fn validate(&self) -> Result<(), EngineError> {
        if !self.database.starts_with("cf_snapshot_")
            || self.database.len() != 44
            || !self.database[12..].bytes().all(|b| b.is_ascii_hexdigit())
            || self.commit.is_empty()
            || self.commit.len() > 200
            || !self
                .commit
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            || self.digest.len() != 64
            || !self.digest.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(EngineError::Configuration);
        }
        Ok(())
    }
}
fn schema() -> Value {
    json!([
        {"@id":"CortexConcept","@type":"Class","title":"xsd:string","body":"xsd:string","maturity":"xsd:string",
         "sources":{"@type":"List","@class":"SourceSpan"},"links":{"@type":"List","@class":"Relation"}},
        {"@id":"SourceSpan","@type":"Class","@subdocument":[],"@key":{"@type":"Random"},"source_id":"xsd:string","start":"xsd:nonNegativeInteger","end":"xsd:nonNegativeInteger"},
        {"@id":"Relation","@type":"Class","@subdocument":[],"@key":{"@type":"Random"},"target":"CortexConcept","kind":"xsd:string","primary":"xsd:boolean","weight":"xsd:double"}
    ])
}
fn encode(concept: &Concept) -> Value {
    json!({"@id":format!("CortexConcept/{}",concept.concept_id),"@type":"CortexConcept", "title":concept.title,"body":concept.body,"maturity":concept.maturity,
        "sources":concept.sources.iter().map(|s|json!({"@type":"SourceSpan","source_id":s.source_id,"start":s.start,"end":s.end})).collect::<Vec<_>>(),
        "links":concept.links.iter().map(|l|json!({"@type":"Relation","target":format!("CortexConcept/{}",l.target_id),"kind":l.kind,"primary":l.primary,"weight":l.weight})).collect::<Vec<_>>()})
}
fn decode(value: Value) -> Result<Concept, EngineError> {
    let error = || EngineError::InvalidResponse;
    let id = value["@id"]
        .as_str()
        .and_then(|s| s.strip_prefix("CortexConcept/"))
        .ok_or_else(error)?;
    let sources = value["sources"]
        .as_array()
        .ok_or_else(error)?
        .iter()
        .map(|v| json!({"source_id":v["source_id"],"start":v["start"],"end":v["end"]}))
        .collect::<Vec<_>>();
    let links=value["links"].as_array().ok_or_else(error)?.iter().map(|v| {
        let target=v["target"].as_str().and_then(|s|s.strip_prefix("CortexConcept/")).ok_or_else(error)?;
        Ok(json!({"target_id":target,"kind":v["kind"],"primary":v["primary"],"weight":v["weight"]}))
    }).collect::<Result<Vec<_>,EngineError>>()?;
    let concept:Concept=serde_json::from_value(json!({"concept_id":id,"title":value["title"],"body":value["body"],"maturity":value["maturity"],"sources":sources,"links":links})).map_err(|_|error())?;
    concept.validate()?;
    Ok(concept)
}
fn ordered(mut concepts: Vec<Concept>) -> Result<Vec<Concept>, EngineError> {
    if concepts.len() > SNAPSHOT_CONCEPTS {
        return Err(EngineError::TooLarge);
    }
    concepts.sort_by_key(|c| c.concept_id);
    let mut ids = BTreeSet::new();
    for c in &concepts {
        c.validate()?;
        if !ids.insert(c.concept_id) {
            return Err(EngineError::InvalidResponse);
        }
    }
    for c in &concepts {
        if c.links.iter().any(|l| !ids.contains(&l.target_id)) {
            return Err(EngineError::InvalidResponse);
        }
    }
    Ok(concepts)
}
fn digest(concepts: &[Concept]) -> Result<String, EngineError> {
    // Preserve the legacy array digest byte-for-byte without materializing a
    // second full JSON tree and several full-domain canonical strings.
    let mut hash = Sha256::new();
    hash.update(b"[");
    let mut bytes = 2usize;
    for (index, concept) in concepts.iter().enumerate() {
        let encoded = canonical::encode(
            &serde_json::to_value(concept).map_err(|_| EngineError::InvalidResponse)?,
        )
        .map_err(|_| EngineError::InvalidResponse)?;
        bytes += encoded.len() + usize::from(index > 0);
        if bytes > SNAPSHOT_BYTES {
            return Err(EngineError::TooLarge);
        }
        if index > 0 {
            hash.update(b",");
        }
        hash.update(encoded.as_bytes());
    }
    hash.update(b"]");
    Ok(format!("{:x}", hash.finalize()))
}
pub fn content_identity(concepts: Vec<Concept>) -> Result<(String, usize), EngineError> {
    let concepts = ordered(concepts)?;
    Ok((digest(&concepts)?, concepts.len()))
}
impl Terminus {
    /// Inspect a reserved staging branch, then verify its immutable commit. No mutation.
    pub async fn reconcile_snapshot(
        &self,
        reservation: Uuid,
        digest: String,
        count: usize,
    ) -> Result<Snapshot, EngineError> {
        let database = format!("cf_snapshot_{}", reservation.simple());
        let (_, version) = self
            .request(
                Method::GET,
                &["document", "admin", &database, "local", "branch", "main"],
                None,
                &[
                    ("as_list", "true"),
                    ("compress_ids", "true"),
                    ("type", "CortexConcept"),
                    ("count", "1"),
                ],
            )
            .await?;
        let commit = version
            .as_deref()
            .and_then(|s| s.strip_prefix("branch:"))
            .filter(|s| !s.is_empty())
            .ok_or(EngineError::InvalidResponse)?
            .to_owned();
        let snapshot = Snapshot {
            database,
            commit,
            digest,
            count,
        };
        self.read_snapshot(&snapshot).await?;
        Ok(snapshot)
    }

    /// Create a fresh private staging database; failure never advances a product version.
    /// Database-per-snapshot is deliberately conservative for the first integration.
    pub async fn stage_snapshot(&self, concepts: Vec<Concept>) -> Result<Snapshot, EngineError> {
        self.stage_snapshot_reserved(Uuid::new_v4(), concepts).await
    }
    /// The caller persists this reservation before any engine mutation.
    pub async fn stage_snapshot_reserved(
        &self,
        reservation: Uuid,
        concepts: Vec<Concept>,
    ) -> Result<Snapshot, EngineError> {
        let concepts = ordered(concepts)?;
        let content_digest = digest(&concepts)?;
        let database = format!("cf_snapshot_{}", reservation.simple());
        self.request(
            Method::POST,
            &["db", "admin", &database],
            Some(&json!({"label":"CortexFusion private snapshot","schema":true,"public":false})),
            &[],
        )
        .await?;
        let path = ["document", "admin", &database, "local", "branch", "main"];
        let (_, schema_version) = self
            .request(
                Method::POST,
                &path,
                Some(&schema()),
                &[
                    ("graph_type", "schema"),
                    ("author", "cortex-rust"),
                    ("message", "Snapshot schema v1"),
                ],
            )
            .await?;
        // Cross-batch cycles/forward links require every endpoint to exist.
        // This database remains private staging until complete immutable
        // readback succeeds and the caller activates the product pointer.
        let base_version = self.write_batches(&path, &concepts, true).await?;
        let linked_version = self.write_batches(&path, &concepts, false).await?;
        let version = linked_version.or(base_version).or(schema_version);
        let commit = version
            .as_deref()
            .and_then(|s| s.strip_prefix("branch:"))
            .filter(|s| !s.is_empty())
            .ok_or(EngineError::Uncertain)?
            .to_owned();
        let snapshot = Snapshot {
            database,
            commit,
            digest: content_digest,
            count: concepts.len(),
        };
        snapshot.validate().map_err(|_| EngineError::Uncertain)?;
        // Read-back pins an immutable commit and proves data conversion before activation.
        self.read_snapshot(&snapshot)
            .await
            .map_err(|_| EngineError::Uncertain)?;
        Ok(snapshot)
    }
    async fn write_batches(
        &self,
        path: &[&str],
        concepts: &[Concept],
        base: bool,
    ) -> Result<Option<String>, EngineError> {
        let mut batch = Vec::new();
        let mut bytes = 2usize;
        let mut version = None;
        let method = if base { Method::POST } else { Method::PUT };
        for concept in concepts.iter().filter(|c| base || !c.links.is_empty()) {
            let mut document = encode(concept);
            if base {
                document["links"] = json!([]);
            }
            let size = serde_json::to_vec(&document)
                .map_err(|_| EngineError::Configuration)?
                .len();
            if size + 2 > WRITE_DOCUMENT_BYTES {
                return Err(EngineError::TooLarge);
            }
            if !batch.is_empty()
                && (bytes + 1 + size > WRITE_BATCH_BYTES || batch.len() == WRITE_BATCH_DOCUMENTS)
            {
                version = self
                    .request(
                        method.clone(),
                        path,
                        Some(&Value::Array(std::mem::take(&mut batch))),
                        &[
                            ("author", "cortex-rust"),
                            ("message", "Private snapshot batch"),
                        ],
                    )
                    .await?
                    .1;
                bytes = 2;
            }
            bytes += size + usize::from(!batch.is_empty());
            batch.push(document);
        }
        if !batch.is_empty() {
            version = self
                .request(
                    method,
                    path,
                    Some(&Value::Array(batch)),
                    &[
                        ("author", "cortex-rust"),
                        ("message", "Private snapshot batch"),
                    ],
                )
                .await?
                .1;
        }
        Ok(version)
    }
    pub async fn read_snapshot(&self, snapshot: &Snapshot) -> Result<Vec<Concept>, EngineError> {
        snapshot.validate()?;
        if snapshot.count > SNAPSHOT_CONCEPTS {
            return Err(EngineError::TooLarge);
        }
        let mut concepts = Vec::new();
        let mut bytes = 2usize;
        let mut page_size = READ_PAGE_DOCUMENTS;
        loop {
            let skip = concepts.len().to_string();
            // One extra record detects a manifest that understates its count.
            let requested = page_size.min(snapshot.count.saturating_sub(concepts.len()) + 1);
            let count = requested.to_string();
            let response = self
                .request(
                    Method::GET,
                    &[
                        "document",
                        "admin",
                        &snapshot.database,
                        "local",
                        "commit",
                        &snapshot.commit,
                    ],
                    None,
                    &[
                        ("as_list", "true"),
                        ("compress_ids", "true"),
                        ("type", "CortexConcept"),
                        ("skip", &skip),
                        ("count", &count),
                    ],
                )
                .await;
            let (value, _) = match response {
                Err(EngineError::TooLarge) if requested > 1 => {
                    page_size = requested / 2;
                    continue;
                }
                other => other?,
            };
            let values = value.as_array().ok_or(EngineError::InvalidResponse)?;
            if values.len() > requested || concepts.len() + values.len() > snapshot.count {
                return Err(EngineError::InvalidResponse);
            }
            let received = values.len();
            for value in values {
                let concept = decode(value.clone())?;
                bytes += serde_json::to_vec(&concept)
                    .map_err(|_| EngineError::InvalidResponse)?
                    .len()
                    + 1;
                if bytes > SNAPSHOT_BYTES {
                    return Err(EngineError::TooLarge);
                }
                concepts.push(concept);
            }
            if received < requested {
                break;
            }
        }
        let concepts = ordered(concepts)?;
        if concepts.len() != snapshot.count || digest(&concepts)? != snapshot.digest {
            return Err(EngineError::InvalidResponse);
        }
        Ok(concepts)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Router,
        extract::{OriginalUri, Query},
        routing::get,
    };
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
    };

    fn concepts(count: usize, body: &str) -> Vec<Concept> {
        (0..count)
            .map(|i| Concept {
                concept_id: Uuid::from_u128(i as u128 + 1),
                title: format!("Synthetic {i} 🧠"),
                body: body.into(),
                maturity: "emerging".into(),
                sources: vec![SourceRef {
                    source_id: Uuid::nil(),
                    start: 0,
                    end: 1,
                }],
                links: vec![],
            })
            .collect()
    }

    #[test]
    fn incremental_digest_is_identical_to_legacy_array_encoding() {
        for count in [0, 1, 150] {
            let mut values = concepts(count, "Synthetic é🙂\n\\\" evidence");
            if count > 1 {
                let target_id = values.last().unwrap().concept_id;
                values[0].links.push(crate::knowledge::Link {
                    target_id,
                    kind: crate::knowledge::LinkKind::Associative,
                    primary: false,
                    weight: 0.0000001,
                });
            }
            assert_eq!(
                digest(&values).unwrap(),
                canonical::digest(&serde_json::to_value(&values).unwrap()).unwrap()
            );
        }
    }

    async fn paged_engine(
        values: Vec<Value>,
    ) -> (
        Terminus,
        Arc<Mutex<Vec<(usize, usize)>>>,
        tokio::task::JoinHandle<()>,
    ) {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let seen = calls.clone();
        let app = Router::new().fallback(get(
            move |Query(q): Query<HashMap<String, String>>, OriginalUri(uri): OriginalUri| {
                let seen = seen.clone();
                let values = values.clone();
                async move {
                    assert!(uri.path().ends_with("/local/commit/immutable"));
                    assert_eq!(q.get("type").unwrap(), "CortexConcept");
                    let skip = q["skip"].parse::<usize>().unwrap();
                    let count = q["count"].parse::<usize>().unwrap();
                    assert!((1..=READ_PAGE_DOCUMENTS).contains(&count));
                    seen.lock().unwrap().push((skip, count));
                    axum::Json(
                        values
                            .into_iter()
                            .skip(skip)
                            .take(count)
                            .collect::<Vec<_>>(),
                    )
                }
            },
        ));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let engine = Terminus::new(
            &format!("http://{}", listener.local_addr().unwrap()),
            "admin".into(),
            "synthetic".into(),
        )
        .unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (engine, calls, task)
    }

    fn manifest(values: &[Concept]) -> Snapshot {
        Snapshot {
            database: format!("cf_snapshot_{}", Uuid::nil().simple()),
            commit: "immutable".into(),
            digest: digest(values).unwrap(),
            count: values.len(),
        }
    }

    #[tokio::test]
    async fn reads_multiple_immutable_pages_and_adapts_to_large_unicode_documents() {
        let values = concepts(75, &"🧠".repeat(30000));
        let snapshot = manifest(&values);
        let (engine, calls, task) = paged_engine(values.iter().map(encode).collect()).await;
        let actual = engine.read_snapshot(&snapshot).await.unwrap();
        assert_eq!(actual.len(), 75);
        assert_eq!(digest(&actual).unwrap(), snapshot.digest);
        let calls = calls.lock().unwrap();
        assert_eq!(calls[0], (0, 64));
        assert_eq!(calls[1], (0, 32)); // 64 large Unicode bodies exceed the unchanged 4 MB guard.
        assert!(calls.len() >= 4);
        task.abort();
    }

    #[tokio::test]
    async fn incomplete_duplicate_extra_and_tampered_pages_are_rejected() {
        let values = concepts(70, "Synthetic evidence");
        let snapshot = manifest(&values);
        for fault in 0..4 {
            let mut documents: Vec<_> = values.iter().map(encode).collect();
            match fault {
                0 => {
                    documents.pop();
                }
                1 => documents[65] = documents[0].clone(),
                2 => documents.push(documents[0].clone()),
                _ => documents[65]["body"] = json!("Changed evidence"),
            }
            let (engine, _, task) = paged_engine(documents).await;
            assert!(matches!(
                engine.read_snapshot(&snapshot).await,
                Err(EngineError::InvalidResponse)
            ));
            task.abort();
        }
    }

    #[tokio::test]
    async fn impossible_manifest_count_is_rejected_before_network_io() {
        let mut snapshot = manifest(&[]);
        snapshot.count = SNAPSHOT_CONCEPTS + 1;
        let (engine, calls, task) = paged_engine(vec![]).await;
        assert!(matches!(
            engine.read_snapshot(&snapshot).await,
            Err(EngineError::TooLarge)
        ));
        assert!(calls.lock().unwrap().is_empty());
        task.abort();
    }
    #[test]
    fn typed_round_trip_and_dangling_target_rejected() {
        let value = json!({"concept_id":Uuid::nil(),"title":"🧠 concept","body":"évidence","maturity":"observed","sources":[{"source_id":Uuid::nil(),"start":0,"end":8}],"links":[]});
        let c: Concept = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(
            serde_json::to_value(decode(encode(&c)).unwrap()).unwrap(),
            value
        );
        let mut c = c;
        c.links.push(Link {
            target_id: Uuid::new_v4(),
            kind: crate::knowledge::LinkKind::Associative,
            primary: false,
            weight: 0.5,
        });
        assert!(ordered(vec![c]).is_err());
    }
    #[test]
    fn snapshot_cannot_point_at_branch_or_foreign_database() {
        let s = Snapshot {
            database: format!("cf_snapshot_{}", Uuid::nil().simple()),
            commit: "abc123".into(),
            digest: "a".repeat(64),
            count: 0,
        };
        assert!(s.validate().is_ok());
        assert!(
            Snapshot {
                commit: "../branch/main".into(),
                ..s.clone()
            }
            .validate()
            .is_err()
        );
        assert!(
            Snapshot {
                database: "existing_customer_db".into(),
                ..s
            }
            .validate()
            .is_err()
        );
    }
}
