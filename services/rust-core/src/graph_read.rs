//! Verified immutable SQL read projection. Cold construction is explicit and atomic;
//! warm windows do not load full concept bodies or a full graph into the process.
use crate::{auth::Principal, error::CoreError, graph::GraphService, snapshot::Snapshot};
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction};

pub(crate) fn changed() -> CoreError {
    CoreError {
        code: "CONCURRENT_CHANGE",
        message: "Graph version or visibility changed; refresh the graph",
        status: http::StatusCode::CONFLICT,
    }
}

impl GraphService {
    pub(crate) async fn ensure_read_projection(
        &self,
        p: &Principal,
        domain: &str,
    ) -> Result<i64, CoreError> {
        let mut tx = self.db.transaction(p, domain, false).await?;
        let row = sqlx::query("SELECT d.published_version, m.snapshot, r.digest FROM cf_domains d LEFT JOIN cf_graph_manifests m ON m.tenant_id=d.tenant_id AND m.domain_id=d.id AND m.version=d.published_version LEFT JOIN cf_graph_read_versions r ON r.tenant_id=m.tenant_id AND r.domain_id=m.domain_id AND r.version=m.version WHERE d.tenant_id=$1 AND d.id=$2")
            .bind(&p.tenant).bind(domain).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
        let version: i64 = row.get("published_version");
        if version == 0 {
            return Ok(0);
        }
        let snapshot: Snapshot = serde_json::from_value(
            row.get::<Option<Value>, _>("snapshot")
                .ok_or_else(CoreError::database)?,
        )
        .map_err(|_| CoreError::database())?;
        if let Some(digest) = row.get::<Option<String>, _>("digest") {
            if digest != snapshot.digest {
                return Err(CoreError::database());
            }
            return Ok(version);
        }
        tx.commit().await.map_err(CoreError::sql)?;
        // Never build from a principal-filtered graph. This is tenant-private derived
        // data; current source rights are evaluated independently for every read.
        let concepts = self
            .engine
            .read_published_snapshot(&snapshot)
            .await
            .map_err(|_| CoreError::database())?;
        let mut tx = self.db.transaction(p, domain, false).await?;
        let current: i64 = sqlx::query_scalar(
            "SELECT published_version FROM cf_domains WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        )
        .bind(&p.tenant)
        .bind(domain)
        .fetch_one(&mut *tx)
        .await
        .map_err(CoreError::sql)?;
        if current != version {
            return Err(changed());
        }
        let existing: Option<String> = sqlx::query_scalar("SELECT digest FROM cf_graph_read_versions WHERE tenant_id=$1 AND domain_id=$2 AND version=$3")
            .bind(&p.tenant).bind(domain).bind(version).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
        if let Some(digest) = existing {
            if digest != snapshot.digest {
                return Err(CoreError::database());
            }
            return Ok(version);
        }
        sqlx::query("INSERT INTO cf_graph_read_versions(tenant_id,domain_id,version,digest) VALUES($1,$2,$3,$4)")
            .bind(&p.tenant).bind(domain).bind(version).bind(&snapshot.digest).execute(&mut *tx).await.map_err(CoreError::sql)?;
        let mut batch = Vec::new();
        let mut bytes = 2;
        for c in concepts.iter() {
            let value = json!({"concept":c,"search_text":[crate::lexical::casefold(&c.title),crate::lexical::casefold(&c.body)]});
            let size = serde_json::to_vec(&value)
                .map_err(|_| CoreError::database())?
                .len()
                + 1;
            // One long body plus its folded index can exceed the normal batch.
            if size > 3_000_000 {
                return Err(CoreError::database());
            }
            if !batch.is_empty() && (bytes + size > 1_000_000 || batch.len() == 128) {
                insert_nodes(&mut tx, p, domain, version, &batch).await?;
                batch.clear();
                bytes = 2;
            }
            batch.push(value);
            bytes += size;
        }
        if !batch.is_empty() {
            insert_nodes(&mut tx, p, domain, version, &batch).await?;
        }
        sqlx::query("INSERT INTO cf_graph_read_sources(tenant_id,domain_id,version,concept_id,source_id) SELECT DISTINCT n.tenant_id,n.domain_id,n.version,n.concept_id,s->>'source_id' FROM cf_graph_read_nodes n CROSS JOIN LATERAL jsonb_array_elements(n.concept->'sources') s WHERE n.tenant_id=$1 AND n.domain_id=$2 AND n.version=$3")
            .bind(&p.tenant).bind(domain).bind(version).execute(&mut *tx).await.map_err(CoreError::sql)?;
        sqlx::query("INSERT INTO cf_graph_read_edges(tenant_id,domain_id,version,origin,target,kind,weight,is_primary) SELECT n.tenant_id,n.domain_id,n.version,n.concept_id,(e->>'target_id')::uuid,e->>'kind',(e->>'weight')::double precision,(e->>'primary')::boolean FROM cf_graph_read_nodes n CROSS JOIN LATERAL jsonb_array_elements(n.concept->'links') e WHERE n.tenant_id=$1 AND n.domain_id=$2 AND n.version=$3")
            .bind(&p.tenant).bind(domain).bind(version).execute(&mut *tx).await.map_err(CoreError::sql)?;
        p.check_fresh()?;
        tx.commit().await.map_err(CoreError::sql)?;
        Ok(version)
    }

    pub async fn read_concept(
        &self,
        p: &Principal,
        domain: &str,
        id: uuid::Uuid,
    ) -> Result<Value, CoreError> {
        let version = self.ensure_read_projection(p, domain).await?;
        let mut tx = self.read_projection_transaction(p, domain, version).await?;
        let value: Option<Value> = sqlx::query_scalar(include_str!("sql/graph_concept.sql"))
            .bind(&p.tenant)
            .bind(domain)
            .bind(version)
            .bind(&p.subject)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(CoreError::sql)?;
        let value = value.ok_or_else(CoreError::concept_not_found)?;
        p.check_fresh()?;
        tx.commit().await.map_err(CoreError::sql)?;
        p.check_fresh()?;
        Ok(value)
    }

    /// Lock authorization and version rows for this short SQL-only read. Competing
    /// ACL/membership/publication writers wait until its observation completes.
    pub(crate) async fn read_projection_transaction(
        &self,
        p: &Principal,
        domain: &str,
        version: i64,
    ) -> Result<Transaction<'_, Postgres>, CoreError> {
        let mut tx = self.db.transaction(p, domain, false).await?;
        sqlx::query("SET LOCAL statement_timeout='5000ms'")
            .execute(&mut *tx)
            .await
            .map_err(CoreError::sql)?;
        sqlx::query("SET LOCAL lock_timeout='2000ms'")
            .execute(&mut *tx)
            .await
            .map_err(CoreError::sql)?;
        // The same prepared window serves tiny neighborhoods and whole domains.
        // A generic plan can estimate the materialized visibility set as one row
        // and repeatedly scan it for every edge. Plan against this read's actual
        // tenant/version/focus parameters; authorization and locks are unchanged.
        sqlx::query("SET LOCAL plan_cache_mode='force_custom_plan'")
            .execute(&mut *tx)
            .await
            .map_err(CoreError::sql)?;
        let current: i64 = sqlx::query_scalar(
            "SELECT published_version FROM cf_domains WHERE tenant_id=$1 AND id=$2 FOR SHARE",
        )
        .bind(&p.tenant)
        .bind(domain)
        .fetch_one(&mut *tx)
        .await
        .map_err(CoreError::sql)?;
        if current != version {
            return Err(changed());
        }
        let role: Option<String> = sqlx::query_scalar("SELECT role FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 FOR SHARE")
            .bind(&p.tenant).bind(domain).bind(&p.subject).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
        if role.is_none() {
            return Err(CoreError::not_found());
        }
        // Aggregate over locks: no list of full sources or all source IDs crosses the wire.
        sqlx::query_scalar::<_,i64>("SELECT count(*) FROM (SELECT id FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 FOR SHARE) locked")
            .bind(&p.tenant).bind(domain).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
        Ok(tx)
    }
}
async fn insert_nodes(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    version: i64,
    batch: &[Value],
) -> Result<(), CoreError> {
    sqlx::query("INSERT INTO cf_graph_read_nodes(tenant_id,domain_id,version,concept_id,title,maturity,search_text,concept) SELECT $1,$2,$3,(v->'concept'->>'concept_id')::uuid,v->'concept'->>'title',v->'concept'->>'maturity',v->'search_text',v->'concept' FROM jsonb_array_elements($4::jsonb) v")
        .bind(&p.tenant).bind(domain).bind(version).bind(json!(batch)).execute(&mut **tx).await.map_err(CoreError::sql)?;
    Ok(())
}
