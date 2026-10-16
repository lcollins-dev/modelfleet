use std::collections::BTreeMap;

use nvml_wrapper::Nvml;
use nvml_wrapper::enum_wrappers::device::TemperatureSensor;
use nvml_wrapper::enums::device::UsedGpuMemory;
use nvml_wrapper::error::NvmlError;

use crate::provider::{GpuProvider, ProviderInit, ProviderReading};
use crate::snapshot::{Device, ProcessAttribution, ProcessUsage, SnapshotError, Vendor, device_identity};

const VENDOR: Vendor = Vendor::Nvidia;

/// NVML writes the executable path into a buffer this long.
const PROCESS_NAME_LENGTH: usize = 256;

/// An idle card holds driver baseline no process owns - 960 KiB on an RTX 3090. The smallest process a
/// backend runs, a bare CUDA context, holds 498 MiB on an RTX 5090.
const UNSEEN_MEMORY_THRESHOLD_BYTES: u64 = 32 * 1_024 * 1_024;

/// NVML is initialised once per process; cycling it leaks a file descriptor each time.
pub struct NvidiaProvider {
    nvml: Nvml,
}

impl NvidiaProvider {
    pub fn initialise() -> ProviderInit {
        match Nvml::init() {
            Ok(nvml) => ProviderInit::Ready(Box::new(Self { nvml })),
            Err(error) => classify_init_failure(error),
        }
    }
}

fn classify_init_failure(error: NvmlError) -> ProviderInit {
    match error {
        NvmlError::LibloadingError(_) | NvmlError::DriverNotLoaded => ProviderInit::Absent,
        error => ProviderInit::Failed(SnapshotError::provider(VENDOR, error.to_string())),
    }
}

impl GpuProvider for NvidiaProvider {
    fn read(&self) -> ProviderReading {
        let mut reading = ProviderReading::default();

        let count = match self.nvml.device_count() {
            Ok(count) => count,
            Err(error) => {
                reading.errors.push(SnapshotError::provider(VENDOR, error.to_string()));

                return reading;
            }
        };

        for index in 0..count {
            match self.nvml.device_by_index(index) {
                Ok(device) => match read_device(&self.nvml, &device, index, &mut reading.errors) {
                    Some(device) => reading.devices.push(device),
                    None => reading.errors.push(SnapshotError::device(
                        VENDOR,
                        None,
                        format!("device at index {index} reports no uuid"),
                    )),
                },
                Err(error) => reading
                    .errors
                    .push(SnapshotError::device(VENDOR, None, error.to_string())),
            }
        }

        reading
    }
}

fn read_device(
    nvml: &Nvml,
    device: &nvml_wrapper::Device<'_>,
    index: u32,
    errors: &mut Vec<SnapshotError>,
) -> Option<Device> {
    let uuid = metric(device.uuid(), None, "uuid", errors);
    let pci_bus_id = metric(device.pci_info(), None, "pciBusId", errors).map(|info| info.bus_id);

    let identity = device_identity(uuid.as_deref())?;
    let memory = metric(device.memory_info(), Some(&identity), "memory", errors);
    let utilisation = metric(device.utilization_rates(), Some(&identity), "utilisation", errors);
    let (reported_attribution, processes) = read_processes(nvml, device, &identity, errors);
    let memory_used_bytes = memory.as_ref().map(|memory| memory.used);

    Some(Device {
        uuid,
        pci_bus_id,
        index,
        vendor: VENDOR,
        name: metric(device.name(), Some(&identity), "name", errors),
        memory_total_bytes: memory.as_ref().map(|memory| memory.total),
        memory_used_bytes,
        utilisation_percent: utilisation.map(|utilisation| utilisation.gpu),
        temperature_c: metric(
            device.temperature(TemperatureSensor::Gpu),
            Some(&identity),
            "temperature",
            errors,
        ),
        power_draw_watts: metric(device.power_usage(), Some(&identity), "power", errors).map(milliwatts_to_watts),
        process_attribution: attribution_for(reported_attribution, &processes, memory_used_bytes),
        processes,
    })
}

