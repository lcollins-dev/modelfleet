use crate::snapshot::{Device, Snapshot, SnapshotError};

#[derive(Debug, Default)]
pub struct ProviderReading {
    pub devices: Vec<Device>,
    pub errors: Vec<SnapshotError>,
}

/// A vendor's measurement layer. Implementations are read-only.
pub trait GpuProvider: Send {
    fn read(&self) -> ProviderReading;
}

/// Decided once for the lifetime of the process.
pub enum ProviderInit {
    Ready(Box<dyn GpuProvider>),
    Absent,
    Failed(SnapshotError),
}

pub trait SnapshotSource {
    fn capture(&self) -> Snapshot;
}

pub struct Registry {
    providers: Vec<Box<dyn GpuProvider>>,
    /// Replayed into every snapshot.
    standing_errors: Vec<SnapshotError>,
    clock: fn() -> String,
}

impl Registry {
    pub fn new(inits: Vec<ProviderInit>, clock: fn() -> String) -> Self {
        let mut providers = Vec::new();
        let mut standing_errors = Vec::new();

        for init in inits {
            match init {
                ProviderInit::Ready(provider) => providers.push(provider),
                ProviderInit::Absent => {}
                ProviderInit::Failed(error) => standing_errors.push(error),
            }
        }

        Self {
            providers,
            standing_errors,
            clock,
        }
    }
}

impl SnapshotSource for Registry {
    fn capture(&self) -> Snapshot {
        let mut devices = Vec::new();
        let mut errors = self.standing_errors.clone();

        for provider in &self.providers {
            let reading = provider.read();

            devices.extend(reading.devices);
            errors.extend(reading.errors);
        }

        Snapshot::new((self.clock)(), devices, errors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::{ProcessAttribution, Vendor};

    fn clock() -> String {
        "2026-08-20T12:00:00.000Z".to_owned()
    }

    fn device(uuid: &str) -> Device {
        Device {
            uuid: Some(uuid.to_owned()),
            pci_bus_id: None,
            index: 0,
            vendor: Vendor::Nvidia,
            name: None,
            memory_total_bytes: None,
            memory_used_bytes: None,
            utilisation_percent: None,
            temperature_c: None,
            power_draw_watts: None,
            process_attribution: ProcessAttribution::Exact,
            processes: vec![],
        }
    }

    struct FakeProvider {
        reading: ProviderReading,
    }

    impl GpuProvider for FakeProvider {
        fn read(&self) -> ProviderReading {
            ProviderReading {
                devices: self.reading.devices.clone(),
                errors: self.reading.errors.clone(),
            }
        }
    }

    fn ready(devices: Vec<Device>, errors: Vec<SnapshotError>) -> ProviderInit {
        ProviderInit::Ready(Box::new(FakeProvider {
            reading: ProviderReading { devices, errors },
        }))
    }

    #[test]
    fn gathers_devices_from_every_ready_provider() {
        let registry = Registry::new(
            vec![
                ready(vec![device("GPU-a")], vec![]),
                ready(vec![device("GPU-b")], vec![]),
            ],
            clock,
        );

        let snapshot = registry.capture();

        assert_eq!(snapshot.devices.len(), 2);
        assert_eq!(snapshot.captured_at, "2026-08-20T12:00:00.000Z");
    }

    #[test]
    fn an_absent_vendor_reads_as_a_machine_without_that_vendor() {
        let registry = Registry::new(vec![ProviderInit::Absent], clock);

        let snapshot = registry.capture();

        assert!(snapshot.devices.is_empty());
        assert!(snapshot.errors.is_empty());
    }

    #[test]
    fn an_initialisation_failure_is_reported_in_every_snapshot() {
        let registry = Registry::new(
            vec![ProviderInit::Failed(SnapshotError::provider(
                Vendor::Nvidia,
                "driver mismatch",
            ))],
            clock,
        );

        assert_eq!(registry.capture().errors.len(), 1);
        assert_eq!(registry.capture().errors.len(), 1);
        assert_eq!(registry.capture().errors[0].message, "driver mismatch");
    }

    #[test]
    fn a_failing_provider_still_leaves_the_others_reporting() {
        let registry = Registry::new(
            vec![
                ready(
                    vec![],
                    vec![SnapshotError::provider(Vendor::Nvidia, "enumeration failed")],
                ),
                ready(vec![device("GPU-b")], vec![]),
            ],
            clock,
        );

        let snapshot = registry.capture();

        assert_eq!(snapshot.devices.len(), 1);
        assert_eq!(snapshot.errors.len(), 1);
    }
}
