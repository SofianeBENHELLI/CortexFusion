use cortex_rust_core::{
    auth::Authenticator,
    database::Database,
    server::{self, StateData},
};
use sqlx::postgres::PgPoolOptions;
use std::{env, net::SocketAddr, time::Duration};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let url = env::var("CORTEX_RUST_DATABASE_URL")?;
    let pem = std::fs::read(env::var("CORTEX_JWT_PUBLIC_KEY_FILE")?)?;
    let issuer = env::var("CORTEX_JWT_ISSUER")?;
    let audience = env::var("CORTEX_JWT_AUDIENCE")?;
    let auth = Authenticator::new(&pem, &issuer, &audience)
        .map_err(|_| "Invalid identity configuration")?;
    let db = Database {
        pool: PgPoolOptions::new()
            .max_connections(10)
            .acquire_timeout(Duration::from_secs(3))
            .connect(&url)
            .await
            .map_err(|_| "Database connection failed")?,
    };
    db.verify_role()
        .await
        .map_err(|_| "Database role is not permitted")?;
    let address: SocketAddr = env::var("CORTEX_RUST_BIND")
        .unwrap_or_else(|_| "127.0.0.1:8010".into())
        .parse()?;
    if !address.ip().is_loopback() {
        return Err("Initial migration candidate must bind loopback".into());
    }
    let listener = tokio::net::TcpListener::bind(address).await?;
    println!(
        "CortexFusion Rust migration candidate listening on {}",
        listener.local_addr()?
    );
    axum::serve(listener, server::router(StateData { auth, db }))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
