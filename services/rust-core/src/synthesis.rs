//! Personal durable synthesis attempts. No retry of an existing or ambiguous reservation.
use crate::{
    auth::Principal, companions, error::CoreError, model_provider, retrieval, server::StateData,
};
use axum::{
    Json, Router,
    extract::{Path, State},
    routing::post,
};
use http::{HeaderMap, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;
fn invalid() -> CoreError {
    model_provider::error("VALIDATION_FAILED", StatusCode::UNPROCESSABLE_ENTITY)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    processing_destination: String,
    idempotency_key: String,
}
pub fn routes() -> Router<StateData> {
    Router::new().route(
        "/v1/domains/{domain}/episodes/{episode_id}/syntheses",
        post(execute),
    )
}
async fn episode(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    id: &str,
) -> Result<sqlx::postgres::PgRow, CoreError> {
    let sources = retrieval::accessible(tx, p, d).await?;
    retrieval::episode_row(tx, p, d, id, &sources).await
}
async fn receipt(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    id: &str,
) -> Result<Value, CoreError> {
    let r=sqlx::query("SELECT a.*,to_jsonb(a.created_at) AS created,COALESCE(o.status,'unresolved') AS outcome_status,to_jsonb(o.created_at) AS finished,o.error_code,o.response_id,o.usage FROM cf_synthesis_attempts a LEFT JOIN cf_synthesis_outcomes o ON o.tenant_id=a.tenant_id AND o.domain_id=a.domain_id AND o.attempt_id=a.id WHERE a.tenant_id=$1 AND a.domain_id=$2 AND a.id=$3 AND a.subject=$4").bind(&p.tenant).bind(d).bind(id).bind(&p.subject).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
    episode(tx, p, d, r.get("episode_id")).await?;
    p.check_fresh()?;
    Ok(
        json!({"id":id,"episode_id":r.get::<String,_>("episode_id"),"provider":r.get::<String,_>("provider"),"requested_model":r.get::<Option<String>,_>("requested_model"),"prompt_version":r.get::<String,_>("prompt_version"),"budget_reserved":r.get::<bool,_>("budget_reserved"),"idempotency_key":r.get::<String,_>("idempotency_key"),"created_at":r.get::<Value,_>("created"),"status":r.get::<String,_>("outcome_status"),"response_id":r.get::<Option<String>,_>("response_id"),"error_code":r.get::<Option<String>,_>("error_code"),"usage":r.get::<Option<Value>,_>("usage"),"finished_at":r.get::<Option<Value>,_>("finished")}),
    )
}
pub(crate) async fn quota(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    limit: i64,
) -> Result<(), CoreError> {
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM (SELECT created_at FROM cf_model_attempts WHERE tenant_id=$1 AND domain_id=$2 UNION ALL SELECT created_at FROM cf_synthesis_attempts WHERE tenant_id=$1 AND domain_id=$2 AND budget_reserved) q WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'").bind(&p.tenant).bind(d).fetch_one(&mut **tx).await.map_err(CoreError::sql)?;
    if count >= limit {
        return Err(model_provider::error(
            "MODEL_DAILY_LIMIT",
            StatusCode::TOO_MANY_REQUESTS,
        ));
    }
    Ok(())
}
async fn failed(
    s: &StateData,
    p: &Principal,
    d: &str,
    id: &str,
    code: &str,
    usage: &Option<Value>,
) -> Result<(), CoreError> {
    let mut tx = s.db.pool.begin().await.map_err(CoreError::sql)?;
    sqlx::query("SELECT set_config('cortex.tenant',$1,true)")
        .bind(&p.tenant)
        .execute(&mut *tx)
        .await
        .map_err(CoreError::sql)?;
    sqlx::query("INSERT INTO cf_synthesis_outcomes(tenant_id,domain_id,attempt_id,status,error_code,usage) SELECT tenant_id,domain_id,id,'failed',$5,$6 FROM cf_synthesis_attempts WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND subject=$4 ON CONFLICT(tenant_id,domain_id,attempt_id) DO NOTHING").bind(&p.tenant).bind(d).bind(id).bind(&p.subject).bind(code).bind(usage).execute(&mut *tx).await.map_err(CoreError::sql)?;
    tx.commit().await.map_err(CoreError::sql)
}
async fn unconfirmed_execute(
    State(s): State<StateData>,
    Path((d, e)): Path<(String, String)>,
    h: HeaderMap,
    input: Result<Json<Input>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = Uuid::parse_str(&d)
        .map_err(|_| CoreError::invalid_uuid())?
        .to_string();
    let e = Uuid::parse_str(&e)
        .map_err(|_| CoreError::invalid_uuid())?
        .to_string();
    let Json(i) = input.map_err(|_| invalid())?;
    if i.processing_destination != "openrouter"
        || !(8..=128).contains(&i.idempotency_key.chars().count())
    {
        return Err(invalid());
    }
    let fingerprint=crate::canonical::digest(&json!({"episode_id":e,"processing_destination":i.processing_destination,"idempotency_key":i.idempotency_key})).map_err(|_|invalid())?;
    let mut tx = retrieval::transaction(&s, &p, &d).await?;
    let ep = episode(&mut tx, &p, &d, &e).await?;
    let old=sqlx::query("SELECT id,request_hash FROM cf_synthesis_attempts WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND idempotency_key=$4").bind(&p.tenant).bind(&d).bind(&p.subject).bind(&i.idempotency_key).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    if let Some(r) = old {
        if r.get::<String, _>("request_hash") != fingerprint {
            return Err(model_provider::error(
                "IDEMPOTENCY_CONFLICT",
                StatusCode::CONFLICT,
            ));
        }
        let result = receipt(&mut tx, &p, &d, r.get("id")).await?;
        tx.commit().await.map_err(CoreError::sql)?;
        return Ok(Json(result));
    }
    let model = s.synthesis.as_ref().ok_or_else(|| {
        model_provider::error("SYNTHESIS_DISABLED", StatusCode::SERVICE_UNAVAILABLE)
    })?;
    let result: Value = ep.get("result");
    let paid = !result["citations"]
        .as_array()
        .ok_or_else(CoreError::database)?
        .is_empty();
    let prepared = if paid {
        model.prepare(ep.get("question"), &result)?
    } else {
        json!({"abstention":e})
    };
    if paid {
        quota(&mut tx, &p, &d, s.model_daily_limit).await?
    }
    let id = Uuid::new_v4().to_string();
    let input_hash = crate::canonical::digest(&prepared).map_err(|_| invalid())?;
    sqlx::query("INSERT INTO cf_synthesis_attempts(tenant_id,domain_id,id,subject,episode_id,provider,requested_model,prompt_version,budget_reserved,input_sha256,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)").bind(&p.tenant).bind(&d).bind(&id).bind(&p.subject).bind(&e).bind(if paid{"openrouter"}else{"none"}).bind(if paid{Some(&model.model)}else{None}).bind(if paid{"cited-synthesis-v2"}else{"deterministic-abstention-v1"}).bind(paid).bind(input_hash).bind(&i.idempotency_key).bind(&fingerprint).execute(&mut *tx).await.map_err(CoreError::sql)?;
    sqlx::query(
        "UPDATE cf_domains SET accepted_version=accepted_version WHERE tenant_id=$1 AND id=$2",
    )
    .bind(&p.tenant)
    .bind(&d)
    .execute(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    let mut usage = None;
    let outcome:Result<(),CoreError>=async {
 p.check_fresh()?;let mut tx=retrieval::transaction(&s,&p,&d).await?;episode(&mut tx,&p,&d,&e).await?;tx.commit().await.map_err(CoreError::sql)?;
 let mut draft=if paid{let response=model.request(&prepared).await?;let (model_name,u)=model_provider::usage(&response)?;usage=Some(u);model_provider::draft(&response,&result,&model_name)?}else{json!({"answer_text":"Aucune preuve exploitable dans cet épisode ; je ne peux pas fournir une réponse sourcée.","answer_kind":"abstention","citations":[],"model":null})};
 p.check_fresh()?;let mut tx=retrieval::transaction(&s,&p,&d).await?;episode(&mut tx,&p,&d,&e).await?;draft["companion"]=json!("cortex-backend-synthesis-v1");draft["idempotency_key"]=json!(format!("synthesis:{id}"));let input:companions::CompanionInput=serde_json::from_value(draft).map_err(|_|model_provider::error("UNSUPPORTED_SYNTHESIS",StatusCode::UNPROCESSABLE_ENTITY))?;let response=companions::create_in_transaction(&mut tx,&p,&d,&e,input).await?;
 sqlx::query("INSERT INTO cf_synthesis_outcomes(tenant_id,domain_id,attempt_id,status,response_id,usage) VALUES($1,$2,$3,'succeeded',$4,$5)").bind(&p.tenant).bind(&d).bind(&id).bind(response["id"].as_str().ok_or_else(CoreError::database)?).bind(&usage).execute(&mut *tx).await.map_err(CoreError::sql)?;p.check_fresh()?;tx.commit().await.map_err(CoreError::sql)?;Ok(())}.await;
    if let Err(error) = outcome {
        if failed(&s, &p, &d, &id, error.code, &usage).await.is_err() {
            return Err(model_provider::error(
                "SYNTHESIS_STORAGE_UNCERTAIN",
                StatusCode::SERVICE_UNAVAILABLE,
            ));
        }
        if matches!(error.status.as_u16(), 401 | 403 | 404) {
            return Err(error);
        }
    }
    p.check_fresh()?;
    let mut tx = retrieval::transaction(&s, &p, &d).await?;
    let result = receipt(&mut tx, &p, &d, &id).await?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}

async fn execute(
    State(s): State<StateData>,
    Path((d, e)): Path<(String, String)>,
    h: HeaderMap,
    axum::extract::RawQuery(q): axum::extract::RawQuery,
    proof: Option<axum::Extension<crate::confirmation::ConfirmedAction>>,
    body: axum::body::Bytes,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let action = "syntheses.create";
    let raw = serde_json::from_slice::<Value>(&body);
    let args =
        json!({"path":{"domain":d,"episode_id":e},"body":raw.as_ref().unwrap_or(&Value::Null)});
    let outcome: Result<Json<Value>, CoreError> = async {
        let p = s.auth.authenticate(&h)?;
        let domain = Uuid::parse_str(&d)
            .map_err(|_| CoreError::invalid_uuid())?
            .to_string();
        Uuid::parse_str(&e).map_err(|_| CoreError::invalid_uuid())?;
        let i: Input =
            serde_json::from_value(raw.map_err(|_| invalid())?).map_err(|_| invalid())?;
        if q.is_some_and(|q| !q.is_empty())
            || i.processing_destination != "openrouter"
            || !(8..=128).contains(&i.idempotency_key.chars().count())
        {
            return Err(invalid());
        }
        let tx = crate::confirmation::authorize(&s.db, &p, &domain, action).await?;
        tx.commit().await.map_err(CoreError::sql)?;
        if !proof
            .as_ref()
            .is_some_and(|v| v.subject == p.subject && v.tenant == p.tenant && v.action == action)
        {
            if h.get_all("x-cortex-confirmation").iter().count() > 1 {
                return Err(invalid());
            };
            s.confirmation
                .as_ref()
                .ok_or_else(crate::confirmation::required)?
                .consume(
                    &p,
                    &domain,
                    action,
                    &args,
                    h.get("x-cortex-confirmation").and_then(|v| v.to_str().ok()),
                )
                .await?;
        }
        unconfirmed_execute(State(s), Path((d, e)), h, Ok(Json(i))).await
    }
    .await;
    match outcome{Ok(v)=>v.into_response(),Err(e)if e.code=="CONFIRMATION_REQUIRED"=>(e.status,Json(json!({"error":e.code,"message":e.message,"confirmation_request":{"action":action,"command_hash":crate::confirmation::command_hash(action,&args).unwrap_or_default(),"transport_header":"X-Cortex-Confirmation","max_lifetime_seconds":300}}))).into_response(),Err(e)=>e.into_response()}
}
