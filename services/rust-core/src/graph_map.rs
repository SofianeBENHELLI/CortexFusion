//! Compact navigation topology, without bodies. Documentary references remain
//! a separate, revision-checked local overlay and never become published links.
use crate::{error::CoreError, server::StateData};
use axum::{
    Json, Router,
    extract::{Path, State},
    routing::get,
};
use http::{HeaderMap, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Read,
};
use uuid::Uuid;

#[derive(Deserialize)]
struct Index {
    tenant: String,
    domain: String,
    nodes: Vec<Annotation>,
    references: Vec<(String, String)>,
}
#[derive(Deserialize)]
struct Annotation {
    id: String,
    body_hash: String,
    source_hashes: Vec<String>,
    group: String,
    territory: String,
}
fn limit() -> CoreError {
    CoreError {
        code: "MAP_CAPACITY_EXCEEDED",
        message: "Navigation topology exceeds its bounded capacity",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn project(
    raw: Value,
    index: Option<Index>,
    tenant: &str,
    domain: &str,
    version: i64,
) -> Result<Value, CoreError> {
    let nodes = raw["nodes"].as_array().ok_or_else(CoreError::database)?;
    let edges = raw["edges"].as_array().ok_or_else(CoreError::database)?;
    if nodes.len() > 10_000 || edges.len() > 200_000 {
        return Err(limit());
    }
    let by_id: BTreeMap<_, _> = nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n["concept_id"].as_str().unwrap_or(""), i))
        .collect();
    let mut annotations = BTreeMap::new();
    let mut references = BTreeSet::new();
    if let Some(index) = index.filter(|x| x.tenant == tenant && x.domain == domain) {
        for n in index.nodes {
            if let Some(&i) = by_id.get(n.id.as_str()) {
                let actual: BTreeSet<_> = nodes[i]["source_hashes"]
                    .as_array()
                    .ok_or_else(CoreError::database)?
                    .iter()
                    .filter_map(Value::as_str)
                    .collect();
                let expected: BTreeSet<_> = n.source_hashes.iter().map(String::as_str).collect();
                if nodes[i]["body_hash"].as_str() == Some(n.body_hash.as_str())
                    && !expected.is_empty()
                    && actual == expected
                {
                    annotations.insert(i, n);
                }
            }
        }
        for (a, b) in index.references {
            if let (Some(&a), Some(&b)) = (by_id.get(a.as_str()), by_id.get(b.as_str()))
                && annotations.contains_key(&a)
                && annotations.contains_key(&b)
                && a != b
            {
                references.insert((a, b));
            }
        }
    }
    let summaries: Vec<_> = nodes
        .iter()
        .enumerate()
        .map(|(i, n)| {
            json!({
                "id":n["concept_id"],"title":n["title"],"maturity":n["maturity"],
                "group":annotations.get(&i).map(|a|a.group.as_str()).unwrap_or("Concepts"),
                "territory":annotations.get(&i).map(|a|a.territory.as_str()).unwrap_or("Savoir")
            })
        })
        .collect();
    let mut links: Vec<Value> = edges
        .iter()
        .map(|e| {
            let a = by_id
                .get(e["origin"].as_str().unwrap_or(""))
                .ok_or_else(CoreError::database)?;
            let b = by_id
                .get(e["target"].as_str().unwrap_or(""))
                .ok_or_else(CoreError::database)?;
            Ok(json!([a, b, e["kind"], e["weight"]]))
        })
        .collect::<Result<_, CoreError>>()?;
    let reference_count = references.len();
    links.extend(
        references
            .into_iter()
            .map(|(a, b)| json!([a, b, "reference", null])),
    );
    let value = json!({"domain_id":domain,"at_version":version,"nodes":summaries,"edges":links,
        "published_relations":edges.len(),"documentary_references":reference_count});
    if serde_json::to_vec(&value)
        .map_err(|_| CoreError::database())?
        .len()
        > 8_000_000
    {
        return Err(limit());
    }
    Ok(value)
}
pub fn routes() -> Router<StateData> {
    Router::new().route("/v1/domains/{domain}/graph/map", get(read))
}
pub(crate) async fn read(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = Uuid::parse_str(&domain)
        .map_err(|_| CoreError::invalid_uuid())?
        .to_string();
    let graph = s.graph.as_ref().ok_or_else(CoreError::database)?;
    let version = graph.ensure_read_projection(&p, &domain).await?;
    let mut tx = graph
        .read_projection_transaction(&p, &domain, version)
        .await?;
    let bytes = documentary_bytes()?;
    let output = load(&mut tx, &p, &domain, version, bytes.as_deref()).await?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    Ok(Json(output))
}
/// Operator-owned local overlay. Hash the actual bytes on every cached read;
/// file metadata alone cannot fence an in-place replacement.
pub(crate) fn documentary_bytes() -> Result<Option<Vec<u8>>, CoreError> {
    let Some(path) = std::env::var_os("CORTEX_DOCUMENTARY_MAP_INDEX") else {
        return Ok(None);
    };
    let file = std::fs::File::open(path).map_err(|_| CoreError::database())?;
    let mut bytes = Vec::new();
    file.take(16_000_001)
        .read_to_end(&mut bytes)
        .map_err(|_| CoreError::database())?;
    if bytes.len() > 16_000_000 {
        return Err(limit());
    }
    Ok(Some(bytes))
}
pub(crate) async fn load(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    p: &crate::auth::Principal,
    domain: &str,
    version: i64,
    index_bytes: Option<&[u8]>,
) -> Result<Value, CoreError> {
    sqlx::query("SET LOCAL enable_nestloop=off")
        .execute(&mut **tx)
        .await
        .map_err(CoreError::sql)?;
    sqlx::query("SET LOCAL jit=off")
        .execute(&mut **tx)
        .await
        .map_err(CoreError::sql)?;
    let raw: Value = sqlx::query_scalar(include_str!("sql/graph_map.sql"))
        .bind(&p.tenant)
        .bind(domain)
        .bind(version)
        .bind(&p.subject)
        .fetch_one(&mut **tx)
        .await
        .map_err(CoreError::sql)?;
    let index = if let Some(bytes) = index_bytes {
        let index: Index = serde_json::from_slice(bytes).map_err(|_| CoreError::database())?;
        if index.nodes.len() > 10_000
            || index.references.len() > 200_000
            || index
                .nodes
                .iter()
                .any(|n| n.group.chars().count() > 200 || n.territory.chars().count() > 200)
        {
            return Err(limit());
        }
        Some(index)
    } else {
        None
    };
    project(raw, index, &p.tenant, domain, version)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn data() -> Value {
        json!({"nodes":[{"concept_id":"a","title":"A","maturity":"observed","body_hash":"h","source_hashes":["s"]},{"concept_id":"b","title":"B","maturity":"observed","body_hash":"h","source_hashes":["s"]}],"edges":[]})
    }
    fn index() -> Index {
        serde_json::from_value(json!({"tenant":"t","domain":"d","nodes":[{"id":"a","body_hash":"h","source_hashes":["s"],"group":"G","territory":"T"},{"id":"b","body_hash":"h","source_hashes":["s"],"group":"G","territory":"T"}],"references":[["a","b"],["a","b"],["a","hidden"]]})).unwrap()
    }
    #[test]
    fn references_are_distinct_from_published_relations() {
        let v = project(data(), Some(index()), "t", "d", 1).unwrap();
        assert_eq!(v["documentary_references"], 1);
        assert_eq!(v["published_relations"], 0);
        assert_eq!(v["edges"][0], json!([0, 1, "reference", null]));
        assert!(v["nodes"][0].get("body_hash").is_none());
    }
    #[test]
    fn hidden_or_stale_endpoints_never_leak() {
        let mut raw = data();
        raw["nodes"].as_array_mut().unwrap().pop();
        assert_eq!(
            project(raw, Some(index()), "t", "d", 1).unwrap()["documentary_references"],
            0
        );
        let mut raw = data();
        raw["nodes"][0]["source_hashes"] = json!(["changed"]);
        assert_eq!(
            project(raw, Some(index()), "t", "d", 1).unwrap()["documentary_references"],
            0
        );
        let mut raw = data();
        raw["nodes"][0]["body_hash"] = json!("changed");
        assert_eq!(
            project(raw, Some(index()), "t", "d", 1).unwrap()["documentary_references"],
            0
        );
    }
    #[test]
    fn overlay_is_scoped() {
        assert_eq!(
            project(data(), Some(index()), "other", "d", 1).unwrap()["documentary_references"],
            0
        );
        assert_eq!(
            project(data(), Some(index()), "t", "other", 1).unwrap()["documentary_references"],
            0
        );
    }
}
