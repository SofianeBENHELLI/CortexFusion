//! Proposal preparation and decisions retain evidence access and immutable published bases.
use crate::{
    auth::Principal,
    canonical,
    changes::{Change, apply_checked},
    error::CoreError,
    server::StateData,
    snapshot::{Concept, Snapshot},
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::get,
};
use http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction, postgres::PgRow};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;
const WRITERS: &[&str] = &["owner", "agent", "contributor", "corpus_manager"];
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Arguments do not match the action contract",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn conflict(code: &'static str, message: &'static str) -> CoreError {
    CoreError {
        code,
        message,
        status: StatusCode::CONFLICT,
    }
}
fn missing() -> CoreError {
    CoreError {
        code: "NOT_FOUND",
        message: "Proposal not found",
        status: StatusCode::NOT_FOUND,
    }
}
fn uuid(s: &str) -> Result<String, CoreError> {
    Uuid::parse_str(s)
        .map(|v| v.to_string())
        .map_err(|_| CoreError::invalid_uuid())
}
fn hash(v: &Value) -> Result<String, CoreError> {
    canonical::digest(v).map_err(|_| CoreError::database())
}
fn view(r: &PgRow) -> Value {
    json!({"id":r.get::<String,_>("id"),"base_version":r.get::<i64,_>("base_version"),"digest":r.get::<String,_>("digest"),"reason":r.get::<String,_>("reason"),"status":r.get::<String,_>("status"),"validation":r.get::<Value,_>("validation"),"payload":r.get::<Value,_>("payload"),"review_revision":r.get::<i32,_>("review_revision"),"replaces_id":r.get::<Option<String>,_>("replaces_id")})
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProposalInput {
    base_version: i64,
    changes: Vec<Change>,
    reason: String,
    idempotency_key: String,
}
impl ProposalInput {
    fn validate(&self) -> Result<(), CoreError> {
        if self.base_version < 0
            || !(1..=50).contains(&self.changes.len())
            || !(1..=2000).contains(&self.reason.chars().count())
            || !(8..=128).contains(&self.idempotency_key.chars().count())
        {
            return Err(invalid());
        }
        for change in &self.changes {
            if let Change::PutConcept { concept } = change {
                concept.validate().map_err(|_| invalid())?;
            }
        }
        Ok(())
    }
}
async fn transaction<'a>(
    s: &'a StateData,
    p: &Principal,
    domain: &str,
) -> Result<Transaction<'a, Postgres>, CoreError> {
    s.db.locked_permission_transaction(p, domain, WRITERS, "Proposal permission required")
        .await
}
pub(crate) async fn sources(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
) -> Result<BTreeMap<Uuid, String>, CoreError> {
    sqlx::query("SELECT id,content FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND allowed_subjects ? $3 FOR SHARE").bind(&p.tenant).bind(domain).bind(&p.subject).fetch_all(&mut **tx).await.map_err(CoreError::sql)?.into_iter().map(|r|Ok((Uuid::parse_str(r.get::<&str,_>("id")).map_err(|_|CoreError::database())?,r.get("content")))).collect()
}
pub(crate) async fn check_access(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    r: &PgRow,
    accessible: &BTreeMap<Uuid, String>,
) -> Result<(), CoreError> {
    let validation: Value = r.get("validation");
    if let Some(ids) = validation["source_ids"].as_array() {
        for id in ids {
            let id = id
                .as_str()
                .and_then(|v| Uuid::parse_str(v).ok())
                .ok_or_else(CoreError::database)?;
            if !accessible.contains_key(&id) {
                return Err(missing());
            }
        }
    }
    let changes: Vec<Change> =
        serde_json::from_value(r.get("payload")).map_err(|_| CoreError::database())?;
    for change in changes {
        let c = match change {
            Change::PutConcept { concept } => Some(concept),
            Change::RetireConcept { concept_id } => {
                let v: Option<Value> = sqlx::query_scalar(
                    "SELECT payload FROM cf_concepts WHERE tenant_id=$1 AND domain_id=$2 AND id=$3",
                )
                .bind(&p.tenant)
                .bind(domain)
                .bind(concept_id.to_string())
                .fetch_optional(&mut **tx)
                .await
                .map_err(CoreError::sql)?;
                v.map(serde_json::from_value::<Concept>)
                    .transpose()
                    .map_err(|_| CoreError::database())?
            }
        };
        if c.is_some_and(|c| {
            c.sources
                .iter()
                .any(|r| !accessible.contains_key(&r.source_id))
        }) {
            return Err(missing());
        }
    }
    Ok(())
}
pub(crate) async fn row(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    id: &str,
) -> Result<PgRow, CoreError> {
    sqlx::query("SELECT * FROM cf_proposals WHERE tenant_id=$1 AND domain_id=$2 AND id=$3")
        .bind(&p.tenant)
        .bind(domain)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(CoreError::sql)?
        .ok_or_else(missing)
}
async fn published(
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
async fn base(
    s: &StateData,
    p: &Principal,
    domain: &str,
    expected: i64,
) -> Result<BTreeMap<Uuid, Concept>, CoreError> {
    let mut tx = transaction(s, p, domain).await?;
    if published(&mut tx, p, domain).await? != expected {
        return Err(conflict(
            "STALE_BASE",
            "Refresh the published knowledge version",
        ));
    }
    let raw:Option<Value>=sqlx::query_scalar("SELECT snapshot FROM cf_graph_manifests WHERE tenant_id=$1 AND domain_id=$2 AND version=$3").bind(&p.tenant).bind(domain).bind(expected).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    tx.commit().await.map_err(CoreError::sql)?;
    let concepts = match raw {
        None if expected == 0 => Vec::new(),
        None => return Err(CoreError::database()),
        Some(v) => {
            let snapshot: Snapshot =
                serde_json::from_value(v).map_err(|_| CoreError::database())?;
            s.graph
                .as_ref()
                .ok_or_else(CoreError::database)?
                .engine
                .read_snapshot(&snapshot)
                .await
                .map_err(|_| CoreError::database())?
        }
    };
    p.check_fresh()?;
    Ok(concepts.into_iter().map(|c| (c.concept_id, c)).collect())
}
async fn existing(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    input: &ProposalInput,
    fingerprint: &str,
) -> Result<Option<Value>, CoreError> {
    let found=sqlx::query("SELECT * FROM cf_proposals WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND idempotency_key=$4").bind(&p.tenant).bind(domain).bind(&p.subject).bind(&input.idempotency_key).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?;
    if let Some(r) = found {
        if r.get::<&str, _>("request_hash") != fingerprint {
            return Err(conflict(
                "IDEMPOTENCY_CONFLICT",
                "Idempotency key reused for different proposal",
            ));
        }
        let accessible = sources(tx, p, domain).await?;
        check_access(tx, p, domain, &r, &accessible).await?;
        p.check_fresh()?;
        return Ok(Some(view(&r)));
    }
    Ok(None)
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route("/v1/domains/{domain}/proposals", get(list).post(create))
        .route("/v1/domains/{domain}/proposals/{proposal_id}", get(read))
        .route(
            "/v1/domains/{domain}/proposals/{proposal_id}/diff",
            get(diff),
        )
        .route(
            "/v1/domains/{domain}/proposals/{proposal_id}/approve",
            axum::routing::post(approve),
        )
        .route(
            "/v1/domains/{domain}/proposals/{proposal_id}/reviews",
            get(reviews).post(review),
        )
}
fn parse_proposal(raw: Value) -> Result<ProposalInput, CoreError> {
    // Buffer JSON numbers before the internally tagged change enum; serde Content
    // otherwise treats arbitrary-precision float tokens as a private map.
    let input: ProposalInput = serde_json::from_value(raw).map_err(|_| invalid())?;
    input.validate()?;
    Ok(input)
}
async fn create(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<(StatusCode, Json<Value>), CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let Json(raw) = body.map_err(|_| invalid())?;
    let input = parse_proposal(raw)?;
    let normalized = serde_json::to_value(&input).map_err(|_| invalid())?;
    let fingerprint = hash(&normalized)?;
    let mut tx = transaction(&s, &p, &domain).await?;
    if let Some(v) = existing(&mut tx, &p, &domain, &input, &fingerprint).await? {
        return Ok((StatusCode::CREATED, Json(v)));
    }
    tx.commit().await.map_err(CoreError::sql)?;
    let state = base(&s, &p, &domain, input.base_version).await?;
    let mut tx = transaction(&s, &p, &domain).await?;
    if let Some(v) = existing(&mut tx, &p, &domain, &input, &fingerprint).await? {
        return Ok((StatusCode::CREATED, Json(v)));
    }
    if published(&mut tx, &p, &domain).await? != input.base_version {
        return Err(conflict(
            "STALE_BASE",
            "Refresh the published knowledge version",
        ));
    }
    let accessible = sources(&mut tx, &p, &domain).await?;
    let validated = apply_checked(&state, &input.changes, &accessible)?;
    let mut evidence = BTreeSet::new();
    for change in &input.changes {
        let c = match change {
            Change::PutConcept { concept } => concept,
            Change::RetireConcept { concept_id } => state.get(concept_id).ok_or_else(invalid)?,
        };
        let old = state.get(&c.concept_id);
        for (concept, snapshot) in [(Some(c), &validated), (old, &state)] {
            if let Some(concept) = concept {
                evidence.extend(concept.sources.iter().map(|r| r.source_id));
                for link in &concept.links {
                    if let Some(target) = snapshot.get(&link.target_id) {
                        evidence.extend(target.sources.iter().map(|r| r.source_id));
                    }
                }
            }
        }
    }
    let digest = hash(
        &json!({"tenant":p.tenant,"domain":domain,"base":input.base_version,"changes":normalized["changes"],"reason":input.reason}),
    )?;
    let validation = json!({"status":"passed","source_support":"verbatim_v1","graph":"acyclic","policy":"owner_low_risk_v1","risk":"low","source_ids":evidence});
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO cf_proposals(tenant_id,domain_id,id,author,base_version,payload,digest,reason,validation,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)").bind(&p.tenant).bind(&domain).bind(&id).bind(&p.subject).bind(input.base_version).bind(&normalized["changes"]).bind(digest).bind(&input.reason).bind(validation).bind(&input.idempotency_key).bind(fingerprint).execute(&mut *tx).await.map_err(CoreError::sql)?;
    let value = view(&row(&mut tx, &p, &domain, &id).await?);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok((StatusCode::CREATED, Json(value)))
}
async fn read(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let id = uuid(&id)?;
    let mut tx = transaction(&s, &p, &domain).await?;
    let r = row(&mut tx, &p, &domain, &id).await?;
    let accessible = sources(&mut tx, &p, &domain).await?;
    check_access(&mut tx, &p, &domain, &r, &accessible).await?;
    let v = view(&r);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(v))
}
fn twenty() -> usize {
    20
}
#[derive(Deserialize)]
struct ListInput {
    #[serde(default = "twenty")]
    limit: usize,
    after: Option<Uuid>,
    status: Option<String>,
    source_id: Option<Uuid>,
}
async fn list(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
    input: Result<Query<ListInput>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let Query(input) = input.map_err(|_| invalid())?;
    if !(1..=100).contains(&input.limit)
        || input.status.as_ref().is_some_and(|v| {
            ![
                "ready",
                "approved",
                "published",
                "rejected",
                "deferred",
                "changes_requested",
                "superseded",
            ]
            .contains(&v.as_str())
        })
    {
        return Err(invalid());
    }
    let mut tx = transaction(&s, &p, &domain).await?;
    let accessible = sources(&mut tx, &p, &domain).await?;
    if input
        .source_id
        .is_some_and(|v| !accessible.contains_key(&v))
    {
        return Err(missing());
    }
    let mut cursor = input.after.map(|v| v.to_string()).unwrap_or_default();
    let mut visible = Vec::new();
    let filter = input.source_id.map(|v| json!([v])).unwrap_or(json!([]));
    while visible.len() <= input.limit {
        let rows=sqlx::query("SELECT * FROM cf_proposals WHERE tenant_id=$1 AND domain_id=$2 AND id>$3 AND ($4='' OR status=$4) AND ($5::jsonb='[]'::jsonb OR (validation->'source_ids') @> $5) ORDER BY id LIMIT 100").bind(&p.tenant).bind(&domain).bind(&cursor).bind(input.status.as_deref().unwrap_or("")).bind(&filter).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
        let count = rows.len();
        if count == 0 {
            break;
        }
        for r in rows {
            cursor = r.get("id");
            match check_access(&mut tx, &p, &domain, &r, &accessible).await {
                Ok(()) => visible.push(view(&r)),
                Err(e) if e.status == StatusCode::NOT_FOUND => continue,
                Err(e) => return Err(e),
            }
            if visible.len() > input.limit {
                break;
            }
        }
        if count < 100 {
            break;
        }
    }
    let next = if visible.len() > input.limit {
        visible[input.limit - 1]["id"].clone()
    } else {
        Value::Null
    };
    visible.truncate(input.limit);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(json!({"items":visible,"next_after":next})))
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ApprovalInput {
    #[serde(default)]
    expected_review_revision: i64,
    digest: String,
    expected_version: i64,
    reason: String,
    idempotency_key: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReviewInput {
    action: String,
    digest: String,
    expected_review_revision: i64,
    reason: String,
    idempotency_key: String,
}
fn validate_decision(
    digest: &str,
    revision: i64,
    reason: &str,
    key: &str,
) -> Result<(), CoreError> {
    if revision < 0
        || digest.len() != 64
        || !digest
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || !(1..=2000).contains(&reason.chars().count())
        || !(8..=128).contains(&key.chars().count())
    {
        Err(invalid())
    } else {
        Ok(())
    }
}
async fn approval_existing(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    id: &str,
    input: &ApprovalInput,
    fingerprint: &str,
) -> Result<Option<Value>, CoreError> {
    let found=sqlx::query("SELECT sequence,decision_hash FROM cf_commits WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND decision_key=$4").bind(&p.tenant).bind(domain).bind(&p.subject).bind(&input.idempotency_key).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?;
    if let Some(r) = found {
        if r.get::<&str, _>("decision_hash") != fingerprint {
            return Err(conflict("IDEMPOTENCY_CONFLICT", "Decision key reused"));
        }
        // Replays must not reveal a decision after its evidence access has been withdrawn.
        let proposal = row(tx, p, domain, id).await?;
        let accessible = sources(tx, p, domain).await?;
        check_access(tx, p, domain, &proposal, &accessible).await?;
        p.check_fresh()?;
        return Ok(Some(
            json!({"sequence":r.get::<i64,_>("sequence"),"proposal_id":id,"accepted":true}),
        ));
    }
    Ok(None)
}
async fn approve_service(
    s: &StateData,
    p: &Principal,
    domain: &str,
    id: &str,
    input: ApprovalInput,
) -> Result<Value, CoreError> {
    let mut value = serde_json::to_value(&input).map_err(|_| invalid())?;
    value["proposal"] = json!(id);
    let fingerprint = hash(&value)?;
    let mut tx = s.db.locked_owner_transaction(p, domain).await?;
    if let Some(v) = approval_existing(&mut tx, p, domain, id, &input, &fingerprint).await? {
        return Ok(v);
    }
    tx.commit().await.map_err(CoreError::sql)?;
    let state = base(s, p, domain, input.expected_version).await?;
    let mut tx = s.db.locked_owner_transaction(p, domain).await?;
    if let Some(v) = approval_existing(&mut tx, p, domain, id, &input, &fingerprint).await? {
        return Ok(v);
    }
    let proposal = row(&mut tx, p, domain, id).await?;
    let accessible = sources(&mut tx, p, domain).await?;
    check_access(&mut tx, p, domain, &proposal, &accessible).await?;
    if proposal.get::<&str, _>("digest") != input.digest
        || proposal.get::<&str, _>("status") != "ready"
        || i64::from(proposal.get::<i32, _>("review_revision")) != input.expected_review_revision
    {
        return Err(conflict(
            "STALE_BASE",
            "Proposal changed or was already decided",
        ));
    }
    let d = sqlx::query(
        "SELECT accepted_version,published_version FROM cf_domains WHERE tenant_id=$1 AND id=$2",
    )
    .bind(&p.tenant)
    .bind(domain)
    .fetch_one(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    let accepted: i64 = d.get("accepted_version");
    let published: i64 = d.get("published_version");
    if accepted != published {
        return Err(conflict(
            "PUBLICATION_PENDING",
            "Publish the accepted batch before another approval",
        ));
    }
    if proposal.get::<i64, _>("base_version") != input.expected_version
        || published != input.expected_version
    {
        return Err(conflict("STALE_BASE", "Proposal base no longer current"));
    }
    let payload: Value = proposal.get("payload");
    let changes: Vec<Change> =
        serde_json::from_value(payload.clone()).map_err(|_| CoreError::database())?;
    apply_checked(&state, &changes, &accessible)?;
    let mut before = serde_json::Map::new();
    for change in &changes {
        let id = match change {
            Change::PutConcept { concept } => concept.concept_id,
            Change::RetireConcept { concept_id } => *concept_id,
        };
        before.insert(
            id.to_string(),
            serde_json::to_value(state.get(&id)).map_err(|_| CoreError::database())?,
        );
    }
    let sequence = accepted.checked_add(1).ok_or_else(CoreError::database)?;
    sqlx::query("INSERT INTO cf_commits(tenant_id,domain_id,sequence,proposal_id,author,reason,digest,changes,before_state,decision_key,decision_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)").bind(&p.tenant).bind(domain).bind(sequence).bind(id).bind(&p.subject).bind(&input.reason).bind(&input.digest).bind(payload).bind(Value::Object(before)).bind(&input.idempotency_key).bind(fingerprint).execute(&mut *tx).await.map_err(CoreError::sql)?;
    sqlx::query("INSERT INTO cf_outbox(tenant_id,domain_id,sequence) VALUES($1,$2,$3)")
        .bind(&p.tenant)
        .bind(domain)
        .bind(sequence)
        .execute(&mut *tx)
        .await
        .map_err(CoreError::sql)?;
    sqlx::query("UPDATE cf_domains SET accepted_version=$3 WHERE tenant_id=$1 AND id=$2")
        .bind(&p.tenant)
        .bind(domain)
        .bind(sequence)
        .execute(&mut *tx)
        .await
        .map_err(CoreError::sql)?;
    sqlx::query(
        "UPDATE cf_proposals SET status='approved' WHERE tenant_id=$1 AND domain_id=$2 AND id=$3",
    )
    .bind(&p.tenant)
    .bind(domain)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(json!({"sequence":sequence,"proposal_id":id,"accepted":true}))
}
async fn review_service(
    s: &StateData,
    p: &Principal,
    domain: &str,
    id: &str,
    input: ReviewInput,
) -> Result<Value, CoreError> {
    let mut tx = s.db.locked_owner_transaction(p, domain).await?;
    let proposal = row(&mut tx, p, domain, id).await?;
    let accessible = sources(&mut tx, p, domain).await?;
    check_access(&mut tx, p, domain, &proposal, &accessible).await?;
    let mut value = serde_json::to_value(&input).map_err(|_| invalid())?;
    value["proposal"] = json!(id);
    let fingerprint = hash(&value)?;
    let existing=sqlx::query("SELECT request_hash,to_jsonb(r)-'tenant_id'-'domain_id'-'idempotency_key'-'request_hash' AS receipt FROM cf_reviews r WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND idempotency_key=$4").bind(&p.tenant).bind(domain).bind(&p.subject).bind(&input.idempotency_key).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    if let Some(r) = existing {
        if r.get::<&str, _>("request_hash") != fingerprint {
            return Err(conflict("IDEMPOTENCY_CONFLICT", "Review key reused"));
        }
        p.check_fresh()?;
        return Ok(r.get("receipt"));
    }
    let revision: i32 = proposal.get("review_revision");
    if proposal.get::<&str, _>("digest") != input.digest
        || i64::from(revision) != input.expected_review_revision
    {
        return Err(conflict(
            "STALE_REVIEW",
            "Refresh the proposal before deciding",
        ));
    }
    let status: &str = proposal.get("status");
    let target = match input.action.as_str() {
        "reject" if ["ready", "deferred", "changes_requested"].contains(&status) => "rejected",
        "defer" if status == "ready" => "deferred",
        "request_changes" if ["ready", "deferred"].contains(&status) => "changes_requested",
        "reopen" if status == "deferred" => "ready",
        _ => {
            return Err(conflict(
                "INVALID_TRANSITION",
                "Review action is not allowed in this state",
            ));
        }
    };
    let revision = revision.checked_add(1).ok_or_else(CoreError::database)?;
    sqlx::query("UPDATE cf_proposals SET status=$4,review_revision=$5 WHERE tenant_id=$1 AND domain_id=$2 AND id=$3").bind(&p.tenant).bind(domain).bind(id).bind(target).bind(revision).execute(&mut *tx).await.map_err(CoreError::sql)?;
    let receipt_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO cf_reviews(tenant_id,domain_id,id,proposal_id,author,action,reason,proposal_digest,review_revision,resulting_status,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)").bind(&p.tenant).bind(domain).bind(&receipt_id).bind(id).bind(&p.subject).bind(&input.action).bind(&input.reason).bind(&input.digest).bind(revision).bind(target).bind(&input.idempotency_key).bind(fingerprint).execute(&mut *tx).await.map_err(CoreError::sql)?;
    let receipt:Value=sqlx::query_scalar("SELECT to_jsonb(r)-'tenant_id'-'domain_id'-'idempotency_key'-'request_hash' FROM cf_reviews r WHERE tenant_id=$1 AND domain_id=$2 AND id=$3").bind(&p.tenant).bind(domain).bind(&receipt_id).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(receipt)
}
async fn approve(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
    axum::extract::RawQuery(query): axum::extract::RawQuery,
    proof: Option<axum::Extension<crate::confirmation::ConfirmedAction>>,
    body: axum::body::Bytes,
) -> axum::response::Response {
    decision(s, domain, id, headers, query, proof, body, true).await
}
async fn review(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
    axum::extract::RawQuery(query): axum::extract::RawQuery,
    proof: Option<axum::Extension<crate::confirmation::ConfirmedAction>>,
    body: axum::body::Bytes,
) -> axum::response::Response {
    decision(s, domain, id, headers, query, proof, body, false).await
}
#[allow(clippy::too_many_arguments)]
async fn decision(
    s: StateData,
    domain: String,
    id: String,
    headers: HeaderMap,
    query: Option<String>,
    proof: Option<axum::Extension<crate::confirmation::ConfirmedAction>>,
    body: axum::body::Bytes,
    is_approval: bool,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let action = if is_approval {
        "proposals.approve"
    } else {
        "proposals.review"
    };
    let raw = serde_json::from_slice::<Value>(&body);
    let path = if is_approval {
        json!({"domain":domain,"proposal_id":id})
    } else {
        json!({"domain":domain,"ident":id})
    };
    let arguments = json!({"path":path,"body":raw.as_ref().unwrap_or(&Value::Null)});
    let outcome: Result<Value, CoreError> = async {
        let p = s.auth.authenticate(&headers)?;
        let domain = uuid(&domain)?;
        let id = uuid(&id)?;
        let raw = raw.map_err(|_| invalid())?;
        if query.is_some_and(|q| !q.is_empty()) {
            return Err(invalid());
        }
        let approval = if is_approval {
            let data: ApprovalInput = serde_json::from_value(raw.clone()).map_err(|_| invalid())?;
            validate_decision(
                &data.digest,
                data.expected_review_revision,
                &data.reason,
                &data.idempotency_key,
            )?;
            if data.expected_version < 0 {
                return Err(invalid());
            }
            Some(data)
        } else {
            None
        };
        let review = if !is_approval {
            let data: ReviewInput = serde_json::from_value(raw).map_err(|_| invalid())?;
            validate_decision(
                &data.digest,
                data.expected_review_revision,
                &data.reason,
                &data.idempotency_key,
            )?;
            if !["reject", "defer", "request_changes", "reopen"].contains(&data.action.as_str()) {
                return Err(invalid());
            }
            Some(data)
        } else {
            None
        };
        let tx = s.db.locked_owner_transaction(&p, &domain).await?;
        tx.commit().await.map_err(CoreError::sql)?;
        if !proof
            .as_ref()
            .is_some_and(|v| v.subject == p.subject && v.tenant == p.tenant && v.action == action)
        {
            if headers.get_all("x-cortex-confirmation").iter().count() > 1 {
                return Err(invalid());
            }
            let token = headers
                .get("x-cortex-confirmation")
                .and_then(|v| v.to_str().ok());
            s.confirmation
                .as_ref()
                .ok_or_else(crate::confirmation::required)?
                .consume(&p, &domain, action, &arguments, token)
                .await?;
        }
        match (approval, review) {
            (Some(data), _) => approve_service(&s, &p, &domain, &id, data).await,
            (_, Some(data)) => review_service(&s, &p, &domain, &id, data).await,
            _ => Err(invalid()),
        }
    }
    .await;
    match outcome{Ok(value)=>(if is_approval{StatusCode::OK}else{StatusCode::CREATED},Json(value)).into_response(),Err(e) if e.code=="CONFIRMATION_REQUIRED"=>(e.status,Json(json!({"error":e.code,"message":e.message,"confirmation_request":{"action":action,"command_hash":crate::confirmation::command_hash(action,&arguments).unwrap_or_default(),"transport_header":"X-Cortex-Confirmation","max_lifetime_seconds":300}}))).into_response(),Err(e)=>e.into_response()}
}
#[derive(Deserialize)]
struct PageInput {
    #[serde(default = "twenty")]
    limit: usize,
    after: Option<Uuid>,
}
async fn reviews(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
    input: Result<Query<PageInput>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let id = uuid(&id)?;
    let Query(input) = input.map_err(|_| invalid())?;
    if !(1..=100).contains(&input.limit) {
        return Err(invalid());
    }
    let mut tx = transaction(&s, &p, &domain).await?;
    let proposal = row(&mut tx, &p, &domain, &id).await?;
    let accessible = sources(&mut tx, &p, &domain).await?;
    check_access(&mut tx, &p, &domain, &proposal, &accessible).await?;
    let mut items:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(r)-'tenant_id'-'domain_id'-'idempotency_key'-'request_hash' FROM cf_reviews r WHERE tenant_id=$1 AND domain_id=$2 AND proposal_id=$3 AND id>$4 ORDER BY id LIMIT $5").bind(&p.tenant).bind(&domain).bind(id).bind(input.after.map(|v|v.to_string()).unwrap_or_default()).bind((input.limit+1)as i64).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let next = if items.len() > input.limit {
        items[input.limit - 1]["id"].clone()
    } else {
        Value::Null
    };
    items.truncate(input.limit);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(json!({"items":items,"next_after":next})))
}

