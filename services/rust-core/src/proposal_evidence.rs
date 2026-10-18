//! Exact proposal evidence, fetched only for relevant source identities/ranges.
//! The caller holds the same domain lock as source ACL and publication writers.
use crate::{
    auth::Principal,
    changes::{Change, SourceEvidence},
    error::CoreError,
    snapshot::Concept,
};
use http::StatusCode;
use sqlx::{Postgres, Row, Transaction};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

pub(crate) struct Evidence {
    lengths: BTreeMap<Uuid, usize>,
    excerpts: BTreeMap<(Uuid, usize, usize), String>,
}
fn invalid_span() -> CoreError {
    CoreError {
        status: StatusCode::UNPROCESSABLE_ENTITY,
        code: "VALIDATION_FAILED",
        message: "Invalid source span",
    }
}
impl SourceEvidence for Evidence {
    fn readable(&self, id: &Uuid) -> bool {
        self.lengths.contains_key(id)
    }
    fn validate_body(&self, concept: &Concept) -> Result<(), CoreError> {
        // Preserve the established per-span error order before checking text.
        for span in &concept.sources {
            let total = self
                .lengths
                .get(&span.source_id)
                .ok_or_else(CoreError::not_found)?;
            if span.start >= span.end || span.end > *total {
                return Err(invalid_span());
            }
        }
        let exact_length = joined_length(concept) == Some(concept.body.chars().count());
        if exact_length {
            let spans = concept
                .sources
                .iter()
                .map(|s| {
                    self.excerpts
                        .get(&(s.source_id, s.start, s.end))
                        .map(String::as_str)
                        .ok_or_else(CoreError::database)
                })
                .collect::<Result<Vec<_>, _>>()?;
            if concept.body == spans.join("\n\n") {
                return Ok(());
            }
        }
        Err(CoreError {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            code: "VALIDATION_FAILED",
            message: "This release accepts verbatim source excerpts only",
        })
    }
}
fn joined_length(c: &Concept) -> Option<usize> {
    c.sources.iter().try_fold(
        2usize.saturating_mul(c.sources.len().saturating_sub(1)),
        |n, s| s.end.checked_sub(s.start).and_then(|v| n.checked_add(v)),
    )
}

