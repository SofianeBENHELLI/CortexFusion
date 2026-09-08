//! Durable attempt identities and SQL fencing, shared by publication and migration.
use crate::{auth::Principal, error::CoreError, snapshot::Snapshot};
use http::StatusCode;
use serde_json::Value;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Attempt {
    pub id: Uuid,
    pub generation: i64,
}
pub(crate) fn replaced() -> CoreError {
    CoreError {
        code: "GRAPH_ATTEMPT_REPLACED",
        message: "This graph attempt is no longer active; inspect its receipt",
        status: StatusCode::CONFLICT,
    }
}
pub(crate) async fn proof(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    attempt: &Attempt,
) -> Result<(), CoreError> {
    p.check_fresh()?;
    sqlx::query("SELECT set_config('cortex.graph_attempt_id',$1,true),set_config('cortex.graph_generation',$2,true),set_config('cortex.graph_actor',$3,true)")
        .bind(attempt.id.to_string()).bind(attempt.generation.to_string()).bind(&p.subject)
        .execute(&mut **tx).await.map_err(CoreError::sql)?;
    Ok(())
}
pub(crate) async fn reserve(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    version: i64,
    intent: &Value,
) -> Result<(Attempt, bool), CoreError> {
    let row=sqlx::query("SELECT id,generation,intent FROM cf_graph_preparations WHERE tenant_id=$1 AND domain_id=$2 AND version=$3 FOR UPDATE")
        .bind(&p.tenant).bind(domain).bind(version).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?;
    if let Some(row) = row {
        let saved: Option<Value> = row.get("intent");
        if saved.as_ref() != Some(intent) {
            return Err(CoreError::database());
        }
        return Ok((
            Attempt {
                id: Uuid::parse_str(row.get::<&str, _>("id")).map_err(|_| CoreError::database())?,
                generation: row.get("generation"),
            },
            true,
        ));
    }
    let attempt = Attempt {
        id: Uuid::new_v4(),
        generation: 1,
    };
    proof(tx, p, &attempt).await?;
    sqlx::query("INSERT INTO cf_graph_preparations(tenant_id,domain_id,version,id,generation,subject,status,intent) VALUES($1,$2,$3,$4,$5,$6,'preparing',$7)")
        .bind(&p.tenant).bind(domain).bind(version).bind(attempt.id.to_string()).bind(attempt.generation).bind(&p.subject).bind(intent)
        .execute(&mut **tx).await.map_err(CoreError::sql)?;
    sqlx::query("INSERT INTO cf_graph_attempts(tenant_id,domain_id,version,id,generation,subject,reason,intent) VALUES($1,$2,$3,$4,$5,$6,'Initial graph preparation',$7)")
        .bind(&p.tenant).bind(domain).bind(version).bind(attempt.id.to_string()).bind(attempt.generation).bind(&p.subject).bind(intent)
        .execute(&mut **tx).await.map_err(CoreError::sql)?;
    Ok((attempt, false))
}
pub(crate) async fn ensure_active(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    version: i64,
    attempt: &Attempt,
) -> Result<(), CoreError> {
    let row=sqlx::query("SELECT id,generation FROM cf_graph_preparations WHERE tenant_id=$1 AND domain_id=$2 AND version=$3 FOR UPDATE")
        .bind(&p.tenant).bind(domain).bind(version).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?.ok_or_else(replaced)?;
    if row.get::<&str, _>("id") != attempt.id.to_string()
        || row.get::<i64, _>("generation") != attempt.generation
    {
        return Err(replaced());
    }
    p.check_fresh()?;
    Ok(())
}
pub(crate) async fn mark(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    version: i64,
    attempt: &Attempt,
    status: &str,
) -> Result<(), CoreError> {
    proof(tx, p, attempt).await?;
    let count=sqlx::query("UPDATE cf_graph_preparations SET status=$6 WHERE tenant_id=$1 AND domain_id=$2 AND version=$3 AND id=$4 AND generation=$5")
        .bind(&p.tenant).bind(domain).bind(version).bind(attempt.id.to_string()).bind(attempt.generation).bind(status)
        .execute(&mut **tx).await.map_err(CoreError::sql)?.rows_affected();
    if count != 1 {
        return Err(replaced());
    }
    Ok(())
}
pub(crate) async fn manifest(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    version: i64,
    attempt: &Attempt,
    snapshot: &Snapshot,
) -> Result<(), CoreError> {
    ensure_active(tx, p, domain, version, attempt).await?;
    sqlx::query("INSERT INTO cf_graph_manifests(tenant_id,domain_id,version,attempt_id,generation,snapshot) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(&p.tenant).bind(domain).bind(version).bind(attempt.id.to_string()).bind(attempt.generation)
        .bind(serde_json::to_value(snapshot).map_err(|_|CoreError::database())?)
        .execute(&mut **tx).await.map_err(CoreError::sql)?;
    Ok(())
}
