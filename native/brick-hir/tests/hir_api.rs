use brick_hir::lower;
use brick_hir::types::HirError;
use brick_manifest::decode;

const VALID: &str = r#"{
    "version": 1,
    "services": [
        {
            "name": "deals",
            "tables": [
                {
                    "name": "deals",
                    "fields": [
                        { "name": "id", "primaryKey": true },
                        { "name": "owner_id", "primaryKey": false }
                    ]
                }
            ],
            "actions": [
                { "name": "createDeal", "hasAuthorize": true }
            ],
            "resources": [
                { "name": "deal", "table": "deals","ownerField": "owner_id", "operations": ["list", "get"] }
            ]
        }
    ]
}"#;

const TABLE_T: &str = r#"[{"name":"t","fields":[{"name":"id","primaryKey":true},{"name":"owner_id","primaryKey":false}]}]"#;

fn svc(resources: &str, actions: &str, tables: &str) -> String {
    format!(
        r#"{{"version":1,"services":[{{"name":"s","tables":{tables},"actions":{actions},"resources":{resources}}}]}}"#
    )
}

fn valid_manifest() -> brick_manifest::Manifest {
    decode(VALID).expect("fixture valid")
}

#[test]
fn lowers_ids_and_owner() {
    let hir = lower(&valid_manifest()).expect("lowers");
    assert_eq!(hir.services.len(), 1);
    assert_eq!(hir.services[0].id.0, 0);
    assert_eq!(hir.resources.len(), 1);
    assert_eq!(hir.resources[0].id.0, 0);
    assert_eq!(hir.resources[0].service.0, 0);
    assert_eq!(hir.resources[0].name, "deal");
    assert!(hir.resources[0].owner_field.is_some());
    assert_eq!(hir.actions.len(), 1);
    assert_eq!(hir.actions[0].id.0, 0);
    assert_eq!(hir.actions[0].name, "createDeal");
}

#[test]
fn missing_owner_is_none() {
    let m = decode(&svc(
        r#"[{"name":"r","table":"t","operations":["list"]}]"#,
        "[]",
        TABLE_T,
    ))
    .unwrap();
    let hir = lower(&m).unwrap();
    assert!(hir.resources[0].owner_field.is_none());
}

#[test]
fn rejects_duplicate_service() {
    let m = decode(
        r#"{"version":1,"services":[{"name":"s","tables":[],"actions":[],"resources":[]},{"name":"s","tables":[],"actions":[],"resources":[]}]}"#,
    )
    .unwrap();
    assert!(matches!(lower(&m), Err(HirError::DuplicateService(_))));
}

#[test]
fn rejects_duplicate_resource() {
    let m = decode(&svc(
        r#"[{"name":"r","table":"t","operations":["list"]},{"name":"r","table":"t","operations":["get"]}]"#,
        "[]",
        TABLE_T,
    ))
    .unwrap();
    assert!(matches!(lower(&m), Err(HirError::DuplicateResource(_))));
}

#[test]
fn rejects_duplicate_action() {
    let m = decode(&svc(
        r#"[{"name":"r","table":"t","operations":["list"]}]"#,
        r#"[{"name":"a","hasAuthorize":false},{"name":"a","hasAuthorize":true}]"#,
        TABLE_T,
    ))
    .unwrap();
    assert!(matches!(lower(&m), Err(HirError::DuplicateAction(_))));
}

#[test]
fn rejects_empty_operations() {
    let m = decode(&svc(
        r#"[{"name":"r","table":"t","operations":[]}]"#,
        "[]",
        TABLE_T,
    ))
    .unwrap();

    let err = lower(&m).err().unwrap();
    println!("{}", err);

    assert!(matches!(err, HirError::EmptyOperations(_)));
}

#[test]
fn rejects_service_without_tables() {
    let m = decode(&svc(
        r#"[{"name":"r","table":"t","operations":["list"]}]"#,
        "[]",
        "[]",
    ))
    .unwrap();
    assert!(matches!(lower(&m), Err(HirError::TablesMisingInService(_))));
}

#[test]
fn rejects_unknown_table() {
    let m = decode(&svc(
        r#"[{"name":"r","table":"nope","operations":["list"]}]"#,
        "[]",
        TABLE_T,
    ))
    .unwrap();
    assert!(lower(&m).is_err());
}

#[test]
fn rejects_table_without_primary_key() {
    let tables = r#"[{"name":"t","fields":[{"name":"id","primaryKey":false}]}]"#;
    let m = decode(&svc(
        r#"[{"name":"r","table":"t","operations":["list"]}]"#,
        "[]",
        tables,
    ))
    .unwrap();
    assert!(matches!(lower(&m), Err(HirError::NoPrimaryKey(_))));
}

#[test]
fn rejects_multiple_primary_keys() {
    let tables = r#"[{"name":"t","fields":[{"name":"a","primaryKey":true},{"name":"b","primaryKey":true}]}]"#;
    let m = decode(&svc(
        r#"[{"name":"r","table":"t","operations":["list"]}]"#,
        "[]",
        tables,
    ))
    .unwrap();
    assert!(matches!(lower(&m), Err(HirError::MoreThenOnePrimaryKey(_))));
}

//   pub operations: Vec<String> (cloned from rse.operations in lower)

#[test]
fn preserves_operations() {
    let m = decode(&svc(
        r#"[{"name":"r","table":"t","operations":["list","get"]}]"#,
        "[]",
        TABLE_T,
    ))
    .unwrap();
    let hir = lower(&m).unwrap();
    assert_eq!(
        hir.resources[0].operations,
        vec!["list".to_string(), "get".to_string()]
    );
}

#[test]
fn preserves_single_operation() {
    let m = decode(&svc(
        r#"[{"name":"r","table":"t","operations":["get"]}]"#,
        "[]",
        TABLE_T,
    ))
    .unwrap();
    let hir = lower(&m).unwrap();
    assert_eq!(hir.resources[0].operations, vec!["get".to_string()]);
}
