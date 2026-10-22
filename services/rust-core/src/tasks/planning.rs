//! Explicit coordinator scheduling; never changes state, assignee or completion.
use super::*;
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Plan {
    expected_revision: i64,
    priority: String,
    // Value rather than Option: omitted is invalid; null explicitly removes a deadline.
    due_at: Value,
    reason: String,
    idempotency_key: Uuid,
}
pub(super) fn routes() -> Router<StateData> {
    Router::new().route("/v1/domains/{domain}/tasks/{task_id}/plan", post(write))
}
async fn write(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
    input: Result<Json<Plan>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let Json(v) = input.map_err(|_| invalid())?;
    if !(1..9_007_199_254_740_991).contains(&v.expected_revision)
        || !bounded(&v.reason, 2000)
        || !["low", "normal", "high"].contains(&v.priority.as_str())
    {
        return Err(invalid());
    }
    let due: Option<DateTime<Utc>> = if v.due_at.is_null() {
        None
    } else {
        Some(
            v.due_at
                .as_str()
                .ok_or_else(invalid)?
                .parse()
                .map_err(|_| invalid())?,
        )
    };
    if due.is_some_and(|d| !(1..=9999).contains(&chrono::Datelike::year(&d))) {
        return Err(invalid());
    }
    let hash = canonical::digest(&json!({"action":"tasks.plan","task_id":id,"body":v}))
        .map_err(|_| invalid())?;
    let mut tx =
        s.db.locked_permission_transaction(
            &p,
            &d,
            &["owner", "corpus_manager"],
            "Task coordination permission required",
        )
        .await?;
    let r = role(&mut tx, &p, &d).await?;
    // Unlike a previous role, current coordination rights are required even for receipt recovery.
    if let Some(old) = prior(&mut tx, &p, &d, &v.idempotency_key, &hash).await? {
        return finish(tx, &p, old).await;
    }
    let current = row(&mut tx, &p, &d, &id, &r).await?;
    let status = current.get::<String, _>("status");
    if current.get::<i64, _>("revision") != v.expected_revision
        || matches!(status.as_str(), "completed" | "cancelled")
    {
        return Err(conflict());
    }
    let old_due = current.get::<Option<DateTime<Utc>>, _>("due_at");
    if current.get::<String, _>("priority") == v.priority && old_due == due {
        return Err(CoreError {
            code: "TASK_PLAN_UNCHANGED",
            message: "Change priority or deadline before confirming a new plan",
            status: StatusCode::CONFLICT,
        });
    }
    let planning = json!({"before":{"priority":current.get::<String,_>("priority"),"due_at":old_due},"after":{"priority":v.priority,"due_at":due}});
    let revision = v.expected_revision + 1;
    sqlx::query("UPDATE cf_work_tasks SET priority=$4,priority_reason=$5,due_at=$6,revision=$7,updated_at=clock_timestamp() WHERE tenant_id=$1 AND domain_id=$2 AND id=$3")
        .bind(&p.tenant).bind(&d).bind(&id).bind(&v.priority).bind(&v.reason).bind(due).bind(revision).execute(&mut *tx).await.map_err(CoreError::sql)?;
    let out = record(
        &mut tx,
        &p,
        &d,
        Event {
            task: &id,
            revision,
            action: "plan",
            previous: &status,
            status: &status,
            assignee: current.get::<Option<String>, _>("assignee").as_deref(),
            reason: &v.reason,
            result: current.get::<&str, _>("result_summary"),
            key: v.idempotency_key,
            hash: &hash,
            planning: Some(planning),
        },
    )
    .await?;
    finish(tx, &p, out).await
}
