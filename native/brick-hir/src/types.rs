#[derive(Clone, Copy, PartialEq, Debug)]
pub struct ServiceId(pub u32);
#[derive(Clone, PartialEq, Copy, Debug)]
pub struct ResourceId(pub u32);
#[derive(Clone, Debug, PartialEq)]
pub struct FieldId(pub u32);
#[derive(Clone, PartialEq, Copy, Debug)]
pub struct ActionId(pub u32);

#[derive(Debug, Clone, PartialEq)]
pub struct ServiceHir {
    pub id: ServiceId,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResourceHir {
    pub id: ResourceId,
    pub service: ServiceId,
    pub name: String,
    pub primary_key: FieldId,
    pub owner_field: Option<FieldId>,
    pub operations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ActionHir {
    pub id: ActionId,
    pub service: ServiceId,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FieldHir {
    pub id: FieldId,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Hir {
    pub services: Vec<ServiceHir>,
    pub resources: Vec<ResourceHir>,
    pub actions: Vec<ActionHir>,
    pub fields: Vec<FieldHir>,
}

#[derive(Debug, thiserror::Error)]
pub enum HirError {
    #[error("Resource {0}, is duplicate")]
    DuplicateResource(String),
    #[error("Service {0}, is duplicate")]
    DuplicateService(String),
    #[error("Action {0}, is duplicate")]
    DuplicateAction(String),
    #[error("Resource {0} as empty operation")]
    EmptyOperations(String),
    #[error("No primary key in table {0}")]
    NoPrimaryKey(String),
    #[error("More then one primary key in table {0}")]
    MoreThenOnePrimaryKey(String),
    #[error("Table is mising from the service {0}")]
    TablesMisingInService(String),
}
