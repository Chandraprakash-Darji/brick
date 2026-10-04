use brick_hir::lower;
use brick_manifest::decode;

// Uses only the existing API: hir.fields: Vec<FieldHir { id, name }>.

const TABLE_T: &str = r#"[{"name":"t","fields":[{"name":"id","primaryKey":true},{"name":"owner_id","primaryKey":false}]}]"#;

fn svc(resources: &str) -> String {
    format!(
        r#"{{"version":1,"services":[{{"name":"s","tables":{TABLE_T},"actions":[],"resources":{resources}}}]}}"#
    )
}

#[test]
fn primary_key_resolves_to_id_field() {
    let m = decode(&svc(
        r#"[{"name":"r","table":"t","ownerField":"owner_id","operations":["list"]}]"#,
    ))
    .unwrap();
    let hir = lower(&m).unwrap();
    let id_entry = hir
        .fields
        .iter()
        .find(|f| f.name == "id")
        .expect("id interned");
    assert_eq!(hir.resources[0].primary_key.0, id_entry.id.0);
}

#[test]
fn same_field_name_shares_id() {
    let m = decode(&svc(
        r#"[{"name":"a","table":"t","ownerField":"owner_id","operations":["list"]},{"name":"b","table":"t","ownerField":"owner_id","operations":["list"]}]"#,
    ))
    .unwrap();
    let hir = lower(&m).unwrap();
    assert_eq!(
        hir.resources[0].owner_field.as_ref().map(|f| f.0),
        hir.resources[1].owner_field.as_ref().map(|f| f.0)
    );
    let count = hir.fields.iter().filter(|f| f.name == "owner_id").count();
    assert_eq!(count, 1);
}
