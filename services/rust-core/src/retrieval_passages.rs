//! Bounded literal passages, independent of storage and without source mutation.
use crate::{knowledge::SourceRef, lexical, snapshot::Concept};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

/// Complete lines/sentences only; an oversized unit is not silently truncated.
/// All offsets are Unicode code points, including casefold-expanding characters.
fn passage_range(
    body: &str,
    title: &str,
    terms: &BTreeSet<String>,
    budget: usize,
) -> Option<(usize, usize)> {
    lexical::extractive_score(terms, title, body)?;
    let chars: Vec<char> = body.chars().collect();
    if chars.len() <= budget {
        return Some((0, chars.len()));
    }
    let required: BTreeSet<_> = terms.difference(&lexical::words(title)).cloned().collect();
    let mut units = Vec::new();
    let mut start = 0;
    for (i, &c) in chars.iter().enumerate() {
        if c == '\n'
            || (".!?。！？".contains(c) && chars.get(i + 1).is_none_or(|c| c.is_whitespace()))
        {
            units.push((start, i + 1));
            start = i + 1;
        }
    }
    if start < chars.len() {
        units.push((start, chars.len()));
    }
    let hits: Vec<BTreeSet<String>> = units
        .iter()
        .map(|&(a, b)| {
            lexical::words(&chars[a..b].iter().collect::<String>())
                .intersection(&required)
                .cloned()
                .collect()
        })
        .collect();
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    let mut left = 0;
    for (right, &(_, end)) in units.iter().enumerate() {
        for w in &hits[right] {
            *counts.entry(w.clone()).or_default() += 1;
        }
        while left <= right && end - units[left].0 > budget {
            for w in &hits[left] {
                let count = counts.get_mut(w).expect("active unit");
                *count -= 1;
                if *count == 0 {
                    counts.remove(w);
                }
            }
            left += 1;
        }
        if left <= right && required.iter().all(|w| counts.contains_key(w)) {
            // Keep the evidence and at most one neighbouring non-empty unit
            // on each side, instead of filling the budget with unrelated text.
            while left < right && hits[left].iter().all(|w| counts[w] > 1) {
                for w in &hits[left] {
                    *counts.get_mut(w).expect("active unit") -= 1;
                }
                left += 1;
            }
            let mut a = units[left].0;
            let mut end = end;
            if chars[a..end].iter().any(|c| !c.is_whitespace()) {
                let nonempty =
                    |&(a, b): &(usize, usize)| chars[a..b].iter().any(|c| !c.is_whitespace());
                if let Some(&(previous, _)) = units[..left].iter().rev().find(|u| nonempty(u))
                    && end - previous <= budget
                {
                    a = previous;
                }
                if let Some(&(_, following)) = units[right + 1..].iter().find(|u| nonempty(u))
                    && following - a <= budget
                {
                    end = following;
                }
                return Some((a, end));
            }
        }
    }
    None
}

pub(crate) struct Passage {
    pub value: Value,
    pub text: String,
    pub refs: Vec<SourceRef>,
    pub complete: bool,
}

