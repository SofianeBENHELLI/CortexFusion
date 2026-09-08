//! Compatibility with Python json.dumps(sort_keys=True, separators=(",",":"), ensure_ascii=False).
//! This is a legacy wire digest format, not RFC 8785/JCS.
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Debug, thiserror::Error)]
#[error("unsupported JSON number")]
pub struct NumberError;

pub fn encode(value: &Value) -> Result<String, NumberError> {
    match value {
        Value::Null => Ok("null".into()),
        Value::Bool(x) => Ok(x.to_string()),
        Value::String(x) => Ok(serde_json::to_string(x).expect("string serialization")),
        Value::Number(x) => {
            let raw = x.to_string();
            if !raw.contains(['.', 'e', 'E']) {
                return Ok(raw);
            }
            float(x.as_f64().ok_or(NumberError)?)
        }
        Value::Array(items) => Ok(format!(
            "[{}]",
            items
                .iter()
                .map(encode)
                .collect::<Result<Vec<_>, _>>()?
                .join(",")
        )),
        Value::Object(items) => {
            let mut keys: Vec<_> = items.keys().collect();
            keys.sort();
            Ok(format!(
                "{{{}}}",
                keys.into_iter()
                    .map(|k| Ok(format!(
                        "{}:{}",
                        serde_json::to_string(k).expect("key"),
                        encode(&items[k])?
                    )))
                    .collect::<Result<Vec<_>, NumberError>>()?
                    .join(",")
            ))
        }
    }
}
fn float(f: f64) -> Result<String, NumberError> {
    if !f.is_finite() {
        return Err(NumberError);
    }
    if f == 0.0 {
        return Ok(if f.is_sign_negative() { "-0.0" } else { "0.0" }.into());
    }
    // Rust std formatting and Python choose different shortest decimals at some
    // binary ties. Ryu uses nearest/even selection compatible with Python repr.
    let mut buffer = ryu::Buffer::new();
    let raw = buffer.format_finite(f);
    let unsigned = raw.trim_start_matches('-');
    let (significand, offset) = if let Some((m, e)) = unsigned.split_once('e') {
        (m, e.parse::<i32>().map_err(|_| NumberError)?)
    } else {
        (unsigned, 0)
    };
    let integer_len = significand.find('.').unwrap_or(significand.len());
    let all_digits = significand.replace('.', "");
    let first = all_digits.find(|c| c != '0').ok_or(NumberError)?;
    let digits = all_digits[first..].trim_end_matches('0');
    let exp = offset + integer_len as i32 - first as i32 - 1;
    let sign = if f.is_sign_negative() { "-" } else { "" };
    let mantissa = if digits.len() == 1 {
        format!("{sign}{digits}")
    } else {
        format!("{sign}{}.{}", &digits[..1], &digits[1..])
    };
    if !(-4..16).contains(&exp) {
        return Ok(format!(
            "{mantissa}e{}{:#02}",
            if exp < 0 { "-" } else { "+" },
            exp.abs()
        ));
    }
    let sign = if f.is_sign_negative() { "-" } else { "" };
    let position = exp + 1;
    let decimal = if position <= 0 {
        format!("0.{}{}", "0".repeat((-position) as usize), digits)
    } else if position as usize >= digits.len() {
        format!(
            "{}{}.0",
            digits,
            "0".repeat(position as usize - digits.len())
        )
    } else {
        let (a, b) = digits.split_at(position as usize);
        format!("{a}.{b}")
    };
    Ok(format!("{sign}{decimal}"))
}
pub fn digest(value: &Value) -> Result<String, NumberError> {
    Ok(format!("{:x}", Sha256::digest(encode(value)?.as_bytes())))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn python_golden_vectors() {
        let fixtures: Value =
            serde_json::from_str(include_str!("../tests/canonical-vectors.json")).unwrap();
        for f in fixtures.as_array().unwrap() {
            assert_eq!(
                encode(&f["value"]).unwrap(),
                f["encoded"].as_str().unwrap(),
                "{}",
                f["value"]
            );
            assert_eq!(digest(&f["value"]).unwrap(), f["sha256"].as_str().unwrap());
        }
    }
}
