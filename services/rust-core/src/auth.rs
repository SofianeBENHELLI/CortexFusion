use crate::error::CoreError;
use http::HeaderMap;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Clone)]
pub struct Authenticator {
    key: DecodingKey,
    validation: Validation,
    issuer: String,
    audience: String,
}
#[derive(Debug, Clone)]
pub struct Principal {
    pub subject: String,
    pub tenant: String,
}
impl Authenticator {
    pub fn new(pem: &[u8], issuer: &str, audience: &str) -> Result<Self, CoreError> {
        let key = DecodingKey::from_rsa_pem(pem).map_err(|_| CoreError::auth())?;
        let mut validation = Validation::new(Algorithm::RS256);
        // Verify the signature/algorithm here. Claims are checked explicitly below
        // because jsonwebtoken and PyJWT differ on NumericDate and issuer coercion.
        validation.required_spec_claims.clear();
        validation.validate_exp = false;
        validation.validate_nbf = false;
        validation.validate_aud = false;
        if issuer.is_empty() || audience.is_empty() {
            return Err(CoreError::auth());
        }
        Ok(Self {
            key,
            validation,
            issuer: issuer.into(),
            audience: audience.into(),
        })
    }
    pub fn authenticate(&self, headers: &HeaderMap) -> Result<Principal, CoreError> {
        if headers.get_all("authorization").iter().count() != 1
            || headers.get_all("x-tenant-id").iter().count() != 1
        {
            return Err(CoreError::auth());
        }
        let token = headers
            .get("authorization")
            .and_then(|s| s.to_str().ok())
            .and_then(|s| s.strip_prefix("Bearer "))
            .ok_or_else(CoreError::auth)?;
        let tenant = headers
            .get("x-tenant-id")
            .and_then(|s| s.to_str().ok())
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or_else(CoreError::auth)?
            .to_string();
        let claims = decode::<Value>(token, &self.key, &self.validation)
            .map_err(|_| CoreError::auth())?
            .claims;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| CoreError::auth())?
            .as_secs_f64();
        let subject = validate_claims(&claims, &self.issuer, &self.audience, now)?;
        Ok(Principal {
            subject: subject.to_owned(),
            tenant,
        })
    }
}

fn numeric_date(value: &Value) -> Result<f64, CoreError> {
    let number = match value {
        Value::Number(n) => n.as_f64().ok_or_else(CoreError::auth)?,
        Value::String(s) => s.trim().parse::<i128>().map_err(|_| CoreError::auth())? as f64,
        Value::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        _ => return Err(CoreError::auth()),
    };
    if !number.is_finite() {
        return Err(CoreError::auth());
    }
    Ok(number.trunc())
}
fn validate_claims<'a>(
    claims: &'a Value,
    issuer: &str,
    audience: &str,
    now: f64,
) -> Result<&'a str, CoreError> {
    if claims["iss"].as_str() != Some(issuer) {
        return Err(CoreError::auth());
    }
    let audience_matches = match &claims["aud"] {
        Value::String(s) => s == audience,
        Value::Array(a) => {
            !a.is_empty()
                && a.iter().all(Value::is_string)
                && a.iter().any(|x| x.as_str() == Some(audience))
        }
        _ => false,
    };
    if !audience_matches {
        return Err(CoreError::auth());
    }
    if claims.get("jti").is_some_and(|value| !value.is_string()) {
        return Err(CoreError::auth());
    }
    let subject = claims["sub"]
        .as_str()
        .filter(|s| !s.is_empty() && s.chars().count() <= 300)
        .ok_or_else(CoreError::auth)?;
    if numeric_date(&claims["exp"])? <= now || numeric_date(&claims["iat"])? > now {
        return Err(CoreError::auth());
    }
    if let Some(nbf) = claims.get("nbf")
        && numeric_date(nbf)? > now
    {
        return Err(CoreError::auth());
    }
    Ok(subject)
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn explicit_claims_match_python_boundaries() {
        let base = json!({"sub":"alice","iss":"issuer","aud":"audience","iat":900,"exp":1001});
        assert!(validate_claims(&base, "issuer", "audience", 1000.4).is_ok());
        for (key, value) in [
            ("exp", json!(1000)),
            ("exp", json!(1000.9)),
            ("nbf", Value::Null),
            ("jti", Value::Null),
            ("jti", json!(7)),
            ("jti", json!([])),
            ("nbf", json!("demain")),
            ("nbf", json!("1002")),
            ("iss", json!(["issuer"])),
            ("aud", json!(["audience", 1])),
        ] {
            let mut claims = base.clone();
            claims[key] = value;
            assert!(
                validate_claims(&claims, "issuer", "audience", 1000.4).is_err(),
                "{claims}"
            );
        }
        for (key, value) in [
            ("exp", json!("1001")),
            ("iat", json!("900")),
            ("nbf", json!(1000.9)),
        ] {
            let mut claims = base.clone();
            claims[key] = value;
            assert!(
                validate_claims(&claims, "issuer", "audience", 1000.4).is_ok(),
                "{claims}"
            );
        }
    }
}
