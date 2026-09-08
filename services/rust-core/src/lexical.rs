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
        "the", "what", "how", "does", "are", "and", "les", "des", "une", "est", "quel", "pour",
    ] {
        terms.remove(stop);
    }
    terms
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
}
