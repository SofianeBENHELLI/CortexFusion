//! Work coordination only. Tasks never grant access to knowledge or publish it.
pub(crate) mod brief;
mod planning;
mod proposal_reviews;
mod receipts;
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

const ROLES: &[&str] = &["owner", "corpus_manager", "contributor"];
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Invalid task command",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn conflict() -> CoreError {
    CoreError {
        code: "TASK_CHANGED",
        message: "Read the current task before preparing a new command",
        status: StatusCode::CONFLICT,
    }
}
fn denied() -> CoreError {
    CoreError {
        code: "NOT_AUTHORIZED",
        message: "Current task capability required",
        status: StatusCode::FORBIDDEN,
    }
}
fn uuid(s: &str) -> Result<String, CoreError> {
    Uuid::parse_str(s)
        .map(|v| v.to_string())
        .map_err(|_| invalid())
}
fn bounded(s: &str, n: usize) -> bool {
    !s.trim().is_empty() && s.chars().count() <= n && !s.contains('\0')
}
fn manager(role: &str) -> bool {
    matches!(role, "owner" | "corpus_manager")
}
async fn role(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
) -> Result<String, CoreError> {
    let value: Option<String> = sqlx::query_scalar(
        "SELECT role FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3",
    )
    .bind(&p.tenant)
    .bind(d)
    .bind(&p.subject)
    .fetch_optional(&mut **tx)
    .await
    .map_err(CoreError::sql)?;
    value
        .filter(|r| ROLES.contains(&r.as_str()))
        .ok_or_else(CoreError::not_found)
}
async fn row(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    id: &str,
    r: &str,
) -> Result<PgRow, CoreError> {
    sqlx::query("SELECT *,to_jsonb(created_at) AS created,to_jsonb(updated_at) AS updated,to_jsonb(due_at) AS due,to_jsonb(offered_at) AS offered,to_jsonb(accepted_at) AS accepted FROM cf_work_tasks WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND ($4 OR assignee=$5)")
      .bind(&p.tenant).bind(d).bind(id).bind(manager(r)).bind(&p.subject).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?.ok_or_else(CoreError::not_found)
}
fn actions(status: &str, is_manager: bool, is_assignee: bool) -> Vec<&'static str> {
    let mut v = vec![];
    if is_manager {
        match status {
            "unassigned" => v.push("offer"),
            "review" => v.extend(["request_changes", "complete"]),
            "completed" | "cancelled" => v.push("reopen"),
            _ => {}
        }
        if !matches!(status, "completed" | "cancelled") {
            v.push("cancel");
        }
    }
    if is_assignee {
        match status {
            "offered" => v.extend(["accept", "decline"]),
            "in_progress" => v.extend(["block", "submit"]),
            "blocked" => v.push("resume"),
            _ => {}
        }
    }
    v
}
fn nullable(r: &PgRow, col: &str) -> Value {
    r.get::<Option<Value>, _>(col).unwrap_or(Value::Null)
}
fn view(r: &PgRow, p: &Principal, role: &str) -> Value {
    let status = r.get::<String, _>("status");
    let assignee = r.get::<Option<String>, _>("assignee");
    json!({"id":r.get::<String,_>("id"),"title":r.get::<String,_>("title"),"instructions":r.get::<String,_>("instructions"),"criteria":r.get::<String,_>("criteria"),"creator":r.get::<String,_>("creator"),"assignee":assignee,"status":status,"revision":r.get::<i64,_>("revision"),"created_at":r.get::<Value,_>("created"),"updated_at":r.get::<Value,_>("updated"),"due_at":nullable(r,"due"),"offered_at":nullable(r,"offered"),"accepted_at":nullable(r,"accepted"),"result_summary":r.get::<String,_>("result_summary"),"allowed_actions":actions(&status,manager(role),assignee.as_deref()==Some(&p.subject)),"priority":r.get::<String,_>("priority"),"priority_reason":r.get::<String,_>("priority_reason"),"planning_allowed":manager(role)&&!matches!(status.as_str(),"completed"|"cancelled")})
}
fn receipt(r: &PgRow) -> Value {
    json!({"task_id":r.get::<String,_>("task_id"),"event_id":r.get::<String,_>("event_id"),"revision":r.get::<i64,_>("revision"),"status":r.get::<String,_>("status")})
}
async fn prior(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    k: &Uuid,
    hash: &str,
) -> Result<Option<Value>, CoreError> {
    let old=sqlx::query("SELECT * FROM cf_task_commands WHERE tenant_id=$1 AND domain_id=$2 AND actor=$3 AND idempotency_key=$4").bind(&p.tenant).bind(d).bind(&p.subject).bind(k.to_string()).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?;
    old.map(|r| {
        if r.get::<String, _>("request_hash") == hash {
            Ok(receipt(&r))
        } else {
            Err(conflict())
        }
    })
    .transpose()
}
struct Event<'a> {
    task: &'a str,
    revision: i64,
    action: &'a str,
    previous: &'a str,
    status: &'a str,
    assignee: Option<&'a str>,
    reason: &'a str,
    result: &'a str,
    key: Uuid,
    hash: &'a str,
    planning: Option<Value>,
}
async fn record(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    e: Event<'_>,
) -> Result<Value, CoreError> {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO cf_task_events(tenant_id,domain_id,task_id,id,revision,actor,action,previous_status,status,assignee,reason,result_summary,planning) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)")
    .bind(&p.tenant).bind(d).bind(e.task).bind(&id).bind(e.revision).bind(&p.subject).bind(e.action).bind(e.previous).bind(e.status).bind(e.assignee).bind(e.reason).bind(e.result).bind(e.planning).execute(&mut **tx).await.map_err(CoreError::sql)?;
    sqlx::query("INSERT INTO cf_task_commands(tenant_id,domain_id,actor,idempotency_key,request_hash,task_id,event_id,revision,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
    .bind(&p.tenant).bind(d).bind(&p.subject).bind(e.key.to_string()).bind(e.hash).bind(e.task).bind(&id).bind(e.revision).bind(e.status).execute(&mut **tx).await.map_err(CoreError::sql)?;
    // Transactional metadata only; no delivery worker or external notification is implied.
    sqlx::query("INSERT INTO cf_task_outbox(tenant_id,domain_id,event_id,recipient,task_id) SELECT tenant_id,domain_id,$3,subject,$4 FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND (role IN ('owner','corpus_manager') OR subject=$5) ON CONFLICT DO NOTHING")
    .bind(&p.tenant).bind(d).bind(&id).bind(e.task).bind(e.assignee).execute(&mut **tx).await.map_err(CoreError::sql)?;
    Ok(json!({"task_id":e.task,"event_id":id,"revision":e.revision,"status":e.status}))
}
async fn finish(
    tx: Transaction<'_, Postgres>,
    p: &Principal,
    value: Value,
) -> Result<Json<Value>, CoreError> {
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    Ok(Json(value))
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Create {
    title: String,
    instructions: String,
    criteria: String,
    #[serde(default)]
    due_at: Option<DateTime<Utc>>,
    idempotency_key: Uuid,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Command {
    action: String,
    expected_revision: i64,
    reason: String,
    #[serde(default)]
    assignee: Option<String>,
    #[serde(default)]
    result_summary: Option<String>,
    idempotency_key: Uuid,
}
fn twenty() -> usize {
    20
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Page {
    #[serde(default = "twenty")]
    limit: usize,
    after: Option<String>,
}
fn page(
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Page, CoreError> {
    let Query(q) = q.map_err(|_| invalid())?;
    if !(1..=50).contains(&q.limit)
        || q.after
            .as_ref()
            .is_some_and(|s| s.len() > 200 || s.chars().any(char::is_control))
    {
        return Err(invalid());
    }
    Ok(q)
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .merge(proposal_reviews::routes())
        .merge(planning::routes())
        .merge(receipts::routes())
        .route(
            "/v1/domains/{domain}/task-notifications",
            get(notifications),
        )
        .route(
            "/v1/domains/{domain}/task-notifications/{event_id}/read",
            post(acknowledge_notification),
        )
        .route("/v1/domains/{domain}/work-brief", get(brief::read))
        .route("/v1/domains/{domain}/tasks", get(list).post(create))
        .route("/v1/domains/{domain}/tasks/candidates", get(candidates))
        .route("/v1/domains/{domain}/tasks/{task_id}", get(read))
        .route("/v1/domains/{domain}/tasks/{task_id}/events", get(history))
        .route(
            "/v1/domains/{domain}/tasks/{task_id}/commands",
            post(command),
        )
}
async fn create(
    State(s): State<StateData>,
    Path(d): Path<String>,
    headers: HeaderMap,
    body: Result<Json<Create>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let Json(v) = body.map_err(|_| invalid())?;
    if !bounded(&v.title, 200) || !bounded(&v.instructions, 2000) || !bounded(&v.criteria, 1000) {
        return Err(invalid());
    }
    let hash =
        canonical::digest(&json!({"action":"tasks.create","body":v})).map_err(|_| invalid())?;
    let mut tx =
        s.db.locked_permission_transaction(
            &p,
            &d,
            &["owner", "corpus_manager"],
            "Task coordinator required",
        )
        .await?;
    if let Some(old) = prior(&mut tx, &p, &d, &v.idempotency_key, &hash).await? {
        return finish(tx, &p, old).await;
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO cf_work_tasks(tenant_id,domain_id,id,title,instructions,criteria,creator,status,revision,due_at) VALUES($1,$2,$3,$4,$5,$6,$7,'unassigned',1,$8)")
    .bind(&p.tenant).bind(&d).bind(&id).bind(&v.title).bind(&v.instructions).bind(&v.criteria).bind(&p.subject).bind(v.due_at).execute(&mut *tx).await.map_err(CoreError::sql)?;
    let out = record(
        &mut tx,
        &p,
        &d,
        Event {
            task: &id,
            revision: 1,
            action: "create",
            previous: "",
            status: "unassigned",
            assignee: None,
            reason: "",
            result: "",
            key: v.idempotency_key,
            hash: &hash,
            planning: None,
        },
    )
    .await?;
    finish(tx, &p, out).await
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
    let v = view(&row(&mut tx, &p, &d, &id, &r).await?, &p, &r);
    finish(tx, &p, v).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TaskPage {
    #[serde(default = "twenty")]
    limit: usize,
    after: Option<String>,
    #[serde(default)]
    active_only: bool,
    #[serde(default)]
    assigned_to_me: bool,
}
async fn list(
    State(s): State<StateData>,
    Path(d): Path<String>,
    headers: HeaderMap,
    q: Result<Query<TaskPage>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let Query(q) = q.map_err(|_| invalid())?;
    if !(1..=50).contains(&q.limit) || q.after.as_ref().is_some_and(|v| v.len() > 200) {
        return Err(invalid());
    }
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let mut tx = s.db.transaction(&p, &d, false).await?;
    let r = role(&mut tx, &p, &d).await?;
    let entire_domain = manager(&r) && !q.assigned_to_me;
    let scope = if entire_domain { "domain" } else { "assigned" };
    let fingerprint = format!("{scope}:{}:{}", q.active_only, q.limit);
    let window =
        crate::workspace_paging::open(&mut tx, &p, &d, "tasks", &fingerprint, q.after.as_deref())
            .await?;
    let position = window.position.as_ref();
    let after_date = position
        .and_then(|v| v["date"].as_str())
        .map(|v| v.parse::<DateTime<Utc>>().map_err(|_| invalid()))
        .transpose()?;
    let after_id = position.and_then(|v| v["id"].as_str()).unwrap_or("");
    let rows=sqlx::query("SELECT *,to_jsonb(created_at) AS created,to_jsonb(updated_at) AS updated,to_jsonb(due_at) AS due,to_jsonb(offered_at) AS offered,to_jsonb(accepted_at) AS accepted FROM cf_work_tasks WHERE tenant_id=$1 AND domain_id=$2 AND ($3 OR assignee=$4) AND (NOT $5 OR status NOT IN ('completed','cancelled')) AND ($6::timestamptz IS NULL OR (created_at,id)>($6,$7)) ORDER BY created_at,id LIMIT $8")
      .bind(&p.tenant).bind(&d).bind(entire_domain).bind(&p.subject).bind(q.active_only).bind(after_date).bind(after_id).bind(q.limit as i64+1).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let total:i64=sqlx::query_scalar("SELECT count(*) FROM cf_work_tasks WHERE tenant_id=$1 AND domain_id=$2 AND ($3 OR assignee=$4) AND (NOT $5 OR status NOT IN ('completed','cancelled'))")
      .bind(&p.tenant).bind(&d).bind(entire_domain).bind(&p.subject).bind(q.active_only).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    let has_more = rows.len() > q.limit;
    let position = has_more.then(|| {
        let row = &rows[q.limit - 1];
        json!({"date":row.get::<Value,_>("created"),"id":row.get::<String,_>("id")})
    });
    let next =
        crate::workspace_paging::next(&mut tx, &p, &d, "tasks", &fingerprint, &window, position)
            .await?;
    let items: Vec<Value> = rows.iter().take(q.limit).map(|v| view(v, &p, &r)).collect();
    finish(tx, &p, json!({"items":items,"next_after":next,"has_more":has_more,"total":total,"as_of":window.as_of,"scope":scope,"permissions_version":window.permissions,"work_version":window.work,"completeness":if has_more {"partial"}else{"complete"},"sort":"created_at_asc_id_asc"})).await
}
async fn candidates(
    State(s): State<StateData>,
    Path(d): Path<String>,
    headers: HeaderMap,
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let q = page(q)?;
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let mut tx = s.db.transaction(&p, &d, false).await?;
    if !manager(&role(&mut tx, &p, &d).await?) {
        return Err(denied());
    }
    let rows=sqlx::query("SELECT subject,role FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND role IN ('owner','corpus_manager','contributor') AND subject>$3 ORDER BY subject LIMIT $4")
    .bind(&p.tenant).bind(&d).bind(q.after.unwrap_or_default()).bind(q.limit as i64+1).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let next = if rows.len() > q.limit {
        Some(rows[q.limit - 1].get::<String, _>("subject"))
    } else {
        None
    };
    let items: Vec<Value> = rows
        .iter()
        .take(q.limit)
        .map(|v| json!({"subject":v.get::<String,_>("subject"),"role":v.get::<String,_>("role")}))
        .collect();
    finish(tx, &p, json!({"items":items,"next_after":next})).await
}
async fn history(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    headers: HeaderMap,
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let q = page(q)?;
    let after = q
        .after
        .map(|a| a.parse::<i64>().map_err(|_| invalid()))
        .transpose()?
        .unwrap_or(0);
    if after < 0 {
        return Err(invalid());
    }
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let mut tx = s.db.transaction(&p, &d, false).await?;
    let r = role(&mut tx, &p, &d).await?;
    row(&mut tx, &p, &d, &id, &r).await?;
    let rows=sqlx::query("SELECT *,to_jsonb(created_at) AS created FROM cf_task_events WHERE tenant_id=$1 AND domain_id=$2 AND task_id=$3 AND revision>$4 ORDER BY revision LIMIT $5")
    .bind(&p.tenant).bind(&d).bind(&id).bind(after).bind(q.limit as i64+1).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let next = if rows.len() > q.limit {
        Some(rows[q.limit - 1].get::<i64, _>("revision").to_string())
    } else {
        None
    };
    let items:Vec<Value>=rows.iter().take(q.limit).map(|v|json!({"id":v.get::<String,_>("id"),"task_id":id,"revision":v.get::<i64,_>("revision"),"actor":v.get::<String,_>("actor"),"action":v.get::<String,_>("action"),"previous_status":v.get::<String,_>("previous_status"),"status":v.get::<String,_>("status"),"assignee":v.get::<Option<String>,_>("assignee"),"reason":v.get::<String,_>("reason"),"result_summary":v.get::<String,_>("result_summary"),"created_at":v.get::<Value,_>("created"),"planning":v.get::<Option<Value>,_>("planning")})).collect();
    finish(tx, &p, json!({"items":items,"next_after":next})).await
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
    if !bounded(&v.reason, 2000)
        || !(1..9_007_199_254_740_991).contains(&v.expected_revision)
        || v.assignee.as_ref().is_some_and(|s| !bounded(s, 200))
        || v.result_summary.as_ref().is_some_and(|s| !bounded(s, 2000))
        || ((v.action == "offer") != v.assignee.is_some())
        || ((v.action == "submit") != v.result_summary.is_some())
    {
        return Err(invalid());
    }
    let hash = canonical::digest(&json!({"action":"tasks.command","task_id":id,"body":v}))
        .map_err(|_| invalid())?;
    let mut tx =
        s.db.locked_permission_transaction(&p, &d, ROLES, "Task capability required")
            .await?;
    let r = role(&mut tx, &p, &d).await?;
    if let Some(old) = prior(&mut tx, &p, &d, &v.idempotency_key, &hash).await? {
        return finish(tx, &p, old).await;
    }
    let current = row(&mut tx, &p, &d, &id, &r).await?;
    let status = current.get::<String, _>("status");
    let mut assignee = current.get::<Option<String>, _>("assignee");
    if current.get::<i64, _>("revision") != v.expected_revision {
        return Err(conflict());
    }
    if !actions(
        &status,
        manager(&r),
        assignee.as_deref() == Some(&p.subject),
    )
    .contains(&v.action.as_str())
    {
        return Err(denied());
    }
    let next = match v.action.as_str() {
        "offer" => {
            let target = v.assignee.as_deref().ok_or_else(invalid)?;
            let eligible:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND role IN ('owner','corpus_manager','contributor'))").bind(&p.tenant).bind(&d).bind(target).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
            if !eligible {
                return Err(denied());
            }
            assignee = Some(target.into());
            "offered"
        }
        "accept" | "resume" | "request_changes" => "in_progress",
        "decline" | "reopen" => {
            assignee = None;
            "unassigned"
        }
        "block" => "blocked",
        "submit" => "review",
        "complete" => "completed",
        "cancel" => "cancelled",
        _ => return Err(invalid()),
    };
    let result = v
        .result_summary
        .as_deref()
        .unwrap_or_else(|| current.get::<&str, _>("result_summary"));
    if next == "completed" && result.is_empty() {
        return Err(conflict());
    }
    let revision = v.expected_revision + 1;
    sqlx::query("UPDATE cf_work_tasks SET status=$4,assignee=$5,revision=$6,result_summary=$7,updated_at=clock_timestamp(),offered_at=CASE WHEN $8='offer' THEN clock_timestamp() ELSE offered_at END,accepted_at=CASE WHEN $8='accept' THEN clock_timestamp() ELSE accepted_at END WHERE tenant_id=$1 AND domain_id=$2 AND id=$3")
    .bind(&p.tenant).bind(&d).bind(&id).bind(next).bind(&assignee).bind(revision).bind(result).bind(&v.action).execute(&mut *tx).await.map_err(CoreError::sql)?;
    let out = record(
        &mut tx,
        &p,
        &d,
        Event {
            task: &id,
            revision,
            action: &v.action,
            previous: &status,
            status: next,
            assignee: assignee.as_deref(),
            reason: &v.reason,
            result,
            key: v.idempotency_key,
            hash: &hash,
            planning: None,
        },
    )
    .await?;
    finish(tx, &p, out).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capabilities_follow_state_and_actor() {
        assert_eq!(actions("offered", false, true), vec!["accept", "decline"]);
        assert!(actions("review", false, true).is_empty());
        assert_eq!(
            actions("review", true, false),
            vec!["request_changes", "complete", "cancel"]
        );
        assert!(actions("completed", false, true).is_empty());
        assert_eq!(actions("completed", true, false), vec!["reopen"]);
    }
    #[test]
    fn unicode_bounds_reject_empty_and_nul() {
        assert!(bounded(&"🧠".repeat(200), 200));
        assert!(!bounded(&"🧠".repeat(201), 200));
        assert!(!bounded("  ", 200));
        assert!(!bounded("x\0y", 200));
    }
}

async fn notifications(
    State(s): State<StateData>,
    Path(d): Path<String>,
    headers: HeaderMap,
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let q = page(q)?;
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let mut tx = s.db.transaction(&p, &d, false).await?;
    let r = role(&mut tx, &p, &d).await?;
    let read_version:i64=sqlx::query_scalar("SELECT count(*) FROM cf_task_notification_reads WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3")
       .bind(&p.tenant).bind(&d).bind(&p.subject).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    let fingerprint = format!("{}:{read_version}", q.limit);
    let window = crate::workspace_paging::open(
        &mut tx,
        &p,
        &d,
        "task-notifications",
        &fingerprint,
        q.after.as_deref(),
    )
    .await?;
    let position = window.position.as_ref();
    let after_date = position
        .and_then(|v| v["date"].as_str())
        .map(|v| v.parse::<DateTime<Utc>>().map_err(|_| invalid()))
        .transpose()?;
    let after_id = position.and_then(|v| v["id"].as_str()).unwrap_or("");
    let filter = "FROM cf_task_outbox o JOIN cf_work_tasks t ON t.tenant_id=o.tenant_id AND t.domain_id=o.domain_id AND t.id=o.task_id JOIN cf_task_events e ON e.tenant_id=o.tenant_id AND e.domain_id=o.domain_id AND e.id=o.event_id LEFT JOIN cf_task_notification_reads n ON n.tenant_id=o.tenant_id AND n.domain_id=o.domain_id AND n.subject=o.recipient AND n.event_id=o.event_id WHERE o.tenant_id=$1 AND o.domain_id=$2 AND o.recipient=$3 AND ($4 OR t.assignee=$3)";
    let query = format!(
        "SELECT o.event_id,o.task_id,t.title,t.status AS current_status,e.action,e.actor,e.revision,to_jsonb(o.created_at) AS created,to_jsonb(n.read_at) AS read_at {filter} AND ($5::timestamptz IS NULL OR (o.created_at,o.event_id)<($5,$6)) ORDER BY o.created_at DESC,o.event_id DESC LIMIT $7"
    );
    let rows = sqlx::query(&query)
        .bind(&p.tenant)
        .bind(&d)
        .bind(&p.subject)
        .bind(manager(&r))
        .bind(after_date)
        .bind(after_id)
        .bind(q.limit as i64 + 1)
        .fetch_all(&mut *tx)
        .await
        .map_err(CoreError::sql)?;
    let counts = sqlx::query(&format!(
        "SELECT count(*) AS total,count(*) FILTER(WHERE n.event_id IS NULL) AS unread {filter}"
    ))
    .bind(&p.tenant)
    .bind(&d)
    .bind(&p.subject)
    .bind(manager(&r))
    .fetch_one(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    let has_more = rows.len() > q.limit;
    let position = has_more.then(|| {
        let row = &rows[q.limit - 1];
        json!({"date":row.get::<Value,_>("created"),"id":row.get::<String,_>("event_id")})
    });
    let next = crate::workspace_paging::next(
        &mut tx,
        &p,
        &d,
        "task-notifications",
        &fingerprint,
        &window,
        position,
    )
    .await?;
    let items:Vec<Value>=rows.iter().take(q.limit).map(|v|json!({"event_id":v.get::<String,_>("event_id"),"task_id":v.get::<String,_>("task_id"),"title":v.get::<String,_>("title"),"current_status":v.get::<String,_>("current_status"),"action":v.get::<String,_>("action"),"actor":v.get::<String,_>("actor"),"revision":v.get::<i64,_>("revision"),"created_at":v.get::<Value,_>("created"),"read_at":nullable(v,"read_at")})).collect();
    finish(tx,&p,json!({"items":items,"next_after":next,"has_more":has_more,"total":counts.get::<i64,_>("total"),"unread":counts.get::<i64,_>("unread"),"as_of":window.as_of,"scope":"personal","permissions_version":window.permissions,"work_version":window.work,"completeness":if has_more {"partial"}else{"complete"},"sort":"created_at_desc_id_desc"})).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Acknowledge {
    idempotency_key: Uuid,
}
async fn acknowledge_notification(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Result<Json<Acknowledge>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let Json(v) = body.map_err(|_| invalid())?;
    let mut tx =
        s.db.locked_permission_transaction(&p, &d, ROLES, "Task capability required")
            .await?;
    let r = role(&mut tx, &p, &d).await?;
    let visible:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cf_task_outbox o JOIN cf_work_tasks t ON t.tenant_id=o.tenant_id AND t.domain_id=o.domain_id AND t.id=o.task_id WHERE o.tenant_id=$1 AND o.domain_id=$2 AND o.recipient=$3 AND o.event_id=$4 AND ($5 OR t.assignee=$3))")
      .bind(&p.tenant).bind(&d).bind(&p.subject).bind(&id).bind(manager(&r)).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    if !visible {
        return Err(CoreError::not_found());
    }
    let used:Option<String>=sqlx::query_scalar("SELECT event_id FROM cf_task_notification_reads WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND idempotency_key=$4")
      .bind(&p.tenant).bind(&d).bind(&p.subject).bind(v.idempotency_key.to_string()).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    if used.is_some_and(|e| e != id) {
        return Err(conflict());
    }
    sqlx::query("INSERT INTO cf_task_notification_reads(tenant_id,domain_id,subject,event_id,idempotency_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,domain_id,subject,event_id) DO NOTHING")
      .bind(&p.tenant).bind(&d).bind(&p.subject).bind(&id).bind(v.idempotency_key.to_string()).execute(&mut *tx).await.map_err(CoreError::sql)?;
    let at:Value=sqlx::query_scalar("SELECT to_jsonb(read_at) FROM cf_task_notification_reads WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND event_id=$4")
      .bind(&p.tenant).bind(&d).bind(&p.subject).bind(&id).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    finish(tx, &p, json!({"event_id":id,"read_at":at})).await
}
