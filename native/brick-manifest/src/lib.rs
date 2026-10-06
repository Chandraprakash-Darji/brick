use serde::Deserialize;

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: u32,
    pub services: Vec<ServiceManifest>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServiceManifest {
    pub name: String,
    pub actions: Vec<ActionManifest>,
    pub resources: Vec<ResourceManifest>,
    #[serde(default)]
    pub tables: Vec<TableManifest>,
}
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ActionManifest {
    pub name: String,
    #[serde(default)]
    pub has_authorize: bool,
}
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResourceManifest {
    pub name: String,
    pub owner_field: Option<String>,
    pub operations: Vec<String>,
    pub table: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TableManifest {
    pub name: String,
    pub fields: Vec<FieldManifest>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FieldManifest {
    pub name: String,
    pub primary_key: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum ManifestError {
    #[error("invalid json: {0}")]
    InvalidJson(#[from] serde_json::Error),
    #[error("unsupported version {got}, want 1")]
    UnsupportedVersion { got: u32 },
    #[error("invalid definition: {0}")]
    InvalidDefinition(String),
}

pub fn decode(text: &str) -> Result<Manifest, ManifestError> {
    let m: Manifest = serde_json::from_str(&text)?;

    if m.version != 1 {
        return Err(ManifestError::UnsupportedVersion { got: m.version });
    }

    Ok(m)
}
