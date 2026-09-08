//! Explicitly scoped API client. No SQL, graph, model, or privileged caller construction.
use crate::shutdown::Signals;
use reqwest::{Client, Method, StatusCode, Url};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    env,
    fs::OpenOptions,
    io::Read,
    path::PathBuf,
    time::{Duration, Instant},
};
use uuid::Uuid;

type Result<T> = std::result::Result<T, &'static str>;
const RESPONSE_LIMIT: usize = 4 * 1024 * 1024;
const TOKEN_LIMIT: usize = 16_384;
struct Config {
    base: Url,
    tenant: String,
    domain: String,
    subject: String,
    bearer: PathBuf,
    poll: Duration,
    page_size: usize,
    max_cycles: Option<u64>,
    max_run: Duration,
    max_actions: u64,
}
fn required(name: &str) -> Result<String> {
    env::var(name)
        .ok()
        .filter(|v| !v.is_empty())
        .ok_or("Missing worker configuration")
}
fn number(name: &str, default: u64, max: u64) -> Result<u64> {
    let value = match env::var_os(name) {
        None => default,
        Some(v) => v
            .to_str()
            .ok_or("Invalid worker numeric setting")?
            .parse::<u64>()
            .map_err(|_| "Invalid worker numeric setting")?,
    };
    if !(1..=max).contains(&value) {
        return Err("Worker numeric setting is outside its bounds");
    }
    Ok(value)
}
fn origin(value: &str) -> Result<Url> {
    let url = Url::parse(value).map_err(|_| "Invalid worker API origin")?;
    let loopback = url.host_str().is_some_and(|host| {
        host == "localhost"
            || host
                .trim_start_matches('[')
                .trim_end_matches(']')
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    });
    if url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
        || !(url.scheme() == "https" || url.scheme() == "http" && loopback)
    {
        return Err("Worker API must be a fixed HTTPS origin or loopback HTTP origin");
    }
    Ok(url)
}
fn uuid(value: &str) -> Result<String> {
    Uuid::parse_str(value)
        .map(|u| u.to_string())
        .map_err(|_| "Invalid worker UUID")
}
impl Config {
    fn from_environment() -> Result<Self> {
        if env::args_os().len() != 1 {
            return Err("Configure the corpus worker through environment variables");
        }
        let subject = required("CORTEX_WORKER_SUBJECT")?;
        if subject.chars().count() > 300 {
            return Err("Invalid worker subject");
        }
        Ok(Self {
            base: origin(&required("CORTEX_WORKER_API_URL")?)?,
            tenant: uuid(&required("CORTEX_WORKER_TENANT")?)?,
            domain: uuid(&required("CORTEX_WORKER_DOMAIN")?)?,
            subject,
            bearer: PathBuf::from(required("CORTEX_WORKER_BEARER_FILE")?),
            poll: Duration::from_secs(number("CORTEX_WORKER_POLL_SECONDS", 5, 300)?),
            page_size: number("CORTEX_WORKER_PAGE_SIZE", 5, 20)? as usize,
            max_cycles: if env::var_os("CORTEX_WORKER_MAX_CYCLES").is_some() {
                Some(number("CORTEX_WORKER_MAX_CYCLES", 1, 100_000)?)
            } else {
                None
            },
            max_run: Duration::from_secs(number("CORTEX_WORKER_MAX_RUN_SECONDS", 3600, 86_400)?),
            max_actions: number("CORTEX_WORKER_MAX_ACTIONS", 1000, 100_000)?,
        })
    }
    fn token(&self) -> Result<String> {
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
        }
        let file = options
            .open(&self.bearer)
            .map_err(|_| "Worker credential file unavailable")?;
        let metadata = file
            .metadata()
            .map_err(|_| "Worker credential metadata unavailable")?;
        if !metadata.is_file() || metadata.len() > TOKEN_LIMIT as u64 {
            return Err("Worker credential must be a bounded regular file");
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            // SAFETY: geteuid has no arguments or side effects.
            if metadata.mode() & 0o077 != 0 || metadata.uid() != unsafe { libc::geteuid() } {
                return Err(
                    "Worker credential must be owned by this user with private permissions",
                );
            }
        }
        let mut bytes = Vec::new();
        file.take((TOKEN_LIMIT + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "Worker credential read failed")?;
        if bytes.len() > TOKEN_LIMIT {
            return Err("Worker credential exceeds limit");
        }
        let token = String::from_utf8(bytes).map_err(|_| "Invalid worker credential encoding")?;
        let token = token.trim_end_matches(['\r', '\n']);
        if token.is_empty()
            || token
                .bytes()
                .any(|b| b.is_ascii_whitespace() || b.is_ascii_control())
        {
            return Err("Invalid worker credential format");
        }
        Ok(token.to_owned())
    }
}
#[derive(Deserialize)]
struct Identity {
    subject: String,
    tenant_id: String,
    domains: Vec<Domain>,
}
#[derive(Deserialize)]
struct Domain {
    id: String,
    role: String,
    capabilities: Vec<String>,
}
#[derive(Deserialize)]
struct Page {
    items: Vec<Value>,
    next_after: Option<String>,
}
#[derive(Clone, Copy)]
enum Kind {
    File,
    Import,
}
impl Kind {
    fn path(self) -> &'static str {
        match self {
            Self::File => "files",
            Self::Import => "imports",
        }
    }
    fn eligible(self, item: &Value) -> Result<bool> {
        let status = item["status"]
            .as_str()
            .ok_or("Malformed corpus item status")?;
        match self {
            Self::File => Ok(matches!(status, "pending" | "processing")),
            Self::Import => {
                if status == "cancelled" {
                    return Ok(false);
                }
                let items = item["items"]
                    .as_array()
                    .ok_or("Malformed text import items")?;
                Ok(items.iter().any(|item| item["status"] == "pending"))
            }
        }
    }
}
struct Worker {
    config: Config,
    client: Client,
    signals: Signals,
    stopping: bool,
    started: Instant,
    actions: u64,
    cycles: u64,
}
impl Worker {
    fn stopped(&self) -> bool {
        self.stopping
            || self.started.elapsed() >= self.config.max_run
            || self.actions >= self.config.max_actions
    }
    async fn request(
        &mut self,
        method: Method,
        path: &str,
        token: &str,
    ) -> Result<Option<(StatusCode, Value)>> {
        if self.stopped() {
            return Ok(None);
        }
        if method == Method::POST {
            self.actions += 1;
        }
        let url = self
            .config
            .base
            .join(path)
            .map_err(|_| "Invalid internal worker path")?;
        let call = async {
            let mut response = self
                .client
                .request(method.clone(), url)
                .bearer_auth(token)
                .header("X-Tenant-ID", &self.config.tenant)
                .header("Accept", "application/json")
                .send()
                .await
                .map_err(
                    |_| "Worker API request interrupted; inspect durable receipt before restart",
                )?;
            let status = response.status();
            if response
                .content_length()
                .is_some_and(|n| n > RESPONSE_LIMIT as u64)
            {
                return Err("Worker API response exceeds limit; inspect durable receipt");
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| "Worker API response interrupted; inspect durable receipt")?
            {
                if chunk.len() > RESPONSE_LIMIT - bytes.len() {
                    return Err("Worker API response exceeds limit; inspect durable receipt");
                }
                bytes.extend_from_slice(&chunk);
            }
            let value = serde_json::from_slice(&bytes)
                .map_err(|_| "Worker API returned malformed JSON; inspect durable receipt")?;
            Ok((status, value))
        };
        tokio::pin!(call);
        let result = tokio::select! {
            result = &mut call => result,
            signal = self.signals.receive() => {
                signal.map_err(|_| "Worker signal handling failed")?;
                self.stopping = true;
                println!("{}",json!({"event":"draining","scope":"current_request"}));
                tokio::select! {
                    result = tokio::time::timeout(Duration::from_secs(35), &mut call) => result.map_err(|_| "Worker drain expired; inspect durable receipt before restart")?,
                    signal = self.signals.receive() => {
                        signal.map_err(|_| "Worker signal handling failed")?;
                        Err("Worker interrupted twice; inspect durable receipt before restart")
                    }
                }
            }
        }?;
        Ok(Some(result))
    }
    async fn identity(&mut self) -> Result<Option<String>> {
        if self.stopped() {
            return Ok(None);
        }
        let token = self.config.token()?;
        let Some((status, body)) = self.request(Method::GET, "/v1/me", &token).await? else {
            return Ok(None);
        };
        if status != StatusCode::OK {
            return Err("Worker identity unavailable or unauthorized; stopped");
        }
        let identity: Identity =
            serde_json::from_value(body).map_err(|_| "Malformed worker identity response")?;
        if identity.subject != self.config.subject
            || identity.tenant_id != self.config.tenant
            || !identity.domains.iter().any(|domain| {
                domain.id == self.config.domain
                    && matches!(domain.role.as_str(), "owner" | "corpus_manager")
                    && domain.capabilities.iter().any(|c| c == "manage_corpus")
            })
        {
            return Err("Worker identity or corpus scope changed; stopped");
        }
        if self.stopped() {
            return Ok(None);
        }
        Ok(Some(token))
    }
    async fn page(&mut self, kind: Kind, after: &Option<String>) -> Result<Option<Page>> {
        let Some(token) = self.identity().await? else {
            return Ok(None);
        };
        let mut path = format!(
            "/v1/domains/{}/{}/?limit={}",
            self.config.domain,
            kind.path(),
            self.config.page_size
        );
        // API routes are canonical without a trailing slash.
        path = path.replace("/?", "?");
        if matches!(kind, Kind::File) {
            path.push_str("&pending=true");
        }
        if let Some(after) = after {
            path.push_str("&after=");
            path.push_str(after);
        }
        let Some((status, body)) = self.request(Method::GET, &path, &token).await? else {
            return Ok(None);
        };
        if status != StatusCode::OK {
            return Err("Worker corpus listing failed or access changed; stopped");
        }
        let page: Page =
            serde_json::from_value(body).map_err(|_| "Malformed worker corpus page")?;
        if page.items.len() > self.config.page_size {
            return Err("Worker corpus page exceeds requested bound");
        }
        if let Some(next) = &page.next_after
            && (uuid(next)? != *next
                || after.as_ref().is_some_and(|old| next <= old)
                || page.items.is_empty())
        {
            return Err("Invalid worker pagination cursor");
        }
        Ok(Some(page))
    }
    async fn process(&mut self, kind: Kind, item: &Value) -> Result<()> {
        if !kind.eligible(item)? {
            return Ok(());
        }
        let id = uuid(
            item["id"]
                .as_str()
                .ok_or("Malformed corpus item identifier")?,
        )?;
        let Some(token) = self.identity().await? else {
            return Ok(());
        };
        let path = format!(
            "/v1/domains/{}/{}/{}/process{}",
            self.config.domain,
            kind.path(),
            id,
            if matches!(kind, Kind::Import) {
                "?limit=20"
            } else {
                ""
            }
        );
        let response = self.request(Method::POST, &path, &token).await;
        let Some((status, body)) = response? else {
            return Ok(());
        };
        if status == StatusCode::OK {
            if body["id"].as_str() != Some(&id) {
                return Err("Worker receipt does not match requested job");
            }
            let state = body["status"]
                .as_str()
                .filter(|s| {
                    matches!(
                        *s,
                        "pending" | "processing" | "partial" | "succeeded" | "failed" | "cancelled"
                    )
                })
                .ok_or("Malformed worker job receipt")?;
            println!(
                "{}",
                json!({"event":"processed","kind":kind.path(),"id":id,"status":state})
            );
            return Ok(());
        }
        let busy = body["error"].as_str().is_some_and(|code| {
            matches!(
                code,
                "FILE_BUSY" | "STALE_LEASE" | "IMPORT_CANCELLED" | "FILE_CANCELLED"
            )
        });
        if busy && (status == StatusCode::CONFLICT || status == StatusCode::SERVICE_UNAVAILABLE) {
            println!("{}", json!({"event":"deferred","kind":kind.path(),"id":id}));
            return Ok(());
        }
        Err(
            "Worker processing did not complete or access changed; inspect durable receipt before restart",
        )
    }
}
pub async fn run() -> Result<()> {
    let config = Config::from_environment()?;
    let client = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "Worker HTTP client initialization failed")?;
    let mut worker = Worker {
        config,
        client,
        signals: Signals::install().map_err(|_| "Worker signal initialization failed")?,
        stopping: false,
        started: Instant::now(),
        actions: 0,
        cycles: 0,
    };
    if worker.identity().await?.is_none() {
        return Ok(());
    }
    println!("{}", json!({"event":"started","mode":"corpus_api_client"}));
    let (mut files_after, mut imports_after) = (None, None);
    while !worker.stopped() {
        for (kind, after) in [
            (Kind::File, &mut files_after),
            (Kind::Import, &mut imports_after),
        ] {
            let Some(page) = worker.page(kind, after).await? else {
                break;
            };
            for item in &page.items {
                if worker.stopped() {
                    break;
                }
                worker.process(kind, item).await?;
            }
            *after = page.next_after;
        }
        worker.cycles += 1;
        if worker.stopped()
            || worker
                .config
                .max_cycles
                .is_some_and(|max| worker.cycles >= max)
        {
            break;
        }
        let remaining = worker
            .config
            .max_run
            .saturating_sub(worker.started.elapsed());
        tokio::select! {
            _ = tokio::time::sleep(worker.config.poll.min(remaining)) => {},
            signal = worker.signals.receive() => { signal.map_err(|_| "Worker signal handling failed")?; worker.stopping=true; },
        }
    }
    println!(
        "{}",
        json!({"event":"stopped","cycles":worker.cycles,"actions":worker.actions,"signal":worker.stopping})
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn worker_origin_and_pending_items_are_constrained() {
        for url in [
            "https://cortex.test",
            "http://127.0.0.1:8010",
            "http://[::1]:8010/",
        ] {
            assert!(origin(url).is_ok());
        }
        for url in [
            "https://user:pass@cortex.test",
            "http://remote.test",
            "https://cortex.test/v1",
            "https://cortex.test/?token=x",
            "https://cortex.test/#x",
        ] {
            assert!(origin(url).is_err());
        }
        assert!(
            Kind::File
                .eligible(&json!({"status":"processing"}))
                .unwrap()
        );
        assert!(!Kind::File.eligible(&json!({"status":"failed"})).unwrap());
        assert!(!Kind::Import.eligible(&json!({"status":"partial","items":[{"status":"succeeded"},{"status":"failed"}]})).unwrap());
        assert!(
            Kind::Import
                .eligible(
                    &json!({"status":"partial","items":[{"status":"failed"},{"status":"pending"}]})
                )
                .unwrap()
        );
        assert!(
            !Kind::Import
                .eligible(&json!({"status":"cancelled","items":[{"status":"pending"}]}))
                .unwrap()
        );
    }
    #[cfg(unix)]
    #[test]
    fn worker_credentials_reject_symlink_world_readable_and_unbounded_input() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let directory = std::env::temp_dir().join(format!("cf-worker-{}", Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("bearer");
        let mut config = Config {
            base: origin("http://127.0.0.1").unwrap(),
            tenant: Uuid::new_v4().to_string(),
            domain: Uuid::new_v4().to_string(),
            subject: "alice".into(),
            bearer: path.clone(),
            poll: Duration::from_secs(1),
            page_size: 1,
            max_cycles: Some(1),
            max_run: Duration::from_secs(1),
            max_actions: 1,
        };
        std::fs::write(&path, b"synthetic-test-bearer\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(config.token().unwrap(), "synthetic-test-bearer");
        let link = directory.join("link");
        symlink(&path, &link).unwrap();
        config.bearer = link.clone();
        assert!(config.token().is_err());
        config.bearer = path.clone();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(config.token().is_err());
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        for content in [
            vec![b'a'; TOKEN_LIMIT + 1],
            b"token contains spaces".to_vec(),
            vec![0xff],
            Vec::new(),
        ] {
            std::fs::write(&path, content).unwrap();
            assert!(config.token().is_err());
        }
        std::fs::remove_file(link).unwrap();
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
