use brick_hir::types::{
    ActionId, FieldHir, FieldId, Hir, ResourceHir, ResourceId, ServiceHir, ServiceId,
};
use brick_manifest::decode;
use brick_resource::{ResourceError, build};

fn lower(json: &str) -> Hir {
    let m = decode(json).expect("fixture decodes");
    brick_hir::lower(&m).expect("fixture lowers")
}

#[test]
fn builds_one_plan_per_resource() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [{
            "name": "s",
            "tables": [{"name":"t","fields":[
                {"name":"id","primaryKey":true},
                {"name":"owner_id","primaryKey":false}
            ]}],
            "actions": [],
            "resources": [{"name":"r","table":"t","ownerField":"owner_id","operations":["list","get"]}]
        }]
    }"#,
    );
    let plans = build(&h).unwrap();
    assert_eq!(plans.plans.len(), 1);
    assert_eq!(plans.plans[0].service_name, "s");
    assert_eq!(plans.plans[0].resource_name, "r");
    assert_eq!(plans.plans[0].service.0, 0);
    assert_eq!(plans.plans[0].resource.0, 0);
}

#[test]
fn preserves_operations() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [{
            "name": "s",
            "tables": [{"name":"t","fields":[
                {"name":"id","primaryKey":true},
                {"name":"owner_id","primaryKey":false}
            ]}],
            "actions": [],
            "resources": [{"name":"r","table":"t","operations":["list","get"]}]
        }]
    }"#,
    );
    let plans = build(&h).unwrap();
    assert_eq!(plans.plans[0].operations, vec!["list", "get"]);
}

#[test]
fn resolves_primary_key_name() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [{
            "name": "s",
            "tables": [{"name":"t","fields":[
                {"name":"id","primaryKey":true},
                {"name":"owner_id","primaryKey":false}
            ]}],
            "actions": [],
            "resources": [{"name":"r","table":"t","operations":["list"]}]
        }]
    }"#,
    );
    let plans = build(&h).unwrap();
    assert_eq!(plans.plans[0].primary_key.0, 0);
    assert_eq!(plans.plans[0].primary_key_name, "id");
}

#[test]
fn resolves_owner_name() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [{
            "name": "s",
            "tables": [{"name":"t","fields":[
                {"name":"id","primaryKey":true},
                {"name":"owner_id","primaryKey":false}
            ]}],
            "actions": [],
            "resources": [{"name":"r","table":"t","ownerField":"owner_id","operations":["list"]}]
        }]
    }"#,
    );
    let plans = build(&h).unwrap();
    assert_eq!(plans.plans[0].owner_field.as_ref().unwrap().0, 1);
    assert_eq!(plans.plans[0].owner_field_name.as_deref(), Some("owner_id"));
}

#[test]
fn missing_owner_is_none() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [{
            "name": "s",
            "tables": [{"name":"t","fields":[
                {"name":"id","primaryKey":true}
            ]}],
            "actions": [],
            "resources": [{"name":"r","table":"t","operations":["list"]}]
        }]
    }"#,
    );
    let plans = build(&h).unwrap();
    assert!(plans.plans[0].owner_field.is_none());
    assert_eq!(plans.plans[0].owner_field_name, None);
}

#[test]
fn find_returns_plan() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [{
            "name": "s",
            "tables": [{"name":"t","fields":[
                {"name":"id","primaryKey":true}
            ]}],
            "actions": [],
            "resources": [{"name":"r","table":"t","operations":["list"]}]
        }]
    }"#,
    );
    let plans = build(&h).unwrap();
    assert!(plans.find("s", "r").is_some());
    assert!(plans.find("s", "nope").is_none());
    assert!(plans.find("nope", "r").is_none());
}

#[test]
fn counts_mixed_resources() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [{
            "name": "s",
            "tables": [{"name":"t","fields":[
                {"name":"id","primaryKey":true},
                {"name":"owner_id","primaryKey":false}
            ]}],
            "actions": [],
            "resources": [
                {"name":"r1","table":"t","operations":["list"]},
                {"name":"r2","table":"t","ownerField":"owner_id","operations":["get"]}
            ]
        }]
    }"#,
    );
    let plans = build(&h).unwrap();
    assert_eq!(plans.plans.len(), 2);
}

#[test]
fn plans_are_scoped_per_service() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [
            {
                "name": "s1",
                "tables": [{"name":"t","fields":[
                    {"name":"id","primaryKey":true}
                ]}],
                "actions": [],
                "resources": [{"name":"r1","table":"t","operations":["list"]}]
            },
            {
                "name": "s2",
                "tables": [{"name":"t","fields":[
                    {"name":"id","primaryKey":true}
                ]}],
                "actions": [],
                "resources": [{"name":"r2","table":"t","operations":["list"]}]
            }
        ]
    }"#,
    );
    let plans = build(&h).unwrap();
    assert_eq!(plans.plans.len(), 2);
    assert!(plans.find("s1", "r1").is_some());
    assert!(plans.find("s2", "r2").is_some());
    assert!(plans.find("s1", "r2").is_none());
}

#[test]
fn empty_hir_builds_no_plans() {
    let h = lower(r#"{"version":1,"services":[]}"#);
    let plans = build(&h).unwrap();
    assert!(plans.plans.is_empty());
    assert!(plans.find("s", "r").is_none());
}

#[test]
fn rejects_unknown_pk_field() {
    let h = Hir {
        services: vec![ServiceHir {
            id: ServiceId(0),
            name: "s".to_string(),
        }],
        resources: vec![ResourceHir {
            id: ResourceId(0),
            service: ServiceId(0),
            name: "r".to_string(),
            primary_key: FieldId(999),
            owner_field: None,
            operations: vec!["list".to_string()],
        }],
        actions: vec![],
        fields: vec![FieldHir {
            id: FieldId(0),
            name: "id".to_string(),
        }],
    };
    assert!(matches!(build(&h), Err(ResourceError::UnknownField(999))));
}
