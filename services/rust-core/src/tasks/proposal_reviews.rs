//! References never confer access. An expert opinion is not an owner decision.
use super::*;
use std::collections::BTreeSet;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Link {
    proposal_id: Uuid,
    expected_task_revision: i64,
    idempotency_key: Uuid,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Opinion {
    proposal_id: Uuid,
    digest: String,
    expected_review_revision: i32,
    expected_task_revision: i64,
    opinion: String,
    justification: String,
    evidence_source_ids: Vec<Uuid>,
    idempotency_key: Uuid,
}
fn admissible(v: &Opinion) -> bool {
    bounded(&v.digest, 128)
        && bounded(&v.justification, 2000)
        && v.expected_review_revision >= 0
        && (1..9_007_199_254_740_991).contains(&v.expected_task_revision)
        && ["supports", "changes_requested", "insufficient_evidence"].contains(&v.opinion.as_str())
        && v.evidence_source_ids.len() <= 20
        && v.evidence_source_ids.iter().collect::<BTreeSet<_>>().len()
            == v.evidence_source_ids.len()
}
pub(super) fn routes() -> Router<StateData> {
    Router::new()
        .route(
            "/v1/domains/{domain}/proposals/{proposal_id}/expert-reviews",
            get(proposal_opinions),
        )
        .route(
            "/v1/domains/{domain}/tasks/{task_id}/proposals",
            get(links).post(link),
        )
        .route(
            "/v1/domains/{domain}/tasks/{task_id}/expert-reviews",
            post(opinion),
        )
        .route(
            "/v1/domains/{domain}/tasks/{task_id}/proposals/{proposal_id}/expert-reviews",
            get(opinions),
        )
}
async fn proposal(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    id: &str,
) -> Result<PgRow, CoreError> {
    let r = crate::proposals::row(tx, p, d, id).await?;
    crate::proposals::check_access_targeted(tx, p, d, &r).await?;
    Ok(r)
}
async fn linked(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    task: &str,
    id: &str,
) -> Result<(), CoreError> {
    let found:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cf_task_proposals WHERE tenant_id=$1 AND domain_id=$2 AND task_id=$3 AND proposal_id=$4)")
      .bind(&p.tenant).bind(d).bind(task).bind(id).fetch_one(&mut **tx).await.map_err(CoreError::sql)?;
    if found {
        Ok(())
    } else {
        Err(CoreError::not_found())
    }
}
async fn advance(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    d: &str,
    task: &PgRow,
    action: &str,
    key: Uuid,
    hash: &str,
) -> Result<Value, CoreError> {
    let id: String = task.get("id");
    let revision: i64 = task.get::<i64, _>("revision") + 1;
    let status: String = task.get("status");
    let assignee: Option<String> = task.get("assignee");
    sqlx::query("UPDATE cf_work_tasks SET revision=$4,updated_at=clock_timestamp() WHERE tenant_id=$1 AND domain_id=$2 AND id=$3")
      .bind(&p.tenant).bind(d).bind(&id).bind(revision).execute(&mut **tx).await.map_err(CoreError::sql)?;
    record(
        tx,
        p,
        d,
        Event {
            task: &id,
            revision,
            action,
            previous: &status,
            status: &status,
            assignee: assignee.as_deref(),
            reason: "",
            result: "",
            key,
            hash,
            planning: None,
        },
    )
    .await
}
async fn links(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let mut tx = s.db.transaction(&p, &d, false).await?;
    let r = role(&mut tx, &p, &d).await?;
    let task = row(&mut tx, &p, &d, &id, &r).await?;
    let rows=sqlx::query("SELECT proposal_id,actor,to_jsonb(created_at) AS created FROM cf_task_proposals WHERE tenant_id=$1 AND domain_id=$2 AND task_id=$3 ORDER BY created_at,proposal_id LIMIT 20")
      .bind(&p.tenant).bind(&d).bind(&id).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let mut items = vec![];
    for link in rows {
        let ident: String = link.get("proposal_id");
        let prop = match proposal(&mut tx, &p, &d, &ident).await {
            Ok(v) => v,
            Err(e) if e.status == StatusCode::NOT_FOUND => continue,
            Err(e) => return Err(e),
        };
        items.push(json!({"proposal_id":ident,"digest":prop.get::<String,_>("digest"),"review_revision":prop.get::<i32,_>("review_revision"),"status":prop.get::<String,_>("status"),"linked_by":link.get::<String,_>("actor"),"linked_at":link.get::<Value,_>("created"),"can_review": task.get::<Option<String>,_>("assignee").as_deref()==Some(&p.subject) && ["in_progress","blocked","review"].contains(&task.get::<&str,_>("status")) && prop.get::<&str,_>("author")!=p.subject && ["ready","deferred","changes_requested"].contains(&prop.get::<&str,_>("status"))}));
    }
    let total = items.len();
    finish(tx,&p,json!({"task_id":id,"task_revision":task.get::<i64,_>("revision"),"items":items,"total":total,"max_links":20,"can_link": !["completed","cancelled"].contains(&task.get::<&str,_>("status")) && (manager(&r) || ["in_progress","blocked","review"].contains(&task.get::<&str,_>("status"))),"as_of":Utc::now()})).await
}
async fn link(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Result<Json<Link>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let Json(v) = body.map_err(|_| invalid())?;
    if !(1..9_007_199_254_740_991).contains(&v.expected_task_revision) {
        return Err(invalid());
    }
    let hash = canonical::digest(&json!({"action":"task_proposals.link","task_id":id,"body":v}))
        .map_err(|_| invalid())?;
    let mut tx =
        s.db.locked_permission_transaction(&p, &d, ROLES, "Task access required")
            .await?;
    if let Some(old) = prior(&mut tx, &p, &d, &v.idempotency_key, &hash).await? {
        return finish(tx, &p, old).await;
    }
    let r = role(&mut tx, &p, &d).await?;
    let task = row(&mut tx, &p, &d, &id, &r).await?;
    if task.get::<i64, _>("revision") != v.expected_task_revision
        || ["completed", "cancelled"].contains(&task.get::<&str, _>("status"))
    {
        return Err(conflict());
    }
    if !manager(&r)
        && !["in_progress", "blocked", "review"].contains(&task.get::<&str, _>("status"))
    {
        return Err(denied());
    }
    let prop_id = v.proposal_id.to_string();
    proposal(&mut tx, &p, &d, &prop_id).await?;
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM cf_task_proposals WHERE tenant_id=$1 AND domain_id=$2 AND task_id=$3",
    )
    .bind(&p.tenant)
    .bind(&d)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    if count >= 20 {
        return Err(conflict());
    }
    match linked(&mut tx, &p, &d, &id, &prop_id).await {
        Ok(()) => return Err(conflict()),
        Err(e) if e.status == StatusCode::NOT_FOUND => {}
        Err(e) => return Err(e),
    }
    let receipt = advance(
        &mut tx,
        &p,
        &d,
        &task,
        "link_proposal",
        v.idempotency_key,
        &hash,
    )
    .await?;
    sqlx::query("INSERT INTO cf_task_proposals(tenant_id,domain_id,task_id,proposal_id,actor,event_id) VALUES($1,$2,$3,$4,$5,$6)")
      .bind(&p.tenant).bind(&d).bind(&id).bind(&prop_id).bind(&p.subject).bind(receipt["event_id"].as_str().ok_or_else(CoreError::database)?).execute(&mut *tx).await.map_err(CoreError::sql)?;
    finish(tx, &p, receipt).await
}
async fn opinion(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Result<Json<Opinion>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let Json(v) = body.map_err(|_| invalid())?;
    if !admissible(&v) {
        return Err(invalid());
    }
    let hash = canonical::digest(&json!({"action":"expert_reviews.submit","task_id":id,"body":v}))
        .map_err(|_| invalid())?;
    let mut tx =
        s.db.locked_permission_transaction(&p, &d, ROLES, "Task access required")
            .await?;
    if let Some(mut old) = prior(&mut tx, &p, &d, &v.idempotency_key, &hash).await? {
        let review:String=sqlx::query_scalar("SELECT id FROM cf_expert_reviews WHERE tenant_id=$1 AND domain_id=$2 AND event_id=$3 AND author=$4")
          .bind(&p.tenant).bind(&d).bind(old["event_id"].as_str().ok_or_else(CoreError::database)?).bind(&p.subject).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
        old["expert_review_id"] = json!(review);
        return finish(tx, &p, old).await;
    }
    let r = role(&mut tx, &p, &d).await?;
    let task = row(&mut tx, &p, &d, &id, &r).await?;
    if task.get::<Option<String>, _>("assignee").as_deref() != Some(&p.subject) {
        return Err(denied());
    }
    if task.get::<i64, _>("revision") != v.expected_task_revision
        || !["in_progress", "blocked", "review"].contains(&task.get::<&str, _>("status"))
    {
        return Err(conflict());
    }
    let prop_id = v.proposal_id.to_string();
    linked(&mut tx, &p, &d, &id, &prop_id).await?;
    let prop = proposal(&mut tx, &p, &d, &prop_id).await?;
    if prop.get::<&str, _>("author") == p.subject {
        return Err(denied());
    }
    if prop.get::<&str, _>("digest") != v.digest
        || prop.get::<i32, _>("review_revision") != v.expected_review_revision
        || !["ready", "deferred", "changes_requested"].contains(&prop.get::<&str, _>("status"))
    {
        return Err(conflict());
    }
    let validation: Value = prop.get("validation");
    let sources = validation["source_ids"]
        .as_array()
        .ok_or_else(CoreError::database)?;
    if v.evidence_source_ids
        .iter()
        .any(|id| !sources.contains(&json!(id.to_string())))
    {
        return Err(invalid());
    }
    let mut receipt = advance(
        &mut tx,
        &p,
        &d,
        &task,
        "expert_review",
        v.idempotency_key,
        &hash,
    )
    .await?;
    let review_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO cf_expert_reviews(tenant_id,domain_id,id,task_id,proposal_id,author,proposal_digest,proposal_review_revision,task_revision,event_id,opinion,justification,evidence_source_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)")
      .bind(&p.tenant).bind(&d).bind(&review_id).bind(&id).bind(&prop_id).bind(&p.subject).bind(&v.digest).bind(v.expected_review_revision).bind(v.expected_task_revision+1).bind(receipt["event_id"].as_str().ok_or_else(CoreError::database)?).bind(&v.opinion).bind(&v.justification).bind(json!(v.evidence_source_ids)).execute(&mut *tx).await.map_err(CoreError::sql)?;
    receipt["expert_review_id"] = json!(review_id);
    finish(tx, &p, receipt).await
}
async fn opinions(
    State(s): State<StateData>,
    Path((d, id, prop_id)): Path<(String, String, String)>,
    headers: HeaderMap,
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    read_opinions(s, d, Some(id), prop_id, headers, page(q)?).await
}
async fn proposal_opinions(
    State(s): State<StateData>,
    Path((d, prop_id)): Path<(String, String)>,
    headers: HeaderMap,
    q: Result<Query<Page>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    read_opinions(s, d, None, prop_id, headers, page(q)?).await
}
async fn read_opinions(
    s: StateData,
    d: String,
    id: Option<String>,
    prop_id: String,
    headers: HeaderMap,
    q: Page,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let d = uuid(&d)?;
    let id = id.as_deref().map(uuid).transpose()?;
    let prop_id = uuid(&prop_id)?;
    let mut tx = s.db.transaction(&p, &d, false).await?;
    let r = role(&mut tx, &p, &d).await?;
    if let Some(id) = &id {
        row(&mut tx, &p, &d, id, &r).await?;
        linked(&mut tx, &p, &d, id, &prop_id).await?;
    }
    let prop = proposal(&mut tx, &p, &d, &prop_id).await?;
    let digest: String = prop.get("digest");
    let revision: i32 = prop.get("review_revision");
    let fingerprint = format!(
        "{}:{prop_id}:{digest}:{revision}:{r}:{}",
        id.as_deref().unwrap_or("*"),
        q.limit
    );
    let window = crate::workspace_paging::open(
        &mut tx,
        &p,
        &d,
        "expert-reviews",
        &fingerprint,
        q.after.as_deref(),
    )
    .await?;
    let date = window
        .position
        .as_ref()
        .and_then(|v| v["date"].as_str())
        .map(|v| v.parse::<DateTime<Utc>>().map_err(|_| invalid()))
        .transpose()?;
    let cursor = window
        .position
        .as_ref()
        .and_then(|v| v["id"].as_str())
        .unwrap_or("");
    let rows=sqlx::query("SELECT e.*,to_jsonb(e.created_at) AS created FROM cf_expert_reviews e JOIN cf_work_tasks t ON (t.tenant_id,t.domain_id,t.id)=(e.tenant_id,e.domain_id,e.task_id) WHERE e.tenant_id=$1 AND e.domain_id=$2 AND ($3::text IS NULL OR e.task_id=$3) AND e.proposal_id=$4 AND ($8 OR t.assignee=$9) AND ($5::timestamptz IS NULL OR (e.created_at,e.id)>($5,$6)) ORDER BY e.created_at,e.id LIMIT $7")
      .bind(&p.tenant).bind(&d).bind(&id).bind(&prop_id).bind(date).bind(cursor).bind(q.limit as i64+1).bind(manager(&r)).bind(&p.subject).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    let total:i64=sqlx::query_scalar("SELECT count(*) FROM cf_expert_reviews e JOIN cf_work_tasks t ON (t.tenant_id,t.domain_id,t.id)=(e.tenant_id,e.domain_id,e.task_id) WHERE e.tenant_id=$1 AND e.domain_id=$2 AND ($3::text IS NULL OR e.task_id=$3) AND e.proposal_id=$4 AND ($5 OR t.assignee=$6)")
      .bind(&p.tenant).bind(&d).bind(&id).bind(&prop_id).bind(manager(&r)).bind(&p.subject).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    let more = rows.len() > q.limit;
    let position=more.then(||json!({"date":rows[q.limit-1].get::<Value,_>("created"),"id":rows[q.limit-1].get::<String,_>("id")}));
    let next = crate::workspace_paging::next(
        &mut tx,
        &p,
        &d,
        "expert-reviews",
        &fingerprint,
        &window,
        position,
    )
    .await?;
    let items:Vec<Value>=rows.iter().take(q.limit).map(|v|json!({"id":v.get::<String,_>("id"),"task_id":v.get::<String,_>("task_id"),"proposal_id":prop_id,"author":v.get::<String,_>("author"),"proposal_digest":v.get::<String,_>("proposal_digest"),"proposal_review_revision":v.get::<i32,_>("proposal_review_revision"),"task_revision":v.get::<i64,_>("task_revision"),"opinion":v.get::<String,_>("opinion"),"justification":v.get::<String,_>("justification"),"evidence_source_ids":v.get::<Value,_>("evidence_source_ids"),"created_at":v.get::<Value,_>("created"),"validity":if v.get::<&str,_>("proposal_digest")==digest && v.get::<i32,_>("proposal_review_revision")==revision {"current"}else{"stale"}})).collect();
    let mut result = json!({"proposal_id":prop_id,"items":items,"total":total,"next_after":next,"has_more":more,"as_of":window.as_of,"permissions_version":window.permissions,"work_version":window.work});
    if let Some(id) = id {
        result["task_id"] = json!(id);
    } else {
        result["proposal_digest"] = json!(digest);
        result["proposal_review_revision"] = json!(revision);
    }
    finish(tx, &p, result).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_opinion_bounds_and_unknown_fields() {
        let mut value = json!({"proposal_id":Uuid::new_v4(),"digest":"hash","expected_review_revision":0,"expected_task_revision":1,"opinion":"supports","justification":"Avis synthétique","evidence_source_ids":[],"idempotency_key":Uuid::new_v4()});
        assert!(admissible(&serde_json::from_value(value.clone()).unwrap()));
        value["opinion"] = json!("approve");
        assert!(!admissible(&serde_json::from_value(value.clone()).unwrap()));
        value["author"] = json!("forged");
        assert!(serde_json::from_value::<Opinion>(value).is_err());
    }
}
