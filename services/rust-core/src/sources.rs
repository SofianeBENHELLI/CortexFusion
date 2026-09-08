//! Source registration and reads retain PostgreSQL evidence immutability and current ACLs.
use crate::{error::CoreError, server::StateData};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::get,
};
use http::{HeaderMap, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Row, postgres::PgRow};
use std::collections::BTreeSet;
use uuid::Uuid;
fn invalid(message: &'static str) -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message,
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn missing() -> CoreError {
    CoreError {
        code: "NOT_FOUND",
        message: "Source not found",
        status: StatusCode::NOT_FOUND,
    }
}
fn uuid(value: &str) -> Result<String, CoreError> {
    Uuid::parse_str(value)
        .map(|id| id.to_string())
        .map_err(|_| CoreError::invalid_uuid())
}
fn summary(row: &PgRow) -> Value {
    json!({"id":row.get::<String,_>("id"),"title":row.get::<String,_>("title"),"location":row.get::<String,_>("location"),"content_hash":row.get::<String,_>("content_hash"),"allowed_subjects":row.get::<Value,_>("allowed_subjects"),"supersedes":row.get::<Option<String>,_>("supersedes")})
}
fn twenty() -> usize {
    20
}
fn ten() -> usize {
    10
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ListInput {
    #[serde(default = "twenty")]
    limit: usize,
    after: Option<Uuid>,
    #[serde(default)]
    q: String,
    collection_id: Option<Uuid>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ChunkInput {
    #[serde(default)]
    offset: usize,
    #[serde(default = "ten")]
    limit: usize,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SourceInput {
    pub(crate) title: String,
    pub(crate) location: String,
    pub(crate) content: String,
    pub(crate) allowed_subjects: Vec<String>,
    pub(crate) supersedes: Option<Uuid>,
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route("/v1/domains/{domain}/sources", get(list).post(create))
        .route("/v1/domains/{domain}/sources/{source_id}", get(read))
        .route(
            "/v1/domains/{domain}/sources/{source_id}/chunks",
            get(chunks),
        )
}
async fn read(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let id = uuid(&id)?;
    let mut tx = s.db.transaction(&p, &domain, false).await?;
    let row=sqlx::query("SELECT * FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND allowed_subjects ? $4").bind(&p.tenant).bind(&domain).bind(&id).bind(&p.subject).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?.ok_or_else(missing)?;
    let mut value = summary(&row);
    value["content"] = json!(row.get::<String, _>("content"));
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(value))
}
async fn list(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
    input: Result<Query<ListInput>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let Query(input) = input.map_err(|_| invalid("Invalid source query"))?;
    if !(1..=100).contains(&input.limit) || input.q.chars().count() > 200 {
        return Err(invalid("Invalid source query"));
    }
    let mut tx = s.db.transaction(&p, &domain, false).await?;
    let collection = input
        .collection_id
        .map(|id| id.to_string())
        .unwrap_or_default();
    if !collection.is_empty() {
        let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cf_collections WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND allowed_subjects ? $4)").bind(&p.tenant).bind(&domain).bind(&collection).bind(&p.subject).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
        if !exists {
            return Err(CoreError {
                code: "NOT_FOUND",
                message: "Collection not found",
                status: StatusCode::NOT_FOUND,
            });
        }
    }
    let rows=sqlx::query("SELECT s.* FROM cf_sources s WHERE s.tenant_id=$1 AND s.domain_id=$2 AND s.allowed_subjects ? $3 AND s.id>$4 AND strpos(lower(s.title),lower($5))>0 AND ($6='' OR EXISTS(SELECT 1 FROM cf_collection_sources cs WHERE cs.tenant_id=s.tenant_id AND cs.domain_id=s.domain_id AND cs.source_id=s.id AND cs.collection_id=$6)) ORDER BY s.id LIMIT $7").bind(&p.tenant).bind(&domain).bind(&p.subject).bind(input.after.map(|id|id.to_string()).unwrap_or_default()).bind(input.q).bind(collection).bind((input.limit+1)as i64).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let next = if rows.len() > input.limit {
        Some(rows[input.limit - 1].get::<String, _>("id"))
    } else {
        None
    };
    let value = json!({"items":rows.iter().take(input.limit).map(summary).collect::<Vec<_>>(),"next_after":next});
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(value))
}
pub fn source_chunks(content: &str) -> Vec<Value> {
    let chars: Vec<char> = content.chars().collect();
    let mut start = 0;
    let mut chunks = Vec::new();
    while start < chars.len() {
        let (mut end, mut bytes) = (start, 0);
        while end < chars.len() && end - start < 2000 {
            let width = chars[end].len_utf8();
            if bytes + width > 6000 {
                break;
            }
            bytes += width;
            end += 1;
        }
        if end < chars.len() {
            for candidate in ((start.max(end.saturating_sub(200)) + 1)..=end).rev() {
                let c = chars[candidate - 1];
                if c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c) {
                    end = candidate;
                    break;
                }
            }
        }
        let text: String = chars[start..end].iter().collect();
        let hash = format!("{:x}", Sha256::digest(text.as_bytes()));
        chunks.push(json!({"start":start,"end":end,"content":text,"sha256":hash}));
        start = end;
    }
    chunks
}
async fn chunks(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
    input: Result<Query<ChunkInput>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let id = uuid(&id)?;
    let Query(input) = input.map_err(|_| invalid("Invalid chunk query"))?;
    if !(1..=50).contains(&input.limit) {
        return Err(invalid("Invalid chunk query"));
    }
    let mut tx = s.db.transaction(&p, &domain, false).await?;
    let content:Option<String>=sqlx::query_scalar("SELECT content FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND allowed_subjects ? $4").bind(&p.tenant).bind(&domain).bind(&id).bind(&p.subject).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    let content = content.ok_or_else(missing)?;
    let all = source_chunks(&content);
    if input.offset != content.chars().count()
        && !all
            .iter()
            .any(|c| c["start"].as_u64() == Some(input.offset as u64))
    {
        return Err(CoreError {
            code: "INVALID_CURSOR",
            message: "Offset must be a chunk boundary",
            status: StatusCode::UNPROCESSABLE_ENTITY,
        });
    }
    let remaining: Vec<Value> = all
        .into_iter()
        .filter(|c| c["start"].as_u64().unwrap_or_default() >= input.offset as u64)
        .collect();
    let next = if remaining.len() > input.limit {
        remaining[input.limit - 1]["end"].clone()
    } else {
        Value::Null
    };
    let value = json!({"source_id":id,"algorithm":"unicode-2000-6000-v1","items":remaining.into_iter().take(input.limit).collect::<Vec<_>>(),"next_offset":next});
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(value))
}
async fn create(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
    input: Result<Json<SourceInput>, axum::extract::rejection::JsonRejection>,
) -> Result<(StatusCode, Json<Value>), CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let Json(input) = input.map_err(|_| invalid("Invalid source input"))?;
    if !(1..=200).contains(&input.title.chars().count())
        || !(1..=1000).contains(&input.location.chars().count())
        || !(1..=200000).contains(&input.content.chars().count())
        || !(1..=100).contains(&input.allowed_subjects.len())
    {
        return Err(invalid("Invalid source input"));
    }
    let mut tx =
        s.db.locked_permission_transaction(
            &p,
            &domain,
            &["owner", "corpus_manager"],
            "Corpus management permission required",
        )
        .await?;
    let result = create_in_transaction(&mut tx, &p, &domain, input).await?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok((StatusCode::CREATED, Json(result)))
}
pub(crate) async fn create_in_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    p: &crate::auth::Principal,
    domain: &str,
    input: SourceInput,
) -> Result<Value, CoreError> {
    let members: Vec<String> = sqlx::query_scalar(
        "SELECT subject FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 FOR SHARE",
    )
    .bind(&p.tenant)
    .bind(domain)
    .fetch_all(&mut **tx)
    .await
    .map_err(CoreError::sql)?;
    let acl: BTreeSet<String> = input.allowed_subjects.into_iter().collect();
    if !acl.iter().all(|subject| members.contains(subject)) {
        return Err(invalid("Source readers must be domain members"));
    }
    if !acl.contains(&p.subject) {
        return Err(invalid("Uploader must retain access"));
    }
    let supersedes = input.supersedes.map(|id| id.to_string());
    if let Some(id) = &supersedes {
        let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND allowed_subjects ? $4)").bind(&p.tenant).bind(domain).bind(id).bind(&p.subject).fetch_one(&mut **tx).await.map_err(CoreError::sql)?;
        if !exists {
            return Err(missing());
        }
    }
    let hash = format!("{:x}", Sha256::digest(input.content.as_bytes()));
    let existing=sqlx::query("SELECT * FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND location=$3 AND content_hash=$4").bind(&p.tenant).bind(domain).bind(&input.location).bind(&hash).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?;
    if let Some(row) = existing {
        let old: Vec<String> = serde_json::from_value(row.get("allowed_subjects"))
            .map_err(|_| CoreError::database())?;
        if !old.contains(&p.subject) {
            return Err(missing());
        }
        if row.get::<String, _>("title") != input.title
            || row.get::<Option<String>, _>("supersedes") != supersedes
            || old.into_iter().collect::<BTreeSet<_>>() != acl
        {
            return Err(CoreError {
                code: "IDEMPOTENCY_CONFLICT",
                message: "Source already exists with different metadata",
                status: StatusCode::CONFLICT,
            });
        }
        p.check_fresh()?;
        return Ok(summary(&row));
    }
    let id = Uuid::new_v4().to_string();
    let row=sqlx::query("INSERT INTO cf_sources(tenant_id,domain_id,id,title,location,content,content_hash,allowed_subjects,supersedes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *").bind(&p.tenant).bind(domain).bind(id).bind(input.title).bind(input.location).bind(input.content).bind(hash).bind(json!(acl)).bind(supersedes).fetch_one(&mut **tx).await.map_err(CoreError::sql)?;
    let result = summary(&row);
    p.check_fresh()?;
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unicode_chunks_are_lossless_and_bounded() {
        let text = ("é🧠\u{1c} A".repeat(1000)) + "fin";
        let chunks = source_chunks(&text);
        assert_eq!(
            chunks
                .iter()
                .map(|c| c["content"].as_str().unwrap())
                .collect::<String>(),
            text
        );
        for c in chunks {
            let s = c["content"].as_str().unwrap();
            assert!(s.len() <= 6000 && s.chars().count() <= 2000);
        }
    }
}
