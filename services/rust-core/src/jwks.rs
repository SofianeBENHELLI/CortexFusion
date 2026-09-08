//! Operator-selected JWKS. Tokens never select a network destination or refresh.
use crate::error::CoreError;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use jsonwebtoken::DecodingKey;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::{Arc, RwLock},
    time::{Duration, Instant},
};

const MAX_BODY: usize = 65_536;
const MAX_KEYS: usize = 16;

struct Key {
    decoding: DecodingKey,
    fingerprint: [u8; 32],
}
struct Snapshot {
    keys: HashMap<String, Arc<Key>>,
    refreshed: Instant,
}
pub(crate) struct Source {
    snapshot: RwLock<Snapshot>,
    max_age: Duration,
}
#[derive(Clone)]
pub(crate) struct Lease {
    source: Arc<Source>,
    kid: String,
    key: Arc<Key>,
}
impl std::fmt::Debug for Lease {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("IdentityKeyLease")
    }
}
impl Lease {
    pub(crate) fn check(&self) -> Result<(), CoreError> {
        let state = self.source.snapshot.read().map_err(|_| CoreError::auth())?;
        if state.refreshed.elapsed() >= self.source.max_age
            || !state
                .keys
                .get(&self.kid)
                .is_some_and(|k| Arc::ptr_eq(k, &self.key))
        {
            return Err(CoreError::auth());
        }
        Ok(())
    }
}
impl Source {
    pub(crate) async fn start(
        url: &str,
        refresh_seconds: u64,
        max_age_seconds: u64,
    ) -> Result<Arc<Self>, CoreError> {
        if !(1..=300).contains(&refresh_seconds)
            || !(refresh_seconds..=3600).contains(&max_age_seconds)
        {
            return Err(CoreError::auth());
        }
        let url = fixed_url(url)?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|_| CoreError::auth())?;
        let keys = fetch(&client, &url).await?;
        let source = Arc::new(Self {
            snapshot: RwLock::new(Snapshot {
                keys: keys
                    .into_iter()
                    .map(|(id, key)| (id, Arc::new(key)))
                    .collect(),
                refreshed: Instant::now(),
            }),
            max_age: Duration::from_secs(max_age_seconds),
        });
        let weak = Arc::downgrade(&source);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(refresh_seconds)).await;
                let Some(source) = weak.upgrade() else { break };
                match fetch(&client, &url).await {
                    Ok(keys) => {
                        if source.replace(keys).is_err() {
                            break;
                        }
                    }
                    Err(_) => {
                        eprintln!("Identity key refresh failed; existing cache expiry is unchanged")
                    }
                }
            }
        });
        Ok(source)
    }
    fn replace(&self, keys: HashMap<String, Key>) -> Result<(), CoreError> {
        let mut state = self.snapshot.write().map_err(|_| CoreError::auth())?;
        let uninterrupted_freshness = state.refreshed.elapsed() < self.max_age;
        let keys = keys
            .into_iter()
            .map(|(kid, key)| {
                // Preserve a lease only across uninterrupted presence of identical
                // key material. Remove/re-add must not resurrect an old request.
                let key = state
                    .keys
                    .get(&kid)
                    .filter(|old| uninterrupted_freshness && old.fingerprint == key.fingerprint)
                    .cloned()
                    .unwrap_or_else(|| Arc::new(key));
                (kid, key)
            })
            .collect();
        *state = Snapshot {
            keys,
            refreshed: Instant::now(),
        };
        Ok(())
    }
    pub(crate) fn select(self: &Arc<Self>, token: &str) -> Result<(DecodingKey, Lease), CoreError> {
        if token.len() > 16_384 {
            return Err(CoreError::auth());
        }
        let encoded = token
            .split('.')
            .next()
            .filter(|s| s.len() <= 4096)
            .ok_or_else(CoreError::auth)?;
        let header: TokenHeader = serde_json::from_slice(
            &URL_SAFE_NO_PAD
                .decode(encoded)
                .map_err(|_| CoreError::auth())?,
        )
        .map_err(|_| CoreError::auth())?;
        if header.alg != "RS256"
            || !valid_kid(&header.kid)
            || header.extra.contains_key("crit")
            || header.extra.contains_key("b64")
        {
            return Err(CoreError::auth());
        }
        // jku, jwk and x5u are inert metadata; only this preloaded source is used.
        let state = self.snapshot.read().map_err(|_| CoreError::auth())?;
        if state.refreshed.elapsed() >= self.max_age {
            return Err(CoreError::auth());
        }
        let key = state
            .keys
            .get(&header.kid)
            .cloned()
            .ok_or_else(CoreError::auth)?;
        Ok((
            key.decoding.clone(),
            Lease {
                source: self.clone(),
                kid: header.kid,
                key,
            },
        ))
    }
}
#[derive(Deserialize)]
struct TokenHeader {
    alg: String,
    kid: String,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}
