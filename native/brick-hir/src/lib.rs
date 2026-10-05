use brick_manifest::{FieldManifest, Manifest, ServiceManifest, TableManifest};

pub mod types;

use crate::types::HirError::{self, NoPrimaryKey};
use crate::types::{
    ActionHir, ActionId, FieldHir, FieldId, Hir,
    HirError::{
        DuplicateAction, DuplicateResource, DuplicateService, EmptyOperations,
        TablesMisingInService,
    },
    ResourceHir, ResourceId, ServiceHir, ServiceId,
};

pub fn lower(manifest: &brick_manifest::Manifest) -> Result<Hir, HirError> {
    let mut hir = Hir {
        actions: vec![],
        resources: vec![],
        services: vec![],
        fields: vec![],
    };

    process_fields(&mut hir, &manifest);

    let parsed_service = &manifest.services;

    for (index, srv) in parsed_service.iter().enumerate() {
        // check if already exist
        if get_service(&hir, srv.name.clone()).is_some() {
            return Err(DuplicateService(srv.name.clone()));
        }

        let service_id = ServiceId(index as u32);

        hir.services.push(ServiceHir {
            id: service_id,
            name: srv.name.clone(),
        });

        let parsed_resource = &srv.resources;

        for rse in parsed_resource.iter() {
            // check if already exist
            if hir
                .resources
                .iter()
                .find(|val| val.name == rse.name)
                .is_some()
            {
                return Err(DuplicateResource(rse.name.clone()));
            }

            let owner_field = rse.owner_field.clone();

            // check if already exist
            let owner_field_id = owner_field.and_then(|name| get_fields(&hir, name).cloned());

            if srv.tables.len() == 0 {
                return Err(TablesMisingInService(srv.name.clone()));
            };
            let table_name = &rse.table.clone().unwrap();

            // check if table name exist in the service tables
            if !srv.tables.iter().any(|t| &t.name == table_name) {
                return Err(TablesMisingInService(srv.name.clone()));
            }

            let table: &TableManifest = srv.tables.iter().find(|t| &t.name == table_name).unwrap();

            let pk_res = process_pk(table)?;

            let primary_key_feild = &pk_res.name;

            let primary_key_feild_id = get_fields(&hir, primary_key_feild.clone())
                .cloned()
                .unwrap();

            hir.resources.push(ResourceHir {
                id: ResourceId(hir.resources.len() as u32),
                name: rse.name.clone(),
                service: service_id,
                owner_field: owner_field_id.map(|f| f.id),
                primary_key: primary_key_feild_id.id,
                operations: rse.operations.clone(),
            });

            if rse.operations.len() == 0 {
                return Err(EmptyOperations(rse.name.clone()));
            };
        }
        process_actions(&mut hir, srv)?;
    }

    Ok(hir)
}

fn get_fields(hir: &Hir, name: String) -> Option<&FieldHir> {
    return hir.fields.iter().find(|&f| f.name == name);
}

fn create_field(hir: &mut Hir, name: String, field_index: &mut u32) {
    let exist = get_fields(hir, name.clone());

    if exist.is_none() {
        hir.fields.push(FieldHir {
            id: FieldId(*field_index),
            name: name.clone(),
        });
        *field_index += 1;
    }
}

fn process_fields(hir: &mut Hir, m: &Manifest) {
    let mut field_index: u32 = 0;

    for service in &m.services {
        // process tables.fields
        for table in &service.tables {
            // process .feilds
            for feild in &table.fields {
                // check if alredy exist then skip it becuse same feild can exist again
                create_field(hir, feild.name.clone(), &mut field_index);
            }
        }
        // process resource/ownerFeild
        for resource in &service.resources {
            let owner_field = resource.owner_field.clone();
            if owner_field.is_some() {
                create_field(hir, owner_field.unwrap(), &mut field_index);
            }
        }
    }
}

fn process_actions(hir: &mut Hir, service: &ServiceManifest) -> Result<(), HirError> {
    let mut action_index: u32 = 0;
    for action in &service.actions {
        let a = hir
            .actions
            .iter()
            .find(|action_exit| action_exit.name == action.name);

        if a.is_some() {
            return Err(DuplicateAction(action.name.clone()));
        }

        if a.is_none() {
            hir.actions.push(ActionHir {
                id: ActionId(action_index),
                service: get_service(hir, service.name.clone()).unwrap().id,
                name: action.name.clone(),
            });
            action_index += 1;
        }
    }
    Ok(())
}

fn get_service(hir: &Hir, name: String) -> Option<&ServiceHir> {
    return hir.services.iter().find(|&s| s.name == name);
}

fn process_pk(table: &TableManifest) -> Result<&FieldManifest, HirError> {
    let mut table_with_pk = table.fields.iter().filter(|&t| t.primary_key == true);

    let total_pks = table_with_pk.clone().count();

    // More then one primary key
    if total_pks > 1 {
        return Err(HirError::MoreThenOnePrimaryKey(table.name.clone()));
    };

    // less then one primary key
    if total_pks < 1 {
        return Err(HirError::NoPrimaryKey(table.name.clone()));
    };

    // return exact Pk
    Ok(table_with_pk
        .next()
        .ok_or(NoPrimaryKey(table.name.clone()))?)
}
