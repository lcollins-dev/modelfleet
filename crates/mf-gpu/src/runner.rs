use std::io::{self, BufRead, Write};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::Instant;

use crate::provider::SnapshotSource;

pub struct Request;

#[derive(Debug, PartialEq, Eq)]
pub enum Trigger {
    Requested,
    Scheduled,
}

/// Flushes each snapshot, so a reader sees it at capture time.
pub fn emit(source: &impl SnapshotSource, out: &mut impl Write) -> io::Result<()> {
    let line = serde_json::to_string(&source.capture()).map_err(io::Error::other)?;

    out.write_all(line.as_bytes())?;
    out.write_all(b"\n")?;
    out.flush()
}

pub fn wait_for_next(requests: &Receiver<Request>, deadline: Instant) -> Trigger {
    let wait = deadline.saturating_duration_since(Instant::now());

    match requests.recv_timeout(wait) {
        Ok(Request) => Trigger::Requested,
        Err(RecvTimeoutError::Timeout) => Trigger::Scheduled,
        Err(RecvTimeoutError::Disconnected) => {
            thread::sleep(wait);
            Trigger::Scheduled
        }
    }
}

pub fn forward_requests(input: impl BufRead, requests: Sender<Request>) {
    for line in input.lines() {
        if line.is_err() || requests.send(Request).is_err() {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::Snapshot;
    use std::sync::mpsc;
    use std::time::Duration;

    struct FixedSource;

    impl SnapshotSource for FixedSource {
        fn capture(&self) -> Snapshot {
            Snapshot::new("2026-08-20T12:00:00.000Z".to_owned(), vec![], vec![])
        }
    }

    #[test]
    fn emits_one_json_object_per_line() {
        let mut out = Vec::new();

        emit(&FixedSource, &mut out).expect("write succeeds");
        emit(&FixedSource, &mut out).expect("write succeeds");

        let written = String::from_utf8(out).expect("output is utf-8");
        let lines: Vec<&str> = written.lines().collect();

        assert_eq!(lines.len(), 2);
        assert!(written.ends_with('\n'));

        for line in lines {
            let parsed: serde_json::Value = serde_json::from_str(line).expect("line is one json object");

            assert_eq!(parsed["schema"], 1);
        }
    }

    #[test]
    fn a_write_failure_is_reported_to_the_caller() {
        struct ClosedPipe;

        impl Write for ClosedPipe {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::Error::from(io::ErrorKind::BrokenPipe))
            }

            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }

        let error = emit(&FixedSource, &mut ClosedPipe).expect_err("write fails");

        assert_eq!(error.kind(), io::ErrorKind::BrokenPipe);
    }

    #[test]
    fn a_request_wakes_the_wait_before_the_deadline() {
        let (sender, receiver) = mpsc::channel();
        sender.send(Request).expect("request is queued");

        let trigger = wait_for_next(&receiver, Instant::now() + Duration::from_secs(30));

        assert_eq!(trigger, Trigger::Requested);
    }

    #[test]
    fn the_deadline_triggers_a_snapshot_with_no_request_pending() {
        let (sender, receiver) = mpsc::channel();

        let trigger = wait_for_next(&receiver, Instant::now() + Duration::from_millis(10));

        assert_eq!(trigger, Trigger::Scheduled);
        drop(sender);
    }

    #[test]
    fn snapshots_keep_their_schedule_once_the_agent_closes_its_input() {
        let (sender, receiver) = mpsc::channel::<Request>();
        drop(sender);

        let started = Instant::now();
        let trigger = wait_for_next(&receiver, started + Duration::from_millis(50));

        assert_eq!(trigger, Trigger::Scheduled);
        assert!(started.elapsed() >= Duration::from_millis(50));
    }

    #[test]
    fn every_line_of_input_becomes_one_request() {
        let (sender, receiver) = mpsc::channel();

        forward_requests(io::Cursor::new("snapshot\nsnapshot\n"), sender);

        assert_eq!(receiver.iter().count(), 2);
    }
}
