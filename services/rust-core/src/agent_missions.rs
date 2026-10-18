//! Named reading/report protocol. No external worker/model invocation or human approval.
use crate::{auth::Principal, canonical, error::CoreError, server::StateData};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction, postgres::PgRow};
use uuid::Uuid;
const ROLES: &[&str] = &["owner", "corpus_manager", "agent"];
fn error(status: StatusCode, code: &'static str) -> CoreError {
    CoreError {
        status,
        code,
        message: "Read the current mission, mandate and source before acting",
    }
}
fn invalid() -> CoreError {
    error(StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION_FAILED")
}
fn changed() -> CoreError {
    error(StatusCode::CONFLICT, "AGENT_MISSION_CHANGED")
}
fn denied() -> CoreError {
    error(StatusCode::FORBIDDEN, "NOT_AUTHORIZED")
}
fn uid(s: &str) -> Result<String, CoreError> {
    Uuid::parse_str(s)
        .map(|v| v.to_string())
        .map_err(|_| invalid())
}
fn bounded(s: &str, n: usize) -> bool {
    !s.trim().is_empty() && s.chars().count() <= n && !s.contains('\0')
}
fn hash(v: &Value) -> Result<String, CoreError> {
    canonical::digest(v).map_err(|_| invalid())
}
async fn tx<'a>(
    s: &'a StateData,
    p: &Principal,
    d: &str,
) -> Result<Transaction<'a, Postgres>, CoreError> {
    s.db.locked_permission_transaction(p, d, ROLES, "Mission coordinator or named service required")
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
async fn member(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    subject: &str,
) -> Result<(String, i32), CoreError> {
    let r=sqlx::query("SELECT role,revision FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 FOR SHARE").bind(&p.tenant).bind(d).bind(subject).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
    Ok((r.get("role"), r.get("revision")))
}
fn manager(role: &str) -> bool {
    matches!(role, "owner" | "corpus_manager")
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Mandate {
    title: String,
    objective: String,
    criteria: String,
    agent: String,
    source_id: Uuid,
    source_hash: String,
    max_reads: i64,
    max_chars: i64,
    expires_at: DateTime<Utc>,
}
impl Mandate {
    fn validate(&self) -> Result<(), CoreError> {
        if !bounded(&self.title, 200)
            || !bounded(&self.objective, 4000)
            || !bounded(&self.criteria, 4000)
            || !bounded(&self.agent, 200)
            || self.source_hash.len() != 64
            || !self
                .source_hash
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            || !(1..=100).contains(&self.max_reads)
            || !(1..=100000).contains(&self.max_chars)
        {
            return Err(invalid());
        }
        Ok(())
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Create {
    mandate: Mandate,
    preparation_id: Uuid,
    idempotency_key: Uuid,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Command {
    action: String,
    expected_revision: i64,
    idempotency_key: Uuid,
    #[serde(default)]
    lease_id: Option<Uuid>,
    #[serde(default)]
    reason: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Read {
    expected_revision: i64,
    idempotency_key: Uuid,
    lease_id: Uuid,
    start: i64,
    end: i64,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Span {
    start: i64,
    end: i64,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Complete {
    expected_revision: i64,
    idempotency_key: Uuid,
    lease_id: Uuid,
    report: String,
    hypotheses: String,
    evidence: Vec<Span>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Page {
    limit: Option<i64>,
    after: Option<Uuid>,
}
fn page(
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Page, CoreError> {
    let Query(q) = q.map_err(|_| invalid())?;
    if !(1..=20).contains(&q.limit.unwrap_or(20)) {
        return Err(invalid());
    }
    Ok(q)
}
const COLS: &str = "*,to_jsonb(created_at) AS created,to_jsonb(updated_at) AS updated,to_jsonb(expires_at) AS expires,to_jsonb(lease_expires_at) AS lease_expires,expires_at<=clock_timestamp() AS expired,COALESCE(lease_expires_at<=clock_timestamp(),false) AS lease_expired";
async fn mission(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    id: &str,
) -> Result<PgRow, CoreError> {
    sqlx::query(&format!("SELECT {COLS} FROM cf_agent_missions WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND (author=$4 OR agent=$4)")).bind(&p.tenant).bind(d).bind(id).bind(&p.subject).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)
}
async fn source(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    id: &str,
    hash: &str,
    author: &str,
    agent: &str,
) -> Result<PgRow, CoreError> {
    let r=sqlx::query("SELECT id,title,char_length(content)::bigint AS characters,content_hash,location FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND content_hash=$4 AND allowed_subjects ? $5 AND allowed_subjects ? $6 FOR SHARE").bind(&p.tenant).bind(d).bind(id).bind(hash).bind(author).bind(agent).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
    Ok(r)
}
async fn visible(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    m: &PgRow,
) -> Result<PgRow, CoreError> {
    let author: String = m.get("author");
    let agent: String = m.get("agent");
    if !manager(&member(tx, p, d, &author).await?.0) || member(tx, p, d, &agent).await?.0 != "agent"
    {
        return Err(CoreError::not_found());
    }
    source(
        tx,
        p,
        d,
        &m.get::<String, _>("source_id"),
        &m.get::<String, _>("source_hash"),
        &author,
        &agent,
    )
    .await
}
fn view(m: &PgRow, p: &Principal) -> Value {
    let status: String = m.get("status");
    let expired: bool = m.get("expired");
    let lease_expired: bool = m.get("lease_expired");
    let author: String = m.get("author");
    let mut actions = vec![];
    if !expired && status != "completed" {
        if p.subject == author {
            if status == "stopped" {
                actions.push("resume")
            } else {
                actions.push("stop")
            }
        } else {
            if status == "queued" || (status == "running" && lease_expired) {
                actions.push("claim")
            }
            if status == "running" && !lease_expired {
                actions.extend(["renew", "read", "complete"])
            }
        }
    }
    json!({"id":m.get::<String,_>("id"),"author":author,"agent":m.get::<String,_>("agent"),"title":m.get::<String,_>("title"),"objective":m.get::<String,_>("objective"),"criteria":m.get::<String,_>("criteria"),"source_id":m.get::<String,_>("source_id"),"source_hash":m.get::<String,_>("source_hash"),"max_reads":m.get::<i64,_>("max_reads"),"max_chars":m.get::<i64,_>("max_chars"),"reads_used":m.get::<i64,_>("reads_used"),"chars_used":m.get::<i64,_>("chars_used"),"expires_at":m.get::<Value,_>("expires"),"status":status,"expired":expired,"lease_expired":lease_expired,"lease_id":m.get::<Option<String>,_>("lease_id"),"lease_expires_at":m.get::<Option<Value>,_>("lease_expires"),"revision":m.get::<i64,_>("revision"),"report":m.get::<String,_>("report"),"hypotheses":m.get::<String,_>("hypotheses"),"evidence":m.get::<Value,_>("evidence"),"created_at":m.get::<Value,_>("created"),"updated_at":m.get::<Value,_>("updated"),"allowed_actions":actions,"provider":"none","execution":"client_managed"})
}
fn receipt(r: &PgRow) -> Value {
    json!({"mission_id":r.get::<String,_>("mission_id"),"event_id":r.get::<String,_>("event_id"),"revision":r.get::<i64,_>("revision"),"status":r.get::<String,_>("status"),"reads_used":r.get::<i64,_>("reads_used"),"chars_used":r.get::<i64,_>("chars_used"),"lease_id":r.get::<Option<String>,_>("lease_id"),"lease_expires_at":r.get::<Option<Value>,_>("lease_expires")})
}
async fn prior(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    k: &Uuid,
    h: &str,
) -> Result<Option<Value>, CoreError> {
    let r=sqlx::query("SELECT *,to_jsonb(lease_expires_at) AS lease_expires FROM cf_agent_mission_commands WHERE tenant_id=$1 AND domain_id=$2 AND actor=$3 AND idempotency_key=$4").bind(&p.tenant).bind(d).bind(&p.subject).bind(k.to_string()).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?;
    r.map(|v| {
        if v.get::<String, _>("request_hash") == h {
            Ok(receipt(&v))
        } else {
            Err(changed())
        }
    })
    .transpose()
}
struct Event<'a> {
    action: &'a str,
    key: Uuid,
    hash: &'a str,
    reason: &'a str,
    span: Option<(i64, i64)>,
}
async fn record(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    id: &str,
    e: Event<'_>,
) -> Result<Value, CoreError> {
    let m = mission(tx, p, d, id).await?;
    let eid = Uuid::new_v4().to_string();
    let r=sqlx::query("INSERT INTO cf_agent_mission_commands(tenant_id,domain_id,actor,idempotency_key,request_hash,mission_id,event_id,action,revision,status,reads_used,chars_used,lease_id,lease_expires_at,start_pos,end_pos,reason) SELECT tenant_id,domain_id,$4,$5,$6,id,$7,$8,revision,status,reads_used,chars_used,lease_id,lease_expires_at,$9,$10,$11 FROM cf_agent_missions WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 RETURNING *,to_jsonb(lease_expires_at) AS lease_expires").bind(&p.tenant).bind(d).bind(id).bind(&p.subject).bind(e.key.to_string()).bind(e.hash).bind(eid).bind(e.action).bind(e.span.map(|s|s.0)).bind(e.span.map(|s|s.1)).bind(e.reason).fetch_one(&mut **tx).await.map_err(CoreError::sql)?;
    let _ = m;
    sqlx::query("UPDATE cf_domains SET work_revision=work_revision+1 WHERE tenant_id=$1 AND id=$2")
        .bind(&p.tenant)
        .bind(d)
        .execute(&mut **tx)
        .await
        .map_err(CoreError::sql)?;
    Ok(receipt(&r))
}
fn active(m: &PgRow, rev: i64, lease: Uuid, p: &Principal) -> Result<(), CoreError> {
    if m.get::<String, _>("agent") != p.subject {
        return Err(denied());
    }
    if m.get::<i64, _>("revision") != rev
        || m.get::<DateTime<Utc>, _>("expires_at") <= Utc::now()
        || m.get::<Option<DateTime<Utc>>, _>("lease_expires_at")
            .is_none_or(|v| v <= Utc::now())
        || m.get::<String, _>("status") != "running"
        || m.get::<Option<String>, _>("lease_id").as_deref() != Some(&lease.to_string())
    {
        return Err(changed());
    }
    Ok(())
}
async fn valid_mandate(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    v: &Mandate,
) -> Result<(i32, i32, Value), CoreError> {
    v.validate()?;
    let a = member(tx, p, d, &p.subject).await?;
    let b = member(tx, p, d, &v.agent).await?;
    if !manager(&a.0) || b.0 != "agent" || p.subject == v.agent {
        return Err(denied());
    }
    let remaining = v.expires_at - Utc::now();
    if remaining <= chrono::Duration::zero() || remaining > chrono::Duration::hours(24) {
        return Err(invalid());
    }
    let s = source(
        tx,
        p,
        d,
        &v.source_id.to_string(),
        &v.source_hash,
        &p.subject,
        &v.agent,
    )
    .await?;
    Ok((
        a.1,
        b.1,
        json!({"id":s.get::<String,_>("id"),"title":s.get::<String,_>("title"),"content_hash":s.get::<String,_>("content_hash"),"characters":s.get::<i64,_>("characters")}),
    ))
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route("/v1/domains/{domain}/agent-missions", get(list))
        .route("/v1/domains/{domain}/agent-mission-controls", get(controls))
        .route(
            "/v1/domains/{domain}/agent-mission-controls/{mission}",
            get(control),
        )
        .route(
            "/v1/domains/{domain}/agent-missions/candidates",
            get(candidates),
        )
        .route("/v1/domains/{domain}/agent-missions/prepare", post(prepare))
        .route("/v1/domains/{domain}/agent-missions/create", post(create))
        .route("/v1/domains/{domain}/agent-missions/{mission}", get(read))
        .route(
            "/v1/domains/{domain}/agent-missions/{mission}/evidence/{index}",
            get(read_evidence),
        )
        .route(
            "/v1/domains/{domain}/agent-missions/{mission}/commands",
            post(command),
        )
        .route(
            "/v1/domains/{domain}/agent-missions/{mission}/read-source",
            post(read_source),
        )
        .route(
            "/v1/domains/{domain}/agent-missions/{mission}/complete",
            post(complete),
        )
        .route(
            "/v1/domains/{domain}/agent-missions/{mission}/events",
            get(events),
        )
        .route(
            "/v1/domains/{domain}/agent-mission-receipts/{command}",
            get(read_receipt),
        )
}
async fn prepare(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    v: Result<Json<Mandate>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uid(&d)?;
    let Json(v) = v.map_err(|_| invalid())?;
    let mut t = tx(&s, &p, &d).await?;
    let (a, b, source) = valid_mandate(&mut t, &p, &d, &v).await?;
    let raw = json!(v);
    let id = Uuid::new_v4().to_string();
    let expires:Value=sqlx::query_scalar("INSERT INTO cf_agent_mission_preparations(tenant_id,domain_id,author,id,payload_hash,author_revision,agent_revision) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING to_jsonb(expires_at)").bind(&p.tenant).bind(&d).bind(&p.subject).bind(&id).bind(hash(&raw)?).bind(a).bind(b).fetch_one(&mut *t).await.map_err(CoreError::sql)?;
    finish(t,&p,json!({"preparation_id":id,"mandate":raw,"source":source,"expires_at":expires,"provider":"none","execution":"client_managed"})).await
}
async fn create(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    v: Result<Json<Create>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uid(&d)?;
    let Json(v) = v.map_err(|_| invalid())?;
    v.mandate.validate()?;
    let mut t = tx(&s, &p, &d).await?;
    let dh = hash(&json!({"op":"create","body":v}))?;
    if let Some(r) = prior(&mut t, &p, &d, &v.idempotency_key, &dh).await? {
        return finish(t, &p, r).await;
    }
    let (a, b, _) = valid_mandate(&mut t, &p, &d, &v.mandate).await?;
    let ok:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cf_agent_mission_preparations WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND id=$4 AND payload_hash=$5 AND author_revision=$6 AND agent_revision=$7 AND expires_at>clock_timestamp())").bind(&p.tenant).bind(&d).bind(&p.subject).bind(v.preparation_id.to_string()).bind(hash(&json!(v.mandate))?).bind(a).bind(b).fetch_one(&mut *t).await.map_err(CoreError::sql)?;
    if !ok {
        return Err(changed());
    }
    let id = Uuid::new_v4().to_string();
    let m = &v.mandate;
    sqlx::query("INSERT INTO cf_agent_missions(tenant_id,domain_id,id,author,agent,title,objective,criteria,source_id,source_hash,max_reads,max_chars,expires_at,preparation_id,status,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'queued',1) ON CONFLICT(tenant_id,domain_id,author,preparation_id) DO NOTHING").bind(&p.tenant).bind(&d).bind(&id).bind(&p.subject).bind(&m.agent).bind(&m.title).bind(&m.objective).bind(&m.criteria).bind(m.source_id.to_string()).bind(&m.source_hash).bind(m.max_reads).bind(m.max_chars).bind(m.expires_at).bind(v.preparation_id.to_string()).execute(&mut *t).await.map_err(CoreError::sql).and_then(|r|if r.rows_affected()==1{Ok(())}else{Err(changed())})?;
    let r = record(
        &mut t,
        &p,
        &d,
        &id,
        Event {
            action: "create",
            key: v.idempotency_key,
            hash: &dh,
            reason: "",
            span: None,
        },
    )
    .await?;
    finish(t, &p, r).await
}
async fn read(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uid(&d)?;
    let id = uid(&id)?;
    let mut t = tx(&s, &p, &d).await?;
    let m = mission(&mut t, &p, &d, &id).await?;
    visible(&mut t, &p, &d, &m).await?;
    finish(t, &p, view(&m, &p)).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CandidatesPage {
    limit: Option<i64>,
    after: Option<String>,
}
async fn candidates(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    q: Result<Query<CandidatesPage>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uid(&d)?;
    let Query(q) = q.map_err(|_| invalid())?;
    if !(1..=20).contains(&q.limit.unwrap_or(20))
        || q.after.as_ref().is_some_and(|a| !bounded(a, 200))
    {
        return Err(invalid());
    }
    let mut t = tx(&s, &p, &d).await?;
    if !manager(&member(&mut t, &p, &d, &p.subject).await?.0) {
        return Err(denied());
    }
    let n = q.limit.unwrap_or(20) as usize;
    let rows:Vec<String>=sqlx::query_scalar("SELECT subject FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND role='agent' AND ($3::text IS NULL OR subject>$3) ORDER BY subject LIMIT $4").bind(&p.tenant).bind(&d).bind(q.after).bind((n+1)as i64).fetch_all(&mut *t).await.map_err(CoreError::sql)?;
    let next = if rows.len() > n {
        Some(rows[n - 1].clone())
    } else {
        None
    };
    finish(t,&p,json!({"items":rows.into_iter().take(n).map(|subject|json!({"subject":subject})).collect::<Vec<_>>(),"next_after":next})).await
}
async fn list(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uid(&d)?;
    let q = page(q)?;
    let n = q.limit.unwrap_or(20) as usize;
    let mut t = tx(&s, &p, &d).await?;
    let rows=sqlx::query(&format!("SELECT {COLS} FROM cf_agent_missions m WHERE tenant_id=$1 AND domain_id=$2 AND (author=$3 OR agent=$3) AND ($4::text IS NULL OR id>$4) AND {CONTENT_ACCESS} ORDER BY id LIMIT $5")).bind(&p.tenant).bind(&d).bind(&p.subject).bind(q.after.map(|v|v.to_string())).bind((n+1)as i64).fetch_all(&mut *t).await.map_err(CoreError::sql)?;
    let next = if rows.len() > n {
        Some(rows[n - 1].get::<String, _>("id"))
    } else {
        None
    };
    let items:Vec<_>=rows.iter().take(n).map(|m|{let v=view(m,&p);json!({"id":v["id"],"title":v["title"],"author":v["author"],"agent":v["agent"],"status":v["status"],"revision":v["revision"],"expired":v["expired"],"lease_expired":v["lease_expired"],"reads_used":v["reads_used"],"chars_used":v["chars_used"],"max_reads":v["max_reads"],"max_chars":v["max_chars"],"expires_at":v["expires_at"]})}).collect();
    finish(t, &p, json!({"items":items,"next_after":next})).await
}
async fn command(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
    v: Result<Json<Command>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uid(&d)?;
    let id = uid(&id)?;
    let Json(v) = v.map_err(|_| invalid())?;
    if v.expected_revision < 1
        || !matches!(v.action.as_str(), "claim" | "renew" | "stop" | "resume")
    {
        return Err(invalid());
    }
    let mut t = tx(&s, &p, &d).await?;
    let dh = hash(&json!({"op":"command","id":id,"body":v}))?;
    if let Some(r) = prior(&mut t, &p, &d, &v.idempotency_key, &dh).await? {
        return finish(t, &p, r).await;
    }
    let m = mission(&mut t, &p, &d, &id).await?;
    let is_author = m.get::<String, _>("author") == p.subject;
    let human = matches!(v.action.as_str(), "stop" | "resume");
    if is_author != human {
        return Err(denied());
    }
    // Stop is always possible for the author while they remain a coordinator, even if source access was revoked.
    if v.action != "stop" {
        visible(&mut t, &p, &d, &m).await?;
    } else if !manager(&member(&mut t, &p, &d, &p.subject).await?.0) {
        return Err(denied());
    }
    let state: String = m.get("status");
    if m.get::<i64, _>("revision") != v.expected_revision
        || state == "completed"
        || (m.get::<bool, _>("expired") && v.action != "stop")
    {
        return Err(changed());
    }
    let reason = v.reason.as_deref().unwrap_or("");
    let (status, lease) = match v.action.as_str() {
        "claim" => {
            if v.lease_id.is_some() || v.reason.is_some() {
                return Err(invalid());
            }
            if !(state == "queued" || (state == "running" && m.get::<bool, _>("lease_expired"))) {
                return Err(changed());
            }
            ("running", Some(Uuid::new_v4().to_string()))
        }
        "renew" => {
            if v.reason.is_some() {
                return Err(invalid());
            }
            active(&m, v.expected_revision, v.lease_id.ok_or_else(invalid)?, &p)?;
            ("running", m.get::<Option<String>, _>("lease_id"))
        }
        "stop" => {
            if v.lease_id.is_some() || !bounded(reason, 2000) {
                return Err(invalid());
            }
            if state == "stopped" {
                return Err(changed());
            }
            ("stopped", None)
        }
        "resume" => {
            if v.lease_id.is_some() || !bounded(reason, 2000) {
                return Err(invalid());
            }
            if state != "stopped" {
                return Err(changed());
            }
            ("queued", None)
        }
        _ => return Err(invalid()),
    };
    sqlx::query("UPDATE cf_agent_missions SET status=$4,lease_id=$5,lease_expires_at=CASE WHEN $5::text IS NULL THEN NULL ELSE LEAST(expires_at,clock_timestamp()+interval '5 minutes') END,revision=revision+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND domain_id=$2 AND id=$3").bind(&p.tenant).bind(&d).bind(&id).bind(status).bind(lease).execute(&mut *t).await.map_err(CoreError::sql)?;
    let r = record(
        &mut t,
        &p,
        &d,
        &id,
        Event {
            action: &v.action,
            key: v.idempotency_key,
            hash: &dh,
            reason,
            span: None,
        },
    )
    .await?;
    finish(t, &p, r).await
}
async fn read_source(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
    v: Result<Json<Read>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uid(&d)?;
    let id = uid(&id)?;
    let Json(v) = v.map_err(|_| invalid())?;
    if v.expected_revision < 1
        || v.start < 0
        || v.end <= v.start
        || v.end - v.start > 8192
        || v.end > 9_007_199_254_740_991
    {
        return Err(invalid());
    }
    let mut t = tx(&s, &p, &d).await?;
    let m = mission(&mut t, &p, &d, &id).await?;
    if m.get::<String, _>("agent") != p.subject {
        return Err(denied());
    }
    let src = visible(&mut t, &p, &d, &m).await?;
    let dh = hash(&json!({"op":"read","id":id,"body":v}))?;
    let old = prior(&mut t, &p, &d, &v.idempotency_key, &dh).await?;
    // A past read receipt does not permit fresh text delivery after stop, expiry or lease replacement.
    active(
        &m,
        if old.is_some() {
            m.get("revision")
        } else {
            v.expected_revision
        },
        v.lease_id,
        &p,
    )?;
    let len: i64 = src.get("characters");
    if v.end > len {
        return Err(invalid());
    }
    let r = if let Some(r) = old {
        r
    } else {
        if m.get::<i64, _>("reads_used") >= m.get::<i64, _>("max_reads")
            || m.get::<i64, _>("chars_used") + v.end - v.start > m.get::<i64, _>("max_chars")
        {
            return Err(error(
                StatusCode::TOO_MANY_REQUESTS,
                "MISSION_BUDGET_EXHAUSTED",
            ));
        }
        sqlx::query("UPDATE cf_agent_missions SET reads_used=reads_used+1,chars_used=chars_used+$4,revision=revision+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND expires_at>clock_timestamp() AND lease_expires_at>clock_timestamp()").bind(&p.tenant).bind(&d).bind(&id).bind(v.end-v.start).execute(&mut *t).await.map_err(CoreError::sql).and_then(|r|if r.rows_affected()==1{Ok(())}else{Err(changed())})?;
        record(
            &mut t,
            &p,
            &d,
            &id,
            Event {
                action: "read",
                key: v.idempotency_key,
                hash: &dh,
                reason: "",
                span: Some((v.start, v.end)),
            },
        )
        .await?
    };
    let excerpt =
        source_excerpt(&mut t, &p, &d, &src.get::<String, _>("id"), v.start, v.end).await?;
    finish(t,&p,json!({"receipt":r,"source_id":src.get::<String,_>("id"),"source_hash":src.get::<String,_>("content_hash"),"title":src.get::<String,_>("title"),"location":src.get::<String,_>("location"),"start":v.start,"end":v.end,"total_characters":len,"excerpt":excerpt})).await
}
async fn complete(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
    v: Result<Json<Complete>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uid(&d)?;
    let id = uid(&id)?;
    let Json(v) = v.map_err(|_| invalid())?;
    if v.expected_revision < 1
        || !bounded(&v.report, 8000)
        || !bounded(&v.hypotheses, 2000)
        || !(1..=10).contains(&v.evidence.len())
        || v.evidence
            .iter()
            .any(|e| e.start < 0 || e.end <= e.start || e.end > 9_007_199_254_740_991)
    {
        return Err(invalid());
    }
    let mut t = tx(&s, &p, &d).await?;
    let dh = hash(&json!({"op":"complete","id":id,"body":v}))?;
    if let Some(r) = prior(&mut t, &p, &d, &v.idempotency_key, &dh).await? {
        return finish(t, &p, r).await;
    }
    let m = mission(&mut t, &p, &d, &id).await?;
    visible(&mut t, &p, &d, &m).await?;
    active(&m, v.expected_revision, v.lease_id, &p)?;
    for e in &v.evidence {
        let ok:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cf_agent_mission_commands WHERE tenant_id=$1 AND domain_id=$2 AND mission_id=$3 AND actor=$4 AND action='read' AND start_pos<=$5 AND end_pos>=$6)").bind(&p.tenant).bind(&d).bind(&id).bind(&p.subject).bind(e.start).bind(e.end).fetch_one(&mut *t).await.map_err(CoreError::sql)?;
        if !ok {
            return Err(invalid());
        }
    }
    sqlx::query("UPDATE cf_agent_missions SET status='completed',lease_id=NULL,lease_expires_at=NULL,report=$4,hypotheses=$5,evidence=$6,revision=revision+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND expires_at>clock_timestamp() AND lease_expires_at>clock_timestamp()").bind(&p.tenant).bind(&d).bind(&id).bind(&v.report).bind(&v.hypotheses).bind(json!(v.evidence)).execute(&mut *t).await.map_err(CoreError::sql).and_then(|r|if r.rows_affected()==1{Ok(())}else{Err(changed())})?;
    let r = record(
        &mut t,
        &p,
        &d,
        &id,
        Event {
            action: "complete",
            key: v.idempotency_key,
            hash: &dh,
            reason: "",
            span: None,
        },
    )
    .await?;
    finish(t, &p, r).await
}
async fn read_receipt(
    State(s): State<StateData>,
    Path((d, k)): Path<(String, String)>,
    h: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uid(&d)?;
    let k = uid(&k)?;
    let mut t = tx(&s, &p, &d).await?;
    let r=sqlx::query("SELECT *,to_jsonb(lease_expires_at) AS lease_expires FROM cf_agent_mission_commands WHERE tenant_id=$1 AND domain_id=$2 AND actor=$3 AND idempotency_key=$4").bind(&p.tenant).bind(&d).bind(&p.subject).bind(&k).fetch_optional(&mut *t).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
    finish(t, &p, json!({"command_id":k,"receipt":receipt(&r)})).await
}
async fn events(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uid(&d)?;
    let id = uid(&id)?;
    let q = page(q)?;
    let n = q.limit.unwrap_or(20) as usize;
    let mut t = tx(&s, &p, &d).await?;
    let m = mission(&mut t, &p, &d, &id).await?;
    visible(&mut t, &p, &d, &m).await?;
    let after = if let Some(a) = q.after {
        sqlx::query_scalar::<_,i64>("SELECT revision FROM cf_agent_mission_commands WHERE tenant_id=$1 AND domain_id=$2 AND mission_id=$3 AND event_id=$4").bind(&p.tenant).bind(&d).bind(&id).bind(a.to_string()).fetch_optional(&mut *t).await.map_err(CoreError::sql)?.ok_or_else(invalid)?
    } else {
        0
    };
    let rows=sqlx::query("SELECT event_id,actor,action,revision,status,reads_used,chars_used,start_pos,end_pos,reason,to_jsonb(created_at) AS created FROM cf_agent_mission_commands WHERE tenant_id=$1 AND domain_id=$2 AND mission_id=$3 AND revision>$4 ORDER BY revision LIMIT $5").bind(&p.tenant).bind(&d).bind(&id).bind(after).bind((n+1)as i64).fetch_all(&mut *t).await.map_err(CoreError::sql)?;
    let next = if rows.len() > n {
        Some(rows[n - 1].get::<String, _>("event_id"))
    } else {
        None
    };
    let items:Vec<_>=rows.iter().take(n).map(|r|json!({"id":r.get::<String,_>("event_id"),"actor":r.get::<String,_>("actor"),"action":r.get::<String,_>("action"),"revision":r.get::<i64,_>("revision"),"status":r.get::<String,_>("status"),"reads_used":r.get::<i64,_>("reads_used"),"chars_used":r.get::<i64,_>("chars_used"),"start":r.get::<Option<i64>,_>("start_pos"),"end":r.get::<Option<i64>,_>("end_pos"),"reason":r.get::<String,_>("reason"),"created_at":r.get::<Value,_>("created")})).collect();
    finish(t,&p,json!({"mission_id":id,"current_revision":m.get::<i64,_>("revision"),"items":items,"next_after":next})).await
}

// Author-only control plane: no mandate, source, report, agent, or lease material.
const CONTROL_COLS: &str = "id,status,revision,max_reads,max_chars,reads_used,chars_used,to_jsonb(expires_at) AS expires,to_jsonb(created_at) AS created,expires_at<=clock_timestamp() AS expired";
fn control_view(m: &PgRow) -> Value {
    let status: String = m.get("status");
    json!({"id":m.get::<String,_>("id"),"status":status,"revision":m.get::<i64,_>("revision"),"max_reads":m.get::<i64,_>("max_reads"),"max_chars":m.get::<i64,_>("max_chars"),"reads_used":m.get::<i64,_>("reads_used"),"chars_used":m.get::<i64,_>("chars_used"),"expires_at":m.get::<Value,_>("expires"),"created_at":m.get::<Value,_>("created"),"expired":m.get::<bool,_>("expired"),"can_stop":matches!(status.as_str(),"queued"|"running"),"content_withheld":true})
}
async fn controls(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uid(&d)?;
    let q = page(q)?;
    let mut t = tx(&s, &p, &d).await?;
    if !manager(&member(&mut t, &p, &d, &p.subject).await?.0) {
        return Err(denied());
    }
    let n = q.limit.unwrap_or(20) as usize;
    let after = q.after.map(|id| id.to_string()).unwrap_or_default();
    let rows=sqlx::query(&format!("SELECT {CONTROL_COLS} FROM cf_agent_missions WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND id>$4 ORDER BY id LIMIT $5")).bind(&p.tenant).bind(&d).bind(&p.subject).bind(after).bind((n+1)as i64).fetch_all(&mut *t).await.map_err(CoreError::sql)?;
    let next = if rows.len() > n {
        Some(rows[n - 1].get::<String, _>("id"))
    } else {
        None
    };
    let items: Vec<_> = rows.iter().take(n).map(control_view).collect();
    finish(t, &p, json!({"items":items,"next_after":next})).await
}
async fn control(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uid(&d)?;
    let id = uid(&id)?;
    let mut t = tx(&s, &p, &d).await?;
    if !manager(&member(&mut t, &p, &d, &p.subject).await?.0) {
        return Err(denied());
    }
    let row=sqlx::query(&format!("SELECT {CONTROL_COLS} FROM cf_agent_missions WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND author=$4")).bind(&p.tenant).bind(&d).bind(&id).bind(&p.subject).fetch_optional(&mut *t).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
    finish(t, &p, control_view(&row)).await
}

// Shared with the work brief: metadata controls never confer source access.
pub(crate) const CONTENT_ACCESS: &str = "EXISTS(SELECT 1 FROM cf_sources s WHERE s.tenant_id=m.tenant_id AND s.domain_id=m.domain_id AND s.id=m.source_id AND s.content_hash=m.source_hash AND s.allowed_subjects ? m.author AND s.allowed_subjects ? m.agent) AND EXISTS(SELECT 1 FROM cf_memberships a WHERE a.tenant_id=m.tenant_id AND a.domain_id=m.domain_id AND a.subject=m.author AND a.role IN ('owner','corpus_manager')) AND EXISTS(SELECT 1 FROM cf_memberships a WHERE a.tenant_id=m.tenant_id AND a.domain_id=m.domain_id AND a.subject=m.agent AND a.role='agent')";

// Extract in PostgreSQL, so the application receives only the requested Unicode
// range. char_length still has a database scan cost; this is not a global O(1) claim.
async fn source_excerpt(
    t: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    source: &str,
    start: i64,
    end: i64,
) -> Result<String, CoreError> {
    if start < 0 || end <= start || end - start > 8192 || end > i32::MAX as i64 {
        return Err(invalid());
    }
    let result:String=sqlx::query_scalar("SELECT substring(content FROM $4 FOR $5) FROM cf_sources WHERE tenant_id=$1 AND domain_id=$2 AND id=$3")
        .bind(&p.tenant).bind(d).bind(source).bind((start+1)as i32).bind((end-start)as i32)
        .fetch_optional(&mut **t).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
    if result.chars().count() as i64 != end - start {
        return Err(invalid());
    }
    Ok(result)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EvidenceQuery {
    expected_revision: i64,
}
async fn read_evidence(
    State(s): State<StateData>,
    Path((d, id, index)): Path<(String, String, usize)>,
    h: HeaderMap,
    q: Result<Query<EvidenceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uid(&d)?;
    let id = uid(&id)?;
    let Query(q) = q.map_err(|_| invalid())?;
    if !(1..=10).contains(&index) || q.expected_revision < 1 {
        return Err(invalid());
    }
    let mut t = tx(&s, &p, &d).await?;
    if !manager(&member(&mut t, &p, &d, &p.subject).await?.0) {
        return Err(denied());
    }
    let m = mission(&mut t, &p, &d, &id).await?;
    if m.get::<String, _>("author") != p.subject {
        return Err(CoreError::not_found());
    }
    let src = visible(&mut t, &p, &d, &m).await?;
    if m.get::<i64, _>("revision") != q.expected_revision
        || m.get::<String, _>("status") != "completed"
    {
        return Err(changed());
    }
    let spans: Vec<Span> =
        serde_json::from_value(m.get::<Value, _>("evidence")).map_err(|_| invalid())?;
    let e = spans.get(index - 1).ok_or_else(invalid)?;
    let source_id: String = src.get("id");
    let excerpt = source_excerpt(&mut t, &p, &d, &source_id, e.start, e.end).await?;
    finish(t,&p,json!({"mission_id":id,"mission_revision":q.expected_revision,"index":index,"source_id":source_id,"source_hash":src.get::<String,_>("content_hash"),"title":src.get::<String,_>("title"),"location":src.get::<String,_>("location"),"start":e.start,"end":e.end,"total_characters":src.get::<i64,_>("characters"),"excerpt":excerpt,"read_kind":"human_report_review"})).await
}
