//! Migration bridge: native graph reads, immutable version manifests and durable preparation.
//! This imports an already published version; it does not approve or publish a proposal.
use crate::{
    auth::Principal,
    database::Database,
    error::CoreError,
    snapshot::{Concept, Snapshot},
    terminus::Terminus,
};
use serde_json::Value;
use sqlx::{Postgres, Transaction};
use std::collections::BTreeSet;
use uuid::Uuid;

#[derive(Clone)]
pub struct GraphService {
    pub db: Database,
    pub engine: Terminus,
}
async fn version(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
) -> Result<i64, CoreError> {
    sqlx::query_scalar("SELECT published_version FROM cf_domains WHERE tenant_id=$1 AND id=$2")
        .bind(&p.tenant)
        .bind(domain)
        .fetch_one(&mut **tx)
        .await
        .map_err(CoreError::sql)
}
async fn allowed(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
) -> Result<BTreeSet<Uuid>, CoreError> {
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND allowed_subjects ? $3 FOR SHARE",
    )
    .bind(&p.tenant)
    .bind(domain)
    .bind(&p.subject)
    .fetch_all(&mut **tx)
    .await
    .map_err(CoreError::sql)?;
    ids.into_iter()
        .map(|s| Uuid::parse_str(&s).map_err(|_| CoreError::database()))
        .collect()
}
impl GraphService {
    pub async fn concepts(&self, p: &Principal, domain: &str) -> Result<Vec<Concept>, CoreError> {
        Ok(self.published_concepts(p, domain).await?.1)
    }
    pub async fn published_concepts(
        &self,
        p: &Principal,
        domain: &str,
    ) -> Result<(i64, Vec<Concept>), CoreError> {
        let mut tx = self.db.transaction(p, domain, false).await?;
        let served = version(&mut tx, p, domain).await?;
        let raw:Option<Value>=sqlx::query_scalar("SELECT snapshot FROM cf_graph_manifests WHERE tenant_id=$1 AND domain_id=$2 AND version=$3")
            .bind(&p.tenant).bind(domain).bind(served).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
        let snapshot: Option<Snapshot> = raw
            .map(serde_json::from_value)
            .transpose()
            .map_err(|_| CoreError::database())?;
        if served != 0 && snapshot.is_none() {
            return Err(CoreError::database());
        }
        tx.commit().await.map_err(CoreError::sql)?;
        let concepts = match snapshot {
            Some(snapshot) => self
                .engine
                .read_snapshot(&snapshot)
                .await
                .map_err(|_| CoreError::database())?,
            None => Vec::new(),
        };
        // Re-authorize after network IO; no stale ACL or membership snapshot is reused.
        let mut tx = self.db.transaction(p, domain, false).await?;
        if version(&mut tx, p, domain).await? != served {
            return Err(CoreError::database());
        }
        let sources = allowed(&mut tx, p, domain).await?;
        let mut visible: Vec<Concept> = concepts
            .into_iter()
            .filter(|c| c.sources.iter().all(|s| sources.contains(&s.source_id)))
            .collect();
        let ids: BTreeSet<Uuid> = visible.iter().map(|c| c.concept_id).collect();
        for c in &mut visible {
            c.links.retain(|l| ids.contains(&l.target_id));
        }
        visible.sort_by(|a, b| (&a.title, a.concept_id).cmp(&(&b.title, b.concept_id)));
        tx.commit().await.map_err(CoreError::sql)?;
        p.check_fresh()?;
        Ok((served, visible))
    }
    /// Authenticated maintenance CLI uses the same journal/projection checks as HTTP/MCP.
    pub async fn import_published(
        &self,
        p: &Principal,
        domain: &str,
    ) -> Result<Snapshot, CoreError> {
        self.import_current_snapshot(p, domain).await
    }
}
