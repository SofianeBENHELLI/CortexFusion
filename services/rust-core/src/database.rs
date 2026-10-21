use crate::{auth::Principal, error::CoreError};
use sqlx::{PgPool, Postgres, Transaction, postgres::PgConnectOptions};

#[derive(Clone)]
pub struct Database {
    pub pool: PgPool,
}
impl Database {
    pub async fn verify_role(&self) -> Result<(), CoreError> {
        let unsafe_role: bool = sqlx::query_scalar(
            "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(CoreError::sql)?;
        let owns:i64=sqlx::query_scalar("SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'cf_%' AND tableowner=current_user").fetch_one(&self.pool).await.map_err(|_|CoreError::database())?;
        if unsafe_role || owns != 0 {
            return Err(CoreError::database());
        }
        Ok(())
    }
    pub async fn transaction(
        &self,
        p: &Principal,
        domain: &str,
        owner: bool,
    ) -> Result<Transaction<'_, Postgres>, CoreError> {
        p.check_fresh()?;
        let mut tx = self.pool.begin().await.map_err(CoreError::sql)?;
        p.check_fresh()?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            .execute(&mut *tx)
            .await
            .map_err(CoreError::sql)?;
        sqlx::query("SELECT set_config('cortex.tenant',$1,true)")
            .bind(&p.tenant)
            .execute(&mut *tx)
            .await
            .map_err(CoreError::sql)?;
        let role: Option<String> = sqlx::query_scalar(
            "SELECT role FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3",
        )
        .bind(&p.tenant)
        .bind(domain)
        .bind(&p.subject)
        .fetch_optional(&mut *tx)
        .await
        .map_err(CoreError::sql)?;
        let role = role.ok_or_else(CoreError::not_found)?;
        if owner && role != "owner" {
            return Err(CoreError {
                code: "NOT_AUTHORIZED",
                message: "Domain owner required",
                status: http::StatusCode::FORBIDDEN,
            });
        }
        p.check_fresh()?;
        Ok(tx)
    }
}

impl Database {
    pub async fn locked_owner_transaction(
        &self,
        p: &Principal,
        domain: &str,
    ) -> Result<Transaction<'_, Postgres>, CoreError> {
        self.locked_permission_transaction(p, domain, &["owner"], "Domain owner required")
            .await
    }
    pub async fn locked_permission_transaction(
        &self,
        p: &Principal,
        domain: &str,
        roles: &[&str],
        message: &'static str,
    ) -> Result<Transaction<'_, Postgres>, CoreError> {
        p.check_fresh()?;
        let mut tx = self.pool.begin().await.map_err(CoreError::sql)?;
        p.check_fresh()?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
            .execute(&mut *tx)
            .await
            .map_err(CoreError::sql)?;
        sqlx::query("SELECT set_config('cortex.tenant',$1,true)")
            .bind(&p.tenant)
            .execute(&mut *tx)
            .await
            .map_err(CoreError::sql)?;
        let found: Option<String> =
            sqlx::query_scalar("SELECT id FROM cf_domains WHERE tenant_id=$1 AND id=$2 FOR UPDATE")
                .bind(&p.tenant)
                .bind(domain)
                .fetch_optional(&mut *tx)
                .await
                .map_err(CoreError::sql)?;
        if found.is_none() {
            return Err(CoreError::not_found());
        }
        let role:Option<String>=sqlx::query_scalar("SELECT role FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 FOR SHARE").bind(&p.tenant).bind(domain).bind(&p.subject).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
        let role = role.ok_or_else(CoreError::not_found)?;
        if !roles.contains(&role.as_str()) {
            return Err(CoreError {
                code: "NOT_AUTHORIZED",
                message,
                status: http::StatusCode::FORBIDDEN,
            });
        }
        p.check_fresh()?;
        Ok(tx)
    }
}

/// Connection options with an upper bound for any single SQL statement, set once
/// per pooled connection (CORTEX_STATEMENT_TIMEOUT_SECONDS, 1-3600, default 60).
/// Tighter SET LOCAL limits (readiness, graph reads) still take precedence.
pub fn connect_options(url: &str, timeout: Option<&str>) -> Result<PgConnectOptions, &'static str> {
    let seconds = match timeout {
        None => 60,
        Some(raw) => raw
            .parse::<u64>()
            .ok()
            .filter(|s| (1..=3600).contains(s))
            .ok_or("CORTEX_STATEMENT_TIMEOUT_SECONDS must be 1-3600")?,
    };
    let options: PgConnectOptions = url.parse().map_err(|_| "Invalid database URL")?;
    Ok(options.options([("statement_timeout", format!("{seconds}s"))]))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn statement_timeout_is_bounded_and_defaults_to_one_minute() {
        let url = "postgresql://app@127.0.0.1/db";
        assert!(connect_options(url, None).is_ok());
        assert!(connect_options(url, Some("1")).is_ok());
        assert!(connect_options(url, Some("3600")).is_ok());
        for bad in ["0", "3601", "-5", "1.5", "soon", ""] {
            assert!(connect_options(url, Some(bad)).is_err(), "{bad}");
        }
        assert!(connect_options("not a url", None).is_err());
    }
}
