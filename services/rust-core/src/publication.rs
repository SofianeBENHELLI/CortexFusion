//! Targeted native publication: prepare graph first, atomically activate its manifest in SQL.
use crate::{
    auth::Principal,
    changes::{Change, apply_checked},
    error::CoreError,
    graph::GraphService,
    graph_attempts::{self, Attempt},
    snapshot::{Concept, Snapshot},
};
use http::StatusCode;
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction};
use std::collections::BTreeMap;
use uuid::Uuid;
fn failure(code: &'static str, message: &'static str) -> CoreError {
    CoreError {
        code,
        message,
        status: StatusCode::CONFLICT,
    }
}
struct Recipe {
    sequence: i64,
    published: i64,
    changes: Vec<Change>,
    sources: BTreeMap<Uuid, String>,
}
async fn recipe(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    id: &str,
    expected: i64,
) -> Result<Recipe, CoreError> {
    let published: i64 =
        sqlx::query_scalar("SELECT published_version FROM cf_domains WHERE tenant_id=$1 AND id=$2")
            .bind(&p.tenant)
            .bind(domain)
            .fetch_one(&mut **tx)
            .await
            .map_err(CoreError::sql)?;
    let row=sqlx::query("SELECT p.payload,p.validation,p.status,c.sequence,c.changes FROM cf_proposals p LEFT JOIN cf_commits c ON c.tenant_id=p.tenant_id AND c.domain_id=p.domain_id AND c.proposal_id=p.id WHERE p.tenant_id=$1 AND p.domain_id=$2 AND p.id=$3").bind(&p.tenant).bind(domain).bind(id).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
    let rows=sqlx::query("SELECT id,content FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND allowed_subjects ? $3 FOR SHARE").bind(&p.tenant).bind(domain).bind(&p.subject).fetch_all(&mut **tx).await.map_err(CoreError::sql)?;
    let sources: BTreeMap<Uuid, String> = rows
        .into_iter()
        .map(|r| {
            Ok((
                Uuid::parse_str(r.get::<&str, _>("id")).map_err(|_| CoreError::database())?,
                r.get("content"),
            ))
        })
        .collect::<Result<_, CoreError>>()?;
    let validation: Value = row.get("validation");
    if let Some(refs) = validation["source_ids"].as_array() {
        for id in refs {
            let id = id
                .as_str()
                .and_then(|s| Uuid::parse_str(s).ok())
                .ok_or_else(CoreError::database)?;
            if !sources.contains_key(&id) {
                return Err(CoreError::not_found());
            }
        }
    }
    let payload: Vec<Change> =
        serde_json::from_value(row.get("payload")).map_err(|_| CoreError::database())?;
    for change in &payload {
        let concept = match change {
            Change::PutConcept { concept } => Some(concept.clone()),
            Change::RetireConcept { concept_id } => {
                let raw: Option<Value> = sqlx::query_scalar(
                    "SELECT payload FROM cf_concepts WHERE tenant_id=$1 AND domain_id=$2 AND id=$3",
                )
                .bind(&p.tenant)
                .bind(domain)
                .bind(concept_id.to_string())
                .fetch_optional(&mut **tx)
                .await
                .map_err(CoreError::sql)?;
                raw.map(serde_json::from_value::<Concept>)
                    .transpose()
                    .map_err(|_| CoreError::database())?
            }
        };
        if concept.is_some_and(|c| {
            c.sources
                .iter()
                .any(|s| !sources.contains_key(&s.source_id))
        }) {
            return Err(CoreError::not_found());
        }
    }
    let status: &str = row.get("status");
    let sequence: Option<i64> = row.get("sequence");
    if !matches!(status, "approved" | "published") || sequence.is_none() {
        return Err(failure(
            "PUBLICATION_NOT_ACCEPTED",
            "Accept the target proposal before publication",
        ));
    }
    let sequence = sequence.unwrap();
    if expected.checked_add(1) != Some(sequence) {
        return Err(failure(
            "STALE_PUBLICATION",
            "Expected version does not identify this accepted change",
        ));
    }
    let changes: Vec<Change> =
        serde_json::from_value(row.get("changes")).map_err(|_| CoreError::database())?;
    Ok(Recipe {
        sequence,
        published,
        changes,
        sources,
    })
}
impl GraphService {
    pub async fn publish_target(
        &self,
        p: &Principal,
        domain: &str,
        id: &str,
        expected: i64,
    ) -> Result<Value, CoreError> {
        self.publish_attempt(p, domain, id, expected, None).await
    }
    pub(crate) async fn publish_attempt(
        &self,
        p: &Principal,
        domain: &str,
        id: &str,
        expected: i64,
        stage: Option<Attempt>,
    ) -> Result<Value, CoreError> {
        if expected < 0 {
            return Err(failure(
                "STALE_PUBLICATION",
                "Refresh the target and published version",
            ));
        }
        let mut tx = self.db.locked_owner_transaction(p, domain).await?;
        let initial = recipe(&mut tx, p, domain, id, expected).await?;
        if initial.sequence <= initial.published {
            p.check_fresh()?;
            return Ok(
                json!({"proposal_id":id,"target_version":initial.sequence,"published_version":initial.published,"changed":false}),
            );
        }
        if initial.published != expected {
            return Err(failure(
                "STALE_PUBLICATION",
                "Refresh the target and published version",
            ));
        }
        let raw:Option<Value>=sqlx::query_scalar("SELECT snapshot FROM cf_graph_manifests WHERE tenant_id=$1 AND domain_id=$2 AND version=$3").bind(&p.tenant).bind(domain).bind(expected).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
        let prior: Option<Snapshot> = raw
            .map(serde_json::from_value)
            .transpose()
            .map_err(|_| CoreError::database())?;
        if expected != 0 && prior.is_none() {
            return Err(CoreError::database());
        }
        tx.commit().await.map_err(CoreError::sql)?;
        let state: BTreeMap<Uuid, Concept> = if let Some(snapshot) = prior {
            self.engine
                .read_snapshot(&snapshot)
                .await
                .map_err(|_| CoreError::database())?
                .into_iter()
                .map(|c| (c.concept_id, c))
                .collect()
        } else {
            BTreeMap::new()
        };
        let mut tx = self.db.locked_owner_transaction(p, domain).await?;
        let current = recipe(&mut tx, p, domain, id, expected).await?;
        if current.published != expected {
            return Err(failure(
                "STALE_PUBLICATION",
                "Refresh the target and published version",
            ));
        }
        let state = apply_checked(&state, &current.changes, &current.sources)?;
        let concepts: Vec<Concept> = state.into_values().collect();
        let (expected_digest, expected_count) = crate::snapshot::content_identity(concepts.clone())
            .map_err(|_| CoreError::database())?;
        let intent = json!({"kind":"publish","proposal_id":id,"base_version":expected,"digest":expected_digest,"count":expected_count});
        let (reservation, reconcile) =
            graph_attempts::reserve(&mut tx, p, domain, current.sequence, &intent).await?;
        if stage
            .as_ref()
            .is_some_and(|requested| requested != &reservation)
        {
            return Err(graph_attempts::replaced());
        }
        tx.commit().await.map_err(CoreError::sql)?;
        let prepared = if reconcile && stage.is_none() {
            self.engine
                .reconcile_snapshot(reservation.id, expected_digest, expected_count)
                .await
        } else {
            self.engine
                .stage_snapshot_reserved(reservation.id, concepts)
                .await
        };
        let mut tx = self.db.locked_owner_transaction(p, domain).await?;
        let final_recipe = recipe(&mut tx, p, domain, id, expected).await?;
        if final_recipe.sequence <= final_recipe.published {
            p.check_fresh()?;
            return Ok(
                json!({"proposal_id":id,"target_version":final_recipe.sequence,"published_version":final_recipe.published,"changed":false}),
            );
        }
        if final_recipe.published != expected {
            return Err(failure(
                "STALE_PUBLICATION",
                "Refresh the target and published version",
            ));
        }
        let snapshot = match prepared {
            Ok(s) => s,
            Err(_) => {
                graph_attempts::mark(
                    &mut tx,
                    p,
                    domain,
                    current.sequence,
                    &reservation,
                    "uncertain",
                )
                .await?;
                tx.commit().await.map_err(CoreError::sql)?;
                return Err(CoreError::database());
            }
        };
        // Immutable accepted changes and source content cannot change between checks.
        // Current permissions are freshly locked by recipe before any activation.
        graph_attempts::manifest(
            &mut tx,
            p,
            domain,
            current.sequence,
            &reservation,
            &snapshot,
        )
        .await?;
        for change in &current.changes {
            match change {
                Change::PutConcept { concept } => {
                    sqlx::query("INSERT INTO cf_concepts(tenant_id,domain_id,id,payload,version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,domain_id,id) DO UPDATE SET payload=EXCLUDED.payload,version=EXCLUDED.version").bind(&p.tenant).bind(domain).bind(concept.concept_id.to_string()).bind(serde_json::to_value(concept).map_err(|_|CoreError::database())?).bind(current.sequence).execute(&mut *tx).await.map_err(CoreError::sql)?;
                }
                Change::RetireConcept { concept_id } => {
                    sqlx::query(
                        "DELETE FROM cf_concepts WHERE tenant_id=$1 AND domain_id=$2 AND id=$3",
                    )
                    .bind(&p.tenant)
                    .bind(domain)
                    .bind(concept_id.to_string())
                    .execute(&mut *tx)
                    .await
                    .map_err(CoreError::sql)?;
                }
            }
        }
        sqlx::query("INSERT INTO cf_publications(tenant_id,domain_id,sequence,publisher) VALUES($1,$2,$3,$4)").bind(&p.tenant).bind(domain).bind(current.sequence).bind(&p.subject).execute(&mut *tx).await.map_err(CoreError::sql)?;
        sqlx::query("UPDATE cf_outbox SET status='done',attempts=attempts+1 WHERE tenant_id=$1 AND domain_id=$2 AND sequence=$3").bind(&p.tenant).bind(domain).bind(current.sequence).execute(&mut *tx).await.map_err(CoreError::sql)?;
        sqlx::query("UPDATE cf_proposals SET status='published' WHERE tenant_id=$1 AND domain_id=$2 AND id=$3").bind(&p.tenant).bind(domain).bind(id).execute(&mut *tx).await.map_err(CoreError::sql)?;
        sqlx::query("UPDATE cf_domains SET published_version=$3 WHERE tenant_id=$1 AND id=$2")
            .bind(&p.tenant)
            .bind(domain)
            .bind(current.sequence)
            .execute(&mut *tx)
            .await
            .map_err(CoreError::sql)?;
        graph_attempts::mark(&mut tx, p, domain, current.sequence, &reservation, "ready").await?;
        p.check_fresh()?;
        tx.commit().await.map_err(CoreError::sql)?;
        Ok(
            json!({"proposal_id":id,"target_version":current.sequence,"published_version":current.sequence,"changed":true}),
        )
    }
}
