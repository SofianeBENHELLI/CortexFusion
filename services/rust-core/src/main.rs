use cortex_rust_core::{
    auth::Authenticator,
    database::Database,
    server::{self, StateData},
};
use sqlx::postgres::PgPoolOptions;
use std::{env, net::SocketAddr, time::Duration};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.len() == 2 && args[0] == "--parse-document" {
        cortex_rust_core::document_parser::child(&args[1]);
        return Ok(());
    }
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(run())
}
async fn run() -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(not(debug_assertions))]
    if env::var_os("CORTEX_SYNTHETIC_OPENROUTER_URL").is_some() {
        return Err("Synthetic model override is unavailable in release builds".into());
    }
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
    let confirmation = match env::var("CORTEX_CONFIRMATION_PUBLIC_KEY_FILE") {
        Ok(path) => Some(
            cortex_rust_core::confirmation::ConfirmationVerifier::new(
                &std::fs::read(path)?,
                db.clone(),
            )
            .map_err(|_| "Invalid confirmation configuration")?,
        ),
        Err(_) => None,
    };
    let graph = match env::var("CORTEX_TERMINUS_URL") {
        Ok(base) => Some(cortex_rust_core::graph::GraphService {
            db: db.clone(),
            engine: cortex_rust_core::terminus::Terminus::new(
                &base,
                env::var("CORTEX_TERMINUS_USER")?,
                env::var("CORTEX_TERMINUS_PASSWORD")?,
            )
            .map_err(|_| "Invalid graph configuration")?,
        }),
        Err(_) => None,
    };
    let args: Vec<String> = env::args().skip(1).collect();
    if !args.is_empty() {
        if args.len() != 2 || args[0] != "--import-published" {
            return Err("Unsupported migration command".into());
        }
        let domain = uuid::Uuid::parse_str(&args[1])?.to_string();
        let mut headers = http::HeaderMap::new();
        headers.insert(
            "authorization",
            format!("Bearer {}", env::var("CORTEX_MIGRATION_BEARER")?).parse()?,
        );
        headers.insert("x-tenant-id", env::var("CORTEX_MIGRATION_TENANT")?.parse()?);
        let principal = auth
            .authenticate(&headers)
            .map_err(|_| "Migration identity rejected")?;
        let snapshot = graph
            .as_ref()
            .ok_or("Graph must be configured")?
            .import_published(&principal, &domain)
            .await
            .map_err(
                |_| "Graph migration did not complete; inspect durable preparation before retry",
            )?;
        println!(
            "{}",
            serde_json::json!({"status":"prepared","concepts":snapshot.count})
        );
        return Ok(());
    }
    let address: SocketAddr = env::var("CORTEX_RUST_BIND")
        .unwrap_or_else(|_| "127.0.0.1:8010".into())
        .parse()?;
    if !address.ip().is_loopback() {
        return Err("Initial migration candidate must bind loopback".into());
    }
    let mut origins = cortex_rust_core::browser::Origins::parse(
        &env::var("CORTEX_CORS_ORIGINS").unwrap_or_else(|_| "[]".into()),
    )?;
    let public_resource = env::var("CORTEX_MCP_PUBLIC_URL")
        .ok()
        .map(|url| cortex_rust_core::discovery::PublicResource::parse(&url, &issuer, &audience))
        .transpose()?;
    if let Some(r) = &public_resource
        && !origins.0.contains(&r.origin)
    {
        std::sync::Arc::make_mut(&mut origins.0).push(r.origin.clone());
    }
    let model_daily_limit = env::var("CORTEX_MODEL_DAILY_ATTEMPT_LIMIT")
        .unwrap_or_else(|_| "100".into())
        .parse::<i64>()?;
    if !(1..=100000).contains(&model_daily_limit) {
        return Err("Invalid model attempt limit".into());
    }
    let synthesis_enabled = match env::var("CORTEX_SYNTHESIS_ENABLED")
        .unwrap_or_else(|_| "false".into())
        .to_lowercase()
        .as_str()
    {
        "true" | "1" | "yes" | "on" => true,
        "false" | "0" | "no" | "off" => false,
        _ => return Err("Invalid synthesis enabled flag".into()),
    };
    let synthesis = if synthesis_enabled {
        let model = cortex_rust_core::model_provider::OpenRouter::new(
            env::var("CORTEX_OPENROUTER_MODEL")?,
            env::var("CORTEX_OPENROUTER_API_KEY").or_else(|_| env::var("OPENROUTER_API_KEY"))?,
        )?;
        #[cfg(debug_assertions)]
        let model = if let Ok(url) = env::var("CORTEX_SYNTHETIC_OPENROUTER_URL") {
            model.synthetic_endpoint(&url)?
        } else {
            model
        };
        Some(model)
    } else {
        None
    };
    let extraction = match env::var("CORTEX_MODEL_PROVIDER")
        .unwrap_or_else(|_| "openrouter".into())
        .as_str()
    {
        "openrouter" => {
            if let (Ok(name), Ok(key)) = (
                env::var("CORTEX_OPENROUTER_MODEL"),
                env::var("CORTEX_OPENROUTER_API_KEY").or_else(|_| env::var("OPENROUTER_API_KEY")),
            ) {
                let model = cortex_rust_core::model_provider::OpenRouter::new(name, key)?;
                #[cfg(debug_assertions)]
                let model = if let Ok(url) = env::var("CORTEX_SYNTHETIC_OPENROUTER_URL") {
                    model.synthetic_endpoint(&url)?
                } else {
                    model
                };
                Some(cortex_rust_core::model_provider::PassageProvider::OpenRouter(model))
            } else {
                None
            }
        }
        "ollama" => {
            if let Ok(name) = env::var("CORTEX_LOCAL_MODEL") {
                Some(cortex_rust_core::model_provider::PassageProvider::local(
                    name,
                    env::var("CORTEX_OLLAMA_URL")
                        .unwrap_or_else(|_| "http://127.0.0.1:11434".into()),
                )?)
            } else {
                None
            }
        }
        _ => return Err("Invalid model provider".into()),
    };
    let listener = tokio::net::TcpListener::bind(address).await?;
    println!(
        "CortexFusion Rust migration candidate listening on {}",
        listener.local_addr()?
    );
    let app = cortex_rust_core::mcp::mount(
        server::router(StateData {
            auth: auth.clone(),
            model_daily_limit,
            synthesis,
            extraction,
            public_resource: public_resource.clone(),
            db: db.clone(),
            graph,
            confirmation: confirmation.clone(),
        }),
        auth,
        confirmation,
        db,
        origins.clone(),
        public_resource.clone(),
    )
    .map_err(|_| "MCP initialization failed")?;
    let app = cortex_rust_core::discovery::install_challenge(app, public_resource);
    let app = cortex_rust_core::browser::install(app, origins);
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
