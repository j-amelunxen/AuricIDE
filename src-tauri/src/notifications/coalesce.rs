//! Turns a burst of file events into a bounded number of announcements.

use std::sync::mpsc::{self, RecvTimeoutError, SyncSender, TrySendError};
use std::time::{Duration, Instant};

/// Starts a worker that calls `on_change` for the events sent into the
/// returned channel: at once for the first event, then at most once per
/// `window`. An event arriving inside a window is never dropped; it is
/// folded into one announcement at the window's end, so the last thing a
/// listener hears about always comes after the last write.
///
/// The worker ends when every sender is dropped, i.e. with the watcher that
/// owns it. Send with [`notify`]: the queue holds one event, which is all an
/// announcement needs, so a storm of raw events costs no memory.
pub(crate) fn coalesce<F>(window: Duration, on_change: F) -> SyncSender<()>
where
    F: Fn() + Send + 'static,
{
    let (tx, rx) = mpsc::sync_channel::<()>(1);
    std::thread::spawn(move || {
        // Idle: block until something happens, announce it, open a window.
        while rx.recv().is_ok() {
            on_change();
            let mut window_ends = Instant::now() + window;
            let mut pending = false;
            loop {
                let wait = window_ends.saturating_duration_since(Instant::now());
                match rx.recv_timeout(wait) {
                    Ok(()) => pending = true,
                    Err(RecvTimeoutError::Timeout) if pending => {
                        on_change();
                        pending = false;
                        window_ends = Instant::now() + window;
                    }
                    Err(RecvTimeoutError::Timeout) => break,
                    // The watcher is gone; nobody is listening any more.
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
        }
    });
    tx
}

/// Queues one event for the worker. A full queue already holds an event that
/// will be announced, so this one is covered by it. Returns false once the
/// worker is gone.
pub(crate) fn notify(tx: &SyncSender<()>) -> bool {
    !matches!(tx.try_send(()), Err(TrySendError::Disconnected(_)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    const WINDOW: Duration = Duration::from_millis(300);

    fn recorder() -> (Arc<Mutex<Vec<Instant>>>, impl Fn() + Send + 'static) {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&calls);
        (calls, move || sink.lock().unwrap().push(Instant::now()))
    }

    #[test]
    fn a_single_event_is_announced_at_once() {
        let (calls, on_change) = recorder();
        let tx = coalesce(WINDOW, on_change);
        let sent = Instant::now();
        assert!(notify(&tx));
        std::thread::sleep(Duration::from_millis(100));
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert!(calls[0].duration_since(sent) < WINDOW);
    }

    /// Two grant writes from another instance, 50 ms apart: the second one
    /// must still be announced, after it happened, or a waiting request is
    /// re-read against the state before it.
    #[test]
    fn an_event_inside_the_window_is_announced_after_it_not_dropped() {
        let (calls, on_change) = recorder();
        let tx = coalesce(WINDOW, on_change);
        assert!(notify(&tx));
        std::thread::sleep(Duration::from_millis(50));
        let second = Instant::now();
        assert!(notify(&tx));
        std::thread::sleep(WINDOW * 3);
        let calls = calls.lock().unwrap();
        assert!(
            calls.iter().any(|at| *at >= second),
            "no announcement after the second event: {} call(s)",
            calls.len()
        );
    }

    /// The trailing announcement must not turn a storm into a storm of
    /// announcements: at most one per window, and the last one after the last
    /// event.
    #[test]
    fn a_storm_is_announced_at_most_once_per_window_and_ends_after_it() {
        let (calls, on_change) = recorder();
        let tx = coalesce(WINDOW, on_change);
        let start = Instant::now();
        let mut last = start;
        while start.elapsed() < Duration::from_millis(1000) {
            last = Instant::now();
            assert!(notify(&tx));
            std::thread::sleep(Duration::from_millis(5));
        }
        std::thread::sleep(WINDOW * 3);
        let calls = calls.lock().unwrap();
        // 1000 ms of events plus one trailing window: at most five slots.
        assert!(
            calls.len() <= 5,
            "{} announcements for one storm",
            calls.len()
        );
        for pair in calls.windows(2) {
            assert!(pair[1].duration_since(pair[0]) >= WINDOW - Duration::from_millis(20));
        }
        assert!(
            calls.last().is_some_and(|at| *at >= last),
            "storm's last event never announced"
        );
    }

    #[test]
    fn the_worker_ends_when_the_sender_is_dropped() {
        let (calls, on_change) = recorder();
        let tx = coalesce(WINDOW, on_change);
        assert!(notify(&tx));
        drop(tx);
        std::thread::sleep(WINDOW * 2);
        assert_eq!(calls.lock().unwrap().len(), 1);
    }
}
