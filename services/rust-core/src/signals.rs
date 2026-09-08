//! Personal declared feedback provenance; observed/inferred collection is opt-in.
use crate::{auth::Principal, error::CoreError, retrieval, server::StateData};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, post},
};
use http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction, postgres::PgRow};
use uuid::Uuid;
fn invalid() -> CoreError {
    CoreError {
        code: "VALIDATION_FAILED",
        message: "Arguments do not match the action contract",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn conflict(code: &'static str, message: &'static str) -> CoreError {
    CoreError {
        code,
        message,
        status: StatusCode::CONFLICT,
    }
}
fn uuid(s: &str) -> Result<String, CoreError> {
    Uuid::parse_str(s)
        .map(|v| v.to_string())
        .map_err(|_| CoreError::invalid_uuid())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PreferencesInput {
    allow_observed: bool,
    allow_inferred: bool,
    expected_revision: i64,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SignalInput {
    companion_response_id: Option<Uuid>,
    origin: String,
    kind: String,
    #[serde(default)]
    comment: String,
    companion: String,
    confidence: Option<f64>,
    sentiment: Option<String>,
    iteration_index: Option<i64>,
    idempotency_key: String,
}
impl SignalInput {
    fn validate(&self) -> Result<(), CoreError> {
        let allowed: &[&str] = match self.origin.as_str() {
            "explicit" => &["thumbs_up", "thumbs_down", "comment", "resolved"],
            "observed" => &["reformulation", "correction", "abandon", "resolved"],
            "inferred" => &["satisfaction"],
            _ => return Err(invalid()),
        };
        let blank = self
            .comment
            .trim_matches(|c: char| c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c))
            .is_empty();
        if !allowed.contains(&self.kind.as_str())
            || self.comment.chars().count() > 2000
            || !(1..=100).contains(&self.companion.chars().count())
            || !(8..=128).contains(&self.idempotency_key.chars().count())
            || self
                .confidence
                .is_some_and(|v| !v.is_finite() || !(0.0..=1.0).contains(&v))
            || self
                .sentiment
                .as_deref()
                .is_some_and(|v| !["positive", "negative", "neutral"].contains(&v))
            || self
                .iteration_index
                .is_some_and(|v| !(1..=10000).contains(&v) || self.origin != "observed")
            || (self.kind == "comment" && blank)
        {
            return Err(invalid());
        }
        if self.origin == "inferred" {
            if self.confidence.is_none() || self.sentiment.is_none() || blank {
                return Err(invalid());
            }
        } else if self.confidence.is_some() || self.sentiment.is_some() {
            return Err(invalid());
        }
        Ok(())
    }
}
fn twenty() -> usize {
    20
}
#[derive(Deserialize)]
struct PageInput {
    #[serde(default = "twenty")]
    limit: usize,
    after: Option<Uuid>,
    episode_id: Option<Uuid>,
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route(
            "/v1/domains/{domain}/feedback-preferences",
            get(preferences).put(configure),
        )
        .route(
            "/v1/domains/{domain}/episodes/{episode_id}/signals",
            post(record),
        )
        .route("/v1/domains/{domain}/feedback-signals", get(list))
        .route("/v1/domains/{domain}/feedback-summary", get(summary))
}
async fn prefs(
    tx: &mut Transaction<'_, Postgres>,
    p: &Principal,
    domain: &str,
) -> Result<Value, CoreError> {
    let r=sqlx::query("SELECT allow_observed,allow_inferred,revision FROM cf_feedback_preferences WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3").bind(&p.tenant).bind(domain).bind(&p.subject).fetch_optional(&mut **tx).await.map_err(CoreError::sql)?;
    Ok(match r {
        Some(r) => {
            json!({"allow_observed":r.get::<bool,_>("allow_observed"),"allow_inferred":r.get::<bool,_>("allow_inferred"),"revision":r.get::<i64,_>("revision")})
        }
        None => json!({"allow_observed":false,"allow_inferred":false,"revision":0}),
    })
}
async fn preferences(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let mut tx = retrieval::transaction(&s, &p, &domain).await?;
    let value = prefs(&mut tx, &p, &domain).await?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(value))
}
async fn configure(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
    axum::extract::RawQuery(query): axum::extract::RawQuery,
    proof: Option<axum::Extension<crate::confirmation::ConfirmedAction>>,
    body: axum::body::Bytes,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let action = "feedback.configure";
    let raw = serde_json::from_slice::<Value>(&body);
    let args = json!({"path":{"domain":domain},"body":raw.as_ref().unwrap_or(&Value::Null)});
    let outcome:Result<Value,CoreError>=async{let p=s.auth.authenticate(&headers)?;let domain=uuid(&domain)?;let input:PreferencesInput=serde_json::from_value(raw.map_err(|_|invalid())?).map_err(|_|invalid())?;if input.expected_revision<0 || query.is_some_and(|q|!q.is_empty()){return Err(invalid());}
        let tx=retrieval::transaction(&s,&p,&domain).await?;tx.commit().await.map_err(CoreError::sql)?;
        if !proof.as_ref().is_some_and(|v|v.subject==p.subject && v.tenant==p.tenant && v.action==action){if headers.get_all("x-cortex-confirmation").iter().count()>1{return Err(invalid());}s.confirmation.as_ref().ok_or_else(crate::confirmation::required)?.consume(&p,&domain,action,&args,headers.get("x-cortex-confirmation").and_then(|v|v.to_str().ok())).await?;}
        let mut tx=retrieval::transaction(&s,&p,&domain).await?;let current=prefs(&mut tx,&p,&domain).await?;if current["revision"].as_i64()!=Some(input.expected_revision){return Err(conflict("STALE_PREFERENCES","Refresh feedback collection preferences"));}
        let revision=input.expected_revision.checked_add(1).ok_or_else(CoreError::database)?;
        sqlx::query("INSERT INTO cf_feedback_preferences(tenant_id,domain_id,subject,allow_observed,allow_inferred,revision) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,domain_id,subject) DO UPDATE SET allow_observed=EXCLUDED.allow_observed,allow_inferred=EXCLUDED.allow_inferred,revision=EXCLUDED.revision").bind(&p.tenant).bind(&domain).bind(&p.subject).bind(input.allow_observed).bind(input.allow_inferred).bind(revision).execute(&mut *tx).await.map_err(CoreError::sql)?;
        sqlx::query("UPDATE cf_domains SET accepted_version=accepted_version WHERE tenant_id=$1 AND id=$2").bind(&p.tenant).bind(&domain).execute(&mut *tx).await.map_err(CoreError::sql)?;
        p.check_fresh()?;tx.commit().await.map_err(CoreError::sql)?;Ok(json!({"allow_observed":input.allow_observed,"allow_inferred":input.allow_inferred,"revision":revision}))
    }.await;
    match outcome{Ok(v)=>Json(v).into_response(),Err(e) if e.code=="CONFIRMATION_REQUIRED"=>(e.status,Json(json!({"error":e.code,"message":e.message,"confirmation_request":{"action":action,"command_hash":crate::confirmation::command_hash(action,&args).unwrap_or_default(),"transport_header":"X-Cortex-Confirmation","max_lifetime_seconds":300}}))).into_response(),Err(e)=>e.into_response()}
}
fn signal_view(r: &PgRow, episode: &PgRow) -> Value {
    let mut signal: Value = r.get("payload");
    if signal.get("companion_response_id").is_none() {
        signal["companion_response_id"] = Value::Null;
    }
    json!({"id":r.get::<String,_>("id"),"episode_id":r.get::<String,_>("episode_id"),"served_version":episode.get::<i64,_>("served_version"),"source_ids":episode.get::<Value,_>("source_ids"),"signal":signal,"created_at":r.get::<Value,_>("created")})
}
async fn record(
    State(s): State<StateData>,
    Path((domain, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<(StatusCode, Json<Value>), CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let id = uuid(&id)?;
    let Json(raw) = body.map_err(|_| invalid())?;
    let input: SignalInput = serde_json::from_value(raw).map_err(|_| invalid())?;
    input.validate()?;
    let mut tx = retrieval::transaction(&s, &p, &domain).await?;
    let sources = retrieval::accessible(&mut tx, &p, &domain).await?;
    let episode = retrieval::episode_row(&mut tx, &p, &domain, &id, &sources).await?;
    if let Some(response) = input.companion_response_id {
        let found:Option<String>=sqlx::query_scalar("SELECT id FROM cf_companion_responses WHERE tenant_id=$1 AND domain_id=$2 AND id=$3 AND subject=$4 AND episode_id=$5").bind(&p.tenant).bind(&domain).bind(response.to_string()).bind(&p.subject).bind(&id).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
        if found.is_none() {
            return Err(CoreError {
                code: "NOT_FOUND",
                message: "Companion response not found",
                status: StatusCode::NOT_FOUND,
            });
        }
    }
    let mut payload = serde_json::to_value(&input).map_err(|_| invalid())?;
    if input.companion_response_id.is_none() {
        payload
            .as_object_mut()
            .ok_or_else(invalid)?
            .remove("companion_response_id");
    }
    let mut fingerprint = payload.clone();
    fingerprint["episode_id"] = json!(id);
    let fingerprint = crate::canonical::digest(&fingerprint).map_err(|_| invalid())?;
    let old=sqlx::query("SELECT *,to_jsonb(created_at) AS created FROM cf_feedback_signals WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND idempotency_key=$4").bind(&p.tenant).bind(&domain).bind(&p.subject).bind(&input.idempotency_key).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
    if let Some(r) = old {
        if r.get::<&str, _>("request_hash") != fingerprint {
            return Err(conflict(
                "IDEMPOTENCY_CONFLICT",
                "Feedback signal key reused",
            ));
        }
        p.check_fresh()?;
        return Ok((StatusCode::CREATED, Json(signal_view(&r, &episode))));
    }
    let preferences = prefs(&mut tx, &p, &domain).await?;
    if input.origin != "explicit"
        && preferences[format!("allow_{}", input.origin)].as_bool() != Some(true)
    {
        return Err(CoreError {
            code: "COLLECTION_DISABLED",
            message: "This automatic feedback origin is disabled for this user",
            status: StatusCode::FORBIDDEN,
        });
    }
    let signal_id = Uuid::new_v4().to_string();
    let r=sqlx::query("INSERT INTO cf_feedback_signals(tenant_id,domain_id,id,subject,episode_id,origin,kind,payload,idempotency_key,request_hash,companion_response_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *,to_jsonb(created_at) AS created").bind(&p.tenant).bind(&domain).bind(signal_id).bind(&p.subject).bind(&id).bind(&input.origin).bind(&input.kind).bind(payload).bind(&input.idempotency_key).bind(fingerprint).bind(input.companion_response_id.map(|v|v.to_string())).fetch_one(&mut *tx).await.map_err(CoreError::sql)?;
    if input.origin == "explicit" && input.kind == "thumbs_down" {
        retrieval::issue(
            &mut tx,
            &p,
            &domain,
            &id,
            "disputed_answer",
            if input.comment.is_empty() {
                "Explicit negative feedback"
            } else {
                &input.comment
            },
        )
        .await?;
    }
    let value = signal_view(&r, &episode);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok((StatusCode::CREATED, Json(value)))
}
async fn list(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
    input: Result<Query<PageInput>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let Query(input) = input.map_err(|_| invalid())?;
    if !(1..=100).contains(&input.limit) {
        return Err(invalid());
    }
    let mut tx = retrieval::transaction(&s, &p, &domain).await?;
    let sources = retrieval::accessible(&mut tx, &p, &domain).await?;
    if let Some(id) = input.episode_id {
        retrieval::episode_row(&mut tx, &p, &domain, &id.to_string(), &sources).await?;
    }
    let mut cursor = input.after.map(|v| v.to_string()).unwrap_or_default();
    let mut items = Vec::new();
    while items.len() <= input.limit {
        let rows=sqlx::query("SELECT *,to_jsonb(created_at) AS created FROM cf_feedback_signals WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND id>$4 AND ($5='' OR episode_id=$5) ORDER BY id LIMIT 100").bind(&p.tenant).bind(&domain).bind(&p.subject).bind(&cursor).bind(input.episode_id.map(|v|v.to_string()).unwrap_or_default()).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
        let count = rows.len();
        if count == 0 {
            break;
        }
        for r in rows {
            cursor = r.get("id");
            match retrieval::episode_row(&mut tx, &p, &domain, r.get("episode_id"), &sources).await
            {
                Ok(e) => items.push(signal_view(&r, &e)),
                Err(e) if e.status == StatusCode::NOT_FOUND => continue,
                Err(e) => return Err(e),
            }
            if items.len() > input.limit {
                break;
            }
        }
        if count < 100 {
            break;
        }
    }
    let next = if items.len() > input.limit {
        items[input.limit - 1]["id"].clone()
    } else {
        Value::Null
    };
    items.truncate(input.limit);
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(json!({"items":items,"next_after":next})))
}

#[derive(Deserialize)]
struct SummaryInput {
    since: Option<chrono::DateTime<chrono::FixedOffset>>,
    until: Option<chrono::DateTime<chrono::FixedOffset>>,
    conversation_id: Option<Uuid>,
    companion_response_id: Option<Uuid>,
}
async fn summary(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    headers: HeaderMap,
    input: Result<Query<SummaryInput>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, CoreError> {
    use std::collections::BTreeSet;
    let p = s.auth.authenticate(&headers)?;
    let domain = uuid(&domain)?;
    let Query(input) = input.map_err(|_| invalid())?;
    let end = input
        .until
        .unwrap_or_else(|| chrono::Utc::now().fixed_offset());
    let start = input.since.map(Ok).unwrap_or_else(|| {
        end.checked_sub_signed(chrono::Duration::days(30))
            .ok_or_else(invalid)
    })?;
    if !(1..=9999).contains(&chrono::Datelike::year(&start))
        || !(1..=9999).contains(&chrono::Datelike::year(&end))
    {
        return Err(invalid());
    }
    let duration = end - start;
    if duration <= chrono::Duration::zero() || duration > chrono::Duration::days(31) {
        return Err(CoreError {
            code: "INVALID_WINDOW",
            message: "Use an aware, increasing time window of at most 31 days",
            status: StatusCode::UNPROCESSABLE_ENTITY,
        });
    }
    let mut tx = retrieval::transaction(&s, &p, &domain).await?;
    if let Some(id) = input.conversation_id {
        let found:Option<String>=sqlx::query_scalar("SELECT id FROM cf_conversations WHERE tenant_id=$1 AND domain_id=$2 AND author=$3 AND id=$4").bind(&p.tenant).bind(&domain).bind(&p.subject).bind(id.to_string()).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
        if found.is_none() {
            return Err(CoreError {
                code: "NOT_FOUND",
                message: "Conversation not found",
                status: StatusCode::NOT_FOUND,
            });
        }
    }
    if let Some(id) = input.companion_response_id {
        let episode:Option<String>=sqlx::query_scalar("SELECT episode_id FROM cf_companion_responses WHERE tenant_id=$1 AND domain_id=$2 AND subject=$3 AND id=$4").bind(&p.tenant).bind(&domain).bind(&p.subject).bind(id.to_string()).fetch_optional(&mut *tx).await.map_err(CoreError::sql)?;
        let episode = episode.ok_or(CoreError {
            code: "NOT_FOUND",
            message: "Companion response not found",
            status: StatusCode::NOT_FOUND,
        })?;
        let sources = retrieval::accessible(&mut tx, &p, &domain).await?;
        retrieval::episode_row(&mut tx, &p, &domain, &episode, &sources).await?;
    }
    let rows=sqlx::query("SELECT s.episode_id,s.origin,s.kind,s.payload FROM cf_feedback_signals s JOIN cf_episodes e ON e.tenant_id=s.tenant_id AND e.domain_id=s.domain_id AND e.id=s.episode_id WHERE s.tenant_id=$1 AND s.domain_id=$2 AND s.subject=$3 AND e.subject=$3 AND s.created_at >= $4 AND s.created_at < $5 AND ($6='' OR s.companion_response_id=$6) AND ($7='' OR EXISTS(SELECT 1 FROM cf_conversation_episodes m WHERE m.tenant_id=s.tenant_id AND m.domain_id=s.domain_id AND m.episode_id=s.episode_id AND m.conversation_id=$7)) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(e.source_ids) refs(id) LEFT JOIN cf_sources src ON src.tenant_id=s.tenant_id AND src.domain_id=s.domain_id AND src.id=refs.id WHERE src.id IS NULL OR NOT(src.allowed_subjects ? $3)) ORDER BY s.created_at,s.id LIMIT 10001")
        .bind(&p.tenant).bind(&domain).bind(&p.subject).bind(start).bind(end).bind(input.companion_response_id.map(|v|v.to_string()).unwrap_or_default()).bind(input.conversation_id.map(|v|v.to_string()).unwrap_or_default()).fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
    if rows.len() > 10000 {
        return Err(CoreError {
            code: "SUMMARY_TOO_LARGE",
            message: "Narrow the time window or select a conversation; no partial summary was returned",
            status: StatusCode::PAYLOAD_TOO_LARGE,
        });
    }
    let mut explicit = json!({"thumbs_up":0,"thumbs_down":0,"comment":0,"resolved":0});
    let mut observed = json!({"reformulation":0,"correction":0,"abandon":0,"resolved":0});
    let mut inferred = json!({"positive":0,"negative":0,"neutral":0});
    let mut episodes = BTreeSet::new();
    let mut up = BTreeSet::new();
    let mut down = BTreeSet::new();
    let mut iterations = Vec::new();
    for row in &rows {
        let episode: String = row.get("episode_id");
        episodes.insert(episode.clone());
        let origin: &str = row.get("origin");
        let kind: &str = row.get("kind");
        let payload: Value = row.get("payload");
        match origin {
            "explicit" => {
                increment(&mut explicit, kind)?;
                if kind == "thumbs_up" {
                    up.insert(episode);
                } else if kind == "thumbs_down" {
                    down.insert(episode);
                }
            }
            "observed" => {
                increment(&mut observed, kind)?;
                if let Some(index) = payload["iteration_index"].as_i64() {
                    iterations.push(index);
                }
            }
            "inferred" => increment(
                &mut inferred,
                payload["sentiment"]
                    .as_str()
                    .ok_or_else(CoreError::database)?,
            )?,
            _ => return Err(CoreError::database()),
        }
    }
    observed["iteration_index_samples"] = json!(iterations.len());
    observed["maximum_declared_iteration"] = json!(iterations.iter().max());
    let result = json!({"window_start":start,"window_end":end,"conversation_id":input.conversation_id,"companion_response_id":input.companion_response_id,"signal_count":rows.len(),"episode_count":episodes.len(),"conflicting_explicit_episodes":up.intersection(&down).count(),"explicit":explicit,"observed":observed,"inferred":inferred,"legacy_feedback_included":false,"interpretation":"Counts describe accepted signal events, not unique opinions or calibrated satisfaction. Iteration indices are companion declarations, not measured attempts to solve a task. No signal does not imply satisfaction. Legacy feedback is excluded."});
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    Ok(Json(result))
}
fn increment(counts: &mut Value, key: &str) -> Result<(), CoreError> {
    let v = counts.get_mut(key).ok_or_else(CoreError::database)?;
    *v = json!(v.as_u64().ok_or_else(CoreError::database)? + 1);
    Ok(())
}