pub(crate) async fn load(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    state: &BTreeMap<Uuid, Concept>,
    changes: &[Change],
) -> Result<Evidence, CoreError> {
    let mut ids = BTreeSet::new();
    let mut ranges = BTreeSet::new();
    for change in changes {
        let (id, new) = match change {
            Change::PutConcept { concept } => (concept.concept_id, Some(concept)),
            Change::RetireConcept { concept_id } => (*concept_id, None),
        };
        for concept in [state.get(&id), new].into_iter().flatten() {
            ids.extend(concept.sources.iter().map(|s| s.source_id));
            // New targets in this batch contribute their own source identities
            // through their put. Existing targets retain current visibility.
            for target in concept.links.iter().filter_map(|l| state.get(&l.target_id)) {
                ids.extend(target.sources.iter().map(|s| s.source_id));
            }
        }
        if let Some(c) = new {
            let body_len = c.body.chars().count();
            // A concatenation longer than the submitted body cannot match.
            // Do not fetch huge invalid ranges or silently shorten any span.
            let joined = joined_length(c);
            if joined == Some(body_len) {
                ranges.extend(c.sources.iter().map(|s| (s.source_id, s.start, s.end)));
            }
        }
    }
    let ids: Vec<String> = ids.iter().map(Uuid::to_string).collect();
    let rows = sqlx::query("SELECT id,char_length(content) AS total FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND id=ANY($3::text[]) AND allowed_subjects ? $4 ORDER BY id FOR SHARE")
        .bind(&p.tenant).bind(domain).bind(&ids).bind(&p.subject).fetch_all(&mut **tx).await.map_err(CoreError::sql)?;
    let lengths: BTreeMap<Uuid, usize> = rows
        .into_iter()
        .map(|r| {
            Ok((
                Uuid::parse_str(r.get::<&str, _>("id")).map_err(|_| CoreError::database())?,
                r.get::<i32, _>("total") as usize,
            ))
        })
        .collect::<Result<_, CoreError>>()?;
    let mut evidence = Evidence {
        lengths,
        excerpts: BTreeMap::new(),
    };
    for (id, start, end) in ranges {
        if start >= end || evidence.lengths.get(&id).is_none_or(|total| end > *total) {
            continue;
        }
        let excerpt: String = sqlx::query_scalar("SELECT substring(content FROM $4 FOR $5) FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND id=$3")
            .bind(&p.tenant).bind(domain).bind(id.to_string()).bind((start + 1) as i32).bind((end - start) as i32)
            .fetch_one(&mut **tx).await.map_err(CoreError::sql)?;
        if excerpt.chars().count() != end - start {
            return Err(CoreError::database());
        }
        evidence.excerpts.insert((id, start, end), excerpt);
    }
    Ok(evidence)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::changes::{apply_checked, apply_checked_with_evidence};
    use crate::knowledge::SourceRef;
    use serde_json::json;

    fn bounded(full: &BTreeMap<Uuid, String>, changes: &[Change]) -> Evidence {
        let mut evidence = Evidence {
            lengths: full
                .iter()
                .map(|(id, s)| (*id, s.chars().count()))
                .collect(),
            excerpts: BTreeMap::new(),
        };
        for change in changes {
            if let Change::PutConcept { concept } = change {
                if joined_length(concept) == Some(concept.body.chars().count()) {
                    for span in &concept.sources {
                        if let Some(value) =
                            full.get(&span.source_id).and_then(|s| span.excerpt(s).ok())
                        {
                            evidence
                                .excerpts
                                .insert((span.source_id, span.start, span.end), value);
                        }
                    }
                }
            }
        }
        evidence
    }
    fn compare(state: &BTreeMap<Uuid, Concept>, changes: &[Change], full: &BTreeMap<Uuid, String>) {
        let normalize = |r: Result<BTreeMap<Uuid, Concept>, CoreError>| match r {
            Ok(v) => json!({"state":v}),
            Err(e) => json!({"status":e.status.as_u16(),"code":e.code,"message":e.message}),
        };
        assert_eq!(
            normalize(apply_checked(state, changes, full)),
            normalize(apply_checked_with_evidence(
                state,
                changes,
                &bounded(full, changes)
            ))
        );
    }
    fn concept(id: Uuid, source: Uuid) -> Concept {
        serde_json::from_value(json!({"concept_id":id,"title":"Preuve","body":"é🧠","sources":[{"source_id":source,"start":1,"end":3}],"links":[]})).unwrap()
    }
    #[test]
    fn bounded_evidence_matches_full_sources_for_text_ranges_and_error_precedence() {
        let s = Uuid::from_u128(1);
        let hidden = Uuid::from_u128(2);
        let id = Uuid::from_u128(3);
        let full = BTreeMap::from([(s, "xé🧠z".into())]);
        let good = concept(id, s);
        for (body, spans) in [
            (
                "é🧠",
                vec![SourceRef {
                    source_id: s,
                    start: 1,
                    end: 3,
                }],
            ),
            (
                "é🧠\n\nz",
                vec![
                    SourceRef {
                        source_id: s,
                        start: 1,
                        end: 3,
                    },
                    SourceRef {
                        source_id: s,
                        start: 3,
                        end: 4,
                    },
                ],
            ),
            ("Different", good.sources.clone()),
            ("éx", good.sources.clone()),
            (
                "x",
                vec![SourceRef {
                    source_id: s,
                    start: usize::MAX - 1,
                    end: usize::MAX,
                }],
            ),
            (
                "x",
                vec![
                    SourceRef {
                        source_id: s,
                        start: 1,
                        end: 3,
                    },
                    SourceRef {
                        source_id: hidden,
                        start: 0,
                        end: 1,
                    },
                ],
            ),
            (
                "x",
                vec![
                    SourceRef {
                        source_id: s,
                        start: 1,
                        end: 10,
                    },
                    SourceRef {
                        source_id: hidden,
                        start: 0,
                        end: 1,
                    },
                ],
            ),
        ] {
            let mut c = good.clone();
            c.body = body.into();
            c.sources = spans;
            compare(
                &BTreeMap::new(),
                &[Change::PutConcept { concept: c }],
                &full,
            );
        }
    }
    #[test]
    fn bounded_evidence_preserves_hidden_old_concepts_targets_and_graph_validation() {
        let s = Uuid::from_u128(1);
        let hidden = Uuid::from_u128(2);
        let a = Uuid::from_u128(3);
        let b = Uuid::from_u128(4);
        let full = BTreeMap::from([(s, "xé🧠z".into())]);
        let mut first = concept(a, s);
        let mut second = concept(b, hidden);
        let old = BTreeMap::from([(b, second.clone())]);
        compare(&old, &[Change::RetireConcept { concept_id: b }], &full);
        compare(
            &old,
            &[Change::PutConcept {
                concept: concept(b, s),
            }],
            &full,
        );
        first.links = serde_json::from_value(json!([{"target_id":b,"kind":"structural"}])).unwrap();
        compare(
            &old,
            &[Change::PutConcept {
                concept: first.clone(),
            }],
            &full,
        );
        second.sources = first.sources.clone();
        second.links =
            serde_json::from_value(json!([{"target_id":a,"kind":"structural"}])).unwrap();
        compare(
            &BTreeMap::new(),
            &[
                Change::PutConcept {
                    concept: first.clone(),
                },
                Change::PutConcept { concept: second },
            ],
            &full,
        );
        compare(
            &BTreeMap::new(),
            &[Change::PutConcept { concept: first }],
            &full,
        );
    }
}
