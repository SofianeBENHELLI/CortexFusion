//! Process lifecycle controls; no runtime control action is exposed to companions.
use std::time::Duration;

pub struct Signals {
    #[cfg(unix)]
    terminate: tokio::signal::unix::Signal,
    #[cfg(unix)]
    interrupt: tokio::signal::unix::Signal,
}
impl Signals {
    pub fn install() -> std::io::Result<Self> {
        Ok(Self {
            #[cfg(unix)]
            terminate: tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?,
            #[cfg(unix)]
            interrupt: tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())?,
        })
    }
    pub async fn receive(&mut self) -> std::io::Result<()> {
        #[cfg(unix)]
        {
            tokio::select! {
                _ = self.terminate.recv() => {},
                _ = self.interrupt.recv() => {},
            }
            Ok(())
        }
        #[cfg(not(unix))]
        {
            tokio::signal::ctrl_c().await
        }
    }
}
pub fn grace_seconds(value: Option<&str>) -> Result<Duration, &'static str> {
    let seconds = value
        .unwrap_or("75")
        .parse::<u64>()
        .map_err(|_| "Invalid shutdown grace period")?;
    if !(1..=300).contains(&seconds) {
        return Err("Shutdown grace period must be between 1 and 300 seconds");
    }
    Ok(Duration::from_secs(seconds))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn drain_configuration_is_bounded() {
        assert_eq!(grace_seconds(None).unwrap().as_secs(), 75);
        for invalid in ["", "0", "301", "-1", "1.5", "18446744073709551616"] {
            assert!(grace_seconds(Some(invalid)).is_err());
        }
        assert_eq!(grace_seconds(Some("1")).unwrap().as_secs(), 1);
        assert_eq!(grace_seconds(Some("300")).unwrap().as_secs(), 300);
    }
}
