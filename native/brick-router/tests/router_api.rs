use brick_hir::types::Hir;
use brick_manifest::decode;
use brick_router::{RouteTarget, RouterError, build};

fn lower(json: &str) -> Hir {
    let m = decode(json).expect("fixture decodes");
    brick_hir::lower(&m).expect("fixture lowers")
}

#[test]
fn builds_resource_route_per_operation() {
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
    let router = build(&h).unwrap();
    assert_eq!(router.routes.len(), 2);
    assert_eq!(router.routes[0].method, "GET");
    assert_eq!(router.routes[0].path, "/s/r/list");
    assert_eq!(router.routes[1].path, "/s/r/get");
}

#[test]
fn builds_action_route() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [{
            "name": "s",
            "tables": [{"name":"t","fields":[
                {"name":"id","primaryKey":true},
                {"name":"owner_id","primaryKey":false}
            ]}],
            "actions": [{"name":"a","hasAuthorize":false}],
            "resources": [{"name":"r","table":"t","operations":["list"]}]
        }]
    }"#,
    );
    let router = build(&h).unwrap();
    let found = router
        .routes
        .iter()
        .find(|r| r.path == "/s/a")
        .expect("action route");
    assert_eq!(found.method, "POST");
}

#[test]
fn resolves_resource_route() {
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
    let router = build(&h).unwrap();
    let route = router.resolve("GET", "/s/r/list").expect("resolves");
    match &route.target {
        RouteTarget::Resource {
            service,
            resource,
            operation,
        } => {
            assert_eq!(service.0, 0);
            assert_eq!(resource.0, 0);
            assert_eq!(operation, "list");
        }
        RouteTarget::Action { .. } => panic!("wrong target"),
    }
}

#[test]
fn resolves_action_route() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [{
            "name": "s",
            "tables": [{"name":"t","fields":[
                {"name":"id","primaryKey":true},
                {"name":"owner_id","primaryKey":false}
            ]}],
            "actions": [{"name":"a","hasAuthorize":true}],
            "resources": [{"name":"r","table":"t","operations":["list"]}]
        }]
    }"#,
    );
    let router = build(&h).unwrap();
    let route = router.resolve("POST", "/s/a").expect("resolves");
    match &route.target {
        RouteTarget::Action { service, action } => {
            assert_eq!(service.0, 0);
            assert_eq!(action.0, 0);
        }
        RouteTarget::Resource { .. } => panic!("wrong target"),
    }
}

#[test]
fn unknown_path_returns_none() {
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
    let router = build(&h).unwrap();
    assert!(router.resolve("GET", "/nope").is_none());
}

#[test]
fn method_mismatch_returns_none() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [{
            "name": "s",
            "tables": [{"name":"t","fields":[
                {"name":"id","primaryKey":true},
                {"name":"owner_id","primaryKey":false}
            ]}],
            "actions": [{"name":"a","hasAuthorize":false}],
            "resources": [{"name":"r","table":"t","operations":["list"]}]
        }]
    }"#,
    );
    let router = build(&h).unwrap();
    assert!(router.resolve("POST", "/s/r/list").is_none());
    assert!(router.resolve("GET", "/s/a").is_none());
}

#[test]
fn rejects_duplicate_operation_route() {
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
            "resources": [{"name":"r","table":"t","operations":["list","list"]}]
        }]
    }"#,
    );
    assert!(matches!(build(&h), Err(RouterError::DuplicateRoute(_))));
}

#[test]
fn empty_hir_builds_no_routes() {
    let h = lower(r#"{"version":1,"services":[]}"#);
    let router = build(&h).unwrap();
    assert!(router.routes.is_empty());
    assert!(router.resolve("GET", "/s/r/list").is_none());
}

#[test]
fn counts_mixed_resources_and_actions() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [{
            "name": "s",
            "tables": [{"name":"t","fields":[
                {"name":"id","primaryKey":true},
                {"name":"owner_id","primaryKey":false}
            ]}],
            "actions": [
                {"name":"a1","hasAuthorize":false},
                {"name":"a2","hasAuthorize":true}
            ],
            "resources": [
                {"name":"r1","table":"t","operations":["list"]},
                {"name":"r2","table":"t","operations":["get"]}
            ]
        }]
    }"#,
    );
    let router = build(&h).unwrap();
    assert_eq!(router.routes.len(), 4);
}

#[test]
fn routes_are_scoped_per_service() {
    let h = lower(
        r#"{
        "version": 1,
        "services": [
            {
                "name": "s1",
                "tables": [{"name":"t","fields":[
                    {"name":"id","primaryKey":true},
                    {"name":"owner_id","primaryKey":false}
                ]}],
                "actions": [],
                "resources": [{"name":"r1","table":"t","operations":["list"]}]
            },
            {
                "name": "s2",
                "tables": [{"name":"t","fields":[
                    {"name":"id","primaryKey":true},
                    {"name":"owner_id","primaryKey":false}
                ]}],
                "actions": [],
                "resources": [{"name":"r2","table":"t","operations":["list"]}]
            }
        ]
    }"#,
    );
    let router = build(&h).unwrap();
    assert_eq!(router.routes.len(), 2);
    assert!(router.resolve("GET", "/s1/r1/list").is_some());
    assert!(router.resolve("GET", "/s2/r2/list").is_some());
    assert!(router.resolve("GET", "/s1/r2/list").is_none());
}
