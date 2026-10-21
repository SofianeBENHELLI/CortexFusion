//! A factual, bounded work brief. No knowledge-quality score and no inferred priority.
use super::*;

#[derive(Deserialize, Default)]
#[serde(rename_all = "snake_case")]
enum Scope {
    #[default]
    Assigned,
    Domain,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct BriefQuery {
    #[serde(default)]
    scope: Scope,
}
pub(super) async fn read(
    State(s): State<StateData>,
    Path(d): Path<String>,
    headers: HeaderMap,
    q: Result<Query<BriefQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let Query(q) = q.map_err(|_| invalid())?;
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let mut tx = s.db.transaction(&p, &d, false).await?;
    let r = role(&mut tx, &p, &d).await?;
    let domain_scope = matches!(q.scope, Scope::Domain);
    if domain_scope && !manager(&r) {
        return Err(denied());
    }
    let scope = if domain_scope { "domain" } else { "assigned" };
    let window = crate::workspace_paging::open(&mut tx, &p, &d, "work-brief", scope, None).await?;
    let value = snapshot(&mut tx, &p, &d, &r, domain_scope, &window).await?;
    finish(tx, &p, value).await
}
pub(crate) async fn snapshot(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    r: &str,
    domain_scope: bool,
    window: &crate::workspace_paging::Window,
) -> Result<Value, CoreError> {
    let scope = if domain_scope { "domain" } else { "assigned" };
    // All counts and selected rows share the same repeatable-read transaction/time.
    let counts = sqlx::query("SELECT count(*) AS active,count(*) FILTER (WHERE due_at<$5) AS overdue,count(*) FILTER (WHERE status='offered') AS offered,count(*) FILTER (WHERE status='review') AS review,count(*) FILTER (WHERE status='blocked') AS blocked,count(*) FILTER (WHERE status='unassigned') AS unassigned,count(*) FILTER (WHERE status='in_progress') AS in_progress FROM cf_work_tasks WHERE tenant_id=$1 AND domain_id=$2 AND ($3 OR assignee=$4) AND status NOT IN ('completed','cancelled')")
        .bind(&p.tenant).bind(d).bind(domain_scope).bind(&p.subject).bind(window.as_of).fetch_one(&mut **tx).await.map_err(CoreError::sql)?;
    let rows = sqlx::query("SELECT *,to_jsonb(created_at) AS created,to_jsonb(updated_at) AS updated,to_jsonb(due_at) AS due,to_jsonb(offered_at) AS offered,to_jsonb(accepted_at) AS accepted,COALESCE(due_at<$5,false) AS overdue FROM cf_work_tasks WHERE tenant_id=$1 AND domain_id=$2 AND ($3 OR assignee=$4) AND status NOT IN ('completed','cancelled') ORDER BY CASE WHEN due_at<$5 THEN 0 ELSE 1 END,CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,CASE WHEN due_at<$5 THEN 0 WHEN status='review' AND $6 THEN 1 WHEN status='offered' AND assignee=$4 THEN 2 WHEN status='blocked' THEN 3 WHEN status='unassigned' THEN 4 WHEN status='in_progress' THEN 5 ELSE 6 END,due_at ASC NULLS LAST,created_at,id LIMIT 5")
        .bind(&p.tenant).bind(d).bind(domain_scope).bind(&p.subject).bind(window.as_of).bind(manager(r)).fetch_all(&mut **tx).await.map_err(CoreError::sql)?;
    let total = counts.get::<i64, _>("active");
    let items: Vec<Value> = rows
        .iter()
        .map(|row| json!({"task":view(row,p,r),"overdue":row.get::<bool,_>("overdue")}))
        .collect();
    Ok(
        json!({"scope":scope,"role":r,"as_of":window.as_of,"permissions_version":window.permissions,"work_version":window.work,"counts":{"active":total,"overdue":counts.get::<i64,_>("overdue"),"offered":counts.get::<i64,_>("offered"),"review":counts.get::<i64,_>("review"),"blocked":counts.get::<i64,_>("blocked"),"unassigned":counts.get::<i64,_>("unassigned"),"in_progress":counts.get::<i64,_>("in_progress")},"items":items,"has_more":total>rows.len() as i64,"sort":"overdue_priority_review_offer_blocked_unassigned_progress_due_created_id","coverage":"active_tasks_only"}),
    )
}
