//! Personal conversations, idempotent queries and real SSE result delivery.
use crate::{auth::Principal, error::CoreError, retrieval, server::StateData};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, post},
};
use http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction, postgres::PgRow};
use uuid::Uuid;
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Arguments do not match the action contract",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn missing() -> CoreError {
    CoreError {
        code: "NOT_FOUND",
        message: "Conversation not found",
        status: StatusCode::NOT_FOUND,
    }
}
fn conflict(code: &'static str, message: &'static str) -> CoreError {
    CoreError {
        code,
        message,
        status: StatusCode::CONFLICT,
    }
}
fn uuid(s: &str) -> Result<String, CoreError> {
    Uuid::parse_str(s)
        .map(|v| v.to_string())
        .map_err(|_| CoreError::invalid_uuid())
}
fn title_default() -> String {
    "Nouvelle conversation".into()
}
fn twenty() -> usize {
    20
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateInput {
    #[serde(default = "title_default")]
    title: String,
    idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateInput {
    title: String,
    archived: bool,
    expected_revision: i64,
}
#[derive(Deserialize)]
struct PageInput {
    #[serde(default = "twenty")]
    limit: usize,
    after: Option<Uuid>,
    #[serde(default)]
    archived: bool,
}
#[derive(Deserialize)]
struct MessagesInput {
    #[serde(default = "twenty")]
    limit: usize,
    #[serde(default)]
    after: i64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct QueryInput {
    question: String,
    #[serde(default = "default_chars")]
    max_chars: usize,
    #[serde(default = "default_limit")]
    limit: usize,
    idempotency_key: String,
}
fn default_chars() -> usize {
    8000
}
fn default_limit() -> usize {
    5
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route(
            "/v1/domains/{domain}/conversations/{ident}/timeline",
            get(timeline),
        )
        .route("/v1/domains/{domain}/conversations", get(list).post(create))
        .route(
            "/v1/domains/{domain}/conversations/{ident}",
            get(read).put(update),
        )
        .route(
            "/v1/domains/{domain}/conversations/{ident}/messages",
            get(messages),
        )
        .route(
            "/v1/domains/{domain}/conversations/{ident}/query",
            post(query),
        )
}
fn view(r: &PgRow) -> Value {
    json!({"id":r.get::<String,_>("id"),"title":r.get::<String,_>("title"),"archived":r.get::<bool,_>("archived"),"revision":r.get::<i32,_>("revision"),"created_at":r.get::<Value,_>("created")})
}
pub(crate) async fn row(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    id: &str,
    active: bool,
) -> Result<PgRow, CoreError> {
    let r=sqlx::query("SELECT *,to_jsonb(created_at) AS created FROM cf_conversations WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND author=$4 FOR UPDATE").bind(&p.tenant).bind(domain).bind(id).bind(&p.subject).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?.ok_or_else(missing)?;
    if active && r.get::<bool, _>("archived") {
        return Err(conflict(
            "CONVERSATION_ARCHIVED",
            "Restore the conversation before asking a question",
        ));
    }
    Ok(r)
}
pub(crate) async fn retry(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    id: &str,
    key: &str,
    fingerprint: &str,
) -> Result<Option<Value>, CoreError> {
    row(tx, p, domain, id, true).await?;
    let old=sqlx::query("SELECT episode_id,request_hash FROM cf_conversation_episodes WHERE tenant_id=$1 AND domain_id=$2 AND conversation_id=$3 AND idempotency_key=$4").bind(&p.tenant).bind(domain).bind(id).bind(key).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?;
    if let Some(old) = old {
        if old.get::<&str, _>("request_hash") != fingerprint {
            return Err(conflict("IDEMPOTENCY_CONFLICT", "Question key reused"));
        }
        let sources = retrieval::accessible(tx, p, domain).await?;
        let episode =
            retrieval::episode_row(tx, p, domain, old.get("episode_id"), &sources).await?;
        p.check_fresh()?;
        return Ok(Some(episode.get("result")));
    }
    Ok(None)
}
pub(crate) async fn associate(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    id: &str,
    key: &str,
    fingerprint: &str,
    episode: &str,
) -> Result<(), CoreError> {
    let sequence:i32=sqlx::query_scalar("SELECT COALESCE(max(sequence),0) FROM cf_conversation_episodes WHERE tenant_id=$1 AND domain_id=$2 AND conversation_id=$3").bind(&p.tenant).bind(domain).bind(id).fetch_one(&mut **tx).await.map_err(CoreError::sql)?;
    let sequence = sequence.checked_add(1).ok_or_else(CoreError::database)?;
    sqlx::query("INSERT INTO cf_conversation_episodes(tenant_id,domain_id,conversation_id,episode_id,sequence,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(&p.tenant).bind(domain).bind(id).bind(episode).bind(sequence).bind(key).bind(fingerprint).execute(&mut **tx).await.map_err(CoreError::sql)?;
    Ok(())
}
async fn create(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
    body: Result<Json<CreateInput>, axum::extract::rejection::JsonRejection>,
) -> Result<(StatusCode, Json<Value>), CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let Json(input) = body.map_err(|_| invalid())?;
    if !(1..=200).contains(&input.title.chars().count())
        || !(8..=128).contains(&input.idempotency_key.chars().count())
    {
        return Err(invalid());
    }
    let fingerprint =
        crate::canonical::digest(&serde_json::to_value(&input).map_err(|_| invalid())?)
            .map_err(|_| invalid())?;
    let mut tx = retrieval::transaction(&s, &p, &domain).await?;
    let old=sqlx::query("SELECT *,to_jsonb(created_at) AS created FROM cf_conversations WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND idempotency_key=$4").bind(&p.tenant).bind(&domain).bind(&p.subject).bind(&input.idempotency_key).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    if let Some(old) = old {
        if old.get::<&str, _>("request_hash") != fingerprint {
            return Err(conflict("IDEMPOTENCY_CONFLICT", "Conversation key reused"));
        }
        p.check_fresh()?;
        return Ok((StatusCode::CREATED, Json(view(&old))));
    }
    let id = Uuid::new_v4().to_string();
    let r=sqlx::query("INSERT INTO cf_conversations(tenant_id,domain_id,id,author,title,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *,to_jsonb(created_at) AS created").bind(&p.tenant).bind(&domain).bind(id).bind(&p.subject).bind(&input.title).bind(&input.idempotency_key).bind(fingerprint).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    let value = view(&r);
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
    let mut tx = retrieval::transaction(&s, &p, &domain).await?;
    let value = view(&row(&mut tx, &p, &domain, &id, false).await?);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(value))
}
async fn list(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
    input: Result<Query<PageInput>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let Query(input) = input.map_err(|_| invalid())?;
    if !(1..=100).contains(&input.limit) {
        return Err(invalid());
    }
    let mut tx = retrieval::transaction(&s, &p, &domain).await?;
    let rows=sqlx::query("SELECT *,to_jsonb(created_at) AS created FROM cf_conversations WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND id>$4 AND archived=$5 ORDER BY id LIMIT $6").bind(&p.tenant).bind(&domain).bind(&p.subject).bind(input.after.map(|v|v.to_string()).unwrap_or_default()).bind(input.archived).bind((input.limit+1)as i64).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let mut items: Vec<Value> = rows.iter().map(view).collect();
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
async fn update(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Result<Json<UpdateInput>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let id = uuid(&id)?;
    let Json(input) = body.map_err(|_| invalid())?;
    if !(1..=200).contains(&input.title.chars().count()) || input.expected_revision < 0 {
        return Err(invalid());
    }
    let mut tx = retrieval::transaction(&s, &p, &domain).await?;
    let current = row(&mut tx, &p, &domain, &id, false).await?;
    let revision: i32 = current.get("revision");
    if i64::from(revision) != input.expected_revision {
        return Err(conflict(
            "STALE_CONVERSATION",
            "Refresh conversation metadata",
        ));
    }
    let revision = revision.checked_add(1).ok_or_else(CoreError::database)?;
    let r=sqlx::query("UPDATE cf_conversations SET title=$4,archived=$5,revision=$6 WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 RETURNING *,to_jsonb(created_at) AS created").bind(&p.tenant).bind(&domain).bind(&id).bind(&input.title).bind(input.archived).bind(revision).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    let value = view(&r);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(value))
}

async fn messages(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
    input: Result<Query<MessagesInput>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let id = uuid(&id)?;
    let Query(input) = input.map_err(|_| invalid())?;
    if !(1..=100).contains(&input.limit) || input.after < 0 {
        return Err(invalid());
    }
    let mut tx = retrieval::transaction(&s, &p, &domain).await?;
    row(&mut tx, &p, &domain, &id, false).await?;
    let sources = retrieval::accessible(&mut tx, &p, &domain).await?;
    let mut cursor = input.after;
    let mut items = Vec::new();
    while items.len() <= input.limit {
        let rows=sqlx::query("SELECT m.sequence,e.*,to_jsonb(e.created_at) AS created FROM cf_conversation_episodes m JOIN cf_episodes e ON e.tenant_id=m.tenant_id AND e.domain_id=m.domain_id AND e.id=m.episode_id WHERE m.tenant_id=$1 AND m.domain_id=$2 AND m.conversation_id=$3 AND e.subject=$4 AND m.sequence>$5 ORDER BY m.sequence LIMIT 100").bind(&p.tenant).bind(&domain).bind(&id).bind(&p.subject).bind(cursor).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
        let count = rows.len();
        if count == 0 {
            break;
        }
        for r in rows {
            cursor = i64::from(r.get::<i32, _>("sequence"));
            if retrieval::can_read(&r, &sources)? {
                items.push(json!({"sequence":cursor,"question":r.get::<String,_>("question"),"result":r.get::<Value,_>("result"),"created_at":r.get::<Value,_>("created")}));
            }
            if items.len() > input.limit {
                break;
            }
        }
        if count < 100 {
            break;
        }
    }
    let next = if items.len() > input.limit {
        items[input.limit - 1]["sequence"].clone()
    } else {
        Value::Null
    };
    items.truncate(input.limit);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(json!({"items":items,"next_after":next})))
}
fn wants_stream(accept: &str) -> bool {
    let mut values = std::collections::BTreeMap::<String, f64>::new();
    for part in accept.to_lowercase().split(',') {
        let mut params = part.trim().split(';');
        let media = params.next().unwrap_or_default().to_owned();
        let mut quality = 1.0;
        for param in params {
            let (name, value) = param.trim().split_once('=').unwrap_or((param.trim(), ""));
            if name == "q" {
                quality = value.parse::<f64>().unwrap_or(0.0);
            }
        }
        if !quality.is_finite() || !(0.0..=1.0).contains(&quality) {
            quality = 0.0;
        }
        values
            .entry(media)
            .and_modify(|v| *v = v.max(quality))
            .or_insert(quality);
    }
    values.get("text/event-stream").copied().unwrap_or(0.0)
        > values
            .get("application/json")
            .or_else(|| values.get("*/*"))
            .copied()
            .unwrap_or(0.0)
}
async fn query(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Result<Json<QueryInput>, axum::extract::rejection::JsonRejection>,
) -> Result<axum::response::Response, CoreError> {
    use axum::response::{IntoResponse, Sse, sse::Event};
    use futures_util::StreamExt;
    use std::convert::Infallible;
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let id = uuid(&id)?;
    let Json(input) = body.map_err(|_| invalid())?;
    if !(1..=2000).contains(&input.question.chars().count())
        || !(100..=20000).contains(&input.max_chars)
        || !(1..=10).contains(&input.limit)
        || !(8..=128).contains(&input.idempotency_key.chars().count())
    {
        return Err(invalid());
    }
    let data = retrieval::QueryInput {
        question: input.question,
        max_chars: input.max_chars,
        limit: input.limit,
    };
    let key = input.idempotency_key;
    if !wants_stream(
        headers
            .get("accept")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default(),
    ) {
        return Ok(
            Json(retrieval::query_service(&s, &p, &domain, data, Some((&id, &key))).await?)
                .into_response(),
        );
    }
    if headers.get("last-event-id").is_some_and(|v| !v.is_empty()) {
        return Err(CoreError {
            code: "STREAM_CURSOR_UNSUPPORTED",
            message: "Retry the same POST and idempotency key",
            status: StatusCode::UNPROCESSABLE_ENTITY,
        });
    }
    let mut normalized = serde_json::to_value(&data).map_err(|_| invalid())?;
    normalized["idempotency_key"] = json!(key);
    let fingerprint = crate::canonical::digest(&normalized).map_err(|_| invalid())?;
    let mut tx = retrieval::transaction(&s, &p, &domain).await?;
    retry(&mut tx, &p, &domain, &id, &key, &fingerprint).await?;
    tx.commit().await.map_err(CoreError::sql)?;
    let started=Event::default().event("started").data(json!({"event":"started","protocol_version":"1","operation_id":"conversations.query","idempotency_key":key}).to_string());
    let ending = async move {
        let result: Result<Value, CoreError> = async {
            let result = retrieval::query_service(&s, &p, &domain, data, Some((&id, &key))).await?;
            let current = s.auth.authenticate(&headers)?;
            let mut tx = retrieval::transaction(&s, &current, &domain).await?;
            let sources = retrieval::accessible(&mut tx, &current, &domain).await?;
            let episode = retrieval::episode_row(
                &mut tx,
                &current,
                &domain,
                result["episode_id"]
                    .as_str()
                    .ok_or_else(CoreError::database)?,
                &sources,
            )
            .await?;
            let value = episode.get("result");
            current.check_fresh()?;
            tx.commit().await.map_err(CoreError::sql)?;
            Ok(value)
        }
        .await;
        let (event, value) = match result {
            Ok(result) => (
                "result",
                json!({"event":"result","protocol_version":"1","result":result}),
            ),
            Err(e) => (
                "error",
                json!({"event":"error","protocol_version":"1","error":e.code,"http_status":e.status.as_u16(),"message":"La réponse n'a pas pu être livrée. Relire l'état ou reprendre la même clé.","recovery":"inspect_or_retry_same_key"}),
            ),
        };
        Ok::<Event, Infallible>(Event::default().event(event).data(value.to_string()))
    };
    let stream = futures_util::stream::iter([Ok::<Event, Infallible>(started)])
        .chain(futures_util::stream::once(ending));
    let mut response = Sse::new(stream).into_response();
    response
        .headers_mut()
        .insert("cache-control", http::HeaderValue::from_static("no-store"));
    response
        .headers_mut()
        .insert("x-accel-buffering", http::HeaderValue::from_static("no"));
    Ok(response)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn negotiation_keeps_json_on_ties() {
        assert!(!wants_stream("application/json,text/event-stream"));
        assert!(wants_stream("text/event-stream,application/json;q=0.5"));
        assert!(!wants_stream("text/event-stream;q=NaN"));
        assert!(!wants_stream("text/event-stream;q=0,*/*"));
    }
}

fn ten() -> usize {
    10
}
fn three() -> usize {
    3
}
fn forward() -> String {
    "forward".into()
}
#[derive(Deserialize)]
struct TimelineInput {
    #[serde(default = "ten")]
    limit: usize,
    #[serde(default)]
    after: i64,
    #[serde(default = "three")]
    responses_limit: usize,
    #[serde(default = "default_limit")]
    signals_limit: usize,
    #[serde(default = "three")]
    issues_limit: usize,
    #[serde(default = "forward")]
    direction: String,
}
async fn related(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
    episode: &PgRow,
    kind: &str,
    limit: usize,
) -> Result<Value, CoreError> {
    let table = match kind {
        "responses" => "cf_companion_responses",
        "signals" => "cf_feedback_signals",
        "issues" => "cf_issues",
        _ => return Err(invalid()),
    };
    let personal = if kind == "issues" {
        ""
    } else {
        "AND subject=$5"
    };
    let sql = format!(
        "SELECT *,to_jsonb(created_at) AS created FROM {table} WHERE tenant_id=$1 AND domain_id=$2 AND episode_id=$3 {personal} ORDER BY id LIMIT $4"
    );
    let query = sqlx::query(&sql)
        .bind(&p.tenant)
        .bind(domain)
        .bind(episode.get::<&str, _>("id"))
        .bind((limit + 1) as i64);
    let rows = if kind == "issues" {
        query
    } else {
        query.bind(&p.subject)
    }
    .fetch_all(&mut **tx)
    .await
    .map_err(CoreError::sql)?;
    let next = if rows.len() > limit {
        json!(rows[limit - 1].get::<String, _>("id"))
    } else {
        Value::Null
    };
    let mut items = Vec::new();
    for row in rows.into_iter().take(limit) {
        items.push(match kind{
        "responses"=>{let mut value=crate::companions::view(&row,episode)?;let obj=value.as_object_mut().ok_or_else(CoreError::database)?;obj.remove("episode_id");obj.remove("served_version");obj.remove("citations");value},
        "signals"=>crate::signals::signal_view(&row,episode),
        "issues"=>json!({"id":row.get::<String,_>("id"),"episode_id":row.get::<String,_>("episode_id"),"kind":row.get::<String,_>("kind"),"reason":row.get::<String,_>("reason"),"status":row.get::<String,_>("status"),"revision":row.get::<i64,_>("revision"),"created_at":row.get::<Value,_>("created")}),_=>return Err(invalid())
    });
    }
    Ok(json!({"items":items,"next_after":next}))
}
fn timeline_too_large() -> CoreError {
    CoreError {
        code: "TIMELINE_ITEM_TOO_LARGE",
        message: "Reduce child limits or read the episode and related pages separately",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
async fn timeline(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
    input: Result<Query<TimelineInput>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let id = uuid(&id)?;
    let Query(input) = input.map_err(|_| invalid())?;
    if !(1..=20).contains(&input.limit)
        || !(1..=5).contains(&input.responses_limit)
        || !(1..=20).contains(&input.signals_limit)
        || !(1..=10).contains(&input.issues_limit)
        || input.after < 0
        || !["forward", "backward"].contains(&input.direction.as_str())
    {
        return Err(invalid());
    }
    let mut tx = retrieval::transaction(&s, &p, &domain).await?;
    let conversation = view(&row(&mut tx, &p, &domain, &id, false).await?);
    let sources = retrieval::accessible(&mut tx, &p, &domain).await?;
    let order = if input.direction == "backward" {
        "AND ($5=0 OR m.sequence<$5) ORDER BY m.sequence DESC"
    } else {
        "AND m.sequence>$5 ORDER BY m.sequence"
    };
    let sql = format!(
        "SELECT m.sequence,m.episode_id FROM cf_conversation_episodes m JOIN cf_episodes e ON e.tenant_id=m.tenant_id AND e.domain_id=m.domain_id AND e.id=m.episode_id WHERE m.tenant_id=$1 AND m.domain_id=$2 AND m.conversation_id=$3 AND e.subject=$4 {order} LIMIT 101"
    );
    let rows = sqlx::query(&sql)
        .bind(&p.tenant)
        .bind(&domain)
        .bind(&id)
        .bind(&p.subject)
        .bind(input.after)
        .fetch_all(&mut *tx)
        .await
        .map_err(CoreError::sql)?;
    let has_more = rows.len() > 100;
    let mut items = Vec::<Value>::new();
    let mut used = 8192;
    let mut cursor = input.after;
    let mut next = Value::Null;
    let mut stopped = false;
    for row in rows.into_iter().take(100) {
        cursor = i64::from(row.get::<i32, _>("sequence"));
        let episode =
            match retrieval::episode_row(&mut tx, &p, &domain, row.get("episode_id"), &sources)
                .await
            {
                Ok(e) => e,
                Err(e) if e.status == StatusCode::NOT_FOUND => continue,
                Err(e) => return Err(e),
            };
        if items.len() == input.limit {
            next = items.last().ok_or_else(invalid)?["sequence"].clone();
            stopped = true;
            break;
        }
        let responses = related(
            &mut tx,
            &p,
            &domain,
            &episode,
            "responses",
            input.responses_limit,
        )
        .await?;
        let signals = related(
            &mut tx,
            &p,
            &domain,
            &episode,
            "signals",
            input.signals_limit,
        )
        .await?;
        let issues = related(&mut tx, &p, &domain, &episode, "issues", input.issues_limit).await?;
        let created: chrono::DateTime<chrono::Utc> = episode.get("created_at");
        let turn = json!({"sequence":cursor,"question":episode.get::<String,_>("question"),"result":episode.get::<Value,_>("result"),"created_at":created,"responses":responses,"signals":signals,"issues":issues});
        let size = serde_json::to_vec(&turn)
            .map_err(|_| CoreError::database())?
            .len();
        if used + size > 500000 {
            if items.is_empty() {
                return Err(timeline_too_large());
            }
            next = items.last().ok_or_else(invalid)?["sequence"].clone();
            stopped = true;
            break;
        }
        items.push(turn);
        used += size;
    }
    let scan_limited = !stopped && has_more;
    if scan_limited {
        next = json!(cursor);
    }
    let result = json!({"conversation":conversation,"items":items,"next_after":next,"direction":input.direction,"scan_limited":scan_limited,"payload_limit_bytes":500000});
    if serde_json::to_vec(&result)
        .map_err(|_| CoreError::database())?
        .len()
        > 500000
    {
        return Err(timeline_too_large());
    }
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
