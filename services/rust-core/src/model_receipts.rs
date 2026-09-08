//! Read existing model receipts without invoking any provider or inferring missing outcomes.
use crate::{error::CoreError, proposals, retrieval, server::StateData};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::get,
};
use http::{HeaderMap, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Row, postgres::PgRow};
use uuid::Uuid;
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Invalid model history arguments",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn uuid(s: &str) -> Result<String, CoreError> {
    Uuid::parse_str(s)
        .map(|x| x.to_string())
        .map_err(|_| CoreError::invalid_uuid())
}
fn twenty() -> usize {
    20
}
#[derive(Deserialize)]
struct Page {
    #[serde(default = "twenty")]
    limit: usize,
    after: Option<Uuid>,
    episode_id: Option<Uuid>,
    idempotency_key: Option<String>,
}
fn page(
    input: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Page, CoreError> {
    let Query(q) = input.map_err(|_| invalid())?;
    if !(1..=100).contains(&q.limit)
        || q.idempotency_key
            .as_ref()
            .is_some_and(|k| !(8..=128).contains(&k.chars().count()))
    {
        return Err(invalid());
    }
    Ok(q)
}
const ATTEMPTS: &str = "SELECT a.*,to_jsonb(a.created_at) AS created,COALESCE(o.status,'unresolved') AS outcome_status,to_jsonb(o.created_at) AS finished,o.error_code,o.extraction_id FROM cf_model_attempts a JOIN cf_sources s ON s.tenant_id=a.tenant_id AND s.domain_id=a.domain_id AND s.id=a.source_id LEFT JOIN cf_model_outcomes o ON o.tenant_id=a.tenant_id AND o.domain_id=a.domain_id AND o.attempt_id=a.id WHERE a.tenant_id=$1 AND a.domain_id=$2 AND a.author=$3 AND s.allowed_subjects ? $3";
const SYNTHESES: &str = "SELECT a.*,e.source_ids,to_jsonb(a.created_at) AS created,COALESCE(o.status,'unresolved') AS outcome_status,to_jsonb(o.created_at) AS finished,o.error_code,o.response_id,o.usage FROM cf_synthesis_attempts a JOIN cf_episodes e ON e.tenant_id=a.tenant_id AND e.domain_id=a.domain_id AND e.id=a.episode_id LEFT JOIN cf_synthesis_outcomes o ON o.tenant_id=a.tenant_id AND o.domain_id=a.domain_id AND o.attempt_id=a.id WHERE a.tenant_id=$1 AND a.domain_id=$2 AND a.subject=$3 AND e.subject=$3";
fn attempt(r: &PgRow) -> Value {
    json!({"id":r.get::<String,_>("id"),"source_id":r.get::<String,_>("source_id"),"provider":r.get::<String,_>("provider"),"requested_model":r.get::<String,_>("requested_model"),"input_span":r.get::<Value,_>("input_span"),"input_sha256":r.get::<String,_>("input_sha256"),"idempotency_key":r.get::<String,_>("idempotency_key"),"created_at":r.get::<Value,_>("created"),"status":r.get::<String,_>("outcome_status"),"finished_at":r.get::<Option<Value>,_>("finished"),"error_code":r.get::<Option<String>,_>("error_code"),"extraction_id":r.get::<Option<String>,_>("extraction_id")})
}
fn synthesis(r: &PgRow) -> Value {
    json!({"id":r.get::<String,_>("id"),"episode_id":r.get::<String,_>("episode_id"),"provider":r.get::<String,_>("provider"),"requested_model":r.get::<Option<String>,_>("requested_model"),"prompt_version":r.get::<String,_>("prompt_version"),"budget_reserved":r.get::<bool,_>("budget_reserved"),"idempotency_key":r.get::<String,_>("idempotency_key"),"created_at":r.get::<Value,_>("created"),"status":r.get::<String,_>("outcome_status"),"response_id":r.get::<Option<String>,_>("response_id"),"error_code":r.get::<Option<String>,_>("error_code"),"usage":r.get::<Option<Value>,_>("usage"),"finished_at":r.get::<Option<Value>,_>("finished")})
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route("/v1/domains/{domain}/model-attempts", get(attempts))
        .route(
            "/v1/domains/{domain}/model-attempts/{attempt_id}",
            get(attempt_read),
        )
        .route("/v1/domains/{domain}/model-usage", get(usage))
        .route("/v1/domains/{domain}/syntheses", get(syntheses))
        .route(
            "/v1/domains/{domain}/syntheses/{ident}",
            get(synthesis_read),
        )
        .route("/v1/domains/{domain}/extractions/{ident}", get(extraction))
}
async fn attempts(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    input: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let q = page(input)?;
    let mut tx = s.db.locked_owner_transaction(&p, &d).await?;
    let rows = sqlx::query(&format!("{ATTEMPTS} AND a.id>$4 ORDER BY a.id LIMIT $5"))
        .bind(&p.tenant)
        .bind(&d)
        .bind(&p.subject)
        .bind(q.after.map(|x| x.to_string()).unwrap_or_default())
        .bind((q.limit + 1) as i64)
        .fetch_all(&mut *tx)
        .await
        .map_err(CoreError::sql)?;
    let next = if rows.len() > q.limit {
        json!(rows[q.limit - 1].get::<String, _>("id"))
    } else {
        Value::Null
    };
    let result = json!({"items":rows.iter().take(q.limit).map(attempt).collect::<Vec<_>>(),"next_after":next});
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
async fn attempt_read(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let mut tx = s.db.locked_owner_transaction(&p, &d).await?;
    let r = sqlx::query(&format!("{ATTEMPTS} AND a.id=$4"))
        .bind(&p.tenant)
        .bind(&d)
        .bind(&p.subject)
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(CoreError::sql)?
        .ok_or_else(CoreError::not_found)?;
    let result = attempt(&r);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
async fn usage(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let mut tx = s.db.locked_owner_transaction(&p, &d).await?;
    let r=sqlx::query("SELECT to_jsonb((now() AT TIME ZONE 'UTC')::date) AS utc_day,count(*) AS reserved_attempts FROM (SELECT created_at FROM cf_model_attempts WHERE tenant_id=$1 AND domain_id=$2 UNION ALL SELECT created_at FROM cf_synthesis_attempts WHERE tenant_id=$1 AND domain_id=$2 AND budget_reserved) reservations WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'").bind(&p.tenant).bind(&d).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    let used = r.get::<i64, _>("reserved_attempts");
    let result = json!({"utc_day":r.get::<Value,_>("utc_day"),"daily_limit":s.model_daily_limit,"reserved_attempts":used,"remaining_attempts":(s.model_daily_limit-used).max(0),"scope":"All extraction and paid synthesis reservations in this domain; not a monetary budget or provider invoice."});
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
async fn syntheses(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    input: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let q = page(input)?;
    let mut tx = retrieval::transaction(&s, &p, &d).await?;
    let sources = retrieval::accessible(&mut tx, &p, &d).await?;
    if let Some(id) = q.episode_id {
        retrieval::episode_row(&mut tx, &p, &d, &id.to_string(), &sources).await?;
    }
    let mut cursor = q.after.map(|x| x.to_string()).unwrap_or_default();
    let mut items = Vec::new();
    let mut next = Value::Null;
    'scan: loop {
        let rows=sqlx::query(&format!("{SYNTHESES} AND a.id>$4 AND ($5='' OR a.episode_id=$5) AND ($6='' OR a.idempotency_key=$6) ORDER BY a.id LIMIT 100")).bind(&p.tenant).bind(&d).bind(&p.subject).bind(&cursor).bind(q.episode_id.map(|x|x.to_string()).unwrap_or_default()).bind(q.idempotency_key.as_deref().unwrap_or("")).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
        let count = rows.len();
        for r in rows {
            cursor = r.get("id");
            if !retrieval::can_read(&r, &sources)? {
                continue;
            }
            if items.len() == q.limit {
                next = items
                    .last()
                    .map(|v: &Value| v["id"].clone())
                    .unwrap_or(Value::Null);
                break 'scan;
            }
            items.push(synthesis(&r));
        }
        if count < 100 {
            break;
        }
        p.check_fresh()?;
    }
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(json!({"items":items,"next_after":next})))
}
async fn synthesis_read(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let mut tx = retrieval::transaction(&s, &p, &d).await?;
    let r = sqlx::query(&format!("{SYNTHESES} AND a.id=$4"))
        .bind(&p.tenant)
        .bind(&d)
        .bind(&p.subject)
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(CoreError::sql)?
        .ok_or_else(CoreError::not_found)?;
    let sources = retrieval::accessible(&mut tx, &p, &d).await?;
    if !retrieval::can_read(&r, &sources)? {
        return Err(CoreError::not_found());
    }
    let result = synthesis(&r);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
async fn extraction(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let mut tx = s.db.locked_owner_transaction(&p, &d).await?;
    let r=sqlx::query("SELECT x.* FROM cf_extractions x JOIN cf_sources s ON s.tenant_id=x.tenant_id AND s.domain_id=x.domain_id AND s.id=x.source_id WHERE x.tenant_id=$1 AND x.domain_id=$2 AND x.id=$3 AND x.author=$4 AND s.allowed_subjects ? $4").bind(&p.tenant).bind(&d).bind(&id).bind(&p.subject).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
    let proposal = proposals::row(&mut tx, &p, &d, r.get("proposal_id")).await?;
    let sources = proposals::sources(&mut tx, &p, &d).await?;
    proposals::check_access(&mut tx, &p, &d, &proposal, &sources).await?;
    let mut result = r.get::<Value, _>("model_metadata");
    let obj = result.as_object_mut().ok_or_else(CoreError::database)?;
    obj.entry("provider").or_insert(json!("ollama"));
    for key in ["input_span", "input_sha256", "request_id", "cost_usd"] {
        obj.entry(key).or_insert(Value::Null);
    }
    result["id"] = json!(id);
    result["proposal"] = proposals::view(&proposal);
    result["processing"] = json!(if result["provider"] == "openrouter" {
        "openrouter_passage_selection"
    } else {
        "local_model_passage_selection"
    });
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
