//! Deterministic knowledge rules. Transport and storage do not own these decisions.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum RuleError {
    #[error("source range is outside the Unicode code point sequence")]
    InvalidRange,
    #[error("a primary relation must be structural")]
    InvalidPrimary,
    #[error("relation weight must be finite and between zero and one")]
    InvalidWeight,
    #[error("structural graph contains a cycle")]
    Cycle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(try_from = "SourceRefWire")]
pub struct SourceRef {
    pub source_id: Uuid,
    pub start: usize,
    pub end: usize,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceRefWire {
    source_id: Uuid,
    start: usize,
    end: usize,
}
impl TryFrom<SourceRefWire> for SourceRef {
    type Error = RuleError;
    fn try_from(v: SourceRefWire) -> Result<Self, Self::Error> {
        if v.start >= v.end {
            return Err(RuleError::InvalidRange);
        }
        Ok(Self {
            source_id: v.source_id,
            start: v.start,
            end: v.end,
        })
    }
}
impl SourceRef {
    pub fn excerpt(&self, source: &str) -> Result<String, RuleError> {
        if self.start >= self.end {
            return Err(RuleError::InvalidRange);
        }
        // Keep Unicode code-point offsets while borrowing the UTF-8 range.
        // Only the returned excerpt is allocated, not every source character.
        let mut chars = source.chars();
        if self.start > 0 {
            chars.nth(self.start - 1).ok_or(RuleError::InvalidRange)?;
        }
        let tail = chars.as_str();
        chars
            .nth(self.end - self.start - 1)
            .ok_or(RuleError::InvalidRange)?;
        Ok(tail[..tail.len() - chars.as_str().len()].to_owned())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum LinkKind {
    Structural,
    Associative,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(try_from = "LinkWire")]
pub struct Link {
    pub target_id: Uuid,
    pub kind: LinkKind,
    #[serde(default)]
    pub primary: bool,
    #[serde(default = "one")]
    pub weight: f64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LinkWire {
    target_id: Uuid,
    kind: LinkKind,
    #[serde(default)]
    primary: bool,
    #[serde(default = "one")]
    weight: f64,
}
impl TryFrom<LinkWire> for Link {
    type Error = RuleError;
    fn try_from(v: LinkWire) -> Result<Self, Self::Error> {
        let link = Self {
            target_id: v.target_id,
            kind: v.kind,
            primary: v.primary,
            weight: v.weight,
        };
        link.validate()?;
        Ok(link)
    }
}
fn one() -> f64 {
    1.0
}
impl Link {
    pub fn validate(&self) -> Result<(), RuleError> {
        if self.primary && self.kind != LinkKind::Structural {
            return Err(RuleError::InvalidPrimary);
        }
        if !self.weight.is_finite() || !(0.0..=1.0).contains(&self.weight) {
            return Err(RuleError::InvalidWeight);
        }
        Ok(())
    }
}

pub fn validate_acyclic(edges: &BTreeMap<Uuid, Vec<Uuid>>) -> Result<(), RuleError> {
    // Iterative traversal avoids recursive stack exhaustion on long valid paths.
    let mut complete = BTreeSet::new();
    for root in edges.keys() {
        if complete.contains(root) {
            continue;
        }
        let mut active = BTreeSet::new();
        let mut stack = vec![(*root, false)];
        while let Some((node, leaving)) = stack.pop() {
            if leaving {
                active.remove(&node);
                complete.insert(node);
                continue;
            }
            if complete.contains(&node) {
                continue;
            }
            if !active.insert(node) {
                return Err(RuleError::Cycle);
            }
            stack.push((node, true));
            if let Some(next) = edges.get(&node) {
                for child in next.iter().rev() {
                    stack.push((*child, false));
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_ranges_match_unicode_codepoint_slices_and_extreme_bounds() {
        for source in ["", "a", "a🧠e\u{301}z", "\r\n你好אב🙂"] {
            let chars: Vec<char> = source.chars().collect();
            for start in 0..chars.len() + 3 {
                for end in 0..chars.len() + 3 {
                    let span = SourceRef {
                        source_id: Uuid::nil(),
                        start,
                        end,
                    };
                    let expected = if start < end && end <= chars.len() {
                        Ok(chars[start..end].iter().collect::<String>())
                    } else {
                        Err(RuleError::InvalidRange)
                    };
                    assert_eq!(span.excerpt(source), expected);
                }
            }
            for (start, end) in [
                (usize::MAX, usize::MAX),
                (0, usize::MAX),
                (usize::MAX - 1, usize::MAX),
            ] {
                assert_eq!(
                    SourceRef {
                        source_id: Uuid::nil(),
                        start,
                        end
                    }
                    .excerpt(source),
                    Err(RuleError::InvalidRange)
                );
            }
        }
    }
    #[test]
    fn evidence_uses_code_points_not_bytes_or_utf16() {
        let span = SourceRef {
            source_id: Uuid::nil(),
            start: 1,
            end: 3,
        };
        assert_eq!(span.excerpt("é🧠Z!").unwrap(), "🧠Z");
        assert!(SourceRef { end: 9, ..span }.excerpt("abc").is_err());
    }
    #[test]
    fn graph_shared_children_are_valid_but_cycles_fail() {
        let a = Uuid::from_u128(1);
        let b = Uuid::from_u128(2);
        let c = Uuid::from_u128(3);
        assert_eq!(
            validate_acyclic(&BTreeMap::from([(a, vec![b, c]), (b, vec![c])])),
            Ok(())
        );
        assert_eq!(
            validate_acyclic(&BTreeMap::from([(a, vec![b]), (b, vec![a])])),
            Err(RuleError::Cycle)
        );
    }
    #[test]
    fn deserialization_cannot_bypass_local_invariants() {
        let id = Uuid::nil();
        assert!(
            serde_json::from_value::<SourceRef>(
                serde_json::json!({"source_id":id,"start":3,"end":3})
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<Link>(
                serde_json::json!({"target_id":id,"kind":"associative","primary":true})
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<Link>(
                serde_json::json!({"target_id":id,"kind":"structural","weight":2.0})
            )
            .is_err()
        );
    }
    #[test]
    fn graph_long_chain_does_not_recurse() {
        let edges = (1..20000)
            .map(|i| (Uuid::from_u128(i), vec![Uuid::from_u128(i + 1)]))
            .collect();
        assert!(validate_acyclic(&edges).is_ok());
    }
}
