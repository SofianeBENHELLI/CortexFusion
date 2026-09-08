//! Immutable file bytes and current corpus ACLs. Parsing remains an explicit separate operation.
use crate::{auth::Principal, error::CoreError, retrieval, server::StateData};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use base64::{
    Engine,
    engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig},
};
use http::{HeaderMap, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Acquire, Postgres, Row, Transaction, postgres::PgRow};
use std::collections::BTreeSet;
use uuid::Uuid;
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Invalid file arguments or readers",
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
#[serde(deny_unknown_fields)]
struct Input {
    filename: String,
    content_base64: String,
    allowed_subjects: Vec<String>,
    idempotency_key: String,
}
#[derive(Deserialize)]
struct Page {
    #[serde(default = "twenty")]
    limit: usize,
    after: Option<Uuid>,
    #[serde(default)]
    pending: bool,
}
const ACCESS: &str = "SELECT f.* FROM cf_files f JOIN cf_collections c ON c.tenant_id=f.tenant_id AND c.domain_id=f.domain_id AND c.id=f.collection_id LEFT JOIN cf_sources s ON s.tenant_id=f.tenant_id AND s.domain_id=f.domain_id AND s.id=f.source_id WHERE f.tenant_id=$1 AND f.domain_id=$2 AND f.allowed_subjects ? $3 AND c.allowed_subjects ? $3 AND (f.source_id IS NULL OR s.allowed_subjects ? $3)";
async fn file(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    id: &str,
) -> Result<PgRow, CoreError> {
    sqlx::query(&format!("{ACCESS} AND f.id=$4"))
        .bind(&p.tenant)
        .bind(d)
        .bind(&p.subject)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(CoreError::sql)?
        .ok_or_else(CoreError::not_found)
}
fn view(r: &PgRow) -> Value {
    json!({"id":r.get::<String,_>("id"),"collection_id":r.get::<String,_>("collection_id"),"filename":r.get::<String,_>("filename"),"content_hash":r.get::<String,_>("content_hash"),"status":r.get::<String,_>("status"),"source_id":r.get::<Option<String>,_>("source_id"),"error_code":r.get::<Option<String>,_>("error_code"),"attempts":r.get::<i32,_>("attempts"),"spans":r.get::<Value,_>("spans"),"size_bytes":r.get::<Vec<u8>,_>("data").len()})
}
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
fn decode(s: &str) -> Result<Vec<u8>, CoreError> {
    let bare = s.trim_end_matches('=');
    if bare.is_empty() {
        return Err(invalid());
    }
    let padding = s.len() - bare.len();
    match bare.len() % 4 {
        0 if padding == 0 => {}
        2 if padding == 2 => {}
        3 if padding == 1 => {}
        _ => return Err(invalid()),
    }
    GeneralPurpose::new(
        &base64::alphabet::STANDARD,
        GeneralPurposeConfig::new()
            .with_decode_padding_mode(DecodePaddingMode::Indifferent)
            .with_decode_allow_trailing_bits(true),
    )
    .decode(bare)
    .map_err(|_| invalid())
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route(
            "/v1/domains/{domain}/collections/{collection}/files",
            post(upload),
        )
        .route("/v1/domains/{domain}/files", get(list))
        .route("/v1/domains/{domain}/files/{ident}", get(read))
        .route("/v1/domains/{domain}/files/{ident}/download", get(download))
        .route("/v1/domains/{domain}/files/{ident}/retry", post(retry))
        .route("/v1/domains/{domain}/files/{ident}/process", post(process))
        .route("/v1/domains/{domain}/files/{ident}/cancel", post(cancel))
}
async fn upload(
    State(s): State<StateData>,
    Path((d, c)): Path<(String, String)>,
    h: HeaderMap,
    input: Result<Json<Input>, axum::extract::rejection::JsonRejection>,
) -> Result<(StatusCode, Json<Value>), CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let c = uuid(&c)?;
    let Json(i) = input.map_err(|_| invalid())?;
    if !(1..=200).contains(&i.filename.chars().count())
        || i.filename
            .chars()
            .any(|c| c == '/' || c == '\\' || (c as u32) < 32)
        || !(1..=666668).contains(&i.content_base64.len())
        || !(1..=100).contains(&i.allowed_subjects.len())
        || !(8..=128).contains(&i.idempotency_key.chars().count())
    {
        return Err(invalid());
    }
    let raw = decode(&i.content_base64)?;
    if raw.is_empty() || raw.len() > 500000 {
        return Err(CoreError {
            code: "DOCUMENT_LIMIT",
            message: "File must contain 1 to 500000 bytes",
            status: StatusCode::UNPROCESSABLE_ENTITY,
        });
    }
    let mut tx = write_tx(&s, &p, &d).await?;
    let col:Value=sqlx::query_scalar("SELECT allowed_subjects FROM cf_collections WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND allowed_subjects ? $4").bind(&p.tenant).bind(&d).bind(&c).bind(&p.subject).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
    let members: Vec<String> = sqlx::query_scalar(
        "SELECT subject FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 FOR SHARE",
    )
    .bind(&p.tenant)
    .bind(&d)
    .fetch_all(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    let acl: BTreeSet<String> = i.allowed_subjects.into_iter().collect();
    let col: Vec<String> = serde_json::from_value(col).map_err(|_| CoreError::database())?;
    if !acl.contains(&p.subject) || !acl.iter().all(|x| members.contains(x) && col.contains(x)) {
        return Err(invalid());
    }
    let hash = format!("{:x}", Sha256::digest(&raw));
    let fingerprint = crate::canonical::digest(
        &json!({"collection":c,"filename":i.filename,"hash":hash,"readers":acl}),
    )
    .map_err(|_| invalid())?;
    let old=sqlx::query("SELECT id,request_hash FROM cf_files WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND idempotency_key=$4").bind(&p.tenant).bind(&d).bind(&p.subject).bind(&i.idempotency_key).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    let result = if let Some(old) = old {
        let r = file(&mut tx, &p, &d, &old.get::<String, _>("id")).await?;
        if old.get::<String, _>("request_hash") != fingerprint {
            return Err(CoreError {
                code: "IDEMPOTENCY_CONFLICT",
                message: "Upload key reused",
                status: StatusCode::CONFLICT,
            });
        }
        view(&r)
    } else {
        let r=sqlx::query("INSERT INTO cf_files(tenant_id,domain_id,id,collection_id,author,filename,content_hash,data,allowed_subjects,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *").bind(&p.tenant).bind(&d).bind(Uuid::new_v4().to_string()).bind(&c).bind(&p.subject).bind(&i.filename).bind(&hash).bind(&raw).bind(json!(acl)).bind(&i.idempotency_key).bind(&fingerprint).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
        view(&r)
    };
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
    let result = view(&file(&mut tx, &p, &d, &id).await?);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
async fn download(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
) -> Result<Response, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let mut tx = retrieval::transaction(&s, &p, &d).await?;
    let raw: Vec<u8> = file(&mut tx, &p, &d, &id).await?.get("data");
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok((
        [
            ("content-type", "application/octet-stream"),
            ("content-disposition", "attachment; filename=\"source.bin\""),
            ("x-content-type-options", "nosniff"),
            ("cache-control", "no-store"),
        ],
        raw,
    )
        .into_response())
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
    let rows=sqlx::query(&format!("{ACCESS} AND f.id>$4 AND (NOT $5 OR f.status='pending' OR (f.status='processing' AND f.lease_until<now())) ORDER BY f.id LIMIT $6")).bind(&p.tenant).bind(&d).bind(&p.subject).bind(q.after.map(|x|x.to_string()).unwrap_or_default()).bind(q.pending).bind((q.limit+1)as i64).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let next = if rows.len() > q.limit {
        json!(rows[q.limit - 1].get::<String, _>("id"))
    } else {
        Value::Null
    };
    let result =
        json!({"items":rows.iter().take(q.limit).map(view).collect::<Vec<_>>(),"next_after":next});
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
async fn retry(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    control(s, d, id, h, true).await
}
async fn cancel(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    control(s, d, id, h, false).await
}
async fn control(
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
    let r = file(&mut tx, &p, &d, &id).await?;
    let status: String = r.get("status");
    if (retry && status == "failed") || (!retry && (status == "pending" || status == "processing"))
    {
        sqlx::query("UPDATE cf_files SET status=$4,error_code=NULL,lease_token=NULL,lease_until=NULL WHERE tenant_id=$1 AND domain_id=$2 AND id=$3").bind(&p.tenant).bind(&d).bind(&id).bind(if retry{"pending"}else{"cancelled"}).execute(&mut *tx).await.map_err(CoreError::sql)?;
    }
    let result = view(&file(&mut tx, &p, &d, &id).await?);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
static PARSE_SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);

async fn process(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let mut tx = write_tx(&s, &p, &d).await?;
    let r = file(&mut tx, &p, &d, &id).await?;
    let status: String = r.get("status");
    if status == "succeeded" || status == "failed" {
        let result = view(&r);
        p.check_fresh()?;
        tx.commit().await.map_err(CoreError::sql)?;
        return Ok(Json(result));
    };
    if status == "cancelled" {
        return Err(CoreError {
            code: "FILE_CANCELLED",
            message: "File processing cancelled",
            status: StatusCode::CONFLICT,
        });
    }
    let active:bool=sqlx::query_scalar("SELECT COALESCE(lease_until>now(),false) FROM cf_files WHERE tenant_id=$1 AND domain_id=$2 AND id=$3").bind(&p.tenant).bind(&d).bind(&id).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    if status == "processing" && active {
        return Err(CoreError {
            code: "FILE_BUSY",
            message: "Parsing lease already held",
            status: StatusCode::CONFLICT,
        });
    }
    let _slot = PARSE_SLOTS.try_acquire().map_err(|_| CoreError {
        code: "FILE_BUSY",
        message: "Native parser capacity is occupied",
        status: StatusCode::SERVICE_UNAVAILABLE,
    })?;
    let attempt = r
        .get::<i32, _>("attempts")
        .checked_add(1)
        .ok_or_else(CoreError::database)?;
    let lease = Uuid::new_v4().to_string();
    sqlx::query("UPDATE cf_files SET status='processing',attempts=$4,lease_token=$5,lease_until=now()+interval '60 seconds' WHERE tenant_id=$1 AND domain_id=$2 AND id=$3").bind(&p.tenant).bind(&d).bind(&id).bind(attempt).bind(&lease).execute(&mut *tx).await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    let result =
        crate::document_parser::parse(r.get("data"), &r.get::<String, _>("filename")).await;
    let mut tx = write_tx(&s, &p, &d).await?;
    let r = file(&mut tx, &p, &d, &id).await?;
    if r.get::<String, _>("status") != "processing"
        || r.get::<Option<String>, _>("lease_token").as_deref() != Some(&lease)
    {
        return Err(CoreError {
            code: "STALE_LEASE",
            message: "Parsing result belongs to an obsolete job",
            status: StatusCode::CONFLICT,
        });
    }
    let mut error = result.error_code;
    let mut source = None;
    if error.is_none() {
        let mut nested = tx.begin().await.map_err(CoreError::sql)?;
        let outcome:Result<String,CoreError>=async{let source=crate::sources::create_in_transaction(&mut nested,&p,&d,crate::sources::SourceInput{title:r.get("filename"),location:format!("document://{}/{}/{}",r.get::<String,_>("collection_id"),r.get::<String,_>("filename"),r.get::<String,_>("content_hash")),content:result.content.ok_or_else(CoreError::database)?,allowed_subjects:serde_json::from_value(r.get("allowed_subjects")).map_err(|_|CoreError::database())?,supersedes:None}).await?;let source=source["id"].as_str().ok_or_else(CoreError::database)?.to_owned();sqlx::query("INSERT INTO cf_collection_sources(tenant_id,domain_id,collection_id,source_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING").bind(&p.tenant).bind(&d).bind(r.get::<String,_>("collection_id")).bind(&source).execute(&mut *nested).await.map_err(CoreError::sql)?;Ok(source)}.await;
        match outcome {
            Ok(id) => {
                nested.commit().await.map_err(CoreError::sql)?;
                source = Some(id)
            }
            Err(e) => {
                nested.rollback().await.map_err(CoreError::sql)?;
                if e.status.is_server_error()
                    || e.code == "CONCURRENT_CHANGE"
                    || e.status == StatusCode::UNAUTHORIZED
                {
                    return Err(e);
                }
                error = Some(e.code.to_owned())
            }
        }
    }
    sqlx::query("UPDATE cf_files SET status=$4,source_id=$5,error_code=$6,spans=$7,lease_token=NULL,lease_until=NULL WHERE tenant_id=$1 AND domain_id=$2 AND id=$3").bind(&p.tenant).bind(&d).bind(&id).bind(if error.is_some(){"failed"}else{"succeeded"}).bind(source).bind(&error).bind(if error.is_none(){json!(result.spans)}else{json!([])}).execute(&mut *tx).await.map_err(CoreError::sql)?;
    let result = view(&file(&mut tx, &p, &d, &id).await?);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
