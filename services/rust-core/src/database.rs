use crate::{auth::Principal, error::CoreError};
use sqlx::{PgPool, Postgres, Transaction};

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
        let mut tx = self.pool.begin().await.map_err(CoreError::sql)?;
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
        Ok(tx)
    }
}
