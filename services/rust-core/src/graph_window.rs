//! Bounded graph transport backed by an immutable SQL read projection.
//! Cold construction verifies the full snapshot; warm reads return aggregates/pages.
use crate::{error::CoreError, server::StateData};
#[cfg(test)]
use crate::{knowledge::LinkKind, snapshot::Concept};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::get,
};
use http::{HeaderMap, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};
#[cfg(test)]
use sha2::{Digest, Sha256};
#[cfg(test)]
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

#[cfg(test)]
const EDGE_LIMIT: usize = 120;
const MAX_VERSION: i64 = 9_007_199_254_740_990;
fn default_limit() -> usize {
    24
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Window {
    #[serde(default = "default_limit")]
    limit: usize,
    after: Option<Uuid>,
    before: Option<Uuid>,
    locate: Option<Uuid>,
    at_version: Option<i64>,
    visibility: Option<String>,
    focus: Option<Uuid>,
    #[serde(default)]
    direction: Direction,
    search: Option<String>,
}
#[derive(Default, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum Direction {
    #[default]
    Both,
    Outgoing,
}
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Invalid graph window",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn changed() -> CoreError {
    CoreError {
        code: "CONCURRENT_CHANGE",
        message: "Graph version or visibility changed; refresh the graph",
        status: StatusCode::CONFLICT,
    }
}
impl Window {
    fn validate(&self) -> Result<(), CoreError> {
        if !(1..=50).contains(&self.limit)
            || self
                .at_version
                .is_some_and(|v| !(0..=MAX_VERSION).contains(&v))
            || (self.after.is_some() || self.before.is_some())
                && (self.at_version.is_none() || self.visibility.is_none())
            || [self.after, self.before, self.locate]
                .iter()
                .flatten()
                .count()
                > 1
            || self.focus.is_some() && self.limit < 2
            || self
                .search
                .as_ref()
                .is_some_and(|s| s.trim().is_empty() || s.chars().count() > 100)
            || self.search.is_some() && (self.focus.is_some() || self.locate.is_some())
            || self.visibility.as_ref().is_some_and(|s| {
                s.len() != 64
                    || !s
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            })
        {
            return Err(invalid());
        }
        Ok(())
    }
}
pub fn routes() -> Router<StateData> {
    Router::new().route("/v1/domains/{domain}/graph/window", get(read))
}
async fn read(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
    input: Result<Query<Window>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = Uuid::parse_str(&domain)
        .map_err(|_| CoreError::invalid_uuid())?
        .to_string();
    let Query(q) = input.map_err(|_| invalid())?;
    q.validate()?;
    let graph = s.graph.as_ref().ok_or_else(CoreError::database)?;
    let version = graph.ensure_read_projection(&p, &domain).await?;
    if !(0..=MAX_VERSION).contains(&version) {
        return Err(CoreError::database());
    }
    if q.at_version.is_some_and(|v| v != version) {
        return Err(changed());
    }
    let mut tx = graph
        .read_projection_transaction(&p, &domain, version)
        .await?;
    // A freshly inserted version has no column statistics yet. Even a custom
    // plan can estimate its visibility CTE as one row and repeatedly rescan it
    // for every edge. Prefer set joins for this whole-domain aggregation only;
    // concept detail keeps its indexed nested loops. The unavoidable bounds
    // cross join gets a large planner cost, so disable cost-triggered JIT here.
    // These settings are transaction-local; ACL locks and timeouts stay intact.
    sqlx::query("SET LOCAL enable_nestloop=off")
        .execute(&mut *tx)
        .await
        .map_err(CoreError::sql)?;
    sqlx::query("SET LOCAL jit=off")
        .execute(&mut *tx)
        .await
        .map_err(CoreError::sql)?;
    let term = q
        .search
        .as_ref()
        .map(|v| crate::lexical::casefold(v.trim()));
    let mut result: Value = sqlx::query_scalar(include_str!("sql/graph_window.sql"))
        .bind(&p.tenant)
        .bind(&domain)
        .bind(version)
        .bind(&p.subject)
        .bind(q.focus)
        .bind(q.direction == Direction::Outgoing)
        .bind(term)
        .bind(q.after)
        .bind(q.before)
        .bind(q.locate)
        .bind(q.limit as i64)
        .fetch_one(&mut *tx)
        .await
        .map_err(CoreError::sql)?;
    if q.visibility
        .as_ref()
        .is_some_and(|v| Some(v.as_str()) != result["visibility"].as_str())
    {
        return Err(changed());
    }
    if result["valid_focus"] != true || result["valid_locate"] != true {
        return Err(CoreError::concept_not_found());
    }
    if result["valid_search_cursor"] != true {
        return Err(invalid());
    }
    let object = result.as_object_mut().ok_or_else(CoreError::database)?;
    object.remove("valid_focus");
    object.remove("valid_locate");
    object.remove("valid_search_cursor");
    object.insert("search".into(), json!(q.search));
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    Ok(Json(result))
}

