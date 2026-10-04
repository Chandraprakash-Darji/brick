use brick_manifest::decode;

const VALID: &str = r#"{
    "version": 1,
    "services": [
        {
            "name": "deals",
            "tables": [],
            "actions": [
                { "name": "createDeal", "hasAuthorize": true }
            ],
            "resources": [
                { "name": "deal", "ownerField": "owner_id", "operations": ["list", "get"] }
            ]
        }
    ]
}"#;

#[test]
fn decodes_valid_manifest() {
    let m = decode(VALID).expect("valid manifest decodes");
    assert_eq!(m.version, 1);
    assert_eq!(m.services.len(), 1);
    assert_eq!(m.services[0].name, "deals");
    assert_eq!(m.services[0].actions.len(), 1);
    assert_eq!(m.services[0].actions[0].name, "createDeal");
    assert!(m.services[0].actions[0].has_authorize);
    assert_eq!(m.services[0].resources.len(), 1);
    assert_eq!(m.services[0].resources[0].name, "deal");
    assert_eq!(
        m.services[0].resources[0].owner_field.as_deref(),
        Some("owner_id")
    );
    assert_eq!(
        m.services[0].resources[0].operations,
        vec!["list".to_string(), "get".to_string()]
    );
}

#[test]
fn rejects_invalid_json() {
    assert!(decode("{ not json").is_err());
}

#[test]
fn rejects_unsupported_version() {
    let v = VALID.replace("\"version\": 1", "\"version\": 999");
    assert!(decode(&v).is_err());
}

#[test]
fn rejects_missing_service_name() {
    let v = VALID.replace("\"name\": \"deals\"", "\"name\": 123");
    assert!(decode(&v).is_err());
}

#[test]
fn resource_without_owner_is_none() {
    let v = VALID.replace(
        r#"{ "name": "deal", "ownerField": "owner_id", "operations": ["list", "get"] }"#,
        r#"{ "name": "deal", "operations": ["list"] }"#,
    );
    let m = decode(&v).expect("owner optional");
    assert_eq!(m.services[0].resources[0].owner_field, None);
    assert_eq!(
        m.services[0].resources[0].operations,
        vec!["list".to_string()]
    );
}