/// A reader that cannot see the processes, such as a PID-namespaced container, sees memory held against an
/// empty process list.
fn attribution_for(
    reported: ProcessAttribution,
    processes: &[ProcessUsage],
    memory_used_bytes: Option<u64>,
) -> ProcessAttribution {
    let memory_is_held = memory_used_bytes.is_some_and(|used| used > UNSEEN_MEMORY_THRESHOLD_BYTES);

    match reported {
        ProcessAttribution::Exact if processes.is_empty() && memory_is_held => ProcessAttribution::Unavailable,
        reported => reported,
    }
}

/// NVML reports the whole command line, and arguments are where a backend's secrets sit.
fn executable_of(command: &str) -> Option<String> {
    let executable = command.split_whitespace().next()?;

    match executable.is_empty() {
        true => None,
        false => Some(executable.to_owned()),
    }
}

/// A process that exits between being listed and being named simply has none.
fn process_name(nvml: &Nvml, pid: u32) -> Option<String> {
    nvml.sys_process_name(pid, PROCESS_NAME_LENGTH)
        .ok()
        .and_then(|command| executable_of(&command))
}

fn read_processes(
    nvml: &Nvml,
    device: &nvml_wrapper::Device<'_>,
    identity: &str,
    errors: &mut Vec<SnapshotError>,
) -> (ProcessAttribution, Vec<ProcessUsage>) {
    let compute = metric(
        device.running_compute_processes(),
        Some(identity),
        "computeProcesses",
        errors,
    );
    let graphics = metric(
        device.running_graphics_processes(),
        Some(identity),
        "graphicsProcesses",
        errors,
    );

    if compute.is_none() && graphics.is_none() {
        return (ProcessAttribution::Unavailable, vec![]);
    }

    let mut by_pid: BTreeMap<u32, Option<u64>> = BTreeMap::new();

    for process in compute.into_iter().chain(graphics).flatten() {
        let used_bytes = match process.used_gpu_memory {
            UsedGpuMemory::Used(bytes) => Some(bytes),
            UsedGpuMemory::Unavailable => None,
        };

        by_pid
            .entry(process.pid)
            .and_modify(|known| *known = known.or(used_bytes))
            .or_insert(used_bytes);
    }

    let processes: Vec<ProcessUsage> = by_pid
        .into_iter()
        .map(|(pid, used_bytes)| ProcessUsage {
            pid,
            used_bytes,
            name: process_name(nvml, pid),
        })
        .collect();

    let attribution = match processes.iter().all(|process| process.used_bytes.is_some()) {
        true => ProcessAttribution::Exact,
        false => ProcessAttribution::Approximate,
    };

    (attribution, processes)
}

fn metric<T>(
    result: Result<T, NvmlError>,
    device: Option<&str>,
    name: &str,
    errors: &mut Vec<SnapshotError>,
) -> Option<T> {
    match result {
        Ok(value) => Some(value),
        Err(NvmlError::NotSupported) => None,
        Err(error) => {
            errors.push(SnapshotError::metric(
                VENDOR,
                device.map(str::to_owned),
                name,
                error.to_string(),
            ));

            None
        }
    }
}

