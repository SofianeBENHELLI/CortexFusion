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
    pub fn request_timeout() -> Self {
        Self {
            code: "REQUEST_TIMEOUT",
            message: "The request exceeded its deadline; read a command's receipt or retry it with the same idempotency key",
            status: StatusCode::SERVICE_UNAVAILABLE,
        }
    }
    #[track_caller]
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
        report(Some(&error));
        Self::storage()
    }
    #[track_caller]
    pub fn database() -> Self {
        report(None);
        Self::storage()
    }
    fn storage() -> Self {
        Self {
            code: "STORAGE_ERROR",
            message: "The operation did not complete",
            status: StatusCode::SERVICE_UNAVAILABLE,
        }
    }
}
/// Server-side trace of a storage failure; clients only ever see the generic message.
/// Debug builds (tests and CI) also list this crate's frames to locate the failure.
#[track_caller]
fn report(error: Option<&sqlx::Error>) {
    eprintln!(
        "{}",
        describe(
            std::panic::Location::caller(),
            error,
            cfg!(debug_assertions).then(std::backtrace::Backtrace::force_capture),
        )
    );
}
fn describe(
    at: &std::panic::Location<'_>,
    error: Option<&sqlx::Error>,
    trace: Option<std::backtrace::Backtrace>,
) -> String {
    let mut line = String::from("storage error");
    // Calls through function pointers (map_err(CoreError::sql)) report a std location.
    if !at.file().starts_with("/rustc/") {
        line += &format!(" at {}:{}", at.file(), at.line());
    }
    if let Some(error) = error {
        let cause = match error.as_database_error() {
            Some(db) => format!(
                "database {} {}",
                db.code().as_deref().unwrap_or("-"),
                db.message()
            ),
            None => error.to_string(),
        };
        line += ": ";
        line.extend(cause.chars().take(300));
    }
    if let Some(trace) = trace {
        let trace = trace.to_string();
        let frames: Vec<&str> = trace
            .lines()
            .map(str::trim)
            .filter(|l| {
                l.contains("cortex_rust_core::") && !l.contains("cortex_rust_core::error::")
            })
            .take(8)
            .collect();
        if !frames.is_empty() {
            line += " | ";
            line += &frames.join(" < ");
        }
    }
    line
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
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn storage_errors_stay_generic_for_clients_and_describe_the_cause_for_operators() {
        let error = CoreError::sql(sqlx::Error::RowNotFound);
        assert_eq!(
            (error.code, error.message, error.status),
            (
                "STORAGE_ERROR",
                "The operation did not complete",
                StatusCode::SERVICE_UNAVAILABLE
            )
        );
        let here = std::panic::Location::caller();
        let line = describe(here, Some(&sqlx::Error::RowNotFound), None);
        assert!(line.starts_with("storage error at "), "{line}");
        assert!(line.contains("no rows returned"), "{line}");
        let long = sqlx::Error::Protocol("x".repeat(1000));
        assert!(describe(here, Some(&long), None).len() < 400);
    }
}
