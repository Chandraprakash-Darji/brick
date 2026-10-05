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
}
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ActionManifest {
    pub name: String,
    pub has_authorize: bool,
}
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResourceManifest {
    pub name: String,
    pub owner_field: Option<String>,
    pub operations: Vec<String>,
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
