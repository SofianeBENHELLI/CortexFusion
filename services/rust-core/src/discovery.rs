//! Machine-readable native contract inventory, filtered from the shared reference.
use crate::{error::CoreError, server::StateData};
use axum::{Json, Router, extract::State, routing::get};
use http::HeaderMap;
use serde_json::{Value, json};
fn native(action: &str) -> bool {
    crate::mcp::NATIVE.contains(&format!("api_{}", action.replace('.', "_")).as_str())
}
pub fn catalog() -> Result<Value, CoreError> {
    let mut v: Value = serde_json::from_str(include_str!(
        "../../../packages/contracts/interactions.json"
    ))
    .map_err(|_| CoreError::database())?;
    v["items"]
        .as_array_mut()
        .ok_or_else(CoreError::database)?
        .retain(|item| item["operation_id"].as_str().is_some_and(native));
    Ok(v)
}
fn schema() -> Result<Value, CoreError> {
    let mut v: Value =
        serde_json::from_str(include_str!("../../../packages/contracts/openapi.json"))
            .map_err(|_| CoreError::database())?;
    let paths = v["paths"].as_object_mut().ok_or_else(CoreError::database)?;
    paths.retain(|_, ops| {
        if let Some(ops) = ops.as_object_mut() {
            ops.retain(|_, op| op["operationId"].as_str().is_some_and(native));
            !ops.is_empty()
        } else {
            false
        }
    });
    v["info"]["description"] = json!(
        "CortexFusion native Rust migration candidate. Only implemented operations are listed. Historical schemas are preserved; some detailed validation error shapes differ. No frontend or paid model provider is included in this candidate."
    );
    Ok(v)
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route("/v1/interactions", get(interactions))
        .route("/openapi.json", get(openapi))
}
async fn interactions(State(s): State<StateData>, h: HeaderMap) -> Result<Json<Value>, CoreError> {
    let p = s.auth.authenticate(&h)?;
    let result = catalog()?;
    p.check_fresh()?;
    Ok(Json(result))
}
async fn openapi() -> Result<Json<Value>, CoreError> {
    Ok(Json(schema()?))
}
