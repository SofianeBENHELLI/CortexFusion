//! Frozen Python 3.12 Unicode lexical semantics; no Python process at runtime.
use serde::Deserialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::OnceLock,
};
#[derive(Deserialize)]
struct UnicodeTable {
    casefold: BTreeMap<u32, String>,
    word_ranges: Vec<(u32, u32)>,
}
fn table() -> &'static UnicodeTable {
    static TABLE: OnceLock<UnicodeTable> = OnceLock::new();
    TABLE.get_or_init(|| {
        serde_json::from_str(include_str!("lexical-unicode.json"))
            .expect("checked-in Unicode table")
    })
}
pub fn casefold(value: &str) -> String {
    let t = table();
    let mut output = String::new();
    for c in value.chars() {
        if let Some(s) = t.casefold.get(&(c as u32)) {
            output.push_str(s);
        } else {
            output.push(c);
        }
    }
    output
}
fn word(c: char) -> bool {
    let n = c as u32;
    let ranges = &table().word_ranges;
    let i = ranges.partition_point(|(_, end)| *end < n);
    ranges.get(i).is_some_and(|(start, _)| *start <= n)
}
pub fn words(value: &str) -> BTreeSet<String> {
    let folded = casefold(value);
    folded
        .split(|c: char| !word(c))
        .filter(|s| s.chars().count() >= 3)
        .map(str::to_owned)
        .collect()
}
pub fn query_terms(value: &str) -> BTreeSet<String> {
    let mut terms = words(value);
    for stop in [
        "the", "what", "how", "does", "are", "and", "which", "who", "that", "this", "these", "les",
        "des", "une", "est", "quel", "quelle", "quels", "quelles", "pour", "que", "qui", "quoi",
        "comment", "dans", "avec", "sur", "elle", "elles", "ils", "ces", "cet", "cette",
    ] {
        terms.remove(stop);
    }
    terms
}
/// Conservative literal retrieval: every meaningful query term must occur in the
/// concept title or its evidence-backed body. This is not semantic entailment.
pub fn extractive_score(terms: &BTreeSet<String>, title: &str, body: &str) -> Option<usize> {
    if terms.is_empty() {
        return None;
    }
    let title_words = words(title);
    let body_words = words(body);
    let all = title_words
        .union(&body_words)
        .cloned()
        .collect::<BTreeSet<_>>();
    if !terms.is_subset(&all) {
        return None;
    }
    // Prefer focused title matches; stable concept ID remains the final tie-break.
    Some(terms.intersection(&title_words).count() * 2 + terms.intersection(&body_words).count())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn words_follow_python_unicode_boundaries() {
        assert_eq!(
            words("Straße ΣΊΓΜΑ İSTANBUL abc_def １２３ ᾲ")
                .into_iter()
                .collect::<Vec<_>>(),
            vec!["abc_def", "stanbul", "strasse", "σίγμα", "１２３"]
        );
        assert!(query_terms("the une what").is_empty());
    }
    #[test]
    fn subject_overlap_alone_does_not_answer_missing_facets() {
        let terms = query_terms("Quel pourcentage garantit le module Orion ?");
        assert_eq!(
            extractive_score(&terms, "Module Orion", "Orion analyse les données."),
            None
        );
        let terms = query_terms("Orion warranty");
        assert_eq!(
            extractive_score(&terms, "Orion", "Orion handles orders."),
            None
        );
    }
    #[test]
    fn focused_french_query_and_negation_are_preserved() {
        let terms = query_terms("Quelle est la marque de Orion ?");
        assert!(extractive_score(&terms, "Orion — marque", "La marque est Example.").is_some());
        assert_eq!(query_terms("what quelle comment"), BTreeSet::new());
        assert!(query_terms("Orion not certified").contains("not"));
        assert!(query_terms("Orion pas certifié").contains("pas"));
    }
    #[test]
    fn all_content_terms_are_required_without_cross_language_guessing() {
        assert_eq!(
            extractive_score(&query_terms("Orion prix"), "Orion", "Orion price."),
            None
        );
        assert!(
            extractive_score(
                &query_terms("preuve"),
                "Document",
                "Une preuve 🧠 synthétique."
            )
            .is_some()
        );
        assert!(
            extractive_score(
                &query_terms("Orion prix"),
                "Orion prix",
                "Voir les conditions."
            )
            .is_some()
        );
    }
}
