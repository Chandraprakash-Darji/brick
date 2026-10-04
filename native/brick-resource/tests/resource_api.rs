use brick_hir::types::{
    FieldHir, FieldId, Hir, ResourceHir, ResourceId, ServiceHir, ServiceId,
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
            "tables": [{"name":"t","fields":[{"name":"id","primaryKey":true}]}],
            "actions": [],
            "resources": [{"name":"r","table":"t","operations":["list","get"]}]
        }]
    }"#,
    );
    let r = build(&h).unwrap();
    assert_eq!(r.plans.len(), 1);
}

#[test]
fn plans_are_scoped_per_service() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [
            { "name": "a", "tables": [{"name":"t","fields":[{"name":"id","primaryKey":true}]}], "actions": [], "resources": [{"name":"r","table":"t","operations":["list"]}] },
            { "name": "b", "tables": [{"name":"t","fields":[{"name":"id","primaryKey":true}]}], "actions": [], "resources": [{"name":"r","table":"t","operations":["list"]}] }
        ]
    }"#,
    );
    let r = build(&h).unwrap();
    assert_eq!(r.plans.len(), 2);
    assert_eq!(r.find("a", "r").unwrap().service, ServiceId(0));
    assert_eq!(r.find("b", "r").unwrap().service, ServiceId(1));
}

#[test]
fn resolves_primary_key_name() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [{
            "name": "s",
            "tables": [{"name":"t","fields":[{"name":"user_id","primaryKey":true}]}],
            "actions": [],
            "resources": [{"name":"users","table":"t","operations":["get"]}]
        }]
    }"#,
    );
    let r = build(&h).unwrap();
    let p = r.find("s", "users").unwrap();
    assert_eq!(p.primary_key_name, "user_id");
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
                {"name":"tenant_id","primaryKey":false}
            ]}],
            "actions": [],
            "resources": [{"name":"r","table":"t","ownerField":"tenant_id","operations":["list"]}]
        }]
    }"#,
    );
    let r = build(&h).unwrap();
    let p = r.find("s", "r").unwrap();
    assert_eq!(p.owner_field_name.as_deref(), Some("tenant_id"));
}

#[test]
fn missing_owner_is_none() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [{
            "name": "s",
            "tables": [{"name":"t","fields":[{"name":"id","primaryKey":true}]}],
            "actions": [],
            "resources": [{"name":"r","table":"t","operations":["list"]}]
        }]
    }"#,
    );
    let r = build(&h).unwrap();
    assert_eq!(r.find("s", "r").unwrap().owner_field_name, None);
}

#[test]
fn preserves_operations() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [{
            "name": "s",
            "tables": [{"name":"t","fields":[{"name":"id","primaryKey":true}]}],
            "actions": [],
            "resources": [{"name":"r","table":"t","operations":["list","get","create","update","delete"]}]
        }]
    }"#,
    );
    let r = build(&h).unwrap();
    assert_eq!(
        r.find("s", "r").unwrap().operations,
        vec!["list", "get", "create", "update", "delete"]
    );
}

#[test]
fn counts_mixed_resources() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [{
            "name": "s",
            "tables": [{"name":"t","fields":[{"name":"id","primaryKey":true}]}],
            "actions": [],
            "resources": [
                {"name":"a","table":"t","operations":["list"]},
                {"name":"b","table":"t","operations":["get"]},
                {"name":"c","table":"t","operations":["create"]}
            ]
        }]
    }"#,
    );
    let r = build(&h).unwrap();
    assert_eq!(r.plans.len(), 3);
}

#[test]
fn empty_hir_builds_no_plans() {
    let h = Hir {
        actions: vec![],
        resources: vec![],
        services: vec![],
        fields: vec![],
    };
    let r = build(&h).unwrap();
    assert_eq!(r.plans.len(), 0);
}

#[test]
fn find_returns_plan() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [{
            "name": "s",
            "tables": [{"name":"t","fields":[{"name":"id","primaryKey":true}]}],
            "actions": [],
            "resources": [{"name":"r","table":"t","operations":["list"]}]
        }]
    }"#,
    );
    let r = build(&h).unwrap();
    assert!(r.find("s", "r").is_some());
    assert!(r.find("s", "missing").is_none());
    assert!(r.find("missing", "r").is_none());
}

#[test]
fn rejects_unknown_pk_field() {
    let mut h = lower(
        r#"{
        "version": 1,
        "services": [{
            "name": "s",
            "tables": [{"name":"t","fields":[{"name":"id","primaryKey":true}]}],
            "actions": [],
            "resources": [{"name":"r","table":"t","operations":["list"]}]
        }]
    }"#,
    );
    h.resources[0].primary_key = FieldId(9999);
    assert!(matches!(
        build(&h),
        Err(ResourceError::UnknownField(9999))
    ));
}
