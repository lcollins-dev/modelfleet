mod cli;
mod provider;
mod providers;
mod runner;
mod snapshot;

use std::io::{self, BufReader, Write};
use std::process::ExitCode;
use std::sync::mpsc;
use std::thread;
use std::time::Instant;

use chrono::{SecondsFormat, Utc};
use clap::Parser;

use crate::cli::Options;
use crate::provider::Registry;
use crate::providers::nvidia::NvidiaProvider;
use crate::runner::{Request, emit, forward_requests, wait_for_next};

fn main() -> ExitCode {
    let options = Options::parse();
    let registry = Registry::new(vec![NvidiaProvider::initialise()], captured_at);

    let (sender, requests) = mpsc::channel::<Request>();
    thread::spawn(move || forward_requests(BufReader::new(io::stdin()), sender));

    let mut out = io::stdout().lock();

    loop {
        if let Err(error) = emit(&registry, &mut out) {
            let _ = writeln!(io::stderr(), "mf-gpu: snapshots can no longer be written: {error}");

            return ExitCode::FAILURE;
        }

        wait_for_next(&requests, Instant::now() + options.interval());
    }
}

fn captured_at() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