#[derive(Deserialize)]
struct Set {
    keys: Vec<Jwk>,
}
#[derive(Deserialize)]
struct Jwk {
    kty: String,
    kid: String,
    #[serde(default, deserialize_with = "present_nonnull")]
    alg: Option<String>,
    #[serde(rename = "use", default, deserialize_with = "present_nonnull")]
    usage: Option<String>,
    #[serde(default, deserialize_with = "present_nonnull")]
    key_ops: Option<Vec<String>>,
    #[serde(default, deserialize_with = "present_nonnull")]
    n: Option<String>,
    #[serde(default, deserialize_with = "present_nonnull")]
    e: Option<String>,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}
fn present_nonnull<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}
fn valid_kid(kid: &str) -> bool {
    !kid.is_empty() && kid.len() <= 200 && !kid.chars().any(char::is_control)
}
fn fixed_url(raw: &str) -> Result<reqwest::Url, CoreError> {
    let url = reqwest::Url::parse(raw).map_err(|_| CoreError::auth())?;
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
        || url.fragment().is_some()
        || url.query().is_some()
        || !(url.scheme() == "https" || url.scheme() == "http" && loopback)
    {
        return Err(CoreError::auth());
    }
    Ok(url)
}
async fn fetch(
    client: &reqwest::Client,
    url: &reqwest::Url,
) -> Result<HashMap<String, Key>, CoreError> {
    let mut response = client
        .get(url.clone())
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|_| CoreError::auth())?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|n| n > MAX_BODY as u64)
    {
        return Err(CoreError::auth());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| CoreError::auth())? {
        if chunk.len() > MAX_BODY - body.len() {
            return Err(CoreError::auth());
        }
        body.extend_from_slice(&chunk);
    }
    parse_keys(&body)
}
fn parse_keys(body: &[u8]) -> Result<HashMap<String, Key>, CoreError> {
    if body.len() > MAX_BODY {
        return Err(CoreError::auth());
    }
    let set: Set = serde_json::from_slice(body).map_err(|_| CoreError::auth())?;
    if set.keys.len() > MAX_KEYS {
        return Err(CoreError::auth());
    }
    let mut seen = HashSet::new();
    let mut keys = HashMap::new();
    for jwk in set.keys {
        if !valid_kid(&jwk.kid)
            || !seen.insert(jwk.kid.clone())
            || ["d", "p", "q", "dp", "dq", "qi", "oth", "k"]
                .iter()
                .any(|k| jwk.extra.contains_key(*k))
        {
            return Err(CoreError::auth());
        }
        if jwk.kty != "RSA"
            || jwk.alg.as_deref().is_some_and(|alg| alg != "RS256")
            || jwk.usage.as_deref().is_some_and(|usage| usage != "sig")
            || jwk
                .key_ops
                .as_ref()
                .is_some_and(|ops| ops.as_slice() != ["verify"])
        {
            continue;
        }
        let n = unsigned(jwk.n.as_deref().ok_or_else(CoreError::auth)?, 1024)?;
        let e = unsigned(jwk.e.as_deref().ok_or_else(CoreError::auth)?, 4)?;
        let bits = n.len() * 8 - n[0].leading_zeros() as usize;
        let exponent = e.iter().fold(0_u64, |v, b| v * 256 + u64::from(*b));
        if !(2048..=8192).contains(&bits)
            || n[n.len() - 1] % 2 == 0
            || exponent < 3
            || exponent % 2 == 0
        {
            return Err(CoreError::auth());
        }
        let mut hash = Sha256::new();
        hash.update((n.len() as u64).to_be_bytes());
        hash.update(&n);
        hash.update(&e);
        keys.insert(
            jwk.kid,
            Key {
                decoding: DecodingKey::from_rsa_raw_components(&n, &e),
                fingerprint: hash.finalize().into(),
            },
        );
    }
    Ok(keys)
}
fn unsigned(encoded: &str, max_bytes: usize) -> Result<Vec<u8>, CoreError> {
    if encoded.len() > max_bytes.div_ceil(3) * 4 {
        return Err(CoreError::auth());
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| CoreError::auth())?;
    if bytes.is_empty() || bytes.len() > max_bytes || bytes[0] == 0 {
        return Err(CoreError::auth());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn public_key(kid: &str, tail: u8) -> Value {
        let mut n = vec![0xff; 256];
        n[255] = tail;
        json!({"kty":"RSA","kid":kid,"alg":"RS256","use":"sig","key_ops":["verify"],"n":URL_SAFE_NO_PAD.encode(n),"e":"AQAB"})
    }
    fn keys(value: Value) -> Result<HashMap<String, Key>, CoreError> {
        parse_keys(&serde_json::to_vec(&value).unwrap())
    }
    fn token(kid: &str) -> String {
        format!(
            "{}.unused.unused",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&json!({"alg":"RS256","kid":kid})).unwrap())
        )
    }
    #[test]
    fn jwks_key_material_policy_and_atomic_parser() {
        let key = public_key("a", 255);
        assert_eq!(keys(json!({"keys":[key.clone()]})).unwrap().len(), 1);
        assert!(keys(json!({"keys":[]})).unwrap().is_empty());
        assert!(keys(json!({"keys":[key.clone(),key.clone()]})).is_err());
        assert!(keys(json!({"keys":vec![key.clone();17]})).is_err());
        for (field, value) in [
            ("n", json!("AQAB")),
            ("e", json!("Ag")),
            ("d", Value::Null),
            ("alg", Value::Null),
            ("use", Value::Null),
            ("key_ops", Value::Null),
            ("kid", json!("")),
            ("kid", json!("a\n")),
        ] {
            let mut bad = key.clone();
            bad[field] = value;
            assert!(keys(json!({"keys":[key.clone(),bad]})).is_err());
        }
        let mut even = public_key("b", 254);
        assert!(keys(json!({"keys":[even.clone()]})).is_err());
        even["alg"] = json!("RS512");
        assert!(keys(json!({"keys":[even]})).unwrap().is_empty());
        assert!(parse_keys(br#"{"keys":[],"keys":[]}"#).is_err());
        assert!(parse_keys(br#"{"keys":[{"kid":"a","kid":"b","kty":"RSA"}]}"#).is_err());
        assert!(parse_keys(&vec![b' '; MAX_BODY + 1]).is_err());
    }
    #[test]
    fn jwks_leases_survive_identical_refresh_but_not_replacement_or_aba() {
        let source = Arc::new(Source {
            snapshot: RwLock::new(Snapshot {
                keys: HashMap::new(),
                refreshed: Instant::now(),
            }),
            max_age: Duration::from_secs(30),
        });
        source
            .replace(keys(json!({"keys":[public_key("a",255)]})).unwrap())
            .unwrap();
        let (_, original) = source.select(&token("a")).unwrap();
        source
            .replace(keys(json!({"keys":[public_key("a",255),public_key("b",253)]})).unwrap())
            .unwrap();
        assert!(original.check().is_ok());
        source.replace(keys(json!({"keys":[]})).unwrap()).unwrap();
        assert!(original.check().is_err());
        source
            .replace(keys(json!({"keys":[public_key("a",255)]})).unwrap())
            .unwrap();
        assert!(original.check().is_err());
        let (_, new) = source.select(&token("a")).unwrap();
        source
            .replace(keys(json!({"keys":[public_key("a",253)]})).unwrap())
            .unwrap();
        assert!(new.check().is_err());
        let (_, latest) = source.select(&token("a")).unwrap();
        source.snapshot.write().unwrap().refreshed = Instant::now() - Duration::from_secs(31);
        assert!(latest.check().is_err());
        assert!(source.select(&token("a")).is_err());
        source
            .replace(keys(json!({"keys":[public_key("a",253)]})).unwrap())
            .unwrap();
        assert!(source.select(&token("a")).is_ok());
        assert!(
            latest.check().is_err(),
            "Cache refresh after expiry must not revive an old lease"
        );
    }
    #[test]
    fn jwks_fixed_destination_and_header_policy() {
        for good in [
            "https://identity.test/keys",
            "http://127.0.0.1:123/keys",
            "http://[::1]/keys",
            "http://localhost/keys",
        ] {
            assert!(fixed_url(good).is_ok());
        }
        for bad in [
            "http://identity.test/keys",
            "https://user:pass@identity.test/keys",
            "https://identity.test/keys#x",
            "https://identity.test/keys?secret=x",
            "file:///tmp/keys",
        ] {
            assert!(fixed_url(bad).is_err());
        }
        let source = Arc::new(Source {
            snapshot: RwLock::new(Snapshot {
                keys: keys(json!({"keys":[public_key("a",255)]}))
                    .unwrap()
                    .into_iter()
                    .map(|(id, key)| (id, Arc::new(key)))
                    .collect(),
                refreshed: Instant::now(),
            }),
            max_age: Duration::from_secs(30),
        });
        for header in [
            json!({"alg":"RS256"}),
            json!({"alg":"RS512","kid":"a"}),
            json!({"alg":"RS256","kid":"missing"}),
            json!({"alg":"RS256","kid":"a","crit":null}),
            json!({"alg":"RS256","kid":"a","b64":true}),
        ] {
            assert!(
                source
                    .select(&format!(
                        "{}.x.y",
                        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&header).unwrap())
                    ))
                    .is_err()
            );
        }
        let header = json!({"alg":"RS256","kid":"a","jku":"http://invalid/keys","jwk":{},"x5u":"file:///private/key"});
        assert!(
            source
                .select(&format!(
                    "{}.x.y",
                    URL_SAFE_NO_PAD.encode(serde_json::to_vec(&header).unwrap())
                ))
                .is_ok()
        );
    }
}
