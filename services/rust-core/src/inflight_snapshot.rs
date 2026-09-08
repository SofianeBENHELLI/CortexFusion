//! Coalesce concurrent published reads only. Completed graphs are never cached.
//! Mutation verification continues to use the independent `read_snapshot` path.
use crate::{
    snapshot::{Concept, Snapshot},
    terminus::{EngineError, Terminus},
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio::sync::watch;

type Outcome = Result<Arc<Vec<Concept>>, EngineError>;
type Flights = Arc<Mutex<HashMap<Snapshot, Arc<Flight>>>>;

#[derive(Clone, Default)]
pub(crate) struct PublishedReads(Flights);

struct Flight {
    result: watch::Sender<Option<Outcome>>,
}

struct Leader {
    flights: Flights,
    key: Snapshot,
    flight: Arc<Flight>,
    finished: bool,
}
impl Leader {
    fn finish(&mut self, result: Outcome) {
        // Remove before delivery: the next request must contact the engine again.
        // Identity protects a replacement entry if this guard ever becomes stale.
        if let Ok(mut flights) = self.flights.lock()
            && flights
                .get(&self.key)
                .is_some_and(|f| Arc::ptr_eq(f, &self.flight))
        {
            flights.remove(&self.key);
        }
        self.finished = true;
        self.flight.result.send_replace(Some(result));
    }
}
impl Drop for Leader {
    fn drop(&mut self) {
        if !self.finished {
            // Cancellation aborts the leader GET. Followers fail promptly without
            // a hidden retry or an unowned background fetch.
            self.finish(Err(EngineError::Uncertain));
        }
    }
}

impl Terminus {
    /// Returns unfiltered immutable data; the caller MUST reauthorize after await.
    /// At most 16 distinct keys are shared, not a global engine-concurrency limit.
    pub async fn read_published_snapshot(&self, snapshot: &Snapshot) -> Outcome {
        snapshot.validate()?;
        let admission = {
            let mut flights = self
                .published_reads
                .0
                .lock()
                .map_err(|_| EngineError::Uncertain)?;
            if let Some(flight) = flights.get(snapshot) {
                Some((flight.clone(), false))
            } else if flights.len() < 16 {
                let (result, _) = watch::channel(None);
                let flight = Arc::new(Flight { result });
                flights.insert(snapshot.clone(), flight.clone());
                Some((flight, true))
            } else {
                None
            }
        };
        let Some((flight, leader)) = admission else {
            return self.read_snapshot(snapshot).await.map(Arc::new);
        };
        if leader {
            let mut guard = Leader {
                flights: self.published_reads.0.clone(),
                key: snapshot.clone(),
                flight,
                finished: false,
            };
            let result = self.read_snapshot(snapshot).await.map(Arc::new);
            guard.finish(result.clone());
            result
        } else {
            let mut result = flight.result.subscribe();
            loop {
                if let Some(outcome) = result.borrow_and_update().clone() {
                    return outcome;
                }
                result.changed().await.map_err(|_| EngineError::Uncertain)?;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Router, routing::get};
    use std::{
        sync::atomic::{AtomicU16, AtomicUsize, Ordering},
        time::Duration,
    };
    use tokio::sync::Semaphore;
    use uuid::Uuid;

    struct Fixture {
        engine: Terminus,
        url: String,
        calls: Arc<AtomicUsize>,
        status: Arc<AtomicU16>,
        gate: Arc<Semaphore>,
        server: tokio::task::JoinHandle<()>,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.server.abort();
        }
    }
    async fn fixture() -> Fixture {
        let calls = Arc::new(AtomicUsize::new(0));
        let status = Arc::new(AtomicU16::new(200));
        let gate = Arc::new(Semaphore::new(0));
        let (c, s, g) = (calls.clone(), status.clone(), gate.clone());
        let app = Router::new().fallback(get(move || {
            let (c, s, g) = (c.clone(), s.clone(), g.clone());
            async move {
                c.fetch_add(1, Ordering::SeqCst);
                g.acquire().await.unwrap().forget();
                (
                    http::StatusCode::from_u16(s.load(Ordering::SeqCst)).unwrap(),
                    "[]",
                )
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Fixture {
            engine: Terminus::new(&url, "admin".into(), "synthetic".into()).unwrap(),
            url,
            calls,
            status,
            gate,
            server,
        }
    }
    fn snapshot() -> Snapshot {
        Snapshot {
            database: format!("cf_snapshot_{}", Uuid::new_v4().simple()),
            commit: "immutable_commit".into(),
            digest: crate::canonical::digest(&serde_json::json!([])).unwrap(),
            count: 0,
        }
    }
    async fn until(mut condition: impl FnMut() -> bool) {
        tokio::time::timeout(Duration::from_secs(3), async {
            while !condition() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("deterministic concurrency condition");
    }
    fn spawn(engine: &Terminus, snapshot: &Snapshot) -> tokio::task::JoinHandle<Outcome> {
        let (engine, snapshot) = (engine.clone(), snapshot.clone());
        tokio::spawn(async move { engine.read_published_snapshot(&snapshot).await })
    }
    fn followers(engine: &Terminus, snapshot: &Snapshot) -> usize {
        engine
            .published_reads
            .0
            .lock()
            .unwrap()
            .get(snapshot)
            .map_or(0, |f| f.result.receiver_count())
    }

    #[tokio::test]
    async fn twelve_overlapping_reads_share_one_fetch_but_completed_results_are_not_cached() {
        let f = fixture().await;
        let key = snapshot();
        let mut tasks = Vec::new();
        for _ in 0..12 {
            tasks.push(spawn(&f.engine, &key));
        }
        until(|| followers(&f.engine, &key) == 11 && f.calls.load(Ordering::SeqCst) == 1).await;
        f.gate.add_permits(1);
        let first = tasks.remove(0).await.unwrap().unwrap();
        for task in tasks {
            assert!(Arc::ptr_eq(&first, &task.await.unwrap().unwrap()));
        }
        assert!(f.engine.published_reads.0.lock().unwrap().is_empty());
        f.status.store(404, Ordering::SeqCst);
        f.gate.add_permits(1);
        assert!(matches!(
            f.engine.read_published_snapshot(&key).await,
            Err(EngineError::Rejected(404))
        ));
        assert_eq!(f.calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn cancelled_leader_releases_waiters_and_next_read_can_proceed() {
        let f = fixture().await;
        let key = snapshot();
        let leader = spawn(&f.engine, &key);
        until(|| f.calls.load(Ordering::SeqCst) == 1).await;
        let follower = spawn(&f.engine, &key);
        until(|| followers(&f.engine, &key) == 1).await;
        leader.abort();
        assert!(leader.await.unwrap_err().is_cancelled());
        assert!(matches!(
            tokio::time::timeout(Duration::from_secs(1), follower)
                .await
                .unwrap()
                .unwrap(),
            Err(EngineError::Uncertain)
        ));
        assert!(f.engine.published_reads.0.lock().unwrap().is_empty());
        // The controlled server may still hold the cancelled request's permit.
        f.gate.add_permits(2);
        assert!(f.engine.read_published_snapshot(&key).await.is_ok());
        assert_eq!(f.calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn follower_cancellation_and_engine_errors_do_not_poison_later_reads() {
        let f = fixture().await;
        let key = snapshot();
        let leader = spawn(&f.engine, &key);
        until(|| f.calls.load(Ordering::SeqCst) == 1).await;
        let dropped = spawn(&f.engine, &key);
        let live = spawn(&f.engine, &key);
        until(|| followers(&f.engine, &key) == 2).await;
        dropped.abort();
        assert!(dropped.await.unwrap_err().is_cancelled());
        f.status.store(503, Ordering::SeqCst);
        f.gate.add_permits(1);
        for task in [leader, live] {
            assert!(matches!(
                task.await.unwrap(),
                Err(EngineError::Rejected(503))
            ));
        }
        assert_eq!(f.calls.load(Ordering::SeqCst), 1);
        f.status.store(200, Ordering::SeqCst);
        f.gate.add_permits(1);
        assert!(f.engine.read_published_snapshot(&key).await.is_ok());
        assert_eq!(f.calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn all_snapshot_fields_and_engine_instances_are_isolated() {
        let f = fixture().await;
        let key = snapshot();
        let mut keys = vec![key.clone()];
        keys.push(Snapshot {
            database: snapshot().database,
            ..key.clone()
        });
        keys.push(Snapshot {
            commit: "other_commit".into(),
            ..key.clone()
        });
        keys.push(Snapshot {
            digest: "a".repeat(64),
            ..key.clone()
        });
        keys.push(Snapshot {
            count: 1,
            ..key.clone()
        });
        let mut tasks: Vec<_> = keys.iter().map(|k| spawn(&f.engine, k)).collect();
        let separate = Terminus::new(&f.url, "other".into(), "synthetic".into()).unwrap();
        tasks.push(spawn(&separate, &key));
        until(|| f.calls.load(Ordering::SeqCst) == 6).await;
        f.gate.add_permits(6);
        for (i, task) in tasks.into_iter().enumerate() {
            let result = task.await.unwrap();
            if i == 3 || i == 4 {
                assert!(matches!(result, Err(EngineError::InvalidResponse)));
            } else {
                assert!(result.is_ok());
            }
        }
    }

    #[tokio::test]
    async fn mutation_verification_bypasses_sharing_and_saturation_falls_back_to_direct_reads() {
        let f = fixture().await;
        let keys: Vec<_> = (0..17).map(|_| snapshot()).collect();
        let mut tasks: Vec<_> = keys[..16].iter().map(|key| spawn(&f.engine, key)).collect();
        until(|| f.calls.load(Ordering::SeqCst) == 16).await;
        tasks.push(spawn(&f.engine, &keys[16]));
        tasks.push(spawn(&f.engine, &keys[16]));
        let engine = f.engine.clone();
        let key = keys[0].clone();
        let independent = tokio::spawn(async move { engine.read_snapshot(&key).await });
        until(|| f.calls.load(Ordering::SeqCst) == 19).await;
        assert_eq!(f.engine.published_reads.0.lock().unwrap().len(), 16);
        f.gate.add_permits(19);
        for task in tasks {
            assert!(task.await.unwrap().is_ok());
        }
        assert!(independent.await.unwrap().is_ok());
        assert!(f.engine.published_reads.0.lock().unwrap().is_empty());
    }
}
