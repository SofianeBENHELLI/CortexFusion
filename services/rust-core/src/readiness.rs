//! Public readiness discloses only a boolean status and schema revision.
use crate::{error::CoreError, server::StateData};
use axum::{Json, extract::State};
use serde_json::{Value, json};
use sqlx::Row;
use std::{collections::BTreeSet, time::Duration};
pub const REVISION: &str = "0025";
const TABLES: &str = "cf_collection_sources cf_collections cf_commits cf_companion_responses cf_concepts cf_conversation_episodes cf_conversations cf_domains cf_episodes cf_extractions cf_feedback cf_feedback_preferences cf_feedback_signals cf_files cf_import_items cf_imports cf_issue_events cf_issues cf_mcp_confirmations cf_membership_events cf_memberships cf_model_attempts cf_model_outcomes cf_outbox cf_proposals cf_reviews cf_graph_preparations cf_graph_manifests cf_graph_attempts cf_graph_attempt_events cf_graph_protocols cf_publications cf_source_access_events cf_sources cf_synthesis_attempts cf_synthesis_outcomes cf_tenants";
pub async fn ready(State(s): State<StateData>) -> Result<Json<Value>, CoreError> {
    let result=tokio::time::timeout(Duration::from_secs(2),async {
        s.db.verify_role().await?;
        let mut tx=s.db.pool.begin().await.map_err(CoreError::sql)?;
        sqlx::query("SET LOCAL statement_timeout='1500ms'").execute(&mut *tx).await.map_err(CoreError::sql)?;
        let revisions:Vec<String>=sqlx::query_scalar("SELECT version_num FROM public.alembic_version").fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
        if revisions!=[REVISION]{return Err(CoreError::database());}
        let rows=sqlx::query("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner)=current_user AS owned,has_table_privilege(current_user,c.oid,'SELECT') AS readable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'cf_%'").fetch_all(&mut *tx).await.map_err(CoreError::sql)?;
        let names:BTreeSet<String>=rows.iter().map(|r|r.get("relname")).collect();
        if TABLES.split_whitespace().any(|name|!names.contains(name)) || rows.iter().any(|r|!r.get::<bool,_>("relrowsecurity") || !r.get::<bool,_>("relforcerowsecurity") || r.get::<bool,_>("owned") || !r.get::<bool,_>("readable")){return Err(CoreError::database());}
        tx.commit().await.map_err(CoreError::sql)?;
        Ok::<(),CoreError>(())
    }).await;
    if !matches!(result, Ok(Ok(()))) {
        return Err(CoreError {
            code: "NOT_READY",
            message: "Backend database readiness checks failed",
            status: http::StatusCode::SERVICE_UNAVAILABLE,
        });
    }
    Ok(Json(json!({"status":"ready","schema_revision":REVISION})))
}
