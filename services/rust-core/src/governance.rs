//! Owner governance with signed membership decisions and evidence-filtered journal.
use crate::{auth::Principal, error::CoreError, proposals, server::StateData};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::{IntoResponse, Response},
    routing::get,
};
use http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Row, postgres::PgRow};
use uuid::Uuid;
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Invalid governance arguments",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn conflict(code: &'static str) -> CoreError {
    CoreError {
        code,
        message: "Refresh membership before changing access",
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
#[derive(Deserialize)]
struct Page {
    #[serde(default = "twenty")]
    limit: usize,
    #[serde(default)]
    after: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Membership {
    subject: String,
    role: Option<String>,
    #[serde(default)]
    expected_revision: Option<i64>,
    reason: String,
    idempotency_key: String,
}
fn receipt(r: &PgRow) -> Value {
    json!({"id":r.get::<String,_>("id"),"author":r.get::<String,_>("author"),"subject":r.get::<String,_>("subject"),"previous_role":r.get::<Option<String>,_>("previous_role"),"new_role":r.get::<Option<String>,_>("new_role"),"resulting_revision":r.get::<Option<i32>,_>("resulting_revision"),"reason":r.get::<String,_>("reason"),"created_at":r.get::<Value,_>("created")})
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route("/v1/domains/{domain}/members", get(members).post(change))
        .route("/v1/domains/{domain}/membership-events", get(history))
        .route("/v1/domains/{domain}/commits", get(commits))
        .route("/v1/domains/{domain}/brief", get(brief))
}
fn page(
    input: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Page, CoreError> {
    let Query(p) = input.map_err(|_| invalid())?;
    if !(1..=100).contains(&p.limit) {
        return Err(invalid());
    }
    Ok(p)
}
async fn members(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    input: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let q = page(input)?;
    if q.after.chars().count() > 300 {
        return Err(invalid());
    }
    let mut tx = s.db.locked_owner_transaction(&p, &d).await?;
    let rows=sqlx::query("SELECT subject,role,revision FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND subject>$3 ORDER BY subject LIMIT $4").bind(&p.tenant).bind(&d).bind(q.after).bind((q.limit+1)as i64).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let next = if rows.len() > q.limit {
        json!(rows[q.limit - 1].get::<String, _>("subject"))
    } else {
        Value::Null
    };
    let v = json!({"items":rows.iter().take(q.limit).map(|r|json!({"subject":r.get::<String,_>("subject"),"role":r.get::<String,_>("role"),"revision":r.get::<i32,_>("revision")})).collect::<Vec<_>>(),"next_after":next});
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(v))
}
async fn history(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    input: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let q = page(input)?;
    let after = if q.after.is_empty() {
        String::new()
    } else {
        uuid(&q.after)?
    };
    let mut tx = s.db.locked_owner_transaction(&p, &d).await?;
    let rows=sqlx::query("SELECT *,to_jsonb(created_at) AS created FROM cf_membership_events WHERE tenant_id=$1 AND domain_id=$2 AND id>$3 ORDER BY id LIMIT $4").bind(&p.tenant).bind(&d).bind(after).bind((q.limit+1)as i64).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let next = if rows.len() > q.limit {
        json!(rows[q.limit - 1].get::<String, _>("id"))
    } else {
        Value::Null
    };
    let v = json!({"items":rows.iter().take(q.limit).map(receipt).collect::<Vec<_>>(),"next_after":next});
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(v))
}
async fn change(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    axum::extract::RawQuery(query): axum::extract::RawQuery,
    proof: Option<axum::Extension<crate::confirmation::ConfirmedAction>>,
    body: axum::body::Bytes,
) -> Response {
    let action = "members.change";
    let raw = serde_json::from_slice::<Value>(&body);
    let args = json!({"path":{"domain":d},"body":raw.as_ref().unwrap_or(&Value::Null)});
    let outcome: Result<Value, CoreError> = async {
        let p = s.auth.authenticate(&h)?;
        let d = uuid(&d)?;
        let raw = raw.map_err(|_| invalid())?;
        if query.is_some_and(|q| !q.is_empty())
            || !raw.as_object().is_some_and(|o| o.contains_key("role"))
        {
            return Err(invalid());
        }
        let data: Membership = serde_json::from_value(raw).map_err(|_| invalid())?;
        if !(1..=300).contains(&data.subject.chars().count())
            || !(1..=2000).contains(&data.reason.chars().count())
            || !(8..=128).contains(&data.idempotency_key.chars().count())
            || data.expected_revision.is_some_and(|n| n < 0)
            || data.role.as_ref().is_some_and(|r| {
                !matches!(
                    r.as_str(),
                    "owner" | "corpus_manager" | "contributor" | "agent" | "viewer"
                )
            })
        {
            return Err(invalid());
        }
        let tx = s.db.locked_owner_transaction(&p, &d).await?;
        tx.commit().await.map_err(CoreError::sql)?;
        if !proof
            .as_ref()
            .is_some_and(|v| v.subject == p.subject && v.tenant == p.tenant && v.action == action)
        {
            if h.get_all("x-cortex-confirmation").iter().count() > 1 {
                return Err(invalid());
            }
            s.confirmation
                .as_ref()
                .ok_or_else(crate::confirmation::required)?
                .consume(
                    &p,
                    &d,
                    action,
                    &args,
                    h.get("x-cortex-confirmation").and_then(|x| x.to_str().ok()),
                )
                .await?;
        }
        change_service(&s, &p, &d, data).await
    }
    .await;
    match outcome{Ok(v)=>(StatusCode::CREATED,Json(v)).into_response(),Err(e)if e.code=="CONFIRMATION_REQUIRED"=>(e.status,Json(json!({"error":e.code,"message":e.message,"confirmation_request":{"action":action,"command_hash":crate::confirmation::command_hash(action,&args).unwrap_or_default(),"transport_header":"X-Cortex-Confirmation","max_lifetime_seconds":300}}))).into_response(),Err(e)=>e.into_response()}
}
async fn change_service(
    s: &StateData,
    p: &Principal,
    d: &str,
    data: Membership,
) -> Result<Value, CoreError> {
    let hash = crate::canonical::digest(&serde_json::to_value(&data).map_err(|_| invalid())?)
        .map_err(|_| invalid())?;
    let mut tx = s.db.locked_owner_transaction(p, d).await?;
    if let Some(r)=sqlx::query("SELECT *,to_jsonb(created_at) AS created FROM cf_membership_events WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND idempotency_key=$4").bind(&p.tenant).bind(d).bind(&p.subject).bind(&data.idempotency_key).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?{if r.get::<String,_>("request_hash")!=hash{return Err(conflict("IDEMPOTENCY_CONFLICT"))}let result=receipt(&r);p.check_fresh()?;tx.commit().await.map_err(CoreError::sql)?;return Ok(result)}
    let old=sqlx::query("SELECT role,revision FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 FOR UPDATE").bind(&p.tenant).bind(d).bind(&data.subject).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    let old_revision = old.as_ref().map(|r| r.get::<i32, _>("revision"));
    let old_role = old.as_ref().map(|r| r.get::<String, _>("role"));
    if old_revision.map(i64::from) != data.expected_revision {
        return Err(conflict("STALE_MEMBERSHIP"));
    }
    if old.is_none() && data.role.is_none() {
        return Err(CoreError::not_found());
    }
    if old_role.as_deref() == Some("owner") && data.role.as_deref() != Some("owner") {
        let count:i64=sqlx::query_scalar("SELECT count(*) FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND role='owner'").bind(&p.tenant).bind(d).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
        if count <= 1 {
            return Err(conflict("LAST_OWNER"));
        }
    }
    let previous:Option<i32>=sqlx::query_scalar("SELECT max(resulting_revision) FROM cf_membership_events WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3").bind(&p.tenant).bind(d).bind(&data.subject).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    let revision = old_revision
        .unwrap_or(-1)
        .max(previous.unwrap_or(-1))
        .checked_add(1)
        .ok_or_else(|| conflict("STALE_MEMBERSHIP"))?;
    match &data.role {
        None => {
            sqlx::query(
                "DELETE FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3",
            )
            .bind(&p.tenant)
            .bind(d)
            .bind(&data.subject)
            .execute(&mut *tx)
            .await
            .map_err(CoreError::sql)?;
        }
        Some(role) if old.is_some() => {
            sqlx::query("UPDATE cf_memberships SET role=$1,revision=$2 WHERE tenant_id=$3 AND domain_id=$4 AND subject=$5").bind(role).bind(revision).bind(&p.tenant).bind(d).bind(&data.subject).execute(&mut *tx).await.map_err(CoreError::sql)?;
        }
        Some(role) => {
            sqlx::query("INSERT INTO cf_memberships(tenant_id,domain_id,subject,role,revision) VALUES($1,$2,$3,$4,$5)").bind(&p.tenant).bind(d).bind(&data.subject).bind(role).bind(revision).execute(&mut *tx).await.map_err(CoreError::sql)?;
        }
    }
    sqlx::query(
        "UPDATE cf_domains SET published_version=published_version WHERE tenant_id=$1 AND id=$2",
    )
    .bind(&p.tenant)
    .bind(d)
    .execute(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    let r=sqlx::query("INSERT INTO cf_membership_events(tenant_id,domain_id,id,author,subject,previous_role,new_role,resulting_revision,reason,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *,to_jsonb(created_at) AS created").bind(&p.tenant).bind(d).bind(Uuid::new_v4().to_string()).bind(&p.subject).bind(&data.subject).bind(old_role).bind(data.role).bind(revision).bind(data.reason).bind(data.idempotency_key).bind(hash).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    let v = receipt(&r);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(v)
}
async fn commits(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    input: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let q = page(input)?;
    let mut cursor = if q.after.is_empty() {
        0
    } else {
        q.after.parse::<i64>().map_err(|_| invalid())?
    };
    if cursor < 0 {
        return Err(invalid());
    }
    let mut tx = s.db.locked_owner_transaction(&p, &d).await?;
    let sources = proposals::sources(&mut tx, &p, &d).await?;
    let mut items = Vec::new();
    let mut next = Value::Null;
    'scan: loop {
        let rows=sqlx::query("SELECT c.*,to_jsonb(c.created_at) AS created,c.sequence<=d.published_version AS published,p.publisher,to_jsonb(p.recorded_at) AS recorded FROM cf_commits c JOIN cf_domains d ON d.tenant_id=c.tenant_id AND d.id=c.domain_id LEFT JOIN cf_publications p ON p.tenant_id=c.tenant_id AND p.domain_id=c.domain_id AND p.sequence=c.sequence WHERE c.tenant_id=$1 AND c.domain_id=$2 AND c.sequence>$3 ORDER BY c.sequence LIMIT 100").bind(&p.tenant).bind(&d).bind(cursor).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
        let count = rows.len();
        for r in rows {
            cursor = r.get("sequence");
            let proposal = proposals::row(&mut tx, &p, &d, r.get("proposal_id")).await?;
            match proposals::check_access(&mut tx, &p, &d, &proposal, &sources).await {
                Ok(()) => {}
                Err(e) if e.status == StatusCode::NOT_FOUND => continue,
                Err(e) => return Err(e),
            }
            if items.len() == q.limit {
                next = items
                    .last()
                    .map(|v: &Value| v["sequence"].clone())
                    .unwrap_or(Value::Null);
                break 'scan;
            }
            let publisher = r.get::<Option<String>, _>("publisher");
            let publication = publisher
                .map(|who| json!({"publisher":who,"recorded_at":r.get::<Value,_>("recorded")}));
            items.push(json!({"sequence":cursor,"proposal_id":r.get::<String,_>("proposal_id"),"author":r.get::<String,_>("author"),"reason":r.get::<String,_>("reason"),"digest":r.get::<String,_>("digest"),"created_at":r.get::<Value,_>("created"),"published":r.get::<bool,_>("published"),"publication":publication}));
        }
        if count < 100 {
            break;
        }
        p.check_fresh()?;
    }
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(json!({"items":items,"next_after":next})))
}
async fn brief(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let mut tx = s.db.locked_owner_transaction(&p, &d).await?;
    let version = sqlx::query(
        "SELECT accepted_version,published_version FROM cf_domains WHERE tenant_id=$1 AND id=$2",
    )
    .bind(&p.tenant)
    .bind(&d)
    .fetch_one(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    let sources = proposals::sources(&mut tx, &p, &d).await?;
    let rows=sqlx::query("SELECT * FROM cf_proposals WHERE tenant_id=$1 AND domain_id=$2 AND status='ready' ORDER BY created_at,id").bind(&p.tenant).bind(&d).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let mut pending = Vec::new();
    for r in rows {
        match proposals::check_access(&mut tx, &p, &d, &r, &sources).await {
            Ok(()) => pending.push(proposals::view(&r)),
            Err(e) if e.status == StatusCode::NOT_FOUND => {}
            Err(e) => return Err(e),
        }
    }
    let accessible = crate::retrieval::accessible(&mut tx, &p, &d).await?;
    let rows=sqlx::query("SELECT i.*,e.source_ids FROM cf_issues i JOIN cf_episodes e ON e.tenant_id=i.tenant_id AND e.domain_id=i.domain_id AND e.id=i.episode_id WHERE i.tenant_id=$1 AND i.domain_id=$2 AND e.subject=$3 AND i.status IN ('open','in_progress') ORDER BY i.created_at,i.id").bind(&p.tenant).bind(&d).bind(&p.subject).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let mut issues = Vec::new();
    for r in rows {
        if crate::retrieval::can_read(&r, &accessible)? {
            issues.push(json!({"id":r.get::<String,_>("id"),"kind":r.get::<String,_>("kind"),"reason":r.get::<String,_>("reason"),"episode_id":r.get::<String,_>("episode_id")}))
        }
    }
    let result = json!({"accepted_version":version.get::<i64,_>("accepted_version"),"published_version":version.get::<i64,_>("published_version"),"pending_proposals":pending,"issues":issues,"processing":"local_no_model","model_calls":0});
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
