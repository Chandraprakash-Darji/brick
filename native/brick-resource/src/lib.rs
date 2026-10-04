use brick_hir::types::{FieldId, Hir, ResourceId, ServiceId};

#[derive(Debug)]
pub struct ResourcePlan {
    pub service: ServiceId,
    pub resource: ResourceId,
    pub service_name: String,
    pub resource_name: String,
    pub primary_key: FieldId,
    pub primary_key_name: String,
    pub owner_field: Option<FieldId>,
    pub owner_field_name: Option<String>,
    pub operations: Vec<String>,
}

#[derive(Debug)]
pub struct ResourcePlans {
    pub plans: Vec<ResourcePlan>,
}

#[derive(Debug, thiserror::Error)]
pub enum ResourceError {
    #[error("unknown field id {0}")]
    UnknownField(u32),
}

pub fn build(hir: &Hir) -> Result<ResourcePlans, ResourceError> {
    let mut rs_plans: ResourcePlans = ResourcePlans { plans: Vec::new() };

    for r in &hir.resources {
        let service_name = hir
            .services
            .iter()
            .find(|s| s.id == r.service)
            .ok_or(ResourceError::UnknownField(r.service.0))?
            .name
            .clone();

        let pk_name = hir
            .fields
            .iter()
            .find(|s| s.id == r.primary_key)
            .ok_or(ResourceError::UnknownField(r.primary_key.0))?
            .name
            .clone();

        let o_name = match &r.owner_field {
            Some(owner_id) => Some(
                hir.fields
                    .iter()
                    .find(|f| &f.id == owner_id)
                    .ok_or(ResourceError::UnknownField(owner_id.0))?
                    .name
                    .clone(),
            ),
            None => None,
        };

        rs_plans.plans.push(ResourcePlan {
            service: r.service,
            resource: r.id,
            service_name,
            resource_name: r.name.clone(),
            primary_key: r.primary_key.clone(),
            primary_key_name: pk_name,
            owner_field: r.owner_field.clone(),
            operations: r.operations.clone(),
            owner_field_name: o_name,
        })
    }

    Ok(rs_plans)
}

impl ResourcePlans {
    pub fn find(&self, service: &str, resource: &str) -> Option<&ResourcePlan> {
        self.plans
            .iter()
            .find(|p| p.service_name == service && p.resource_name == resource)
    }
}