async fn diff(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let id = uuid(&id)?;
    let mut tx = transaction(&s, &p, &domain).await?;
    let proposal = row(&mut tx, &p, &domain, &id).await?;
    let accessible = sources(&mut tx, &p, &domain).await?;
    check_access(&mut tx, &p, &domain, &proposal, &accessible).await?;
    let served = published(&mut tx, &p, &domain).await?;
    tx.commit().await.map_err(CoreError::sql)?;
    let state = base(&s, &p, &domain, served).await?;
    let mut tx = transaction(&s, &p, &domain).await?;
    if published(&mut tx, &p, &domain).await? != served {
        return Err(conflict(
            "STALE_BASE",
            "Refresh the published knowledge version",
        ));
    }
    let proposal = row(&mut tx, &p, &domain, &id).await?;
    let accessible = sources(&mut tx, &p, &domain).await?;
    check_access(&mut tx, &p, &domain, &proposal, &accessible).await?;
    let committed:Option<Value>=sqlx::query_scalar("SELECT before_state FROM cf_commits WHERE tenant_id=$1 AND domain_id=$2 AND proposal_id=$3").bind(&p.tenant).bind(&domain).bind(&id).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    let before: BTreeMap<Uuid, Option<Concept>> = match &committed {
        Some(v) => serde_json::from_value(v.clone()).map_err(|_| CoreError::database())?,
        None => state.iter().map(|(id, c)| (*id, Some(c.clone()))).collect(),
    };
    let changes: Vec<Change> =
        serde_json::from_value(proposal.get("payload")).map_err(|_| CoreError::database())?;
    let visible = |c: &Concept| {
        c.sources
            .iter()
            .all(|r| accessible.contains_key(&r.source_id))
    };
    let mut items = Vec::new();
    for change in changes {
        let (id, after) = match change {
            Change::PutConcept { concept } => (concept.concept_id, Some(concept)),
            Change::RetireConcept { concept_id } => (concept_id, None),
        };
        let old = before.get(&id).and_then(Option::as_ref);
        if let Some(c) = old
            && (!visible(c)
                || c.links
                    .iter()
                    .any(|l| state.get(&l.target_id).is_some_and(|c| !visible(c))))
        {
            return Err(missing());
        }
        items.push(json!({"concept_id":id,"before":old,"after":after}));
    }
    let base: i64 = proposal.get("base_version");
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(
        json!({"proposal_id":id,"base_version":base,"published_version":served,"comparison":if committed.is_some(){"accepted_before_state"}else{"current_published_state"},"stale_base":committed.is_none() && base!=served,"items":items}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_relation_float_matches_normalized_contract() {
        let raw = r#"{"base_version":0,"changes":[{"kind":"put_concept","concept":{"concept_id":"00000000-0000-0000-0000-000000000001","title":"a","body":"b","sources":[{"source_id":"00000000-0000-0000-0000-000000000002","start":0,"end":1}],"links":[{"target_id":"00000000-0000-0000-0000-000000000003","kind":"associative","primary":false,"weight":1.0}]}}],"reason":"x","idempotency_key":"12345678"}"#;
        let value: Value = serde_json::from_str(raw).unwrap();
        let parsed = parse_proposal(value).unwrap();
        parsed.validate().unwrap();
    }
}
