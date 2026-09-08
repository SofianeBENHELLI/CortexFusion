//! Owner-confirmed migration of a journal-backed published graph into TerminusDB.
//! Registration preserves both versions and the knowledge journal.
use crate::{
    auth::Principal,
    canonical,
    changes::{self, Change},
    confirmation::ConfirmedAction,
    error::CoreError,
    graph::GraphService,
    graph_attempts::{self, Attempt},
    server::StateData,
    snapshot::{self, Concept, Snapshot},
};
use axum::{
    Json, Router,
    extract::{Path, Query, RawQuery, State},
    response::IntoResponse,
    routing::{get, post},
};
use http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction, postgres::PgRow};
use std::collections::BTreeMap;
use uuid::Uuid;

fn conflict(code: &'static str, message: &'static str) -> CoreError {
    CoreError {
        code,
        message,
        status: StatusCode::CONFLICT,
    }
}
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Arguments do not match the graph import contract",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn uuid(s: &str) -> Result<String, CoreError> {
    Uuid::parse_str(s)
        .map(|u| u.to_string())
        .map_err(|_| CoreError::invalid_uuid())
}
fn fifty() -> usize {
    50
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AttemptsPage {
    version: Option<i64>,
    #[serde(default = "fifty")]
    limit: usize,
    #[serde(default)]
    after: i64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EventsPage {
    version: Option<i64>,
    #[serde(default = "fifty")]
    limit: usize,
    after: Option<Uuid>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ImportInput {
    #[serde(deserialize_with = "crate::publication_recovery::integer")]
    expected_published_version: i64,
    expected_projection_digest: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RetryInput {
    #[serde(deserialize_with = "crate::publication_recovery::integer")]
    expected_published_version: i64,
    expected_projection_digest: String,
    expected_attempt_id: Uuid,
    #[serde(deserialize_with = "crate::publication_recovery::integer")]
    expected_generation: i64,
    idempotency_key: String,
    reason: String,
}
fn validate_target(version: i64, digest: &str) -> Result<(), CoreError> {
    if version < 0
        || digest.len() != 64
        || !digest
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err(invalid());
    }
    Ok(())
}
struct Recipe {
    target: i64,
    published: i64,
    concepts: Vec<Concept>,
    digest: String,
    count: usize,
    manifest: Option<Snapshot>,
    projection_matches: Option<bool>,
}
impl Recipe {
    fn intent(&self) -> Value {
        json!({"kind":"import","base_version":self.target,"digest":self.digest,"count":self.count})
    }
    fn require_current(&self, digest: &str) -> Result<(), CoreError> {
        if self.target != self.published {
            return Err(conflict(
                "STALE_PUBLICATION",
                "Refresh the current published version",
            ));
        }
        if self.digest != digest {
            return Err(conflict(
                "GRAPH_IMPORT_DIGEST_CHANGED",
                "Refresh and confirm the complete journal-backed graph digest",
            ));
        }
        if self.manifest.is_none() && self.projection_matches != Some(true) {
            return Err(conflict(
                "GRAPH_IMPORT_PROJECTION_DIVERGED",
                "Repair the SQL projection from its journal before importing",
            ));
        }
        Ok(())
    }
}
async fn recipe(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    target: Option<i64>,
) -> Result<Recipe, CoreError> {
    let published: i64 =
        sqlx::query_scalar("SELECT published_version FROM cf_domains WHERE tenant_id=$1 AND id=$2")
            .bind(&p.tenant)
            .bind(d)
            .fetch_one(&mut **tx)
            .await
            .map_err(CoreError::sql)?;
    let target = target.unwrap_or(published);
    if target < 0 {
        return Err(invalid());
    }
    if target > published {
        return Err(conflict(
            "STALE_PUBLICATION",
            "The requested version has not been published",
        ));
    }
    let rows=sqlx::query("SELECT sequence,changes FROM cf_commits WHERE tenant_id=$1 AND domain_id=$2 AND sequence<=$3 ORDER BY sequence").bind(&p.tenant).bind(d).bind(target).fetch_all(&mut **tx).await.map_err(CoreError::sql)?;
    let mut state = BTreeMap::<Uuid, Concept>::new();
    let mut expected = 0i64;
    for row in rows {
        expected = expected.checked_add(1).ok_or_else(CoreError::database)?;
        if row.get::<i64, _>("sequence") != expected {
            return Err(CoreError::database());
        }
        let changes: Vec<Change> =
            serde_json::from_value(row.get("changes")).map_err(|_| CoreError::database())?;
        for change in changes {
            match change {
                Change::PutConcept { concept } => {
                    state.insert(concept.concept_id, concept);
                }
                Change::RetireConcept { concept_id } => {
                    state.remove(&concept_id);
                }
            }
        }
    }
    if expected != target {
        return Err(CoreError::database());
    }
    let sources = crate::retrieval::accessible(tx, p, d).await?;
    // Prove visibility of the complete target before returning diagnostics or identity.
    for c in state.values() {
        for span in &c.sources {
            if !sources.contains_key(&span.source_id) {
                return Err(CoreError::not_found());
            }
        }
    }
    for c in state.values() {
        c.validate().map_err(|_| invalid())?;
        let excerpts = c
            .sources
            .iter()
            .map(|span| {
                let source = sources
                    .get(&span.source_id)
                    .ok_or_else(CoreError::not_found)?;
                span.excerpt(source.get::<&str, _>("content"))
                    .map_err(|_| invalid())
            })
            .collect::<Result<Vec<_>, _>>()?;
        if c.body != excerpts.join("\n\n") {
            return Err(conflict(
                "GRAPH_IMPORT_EVIDENCE_INVALID",
                "Published concept content must match its exact source excerpts",
            ));
        }
    }
    changes::validate_graph(&state)?;
    let concepts: Vec<_> = state.into_values().collect();
    let (digest, count) =
        snapshot::content_identity(concepts.clone()).map_err(|_| CoreError::database())?;
    let raw:Option<Value>=sqlx::query_scalar("SELECT snapshot FROM cf_graph_manifests WHERE tenant_id=$1 AND domain_id=$2 AND version=$3").bind(&p.tenant).bind(d).bind(target).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?;
    let manifest = raw
        .map(serde_json::from_value::<Snapshot>)
        .transpose()
        .map_err(|_| CoreError::database())?;
    if manifest
        .as_ref()
        .is_some_and(|m| m.digest != digest || m.count != count)
    {
        return Err(conflict(
            "GRAPH_IMPORT_MANIFEST_DIVERGED",
            "The registered graph does not match the canonical journal",
        ));
    }
    let projection_matches = if target == published {
        let raw: Vec<Value> = sqlx::query_scalar(
            "SELECT payload FROM cf_concepts WHERE tenant_id=$1 AND domain_id=$2 ORDER BY id",
        )
        .bind(&p.tenant)
        .bind(d)
        .fetch_all(&mut **tx)
        .await
        .map_err(CoreError::sql)?;
        let current = raw
            .into_iter()
            .map(serde_json::from_value::<Concept>)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| CoreError::database())?;
        // SQL-only evidence must also be accessible before disclosing divergence.
        if current.iter().any(|c| {
            c.sources
                .iter()
                .any(|span| !sources.contains_key(&span.source_id))
        }) {
            return Err(CoreError::not_found());
        }
        Some(
            snapshot::content_identity(current).map_err(|_| CoreError::database())?
                == (digest.clone(), count),
        )
    } else {
        None
    };
    p.check_fresh()?;
    Ok(Recipe {
        target,
        published,
        concepts,
        digest,
        count,
        manifest,
        projection_matches,
    })
}
const ATTEMPTS: &str = "SELECT a.*,to_jsonb(a.created_at) AS created,(p.id=a.id AND p.generation=a.generation) AS active,CASE WHEN p.id=a.id AND p.generation=a.generation THEN p.status ELSE 'superseded' END AS status FROM cf_graph_attempts a JOIN cf_graph_preparations p ON p.tenant_id=a.tenant_id AND p.domain_id=a.domain_id AND p.version=a.version WHERE a.tenant_id=$1 AND a.domain_id=$2 AND a.version=$3 AND a.intent->>'kind' IN ('import','legacy_import')";
fn attempt(row: &PgRow) -> Result<Value, CoreError> {
    let intent: Value = row.get("intent");
    let sealed = intent["kind"] == "import";
    if !sealed && intent["kind"] != "legacy_import" {
        return Err(CoreError::database());
    }
    Ok(
        json!({"id":row.get::<String,_>("id"),"generation":row.get::<i64,_>("generation"),"predecessor_id":row.get::<Option<String>,_>("predecessor_id"),"subject":row.get::<String,_>("subject"),"reason":row.get::<String,_>("reason"),"created_at":row.get::<Value,_>("created"),"active":row.get::<bool,_>("active"),"status":row.get::<String,_>("status"),"intent_sealed":sealed,"base_version":row.get::<i64,_>("version"),"digest":if sealed{intent["digest"].clone()}else{Value::Null},"count":if sealed{intent["count"].clone()}else{Value::Null}}),
    )
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route("/v1/domains/{domain}/graph-import", post(import))
        .route(
            "/v1/domains/{domain}/graph-import-attempts",
            get(attempts).post(retry),
        )
        .route("/v1/domains/{domain}/graph-import-events", get(events))
}
async fn attempts(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    input: Result<Query<AttemptsPage>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let Query(q) = input.map_err(|_| invalid())?;
    if !(1..=100).contains(&q.limit) || !(0..i64::MAX).contains(&q.after) {
        return Err(invalid());
    }
    let mut tx = s.db.locked_owner_transaction(&p, &d).await?;
    let r = recipe(&mut tx, &p, &d, q.version).await?;
    let rows = sqlx::query(&format!(
        "{ATTEMPTS} AND a.generation>$4 ORDER BY a.generation LIMIT $5"
    ))
    .bind(&p.tenant)
    .bind(&d)
    .bind(r.target)
    .bind(q.after)
    .bind((q.limit + 1) as i64)
    .fetch_all(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    let active = sqlx::query(&format!(
        "{ATTEMPTS} AND p.id=a.id AND p.generation=a.generation"
    ))
    .bind(&p.tenant)
    .bind(&d)
    .bind(r.target)
    .fetch_optional(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    let next = if rows.len() > q.limit {
        json!(rows[q.limit - 1].get::<i64, _>("generation"))
    } else {
        Value::Null
    };
    let result = json!({"target_version":r.target,"published_version":r.published,"manifest_registered":r.manifest.is_some(),"digest":r.digest,"count":r.count,"projection_matches_journal":r.projection_matches,"active_attempt":active.as_ref().map(attempt).transpose()?,"items":rows.iter().take(q.limit).map(attempt).collect::<Result<Vec<_>,_>>()?,"next_after":next});
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
async fn events(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    input: Result<Query<EventsPage>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let Query(q) = input.map_err(|_| invalid())?;
    if !(1..=100).contains(&q.limit) {
        return Err(invalid());
    }
    let mut tx = s.db.locked_owner_transaction(&p, &d).await?;
    let r = recipe(&mut tx, &p, &d, q.version).await?;
    let filter = "FROM cf_graph_attempt_events e JOIN cf_graph_attempts a ON (a.tenant_id,a.domain_id,a.version,a.id,a.generation)=(e.tenant_id,e.domain_id,e.version,e.attempt_id,e.generation) WHERE e.tenant_id=$1 AND e.domain_id=$2 AND e.version=$3 AND a.intent->>'kind' IN ('import','legacy_import')";
    let cursor = if let Some(after) = q.after {
        sqlx::query_scalar::<_, i64>(&format!("SELECT e.ordinal {filter} AND e.id=$4"))
            .bind(&p.tenant)
            .bind(&d)
            .bind(r.target)
            .bind(after.to_string())
            .fetch_optional(&mut *tx)
            .await
            .map_err(CoreError::sql)?
            .ok_or_else(CoreError::not_found)?
    } else {
        0
    };
    let rows=sqlx::query(&format!("SELECT e.id,e.attempt_id,e.generation,e.subject,e.kind,to_jsonb(e.recorded_at) AS recorded {filter} AND e.ordinal>$4 ORDER BY e.ordinal LIMIT $5")).bind(&p.tenant).bind(&d).bind(r.target).bind(cursor).bind((q.limit+1)as i64).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let next = if rows.len() > q.limit {
        json!(rows[q.limit - 1].get::<String, _>("id"))
    } else {
        Value::Null
    };
    let items:Vec<Value>=rows.iter().take(q.limit).map(|r|json!({"id":r.get::<String,_>("id"),"attempt_id":r.get::<String,_>("attempt_id"),"generation":r.get::<i64,_>("generation"),"subject":r.get::<String,_>("subject"),"kind":r.get::<String,_>("kind"),"recorded_at":r.get::<Value,_>("recorded")})).collect();
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(json!({"items":items,"next_after":next})))
}
async fn import(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    q: RawQuery,
    proof: Option<axum::Extension<ConfirmedAction>>,
    body: axum::body::Bytes,
) -> axum::response::Response {
    command(s, d, h, q, proof, body, false).await
}
async fn retry(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    q: RawQuery,
    proof: Option<axum::Extension<ConfirmedAction>>,
    body: axum::body::Bytes,
) -> axum::response::Response {
    command(s, d, h, q, proof, body, true).await
}
async fn command(
    s: StateData,
    d: String,
    h: HeaderMap,
    RawQuery(query): RawQuery,
    proof: Option<axum::Extension<ConfirmedAction>>,
    body: axum::body::Bytes,
    retry: bool,
) -> axum::response::Response {
    let action = if retry {
        "graph.retry_import"
    } else {
        "graph.import_published"
    };
    let raw = serde_json::from_slice::<Value>(&body);
    let args = json!({"path":{"domain":d},"body":raw.as_ref().unwrap_or(&Value::Null)});
    let result: Result<Value, CoreError> = async {
        let p = s.auth.authenticate(&h)?;
        let d = uuid(&d)?;
        if query.is_some_and(|q| !q.is_empty()) {
            return Err(invalid());
        }
        let raw = raw.map_err(|_| invalid())?;
        let (initial, replacement) = if retry {
            let input: RetryInput = serde_json::from_value(raw).map_err(|_| invalid())?;
            validate_target(
                input.expected_published_version,
                &input.expected_projection_digest,
            )?;
            if !(1..i64::MAX).contains(&input.expected_generation)
                || !(8..=200).contains(&input.idempotency_key.chars().count())
                || !(1..=2000).contains(&input.reason.chars().count())
                || input.reason.trim().is_empty()
            {
                return Err(invalid());
            }
            (None, Some(input))
        } else {
            let input: ImportInput = serde_json::from_value(raw).map_err(|_| invalid())?;
            validate_target(
                input.expected_published_version,
                &input.expected_projection_digest,
            )?;
            (Some(input), None)
        };
        let tx = s.db.locked_owner_transaction(&p, &d).await?;
        tx.commit().await.map_err(CoreError::sql)?;
        if !proof
            .as_ref()
            .is_some_and(|v| v.subject == p.subject && v.tenant == p.tenant && v.action == action)
        {
            if h.get_all("x-cortex-confirmation").iter().count() > 1 {
                return Err(invalid());
            }
            s.confirmation
                .as_ref()
                .ok_or_else(crate::confirmation::required)?
                .consume(
                    &p,
                    &d,
                    action,
                    &args,
                    h.get("x-cortex-confirmation").and_then(|v| v.to_str().ok()),
                )
                .await?;
        }
        let graph = s.graph.as_ref().ok_or_else(CoreError::database)?;
        if let Some(input) = replacement {
            graph.retry_import(&p, &d, &input).await
        } else {
            graph
                .initial_import(&p, &d, &initial.ok_or_else(invalid)?)
                .await
        }
    }
    .await;
    match result {
        Ok(v)=>(if retry{StatusCode::CREATED}else{StatusCode::OK},Json(v)).into_response(),
        Err(e)if e.code=="CONFIRMATION_REQUIRED"=>(e.status,Json(json!({"error":e.code,"message":e.message,"confirmation_request":{"action":action,"command_hash":crate::confirmation::command_hash(action,&args).unwrap_or_default(),"transport_header":"X-Cortex-Confirmation","max_lifetime_seconds":300}}))).into_response(),
        Err(e)=>e.into_response(),
    }
}
async fn saved(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    input: &RetryInput,
    fingerprint: &str,
) -> Result<Option<Attempt>, CoreError> {
    let row=sqlx::query("SELECT id,generation,fingerprint FROM cf_graph_attempts WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND idempotency_key=$4").bind(&p.tenant).bind(d).bind(&p.subject).bind(&input.idempotency_key).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?;
    row.map(|r| {
        if r.get::<Option<&str>, _>("fingerprint") != Some(fingerprint) {
            return Err(conflict(
                "IDEMPOTENCY_CONFLICT",
                "This key identifies a different import decision",
            ));
        }
        Ok(Attempt {
            id: Uuid::parse_str(r.get::<&str, _>("id")).map_err(|_| CoreError::database())?,
            generation: r.get("generation"),
        })
    })
    .transpose()
}
async fn replaceable(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    input: &RetryInput,
) -> Result<(Recipe, Option<Value>), CoreError> {
    let r = recipe(tx, p, d, Some(input.expected_published_version)).await?;
    r.require_current(&input.expected_projection_digest)?;
    if r.manifest.is_some() {
        return Err(conflict(
            "GRAPH_IMPORT_ALREADY_REGISTERED",
            "The target already has an immutable graph manifest",
        ));
    }
    let row=sqlx::query("SELECT p.id,p.generation,p.intent,a.intent->>'kind' AS kind FROM cf_graph_preparations p JOIN cf_graph_attempts a ON (a.tenant_id,a.domain_id,a.version,a.id,a.generation)=(p.tenant_id,p.domain_id,p.version,p.id,p.generation) WHERE p.tenant_id=$1 AND p.domain_id=$2 AND p.version=$3 FOR UPDATE OF p").bind(&p.tenant).bind(d).bind(r.target).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?.ok_or_else(||conflict("GRAPH_IMPORT_NOT_PREPARED","Use the initial graph import action before requesting a replacement"))?;
    if row.get::<&str, _>("id") != input.expected_attempt_id.to_string()
        || row.get::<i64, _>("generation") != input.expected_generation
    {
        return Err(graph_attempts::replaced());
    }
    if !matches!(row.get::<&str, _>("kind"), "import" | "legacy_import") {
        return Err(conflict(
            "GRAPH_IMPORT_WRONG_ATTEMPT",
            "This reservation belongs to publication, not import",
        ));
    }
    Ok((r, row.get("intent")))
}
impl GraphService {
    pub(crate) async fn import_current_snapshot(
        &self,
        p: &Principal,
        d: &str,
    ) -> Result<Snapshot, CoreError> {
        let mut tx = self.db.locked_owner_transaction(p, d).await?;
        let r = recipe(&mut tx, p, d, None).await?;
        let input = ImportInput {
            expected_published_version: r.target,
            expected_projection_digest: r.digest,
        };
        tx.commit().await.map_err(CoreError::sql)?;
        let receipt = self.initial_import(p, d, &input).await?;
        if receipt["outcome"] != "registered" {
            return Err(CoreError::database());
        }
        let mut tx = self.db.locked_owner_transaction(p, d).await?;
        let r = recipe(&mut tx, p, d, Some(input.expected_published_version)).await?;
        let snapshot = r.manifest.ok_or_else(CoreError::database)?;
        p.check_fresh()?;
        tx.commit().await.map_err(CoreError::sql)?;
        Ok(snapshot)
    }
    async fn initial_import(
        &self,
        p: &Principal,
        d: &str,
        input: &ImportInput,
    ) -> Result<Value, CoreError> {
        let mut tx = self.db.locked_owner_transaction(p, d).await?;
        let r = recipe(&mut tx, p, d, Some(input.expected_published_version)).await?;
        // A previously registered historical target can be replayed without any engine IO.
        if r.digest != input.expected_projection_digest {
            return Err(conflict(
                "GRAPH_IMPORT_DIGEST_CHANGED",
                "Refresh and confirm the complete journal-backed graph digest",
            ));
        }
        if r.manifest.is_some() {
            p.check_fresh()?;
            tx.commit().await.map_err(CoreError::sql)?;
            return self.import_receipt(p, d, r.target, None).await;
        }
        r.require_current(&input.expected_projection_digest)?;
        let prior:Option<Option<Value>>=sqlx::query_scalar("SELECT intent FROM cf_graph_preparations WHERE tenant_id=$1 AND domain_id=$2 AND version=$3 FOR UPDATE").bind(&p.tenant).bind(d).bind(r.target).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
        if prior
            .as_ref()
            .is_some_and(|v| v.as_ref() != Some(&r.intent()))
        {
            return Err(conflict(
                "GRAPH_IMPORT_REPLACEMENT_REQUIRED",
                "Inspect the existing attempt and explicitly confirm its replacement",
            ));
        }
        let (a, reconcile) = graph_attempts::reserve(&mut tx, p, d, r.target, &r.intent()).await?;
        tx.commit().await.map_err(CoreError::sql)?;
        self.execute_import(
            p,
            d,
            r.target,
            &input.expected_projection_digest,
            a,
            !reconcile,
        )
        .await
    }
    async fn retry_import(
        &self,
        p: &Principal,
        d: &str,
        input: &RetryInput,
    ) -> Result<Value, CoreError> {
        let fingerprint=canonical::digest(&json!({"action":"graph.retry_import","tenant":p.tenant,"domain":d,"subject":p.subject,"input":input})).map_err(|_|invalid())?;
        let mut tx = self.db.locked_owner_transaction(p, d).await?;
        recipe(&mut tx, p, d, Some(input.expected_published_version)).await?;
        if let Some(a) = saved(&mut tx, p, d, input, &fingerprint).await? {
            tx.commit().await.map_err(CoreError::sql)?;
            return self
                .execute_import(
                    p,
                    d,
                    input.expected_published_version,
                    &input.expected_projection_digest,
                    a,
                    false,
                )
                .await;
        }
        let (r, old) = replaceable(&mut tx, p, d, input).await?;
        let desired = r.intent();
        tx.commit().await.map_err(CoreError::sql)?;
        // Unknown or intentionally replaced content is never adopted from old staging.
        let complete = if old.as_ref() == Some(&desired) {
            self.engine
                .reconcile_snapshot(input.expected_attempt_id, r.digest.clone(), r.count)
                .await
                .is_ok()
        } else {
            false
        };
        let mut tx = self.db.locked_owner_transaction(p, d).await?;
        recipe(&mut tx, p, d, Some(input.expected_published_version)).await?;
        if let Some(a) = saved(&mut tx, p, d, input, &fingerprint).await? {
            tx.commit().await.map_err(CoreError::sql)?;
            return self
                .execute_import(
                    p,
                    d,
                    input.expected_published_version,
                    &input.expected_projection_digest,
                    a,
                    false,
                )
                .await;
        }
        let (now, verified) = replaceable(&mut tx, p, d, input).await?;
        if now.intent() != desired || verified != old {
            return Err(conflict(
                "GRAPH_IMPORT_STATE_CHANGED",
                "Import state changed during reconciliation",
            ));
        }
        if complete {
            return Err(conflict(
                "GRAPH_IMPORT_READY_TO_RECONCILE",
                "The existing graph is complete; use the normal import action to reconcile it",
            ));
        }
        let a = Attempt {
            id: Uuid::new_v4(),
            generation: input.expected_generation + 1,
        };
        sqlx::query("INSERT INTO cf_graph_attempts(tenant_id,domain_id,version,id,generation,predecessor_id,subject,reason,idempotency_key,fingerprint,intent) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)").bind(&p.tenant).bind(d).bind(now.target).bind(a.id.to_string()).bind(a.generation).bind(input.expected_attempt_id.to_string()).bind(&p.subject).bind(&input.reason).bind(&input.idempotency_key).bind(&fingerprint).bind(&desired).execute(&mut *tx).await.map_err(CoreError::sql)?;
        graph_attempts::proof(&mut tx, p, &a).await?;
        let changed=sqlx::query("UPDATE cf_graph_preparations SET id=$4,generation=$5,intent=$6,status='preparing' WHERE tenant_id=$1 AND domain_id=$2 AND version=$3 AND id=$7 AND generation=$8").bind(&p.tenant).bind(d).bind(now.target).bind(a.id.to_string()).bind(a.generation).bind(&desired).bind(input.expected_attempt_id.to_string()).bind(input.expected_generation).execute(&mut *tx).await.map_err(CoreError::sql)?.rows_affected();
        if changed != 1 {
            return Err(graph_attempts::replaced());
        }
        p.check_fresh()?;
        tx.commit().await.map_err(CoreError::sql)?;
        self.execute_import(p, d, now.target, &input.expected_projection_digest, a, true)
            .await
    }
    async fn execute_import(
        &self,
        p: &Principal,
        d: &str,
        target: i64,
        digest: &str,
        a: Attempt,
        stage_once: bool,
    ) -> Result<Value, CoreError> {
        let before = self.import_receipt(p, d, target, Some(&a)).await?;
        if before["outcome"] != "unresolved" {
            return Ok(before);
        }
        let result = self
            .perform_import(p, d, target, digest, &a, stage_once)
            .await;
        if let Err(e) = result
            && e.status != StatusCode::SERVICE_UNAVAILABLE
            && e.code != "GRAPH_ATTEMPT_REPLACED"
        {
            return Err(e);
        }
        self.import_receipt(p, d, target, Some(&a)).await
    }
    async fn perform_import(
        &self,
        p: &Principal,
        d: &str,
        target: i64,
        digest: &str,
        a: &Attempt,
        stage_once: bool,
    ) -> Result<(), CoreError> {
        let mut tx = self.db.locked_owner_transaction(p, d).await?;
        let r = recipe(&mut tx, p, d, Some(target)).await?;
        r.require_current(digest)?;
        graph_attempts::ensure_active(&mut tx, p, d, target, a).await?;
        if r.manifest.is_some() {
            return Ok(());
        }
        let intent:Option<Value>=sqlx::query_scalar("SELECT intent FROM cf_graph_preparations WHERE tenant_id=$1 AND domain_id=$2 AND version=$3").bind(&p.tenant).bind(d).bind(target).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
        if intent.as_ref() != Some(&r.intent()) {
            return Err(conflict(
                "GRAPH_IMPORT_STATE_CHANGED",
                "The active attempt identifies different content",
            ));
        }
        tx.commit().await.map_err(CoreError::sql)?;
        let prepared = if stage_once {
            self.engine.stage_snapshot_reserved(a.id, r.concepts).await
        } else {
            self.engine
                .reconcile_snapshot(a.id, r.digest, r.count)
                .await
        };
        let mut tx = self.db.locked_owner_transaction(p, d).await?;
        let current = recipe(&mut tx, p, d, Some(target)).await?;
        graph_attempts::ensure_active(&mut tx, p, d, target, a).await?;
        // Concurrent GET reconciliation may already have registered this same attempt.
        if current.manifest.is_some() {
            return Ok(());
        }
        if let Err(e) = current.require_current(digest) {
            graph_attempts::mark(&mut tx, p, d, target, a, "stale").await?;
            tx.commit().await.map_err(CoreError::sql)?;
            return Err(e);
        }
        let snapshot = match prepared {
            Ok(s) => s,
            Err(_) => {
                graph_attempts::mark(&mut tx, p, d, target, a, "uncertain").await?;
                tx.commit().await.map_err(CoreError::sql)?;
                return Err(CoreError::database());
            }
        };
        graph_attempts::manifest(&mut tx, p, d, target, a, &snapshot).await?;
        graph_attempts::mark(&mut tx, p, d, target, a, "ready").await?;
        p.check_fresh()?;
        tx.commit().await.map_err(CoreError::sql)?;
        Ok(())
    }
    async fn import_receipt(
        &self,
        p: &Principal,
        d: &str,
        target: i64,
        a: Option<&Attempt>,
    ) -> Result<Value, CoreError> {
        let mut tx = self.db.locked_owner_transaction(p, d).await?;
        let r = recipe(&mut tx, p, d, Some(target)).await?;
        let row = if let Some(a) = a {
            Some(
                sqlx::query(&format!("{ATTEMPTS} AND a.id=$4 AND a.generation=$5"))
                    .bind(&p.tenant)
                    .bind(d)
                    .bind(target)
                    .bind(a.id.to_string())
                    .bind(a.generation)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(CoreError::sql)?
                    .ok_or_else(CoreError::not_found)?,
            )
        } else {
            sqlx::query(&format!(
                "{ATTEMPTS} AND p.id=a.id AND p.generation=a.generation"
            ))
            .bind(&p.tenant)
            .bind(d)
            .bind(target)
            .fetch_optional(&mut *tx)
            .await
            .map_err(CoreError::sql)?
        };
        let data = row.as_ref().map(attempt).transpose()?;
        let registered = if let Some(a) = a {
            sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM cf_graph_manifests WHERE tenant_id=$1 AND domain_id=$2 AND version=$3 AND attempt_id=$4 AND generation=$5)").bind(&p.tenant).bind(d).bind(target).bind(a.id.to_string()).bind(a.generation).fetch_one(&mut *tx).await.map_err(CoreError::sql)?
        } else {
            r.manifest.is_some()
        };
        let outcome = if registered {
            "registered"
        } else if data.as_ref().is_some_and(|v| v["active"] == false) {
            "superseded"
        } else {
            "unresolved"
        };
        let result = json!({"target_version":target,"published_version":r.published,"manifest_registered":r.manifest.is_some(),"attempt":data,"outcome":outcome});
        p.check_fresh()?;
        tx.commit().await.map_err(CoreError::sql)?;
        Ok(result)
    }
}
