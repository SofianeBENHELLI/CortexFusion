//! Snapshot-bound commands for a personal import. Legacy endpoints share the same
//! mutation helpers, so their changes also invalidate an inspected snapshot.
use super::*;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Command {
    action: String,
    expected_digest: String,
    idempotency_key: String,
    #[serde(default = "one")]
    limit: usize,
}
fn conflict(code: &'static str, message: &'static str) -> CoreError {
    CoreError {
        code,
        message,
        status: StatusCode::CONFLICT,
    }
}
fn digest(value: &Value) -> Result<String, CoreError> {
    crate::canonical::digest(value).map_err(|_| CoreError::database())
}
fn actions(value: &Value) -> Vec<&'static str> {
    if value["status"] == "cancelled" {
        return vec![];
    }
    let items = value["items"].as_array().expect("internal import view");
    let mut result = vec![];
    if items.iter().any(|v| v["status"] == "pending") {
        result.extend(["process", "cancel"]);
    }
    if items.iter().any(|v| v["status"] == "failed") {
        result.push("retry");
    }
    result
}
pub(super) fn routes() -> Router<StateData> {
    Router::new()
        .route(
            "/v1/domains/{domain}/imports/{import_id}/command-state",
            get(inspect),
        )
        .route(
            "/v1/domains/{domain}/imports/{import_id}/commands",
            post(command),
        )
}
async fn inspect(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let mut tx = retrieval::transaction(&s, &p, &d).await?;
    let r = job(&mut tx, &p, &d, &id).await?;
    let role: String = sqlx::query_scalar(
        "SELECT role FROM cf_memberships WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3",
    )
    .bind(&p.tenant)
    .bind(&d)
    .bind(&p.subject)
    .fetch_one(&mut *tx)
    .await
    .map_err(CoreError::sql)?;
    let value = view(&mut tx, &p, &d, &r).await?;
    let allowed = if matches!(role.as_str(), "owner" | "corpus_manager") {
        actions(&value)
    } else {
        vec![]
    };
    let result = json!({"job":value,"digest":digest(&value)?,"allowed_actions":allowed});
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
async fn command(
    State(s): State<StateData>,
    Path((d, id)): Path<(String, String)>,
    h: HeaderMap,
    input: Result<Json<Command>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let d = uuid(&d)?;
    let id = uuid(&id)?;
    let Json(input) = input.map_err(|_| invalid())?;
    if !["process", "cancel", "retry"].contains(&input.action.as_str())
        || !(1..=20).contains(&input.limit)
        || (input.action != "process" && input.limit != 1)
        || !(8..=128).contains(&input.idempotency_key.chars().count())
        || input.expected_digest.len() != 64
        || !input.expected_digest.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err(invalid());
    }
    let hash = digest(&serde_json::to_value(&input).map_err(|_| invalid())?)?;
    let mut tx = write_tx(&s, &p, &d).await?;
    // Recheck the complete current ACL even when recovering an old receipt.
    let r = job(&mut tx, &p, &d, &id).await?;
    if let Some(row)=sqlx::query("SELECT request_hash,receipt FROM cf_import_commands WHERE tenant_id=$1 AND domain_id=$2 AND import_id=$3 AND actor=$4 AND idempotency_key=$5").bind(&p.tenant).bind(&d).bind(&id).bind(&p.subject).bind(&input.idempotency_key).fetch_optional(&mut *tx).await.map_err(CoreError::sql)? {
        if row.get::<String,_>("request_hash")!=hash {return Err(conflict("IDEMPOTENCY_CONFLICT","Import command key reused"));}
        let receipt:Value=row.get("receipt"); p.check_fresh()?; tx.commit().await.map_err(CoreError::sql)?; return Ok(Json(receipt));
    }
    let before = view(&mut tx, &p, &d, &r).await?;
    if digest(&before)? != input.expected_digest {
        return Err(conflict(
            "IMPORT_CHANGED",
            "Import changed; inspect before preparing again",
        ));
    }
    if !actions(&before).contains(&input.action.as_str()) {
        return Err(conflict(
            "IMPORT_ACTION_UNAVAILABLE",
            "No eligible items for this import action",
        ));
    }
    if input.action == "process" {
        process_items(&mut tx, &p, &d, &id, &r, input.limit).await?;
    } else {
        change_items(&mut tx, &p, &d, &id, &r, input.action == "retry").await?;
    }
    let r = job(&mut tx, &p, &d, &id).await?;
    let after = view(&mut tx, &p, &d, &r).await?;
    let affected = before["items"]
        .as_array()
        .unwrap()
        .iter()
        .zip(after["items"].as_array().unwrap())
        .filter(|(a, b)| a != b)
        .count();
    let receipt = json!({"import_id":id,"action":input.action,"before_digest":input.expected_digest,"after_digest":digest(&after)?,"status":after["status"],"affected_items":affected,"idempotency_key":input.idempotency_key});
    sqlx::query("INSERT INTO cf_import_commands(tenant_id,domain_id,import_id,actor,idempotency_key,request_hash,receipt) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(&p.tenant).bind(&d).bind(&id).bind(&p.subject).bind(&input.idempotency_key).bind(hash).bind(&receipt).execute(&mut *tx).await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(receipt))
}
