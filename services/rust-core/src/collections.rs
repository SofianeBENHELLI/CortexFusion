//! Corpus collections with current ACLs and normalized creation receipts.
use crate::{error::CoreError, retrieval, server::StateData};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::get,
};
use http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Row, postgres::PgRow};
use std::collections::BTreeSet;
use uuid::Uuid;
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Invalid collection arguments or readers",
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
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Input {
    name: String,
    #[serde(default)]
    description: String,
    allowed_subjects: Vec<String>,
    idempotency_key: String,
}
#[derive(Deserialize)]
struct Page {
    #[serde(default = "twenty")]
    limit: usize,
    after: Option<Uuid>,
    #[serde(default)]
    q: String,
}
fn view(r: &PgRow) -> Value {
    json!({"id":r.get::<String,_>("id"),"name":r.get::<String,_>("name"),"description":r.get::<String,_>("description"),"allowed_subjects":r.get::<Value,_>("allowed_subjects")})
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route("/v1/domains/{domain}/collections", get(list).post(create))
        .route(
            "/v1/domains/{domain}/collections/{collection_id}",
            get(read),
        )
}
async fn create(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    input: Result<Json<Input>, axum::extract::rejection::JsonRejection>,
) -> Result<(StatusCode, Json<Value>), CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let Json(input) = input.map_err(|_| invalid())?;
    if !(1..=200).contains(&input.name.chars().count())
        || input.description.chars().count() > 2000
        || !(1..=100).contains(&input.allowed_subjects.len())
        || !(8..=128).contains(&input.idempotency_key.chars().count())
    {
        return Err(invalid());
    }
    let hash = crate::canonical::digest(&serde_json::to_value(&input).map_err(|_| invalid())?)
        .map_err(|_| invalid())?;
    let mut tx =
        s.db.locked_permission_transaction(
            &p,
            &d,
            &["owner", "corpus_manager"],
            "Corpus management permission required",
        )
        .await?;
    if let Some(r)=sqlx::query("SELECT * FROM cf_collections WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND idempotency_key=$4").bind(&p.tenant).bind(&d).bind(&p.subject).bind(&input.idempotency_key).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?{
 let acl:Vec<String>=serde_json::from_value(r.get("allowed_subjects")).map_err(|_|CoreError::database())?;if !acl.contains(&p.subject){return Err(CoreError::not_found())}
if r.get::<String,_>("request_hash")!=hash{return Err(CoreError{code:"IDEMPOTENCY_CONFLICT",message:"Collection key reused",status:StatusCode::CONFLICT})}let result=view(&r);p.check_fresh()?;tx.commit().await.map_err(CoreError::sql)?;return Ok((StatusCode::CREATED,Json(result)))}
    let members: Vec<String> = sqlx::query_scalar(
        "SELECT subject FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 FOR SHARE",
    )
    .bind(&p.tenant)
    .bind(&d)
    .fetch_all(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    let acl: BTreeSet<_> = input.allowed_subjects.iter().cloned().collect();
    if !acl.contains(&p.subject) || !acl.iter().all(|x| members.contains(x)) {
        return Err(invalid());
    }
    let r=sqlx::query("INSERT INTO cf_collections(tenant_id,domain_id,id,name,description,allowed_subjects,author,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *").bind(&p.tenant).bind(&d).bind(Uuid::new_v4().to_string()).bind(&input.name).bind(&input.description).bind(json!(acl)).bind(&p.subject).bind(&input.idempotency_key).bind(hash).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    let result = view(&r);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok((StatusCode::CREATED, Json(result)))
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
    let r=sqlx::query("SELECT * FROM cf_collections WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND allowed_subjects ? $4").bind(&p.tenant).bind(&d).bind(&id).bind(&p.subject).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
    let result = view(&r);
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
    if !(1..=100).contains(&q.limit) || q.q.chars().count() > 200 {
        return Err(invalid());
    }
    let mut tx = retrieval::transaction(&s, &p, &d).await?;
    let rows=sqlx::query("SELECT * FROM cf_collections WHERE tenant_id=$1 AND domain_id=$2 AND allowed_subjects ? $3 AND id>$4 AND strpos(lower(name),lower($5))>0 ORDER BY id LIMIT $6").bind(&p.tenant).bind(&d).bind(&p.subject).bind(q.after.map(|x|x.to_string()).unwrap_or_default()).bind(&q.q).bind((q.limit+1) as i64).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
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
