//! Explicit new excerpts, named recipients, and content-free transition receipts.
//! No conversation, signal, episode, or source ACL is changed by a case.
mod tasks;
use crate::{auth::Principal, canonical, error::CoreError, retrieval, server::StateData};
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
const HUMAN: &[&str] = &["owner", "corpus_manager", "contributor", "viewer"];
const POLICY: &str = "named-excerpt-v1";
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Invalid explicit case command",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn changed() -> CoreError {
    CoreError {
        code: "CASE_CHANGED",
        message: "Read and prepare the current case before acting",
        status: StatusCode::CONFLICT,
    }
}
fn expired() -> CoreError {
    CoreError {
        code: "CASE_CONSENT_EXPIRED",
        message: "Prepare the exact excerpt and current recipients again",
        status: StatusCode::CONFLICT,
    }
}
fn uuid(v: &str) -> Result<String, CoreError> {
    Uuid::parse_str(v)
        .map(|v| v.to_string())
        .map_err(|_| invalid())
}
fn bounded(v: &str, n: usize) -> bool {
    !v.trim().is_empty() && v.chars().count() <= n && !v.contains('\0')
}
fn manager(r: &str) -> bool {
    matches!(r, "owner" | "corpus_manager")
}
async fn role(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
) -> Result<String, CoreError> {
    let r: Option<String> = sqlx::query_scalar(
        "SELECT role FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3",
    )
    .bind(&p.tenant)
    .bind(d)
    .bind(&p.subject)
    .fetch_optional(&mut **tx)
    .await
    .map_err(CoreError::sql)?;
    r.filter(|r| HUMAN.contains(&r.as_str()))
        .ok_or_else(CoreError::not_found)
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
struct Content {
    title: String,
    excerpt: String,
    target: String,
    recipients: Vec<String>,
    policy_version: String,
    #[serde(default)]
    personal_signal_id: Option<Uuid>,
}
impl Content {
    fn validate(&self) -> Result<(), CoreError> {
        let unique: std::collections::BTreeSet<_> = self.recipients.iter().collect();
        if !bounded(&self.title, 200)
            || !bounded(&self.excerpt, 2000)
            || !["retrieved_evidence", "delivered_answer", "client_behavior"]
                .contains(&self.target.as_str())
            || self.policy_version != POLICY
            || !(1..=20).contains(&self.recipients.len())
            || unique.len() != self.recipients.len()
            || self.recipients.iter().any(|x| !bounded(x, 200))
        {
            return Err(invalid());
        }
        Ok(())
    }
    fn digest(&self) -> Result<String, CoreError> {
        canonical::digest(&json!(self)).map_err(|_| invalid())
    }
}
async fn validate_content(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    v: &Content,
) -> Result<String, CoreError> {
    v.validate()?;
    for recipient in &v.recipients {
        if recipient == &p.subject {
            return Err(invalid());
        }
        let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND role IN ('owner','corpus_manager'))").bind(&p.tenant).bind(d).bind(recipient).fetch_one(&mut **tx).await.map_err(CoreError::sql)?;
        if !exists {
            return Err(changed());
        }
    }
    if let Some(signal) = v.personal_signal_id {
        let signal=sqlx::query("SELECT episode_id,origin FROM cf_feedback_signals WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND id=$4").bind(&p.tenant).bind(d).bind(&p.subject).bind(signal.to_string()).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)?;
        let accessible = retrieval::accessible(tx, p, d).await?;
        retrieval::episode_row(tx, p, d, signal.get("episode_id"), &accessible).await?;
        Ok(signal.get("origin"))
    } else {
        Ok("explicit".into())
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Share {
    preparation_id: Uuid,
    content: Content,
    idempotency_key: Uuid,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Command {
    action: String,
    expected_revision: i64,
    #[serde(default)]
    qualification: Option<String>,
    #[serde(default)]
    public_conclusion: Option<String>,
    idempotency_key: Uuid,
}
fn twenty() -> usize {
    20
}
fn mine() -> String {
    "mine".into()
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Page {
    #[serde(default = "twenty")]
    limit: usize,
    after: Option<String>,
    #[serde(default = "mine")]
    scope: String,
}
fn page(
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Page, CoreError> {
    let Query(q) = q.map_err(|_| invalid())?;
    if !(1..=50).contains(&q.limit)
        || !["mine", "team"].contains(&q.scope.as_str())
        || q.after
            .as_ref()
            .is_some_and(|s| Uuid::parse_str(s).is_err())
    {
        return Err(invalid());
    }
    Ok(q)
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .merge(tasks::routes())
        .route("/v1/domains/{domain}/shared-cases", get(list))
        .route(
            "/v1/domains/{domain}/shared-cases/recipients",
            get(recipients),
        )
        .route("/v1/domains/{domain}/shared-cases/prepare", post(prepare))
        .route("/v1/domains/{domain}/shared-cases/share", post(share))
        .route("/v1/domains/{domain}/shared-cases/{case_id}", get(read))
        .route(
            "/v1/domains/{domain}/shared-cases/{case_id}/commands",
            post(command),
        )
        .route(
            "/v1/domains/{domain}/shared-cases/{case_id}/events",
            get(events),
        )
}
async fn recipients(
    State(s): State<StateData>,
    Path(d): Path<String>,
    headers: HeaderMap,
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let q = page(q)?;
    if q.scope != "mine" {
        return Err(invalid());
    }
    let mut tx = s.db.transaction(&p, &d, false).await?;
    role(&mut tx, &p, &d).await?;
    let fingerprint = format!("recipients:{}", q.limit);
    let w = crate::workspace_paging::open(
        &mut tx,
        &p,
        &d,
        "case_recipients",
        &fingerprint,
        q.after.as_deref(),
    )
    .await?;
    let start = w.position.as_ref().and_then(|x| x.as_str()).unwrap_or("");
    let mut rows=sqlx::query("SELECT subject,role FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND subject<>$3 AND role IN ('owner','corpus_manager') AND subject>$4 ORDER BY subject LIMIT $5").bind(&p.tenant).bind(&d).bind(&p.subject).bind(start).bind(q.limit as i64+1).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let total:i64=sqlx::query_scalar("SELECT count(*) FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND subject<>$3 AND role IN ('owner','corpus_manager')").bind(&p.tenant).bind(&d).bind(&p.subject).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    let more = rows.len() > q.limit;
    rows.truncate(q.limit);
    let pos = if more {
        rows.last().map(|r| json!(r.get::<String, _>("subject")))
    } else {
        None
    };
    let next =
        crate::workspace_paging::next(&mut tx, &p, &d, "case_recipients", &fingerprint, &w, pos)
            .await?;
    let items: Vec<Value> = rows
        .iter()
        .map(|r| json!({"subject":r.get::<String,_>("subject"),"role":r.get::<String,_>("role")}))
        .collect();
    finish(tx,&p,json!({"items":items,"next_after":next,"total":total,"as_of":w.as_of,"permissions_version":w.permissions})).await
}
async fn prepare(
    State(s): State<StateData>,
    Path(d): Path<String>,
    headers: HeaderMap,
    body: Result<Json<Content>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let Json(v) = body.map_err(|_| invalid())?;
    v.validate()?;
    let mut tx = s
        .db
        .locked_permission_transaction(&p, &d, HUMAN, "Human member required for explicit sharing")
        .await?;
    let origin = validate_content(&mut tx, &p, &d, &v).await?;
    let digest = v.digest()?;
    let id = Uuid::new_v4().to_string();
    let r=sqlx::query("INSERT INTO cf_case_preparations(tenant_id,domain_id,subject,id,payload_hash,membership_revision) SELECT $1,$2,$3,$4,$5,membership_revision FROM cf_domains WHERE tenant_id=$1 AND id=$2 RETURNING to_jsonb(expires_at) AS expires,membership_revision").bind(&p.tenant).bind(&d).bind(&p.subject).bind(&id).bind(&digest).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    finish(tx,&p,json!({"preparation_id":id,"content_hash":digest,"expires_at":r.get::<Value,_>("expires"),"permissions_version":r.get::<i64,_>("membership_revision"),"policy_version":POLICY,"origin":origin})).await
}
fn receipt(r: &PgRow) -> Value {
    json!({"case_id":r.get::<String,_>("case_id"),"event_id":r.get::<String,_>("event_id"),"revision":r.get::<i64,_>("revision"),"status":r.get::<String,_>("status")})
}
async fn prior(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    key: &Uuid,
    hash: &str,
) -> Result<Option<Value>, CoreError> {
    let r=sqlx::query("SELECT * FROM cf_case_commands WHERE tenant_id=$1 AND domain_id=$2 AND actor=$3 AND idempotency_key=$4").bind(&p.tenant).bind(d).bind(&p.subject).bind(key.to_string()).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?;
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
    id: &str,
    revision: i64,
    status: &str,
    action: &str,
    key: &Uuid,
    hash: &str,
) -> Result<Value, CoreError> {
    record_with_task(tx, p, d, id, revision, status, action, key, hash, None).await
}
async fn record_with_task(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    id: &str,
    revision: i64,
    status: &str,
    action: &str,
    key: &Uuid,
    hash: &str,
    task_id: Option<&str>,
) -> Result<Value, CoreError> {
    let event = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO cf_case_events(tenant_id,domain_id,case_id,id,actor,action,revision,status,task_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)").bind(&p.tenant).bind(d).bind(id).bind(&event).bind(&p.subject).bind(action).bind(revision).bind(status).bind(task_id).execute(&mut **tx).await.map_err(CoreError::sql)?;
    sqlx::query("INSERT INTO cf_case_commands(tenant_id,domain_id,actor,idempotency_key,request_hash,case_id,event_id,revision,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)").bind(&p.tenant).bind(d).bind(&p.subject).bind(key.to_string()).bind(hash).bind(id).bind(&event).bind(revision).bind(status).execute(&mut **tx).await.map_err(CoreError::sql)?;
    Ok(json!({"case_id":id,"event_id":event,"revision":revision,"status":status}))
}
async fn share(
    State(s): State<StateData>,
    Path(d): Path<String>,
    headers: HeaderMap,
    body: Result<Json<Share>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let Json(v) = body.map_err(|_| invalid())?;
    v.content.validate()?;
    let hash = canonical::digest(&json!({"action":"share","body":v})).map_err(|_| invalid())?;
    let mut tx = s
        .db
        .locked_permission_transaction(&p, &d, HUMAN, "Human member required for explicit sharing")
        .await?;
    if let Some(old) = prior(&mut tx, &p, &d, &v.idempotency_key, &hash).await? {
        return finish(tx, &p, old).await;
    }
    let consent:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cf_case_preparations c JOIN cf_domains d ON d.tenant_id=c.tenant_id AND d.id=c.domain_id WHERE c.tenant_id=$1 AND c.domain_id=$2 AND c.subject=$3 AND c.id=$4 AND c.payload_hash=$5 AND c.expires_at>clock_timestamp() AND c.membership_revision=d.membership_revision)").bind(&p.tenant).bind(&d).bind(&p.subject).bind(v.preparation_id.to_string()).bind(v.content.digest()?).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    if !consent {
        return Err(expired());
    }
    let used:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cf_shared_cases WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND preparation_id=$4)").bind(&p.tenant).bind(&d).bind(&p.subject).bind(v.preparation_id.to_string()).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    if used {
        return Err(changed());
    }
    let origin = validate_content(&mut tx, &p, &d, &v.content).await?;
    let id = Uuid::new_v4().to_string();
    let c = &v.content;
    sqlx::query("INSERT INTO cf_shared_cases(tenant_id,domain_id,id,author,title,excerpt,target,origin,personal_signal_id,recipients,policy_version,status,revision,preparation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'new',1,$12)").bind(&p.tenant).bind(&d).bind(&id).bind(&p.subject).bind(&c.title).bind(&c.excerpt).bind(&c.target).bind(origin).bind(c.personal_signal_id.map(|s|s.to_string())).bind(json!(c.recipients)).bind(POLICY).bind(v.preparation_id.to_string()).execute(&mut *tx).await.map_err(CoreError::sql)?;
    let out = record(
        &mut tx,
        &p,
        &d,
        &id,
        1,
        "new",
        "share",
        &v.idempotency_key,
        &hash,
    )
    .await?;
    finish(tx, &p, out).await
}
async fn row(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    id: &str,
    r: &str,
) -> Result<PgRow, CoreError> {
    sqlx::query("SELECT *,to_jsonb(created_at) AS created,to_jsonb(updated_at) AS updated FROM cf_shared_cases WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND (author=$4 OR ($5 AND recipients ? $4))").bind(&p.tenant).bind(d).bind(id).bind(&p.subject).bind(manager(r)).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)
}
fn view(r: &PgRow, p: &Principal) -> Value {
    let author = r.get::<String, _>("author") == p.subject;
    let status = r.get::<String, _>("status");
    let withdrawn = status == "withdrawn";
    // Explicit DTOs. Tombstone contains no content, origin reference, recipient, or actor.
    if withdrawn && !author {
        return json!({"audience":"withdrawn","id":r.get::<String,_>("id"),"status":status,"revision":r.get::<i64,_>("revision"),"created_at":r.get::<Value,_>("created"),"updated_at":r.get::<Value,_>("updated"),"allowed_actions":[]});
    }
    let actions: Vec<&str> = if withdrawn {
        vec![]
    } else if author {
        vec!["withdraw"]
    } else if status == "closed_without_change" {
        vec!["reopen"]
    } else {
        vec!["qualify", "close_without_change"]
    };
    let mut v = json!({"audience":if author{"declarant"}else{"team"},"id":r.get::<String,_>("id"),"title":r.get::<String,_>("title"),"excerpt":r.get::<String,_>("excerpt"),"target":r.get::<String,_>("target"),"origin":r.get::<String,_>("origin"),"status":status,"qualification":r.get::<String,_>("qualification"),"public_conclusion":r.get::<String,_>("public_conclusion"),"revision":r.get::<i64,_>("revision"),"created_at":r.get::<Value,_>("created"),"updated_at":r.get::<Value,_>("updated"),"policy_version":POLICY,"allowed_actions":actions});
    if author {
        v["recipients"] = r.get("recipients");
        v["personal_signal_id"] = json!(r.get::<Option<String>, _>("personal_signal_id"));
    } else {
        v["declarant"] = json!(r.get::<String, _>("author"));
    }
    v
}
async fn read(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let mut tx = s.db.transaction(&p, &d, false).await?;
    let r = role(&mut tx, &p, &d).await?;
    let v = view(&row(&mut tx, &p, &d, &id, &r).await?, &p);
    finish(tx, &p, v).await
}
async fn list(
    State(s): State<StateData>,
    Path(d): Path<String>,
    headers: HeaderMap,
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let q = page(q)?;
    let mut tx = s.db.transaction(&p, &d, false).await?;
    let r = role(&mut tx, &p, &d).await?;
    let team = q.scope == "team";
    if team && !manager(&r) {
        return Err(CoreError::not_found());
    }
    let fp = format!("{}:{}", q.scope, q.limit);
    let w =
        crate::workspace_paging::open(&mut tx, &p, &d, "cases", &fp, q.after.as_deref()).await?;
    let position = w.position.as_ref();
    let when = position
        .and_then(|x| x["created_at"].as_str())
        .unwrap_or("0001-01-01T00:00:00Z");
    let after = position.and_then(|x| x["id"].as_str()).unwrap_or("");
    let filter = "FROM cf_shared_cases WHERE tenant_id=$1 AND domain_id=$2 AND (($4 AND author<>$3 AND recipients ? $3) OR (NOT $4 AND author=$3))";
    let total: i64 = sqlx::query_scalar(&format!("SELECT count(*) {filter}"))
        .bind(&p.tenant)
        .bind(&d)
        .bind(&p.subject)
        .bind(team)
        .fetch_one(&mut *tx)
        .await
        .map_err(CoreError::sql)?;
    let mut rows=sqlx::query(&format!("SELECT *,to_jsonb(created_at) AS created,to_jsonb(updated_at) AS updated {filter} AND (created_at,id)>($5::text::timestamptz,$6) ORDER BY created_at,id LIMIT $7")).bind(&p.tenant).bind(&d).bind(&p.subject).bind(team).bind(when).bind(after).bind(q.limit as i64+1).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let more = rows.len() > q.limit;
    rows.truncate(q.limit);
    let pos = if more {
        rows.last()
            .map(|r| json!({"id":r.get::<String,_>("id"),"created_at":r.get::<Value,_>("created")}))
    } else {
        None
    };
    let next = crate::workspace_paging::next(&mut tx, &p, &d, "cases", &fp, &w, pos).await?;
    let items: Vec<Value> = rows.iter().map(|r| view(r, &p)).collect();
    finish(tx,&p,json!({"items":items,"next_after":next,"total":total,"has_more":more,"as_of":w.as_of,"scope":q.scope,"permissions_version":w.permissions,"work_version":w.work,"completeness":if more{"partial"}else{"complete"},"sort":"created_at_asc_id_asc"})).await
}
fn transition(
    status: &str,
    author: bool,
    v: &Command,
) -> Result<(&'static str, String, String), CoreError> {
    if v.expected_revision < 1 {
        return Err(invalid());
    }
    if v.action == "withdraw" {
        if !author
            || status == "withdrawn"
            || v.qualification.is_some()
            || v.public_conclusion.is_some()
        {
            return Err(changed());
        }
        return Ok(("withdrawn", String::new(), String::new()));
    }
    if author || status == "withdrawn" {
        return Err(CoreError::not_found());
    }
    match v.action.as_str() {
        "qualify" if matches!(status, "new" | "qualified") => {
            let q = v.qualification.as_deref().ok_or_else(invalid)?;
            if ![
                "incorrect",
                "missing",
                "outdated",
                "unclear",
                "behavior",
                "other",
            ]
            .contains(&q)
                || v.public_conclusion.is_some()
            {
                return Err(invalid());
            }
            Ok(("qualified", q.into(), String::new()))
        }
        "close_without_change" if matches!(status, "new" | "qualified") => {
            let c = v.public_conclusion.as_deref().ok_or_else(invalid)?;
            if !bounded(c, 2000) || v.qualification.is_some() {
                return Err(invalid());
            }
            Ok(("closed_without_change", String::new(), c.into()))
        }
        "reopen" if status == "closed_without_change" => {
            let c = v.public_conclusion.as_deref().ok_or_else(invalid)?;
            if !bounded(c, 2000) || v.qualification.is_some() {
                return Err(invalid());
            }
            Ok(("new", String::new(), c.into()))
        }
        _ => Err(changed()),
    }
}
async fn command(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Result<Json<Command>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let Json(v) = body.map_err(|_| invalid())?;
    let hash = canonical::digest(&json!({"id":id,"body":v})).map_err(|_| invalid())?;
    let mut tx =
        s.db.locked_permission_transaction(&p, &d, HUMAN, "Human case capability required")
            .await?;
    let r = role(&mut tx, &p, &d).await?;
    let current = row(&mut tx, &p, &d, &id, &r).await?;
    if let Some(old) = prior(&mut tx, &p, &d, &v.idempotency_key, &hash).await? {
        return finish(tx, &p, old).await;
    }
    if current.get::<i64, _>("revision") != v.expected_revision {
        return Err(changed());
    }
    let (status, qualification, conclusion) = transition(
        current.get("status"),
        current.get::<String, _>("author") == p.subject,
        &v,
    )?;
    let rev = v.expected_revision.checked_add(1).ok_or_else(invalid)?;
    sqlx::query("UPDATE cf_shared_cases SET status=$4,revision=$5,updated_at=clock_timestamp(),qualification=CASE WHEN $6='' THEN qualification ELSE $6 END,public_conclusion=CASE WHEN $7='' THEN public_conclusion ELSE $7 END,withdrawn_at=CASE WHEN $4='withdrawn' THEN clock_timestamp() ELSE withdrawn_at END WHERE tenant_id=$1 AND domain_id=$2 AND id=$3").bind(&p.tenant).bind(&d).bind(&id).bind(status).bind(rev).bind(qualification).bind(conclusion).execute(&mut *tx).await.map_err(CoreError::sql)?;
    let out = record(
        &mut tx,
        &p,
        &d,
        &id,
        rev,
        status,
        &v.action,
        &v.idempotency_key,
        &hash,
    )
    .await?;
    finish(tx, &p, out).await
}
async fn events(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    headers: HeaderMap,
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let q = page(q)?;
    if q.scope != "mine" {
        return Err(invalid());
    }
    let mut tx = s.db.transaction(&p, &d, false).await?;
    let r = role(&mut tx, &p, &d).await?;
    let current = row(&mut tx, &p, &d, &id, &r).await?;
    let fp = format!("{id}:{}", q.limit);
    let w = crate::workspace_paging::open(&mut tx, &p, &d, "case_events", &fp, q.after.as_deref())
        .await?;
    let after = w.position.as_ref().and_then(Value::as_i64).unwrap_or(0);
    let author = current.get::<String, _>("author") == p.subject;
    let rows=sqlx::query("SELECT id,action,revision,status,to_jsonb(created_at) AS created FROM cf_case_events WHERE tenant_id=$1 AND domain_id=$2 AND case_id=$3 AND revision>$4 ORDER BY revision LIMIT $5").bind(&p.tenant).bind(&d).bind(&id).bind(after).bind(q.limit as i64+1).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    // History is metadata only even after withdrawal; no free text or private actor names.
    let more = rows.len() > q.limit;
    let items:Vec<Value>=rows.iter().take(q.limit).map(|r|json!({"id":r.get::<String,_>("id"),"action":r.get::<String,_>("action"),"revision":r.get::<i64,_>("revision"),"status":r.get::<String,_>("status"),"created_at":r.get::<Value,_>("created")})).collect();
    let pos = if more {
        items.last().map(|x| x["revision"].clone())
    } else {
        None
    };
    let next = crate::workspace_paging::next(&mut tx, &p, &d, "case_events", &fp, &w, pos).await?;
    finish(tx,&p,json!({"case_id":id,"audience":if author{"declarant"}else{"team"},"items":items,"next_after":next,"total":current.get::<i64,_>("revision"),"as_of":w.as_of})).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn no_publication_or_author_triage() {
        let mut c = Command {
            action: "close_without_change".into(),
            expected_revision: 1,
            qualification: None,
            public_conclusion: Some(
                "Aucune correction nécessaire, justificatif synthétique".into(),
            ),
            idempotency_key: Uuid::new_v4(),
        };
        assert!(transition("new", true, &c).is_err());
        assert!(transition("withdrawn", false, &c).is_err());
        assert_eq!(
            transition("qualified", false, &c).unwrap().0,
            "closed_without_change"
        );
        c.action = "corrected".into();
        assert!(transition("qualified", false, &c).is_err())
    }
    #[test]
    fn content_bounds_do_not_truncate() {
        let mut c = Content {
            title: "Titre".into(),
            excerpt: "🧠".repeat(2000),
            target: "delivered_answer".into(),
            recipients: vec!["manager".into()],
            policy_version: POLICY.into(),
            personal_signal_id: None,
        };
        assert!(c.validate().is_ok());
        c.excerpt.push('x');
        assert!(c.validate().is_err());
        c.excerpt = "Court".into();
        c.recipients.push("manager".into());
        assert!(c.validate().is_err())
    }
}
