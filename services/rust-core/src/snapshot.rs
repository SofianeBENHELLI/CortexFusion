//! Typed immutable graph snapshots. This module never changes the published pointer.
use crate::{
    canonical,
    knowledge::{Link, SourceRef},
    terminus::{EngineError, Terminus},
};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Concept {
    pub concept_id: Uuid,
    pub title: String,
    pub body: String,
    pub maturity: String,
    pub sources: Vec<SourceRef>,
    pub links: Vec<Link>,
}
impl Concept {
    pub fn validate(&self) -> Result<(), EngineError> {
        if !(1..=200).contains(&self.title.chars().count())
            || !(1..=30000).contains(&self.body.chars().count())
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    canonical::digest(&serde_json::to_value(concepts).map_err(|_| EngineError::InvalidResponse)?)
        .map_err(|_| EngineError::InvalidResponse)
}
impl Terminus {
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
        let documents = Value::Array(concepts.iter().map(encode).collect());
        if serde_json::to_vec(&documents)
            .map_err(|_| EngineError::Configuration)?
            .len()
            > 4_000_000
        {
            return Err(EngineError::TooLarge);
        }
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
        let version = if concepts.is_empty() {
            schema_version
        } else {
            self.request(
                Method::POST,
                &path,
                Some(&documents),
                &[
                    ("author", "cortex-rust"),
                    ("message", "Prepared graph snapshot"),
                ],
            )
            .await?
            .1
        };
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
    pub async fn read_snapshot(&self, snapshot: &Snapshot) -> Result<Vec<Concept>, EngineError> {
        snapshot.validate()?;
        let (value, _) = self
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
                ],
            )
            .await?;
        let concepts = ordered(
            value
                .as_array()
                .ok_or(EngineError::InvalidResponse)?
                .iter()
                .cloned()
                .map(decode)
                .collect::<Result<Vec<_>, _>>()?,
        )?;
        if concepts.len() != snapshot.count || digest(&concepts)? != snapshot.digest {
            return Err(EngineError::InvalidResponse);
        }
        Ok(concepts)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
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
