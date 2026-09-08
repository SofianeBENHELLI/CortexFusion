//! One durable passage-selection attempt, followed by atomic proposal/receipt/outcome.
use crate::{
    auth::Principal, error::CoreError, knowledge::SourceRef, model_provider, proposals,
    server::StateData,
};
use axum::{
    Json, Router,
    extract::{Path, State},
    response::{IntoResponse, Response},
    routing::post,
};
use http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction, postgres::PgRow};
use uuid::Uuid;
fn invalid() -> CoreError {
    model_provider::error("VALIDATION_FAILED", StatusCode::UNPROCESSABLE_ENTITY)
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Input {
    processing_destination: String,
    idempotency_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    span: Option<SourceRef>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Local {
    allow_local_processing: bool,
    idempotency_key: String,
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route(
            "/v1/domains/{domain}/sources/{source_id}/extract",
            post(extract),
        )
        .route(
            "/v1/domains/{domain}/sources/{source_id}/extract-local",
            post(local),
        )
}
async fn extract(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
    axum::extract::RawQuery(q): axum::extract::RawQuery,
    proof: Option<axum::Extension<crate::confirmation::ConfirmedAction>>,
    body: axum::body::Bytes,
) -> Response {
    command(s, d, id, h, q, proof, body, false).await
}
async fn local(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
    axum::extract::RawQuery(q): axum::extract::RawQuery,
    proof: Option<axum::Extension<crate::confirmation::ConfirmedAction>>,
    body: axum::body::Bytes,
) -> Response {
    command(s, d, id, h, q, proof, body, true).await
}
#[allow(clippy::too_many_arguments)]
async fn command(
    s: StateData,
    d: String,
    id: String,
    h: HeaderMap,
    q: Option<String>,
    proof: Option<axum::Extension<crate::confirmation::ConfirmedAction>>,
    body: axum::body::Bytes,
    local: bool,
) -> Response {
    let action = if local {
        "sources.extract_local"
    } else {
        "sources.extract"
    };
    let raw = serde_json::from_slice::<Value>(&body);
    let args =
        json!({"path":{"domain":d,"source_id":id},"body":raw.as_ref().unwrap_or(&Value::Null)});
    let result: Result<Value, CoreError> = async {
        let p = s.auth.authenticate(&h)?;
        let d = Uuid::parse_str(&d)
            .map_err(|_| CoreError::invalid_uuid())?
            .to_string();
        let id = Uuid::parse_str(&id)
            .map_err(|_| CoreError::invalid_uuid())?
            .to_string();
        if q.is_some_and(|q| !q.is_empty()) {
            return Err(invalid());
        }
        let (input, normalized) = if local {
            let v: Local =
                serde_json::from_value(raw.map_err(|_| invalid())?).map_err(|_| invalid())?;
            if !v.allow_local_processing {
                return Err(invalid());
            };
            let normalized = serde_json::to_value(&v).map_err(|_| invalid())?;
            (
                Input {
                    processing_destination: "ollama".into(),
                    idempotency_key: v.idempotency_key,
                    span: None,
                },
                normalized,
            )
        } else {
            let v: Input =
                serde_json::from_value(raw.map_err(|_| invalid())?).map_err(|_| invalid())?;
            let normalized = serde_json::to_value(&v).map_err(|_| invalid())?;
            (v, normalized)
        };
        if !["ollama", "openrouter"].contains(&input.processing_destination.as_str())
            || !(8..=128).contains(&input.idempotency_key.chars().count())
        {
            return Err(invalid());
        }
        let tx = s.db.locked_owner_transaction(&p, &d).await?;
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
                    &d,
                    action,
                    &args,
                    h.get("x-cortex-confirmation").and_then(|v| v.to_str().ok()),
                )
                .await?;
        }
        execute(&s, &p, &d, &id, input, normalized).await
    }
    .await;
    match result{Ok(v)=>Json(v).into_response(),Err(e)if e.code=="CONFIRMATION_REQUIRED"=>(e.status,Json(json!({"error":e.code,"message":e.message,"confirmation_request":{"action":action,"command_hash":crate::confirmation::command_hash(action,&args).unwrap_or_default(),"transport_header":"X-Cortex-Confirmation","max_lifetime_seconds":300}}))).into_response(),Err(e)=>e.into_response()}
}
async fn source(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    id: &str,
) -> Result<PgRow, CoreError> {
    sqlx::query("SELECT * FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND allowed_subjects ? $4").bind(&p.tenant).bind(d).bind(id).bind(&p.subject).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)
}
fn result(id: &str, proposal: Value, metadata: &Value) -> Result<Value, CoreError> {
    let mut v = metadata.clone();
    let obj = v.as_object_mut().ok_or_else(CoreError::database)?;
    obj.entry("provider").or_insert(json!("ollama"));
    for name in ["input_span", "input_sha256", "request_id", "cost_usd"] {
        obj.entry(name).or_insert(Value::Null);
    }
    v["id"] = json!(id);
    v["proposal"] = proposal;
    v["processing"] = json!(if v["provider"] == "openrouter" {
        "openrouter_passage_selection"
    } else {
        "local_model_passage_selection"
    });
    Ok(v)
}
async fn existing(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    key: &str,
    hash: &str,
) -> Result<Option<Value>, CoreError> {
    let old=sqlx::query("SELECT * FROM cf_extractions WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND idempotency_key=$4").bind(&p.tenant).bind(d).bind(&p.subject).bind(key).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?;
    if let Some(r) = old {
        source(tx, p, d, r.get("source_id")).await?;
        if r.get::<String, _>("request_hash") != hash {
            return Err(model_provider::error(
                "IDEMPOTENCY_CONFLICT",
                StatusCode::CONFLICT,
            ));
        };
        let proposal = proposals::row(tx, p, d, r.get("proposal_id")).await?;
        let accessible = proposals::sources(tx, p, d).await?;
        proposals::check_access(tx, p, d, &proposal, &accessible).await?;
        p.check_fresh()?;
        return Ok(Some(result(
            r.get("id"),
            proposals::view(&proposal),
            &r.get::<Value, _>("model_metadata"),
        )?));
    }
    Ok(None)
}
pub(crate) struct Completion {
    pub attempt: String,
    pub source: String,
    pub key: String,
    pub hash: String,
    pub metadata: Value,
}
impl Completion {
    pub(crate) async fn finish(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        p: &Principal,
        d: &str,
        proposal: Value,
    ) -> Result<Value, CoreError> {
        source(tx, p, d, &self.source).await?;
        let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cf_model_attempts WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND author=$4 AND source_id=$5 AND request_hash=$6)").bind(&p.tenant).bind(d).bind(&self.attempt).bind(&p.subject).bind(&self.source).bind(&self.hash).fetch_one(&mut **tx).await.map_err(CoreError::sql)?;
        if !valid {
            return Err(CoreError::database());
        }
        if let Some(v) = existing(tx, p, d, &self.key, &self.hash).await? {
            sqlx::query("INSERT INTO cf_model_outcomes(tenant_id,domain_id,attempt_id,status,extraction_id) VALUES($1,$2,$3,'succeeded',$4)").bind(&p.tenant).bind(d).bind(&self.attempt).bind(v["id"].as_str().ok_or_else(CoreError::database)?).execute(&mut **tx).await.map_err(CoreError::sql)?;
            return Ok(v);
        }
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO cf_extractions(tenant_id,domain_id,id,author,source_id,proposal_id,model_metadata,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)").bind(&p.tenant).bind(d).bind(&id).bind(&p.subject).bind(&self.source).bind(proposal["id"].as_str().ok_or_else(CoreError::database)?).bind(&self.metadata).bind(&self.key).bind(&self.hash).execute(&mut **tx).await.map_err(CoreError::sql)?;
        sqlx::query("INSERT INTO cf_model_outcomes(tenant_id,domain_id,attempt_id,status,extraction_id) VALUES($1,$2,$3,'succeeded',$4)").bind(&p.tenant).bind(d).bind(&self.attempt).bind(&id).execute(&mut **tx).await.map_err(CoreError::sql)?;
        result(&id, proposal, &self.metadata)
    }
}
async fn failed(s: &StateData, p: &Principal, d: &str, id: &str, code: &str) {
    let result:Result<(),CoreError>=async{let mut tx=s.db.pool.begin().await.map_err(CoreError::sql)?;sqlx::query("SELECT set_config('cortex.tenant',$1,true)").bind(&p.tenant).execute(&mut *tx).await.map_err(CoreError::sql)?;sqlx::query("INSERT INTO cf_model_outcomes(tenant_id,domain_id,attempt_id,status,error_code) SELECT tenant_id,domain_id,id,'failed',$5 FROM cf_model_attempts WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND author=$4 ON CONFLICT(tenant_id,domain_id,attempt_id) DO NOTHING").bind(&p.tenant).bind(d).bind(id).bind(&p.subject).bind(code).execute(&mut *tx).await.map_err(CoreError::sql)?;tx.commit().await.map_err(CoreError::sql)}.await;
    let _ = result;
}
static SLOT: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
async fn execute(
    s: &StateData,
    p: &Principal,
    d: &str,
    id: &str,
    input: Input,
    mut normalized: Value,
) -> Result<Value, CoreError> {
    let model = s
        .extraction
        .as_ref()
        .ok_or_else(|| model_provider::error("MODEL_DISABLED", StatusCode::SERVICE_UNAVAILABLE))?;
    if model.provider() != input.processing_destination {
        return Err(model_provider::error(
            "DESTINATION_MISMATCH",
            StatusCode::UNPROCESSABLE_ENTITY,
        ));
    };
    normalized["source"] = json!(id);
    let fingerprint = crate::canonical::digest(&normalized).map_err(|_| invalid())?;
    let mut tx = s.db.locked_owner_transaction(p, d).await?;
    let row = source(&mut tx, p, d, id).await?;
    if let Some(v) = existing(&mut tx, p, d, &input.idempotency_key, &fingerprint).await? {
        tx.commit().await.map_err(CoreError::sql)?;
        return Ok(v);
    }
    let text: String = row.get("content");
    let length = text.chars().count();
    let (base, stop) = input
        .span
        .as_ref()
        .map(|r| (r.start, r.end))
        .unwrap_or((0, length));
    if input
        .span
        .as_ref()
        .is_some_and(|r| r.source_id.to_string() != id)
        || stop > length
    {
        return Err(model_provider::error(
            "INVALID_SPAN",
            StatusCode::UNPROCESSABLE_ENTITY,
        ));
    };
    let content: String = text.chars().skip(base).take(stop - base).collect();
    if content.len() > 6000 {
        return Err(model_provider::error(
            "EXTRACTION_LIMIT",
            StatusCode::UNPROCESSABLE_ENTITY,
        ));
    }
    let _slot = SLOT
        .try_acquire()
        .map_err(|_| model_provider::error("MODEL_BUSY", StatusCode::SERVICE_UNAVAILABLE))?;
    let old=sqlx::query("SELECT request_hash FROM cf_model_attempts WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND idempotency_key=$4").bind(&p.tenant).bind(d).bind(&p.subject).bind(&input.idempotency_key).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    if let Some(old) = old {
        let code = if old.get::<String, _>("request_hash") == fingerprint {
            "MODEL_ATTEMPT_RECORDED"
        } else {
            "IDEMPOTENCY_CONFLICT"
        };
        return Err(model_provider::error(code, StatusCode::CONFLICT));
    }
    crate::synthesis::quota(&mut tx, p, d, s.model_daily_limit).await?;
    let attempt = Uuid::new_v4().to_string();
    let span = json!({"source_id":id,"start":base,"end":stop});
    let input_hash = format!("{:x}", Sha256::digest(content.as_bytes()));
    sqlx::query("INSERT INTO cf_model_attempts(tenant_id,domain_id,id,author,source_id,provider,requested_model,input_span,input_sha256,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)").bind(&p.tenant).bind(d).bind(&attempt).bind(&p.subject).bind(id).bind(model.provider()).bind(model.model()).bind(&span).bind(&input_hash).bind(&input.idempotency_key).bind(&fingerprint).execute(&mut *tx).await.map_err(CoreError::sql)?;
    sqlx::query(
        "UPDATE cf_domains SET accepted_version=accepted_version WHERE tenant_id=$1 AND id=$2",
    )
    .bind(&p.tenant)
    .bind(d)
    .execute(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    let outcome:Result<Value,CoreError>=async{p.check_fresh()?;let selected=model.select(&content).await?;let start=selected["start"].as_u64().ok_or_else(invalid)? as usize;let end=selected["end"].as_u64().ok_or_else(invalid)? as usize;let quote=selected["quote"].as_str().ok_or_else(invalid)?.to_owned();if !(start<end&&end<=content.chars().count())||content.chars().skip(start).take(end-start).collect::<String>()!=quote{return Err(model_provider::error("UNSUPPORTED_MODEL_OUTPUT",StatusCode::UNPROCESSABLE_ENTITY))}
 let mut tx=s.db.locked_owner_transaction(p,d).await?;source(&mut tx,p,d,id).await?;let published:i64=sqlx::query_scalar("SELECT published_version FROM cf_domains WHERE tenant_id=$1 AND id=$2").bind(&p.tenant).bind(d).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;tx.commit().await.map_err(CoreError::sql)?;
 use sha1::Digest as _;let quote_hash=crate::canonical::digest(&json!(quote)).map_err(|_|invalid())?;let name=format!("{}:{d}:{id}:{quote_hash}",p.tenant);let mut sha=sha1::Sha1::new();sha.update(Uuid::NAMESPACE_URL.as_bytes());sha.update(name.as_bytes());let hash=sha.finalize();let mut uuid=[0;16];uuid.copy_from_slice(&hash[..16]);uuid[6]=(uuid[6]&15)|0x50;uuid[8]=(uuid[8]&63)|0x80;let concept=Uuid::from_bytes(uuid);
 let mut metadata=selected;metadata.as_object_mut().ok_or_else(invalid)?.remove("quote");metadata.as_object_mut().ok_or_else(invalid)?.remove("start");metadata.as_object_mut().ok_or_else(invalid)?.remove("end");metadata["input_span"]=span;metadata["input_sha256"]=json!(input_hash);
 let completion=Completion{attempt:attempt.clone(),source:id.into(),key:input.idempotency_key.clone(),hash:fingerprint,metadata};let key=crate::canonical::digest(&json!(input.idempotency_key)).map_err(|_|invalid())?;
 let proposal=json!({"base_version":published,"changes":[{"kind":"put_concept","concept":{"concept_id":concept,"title":row.get::<String,_>("title"),"body":quote,"sources":[{"source_id":id,"start":base+start,"end":base+end}]}}],"reason":"Configured model selected an exact source passage; owner review required.","idempotency_key":format!("extract:{key}")});proposals::extracted(s,p,d,proposal,&completion).await}.await;
    if let Err(e) = &outcome {
        failed(s, p, d, &attempt, e.code).await
    }
    outcome
}
