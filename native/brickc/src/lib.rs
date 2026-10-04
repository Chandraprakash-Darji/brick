mod http;
pub use http::{NativeField, NativeReadPlan, NativeWritePlan};
use std::path::Path;

pub use brick_hir::types::{ActionId, FieldId, Hir, HirError, ResourceId, ServiceId};
pub use brick_manifest::{Manifest, ManifestError};
pub use brick_query::{QueryError, RelExpr, to_sql};
pub use brick_resource::{ResourceError, ResourcePlan, ResourcePlans};
pub use brick_router::{Route, RouteTarget, Router, RouterError};

#[derive(Debug, thiserror::Error)]
pub enum CompileError {
    #[error("manifest error: {0}")]
    Manifest(#[from] ManifestError),
    #[error("hir error: {0}")]
    Hir(#[from] HirError),
    #[error("router error: {0}")]
    Router(#[from] RouterError),
    #[error("resource error: {0}")]
    Resource(#[from] ResourceError),
    #[error("query error: {0}")]
    Query(#[from] QueryError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PlanSummary {
    pub service_count: usize,
    pub resource_count: usize,
    pub action_count: usize,
    pub route_count: usize,
    pub resource_plan_count: usize,
}

pub struct CompiledArtifacts {
    pub manifest: Manifest,
    pub hir: Hir,
    pub router: Router,
    pub resources: ResourcePlans,
}

impl CompiledArtifacts {
    pub fn summary(&self) -> PlanSummary {
        PlanSummary {
            service_count: self.hir.services.len(),
            resource_count: self.hir.resources.len(),
            action_count: self.hir.actions.len(),
            route_count: self.router.routes.len(),
            resource_plan_count: self.resources.plans.len(),
        }
    }

    pub fn query_for(
        &self,
        service: &str,
        resource: &str,
        operation: &str,
        limit: Option<u32>,
    ) -> Result<RelExpr, CompileError> {
        let plan = self
            .resources
            .find(service, resource)
            .ok_or_else(|| QueryError::InvalidOperation(format!("{service}.{resource}")))?;
        let expr = brick_query::plan_for_operation(plan, operation, limit)?;
        Ok(expr)
    }

    pub fn sql_for(
        &self,
        service: &str,
        resource: &str,
        operation: &str,
        limit: Option<u32>,
    ) -> Result<String, CompileError> {
        let expr = self.query_for(service, resource, operation, limit)?;
        Ok(to_sql(&expr))
    }
}

pub fn compile_manifest(manifest: Manifest) -> Result<CompiledArtifacts, CompileError> {
    let hir = brick_hir::lower(&manifest)?;
    let router = brick_router::build(&hir)?;
    let resources = brick_resource::build(&hir)?;
    Ok(CompiledArtifacts {
        manifest,
        hir,
        router,
        resources,
    })
}

pub fn compile_json(json: &str) -> Result<CompiledArtifacts, CompileError> {
    let manifest = brick_manifest::decode(json)?;
    compile_manifest(manifest)
}

pub fn compile_file(path: impl AsRef<Path>) -> Result<CompiledArtifacts, CompileError> {
    let content = std::fs::read_to_string(path)?;
    compile_json(&content)
}

/// Runtime artifact for Bun SQLite resource lookups. Ownership remains in the
/// TypeScript resource action so existing 403/404 semantics are preserved.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeArtifact {
    pub version: u32,
    pub source_manifest: String,
    pub resources: Vec<RuntimeResource>,
    #[serde(default)]
    pub native_reads: Vec<NativeReadPlan>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeResource {
    pub service: String,
    pub resource: String,
    pub get_sql: String,
}

pub fn compile_runtime_json(json: &str) -> Result<RuntimeArtifact, CompileError> {
    // Run semantic validation before producing any executable SQL.
    let artifacts = compile_json(json)?;
    // Retain database column names from the authoring manifest (HIR currently
    // tracks logical names only).
    let source: serde_json::Value =
        serde_json::from_str(json).map_err(ManifestError::InvalidJson)?;
    let mut resources = Vec::new();
    for (service_index, service) in artifacts.manifest.services.iter().enumerate() {
        for resource in &service.resources {
            let table = service
                .tables
                .iter()
                .find(|t| Some(&t.name) == resource.table.as_ref())
                .ok_or_else(|| QueryError::InvalidOperation(resource.name.clone()))?;
            let pk = table
                .fields
                .iter()
                .find(|f| f.primary_key)
                .ok_or_else(|| QueryError::InvalidOperation(resource.name.clone()))?;
            let source_table = source["services"][service_index]["tables"]
                .as_array()
                .and_then(|tables| {
                    tables
                        .iter()
                        .find(|t| t["name"].as_str() == Some(&table.name))
                })
                .ok_or_else(|| QueryError::InvalidOperation(table.name.clone()))?;
            let db_pk = source_table["fields"]
                .as_array()
                .and_then(|fields| fields.iter().find(|f| f["name"].as_str() == Some(&pk.name)))
                .and_then(|f| f["dbName"].as_str())
                .unwrap_or(&pk.name);
            let quote = |name: &str| format!("\"{}\"", name.replace('"', "\"\""));
            resources.push(RuntimeResource {
                service: service.name.clone(),
                resource: resource.name.clone(),
                get_sql: format!(
                    "SELECT * FROM {} WHERE {} = $1 LIMIT 1",
                    quote(&table.name),
                    quote(db_pk)
                ),
            });
        }
    }
    Ok(RuntimeArtifact {
        version: 1,
        source_manifest: json.to_string(),
        resources,
        native_reads: http::compile_reads(&source)?,
    })
}
