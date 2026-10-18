//! Explicit named review snapshots. No official approval or evaluation verdict.
use crate::{
    auth::Principal,
    canonical,
    error::CoreError,
    reference_drafts::{Content, source},
    server::StateData,
};
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
const HUMAN: &[&str] = &["owner", "corpus_manager", "contributor"];
fn invalid() -> CoreError {
    CoreError {
        status: StatusCode::UNPROCESSABLE_ENTITY,
        code: "VALIDATION_FAILED",
        message: "Invalid reference review request",
    }
}
fn changed() -> CoreError {
    CoreError {
        status: StatusCode::CONFLICT,
        code: "REFERENCE_REVIEW_CHANGED",
        message: "Read and prepare the current version and named recipient again",
    }
}
fn uid(s: &str) -> Result<String, CoreError> {
    Uuid::parse_str(s)
        .map(|v| v.to_string())
        .map_err(|_| invalid())
}
fn bounded(s: &str, n: usize) -> bool {
    !s.trim().is_empty() && s.chars().count() <= n && !s.contains('\0')
}
fn digest(v: &Value) -> Result<String, CoreError> {
    canonical::digest(v).map_err(|_| invalid())
}
async fn transaction<'a>(
    s: &'a StateData,
    p: &Principal,
    d: &str,
) -> Result<Transaction<'a, Postgres>, CoreError> {
    s.db.locked_permission_transaction(p, d, HUMAN, "Human reference reviewer or author required")
        .await
}
async fn finish(
    tx: Transaction<'_, Postgres>,
    p: &Principal,
    v: Value,
) -> Result<Json<Value>, CoreError> {
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    Ok(Json(v))
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Selection {
    question_id: Uuid,
    draft_revision: i64,
    reviewer: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Submit {
    question_id: Uuid,
    draft_revision: i64,
    reviewer: String,
    preparation_id: Uuid,
    idempotency_key: Uuid,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Command {
    action: String,
    expected_revision: i64,
    note: String,
    idempotency_key: Uuid,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Page {
    limit: Option<i64>,
    after: Option<String>,
    scope: Option<String>,
}
fn page(
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
    candidates: bool,
) -> Result<Page, CoreError> {
    let Query(q) = q.map_err(|_| invalid())?;
    if !(1..=20).contains(&q.limit.unwrap_or(20))
        || q.scope.as_ref().is_some_and(|v| {
            if candidates {
                true
            } else {
                v != "mine" && v != "assigned"
            }
        })
        || q.after.as_ref().is_some_and(|v| {
            if candidates {
                !bounded(v, 200)
            } else {
                Uuid::parse_str(v).is_err()
            }
        })
    {
        return Err(invalid());
    }
    Ok(q)
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route(
            "/v1/domains/{domain}/reference-drafts/{question}/reviewers",
            get(reviewers),
        )
        .route("/v1/domains/{domain}/reference-reviews", get(list))
        .route(
            "/v1/domains/{domain}/reference-reviews/prepare",
            post(prepare),
        )
        .route(
            "/v1/domains/{domain}/reference-reviews/submit",
            post(submit),
        )
        .route("/v1/domains/{domain}/reference-reviews/{review}", get(read))
        .route(
            "/v1/domains/{domain}/reference-reviews/{review}/events",
            get(events),
        )
        .route(
            "/v1/domains/{domain}/reference-reviews/{review}/commands",
            post(command),
        )
        .route(
            "/v1/domains/{domain}/reference-review-receipts/{command}",
            get(read_receipt),
        )
}
async fn private_snapshot(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    q: &Uuid,
    revision: Option<i64>,
) -> Result<Value, CoreError> {
    let r=sqlx::query("SELECT content,revision FROM cf_reference_drafts WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND id=$4")
 .bind(&p.tenant).bind(d).bind(&p.subject).bind(q.to_string()).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
    if revision.is_some_and(|v| v != r.get::<i64, _>("revision")) {
        return Err(changed());
    }
    let raw: Value = r.get("content");
    let c: Content = serde_json::from_value(raw.clone()).map_err(|_| CoreError::database())?;
    c.validate()?;
    source(tx, p, d, &c, true).await?;
    Ok(raw)
}
async fn snapshot(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    v: &Selection,
) -> Result<Value, CoreError> {
    if v.draft_revision < 1 || !bounded(&v.reviewer, 200) || v.reviewer == p.subject {
        return Err(invalid());
    }
    let raw = private_snapshot(tx, p, d, &v.question_id, Some(v.draft_revision)).await?;
    let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cf_memberships m JOIN cf_sources s ON s.tenant_id=m.tenant_id AND s.domain_id=m.domain_id WHERE m.tenant_id=$1 AND m.domain_id=$2 AND m.subject=$3 AND m.role IN ('owner','corpus_manager') AND s.id=$4 AND s.allowed_subjects ? m.subject)")
 .bind(&p.tenant).bind(d).bind(&v.reviewer).bind(raw["source_id"].as_str()).fetch_one(&mut **tx).await.map_err(CoreError::sql)?;
    if !valid {
        return Err(changed());
    }
    Ok(raw)
}
async fn reviewers(
    State(s): State<StateData>,
    Path((domain, question)): Path<(String, String)>,
    headers: HeaderMap,
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uid(&domain)?;
    let qid = Uuid::parse_str(&question).map_err(|_| invalid())?;
    let q = page(q, true)?;
    let mut tx = transaction(&s, &p, &d).await?;
    let raw = private_snapshot(&mut tx, &p, &d, &qid, None).await?;
    let limit = q.limit.unwrap_or(20);
    let rows=sqlx::query("SELECT m.subject,m.role FROM cf_memberships m JOIN cf_sources s ON s.tenant_id=m.tenant_id AND s.domain_id=m.domain_id WHERE m.tenant_id=$1 AND m.domain_id=$2 AND m.subject<>$3 AND m.role IN ('owner','corpus_manager') AND s.id=$4 AND s.allowed_subjects ? m.subject AND ($5::text IS NULL OR m.subject>$5) ORDER BY m.subject LIMIT $6")
 .bind(&p.tenant).bind(&d).bind(&p.subject).bind(raw["source_id"].as_str()).bind(q.after).bind(limit+1).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let items: Vec<Value> = rows
        .iter()
        .take(limit as usize)
        .map(|r| json!({"subject":r.get::<String,_>("subject"),"role":r.get::<String,_>("role")}))
        .collect();
    let after = if rows.len() > limit as usize {
        items.last().map(|v| v["subject"].clone())
    } else {
        None
    };
    finish(tx, &p, json!({"items":items,"next_after":after})).await
}
async fn prepare(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
    body: Result<Json<Selection>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uid(&domain)?;
    let Json(v) = body.map_err(|_| invalid())?;
    let mut tx = transaction(&s, &p, &d).await?;
    let raw = snapshot(&mut tx, &p, &d, &v).await?;
    let hash = digest(&json!({"selection":v,"content":raw,"policy":"named-reference-v1"}))?;
    let id = Uuid::new_v4().to_string();
    let r=sqlx::query("INSERT INTO cf_reference_review_preparations(tenant_id,domain_id,author,id,payload_hash,membership_revision) SELECT $1,$2,$3,$4,$5,membership_revision FROM cf_domains WHERE tenant_id=$1 AND id=$2 RETURNING to_jsonb(expires_at) AS expires")
 .bind(&p.tenant).bind(&d).bind(&p.subject).bind(&id).bind(hash).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    finish(tx,&p,json!({"preparation_id":id,"question_id":v.question_id,"draft_revision":v.draft_revision,"reviewer":v.reviewer,"content":raw,"expires_at":r.get::<Value,_>("expires")})).await
}
fn receipt(r: &PgRow) -> Value {
    json!({"review_id":r.get::<String,_>("review_id"),"event_id":r.get::<String,_>("event_id"),"revision":r.get::<i64,_>("revision"),"status":r.get::<String,_>("status")})
}
async fn prior(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    key: &Uuid,
    hash: &str,
) -> Result<Option<Value>, CoreError> {
    let r=sqlx::query("SELECT request_hash,review_id,event_id,revision,status FROM cf_reference_review_commands WHERE tenant_id=$1 AND domain_id=$2 AND actor=$3 AND idempotency_key=$4")
 .bind(&p.tenant).bind(d).bind(&p.subject).bind(key.to_string()).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?;
    r.map(|r| {
        if r.get::<String, _>("request_hash") == hash {
            Ok(receipt(&r))
        } else {
            Err(changed())
        }
    })
    .transpose()
}
async fn record(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    key: &Uuid,
    hash: &str,
    id: &str,
    revision: i64,
    status: &str,
    action: &str,
    note: &str,
) -> Result<Value, CoreError> {
    let event = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO cf_reference_review_commands(tenant_id,domain_id,actor,idempotency_key,request_hash,review_id,event_id,action,revision,status,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
 .bind(&p.tenant).bind(d).bind(&p.subject).bind(key.to_string()).bind(hash).bind(id).bind(&event).bind(action).bind(revision).bind(status).bind(note).execute(&mut **tx).await.map_err(CoreError::sql)?;
    sqlx::query("UPDATE cf_domains SET work_revision=work_revision+1 WHERE tenant_id=$1 AND id=$2")
        .bind(&p.tenant)
        .bind(d)
        .execute(&mut **tx)
        .await
        .map_err(CoreError::sql)?;
    Ok(json!({"review_id":id,"event_id":event,"revision":revision,"status":status}))
}
async fn submit(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
    body: Result<Json<Submit>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uid(&domain)?;
    let Json(v) = body.map_err(|_| invalid())?;
    let mut tx = transaction(&s, &p, &d).await?;
    let hash = digest(&json!({"action":"submit","body":v}))?;
    if let Some(r) = prior(&mut tx, &p, &d, &v.idempotency_key, &hash).await? {
        return finish(tx, &p, r).await;
    }
    let selection = Selection {
        question_id: v.question_id,
        draft_revision: v.draft_revision,
        reviewer: v.reviewer.clone(),
    };
    let raw = snapshot(&mut tx, &p, &d, &selection).await?;
    let payload =
        digest(&json!({"selection":selection,"content":raw,"policy":"named-reference-v1"}))?;
    let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cf_reference_review_preparations p JOIN cf_domains d ON d.tenant_id=p.tenant_id AND d.id=p.domain_id WHERE p.tenant_id=$1 AND p.domain_id=$2 AND p.author=$3 AND p.id=$4 AND p.payload_hash=$5 AND p.membership_revision=d.membership_revision AND p.expires_at>clock_timestamp())")
 .bind(&p.tenant).bind(&d).bind(&p.subject).bind(v.preparation_id.to_string()).bind(payload).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    if !valid {
        return Err(changed());
    }
    let id = Uuid::new_v4().to_string();
    let inserted=sqlx::query("INSERT INTO cf_reference_reviews(tenant_id,domain_id,id,author,reviewer,question_id,draft_revision,content,preparation_id,status,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'awaiting_review',1) ON CONFLICT(tenant_id,domain_id,author,question_id,draft_revision) DO NOTHING")
 .bind(&p.tenant).bind(&d).bind(&id).bind(&p.subject).bind(&v.reviewer).bind(v.question_id.to_string()).bind(v.draft_revision).bind(raw).bind(v.preparation_id.to_string()).execute(&mut *tx).await.map_err(CoreError::sql)?.rows_affected();
    if inserted != 1 {
        return Err(changed());
    }
    let result = record(
        &mut tx,
        &p,
        &d,
        &v.idempotency_key,
        &hash,
        &id,
        1,
        "awaiting_review",
        "submit",
        "",
    )
    .await?;
    finish(tx, &p, result).await
}
async fn row(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    id: &str,
) -> Result<PgRow, CoreError> {
    sqlx::query("SELECT *,to_jsonb(created_at) AS created,to_jsonb(updated_at) AS updated FROM cf_reference_reviews WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND (author=$4 OR reviewer=$4)").bind(&p.tenant).bind(d).bind(id).bind(&p.subject).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)
}
async fn visible(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    r: &PgRow,
) -> Result<(), CoreError> {
    if r.get::<String, _>("author") != p.subject {
        let manager:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND role IN ('owner','corpus_manager'))").bind(&p.tenant).bind(d).bind(&p.subject).fetch_one(&mut **tx).await.map_err(CoreError::sql)?;
        if !manager {
            return Err(CoreError::not_found());
        }
    }
    if r.get::<String, _>("status") != "withdrawn" {
        let c: Content =
            serde_json::from_value(r.get("content")).map_err(|_| CoreError::database())?;
        source(tx, p, d, &c, false).await?;
    }
    Ok(())
}
fn detail(r: &PgRow, p: &Principal) -> Value {
    let status: String = r.get("status");
    let withdrawn = status == "withdrawn";
    let author: String = r.get("author");
    let actions: Vec<&str> = if withdrawn {
        vec![]
    } else if author == p.subject {
        vec!["withdraw"]
    } else if status == "awaiting_review" {
        vec!["request_changes", "ready_for_owner"]
    } else {
        vec![]
    };
    json!({"id":r.get::<String,_>("id"),"author":author,"reviewer":r.get::<String,_>("reviewer"),"question_id":r.get::<String,_>("question_id"),"draft_revision":r.get::<i64,_>("draft_revision"),"revision":r.get::<i64,_>("revision"),"status":status,"content":if withdrawn{Value::Null}else{r.get("content")},"review_note":if withdrawn{"".into()}else{r.get::<String,_>("review_note")},"created_at":r.get::<Value,_>("created"),"updated_at":r.get::<Value,_>("updated"),"actions":actions})
}
async fn read(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uid(&domain)?;
    let id = uid(&id)?;
    let mut tx = transaction(&s, &p, &d).await?;
    let r = row(&mut tx, &p, &d, &id).await?;
    visible(&mut tx, &p, &d, &r).await?;
    let value = detail(&r, &p);
    finish(tx, &p, value).await
}
async fn list(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uid(&domain)?;
    let q = page(q, false)?;
    let mut tx = transaction(&s, &p, &d).await?;
    let limit = q.limit.unwrap_or(20);
    let scope = q.scope.unwrap_or("mine".into());
    let rows=sqlx::query("SELECT r.id,r.author,r.reviewer,r.draft_revision,r.revision,r.status,CASE WHEN r.status='withdrawn' THEN NULL ELSE r.content->>'question' END AS question,to_jsonb(r.updated_at) AS updated FROM cf_reference_reviews r JOIN cf_memberships m ON m.tenant_id=r.tenant_id AND m.domain_id=r.domain_id AND m.subject=$3 LEFT JOIN cf_sources s ON s.tenant_id=r.tenant_id AND s.domain_id=r.domain_id AND s.id=r.content->>'source_id' WHERE r.tenant_id=$1 AND r.domain_id=$2 AND (($4='mine' AND r.author=$3) OR ($4='assigned' AND r.reviewer=$3 AND m.role IN ('owner','corpus_manager'))) AND (r.status='withdrawn' OR (s.allowed_subjects ? $3 AND s.content_hash=r.content->>'source_hash')) AND ($5::text IS NULL OR r.id>$5) ORDER BY r.id LIMIT $6")
 .bind(&p.tenant).bind(&d).bind(&p.subject).bind(&scope).bind(q.after).bind(limit+1).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let items:Vec<Value>=rows.iter().take(limit as usize).map(|r|json!({"id":r.get::<String,_>("id"),"author":r.get::<String,_>("author"),"reviewer":r.get::<String,_>("reviewer"),"draft_revision":r.get::<i64,_>("draft_revision"),"revision":r.get::<i64,_>("revision"),"status":r.get::<String,_>("status"),"question":r.get::<Option<String>,_>("question"),"updated_at":r.get::<Value,_>("updated")})).collect();
    let after = if rows.len() > limit as usize {
        items.last().map(|v| v["id"].clone())
    } else {
        None
    };
    finish(
        tx,
        &p,
        json!({"items":items,"next_after":after,"scope":scope}),
    )
    .await
}
async fn command(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Result<Json<Command>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uid(&domain)?;
    let id = uid(&id)?;
    let Json(v) = body.map_err(|_| invalid())?;
    if !["withdraw", "request_changes", "ready_for_owner"].contains(&v.action.as_str())
        || !bounded(&v.note, 2000)
        || v.expected_revision < 1
        || v.expected_revision >= 9_007_199_254_740_991
    {
        return Err(invalid());
    }
    let mut tx = transaction(&s, &p, &d).await?;
    let hash = digest(&json!({"review":id,"body":v}))?;
    if let Some(r) = prior(&mut tx, &p, &d, &v.idempotency_key, &hash).await? {
        return finish(tx, &p, r).await;
    }
    let r = row(&mut tx, &p, &d, &id).await?;
    let status: String = r.get("status");
    if r.get::<i64, _>("revision") != v.expected_revision || status == "withdrawn" {
        return Err(changed());
    }
    let next = if v.action == "withdraw" {
        if r.get::<String, _>("author") != p.subject {
            return Err(CoreError::not_found());
        }
        "withdrawn"
    } else {
        visible(&mut tx, &p, &d, &r).await?;
        if r.get::<String, _>("reviewer") != p.subject || status != "awaiting_review" {
            return Err(changed());
        }
        if v.action == "request_changes" {
            "changes_requested"
        } else {
            "ready_for_owner"
        }
    };
    let revision = v.expected_revision + 1;
    sqlx::query("UPDATE cf_reference_reviews SET status=$4,revision=$5,review_note=$6,updated_at=clock_timestamp() WHERE tenant_id=$1 AND domain_id=$2 AND id=$3")
 .bind(&p.tenant).bind(&d).bind(&id).bind(next).bind(revision).bind(&v.note).execute(&mut *tx).await.map_err(CoreError::sql)?;
    let result = record(
        &mut tx,
        &p,
        &d,
        &v.idempotency_key,
        &hash,
        &id,
        revision,
        next,
        &v.action,
        &v.note,
    )
    .await?;
    finish(tx, &p, result).await
}
async fn read_receipt(
    State(s): State<StateData>,
    Path((domain, key)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uid(&domain)?;
    let key = uid(&key)?;
    let mut tx = transaction(&s, &p, &d).await?;
    let r=sqlx::query("SELECT review_id,event_id,revision,status FROM cf_reference_review_commands WHERE tenant_id=$1 AND domain_id=$2 AND actor=$3 AND idempotency_key=$4").bind(&p.tenant).bind(&d).bind(&p.subject).bind(&key).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
    finish(tx, &p, json!({"command_id":key,"receipt":receipt(&r)})).await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EventsInput {
    limit: Option<i64>,
    after: Option<i64>,
    expected_revision: Option<i64>,
}
async fn events(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
    q: Result<Query<EventsInput>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uid(&domain)?;
    let id = uid(&id)?;
    let Query(q) = q.map_err(|_| invalid())?;
    let limit = q.limit.unwrap_or(20);
    let after = q.after.unwrap_or(0);
    if !(1..=20).contains(&limit)
        || !(0..=9_007_199_254_740_991).contains(&after)
        || q.expected_revision
            .is_some_and(|v| !(1..=9_007_199_254_740_991).contains(&v))
        || (after > 0 && q.expected_revision.is_none())
    {
        return Err(invalid());
    }
    let mut tx = transaction(&s, &p, &d).await?;
    let r = row(&mut tx, &p, &d, &id).await?;
    visible(&mut tx, &p, &d, &r).await?;
    let revision = r.get::<i64, _>("revision");
    let status = r.get::<String, _>("status");
    if q.expected_revision.is_some_and(|v| v != revision) {
        return Err(changed());
    }
    if after > revision {
        return Err(invalid());
    }
    let withheld = status == "withdrawn";
    // A withdrawn snapshot carries no historical opinion or withdrawal note to either party.
    // Command keys and hashes stay actor-private; only immutable event metadata is shared.
    let rows=sqlx::query("SELECT event_id,actor,action,revision,status,CASE WHEN $6 THEN NULL ELSE note END AS note,to_jsonb(created_at) AS created FROM cf_reference_review_commands WHERE tenant_id=$1 AND domain_id=$2 AND review_id=$3 AND revision>$4 AND revision<=$5 ORDER BY revision LIMIT $7")
        .bind(&p.tenant).bind(&d).bind(&id).bind(after).bind(revision).bind(withheld).bind(limit+1).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let total:i64=sqlx::query_scalar("SELECT count(*) FROM cf_reference_review_commands WHERE tenant_id=$1 AND domain_id=$2 AND review_id=$3 AND revision<=$4")
        .bind(&p.tenant).bind(&d).bind(&id).bind(revision).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    let items:Vec<Value>=rows.iter().take(limit as usize).map(|r|json!({"id":r.get::<String,_>("event_id"),"actor":r.get::<String,_>("actor"),"action":r.get::<String,_>("action"),"revision":r.get::<i64,_>("revision"),"status":r.get::<String,_>("status"),"note":r.get::<Option<String>,_>("note"),"created_at":r.get::<Value,_>("created")})).collect();
    let next_after = if rows.len() > limit as usize {
        items.last().map(|v| v["revision"].clone())
    } else {
        None
    };
    finish(tx,&p,json!({"review_id":id,"review_revision":revision,"status":status,"content_withheld":withheld,"total":total,"items":items,"next_after":next_after})).await
}
