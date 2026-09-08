//! Explicit owner-authorized replacement of an uncertain, durably fenced publication attempt.
use crate::{
    auth::Principal,
    canonical,
    confirmation::ConfirmedAction,
    error::CoreError,
    graph::GraphService,
    graph_attempts::{self, Attempt},
    publication::{self, AttemptExecution},
    server::StateData,
};
use axum::{
    Json, Router,
    extract::{Path, Query, RawQuery, State},
    response::IntoResponse,
    routing::get,
};
use http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction, postgres::PgRow};
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
        message: "Arguments do not match the publication recovery contract",
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
    #[serde(default = "fifty")]
    limit: usize,
    #[serde(default)]
    after: i64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EventsPage {
    #[serde(default = "fifty")]
    limit: usize,
    after: Option<Uuid>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RetryInput {
    #[serde(deserialize_with = "integer")]
    expected_published_version: i64,
    expected_attempt_id: Uuid,
    #[serde(deserialize_with = "integer")]
    expected_generation: i64,
    idempotency_key: String,
    reason: String,
}
pub(crate) fn integer<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
    let value = Value::deserialize(deserializer)?;
    value
        .as_i64()
        .or_else(|| {
            value
                .as_f64()
                .filter(|n| n.fract() == 0.0 && *n >= 0.0 && *n < 9223372036854775808.0)
                .map(|n| n as i64)
        })
        .ok_or_else(|| serde::de::Error::custom("Expected an integral JSON number"))
}
impl RetryInput {
    fn validate(&self) -> Result<(), CoreError> {
        if !(0..i64::MAX).contains(&self.expected_published_version)
            || !(1..i64::MAX).contains(&self.expected_generation)
            || !(8..=200).contains(&self.idempotency_key.chars().count())
            || !(1..=2000).contains(&self.reason.chars().count())
            || self.reason.trim().is_empty()
        {
            return Err(invalid());
        }
        Ok(())
    }
}
const ATTEMPTS: &str = "SELECT a.*,to_jsonb(a.created_at) AS created,(p.id=a.id AND p.generation=a.generation) AS active,CASE WHEN p.id=a.id AND p.generation=a.generation THEN p.status ELSE 'superseded' END AS status FROM cf_graph_attempts a JOIN cf_graph_preparations p ON p.tenant_id=a.tenant_id AND p.domain_id=a.domain_id AND p.version=a.version WHERE a.tenant_id=$1 AND a.domain_id=$2 AND a.version=$3";
fn attempt(row: &PgRow) -> Result<Value, CoreError> {
    let intent: Value = row.get("intent");
    if intent["kind"] != "publish"
        || intent["base_version"].as_i64().is_none()
        || intent["digest"].as_str().is_none()
        || intent["count"].as_i64().is_none()
    {
        return Err(CoreError::database());
    }
    Ok(
        json!({"id":row.get::<String,_>("id"),"generation":row.get::<i64,_>("generation"),"predecessor_id":row.get::<Option<String>,_>("predecessor_id"),"subject":row.get::<String,_>("subject"),"reason":row.get::<String,_>("reason"),"created_at":row.get::<Value,_>("created"),"active":row.get::<bool,_>("active"),"status":row.get::<String,_>("status"),"base_version":intent["base_version"],"digest":intent["digest"],"count":intent["count"]}),
    )
}
async fn inspect(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    id: &str,
) -> Result<publication::Recipe, CoreError> {
    let seq: Option<i64> = sqlx::query_scalar(
        "SELECT sequence FROM cf_commits WHERE tenant_id=$1 AND domain_id=$2 AND proposal_id=$3",
    )
    .bind(&p.tenant)
    .bind(d)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(CoreError::sql)?;
    // recipe always checks current evidence before reporting an unaccepted target.
    publication::recipe(tx, p, d, id, seq.unwrap_or(1) - 1).await
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route(
            "/v1/domains/{domain}/proposals/{proposal_id}/publication-attempts",
            get(attempts).post(retry),
        )
        .route(
            "/v1/domains/{domain}/proposals/{proposal_id}/publication-events",
            get(events),
        )
}
async fn attempts(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
    input: Result<Query<AttemptsPage>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let (d, id) = (uuid(&d)?, uuid(&id)?);
    let Query(q) = input.map_err(|_| invalid())?;
    if !(1..=100).contains(&q.limit) || !(0..i64::MAX).contains(&q.after) {
        return Err(invalid());
    }
    let mut tx = s.db.locked_owner_transaction(&p, &d).await?;
    let recipe = inspect(&mut tx, &p, &d, &id).await?;
    let rows = sqlx::query(&format!(
        "{ATTEMPTS} AND a.generation>$4 ORDER BY a.generation LIMIT $5"
    ))
    .bind(&p.tenant)
    .bind(&d)
    .bind(recipe.sequence)
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
    .bind(recipe.sequence)
    .fetch_optional(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    let next = if rows.len() > q.limit {
        json!(rows[q.limit - 1].get::<i64, _>("generation"))
    } else {
        Value::Null
    };
    let result = json!({"proposal_id":id,"target_version":recipe.sequence,"published_version":recipe.published,"active_attempt":active.as_ref().map(attempt).transpose()?,"items":rows.iter().take(q.limit).map(attempt).collect::<Result<Vec<_>,_>>()?,"next_after":next});
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
async fn events(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
    input: Result<Query<EventsPage>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let (d, id) = (uuid(&d)?, uuid(&id)?);
    let Query(q) = input.map_err(|_| invalid())?;
    if !(1..=100).contains(&q.limit) {
        return Err(invalid());
    }
    let mut tx = s.db.locked_owner_transaction(&p, &d).await?;
    let recipe = inspect(&mut tx, &p, &d, &id).await?;
    let cursor = if let Some(after) = q.after {
        sqlx::query_scalar::<_,i64>("SELECT ordinal FROM cf_graph_attempt_events WHERE tenant_id=$1 AND domain_id=$2 AND version=$3 AND id=$4")
            .bind(&p.tenant).bind(&d).bind(recipe.sequence).bind(after.to_string()).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?
    } else {
        0
    };
    let rows=sqlx::query("SELECT id,attempt_id,generation,subject,kind,to_jsonb(recorded_at) AS recorded FROM cf_graph_attempt_events WHERE tenant_id=$1 AND domain_id=$2 AND version=$3 AND ordinal>$4 ORDER BY ordinal LIMIT $5")
        .bind(&p.tenant).bind(&d).bind(recipe.sequence).bind(cursor).bind((q.limit+1) as i64).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
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
async fn retry(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
    RawQuery(query): RawQuery,
    proof: Option<axum::Extension<ConfirmedAction>>,
    body: axum::body::Bytes,
) -> axum::response::Response {
    let action = "proposals.retry_publication";
    let raw = serde_json::from_slice::<Value>(&body);
    let args =
        json!({"path":{"domain":d,"proposal_id":id},"body":raw.as_ref().unwrap_or(&Value::Null)});
    let result: Result<Value, CoreError> = async {
        let p = s.auth.authenticate(&h)?;
        let (d, id) = (uuid(&d)?, uuid(&id)?);
        if query.is_some_and(|q| !q.is_empty()) {
            return Err(invalid());
        }
        let input: RetryInput =
            serde_json::from_value(raw.map_err(|_| invalid())?).map_err(|_| invalid())?;
        input.validate()?;
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
        s.graph
            .as_ref()
            .ok_or_else(CoreError::database)?
            .retry_publication(&p, &d, &id, &input)
            .await
    }
    .await;
    match result {
        Ok(v)=>(StatusCode::CREATED,Json(v)).into_response(),
        Err(e) if e.code=="CONFIRMATION_REQUIRED" => (e.status,Json(json!({"error":e.code,"message":e.message,"confirmation_request":{"action":action,"command_hash":crate::confirmation::command_hash(action,&args).unwrap_or_default(),"transport_header":"X-Cortex-Confirmation","max_lifetime_seconds":300}}))).into_response(),
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
    let row=sqlx::query("SELECT id,generation,fingerprint FROM cf_graph_attempts WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND idempotency_key=$4")
        .bind(&p.tenant).bind(d).bind(&p.subject).bind(&input.idempotency_key).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?;
    row.map(|r| {
        if r.get::<Option<&str>, _>("fingerprint") != Some(fingerprint) {
            return Err(conflict(
                "IDEMPOTENCY_CONFLICT",
                "This key identifies a different publication decision",
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
    id: &str,
    input: &RetryInput,
) -> Result<(i64, Value), CoreError> {
    let recipe = publication::recipe(tx, p, d, id, input.expected_published_version).await?;
    if recipe.published >= recipe.sequence {
        return Err(conflict(
            "PUBLICATION_ALREADY_PUBLISHED",
            "This target is already published; inspect its state",
        ));
    }
    if recipe.published != input.expected_published_version {
        return Err(conflict(
            "STALE_PUBLICATION",
            "Refresh the target and published version",
        ));
    }
    let row=sqlx::query("SELECT id,generation,intent FROM cf_graph_preparations WHERE tenant_id=$1 AND domain_id=$2 AND version=$3 FOR UPDATE")
        .bind(&p.tenant).bind(d).bind(recipe.sequence).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?
        .ok_or_else(||conflict("PUBLICATION_NOT_PREPARED","Use the normal publication action for the initial attempt"))?;
    if row.get::<&str, _>("id") != input.expected_attempt_id.to_string()
        || row.get::<i64, _>("generation") != input.expected_generation
    {
        return Err(graph_attempts::replaced());
    }
    let intent: Value = row
        .get::<Option<Value>, _>("intent")
        .ok_or_else(CoreError::database)?;
    if intent["kind"] != "publish"
        || intent["proposal_id"] != id
        || intent["base_version"] != input.expected_published_version
        || intent["digest"].as_str().is_none()
        || intent["count"].as_u64().is_none()
    {
        return Err(CoreError::database());
    }
    Ok((recipe.sequence, intent))
}
impl GraphService {
    async fn retry_publication(
        &self,
        p: &Principal,
        d: &str,
        id: &str,
        input: &RetryInput,
    ) -> Result<Value, CoreError> {
        let fingerprint=canonical::digest(&json!({"action":"proposals.retry_publication","tenant":p.tenant,"domain":d,"proposal":id,"subject":p.subject,"input":input})).map_err(|_|invalid())?;
        let mut tx = self.db.locked_owner_transaction(p, d).await?;
        let current =
            publication::recipe(&mut tx, p, d, id, input.expected_published_version).await?;
        if let Some(a) = saved(&mut tx, p, d, input, &fingerprint).await? {
            tx.commit().await.map_err(CoreError::sql)?;
            return self.execute_retry(p, d, id, input, a, false).await;
        }
        let (version, intent) = replaceable(&mut tx, p, d, id, input).await?;
        tx.commit().await.map_err(CoreError::sql)?;
        let complete = self
            .engine
            .reconcile_snapshot(
                input.expected_attempt_id,
                intent["digest"]
                    .as_str()
                    .ok_or_else(CoreError::database)?
                    .to_owned(),
                intent["count"].as_u64().ok_or_else(CoreError::database)? as usize,
            )
            .await
            .is_ok();
        let mut tx = self.db.locked_owner_transaction(p, d).await?;
        // Evidence and identity are rechecked after every network wait, even on key replay.
        publication::recipe(&mut tx, p, d, id, input.expected_published_version).await?;
        if let Some(a) = saved(&mut tx, p, d, input, &fingerprint).await? {
            tx.commit().await.map_err(CoreError::sql)?;
            return self.execute_retry(p, d, id, input, a, false).await;
        }
        let (now, verified) = replaceable(&mut tx, p, d, id, input).await?;
        if now != version || current.sequence != version || verified != intent {
            return Err(CoreError::database());
        }
        if complete {
            return Err(conflict(
                "PUBLICATION_READY_TO_RECONCILE",
                "The existing graph is complete; use the normal publication action to reconcile it",
            ));
        }
        let a = Attempt {
            id: Uuid::new_v4(),
            generation: input.expected_generation + 1,
        };
        sqlx::query("INSERT INTO cf_graph_attempts(tenant_id,domain_id,version,id,generation,predecessor_id,subject,reason,idempotency_key,fingerprint,intent) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
            .bind(&p.tenant).bind(d).bind(version).bind(a.id.to_string()).bind(a.generation).bind(input.expected_attempt_id.to_string()).bind(&p.subject).bind(&input.reason).bind(&input.idempotency_key).bind(&fingerprint).bind(&intent).execute(&mut *tx).await.map_err(CoreError::sql)?;
        graph_attempts::proof(&mut tx, p, &a).await?;
        let changed=sqlx::query("UPDATE cf_graph_preparations SET id=$4,generation=$5,status='preparing' WHERE tenant_id=$1 AND domain_id=$2 AND version=$3 AND id=$6 AND generation=$7")
            .bind(&p.tenant).bind(d).bind(version).bind(a.id.to_string()).bind(a.generation).bind(input.expected_attempt_id.to_string()).bind(input.expected_generation).execute(&mut *tx).await.map_err(CoreError::sql)?.rows_affected();
        if changed != 1 {
            return Err(graph_attempts::replaced());
        }
        p.check_fresh()?;
        // No POST if this durable commit has an uncertain acknowledgement.
        tx.commit().await.map_err(CoreError::sql)?;
        self.execute_retry(p, d, id, input, a, true).await
    }
    async fn execute_retry(
        &self,
        p: &Principal,
        d: &str,
        id: &str,
        input: &RetryInput,
        a: Attempt,
        stage_once: bool,
    ) -> Result<Value, CoreError> {
        let before = self.retry_receipt(p, d, id, &a).await?;
        if before["outcome"] != "unresolved" {
            return Ok(before);
        }
        let result = self
            .publish_attempt(
                p,
                d,
                id,
                input.expected_published_version,
                Some(AttemptExecution {
                    attempt: a.clone(),
                    stage_once,
                }),
            )
            .await;
        if let Err(e) = result
            && e.status != StatusCode::SERVICE_UNAVAILABLE
            && e.code != "GRAPH_ATTEMPT_REPLACED"
        {
            return Err(e);
        }
        self.retry_receipt(p, d, id, &a).await
    }
    async fn retry_receipt(
        &self,
        p: &Principal,
        d: &str,
        id: &str,
        a: &Attempt,
    ) -> Result<Value, CoreError> {
        let mut tx = self.db.locked_owner_transaction(p, d).await?;
        let recipe = inspect(&mut tx, p, d, id).await?;
        let row = sqlx::query(&format!("{ATTEMPTS} AND a.id=$4 AND a.generation=$5"))
            .bind(&p.tenant)
            .bind(d)
            .bind(recipe.sequence)
            .bind(a.id.to_string())
            .bind(a.generation)
            .fetch_optional(&mut *tx)
            .await
            .map_err(CoreError::sql)?
            .ok_or_else(CoreError::not_found)?;
        let data = attempt(&row)?;
        let published:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cf_graph_manifests WHERE tenant_id=$1 AND domain_id=$2 AND version=$3 AND attempt_id=$4 AND generation=$5)")
            .bind(&p.tenant).bind(d).bind(recipe.sequence).bind(a.id.to_string()).bind(a.generation).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
        let outcome = if published && recipe.published >= recipe.sequence {
            "published"
        } else if data["active"] == false {
            "superseded"
        } else {
            "unresolved"
        };
        p.check_fresh()?;
        tx.commit().await.map_err(CoreError::sql)?;
        Ok(
            json!({"proposal_id":id,"target_version":recipe.sequence,"published_version":recipe.published,"attempt":data,"outcome":outcome}),
        )
    }
}
