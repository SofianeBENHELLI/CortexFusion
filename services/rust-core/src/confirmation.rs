//! Single-use RS256 confirmations for an exact canonical command, separate from identity.
use crate::{
    auth::{Authenticator, Principal},
    canonical,
    database::Database,
    error::CoreError,
};
use http::{HeaderMap, HeaderValue, StatusCode};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde_json::{Value, json};
use uuid::Uuid;

#[derive(Clone)]
pub struct ConfirmationVerifier {
    identity: Authenticator,
    key: DecodingKey,
    validation: Validation,
    pub db: Database,
}
fn error(code: &'static str, message: &'static str, status: StatusCode) -> CoreError {
    CoreError {
        code,
        message,
        status,
    }
}
fn invalid() -> CoreError {
    error(
        "CONFIRMATION_INVALID",
        "Confirmation is invalid, expired or does not match this action",
        StatusCode::FORBIDDEN,
    )
}
pub fn required() -> CoreError {
    error(
        "CONFIRMATION_REQUIRED",
        "A trusted-host confirmation is required for this exact action",
        StatusCode::PRECONDITION_REQUIRED,
    )
}
pub fn command_hash(action: &str, arguments: &Value) -> Result<String, CoreError> {
    canonical::digest(&json!({"action":action,"arguments":arguments})).map_err(|_| invalid())
}
impl ConfirmationVerifier {
    pub fn new(pem: &[u8], db: Database) -> Result<Self, CoreError> {
        let identity = Authenticator::new(pem, "cortex-trusted-host", "cortex-mcp-confirmation")
            .map_err(|_| invalid())?;
        let key = DecodingKey::from_rsa_pem(pem).map_err(|_| invalid())?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.required_spec_claims.clear();
        validation.validate_exp = false;
        validation.validate_nbf = false;
        validation.validate_aud = false;
        Ok(Self {
            identity,
            key,
            validation,
            db,
        })
    }
    pub async fn consume(
        &self,
        p: &Principal,
        domain: &str,
        action: &str,
        arguments: &Value,
        token: Option<&str>,
    ) -> Result<(), CoreError> {
        p.check_fresh()?;
        let token = token.filter(|s| !s.is_empty()).ok_or_else(required)?;
        let mut headers = HeaderMap::new();
        headers.insert(
            "authorization",
            HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| invalid())?,
        );
        headers.insert(
            "x-tenant-id",
            HeaderValue::from_str(&p.tenant).map_err(|_| invalid())?,
        );
        let confirmation = self
            .identity
            .authenticate(&headers)
            .map_err(|_| invalid())?;
        let claims = decode::<Value>(token, &self.key, &self.validation)
            .map_err(|_| invalid())?
            .claims;
        let iat = claims["iat"].as_i64().ok_or_else(invalid)?;
        let exp = claims["exp"].as_i64().ok_or_else(invalid)?;
        let ttl = exp.checked_sub(iat).ok_or_else(invalid)?;
        let id = claims["jti"].as_str().ok_or_else(invalid)?;
        Uuid::parse_str(id).map_err(|_| invalid())?;
        let hash = command_hash(action, arguments)?;
        if confirmation.subject != p.subject
            || claims["tenant"].as_str() != Some(&p.tenant)
            || claims["action"].as_str() != Some(action)
            || claims["command_hash"].as_str() != Some(&hash)
            || !(1..=300).contains(&ttl)
        {
            return Err(invalid());
        }
        let mut tx = self.db.locked_owner_transaction(p, domain).await?;
        confirmation.check_fresh().map_err(|_| invalid())?;
        let inserted=sqlx::query("INSERT INTO cf_mcp_confirmations(tenant_id,domain_id,id,subject,action,command_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING")
            .bind(&p.tenant).bind(domain).bind(id).bind(&p.subject).bind(action).bind(hash).execute(&mut *tx).await.map_err(CoreError::sql)?.rows_affected();
        if inserted != 1 {
            return Err(error(
                "CONFIRMATION_USED",
                "Confirmation already consumed; inspect state before preparing a new decision",
                StatusCode::CONFLICT,
            ));
        }
        p.check_fresh()?;
        confirmation.check_fresh().map_err(|_| invalid())?;
        tx.commit().await.map_err(CoreError::sql)?;
        Ok(())
    }
}
// In-process proof; no HTTP header can manufacture this value.
#[derive(Clone)]
pub(crate) struct ConfirmedAction {
    pub subject: String,
    pub tenant: String,
    pub action: &'static str,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn action_and_arguments_are_both_bound() {
        let args = json!({"path":{"domain":"00000000-0000-0000-0000-000000000001"},"body":{"weight":0.00001,"title":"é🧠"}});
        assert_ne!(
            command_hash("knowledge.publish", &args).unwrap(),
            command_hash("knowledge.approve", &args).unwrap()
        );
        assert_ne!(
            command_hash("knowledge.publish", &args).unwrap(),
            command_hash("knowledge.publish", &json!({})).unwrap()
        );
    }
}
