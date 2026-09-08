use axum::{
    Json,
    response::{IntoResponse, Response},
};
use http::StatusCode;
use serde_json::json;

#[derive(Debug)]
pub struct CoreError {
    pub code: &'static str,
    pub message: &'static str,
    pub status: StatusCode,
}
impl CoreError {
    pub fn auth() -> Self {
        Self {
            code: "NOT_AUTHORIZED",
            message: "Valid identity and tenant are required",
            status: StatusCode::UNAUTHORIZED,
        }
    }
    pub fn not_found() -> Self {
        Self {
            code: "NOT_FOUND",
            message: "Domain not found",
            status: StatusCode::NOT_FOUND,
        }
    }
    pub fn database() -> Self {
        Self {
            code: "DATABASE_UNAVAILABLE",
            message: "Database operation could not be completed",
            status: StatusCode::SERVICE_UNAVAILABLE,
        }
    }
}
impl IntoResponse for CoreError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({"error":self.code,"message":self.message})),
        )
            .into_response()
    }
}