/// A passage has its own explicit range; never return it as a mutated Concept.
pub(crate) fn select(c: &Concept, terms: &BTreeSet<String>, budget: usize) -> Option<Passage> {
    let body: Vec<char> = c.body.chars().collect();
    let (start, end, refs) = if body.len() <= budget {
        (0, body.len(), c.sources.clone())
    } else {
        let mut offset = 0;
        let mut found = None;
        for span in &c.sources {
            let length = span.end.checked_sub(span.start)?;
            let end = offset + length;
            let excerpt: String = body.get(offset..end)?.iter().collect();
            if let Some((a, b)) = passage_range(&excerpt, &c.title, terms, budget) {
                found = Some((
                    offset + a,
                    offset + b,
                    vec![SourceRef {
                        source_id: span.source_id,
                        start: span.start + a,
                        end: span.start + b,
                    }],
                ));
                break;
            }
            offset = end + 2;
        }
        found?
    };
    let text: String = body[start..end].iter().collect();
    Some(Passage {
        value: json!({"concept_id":c.concept_id,"title":c.title,"maturity":c.maturity,
            "body_start":start,"body_end":end,"body_total_chars":body.len(),
            "text":text,"sources":refs}),
        text,
        refs,
        complete: start == 0 && end == body.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn long_unicode_evidence_is_found_at_start_middle_and_end_without_mutation() {
        for position in [0, 100_000, 199_900] {
            let target = "La constellation violette contient 🧠 sept étoiles.\n";
            let mut body = "Bruit.\n".repeat(position / 7) + target;
            body.extend(
                "Bruit.\n"
                    .repeat(30_000)
                    .chars()
                    .take(200_000 - body.chars().count()),
            );
            let source = "🧠".repeat(13) + &body;
            let c = Concept {
                concept_id: Uuid::new_v4(),
                title: "Astronomie".into(),
                maturity: "emerging".into(),
                body: body.clone(),
                links: vec![],
                sources: vec![SourceRef {
                    source_id: Uuid::new_v4(),
                    start: 13,
                    end: 200_013,
                }],
            };
            let p = select(&c, &lexical::query_terms("constellation violette"), 100).unwrap();
            assert!(p.text.contains(target.trim_end()));
            assert!(p.text.chars().count() <= 100);
            assert_eq!(p.refs[0].excerpt(&source).unwrap(), p.text);
            assert_eq!(p.value["body_total_chars"], 200_000);
            assert!(!p.complete);
            assert_eq!(c.body, body);
        }
    }
    #[test]
    fn indivisible_or_distant_evidence_is_limited_instead_of_cut() {
        let terms = lexical::query_terms("quartz");
        assert_eq!(
            passage_range(&"quartz ".repeat(100), "Quartz", &terms, 100),
            None
        );
        assert_eq!(
            passage_range(&"Quartz.\n".repeat(100), "Guide", &terms, 0),
            None
        );
        let body =
            "Premier quartz.\n".to_owned() + &"Intermédiaire.\n".repeat(100) + "Dernier saphir.";
        assert_eq!(
            passage_range(&body, "Guide", &lexical::query_terms("quartz saphir"), 100),
            None
        );
    }
    #[test]
    fn casefold_expansion_preserves_unicode_positions() {
        let body =
            "Divers.\n".repeat(30) + "La Straße possède une entrée 🧠.\n" + &"Divers.\n".repeat(30);
        let (a, b) =
            passage_range(&body, "Guide", &lexical::query_terms("strasse entrée"), 100).unwrap();
        let text: String = body.chars().skip(a).take(b - a).collect();
        assert!(text.contains("Straße") && text.contains("entrée"));
    }
    #[test]
    fn generous_budget_does_not_bury_evidence_under_irrelevant_units() {
        let body = "Divers.\n".repeat(20_000)
            + "Le zircon possède sept faces.\n"
            + &"Divers.\n".repeat(20_000);
        let (a, b) =
            passage_range(&body, "Guide", &lexical::query_terms("zircon sept"), 8000).unwrap();
        let text: String = body.chars().skip(a).take(b - a).collect();
        assert!(text.contains("Le zircon possède sept faces."));
        assert!(text.chars().count() < 100);
        assert_eq!(text.matches("Divers.").count(), 2);
    }
    #[test]
    fn later_source_mapping_and_complete_concept_remain_distinct() {
        let first = "Introduction.\n".repeat(20);
        let second = "Contexte.\n".repeat(20) + "Le zircon possède sept faces.\n";
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let c = Concept {
            concept_id: Uuid::new_v4(),
            title: "Géologie".into(),
            maturity: "observed".into(),
            body: first.clone() + "\n\n" + &second,
            links: vec![],
            sources: vec![
                SourceRef {
                    source_id: a,
                    start: 50,
                    end: 50 + first.chars().count(),
                },
                SourceRef {
                    source_id: b,
                    start: 17,
                    end: 17 + second.chars().count(),
                },
            ],
        };
        let terms = lexical::query_terms("zircon sept");
        let p = select(&c, &terms, 100).unwrap();
        assert_eq!(p.refs[0].source_id, b);
        assert_eq!(
            p.refs[0].excerpt(&("x".repeat(17) + &second)).unwrap(),
            p.text
        );
        assert!(p.value["body_start"].as_u64().unwrap() >= first.chars().count() as u64 + 2);
        assert!(!p.complete);
        let full = select(&c, &terms, 8000).unwrap();
        assert!(full.complete);
        assert_eq!(full.text, c.body);
        assert_eq!(full.refs.len(), 2);
    }
}
