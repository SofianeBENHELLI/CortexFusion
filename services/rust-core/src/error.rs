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
    pub fn invalid_uuid() -> Self {
        Self {
            code: "VALIDATION_FAILED",
            message: "Invalid UUID",
            status: StatusCode::UNPROCESSABLE_ENTITY,
        }
    }
    pub fn concept_not_found() -> Self {
        Self {
            code: "NOT_FOUND",
            message: "Concept not found",
            status: StatusCode::NOT_FOUND,
        }
    }
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
    pub fn sql(error: sqlx::Error) -> Self {
        if error
            .as_database_error()
            .and_then(|e| e.code())
            .is_some_and(|s| matches!(s.as_ref(), "40001" | "40P01" | "23505"))
        {
            return Self {
                code: "CONCURRENT_CHANGE",
                message: "Refresh and retry the same idempotent command",
                status: StatusCode::CONFLICT,
            };
        }
        Self::database()
    }
    pub fn database() -> Self {
        Self {
            code: "STORAGE_ERROR",
            message: "The operation did not complete",
            status: StatusCode::SERVICE_UNAVAILABLE,
        }
    }
}
impl IntoResponse for CoreError {
    fn into_response(self) -> Response {
        let mut response = (
            self.status,
            Json(json!({"error":self.code,"message":self.message})),
        )
            .into_response();
        if self.status == StatusCode::UNAUTHORIZED {
            response
                .headers_mut()
                .insert("www-authenticate", http::HeaderValue::from_static("Bearer"));
        }
        response
    }
}
