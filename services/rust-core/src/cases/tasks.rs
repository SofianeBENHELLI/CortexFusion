//! A reference transfers no content and confers no task/case permission.
use super::*;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Link {
    action: String,
    task_id: Uuid,
    expected_case_revision: i64,
    expected_task_revision: i64,
    idempotency_key: Uuid,
}
pub(super) fn routes() -> Router<StateData> {
    Router::new().route(
        "/v1/domains/{domain}/shared-cases/{case_id}/tasks",
        get(read).post(command),
    )
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
    let case = row(&mut tx, &p, &d, &id, &r).await?;
    let author = case.get::<String, _>("author") == p.subject;
    let withdrawn = case.get::<&str, _>("status") == "withdrawn";
    // A withdrawn recipient sees no association metadata. The declarant sees only a count.
    if withdrawn && !author {
        return Err(CoreError::not_found());
    }
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM cf_case_tasks WHERE tenant_id=$1 AND domain_id=$2 AND case_id=$3 AND active")
      .bind(&p.tenant).bind(&d).bind(&id).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    let mut items = vec![];
    if !author {
        let rows=sqlx::query("SELECT t.id,t.title,t.status,t.revision,to_jsonb(l.updated_at) AS linked FROM cf_case_tasks l JOIN cf_work_tasks t ON t.tenant_id=l.tenant_id AND t.domain_id=l.domain_id AND t.id=l.task_id WHERE l.tenant_id=$1 AND l.domain_id=$2 AND l.case_id=$3 AND l.active ORDER BY l.created_at,l.task_id LIMIT 20")
          .bind(&p.tenant).bind(&d).bind(&id).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
        for t in rows {
            items.push(json!({"task_id":t.get::<String,_>("id"),"title":t.get::<String,_>("title"),"status":t.get::<String,_>("status"),"revision":t.get::<i64,_>("revision"),"linked_at":t.get::<Value,_>("linked")}));
        }
    }
    finish(tx,&p,json!({"case_id":id,"case_revision":case.get::<i64,_>("revision"),"audience":if author{"declarant"}else{"team"},"items":items,"linked_count":count,"max_links":20,"can_link":!author && ["new","qualified"].contains(&case.get::<&str,_>("status")),"can_unlink":!author && !withdrawn,"as_of":chrono::Utc::now()})).await
}
async fn command(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Result<Json<Link>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let Json(v) = body.map_err(|_| invalid())?;
    if !["link", "unlink"].contains(&v.action.as_str())
        || !(1..9_007_199_254_740_991).contains(&v.expected_case_revision)
        || !(1..9_007_199_254_740_991).contains(&v.expected_task_revision)
    {
        return Err(invalid());
    }
    let hash = canonical::digest(&json!({"action":"case_tasks.command","case_id":id,"body":v}))
        .map_err(|_| invalid())?;
    let mut tx =
        s.db.locked_permission_transaction(
            &p,
            &d,
            &["owner", "corpus_manager"],
            "Case and task coordination required",
        )
        .await?;
    let r = role(&mut tx, &p, &d).await?;
    let case = row(&mut tx, &p, &d, &id, &r).await?;
    // Even recovery requires current recipient access, not merely coordinator role.
    if case.get::<&str, _>("author") == p.subject || case.get::<&str, _>("status") == "withdrawn" {
        return Err(CoreError::not_found());
    }
    let task = sqlx::query(
        "SELECT revision,status FROM cf_work_tasks WHERE tenant_id=$1 AND domain_id=$2 AND id=$3",
    )
    .bind(&p.tenant)
    .bind(&d)
    .bind(v.task_id.to_string())
    .fetch_optional(&mut *tx)
    .await
    .map_err(CoreError::sql)?
    .ok_or_else(CoreError::not_found)?;
    if let Some(old) = prior(&mut tx, &p, &d, &v.idempotency_key, &hash).await? {
        return finish(tx, &p, old).await;
    }
    if case.get::<i64, _>("revision") != v.expected_case_revision
        || task.get::<i64, _>("revision") != v.expected_task_revision
    {
        return Err(changed());
    }
    let active:Option<bool>=sqlx::query_scalar("SELECT active FROM cf_case_tasks WHERE tenant_id=$1 AND domain_id=$2 AND case_id=$3 AND task_id=$4")
      .bind(&p.tenant).bind(&d).bind(&id).bind(v.task_id.to_string()).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    let linking = v.action == "link";
    if linking {
        if active == Some(true)
            || !["new", "qualified"].contains(&case.get::<&str, _>("status"))
            || ["completed", "cancelled"].contains(&task.get::<&str, _>("status"))
        {
            return Err(changed());
        }
        let count:i64=sqlx::query_scalar("SELECT count(*) FROM cf_case_tasks WHERE tenant_id=$1 AND domain_id=$2 AND case_id=$3 AND active")
        .bind(&p.tenant).bind(&d).bind(&id).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
        if count >= 20 {
            return Err(CoreError {
                code: "CASE_TASK_LIMIT",
                message: "At most twenty active task references per case",
                status: StatusCode::CONFLICT,
            });
        }
    } else if active != Some(true) {
        return Err(changed());
    }
    let revision = v.expected_case_revision + 1;
    let status: String = case.get("status");
    sqlx::query("UPDATE cf_shared_cases SET revision=$4,updated_at=clock_timestamp() WHERE tenant_id=$1 AND domain_id=$2 AND id=$3")
      .bind(&p.tenant).bind(&d).bind(&id).bind(revision).execute(&mut *tx).await.map_err(CoreError::sql)?;
    let target = v.task_id.to_string();
    let out = record_with_task(
        &mut tx,
        &p,
        &d,
        &id,
        revision,
        &status,
        if linking { "link_task" } else { "unlink_task" },
        &v.idempotency_key,
        &hash,
        Some(&target),
    )
    .await?;
    sqlx::query("INSERT INTO cf_case_tasks(tenant_id,domain_id,case_id,task_id,active,event_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,domain_id,case_id,task_id) DO UPDATE SET active=EXCLUDED.active,event_id=EXCLUDED.event_id,updated_at=clock_timestamp()")
      .bind(&p.tenant).bind(&d).bind(&id).bind(v.task_id.to_string()).bind(linking).bind(out["event_id"].as_str().ok_or_else(invalid)?).execute(&mut *tx).await.map_err(CoreError::sql)?;
    finish(tx, &p, out).await
}
