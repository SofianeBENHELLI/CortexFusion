//! Durable, bounded text imports; no URL fetch, model call or hidden worker.
use crate::{auth::Principal, error::CoreError, retrieval, server::StateData, sources};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, post},
};
use http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Acquire, Postgres, Row, Transaction, postgres::PgRow};
use uuid::Uuid;
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Invalid text import arguments or readers",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn cancelled() -> CoreError {
    CoreError {
        code: "IMPORT_CANCELLED",
        message: "Cancelled import cannot be processed or retried",
        status: StatusCode::CONFLICT,
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
fn one() -> usize {
    1
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Item {
    filename: String,
    content: String,
    allowed_subjects: Vec<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    items: Vec<Item>,
    idempotency_key: String,
}
#[derive(Deserialize)]
struct Page {
    #[serde(default = "twenty")]
    limit: usize,
    after: Option<Uuid>,
}
#[derive(Deserialize)]
struct Process {
    #[serde(default = "one")]
    limit: usize,
}
const ACCESS: &str = "j.author=$3 AND c.allowed_subjects ? $3 AND NOT EXISTS(SELECT 1 FROM cf_import_items i LEFT JOIN cf_sources s ON s.tenant_id=i.tenant_id AND s.domain_id=i.domain_id AND s.id=i.source_id WHERE i.tenant_id=j.tenant_id AND i.domain_id=j.domain_id AND i.import_id=j.id AND (NOT(i.payload->'allowed_subjects' ? $3) OR (i.source_id IS NOT NULL AND (s.id IS NULL OR NOT(s.allowed_subjects ? $3)))))";
async fn write_tx<'a>(
    s: &'a StateData,
    p: &Principal,
    d: &str,
) -> Result<Transaction<'a, Postgres>, CoreError> {
    s.db.locked_permission_transaction(
        p,
        d,
        &["owner", "corpus_manager"],
        "Corpus management permission required",
    )
    .await
}
async fn job(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    id: &str,
) -> Result<PgRow, CoreError> {
    sqlx::query(&format!("SELECT j.* FROM cf_imports j JOIN cf_collections c ON c.tenant_id=j.tenant_id AND c.domain_id=j.domain_id AND c.id=j.collection_id WHERE j.tenant_id=$1 AND j.domain_id=$2 AND {ACCESS} AND j.id=$4")).bind(&p.tenant).bind(d).bind(&p.subject).bind(id).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)
}
async fn view(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    r: &PgRow,
) -> Result<Value, CoreError> {
    let items=sqlx::query("SELECT position,payload,status,source_id,error_code,attempts FROM cf_import_items WHERE tenant_id=$1 AND domain_id=$2 AND import_id=$3 ORDER BY position").bind(&p.tenant).bind(d).bind(r.get::<String,_>("id")).fetch_all(&mut **tx).await.map_err(CoreError::sql)?;
    let states = items
        .iter()
        .map(|r| r.get::<&str, _>("status"))
        .collect::<std::collections::BTreeSet<_>>();
    let state = if r.get::<bool, _>("cancelled") {
        "cancelled"
    } else if states.len() == 1 && states.contains("succeeded") {
        "succeeded"
    } else if states.len() == 1 && states.contains("failed") {
        "failed"
    } else if states.len() == 1 && states.contains("pending") {
        "pending"
    } else {
        "partial"
    };
    Ok(
        json!({"id":r.get::<String,_>("id"),"collection_id":r.get::<String,_>("collection_id"),"status":state,"processing":"local_text_only","items":items.iter().map(|i|json!({"position":i.get::<i32,_>("position"),"filename":i.get::<Value,_>("payload")["filename"],"status":i.get::<String,_>("status"),"source_id":i.get::<Option<String>,_>("source_id"),"error_code":i.get::<Option<String>,_>("error_code"),"attempts":i.get::<i32,_>("attempts")})).collect::<Vec<_>>()}),
    )
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route(
            "/v1/domains/{domain}/collections/{collection_id}/imports",
            post(create),
        )
        .route("/v1/domains/{domain}/imports", get(list))
        .route("/v1/domains/{domain}/imports/{import_id}", get(read))
        .route(
            "/v1/domains/{domain}/imports/{import_id}/process",
            post(process),
        )
        .route(
            "/v1/domains/{domain}/imports/{import_id}/cancel",
            post(cancel),
        )
        .route(
            "/v1/domains/{domain}/imports/{import_id}/retry",
            post(retry),
        )
}
async fn create(
    State(s): State<StateData>,
    Path((d, c)): Path<(String, String)>,
    h: HeaderMap,
    input: Result<Json<Input>, axum::extract::rejection::JsonRejection>,
) -> Result<(StatusCode, Json<Value>), CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let c = uuid(&c)?;
    let Json(input) = input.map_err(|_| invalid())?;
    if !(1..=20).contains(&input.items.len())
        || !(8..=128).contains(&input.idempotency_key.chars().count())
        || input.items.iter().any(|i| {
            !(1..=200).contains(&i.filename.chars().count())
                || i.filename
                    .chars()
                    .any(|c| c == '/' || c == '\\' || c <= '\u{1f}')
                || !(1..=30000).contains(&i.content.chars().count())
                || i.content.contains('\0')
                || !(1..=100).contains(&i.allowed_subjects.len())
        })
    {
        return Err(invalid());
    }
    let mut normalized = serde_json::to_value(&input).map_err(|_| invalid())?;
    normalized["collection"] = json!(c);
    let hash = crate::canonical::digest(&normalized).map_err(|_| invalid())?;
    let mut tx = write_tx(&s, &p, &d).await?;
    let acl:Value=sqlx::query_scalar("SELECT allowed_subjects FROM cf_collections WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND allowed_subjects ? $4").bind(&p.tenant).bind(&d).bind(&c).bind(&p.subject).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
    let acl: Vec<String> = serde_json::from_value(acl).map_err(|_| CoreError::database())?;
    if let Some(existing)=sqlx::query("SELECT id,request_hash FROM cf_imports WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND idempotency_key=$4").bind(&p.tenant).bind(&d).bind(&p.subject).bind(&input.idempotency_key).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?{let r=job(&mut tx,&p,&d,existing.get("id")).await?;if existing.get::<String,_>("request_hash")!=hash{return Err(CoreError{code:"IDEMPOTENCY_CONFLICT",message:"Import key reused",status:StatusCode::CONFLICT})}let result=view(&mut tx,&p,&d,&r).await?;p.check_fresh()?;tx.commit().await.map_err(CoreError::sql)?;return Ok((StatusCode::ACCEPTED,Json(result)))}
    let members: Vec<String> = sqlx::query_scalar(
        "SELECT subject FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 FOR SHARE",
    )
    .bind(&p.tenant)
    .bind(&d)
    .fetch_all(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    for item in &input.items {
        if !item.allowed_subjects.contains(&p.subject)
            || !item
                .allowed_subjects
                .iter()
                .all(|s| acl.contains(s) && members.contains(s))
        {
            return Err(invalid());
        }
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO cf_imports(tenant_id,domain_id,id,collection_id,author,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(&p.tenant).bind(&d).bind(&id).bind(&c).bind(&p.subject).bind(&input.idempotency_key).bind(hash).execute(&mut *tx).await.map_err(CoreError::sql)?;
    for (pos, item) in input.items.iter().enumerate() {
        sqlx::query("INSERT INTO cf_import_items(tenant_id,domain_id,import_id,position,payload) VALUES($1,$2,$3,$4,$5)").bind(&p.tenant).bind(&d).bind(&id).bind(pos as i32).bind(serde_json::to_value(item).map_err(|_|invalid())?).execute(&mut *tx).await.map_err(CoreError::sql)?;
    }
    let r = job(&mut tx, &p, &d, &id).await?;
    let result = view(&mut tx, &p, &d, &r).await?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok((StatusCode::ACCEPTED, Json(result)))
}
async fn read(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let mut tx = retrieval::transaction(&s, &p, &d).await?;
    let r = job(&mut tx, &p, &d, &id).await?;
    let result = view(&mut tx, &p, &d, &r).await?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
async fn list(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    input: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let Query(q) = input.map_err(|_| invalid())?;
    if !(1..=100).contains(&q.limit) {
        return Err(invalid());
    }
    let mut tx = retrieval::transaction(&s, &p, &d).await?;
    let rows=sqlx::query(&format!("SELECT j.* FROM cf_imports j JOIN cf_collections c ON c.tenant_id=j.tenant_id AND c.domain_id=j.domain_id AND c.id=j.collection_id WHERE j.tenant_id=$1 AND j.domain_id=$2 AND {ACCESS} AND j.id>$4 ORDER BY j.id LIMIT $5")).bind(&p.tenant).bind(&d).bind(&p.subject).bind(q.after.map(|x|x.to_string()).unwrap_or_default()).bind((q.limit+1)as i64).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let next = if rows.len() > q.limit {
        json!(rows[q.limit - 1].get::<String, _>("id"))
    } else {
        Value::Null
    };
    let mut items = Vec::new();
    for r in rows.iter().take(q.limit) {
        items.push(view(&mut tx, &p, &d, r).await?)
    }
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(json!({"items":items,"next_after":next})))
}
async fn process(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
    input: Result<Query<Process>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let Query(q) = input.map_err(|_| invalid())?;
    if !(1..=20).contains(&q.limit) {
        return Err(invalid());
    }
    let mut tx = write_tx(&s, &p, &d).await?;
    let r = job(&mut tx, &p, &d, &id).await?;
    if r.get::<bool, _>("cancelled") {
        return Err(cancelled());
    }
    let items=sqlx::query("SELECT position,payload,attempts FROM cf_import_items WHERE tenant_id=$1 AND domain_id=$2 AND import_id=$3 AND status='pending' ORDER BY position LIMIT $4").bind(&p.tenant).bind(&d).bind(&id).bind(q.limit as i64).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    for i in items {
        let item: Item =
            serde_json::from_value(i.get("payload")).map_err(|_| CoreError::database())?;
        let attempt = i
            .get::<i32, _>("attempts")
            .checked_add(1)
            .ok_or_else(CoreError::database)?;
        let mut nested = tx.begin().await.map_err(CoreError::sql)?;
        let outcome:Result<String,CoreError>=async{let lower=item.filename.to_lowercase();if ![".txt",".md",".markdown"].iter().any(|s|lower.ends_with(s)){return Err(CoreError{code:"UNSUPPORTED_FORMAT",message:"Only text and Markdown are supported",status:StatusCode::UNPROCESSABLE_ENTITY})}
if item.content.contains('\0'){return Err(CoreError{code:"INVALID_TEXT",message:"Text contains null characters",status:StatusCode::UNPROCESSABLE_ENTITY})}
 let source=sources::create_in_transaction(&mut nested,&p,&d,sources::SourceInput{title:item.filename.clone(),location:format!("upload://{}/{}",r.get::<String,_>("collection_id"),item.filename),content:item.content,allowed_subjects:item.allowed_subjects,supersedes:None}).await?;let source=source["id"].as_str().ok_or_else(CoreError::database)?.to_owned();sqlx::query("INSERT INTO cf_collection_sources(tenant_id,domain_id,collection_id,source_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING").bind(&p.tenant).bind(&d).bind(r.get::<String,_>("collection_id")).bind(&source).execute(&mut *nested).await.map_err(CoreError::sql)?;Ok(source)}.await;
        let (source, error) = match outcome {
            Ok(source) => {
                nested.commit().await.map_err(CoreError::sql)?;
                (Some(source), None)
            }
            Err(e) => {
                nested.rollback().await.map_err(CoreError::sql)?;
                if e.status.is_server_error()
                    || e.code == "CONCURRENT_CHANGE"
                    || e.status == StatusCode::UNAUTHORIZED
                {
                    return Err(e);
                }
                (None, Some(e.code))
            }
        };
        sqlx::query("UPDATE cf_import_items SET status=$1,source_id=$2,error_code=$3,attempts=$4 WHERE tenant_id=$5 AND domain_id=$6 AND import_id=$7 AND position=$8").bind(if error.is_some(){"failed"}else{"succeeded"}).bind(source).bind(error).bind(attempt).bind(&p.tenant).bind(&d).bind(&id).bind(i.get::<i32,_>("position")).execute(&mut *tx).await.map_err(CoreError::sql)?;
    }
    let r = job(&mut tx, &p, &d, &id).await?;
    let result = view(&mut tx, &p, &d, &r).await?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
async fn cancel(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    change(s, d, id, h, false).await
}
async fn retry(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    change(s, d, id, h, true).await
}
async fn change(
    s: StateData,
    d: String,
    id: String,
    h: HeaderMap,
    retry: bool,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let mut tx = write_tx(&s, &p, &d).await?;
    let r = job(&mut tx, &p, &d, &id).await?;
    if retry {
        if r.get::<bool, _>("cancelled") {
            return Err(cancelled());
        }
        sqlx::query("UPDATE cf_import_items SET status='pending',error_code=NULL WHERE tenant_id=$1 AND domain_id=$2 AND import_id=$3 AND status='failed'").bind(&p.tenant).bind(&d).bind(&id).execute(&mut *tx).await.map_err(CoreError::sql)?;
    } else {
        let affected=sqlx::query("UPDATE cf_import_items SET status='cancelled' WHERE tenant_id=$1 AND domain_id=$2 AND import_id=$3 AND status='pending'").bind(&p.tenant).bind(&d).bind(&id).execute(&mut *tx).await.map_err(CoreError::sql)?.rows_affected();
        if affected > 0 {
            sqlx::query("UPDATE cf_imports SET cancelled=true WHERE tenant_id=$1 AND domain_id=$2 AND id=$3").bind(&p.tenant).bind(&d).bind(&id).execute(&mut *tx).await.map_err(CoreError::sql)?;
        }
    }
    let r = job(&mut tx, &p, &d, &id).await?;
    let result = view(&mut tx, &p, &d, &r).await?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
