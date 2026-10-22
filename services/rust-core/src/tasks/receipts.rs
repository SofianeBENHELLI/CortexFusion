//! Personal immutable receipts. Absence is never proof that a command failed.
use super::*;

pub(super) fn routes() -> Router<StateData> {
    Router::new()
        .route("/v1/domains/{domain}/task-command-receipts", get(list))
        .route(
            "/v1/domains/{domain}/task-command-receipts/{command_id}",
            get(read),
        )
}
const JOIN: &str = "FROM cf_task_commands c JOIN cf_task_events e ON e.tenant_id=c.tenant_id AND e.domain_id=c.domain_id AND e.id=c.event_id JOIN cf_work_tasks t ON t.tenant_id=c.tenant_id AND t.domain_id=c.domain_id AND t.id=c.task_id WHERE c.tenant_id=$1 AND c.domain_id=$2 AND c.actor=$3";
const FIELDS: &str = "c.*,e.action,to_jsonb(c.created_at) AS occurred,CASE WHEN $4 OR t.assignee=$3 THEN t.title ELSE NULL END AS task_title,CASE WHEN $4 OR t.assignee=$3 THEN t.revision ELSE NULL END AS current_revision,CASE WHEN $4 OR t.assignee=$3 THEN t.status ELSE NULL END AS current_status";
fn view(r: &PgRow) -> Value {
    json!({"command_id":r.get::<String,_>("idempotency_key"),"receipt":receipt(r),"action":r.get::<String,_>("action"),"recorded_at":r.get::<Value,_>("occurred"),"task_title":r.get::<Option<String>,_>("task_title"),"current_revision":r.get::<Option<i64>,_>("current_revision"),"current_status":r.get::<Option<String>,_>("current_status"),"outcome":"recorded"})
}
async fn read(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let mut tx = s.db.transaction(&p, &d, false).await?;
    let r = role(&mut tx, &p, &d).await?;
    let row = sqlx::query(&format!("SELECT {FIELDS} {JOIN} AND c.idempotency_key=$5"))
        .bind(&p.tenant)
        .bind(&d)
        .bind(&p.subject)
        .bind(manager(&r))
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(CoreError::sql)?
        .ok_or_else(CoreError::not_found)?;
    finish(tx, &p, view(&row)).await
}
async fn list(
    State(s): State<StateData>,
    Path(d): Path<String>,
    h: HeaderMap,
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let q = page(q)?;
    let mut tx = s.db.transaction(&p, &d, false).await?;
    let r = role(&mut tx, &p, &d).await?;
    let fingerprint = q.limit.to_string();
    let w = crate::workspace_paging::open(
        &mut tx,
        &p,
        &d,
        "task-command-receipts",
        &fingerprint,
        q.after.as_deref(),
    )
    .await?;
    let date = w
        .position
        .as_ref()
        .and_then(|v| v["date"].as_str())
        .map(|v| v.parse::<DateTime<Utc>>().map_err(|_| invalid()))
        .transpose()?;
    let id = w
        .position
        .as_ref()
        .and_then(|v| v["id"].as_str())
        .unwrap_or("");
    let rows=sqlx::query(&format!("SELECT {FIELDS} {JOIN} AND ($5::timestamptz IS NULL OR (c.created_at,c.idempotency_key)<($5,$6)) ORDER BY c.created_at DESC,c.idempotency_key DESC LIMIT $7"))
        .bind(&p.tenant).bind(&d).bind(&p.subject).bind(manager(&r)).bind(date).bind(id).bind(q.limit as i64+1).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let total: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM cf_task_commands WHERE tenant_id=$1 AND domain_id=$2 AND actor=$3",
    )
    .bind(&p.tenant)
    .bind(&d)
    .bind(&p.subject)
    .fetch_one(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    let more = rows.len() > q.limit;
    let position = more.then(|| {
        let row = &rows[q.limit - 1];
        json!({"date":row.get::<Value,_>("occurred"),"id":row.get::<String,_>("idempotency_key")})
    });
    let next = crate::workspace_paging::next(
        &mut tx,
        &p,
        &d,
        "task-command-receipts",
        &fingerprint,
        &w,
        position,
    )
    .await?;
    let items: Vec<Value> = rows.iter().take(q.limit).map(view).collect();
    finish(tx,&p,json!({"items":items,"total":total,"next_after":next,"has_more":more,"as_of":w.as_of,"scope":"personal","work_version":w.work,"permissions_version":w.permissions,"sort":"created_at_desc_id_desc","completeness":if more{"partial"}else{"complete"}})).await
}
