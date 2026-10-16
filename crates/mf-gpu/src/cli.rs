use std::time::Duration;

use clap::Parser;

#[derive(Debug, Parser)]
#[command(name = "mf-gpu", version, about, long_about = None)]
pub struct Options {
    /// Seconds between scheduled snapshots. A request on stdin yields one immediately.
    #[arg(
        long,
        env = "MF_GPU_INTERVAL_SECONDS",
        default_value_t = 5,
        value_parser = clap::value_parser!(u64).range(1..)
    )]
    pub interval_seconds: u64,
}

impl Options {
    pub fn interval(&self) -> Duration {
        Duration::from_secs(self.interval_seconds)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn defaults_to_a_five_second_interval() {
        let options = Options::parse_from(["mf-gpu"]);

        assert_eq!(options.interval(), Duration::from_secs(5));
    }

    #[test]
    fn takes_the_interval_from_the_command_line() {
        let options = Options::parse_from(["mf-gpu", "--interval-seconds", "30"]);

        assert_eq!(options.interval(), Duration::from_secs(30));
    }

    #[test]
    fn rejects_an_interval_of_zero() {
        let parsed = Options::try_parse_from(["mf-gpu", "--interval-seconds", "0"]);

        assert!(parsed.is_err());
    }

    #[test]
    fn the_command_definition_is_valid() {
        Options::command().debug_assert();
    }
}
