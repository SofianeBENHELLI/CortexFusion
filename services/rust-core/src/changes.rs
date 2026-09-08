//! Native deterministic proposal rules matching the historical governed graph.
use crate::{
    error::CoreError,
    knowledge::{LinkKind, validate_acyclic},
    snapshot::Concept,
};
use http::StatusCode;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Change {
    PutConcept { concept: Concept },
    RetireConcept { concept_id: Uuid },
}
fn invalid(message: &'static str) -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message,
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn visible(c: &Concept, sources: &BTreeMap<Uuid, String>) -> bool {
    c.sources.iter().all(|s| sources.contains_key(&s.source_id))
}
pub fn apply_checked(
    state: &BTreeMap<Uuid, Concept>,
    changes: &[Change],
    sources: &BTreeMap<Uuid, String>,
) -> Result<BTreeMap<Uuid, Concept>, CoreError> {
    if !(1..=50).contains(&changes.len()) {
        return Err(invalid("Expected between one and fifty changes"));
    }
    let mut result = state.clone();
    let mut touched = BTreeSet::new();
    for change in changes {
        let id = match change {
            Change::PutConcept { concept } => concept.concept_id,
            Change::RetireConcept { concept_id } => *concept_id,
        };
        if !touched.insert(id) {
            return Err(invalid("Each concept may be changed once per batch"));
        }
        if state.get(&id).is_some_and(|c| !visible(c, sources)) {
            return Err(CoreError::concept_not_found());
        }
        match change {
            Change::RetireConcept { .. } => {
                if result.remove(&id).is_none() {
                    return Err(invalid("Cannot retire a missing concept"));
                }
            }
            Change::PutConcept { concept } => {
                concept.validate().map_err(|_| invalid("Invalid concept"))?;
                let mut spans = Vec::new();
                for span in &concept.sources {
                    let content = sources
                        .get(&span.source_id)
                        .ok_or_else(CoreError::not_found)?;
                    spans.push(
                        span.excerpt(content)
                            .map_err(|_| invalid("Invalid source span"))?,
                    );
                }
                if concept.body != spans.join("\n\n") {
                    return Err(invalid(
                        "This release accepts verbatim source excerpts only",
                    ));
                }
                if concept.maturity == "reference" {
                    return Err(CoreError {
                        code: "REVIEW_POLICY_UNSUPPORTED",
                        message: "Reference maturity requires a later review policy",
                        status: StatusCode::UNPROCESSABLE_ENTITY,
                    });
                }
                result.insert(id, concept.clone());
            }
        }
    }
    for id in touched {
        if let Some(c) = result.get(&id) {
            for link in &c.links {
                if result
                    .get(&link.target_id)
                    .is_some_and(|target| !visible(target, sources))
                {
                    return Err(CoreError::not_found());
                }
            }
        }
    }
    validate_graph(&result)?;
    Ok(result)
}
/// Validate the entire graph, independent of a proposal's bounded change batch.
pub(crate) fn validate_graph(state: &BTreeMap<Uuid, Concept>) -> Result<(), CoreError> {
    let mut edges = BTreeMap::new();
    for (id, c) in state {
        if c.links.iter().filter(|l| l.primary).count() > 1 {
            return Err(invalid("One primary parent per concept"));
        }
        let unique: BTreeSet<_> = c
            .links
            .iter()
            .map(|l| {
                (
                    l.target_id,
                    if l.kind == LinkKind::Structural { 0 } else { 1 },
                )
            })
            .collect();
        if unique.len() != c.links.len() {
            return Err(invalid("Duplicate relationship"));
        }
        let mut next = Vec::new();
        for link in &c.links {
            let _target = state
                .get(&link.target_id)
                .ok_or_else(|| invalid("Relationship endpoint missing"))?;
            if link.kind == LinkKind::Structural {
                next.push(link.target_id);
            }
        }
        edges.insert(*id, next);
    }
    validate_acyclic(&edges).map_err(|_| invalid("Structural relationship cycle"))?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn concept(id: Uuid, source: Uuid) -> Concept {
        serde_json::from_value(json!({"concept_id":id,"title":"C","body":"é🧠","sources":[{"source_id":source,"start":0,"end":2}]})).unwrap()
    }
    #[test]
    fn changes_require_verbatim_access_and_preserve_graph_invariants() {
        let a = Uuid::from_u128(1);
        let b = Uuid::from_u128(2);
        let source = Uuid::from_u128(3);
        let sources = BTreeMap::from([(source, "é🧠".into())]);
        let c = concept(a, source);
        let put = Change::PutConcept { concept: c.clone() };
        let state = apply_checked(&BTreeMap::new(), std::slice::from_ref(&put), &sources).unwrap();
        assert!(apply_checked(&state, &[put.clone(), put], &sources).is_err());
        assert!(
            apply_checked(
                &state,
                &[Change::RetireConcept { concept_id: a }],
                &BTreeMap::new()
            )
            .is_err()
        );
        let mut c = c;
        c.body = "Invented".into();
        assert!(apply_checked(&state, &[Change::PutConcept { concept: c }], &sources).is_err());
        let mut first = concept(a, source);
        let mut second = concept(b, source);
        first.links = serde_json::from_value(json!([{"target_id":b,"kind":"structural"}])).unwrap();
        second.links =
            serde_json::from_value(json!([{"target_id":a,"kind":"structural"}])).unwrap();
        assert!(
            apply_checked(
                &BTreeMap::new(),
                &[
                    Change::PutConcept { concept: first },
                    Change::PutConcept { concept: second }
                ],
                &sources
            )
            .is_err()
        );
    }
}
