//! Personal inbox: reading is never acceptance, approval or completion.
use crate::{auth::Principal, error::CoreError, server::StateData};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use http::{HeaderMap, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;
const ROLES: &[&str] = &["owner", "corpus_manager", "contributor", "viewer"];
fn invalid() -> CoreError {
    CoreError {
        status: StatusCode::UNPROCESSABLE_ENTITY,
        code: "VALIDATION_FAILED",
        message: "Invalid personal activity request",
    }
}
fn conflict() -> CoreError {
    CoreError {
        status: StatusCode::CONFLICT,
        code: "WORK_ACTIVITY_CHANGED",
        message: "Restart personal activity reading with current access",
    }
}
fn uid(s: &str) -> Result<String, CoreError> {
    Uuid::parse_str(s)
        .map(|v| v.to_string())
        .map_err(|_| invalid())
}
async fn role(
    t: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
) -> Result<String, CoreError> {
    let r: Option<String> = sqlx::query_scalar(
        "SELECT role FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3",
    )
    .bind(&p.tenant)
    .bind(d)
    .bind(&p.subject)
    .fetch_optional(&mut **t)
    .await
    .map_err(CoreError::sql)?;
    let r = r.filter(|r| ROLES.contains(&r.as_str())).ok_or(CoreError {
        status: StatusCode::FORBIDDEN,
        code: "NOT_AUTHORIZED",
        message: "Human work activity capability required",
    })?;
    Ok(r)
}
async fn finish(
    t: Transaction<'_, Postgres>,
    p: &Principal,
    v: Value,
) -> Result<Json<Value>, CoreError> {
    p.check_fresh()?;
    t.commit().await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    Ok(Json(v))
}
// All branches select only minimal current metadata. Never select command bodies, notes,
// reports, source hashes, private question drafts or command idempotency keys.
fn cte() -> String {
    format!(
        r#"WITH visible AS (
 SELECT 'task'::text AS kind,o.event_id,o.task_id AS target_id,t.title,t.status AS current_status,t.revision AS current_revision,e.action,e.actor,e.revision AS event_revision,o.created_at,n.read_at,true AS content_available
 FROM cf_task_outbox o JOIN cf_work_tasks t ON t.tenant_id=o.tenant_id AND t.domain_id=o.domain_id AND t.id=o.task_id
 JOIN cf_task_events e ON e.tenant_id=o.tenant_id AND e.domain_id=o.domain_id AND e.id=o.event_id
 LEFT JOIN cf_task_notification_reads n ON n.tenant_id=o.tenant_id AND n.domain_id=o.domain_id AND n.subject=o.recipient AND n.event_id=o.event_id
 WHERE o.tenant_id=$1 AND o.domain_id=$2 AND o.recipient=$3 AND $4<>'viewer' AND ($4 IN ('owner','corpus_manager') OR t.assignee=$3)
 UNION ALL
 SELECT 'reference_review',e.event_id,r.id,CASE WHEN r.status='withdrawn' THEN NULL ELSE r.content->>'question' END,r.status,r.revision,e.action,CASE WHEN r.status='withdrawn' THEN NULL ELSE e.actor END,e.revision,e.created_at,n.read_at,r.status<>'withdrawn'
 FROM cf_reference_review_commands e JOIN cf_reference_reviews r ON r.tenant_id=e.tenant_id AND r.domain_id=e.domain_id AND r.id=e.review_id
 LEFT JOIN cf_sources s ON s.tenant_id=r.tenant_id AND s.domain_id=r.domain_id AND s.id=r.content->>'source_id'
 LEFT JOIN cf_work_activity_reads n ON n.tenant_id=e.tenant_id AND n.domain_id=e.domain_id AND n.subject=$3 AND n.kind='reference_review' AND n.event_id=e.event_id
 WHERE r.tenant_id=$1 AND r.domain_id=$2 AND $4<>'viewer' AND e.actor<>$3 AND (r.author=$3 OR ($4 IN ('owner','corpus_manager') AND r.reviewer=$3))
 AND (r.status='withdrawn' OR (s.allowed_subjects ? $3 AND s.content_hash=r.content->>'source_hash'))
 UNION ALL
 SELECT 'mission',e.event_id,m.id,CASE WHEN ({access}) THEN m.title ELSE NULL END,m.status,m.revision,e.action,CASE WHEN ({access}) THEN e.actor ELSE NULL END,e.revision,e.created_at,n.read_at,({access})
 FROM cf_agent_mission_commands e JOIN cf_agent_missions m ON m.tenant_id=e.tenant_id AND m.domain_id=e.domain_id AND m.id=e.mission_id
 LEFT JOIN cf_work_activity_reads n ON n.tenant_id=e.tenant_id AND n.domain_id=e.domain_id AND n.subject=$3 AND n.kind='mission' AND n.event_id=e.event_id
 WHERE m.tenant_id=$1 AND m.domain_id=$2 AND $4 IN ('owner','corpus_manager') AND m.author=$3 AND e.actor<>$3 AND e.action IN ('claim','complete')
 UNION ALL
 SELECT 'shared_case',e.id,c.id,CASE WHEN c.status='withdrawn' AND c.author<>$3 THEN NULL ELSE c.title END,c.status,c.revision,e.action,NULL::text,e.revision,e.created_at,n.read_at,NOT(c.status='withdrawn' AND c.author<>$3)
 FROM cf_case_events e JOIN cf_shared_cases c ON c.tenant_id=e.tenant_id AND c.domain_id=e.domain_id AND c.id=e.case_id
 LEFT JOIN cf_work_activity_reads n ON n.tenant_id=e.tenant_id AND n.domain_id=e.domain_id AND n.subject=$3 AND n.kind='shared_case' AND n.event_id=e.id
 WHERE c.tenant_id=$1 AND c.domain_id=$2 AND e.actor<>$3 AND (c.author=$3 OR ($4 IN ('owner','corpus_manager') AND c.recipients ? $3))
 )"#,
        access = crate::agent_missions::CONTENT_ACCESS
    )
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route("/v1/domains/{domain}/work-activity", get(list))
        .route(
            "/v1/domains/{domain}/work-activity/{event}/read",
            post(acknowledge),
        )
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Page {
    limit: Option<i64>,
    after: Option<String>,
}
async fn list(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uid(&d)?;
    let Query(q) = q.map_err(|_| invalid())?;
    let limit = q.limit.unwrap_or(20);
    if !(1..=20).contains(&limit) {
        return Err(invalid());
    }
    let mut t = s.db.transaction(&p, &d, false).await?;
    let current_role = role(&mut t, &p, &d).await?;
    let versions=sqlx::query("SELECT (SELECT coalesce(max(ordinal),0) FROM cf_source_access_events WHERE tenant_id=$1 AND domain_id=$2) AS access,(SELECT count(*) FROM cf_work_activity_reads WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3)+(SELECT count(*) FROM cf_task_notification_reads WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3) AS reads").bind(&p.tenant).bind(&d).bind(&p.subject).fetch_one(&mut *t).await.map_err(CoreError::sql)?;
    let access: i64 = versions.get("access");
    let fingerprint = format!("{limit}:{access}:{}", versions.get::<i64, _>("reads"));
    let w = crate::workspace_paging::open(
        &mut t,
        &p,
        &d,
        "work-activity",
        &fingerprint,
        q.after.as_deref(),
    )
    .await?;
    let position = w.position.as_ref();
    let after_date = position
        .and_then(|v| v["date"].as_str())
        .map(|v| v.parse::<DateTime<Utc>>().map_err(|_| conflict()))
        .transpose()?;
    let after_kind = position.and_then(|v| v["kind"].as_str()).unwrap_or("");
    let after_id = position.and_then(|v| v["id"].as_str()).unwrap_or("");
    let rows=sqlx::query(&format!("{} SELECT *,to_jsonb(created_at) AS created,to_jsonb(read_at) AS read FROM visible WHERE ($5::timestamptz IS NULL OR (created_at,kind,event_id)<($5,$6,$7)) ORDER BY created_at DESC,kind DESC,event_id DESC LIMIT $8",cte())).bind(&p.tenant).bind(&d).bind(&p.subject).bind(&current_role).bind(after_date).bind(after_kind).bind(after_id).bind(limit+1).fetch_all(&mut *t).await.map_err(CoreError::sql)?;
    let counts = sqlx::query(&format!(
        "{} SELECT count(*) AS total,count(*) FILTER(WHERE read_at IS NULL) AS unread FROM visible",
        cte()
    ))
    .bind(&p.tenant)
    .bind(&d)
    .bind(&p.subject)
    .bind(&current_role)
    .fetch_one(&mut *t)
    .await
    .map_err(CoreError::sql)?;
    let more = rows.len() > limit as usize;
    let position=more.then(||{let r=&rows[limit as usize-1];json!({"date":r.get::<Value,_>("created"),"kind":r.get::<String,_>("kind"),"id":r.get::<String,_>("event_id")})});
    let next =
        crate::workspace_paging::next(&mut t, &p, &d, "work-activity", &fingerprint, &w, position)
            .await?;
    let items:Vec<Value>=rows.iter().take(limit as usize).map(|r|json!({"kind":r.get::<String,_>("kind"),"event_id":r.get::<String,_>("event_id"),"target_id":r.get::<String,_>("target_id"),"title":r.get::<Option<String>,_>("title"),"current_status":r.get::<String,_>("current_status"),"current_revision":r.get::<i64,_>("current_revision"),"action":r.get::<String,_>("action"),"actor":r.get::<Option<String>,_>("actor"),"event_revision":r.get::<i64,_>("event_revision"),"created_at":r.get::<Value,_>("created"),"read_at":r.get::<Option<Value>,_>("read"),"content_available":r.get::<bool,_>("content_available")})).collect();
    finish(t,&p,json!({"items":items,"next_after":next,"total":counts.get::<i64,_>("total"),"unread":counts.get::<i64,_>("unread"),"as_of":w.as_of,"permissions_version":w.permissions,"work_version":w.work,"source_access_version":access,"scope":"personal","sort":"created_kind_event_desc","coverage":["task_notifications","named_reference_reviews","mission_claims_and_reports","named_shared_cases"]})).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Read {
    kind: String,
    idempotency_key: Uuid,
}
async fn acknowledge(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
    b: Result<Json<Read>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uid(&d)?;
    let id = uid(&id)?;
    let Json(b) = b.map_err(|_| invalid())?;
    if !["task", "reference_review", "mission", "shared_case"].contains(&b.kind.as_str()) {
        return Err(invalid());
    }
    let mut t = s
        .db
        .locked_permission_transaction(&p, &d, ROLES, "Human work activity capability required")
        .await?;
    let current_role = role(&mut t, &p, &d).await?;
    let visible: bool = sqlx::query_scalar(&format!(
        "{} SELECT EXISTS(SELECT 1 FROM visible WHERE kind=$5 AND event_id=$6)",
        cte()
    ))
    .bind(&p.tenant)
    .bind(&d)
    .bind(&p.subject)
    .bind(&current_role)
    .bind(&b.kind)
    .bind(&id)
    .fetch_one(&mut *t)
    .await
    .map_err(CoreError::sql)?;
    if !visible {
        return Err(CoreError::not_found());
    }
    let used=sqlx::query("SELECT 'task'::text AS kind,event_id FROM cf_task_notification_reads WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND idempotency_key=$4 UNION ALL SELECT kind,event_id FROM cf_work_activity_reads WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND idempotency_key=$4").bind(&p.tenant).bind(&d).bind(&p.subject).bind(b.idempotency_key.to_string()).fetch_all(&mut *t).await.map_err(CoreError::sql)?;
    if used
        .iter()
        .any(|r| r.get::<String, _>("kind") != b.kind || r.get::<String, _>("event_id") != id)
    {
        return Err(conflict());
    }
    let at: Value = if b.kind == "task" {
        sqlx::query("INSERT INTO cf_task_notification_reads(tenant_id,domain_id,subject,event_id,idempotency_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,domain_id,subject,event_id) DO NOTHING").bind(&p.tenant).bind(&d).bind(&p.subject).bind(&id).bind(b.idempotency_key.to_string()).execute(&mut *t).await.map_err(CoreError::sql)?;
        sqlx::query_scalar("SELECT to_jsonb(read_at) FROM cf_task_notification_reads WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND event_id=$4").bind(&p.tenant).bind(&d).bind(&p.subject).bind(&id).fetch_one(&mut *t).await.map_err(CoreError::sql)?
    } else {
        sqlx::query("INSERT INTO cf_work_activity_reads(tenant_id,domain_id,subject,kind,event_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,domain_id,subject,kind,event_id) DO NOTHING").bind(&p.tenant).bind(&d).bind(&p.subject).bind(&b.kind).bind(&id).bind(b.idempotency_key.to_string()).execute(&mut *t).await.map_err(CoreError::sql)?;
        sqlx::query_scalar("SELECT to_jsonb(read_at) FROM cf_work_activity_reads WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND kind=$4 AND event_id=$5").bind(&p.tenant).bind(&d).bind(&p.subject).bind(&b.kind).bind(&id).fetch_one(&mut *t).await.map_err(CoreError::sql)?
    };
    finish(t, &p, json!({"kind":b.kind,"event_id":id,"read_at":at})).await
}
