use brickc::{CompileError, HirError, ManifestError, compile_json};

const VALID_MANIFEST: &str = r#"{
    "version": 1,
    "services": [{
        "name": "blog",
        "tables": [{
            "name": "posts",
            "fields": [
                { "name": "id", "primaryKey": true },
                { "name": "author_id", "primaryKey": false },
                { "name": "title", "primaryKey": false }
            ]
        }],
        "actions": [
            { "name": "publishPost", "hasAuthorize": false }
        ],
        "resources": [{
            "name": "post",
            "table": "posts",
            "ownerField": "author_id",
            "operations": ["list", "get", "create"]
        }]
    }]
}"#;

#[test]
fn compiles_valid_manifest_end_to_end() {
    let artifacts = compile_json(VALID_MANIFEST).expect("valid manifest compiles");

    let summary = artifacts.summary();
    assert_eq!(summary.service_count, 1);
    assert_eq!(summary.resource_count, 1);
    assert_eq!(summary.action_count, 1);
    // 3 resource operations + 1 action = 4 routes
    assert_eq!(summary.route_count, 4);
    assert_eq!(summary.resource_plan_count, 1);

    // Verify router resolved action and resource routes
    let publish_route = artifacts
        .router
        .resolve("POST", "/blog/publishPost")
        .expect("action route found");
    assert!(matches!(
        publish_route.target,
        brickc::RouteTarget::Action { .. }
    ));

    let list_route = artifacts
        .router
        .resolve("GET", "/blog/post/list")
        .expect("list route found");
    assert!(matches!(
        list_route.target,
        brickc::RouteTarget::Resource { .. }
    ));

    // Verify SQL generation (scan target is plan.resource_name)
    let get_sql = artifacts
        .sql_for("blog", "post", "get", None)
        .expect("get sql succeeds");
    assert_eq!(
        get_sql,
        r#"SELECT "id", "author_id" FROM "post" WHERE "id" = $1 AND "author_id" = $2"#
    );

    let list_sql = artifacts
        .sql_for("blog", "post", "list", Some(50))
        .expect("list sql succeeds");
    assert_eq!(
        list_sql,
        r#"SELECT "id", "author_id" FROM "post" WHERE "author_id" = $1 LIMIT $2"#
    );
}

#[test]
fn rejects_invalid_json() {
    let res = compile_json("{ not valid json }");
    assert!(matches!(
        res,
        Err(CompileError::Manifest(ManifestError::InvalidJson(_)))
    ));
}

#[test]
fn rejects_duplicate_service() {
    let manifest = r#"{
        "version": 1,
        "services": [
            { "name": "s", "tables": [{"name":"t","fields":[{"name":"id","primaryKey":true}]}], "actions": [], "resources": [] },
            { "name": "s", "tables": [{"name":"t","fields":[{"name":"id","primaryKey":true}]}], "actions": [], "resources": [] }
        ]
    }"#;
    let res = compile_json(manifest);
    assert!(matches!(res, Err(CompileError::Hir(HirError::DuplicateService(name))) if name == "s"));
}

#[test]
fn rejects_table_without_pk() {
    let manifest = r#"{
        "version": 1,
        "services": [{
            "name": "s",
            "tables": [{ "name": "t", "fields": [{ "name": "id", "primaryKey": false }] }],
            "actions": [],
            "resources": [{ "name": "r", "table": "t", "operations": ["list"] }]
        }]
    }"#;
    let res = compile_json(manifest);
    assert!(matches!(res, Err(CompileError::Hir(HirError::NoPrimaryKey(table))) if table == "t"));
}

#[test]
fn unknown_resource_in_query_for_fails() {
    let artifacts = compile_json(VALID_MANIFEST).unwrap();
    let res = artifacts.sql_for("blog", "nonexistent", "get", None);
    assert!(matches!(res, Err(CompileError::Query(_))));
}

#[test]
fn runtime_artifact_uses_physical_names_and_retains_source() {
    let source = VALID_MANIFEST.replace(
        r#"{ "name": "id", "primaryKey": true }"#,
        r#"{ "name": "id", "dbName": "post\"id", "primaryKey": true }"#,
    );
    let artifact = brickc::compile_runtime_json(&source).unwrap();
    assert_eq!(artifact.version, 1);
    assert_eq!(artifact.source_manifest, source);
    assert_eq!(
        artifact.resources[0].get_sql,
        r#"SELECT * FROM "posts" WHERE "post""id" = $1 LIMIT 1"#
    );
    // Ownership is enforced after lookup by the existing resource action.
    assert!(!artifact.resources[0].get_sql.contains("author_id"));
}

#[test]
fn missing_resource_table_is_an_error_not_a_panic() {
    let source = VALID_MANIFEST.replace(r#""table": "posts","#, "");
    assert!(brickc::compile_runtime_json(&source).is_err());
}

#[test]
fn allows_equal_action_and_resource_names_in_different_services() {
    let mut source: serde_json::Value = serde_json::from_str(VALID_MANIFEST).unwrap();
    let mut second = source["services"][0].clone();
    second["name"] = serde_json::json!("other_blog");
    source["services"].as_array_mut().unwrap().push(second);
    let artifact = brickc::compile_runtime_json(&source.to_string()).unwrap();
    assert_eq!(artifact.resources.len(), 2);
}

#[test]
fn compiles_native_read_routes_with_physical_projection_and_rejects_owner_bypass() {
    let mut source: serde_json::Value = serde_json::from_str(VALID_MANIFEST).unwrap();
    source["nativeResources"] = serde_json::json!([{
        "service": "blog", "resource": "post", "pluralName": "posts", "get": true, "list": true,
        "defaultLimit": 20, "maxLimit": 100, "defaultSort": "id",
        "orders": [{ "field": "id", "dbName": "id", "descending": false }],
        "listFields": ["id", "title"]
    }]);
    assert!(brickc::compile_runtime_json(&source.to_string()).is_err());
    source["services"][0]["resources"][0]
        .as_object_mut()
        .unwrap()
        .remove("ownerField");
    let artifact = brickc::compile_runtime_json(&source.to_string()).unwrap();
    assert_eq!(artifact.native_reads.len(), 1);
    assert_eq!(
        artifact.native_reads[0].list_sql,
        r#"SELECT "id", "title" FROM "posts" ORDER BY "id" ASC LIMIT ?1 OFFSET ?2"#
    );
    assert_eq!(
        artifact.native_reads[0].count_sql,
        r#"SELECT count(*) FROM "posts""#
    );
    source["nativeResources"][0]["listFields"] = serde_json::json!(["does_not_exist"]);
    assert!(brickc::compile_runtime_json(&source.to_string()).is_err());
}
