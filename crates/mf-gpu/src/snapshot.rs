use serde::Serialize;

/// Snapshot format version the agent checks before reading a line.
pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(schemars::JsonSchema))]
#[serde(rename_all = "lowercase")]
pub enum Vendor {
    Nvidia,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(schemars::JsonSchema))]
#[serde(rename_all = "lowercase")]
pub enum ProcessAttribution {
    Exact,
    Approximate,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(schemars::JsonSchema))]
#[serde(rename_all = "lowercase")]
pub enum ErrorScope {
    Provider,
    Device,
    Metric,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ProcessUsage {
    pub pid: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used_bytes: Option<u64>,
    /// The executable the vendor names for this process, where it can still be read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// Identity is `uuid`. A device the vendor cannot name that way is reported as an error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct Device {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uuid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pci_bus_id: Option<String>,
    /// Ordinal at capture time; identity comes from `uuid`.
    pub index: u32,
    pub vendor: Vendor,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_used_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub utilisation_percent: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature_c: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub power_draw_watts: Option<u32>,
    pub process_attribution: ProcessAttribution,
    pub processes: Vec<ProcessUsage>,
}

pub fn device_identity(uuid: Option<&str>) -> Option<String> {
    uuid.map(str::to_owned)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct SnapshotError {
    pub scope: ErrorScope,
    pub vendor: Vendor,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metric: Option<String>,
    pub message: String,
}

impl SnapshotError {
    pub fn provider(vendor: Vendor, message: impl Into<String>) -> Self {
        Self {
            scope: ErrorScope::Provider,
            vendor,
            device: None,
            metric: None,
            message: message.into(),
        }
    }

    pub fn device(vendor: Vendor, device: Option<String>, message: impl Into<String>) -> Self {
        Self {
            scope: ErrorScope::Device,
            vendor,
            device,
            metric: None,
            message: message.into(),
        }
    }

    pub fn metric(
        vendor: Vendor,
        device: Option<String>,
        metric: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            scope: ErrorScope::Metric,
            vendor,
            device,
            metric: Some(metric.into()),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub schema: u32,
    pub captured_at: String,
    pub devices: Vec<Device>,
    pub errors: Vec<SnapshotError>,
}

impl Snapshot {
    pub fn new(captured_at: String, devices: Vec<Device>, errors: Vec<SnapshotError>) -> Self {
        Self {
            schema: SCHEMA_VERSION,
            captured_at,
            devices,
            errors,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device() -> Device {
        Device {
            uuid: Some("GPU-4f2c".to_owned()),
            pci_bus_id: Some("0000:01:00.0".to_owned()),
            index: 0,
            vendor: Vendor::Nvidia,
            name: Some("NVIDIA GeForce RTX 3090".to_owned()),
            memory_total_bytes: Some(25_757_220_864),
            memory_used_bytes: Some(21_474_836_480),
            utilisation_percent: Some(34),
            temperature_c: Some(61),
            power_draw_watts: Some(220),
            process_attribution: ProcessAttribution::Exact,
            processes: vec![ProcessUsage {
                pid: 12345,
                used_bytes: Some(21_340_618_752),
                name: Some("/usr/bin/python3.11".to_owned()),
            }],
        }
    }

    #[test]
    fn serialises_a_device_in_the_documented_shape() {
        let snapshot = Snapshot::new("2026-08-20T12:00:00.000Z".to_owned(), vec![device()], vec![]);

        let json = serde_json::to_value(&snapshot).expect("snapshot serialises");

        assert_eq!(json["schema"], 1);
        assert_eq!(json["capturedAt"], "2026-08-20T12:00:00.000Z");
        assert_eq!(json["devices"][0]["uuid"], "GPU-4f2c");
        assert_eq!(json["devices"][0]["pciBusId"], "0000:01:00.0");
        assert_eq!(json["devices"][0]["vendor"], "nvidia");
        assert_eq!(json["devices"][0]["memoryTotalBytes"], 25_757_220_864u64);
        assert_eq!(json["devices"][0]["utilisationPercent"], 34);
        assert_eq!(json["devices"][0]["temperatureC"], 61);
        assert_eq!(json["devices"][0]["powerDrawWatts"], 220);
        assert_eq!(json["devices"][0]["processAttribution"], "exact");
        assert_eq!(json["devices"][0]["processes"][0]["pid"], 12345);
        assert_eq!(json["devices"][0]["processes"][0]["usedBytes"], 21_340_618_752u64);
        assert_eq!(json["devices"][0]["processes"][0]["name"], "/usr/bin/python3.11");
    }

    #[test]
    fn omits_every_metric_the_vendor_could_not_supply() {
        let sparse = Device {
            name: None,
            memory_total_bytes: None,
            memory_used_bytes: None,
            utilisation_percent: None,
            temperature_c: None,
            power_draw_watts: None,
            ..device()
        };

        let json =
            serde_json::to_value(Snapshot::new("t".to_owned(), vec![sparse], vec![])).expect("snapshot serialises");
        let device = &json["devices"][0];

        assert!(device.get("name").is_none());
        assert!(device.get("memoryTotalBytes").is_none());
        assert!(device.get("memoryUsedBytes").is_none());
        assert!(device.get("utilisationPercent").is_none());
        assert!(device.get("temperatureC").is_none());
        assert!(device.get("powerDrawWatts").is_none());
    }

    #[test]
    fn omits_a_process_byte_count_the_vendor_could_not_attribute() {
        let unattributed = Device {
            process_attribution: ProcessAttribution::Approximate,
            processes: vec![ProcessUsage {
                pid: 7,
                used_bytes: None,
                name: None,
            }],
            ..device()
        };

        let json = serde_json::to_value(Snapshot::new("t".to_owned(), vec![unattributed], vec![]))
            .expect("snapshot serialises");
        let process = &json["devices"][0]["processes"][0];

        assert_eq!(process["pid"], 7);
        assert!(process.get("usedBytes").is_none());
        assert!(process.get("name").is_none());
        assert_eq!(json["devices"][0]["processAttribution"], "approximate");
    }

    #[test]
    fn a_machine_with_no_devices_still_produces_a_valid_snapshot() {
        let json = serde_json::to_value(Snapshot::new("t".to_owned(), vec![], vec![])).expect("snapshot serialises");

        assert_eq!(json["schema"], 1);
        assert_eq!(json["devices"].as_array().expect("devices is a list").len(), 0);
        assert_eq!(json["errors"].as_array().expect("errors is a list").len(), 0);
    }

    #[test]
    fn serialises_each_error_scope_with_the_fields_that_scope_carries() {
        let errors = vec![
            SnapshotError::provider(Vendor::Nvidia, "driver mismatch"),
            SnapshotError::device(Vendor::Nvidia, Some("GPU-4f2c".to_owned()), "handle lost"),
            SnapshotError::metric(
                Vendor::Nvidia,
                Some("GPU-4f2c".to_owned()),
                "temperature",
                "read failed",
            ),
        ];

        let json = serde_json::to_value(Snapshot::new("t".to_owned(), vec![], errors)).expect("snapshot serialises");

        assert_eq!(json["errors"][0]["scope"], "provider");
        assert!(json["errors"][0].get("device").is_none());
        assert!(json["errors"][0].get("metric").is_none());

        assert_eq!(json["errors"][1]["scope"], "device");
        assert_eq!(json["errors"][1]["device"], "GPU-4f2c");
        assert!(json["errors"][1].get("metric").is_none());

        assert_eq!(json["errors"][2]["scope"], "metric");
        assert_eq!(json["errors"][2]["metric"], "temperature");
        assert_eq!(json["errors"][2]["message"], "read failed");
    }

    #[test]
    fn identity_is_the_uuid_the_vendor_gives() {
        assert_eq!(device_identity(Some("GPU-4f2c")), Some("GPU-4f2c".to_owned()));
    }

    #[test]
    fn a_device_the_vendor_gives_no_uuid_for_has_no_identity() {
        assert_eq!(device_identity(None), None);
    }
}

#[cfg(test)]
mod contract {
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;

    use serde_json::{Map, Value, json};

    use super::*;

    /// `apps/agent/src/telemetry/device-reader/gpu-snapshot.contract.test.ts` reads the same file.
    const CONTRACT: &str = "snapshot.contract.json";

    fn contract() -> Value {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(CONTRACT);
        let text = fs::read_to_string(path).expect("the contract is readable");

        serde_json::from_str(&text).expect("the contract is json")
    }

    fn resolve<'a>(node: &'a Value, defs: &'a Map<String, Value>) -> &'a Value {
        match node.get("$ref").and_then(Value::as_str) {
            Some(reference) => {
                let name = reference.rsplit('/').next().expect("a ref names a definition");

                defs.get(name).expect("a ref resolves to a definition")
            }
            None => node,
        }
    }

    /// An `Option` reaches the schema as `["integer", "null"]`; `required` carries the optionality instead.
    fn type_of(node: &Value) -> String {
        match &node["type"] {
            Value::String(name) => name.clone(),
            Value::Array(names) => names
                .iter()
                .filter_map(Value::as_str)
                .find(|name| *name != "null")
                .expect("a type beside null")
                .to_owned(),
            other => panic!("a field with no type: {other}"),
        }
    }

    fn describe(node: &Value, required: bool) -> Value {
        let mut described = json!({ "type": type_of(node), "required": required });

        if let Some(values) = node.get("enum") {
            described["enum"] = values.clone();
        }

        described
    }

    fn walk(node: &Value, defs: &Map<String, Value>, path: &str, fields: &mut BTreeMap<String, Value>) {
        let node = resolve(node, defs);

        match type_of(node).as_str() {
            "object" => {
                let required: Vec<&str> = node
                    .get("required")
                    .and_then(Value::as_array)
                    .map(|names| names.iter().filter_map(Value::as_str).collect())
                    .unwrap_or_default();

                let properties = node["properties"].as_object().expect("an object lists its properties");

                for (key, child) in properties {
                    let child_path = if path.is_empty() {
                        key.clone()
                    } else {
                        format!("{path}.{key}")
                    };

                    fields.insert(
                        child_path.clone(),
                        describe(resolve(child, defs), required.contains(&key.as_str())),
                    );
                    walk(child, defs, &child_path, fields);
                }
            }
            "array" => {
                let item_path = format!("{path}[]");
                let items = &node["items"];

                fields.insert(item_path.clone(), describe(resolve(items, defs), true));
                walk(items, defs, &item_path, fields);
            }
            _ => {}
        }
    }

    fn projected() -> Value {
        let schema = serde_json::to_value(schemars::schema_for!(Snapshot)).expect("the schema serialises");
        let empty = Map::new();
        let defs = schema.get("$defs").and_then(Value::as_object).unwrap_or(&empty).clone();

        let mut fields = BTreeMap::new();
        walk(&schema, &defs, "", &mut fields);

        serde_json::to_value(fields).expect("the projection serialises")
    }

    fn differences(produced: &Value, stated: &Value) -> Vec<String> {
        let produced = produced.as_object().expect("the projection is an object");
        let stated = stated.as_object().expect("the contract states an object");

        let mut paths: Vec<&String> = produced.keys().chain(stated.keys()).collect();
        paths.sort_unstable();
        paths.dedup();

        paths
            .into_iter()
            .filter(|path| produced.get(*path) != stated.get(*path))
            .map(|path| match (produced.get(path), stated.get(path)) {
                (Some(crate_side), Some(contract_side)) => {
                    format!("{path}: the crate has {crate_side}, the contract states {contract_side}")
                }
                (Some(crate_side), None) => format!("{path}: the crate has {crate_side}, the contract states nothing"),
                (None, _) => format!("{path}: the contract states it, the crate does not serialise it"),
            })
            .collect()
    }

    #[test]
    fn every_field_this_crate_serialises_is_the_field_the_contract_states() {
        let differences = differences(&projected(), &contract()["fields"]);

        assert!(
            differences.is_empty(),
            "the snapshot no longer matches {CONTRACT}:\n  {}\nWhere the change is intended, edit the contract \
             and follow it on the agent's side until its own contract test passes.",
            differences.join("\n  ")
        );
    }

    #[test]
    fn the_schema_version_is_the_one_the_contract_states() {
        assert_eq!(Value::from(SCHEMA_VERSION), contract()["version"]);
    }
}