fn milliwatts_to_watts(milliwatts: u32) -> u32 {
    (milliwatts + 500) / 1_000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_process_name_is_the_executable_alone() {
        assert_eq!(
            executable_of("/usr/bin/python3.11"),
            Some("/usr/bin/python3.11".to_owned())
        );
    }

    #[test]
    fn a_process_name_drops_the_arguments_a_command_line_carries() {
        let command = "/opt/vllm/bin/python -m vllm.entrypoints.api_server --api-key sk-secret";

        assert_eq!(executable_of(command), Some("/opt/vllm/bin/python".to_owned()));
    }

    #[test]
    fn a_command_line_of_whitespace_names_nothing() {
        assert_eq!(executable_of("   "), None);
    }

    #[test]
    fn an_empty_command_line_names_nothing() {
        assert_eq!(executable_of(""), None);
    }

    #[test]
    fn an_unsupported_metric_is_omitted_without_an_error() {
        let mut errors = vec![];

        let value = metric::<u32>(Err(NvmlError::NotSupported), Some("GPU-a"), "temperature", &mut errors);

        assert_eq!(value, None);
        assert!(errors.is_empty());
    }

    #[test]
    fn a_failed_metric_is_omitted_and_recorded() {
        let mut errors = vec![];

        let value = metric::<u32>(Err(NvmlError::NoPermission), Some("GPU-a"), "temperature", &mut errors);

        assert_eq!(value, None);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].metric.as_deref(), Some("temperature"));
        assert_eq!(errors[0].device.as_deref(), Some("GPU-a"));
    }

    #[test]
    fn a_supplied_metric_is_yielded() {
        let mut errors = vec![];

        let value = metric(Ok(61u32), Some("GPU-a"), "temperature", &mut errors);

        assert_eq!(value, Some(61));
        assert!(errors.is_empty());
    }

    #[test]
    fn a_machine_without_the_nvidia_driver_carries_no_nvidia_device() {
        assert!(matches!(
            classify_init_failure(NvmlError::DriverNotLoaded),
            ProviderInit::Absent
        ));
    }

    #[test]
    fn a_present_but_unusable_stack_is_reported_as_a_failure() {
        let init = classify_init_failure(NvmlError::NoPermission);

        match init {
            ProviderInit::Failed(error) => assert_eq!(error.vendor, Vendor::Nvidia),
            _ => panic!("an unusable stack is a failure"),
        }
    }

    fn process(pid: u32) -> ProcessUsage {
        ProcessUsage {
            pid,
            used_bytes: Some(1_024),
            name: Some("python3".to_owned()),
        }
    }

    #[test]
    fn memory_held_with_no_visible_process_is_not_attributed() {
        let attribution = attribution_for(ProcessAttribution::Exact, &[], Some(2_266_103_808));

        assert_eq!(attribution, ProcessAttribution::Unavailable);
    }

    #[test]
    fn an_idle_device_holding_nothing_is_attributed_exactly() {
        let attribution = attribution_for(ProcessAttribution::Exact, &[], Some(0));

        assert_eq!(attribution, ProcessAttribution::Exact);
    }

    #[test]
    fn an_idle_device_holding_driver_baseline_is_attributed_exactly() {
        let attribution = attribution_for(ProcessAttribution::Exact, &[], Some(983_040));

        assert_eq!(attribution, ProcessAttribution::Exact);
    }

    #[test]
    fn memory_held_at_the_threshold_is_still_attributed_exactly() {
        let attribution = attribution_for(ProcessAttribution::Exact, &[], Some(UNSEEN_MEMORY_THRESHOLD_BYTES));

        assert_eq!(attribution, ProcessAttribution::Exact);
    }

    #[test]
    fn memory_held_past_the_threshold_with_no_visible_process_is_not_attributed() {
        let attribution = attribution_for(ProcessAttribution::Exact, &[], Some(UNSEEN_MEMORY_THRESHOLD_BYTES + 1));

        assert_eq!(attribution, ProcessAttribution::Unavailable);
    }

    #[test]
    fn a_device_whose_processes_are_visible_keeps_its_attribution() {
        let attribution = attribution_for(ProcessAttribution::Exact, &[process(7)], Some(2_266_103_808));

        assert_eq!(attribution, ProcessAttribution::Exact);
    }

    #[test]
    fn a_vendor_that_cannot_enumerate_stays_unavailable() {
        let attribution = attribution_for(ProcessAttribution::Unavailable, &[], Some(0));

        assert_eq!(attribution, ProcessAttribution::Unavailable);
    }

    #[test]
    fn a_partly_attributed_device_stays_approximate() {
        let attribution = attribution_for(ProcessAttribution::Approximate, &[process(7)], Some(2_266_103_808));

        assert_eq!(attribution, ProcessAttribution::Approximate);
    }

    #[test]
    fn a_device_whose_memory_could_not_be_read_keeps_its_attribution() {
        let attribution = attribution_for(ProcessAttribution::Exact, &[], None);

        assert_eq!(attribution, ProcessAttribution::Exact);
    }

    #[test]
    fn power_is_reported_in_watts() {
        assert_eq!(milliwatts_to_watts(220_000), 220);
        assert_eq!(milliwatts_to_watts(220_400), 220);
        assert_eq!(milliwatts_to_watts(220_600), 221);
        assert_eq!(milliwatts_to_watts(0), 0);
    }
}
