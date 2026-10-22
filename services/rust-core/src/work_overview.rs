//! Read-only home. Named consent and source ACLs survive aggregation.
use crate::{auth::Principal, error::CoreError, server::StateData};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::get,
};
use http::{HeaderMap, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;
#[derive(Deserialize, Default)]
#[serde(rename_all = "snake_case")]
enum Scope {
    #[default]
    Assigned,
    Domain,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    #[serde(default)]
    scope: Scope,
}
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Invalid work overview scope",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
pub fn routes() -> Router<StateData> {
    Router::new().route("/v1/domains/{domain}/work-overview", get(read))
}
async fn cases(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    received: bool,
) -> Result<Value, CoreError> {
    // Deliberately exclude withdrawn/closed cases and all private origin content.
    let filter = "FROM cf_shared_cases WHERE tenant_id=$1 AND domain_id=$2 AND status IN ('new','qualified') AND (($4 AND author<>$3 AND recipients ? $3) OR (NOT $4 AND author=$3))";
    let total: i64 = sqlx::query_scalar(&format!("SELECT count(*) {filter}"))
        .bind(&p.tenant)
        .bind(d)
        .bind(&p.subject)
        .bind(received)
        .fetch_one(&mut **tx)
        .await
        .map_err(CoreError::sql)?;
    let rows=sqlx::query(&format!("SELECT id,title,status,to_jsonb(created_at) AS created {filter} ORDER BY created_at,id LIMIT 5"))
        .bind(&p.tenant).bind(d).bind(&p.subject).bind(received).fetch_all(&mut **tx).await.map_err(CoreError::sql)?;
    let items:Vec<Value>=rows.iter().map(|r|json!({"id":r.get::<String,_>("id"),"title":r.get::<String,_>("title"),"status":r.get::<String,_>("status"),"created_at":r.get::<Value,_>("created")})).collect();
    Ok(json!({"total":total,"items":items,"has_more":total>5,"sort":"created_at_asc_id_asc"}))
}
async fn imports(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
) -> Result<Value, CoreError> {
    // Reuse the exact existing import-read predicate, including every item's ACL.
    // Only metadata is aggregated; neither source text nor item payload is selected.
    let cte = format!(
        "WITH actionable AS (SELECT j.id,j.created_at,j.collection_id,c.name AS collection_name,count(*) FILTER(WHERE i.status='pending') AS pending,count(*) FILTER(WHERE i.status='failed') AS failed FROM cf_imports j JOIN cf_collections c ON c.tenant_id=j.tenant_id AND c.domain_id=j.domain_id AND c.id=j.collection_id JOIN cf_import_items i ON i.tenant_id=j.tenant_id AND i.domain_id=j.domain_id AND i.import_id=j.id WHERE j.tenant_id=$1 AND j.domain_id=$2 AND NOT j.cancelled AND {} GROUP BY j.id,j.created_at,j.collection_id,c.name HAVING count(*) FILTER(WHERE i.status IN ('pending','failed'))>0)",
        crate::imports::ACCESS
    );
    let counts=sqlx::query(&format!("{cte} SELECT count(*) AS active,count(*) FILTER(WHERE pending>0) AS pending_jobs,count(*) FILTER(WHERE failed>0) AS failed_jobs FROM actionable"))
        .bind(&p.tenant).bind(d).bind(&p.subject).fetch_one(&mut **tx).await.map_err(CoreError::sql)?;
    let rows=sqlx::query(&format!("{cte} SELECT id,collection_id,collection_name,pending,failed,to_jsonb(created_at) AS created FROM actionable ORDER BY (failed>0) DESC,created_at,id LIMIT 5"))
        .bind(&p.tenant).bind(d).bind(&p.subject).fetch_all(&mut **tx).await.map_err(CoreError::sql)?;
    let total = counts.get::<i64, _>("active");
    let items:Vec<Value>=rows.iter().map(|r|json!({"id":r.get::<String,_>("id"),"collection_id":r.get::<String,_>("collection_id"),"collection_name":r.get::<String,_>("collection_name"),"pending":r.get::<i64,_>("pending"),"failed":r.get::<i64,_>("failed"),"created_at":r.get::<Value,_>("created")})).collect();
    Ok(
        json!({"total":total,"pending_jobs":counts.get::<i64,_>("pending_jobs"),"failed_jobs":counts.get::<i64,_>("failed_jobs"),"items":items,"has_more":total>5,"sort":"failed_first_created_at_asc_id_asc"}),
    )
}
async fn reference_reviews(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    received: bool,
) -> Result<Value, CoreError> {
    // Same named recipient, current role and exact source ACL/hash as the review list.
    // Only pending opinions are actionable for a reviewer; authors follow all live copies.
    let filter = "FROM cf_reference_reviews r JOIN cf_sources s ON s.tenant_id=r.tenant_id AND s.domain_id=r.domain_id AND s.id=r.content->>'source_id' JOIN cf_memberships m ON m.tenant_id=r.tenant_id AND m.domain_id=r.domain_id AND m.subject=$3 WHERE r.tenant_id=$1 AND r.domain_id=$2 AND r.status<>'withdrawn' AND s.allowed_subjects ? $3 AND s.content_hash=r.content->>'source_hash' AND (($4 AND r.reviewer=$3 AND m.role IN ('owner','corpus_manager') AND r.status='awaiting_review') OR (NOT $4 AND r.author=$3 AND m.role IN ('owner','corpus_manager','contributor')))";
    let total: i64 = sqlx::query_scalar(&format!("SELECT count(*) {filter}"))
        .bind(&p.tenant)
        .bind(d)
        .bind(&p.subject)
        .bind(received)
        .fetch_one(&mut **tx)
        .await
        .map_err(CoreError::sql)?;
    let rows = sqlx::query(&format!("SELECT r.id,r.content->>'question' AS question,r.author,r.reviewer,r.status,r.revision,to_jsonb(r.created_at) AS created,to_jsonb(r.updated_at) AS updated {filter} ORDER BY r.created_at,r.id LIMIT 5"))
        .bind(&p.tenant).bind(d).bind(&p.subject).bind(received)
        .fetch_all(&mut **tx).await.map_err(CoreError::sql)?;
    let items: Vec<Value> = rows.iter().map(|r| json!({"id":r.get::<String,_>("id"),"question":r.get::<String,_>("question"),"author":r.get::<String,_>("author"),"reviewer":r.get::<String,_>("reviewer"),"status":r.get::<String,_>("status"),"revision":r.get::<i64,_>("revision"),"created_at":r.get::<Value,_>("created"),"updated_at":r.get::<Value,_>("updated")})).collect();
    Ok(json!({"total":total,"items":items,"has_more":total>5,"sort":"created_at_asc_id_asc"}))
}
async fn missions(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    at: &chrono::DateTime<chrono::Utc>,
) -> Result<Value, CoreError> {
    // Same author-only control scope as agent-mission-controls. A title is selected
    // only when the complete mandate can currently be read; no source/report text.
    let cte = format!(
        "WITH visible AS (SELECT m.id,m.status,m.revision,m.created_at,m.expires_at,m.reads_used,m.chars_used,m.max_reads,m.max_chars,m.expires_at<=$4::timestamptz AS expired,({}) AS content_available,CASE WHEN ({}) THEN m.title ELSE NULL END AS title FROM cf_agent_missions m WHERE m.tenant_id=$1 AND m.domain_id=$2 AND m.author=$3 AND m.status IN ('queued','running','completed'))",
        crate::agent_missions::CONTENT_ACCESS,
        crate::agent_missions::CONTENT_ACCESS
    );
    let counts = sqlx::query(&format!("{cte} SELECT count(*) AS total,count(*) FILTER(WHERE status='queued' AND NOT expired) AS waiting,count(*) FILTER(WHERE status='running' AND NOT expired) AS claimed,count(*) FILTER(WHERE status IN ('queued','running') AND expired) AS expired,count(*) FILTER(WHERE status='completed') AS reports,count(*) FILTER(WHERE NOT content_available) AS withheld FROM visible"))
        .bind(&p.tenant).bind(d).bind(&p.subject).bind(at).fetch_one(&mut **tx).await.map_err(CoreError::sql)?;
    let rows = sqlx::query(&format!("{cte} SELECT id,status,revision,to_jsonb(created_at) AS created,to_jsonb(expires_at) AS expires,reads_used,chars_used,max_reads,max_chars,expired,content_available,title FROM visible ORDER BY CASE WHEN status IN ('queued','running') AND expired THEN 0 WHEN status='completed' THEN 1 ELSE 2 END,created_at,id LIMIT 5"))
        .bind(&p.tenant).bind(d).bind(&p.subject).bind(at).fetch_all(&mut **tx).await.map_err(CoreError::sql)?;
    let total = counts.get::<i64, _>("total");
    let items:Vec<Value>=rows.iter().map(|r|json!({"id":r.get::<String,_>("id"),"status":r.get::<String,_>("status"),"revision":r.get::<i64,_>("revision"),"created_at":r.get::<Value,_>("created"),"expires_at":r.get::<Value,_>("expires"),"expired":r.get::<bool,_>("expired"),"content_available":r.get::<bool,_>("content_available"),"title":r.get::<Option<String>,_>("title"),"reads_used":r.get::<i64,_>("reads_used"),"chars_used":r.get::<i64,_>("chars_used"),"max_reads":r.get::<i64,_>("max_reads"),"max_chars":r.get::<i64,_>("max_chars")})).collect();
    Ok(
        json!({"total":total,"waiting":counts.get::<i64,_>("waiting"),"claimed":counts.get::<i64,_>("claimed"),"expired":counts.get::<i64,_>("expired"),"reports":counts.get::<i64,_>("reports"),"withheld":counts.get::<i64,_>("withheld"),"items":items,"has_more":total>5,"sort":"expired_report_created_id"}),
    )
}
async fn read(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    q: Result<Query<Input>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let Query(q) = q.map_err(|_| invalid())?;
    let p = s.auth.authenticate(&h)?;
    let d = Uuid::parse_str(&d)
        .map_err(|_| CoreError::invalid_uuid())?
        .to_string();
    let mut tx = s.db.transaction(&p, &d, false).await?;
    let role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3",
    )
    .bind(&p.tenant)
    .bind(&d)
    .bind(&p.subject)
    .fetch_optional(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    let r = role
        .filter(|r| ["owner", "corpus_manager", "contributor", "viewer"].contains(&r.as_str()))
        .ok_or_else(CoreError::not_found)?;
    let coordinate = matches!(r.as_str(), "owner" | "corpus_manager");
    let domain_scope = matches!(q.scope, Scope::Domain);
    if domain_scope && !coordinate {
        return Err(CoreError {
            code: "NOT_AUTHORIZED",
            message: "Domain task scope requires coordination permission",
            status: StatusCode::FORBIDDEN,
        });
    }
    let scope = if domain_scope { "domain" } else { "assigned" };
    let w = crate::workspace_paging::open(&mut tx, &p, &d, "work-overview", scope, None).await?;
    let tasks = if r == "viewer" {
        Value::Null
    } else {
        crate::tasks::brief::snapshot(&mut tx, &p, &d, &r, domain_scope, &w).await?
    };
    let received = if coordinate {
        cases(&mut tx, &p, &d, true).await?
    } else {
        Value::Null
    };
    let mine = cases(&mut tx, &p, &d, false).await?;
    let imports = if coordinate {
        imports(&mut tx, &p, &d).await?
    } else {
        Value::Null
    };
    let received_reference_reviews = if coordinate {
        reference_reviews(&mut tx, &p, &d, true).await?
    } else {
        Value::Null
    };
    let my_reference_reviews = if r != "viewer" {
        reference_reviews(&mut tx, &p, &d, false).await?
    } else {
        Value::Null
    };
    let my_missions = if coordinate {
        missions(&mut tx, &p, &d, &w.as_of).await?
    } else {
        Value::Null
    };
    let value = json!({"my_missions":my_missions,"received_reference_reviews":received_reference_reviews,"my_reference_reviews":my_reference_reviews,"scope":scope,"role":r,"as_of":w.as_of,"permissions_version":w.permissions,"work_version":w.work,"tasks":tasks,"received_cases":received,"my_cases":mine,"imports":imports,"coverage":"authorized_active_work_only"});
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    Ok(Json(value))
}
