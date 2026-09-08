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
        validation.leeway = 0;
        validation.validate_nbf = true;
        validation.set_required_spec_claims(&["exp", "iat", "iss", "aud", "sub"]);
        validation.set_issuer(&[issuer]);
        validation.set_audience(&[audience]);
        Ok(Self { key, validation })
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
        let subject = claims["sub"]
            .as_str()
            .filter(|s| !s.is_empty() && s.chars().count() <= 300)
            .ok_or_else(CoreError::auth)?;
        let iat = claims["iat"].as_f64().ok_or_else(CoreError::auth)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| CoreError::auth())?
            .as_secs_f64();
        if !iat.is_finite() || iat.trunc() > now {
            return Err(CoreError::auth());
        }
        Ok(Principal {
            subject: subject.to_owned(),
            tenant,
        })
    }
}
