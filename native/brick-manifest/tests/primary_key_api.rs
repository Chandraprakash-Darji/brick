use brick_manifest::decode;

// NOTE: does not compile until you extend the manifest (see below).
// Expected shape (per research_2.md V1, tables optional for back-compat):
//   ServiceManifest { ..., pub tables: Vec<TableManifest> }       // #[serde(default)]
//   pub struct TableManifest { pub name: String, pub fields: Vec<FieldManifest> }
//   pub struct FieldManifest { pub name: String, pub primary_key: bool }  // camelCase: primaryKey
//   ResourceManifest { ..., pub table: Option<String> }            // #[serde(default)]

const WITH_TABLES: &str = r#"{
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
            "actions": [],
            "resources": [
                { "name": "deal", "table": "deals", "ownerField": "owner_id", "operations": ["list"] }
            ]
        }
    ]
}"#;

#[test]
fn decodes_tables_with_primary_key() {
    let m = decode(WITH_TABLES).expect("tables decode");
    assert_eq!(m.services[0].tables.len(), 1);
    assert_eq!(m.services[0].tables[0].name, "deals");
    assert_eq!(m.services[0].tables[0].fields.len(), 2);
    let pk: Vec<&str> = m.services[0].tables[0]
        .fields
        .iter()
        .filter(|f| f.primary_key)
        .map(|f| f.name.as_str())
        .collect();
    assert_eq!(pk, vec!["id"]);
}

#[test]
fn resource_points_at_table() {
    let m = decode(WITH_TABLES).unwrap();
    assert_eq!(
        m.services[0].resources[0].table.as_deref(),
        Some("deals")
    );
}

#[test]
fn old_manifest_without_tables_still_decodes() {
    let m = decode(
        r#"{"version":1,"services":[{"name":"s","actions":[],"resources":[{"name":"r","operations":["list"]}]}]}"#,
    )
    .expect("back-compat");
    assert!(m.services[0].tables.is_empty());
    assert_eq!(m.services[0].resources[0].table, None);
}