/// Input is already filtered by current source access and contains no hidden endpoints.
#[cfg(test)]
fn project(
    concepts: &[Concept],
    domain: &str,
    subject: &str,
    version: i64,
    q: &Window,
) -> Result<Value, CoreError> {
    q.validate()?;
    if !(0..=MAX_VERSION).contains(&version) {
        return Err(CoreError::database());
    }
    if q.at_version.is_some_and(|v| v != version) {
        return Err(changed());
    }
    let by_id: BTreeMap<_, _> = concepts.iter().map(|c| (c.concept_id, c)).collect();
    if by_id.len() != concepts.len() {
        return Err(CoreError::database());
    }
    // A coherence token, never an authorization token. Membership and ACL are read
    // again before every projection. Fixed-width UUIDs + length-delimited subject.
    let mut hash = Sha256::new();
    hash.update(b"cortex-graph-window-v1");
    hash.update(domain.as_bytes());
    hash.update(version.to_be_bytes());
    hash.update((subject.len() as u64).to_be_bytes());
    hash.update(subject.as_bytes());
    for id in by_id.keys() {
        hash.update(id.as_bytes());
    }
    let visibility = format!("{:x}", hash.finalize());
    if q.visibility.as_ref().is_some_and(|s| *s != visibility) {
        return Err(changed());
    }
    if q.focus.is_some_and(|id| !by_id.contains_key(&id)) {
        return Err(CoreError::concept_not_found());
    }
    let mut scope = BTreeSet::new();
    if let Some(id) = q.focus {
        scope.insert(id);
    }
    let mut incoming = BTreeMap::<Uuid, usize>::new();
    let mut domain_relations = 0;
    for c in by_id.values() {
        let mut unique = BTreeSet::new();
        for link in &c.links {
            let kind = match link.kind {
                LinkKind::Structural => 0,
                LinkKind::Associative => 1,
            };
            if !by_id.contains_key(&link.target_id) || !unique.insert((link.target_id, kind)) {
                return Err(CoreError::database());
            }
            *incoming.entry(link.target_id).or_default() += 1;
            domain_relations += 1;
            if q.focus == Some(c.concept_id) {
                scope.insert(link.target_id);
            }
            if q.direction == Direction::Both && q.focus == Some(link.target_id) {
                scope.insert(c.concept_id);
            }
        }
    }
    if q.focus.is_none() {
        scope.extend(by_id.keys().copied());
    }
    if let Some(search) = &q.search {
        let term = crate::lexical::casefold(search.trim());
        scope.retain(|id| {
            let c = by_id[id];
            crate::lexical::casefold(&c.title).contains(&term)
                || crate::lexical::casefold(&c.body).contains(&term)
        });
    }
    if q.locate.is_some_and(|id| !scope.contains(&id)) {
        return Err(CoreError::concept_not_found());
    }
    let scope_relations: usize = scope.iter().map(|id| by_id[id].links.len()).sum();
    // Pin the focus without duplicating it in the cursor stream. A page contains
    // at most limit summaries, including the focus. Incoming degree can be large.
    let rank = |id: &Uuid| {
        let Some(search) = &q.search else { return 0 };
        let term = crate::lexical::casefold(search.trim());
        let title = crate::lexical::casefold(&by_id[id].title);
        if title == term {
            0
        } else if title.starts_with(&term) {
            1
        } else if title.contains(&term) {
            2
        } else {
            3
        }
    };
    let mut stream: Vec<_> = scope
        .iter()
        .copied()
        .filter(|id| Some(*id) != q.focus)
        .collect();
    stream.sort_by_key(|id| (rank(id), *id));
    let page_size = q.limit - usize::from(q.focus.is_some());
    let start = if let Some(after) = q.after {
        if q.search.is_some() {
            stream
                .iter()
                .position(|id| *id == after)
                .ok_or_else(invalid)?
                + 1
        } else {
            stream.partition_point(|id| *id <= after)
        }
    } else if let Some(before) = q.before {
        if q.search.is_some() {
            stream
                .iter()
                .position(|id| *id == before)
                .ok_or_else(invalid)?
        } else {
            stream.partition_point(|id| *id < before)
        }
        .saturating_sub(page_size)
    } else if let Some(locate) = q.locate.filter(|id| Some(*id) != q.focus) {
        stream
            .binary_search(&locate)
            .map_err(|_| CoreError::concept_not_found())?
            / page_size
            * page_size
    } else {
        0
    };
    let end = (start + page_size).min(stream.len());
    let next = (end < stream.len()).then(|| stream[end - 1]);
    let previous = (start > 0 && start < stream.len()).then(|| stream[start]);
    let mut selected: BTreeSet<_> = stream[start..end].iter().copied().collect();
    if let Some(focus) = q.focus {
        selected.insert(focus);
    }
    let summary = |c: &Concept| {
        json!({
            "concept_id":c.concept_id,"title":c.title,"maturity":c.maturity,
            "source_count":c.sources.iter().map(|r|r.source_id).collect::<BTreeSet<_>>().len(),
            "outgoing_relations":c.links.len(),"incoming_relations":incoming.get(&c.concept_id).copied().unwrap_or(0)
        })
    };
    let mut ordered: Vec<_> = selected.iter().copied().collect();
    ordered.sort_by_key(|id| (rank(id), *id));
    let nodes: Vec<_> = ordered.iter().map(|id| summary(by_id[id])).collect();
    let mut edges = Vec::new();
    let mut internal = 0;
    let mut boundary = 0;
    for id in &selected {
        let c = by_id[id];
        let mut links: Vec<_> = c.links.iter().collect();
        links.sort_by_key(|l| {
            (
                l.target_id,
                match l.kind {
                    LinkKind::Structural => 0,
                    LinkKind::Associative => 1,
                },
            )
        });
        for l in links {
            if selected.contains(&l.target_id) {
                internal += 1;
                if edges.len() < EDGE_LIMIT {
                    edges.push(json!({"from":id,"to":l.target_id,"kind":l.kind,"weight":l.weight,"primary":l.primary}));
                }
            } else {
                boundary += 1;
            }
        }
    }
    Ok(json!({
        "domain_id":domain,"at_version":version,"visibility":visibility,
        "focus":q.focus.map(|id|summary(by_id[&id])),"after":q.after,"before":q.before,"locate":q.locate,"limit":q.limit,
        "direction":if q.direction == Direction::Both {"both"} else {"outgoing"},"search":q.search,
        "scope_ids":if q.focus.is_some() && q.direction == Direction::Outgoing {Some(scope.iter().copied().collect::<Vec<_>>())} else {None},
        "domain_totals":{"concepts":concepts.len(),"relations":domain_relations},
        "scope_totals":{"concepts":scope.len(),"relations":scope_relations},
        "nodes":nodes,"edges":edges,"next_after":next,"previous_before":previous,
        "internal_relations":internal,"boundary_outgoing_relations":boundary,
        "edges_truncated":internal > EDGE_LIMIT
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::knowledge::{Link, SourceRef};
    fn concepts(n: usize) -> Vec<Concept> {
        (1..=n)
            .map(|i| Concept {
                concept_id: Uuid::from_u128(i as u128),
                title: format!("Concept {i}"),
                body: "Long text stays on the server".into(),
                maturity: "observed".into(),
                sources: vec![SourceRef {
                    source_id: Uuid::from_u128(1000001),
                    start: 0,
                    end: 1,
                }],
                links: if i < n {
                    vec![Link {
                        target_id: Uuid::from_u128((i + 1) as u128),
                        kind: LinkKind::Associative,
                        weight: 0.5,
                        primary: false,
                    }]
                } else {
                    vec![]
                },
            })
            .collect()
    }
    fn q(v: Value) -> Window {
        serde_json::from_value(v).unwrap()
    }
    #[test]
    fn paging_neighborhoods_and_counts_have_one_scope() {
        let data = concepts(70);
        let mut request = q(json!({"limit":24}));
        let mut seen = BTreeSet::new();
        loop {
            let page = project(&data, "domain", "alice", 7, &request).unwrap();
            assert_eq!(page["domain_totals"], json!({"concepts":70,"relations":69}));
            assert_eq!(page["scope_totals"], page["domain_totals"]);
            let outgoing: usize = page["nodes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|n| n["outgoing_relations"].as_u64().unwrap() as usize)
                .sum();
            assert_eq!(
                outgoing,
                page["internal_relations"].as_u64().unwrap() as usize
                    + page["boundary_outgoing_relations"].as_u64().unwrap() as usize
            );
            for n in page["nodes"].as_array().unwrap() {
                assert!(seen.insert(n["concept_id"].as_str().unwrap().to_owned()));
                assert!(n.get("body").is_none());
                assert!(n.get("sources").is_none());
            }
            if page["next_after"].is_null() {
                break;
            }
            request = q(
                json!({"limit":24,"at_version":7,"after":page["next_after"],"visibility":page["visibility"]}),
            );
        }
        assert_eq!(seen.len(), 70);
        let page = project(
            &data,
            "domain",
            "alice",
            7,
            &q(json!({"focus":Uuid::from_u128(35)})),
        )
        .unwrap();
        assert_eq!(page["scope_totals"], json!({"concepts":3,"relations":3}));
        assert_eq!(page["internal_relations"], 2);
        assert_eq!(page["boundary_outgoing_relations"], 1);
        assert_eq!(page["focus"]["concept_id"], Uuid::from_u128(35).to_string());
    }
    #[test]
    fn version_and_visibility_changes_reject_page_continuation() {
        let mut data = concepts(5);
        let page = project(&data, "domain", "alice", 3, &q(json!({"limit":2}))).unwrap();
        let request = q(
            json!({"limit":2,"at_version":3,"after":page["next_after"],"visibility":page["visibility"]}),
        );
        assert_eq!(
            project(&data, "domain", "alice", 4, &request)
                .unwrap_err()
                .status,
            StatusCode::CONFLICT
        );
        assert_eq!(
            project(&data, "domain", "bob", 3, &request)
                .unwrap_err()
                .status,
            StatusCode::CONFLICT
        );
        data.pop();
        data.last_mut().unwrap().links.clear();
        assert_eq!(
            project(&data, "domain", "alice", 3, &request)
                .unwrap_err()
                .status,
            StatusCode::CONFLICT
        );
        assert_eq!(
            project(
                &data,
                "domain",
                "alice",
                3,
                &q(json!({"focus":Uuid::from_u128(5)}))
            )
            .unwrap_err()
            .status,
            StatusCode::NOT_FOUND
        );
    }
    #[test]
    fn dense_edges_are_explicitly_bounded_without_losing_their_count() {
        let mut data = concepts(24);
        for c in &mut data {
            c.links = (1..=24)
                .filter(|i| Uuid::from_u128(*i) != c.concept_id)
                .map(|i| Link {
                    target_id: Uuid::from_u128(i),
                    kind: LinkKind::Associative,
                    weight: 0.7,
                    primary: false,
                })
                .collect();
        }
        let page = project(&data, "domain", "alice", 1, &q(json!({}))).unwrap();
        assert_eq!(page["internal_relations"], 552);
        assert_eq!(page["edges"].as_array().unwrap().len(), EDGE_LIMIT);
        assert_eq!(page["edges_truncated"], true);
        data.reverse();
        for c in &mut data {
            c.links.reverse();
        }
        assert_eq!(
            project(&data, "domain", "alice", 1, &q(json!({}))).unwrap(),
            page
        );
    }
    #[test]
    fn transport_stays_bounded_on_synthetic_large_inputs() {
        for n in [1000, 10000, 100000] {
            let data = concepts(n);
            let page = project(&data, "domain", "alice", 1, &q(json!({}))).unwrap();
            assert_eq!(page["nodes"].as_array().unwrap().len(), 24);
            assert_eq!(page["scope_totals"]["concepts"], n);
            assert!(serde_json::to_vec(&page).unwrap().len() < 20000);
        }
    }
    #[test]
    fn rejects_ambiguous_requests_and_invalid_projection_inputs() {
        for value in [
            json!({"limit":0}),
            json!({"limit":51}),
            json!({"at_version":-1}),
            json!({"after":Uuid::nil()}),
            json!({"after":Uuid::nil(),"at_version":1}),
            json!({"visibility":"bad"}),
        ] {
            assert!(q(value).validate().is_err());
        }
        assert!(serde_json::from_value::<Window>(json!({"offset":1})).is_err());
        let page = project(&[], "domain", "alice", 0, &q(json!({}))).unwrap();
        assert_eq!(page["nodes"], json!([]));
        assert_eq!(page["scope_totals"], json!({"concepts":0,"relations":0}));
        let mut data = concepts(2);
        let duplicate = data[0].links[0].clone();
        data[0].links.push(duplicate);
        assert!(project(&data, "domain", "alice", 1, &q(json!({}))).is_err());
        data[0].links.pop();
        data.pop();
        assert!(project(&data, "domain", "alice", 1, &q(json!({}))).is_err());
    }

    #[test]
    fn backwards_location_and_pinned_outgoing_scope_are_complete() {
        let mut data = concepts(60);
        data[0].links = (2..=60)
            .map(|i| Link {
                target_id: Uuid::from_u128(i),
                kind: LinkKind::Associative,
                weight: 0.5,
                primary: false,
            })
            .collect();
        let page = project(&data, "domain", "alice", 1, &q(json!({"focus":data[0].concept_id,"direction":"outgoing","locate":data[50].concept_id}))).unwrap();
        assert_eq!(page["scope_ids"].as_array().unwrap().len(), 60);
        assert_eq!(page["nodes"].as_array().unwrap().len(), 14);
        assert!(
            page["nodes"]
                .as_array()
                .unwrap()
                .iter()
                .any(|n| n["concept_id"] == data[50].concept_id.to_string())
        );
        assert_eq!(
            page["nodes"][0]["concept_id"],
            data[0].concept_id.to_string()
        );
        let back = project(&data,"domain","alice",1,&q(json!({"focus":data[0].concept_id,"direction":"outgoing","before":page["previous_before"],"at_version":1,"visibility":page["visibility"]}))).unwrap();
        let forward = project(&data,"domain","alice",1,&q(json!({"focus":data[0].concept_id,"direction":"outgoing","after":back["next_after"],"at_version":1,"visibility":back["visibility"]}))).unwrap();
        assert_eq!(forward["nodes"], page["nodes"]);
        assert_eq!(forward["scope_totals"], page["scope_totals"]);
        let outgoing = project(
            &data,
            "domain",
            "alice",
            1,
            &q(json!({"focus":data[30].concept_id,"direction":"outgoing"})),
        )
        .unwrap();
        assert_eq!(outgoing["scope_totals"]["concepts"], 2);
    }
    #[test]
    fn search_ranks_titles_before_body_mentions_and_pages_in_both_directions() {
        let mut data = concepts(15);
        for c in &mut data {
            c.body = "The literal Straße reference".into();
        }
        data[14].title = "Straße".into();
        data[13].title = "Straße prefix".into();
        data[12].title = "A Straße mention".into();
        let expected: Vec<_> = [15, 14, 13]
            .into_iter()
            .chain(1..=12)
            .map(|id| Uuid::from_u128(id).to_string())
            .collect();
        let mut seen = Vec::new();
        let mut request = q(json!({"search":"STRASSE","limit":2}));
        loop {
            let page = project(&data, "domain", "alice", 1, &request).unwrap();
            seen.extend(
                page["nodes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|n| n["concept_id"].as_str().unwrap().to_owned()),
            );
            if !page["previous_before"].is_null() {
                let back = project(&data,"domain","alice",1,&q(json!({"search":"STRASSE","limit":2,"before":page["previous_before"],"at_version":1,"visibility":page["visibility"]}))).unwrap();
                let forward = project(&data,"domain","alice",1,&q(json!({"search":"STRASSE","limit":2,"after":back["next_after"],"at_version":1,"visibility":page["visibility"]}))).unwrap();
                assert_eq!(forward["nodes"], page["nodes"]);
            }
            if page["next_after"].is_null() {
                break;
            }
            request = q(
                json!({"search":"STRASSE","limit":2,"after":page["next_after"],"at_version":1,"visibility":page["visibility"]}),
            );
        }
        assert_eq!(seen, expected);
        let first = project(&data, "domain", "alice", 1, &q(json!({"search":"STRASSE"}))).unwrap();
        let bad = q(
            json!({"search":"STRASSE","after":Uuid::nil(),"at_version":1,"visibility":first["visibility"]}),
        );
        assert_eq!(
            project(&data, "domain", "alice", 1, &bad)
                .unwrap_err()
                .status,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    #[test]
    fn search_is_authorized_literal_unicode_and_navigation_parameters_are_exclusive() {
        let mut data = concepts(3);
        data[1].title = "Straße — Café".into();
        let page = project(&data, "domain", "alice", 1, &q(json!({"search":"STRASSE"}))).unwrap();
        assert_eq!(page["scope_totals"]["concepts"], 1);
        assert_eq!(page["domain_totals"]["concepts"], 3);
        assert_eq!(page["nodes"][0]["title"], "Straße — Café");
        for value in [
            json!({"focus":Uuid::nil(),"limit":1}),
            json!({"search":" "}),
            json!({"search":"a".repeat(101)}),
            json!({"focus":Uuid::nil(),"search":"a"}),
            json!({"locate":Uuid::nil(),"after":Uuid::nil(),"at_version":1,"visibility":"a".repeat(64)}),
        ] {
            assert!(q(value).validate().is_err());
        }
    }
}
