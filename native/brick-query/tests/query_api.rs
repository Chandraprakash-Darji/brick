use brick_manifest::decode;
use brick_query::{
    Field, Param, Predicate, QueryError, RelExpr, SortKey, plan_for_operation, to_sql,
};
use brick_resource::ResourcePlan;

fn one(json: &str) -> ResourcePlan {
    let m = decode(json).expect("fixture decodes");
    let h = brick_hir::lower(&m).expect("fixture lowers");
    let p = brick_resource::build(&h).expect("fixture plans");
    p.plans.into_iter().next().expect("one plan")
}

const OWNED: &str = r#"{
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
}"#;

const PUBLIC: &str = r#"{
    "version": 1,
    "services": [{
        "name": "s",
        "tables": [{"name":"t","fields":[
            {"name":"id","primaryKey":true}
        ]}],
        "actions": [],
        "resources": [{"name":"r","table":"t","operations":["list","get"]}]
    }]
}"#;

#[test]
fn scan_to_sql_exact() {
    let e = RelExpr::scan("r");
    assert_eq!(
        e,
        RelExpr::Scan {
            table: brick_query::Table("r".to_string())
        }
    );
    assert_eq!(to_sql(&e), r#"SELECT * FROM "r""#);
}

#[test]
fn project_to_sql_exact() {
    let e = RelExpr::scan("r").project(vec!["id"]);
    assert_eq!(to_sql(&e), r#"SELECT "id" FROM "r""#);
}

#[test]
fn filter_to_sql_exact() {
    let e = RelExpr::scan("r")
        .project(vec!["id"])
        .filter(Predicate::Eq(Field("id".to_string()), Param(1)));
    assert_eq!(to_sql(&e), r#"SELECT "id" FROM "r" WHERE "id" = $1"#);
    // values are never interpolated, only $n params
    assert!(!to_sql(&e).contains("evil"));
}

#[test]
fn and_to_sql_exact() {
    let e = RelExpr::scan("r").filter(Predicate::And(vec![
        Predicate::Eq(Field("a".to_string()), Param(1)),
        Predicate::Eq(Field("b".to_string()), Param(2)),
    ]));
    assert_eq!(
        to_sql(&e),
        r#"SELECT * FROM "r" WHERE "a" = $1 AND "b" = $2"#
    );
}

#[test]
fn sort_to_sql_exact() {
    let e = RelExpr::scan("r").project(vec!["id"]).sort(vec![SortKey {
        field: Field("id".to_string()),
        descending: true,
    }]);
    assert_eq!(to_sql(&e), r#"SELECT "id" FROM "r" ORDER BY "id" DESC"#);
}

#[test]
fn limit_to_sql_exact() {
    let e = RelExpr::scan("r").project(vec!["id"]).limit(Param(1));
    assert_eq!(to_sql(&e), r#"SELECT "id" FROM "r" LIMIT $1"#);
}

#[test]
fn public_list_exact() {
    let r = one(PUBLIC);
    let e = plan_for_operation(&r, "list", Some(50)).unwrap();
    assert_eq!(to_sql(&e), r#"SELECT "id" FROM "r" LIMIT $1"#);
}

#[test]
fn get_exact() {
    let r = one(PUBLIC);
    let e = plan_for_operation(&r, "get", None).unwrap();
    assert_eq!(to_sql(&e), r#"SELECT "id" FROM "r" WHERE "id" = $1"#);
}

#[test]
fn owned_list_with_limit_exact() {
    let r = one(OWNED);
    let e = plan_for_operation(&r, "list", Some(50)).unwrap();
    assert_eq!(
        to_sql(&e),
        r#"SELECT "id", "owner_id" FROM "r" WHERE "owner_id" = $1 LIMIT $2"#
    );
}

#[test]
fn rejects_unknown_operation() {
    let r = one(PUBLIC);
    assert!(matches!(
        plan_for_operation(&r, "nope", None),
        Err(QueryError::InvalidOperation(_))
    ));
}

#[test]
fn owned_get_checks_primary_key_and_owner() {
    let e = plan_for_operation(&one(OWNED), "get", None).unwrap();
    assert_eq!(
        to_sql(&e),
        r#"SELECT "id", "owner_id" FROM "r" WHERE "id" = $1 AND "owner_id" = $2"#
    );
}

#[test]
fn lists_without_limits() {
    assert_eq!(
        to_sql(&plan_for_operation(&one(PUBLIC), "list", None).unwrap()),
        r#"SELECT "id" FROM "r""#
    );
    assert_eq!(
        to_sql(&plan_for_operation(&one(OWNED), "list", None).unwrap()),
        r#"SELECT "id", "owner_id" FROM "r" WHERE "owner_id" = $1"#
    );
}

#[test]
fn rejects_disabled_and_write_operations() {
    let mut r = one(PUBLIC);
    r.operations = vec![
        "get".into(),
        "create".into(),
        "update".into(),
        "delete".into(),
    ];
    for operation in ["list", "create", "update", "delete"] {
        assert!(matches!(plan_for_operation(&r, operation, None),
            Err(QueryError::InvalidOperation(op)) if op == operation));
    }
}

#[test]
fn limit_values_are_bound_and_only_apply_to_lists() {
    let r = one(PUBLIC);
    assert_eq!(
        plan_for_operation(&r, "list", Some(0)).unwrap(),
        plan_for_operation(&r, "list", Some(100)).unwrap()
    );
    assert_eq!(
        plan_for_operation(&r, "get", Some(100)).unwrap(),
        plan_for_operation(&r, "get", None).unwrap()
    );
}

#[test]
fn uses_resource_field_names_and_deduplicates_projection() {
    let mut r = one(OWNED);
    r.resource_name = "widgets".into();
    r.primary_key_name = "widget_id".into();
    r.owner_field_name = Some("widget_id".into());
    assert_eq!(
        to_sql(&plan_for_operation(&r, "get", None).unwrap()),
        r#"SELECT "widget_id" FROM "widgets" WHERE "widget_id" = $1 AND "widget_id" = $2"#
    );
}

#[test]
fn quotes_identifiers_in_every_clause() {
    let e = RelExpr::scan("a\"b")
        .project(vec!["c\"d"])
        .filter(Predicate::Eq(Field("c\"d".into()), Param(1)))
        .sort(vec![SortKey {
            field: Field("c\"d".into()),
            descending: false,
        }]);
    assert_eq!(
        to_sql(&e),
        r#"SELECT "c""d" FROM "a""b" WHERE "c""d" = $1 ORDER BY "c""d" ASC"#
    );
}

#[test]
fn nested_projection_uses_a_subquery() {
    let e = RelExpr::scan("r")
        .project(vec!["id", "owner_id"])
        .project(vec!["id"]);
    assert_eq!(
        to_sql(&e),
        r#"SELECT "id" FROM (SELECT "id", "owner_id" FROM "r") AS query"#
    );
}

#[test]
fn repeated_filters_use_a_subquery() {
    let e = RelExpr::scan("r")
        .filter(Predicate::Eq(Field("id".into()), Param(1)))
        .filter(Predicate::Eq(Field("owner_id".into()), Param(2)));
    assert_eq!(
        to_sql(&e),
        r#"SELECT * FROM (SELECT * FROM "r" WHERE "id" = $1) AS query WHERE "owner_id" = $2"#
    );
}

#[test]
fn operations_after_limit_preserve_the_limited_input() {
    let limited = RelExpr::scan("r").limit(Param(1));
    assert_eq!(
        to_sql(
            &limited
                .clone()
                .filter(Predicate::Eq(Field("id".into()), Param(2)))
        ),
        r#"SELECT * FROM (SELECT * FROM "r" LIMIT $1) AS query WHERE "id" = $2"#
    );
    assert_eq!(
        to_sql(&limited.clone().sort(vec![SortKey {
            field: Field("id".into()),
            descending: false
        }])),
        r#"SELECT * FROM (SELECT * FROM "r" LIMIT $1) AS query ORDER BY "id" ASC"#
    );
    assert_eq!(
        to_sql(&limited.limit(Param(2))),
        r#"SELECT * FROM (SELECT * FROM "r" LIMIT $1) AS query LIMIT $2"#
    );
}

#[test]
fn empty_and_nested_conjunctions_and_empty_sort() {
    let e = RelExpr::scan("r")
        .filter(Predicate::And(vec![
            Predicate::And(vec![]),
            Predicate::And(vec![Predicate::Eq(Field("id".into()), Param(1))]),
        ]))
        .sort(vec![]);
    assert_eq!(to_sql(&e), r#"SELECT * FROM "r" WHERE TRUE AND "id" = $1"#);
}
