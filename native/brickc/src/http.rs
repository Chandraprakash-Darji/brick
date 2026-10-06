//! Physical read plans for the native HTTP adapter. Eligible resources are
//! explicitly supplied by the TS authoring layer after checking callback use.
use crate::{CompileError, QueryError};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeReadPlan {
    pub service: String,
    pub resource: String,
    pub plural_name: String,
    pub get: bool,
    pub list: bool,
    pub get_sql: String,
    pub count_sql: String,
    pub list_sql: String,
    pub fields: Vec<NativeField>,
    pub list_fields: Vec<NativeField>,
    pub default_limit: u32,
    pub max_limit: u32,
    pub default_sort: String,
    pub primary_sort: String,
    pub id_field: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub writes: Option<NativeWritePlan>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeField {
    pub name: String,
    pub kind: String,
    pub nullable: bool,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeWritePlan {
    pub create: bool,
    pub update: bool,
    pub delete: bool,
    pub id_prefix: String,
    pub table_sql: String,
    pub id_sql: String,
    pub columns: Vec<NativeWriteField>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeWriteField {
    pub field: NativeField,
    pub column_sql: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteHint {
    create: bool,
    update: bool,
    delete: bool,
    id_prefix: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Hint {
    service: String,
    resource: String,
    plural_name: String,
    get: bool,
    list: bool,
    default_limit: u32,
    max_limit: u32,
    default_sort: String,
    orders: Vec<Order>,
    list_fields: Vec<String>,
    #[serde(default)]
    writes: Option<WriteHint>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Order {
    field: String,
    db_name: String,
    descending: bool,
}
fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}
fn invalid(name: &str) -> CompileError {
    QueryError::InvalidOperation(format!("native read plan: {name}")).into()
}

pub(crate) fn compile_reads(source: &Value) -> Result<Vec<NativeReadPlan>, CompileError> {
    let hints: Vec<Hint> = serde_json::from_value(
        source
            .get("nativeResources")
            .cloned()
            .unwrap_or_else(|| serde_json::json!([])),
    )
    .map_err(crate::ManifestError::InvalidJson)?;
    let mut plans = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for hint in hints {
        if !seen.insert((hint.service.clone(), hint.resource.clone())) {
            return Err(invalid("duplicate resource"));
        }
        let service = source["services"]
            .as_array()
            .and_then(|s| s.iter().find(|s| s["name"] == hint.service))
            .ok_or_else(|| invalid(&hint.service))?;
        let resource = service["resources"]
            .as_array()
            .and_then(|r| r.iter().find(|r| r["name"] == hint.resource))
            .ok_or_else(|| invalid(&hint.resource))?;
        if resource["ownerField"].as_str().is_some() {
            return Err(invalid("owner policy requires Bun"));
        }
        let table = service["tables"]
            .as_array()
            .and_then(|t| t.iter().find(|t| t["name"] == resource["table"]))
            .ok_or_else(|| invalid(&hint.resource))?;
        let table_name = table["name"].as_str().ok_or_else(|| invalid("table"))?;
        let columns = table["fields"]
            .as_array()
            .ok_or_else(|| invalid("fields"))?;
        let pk = columns
            .iter()
            .find(|f| f["primaryKey"] == true)
            .ok_or_else(|| invalid("primary key"))?;
        let logical = |field: &Value| field["name"].as_str().unwrap_or("").to_string();
        let physical = |field: &Value| {
            field["dbName"]
                .as_str()
                .or(field["name"].as_str())
                .unwrap_or("")
                .to_string()
        };
        let descriptor = |field: &Value| NativeField {
            name: logical(field),
            kind: field["type"].as_str().unwrap_or("string").to_string(),
            nullable: field["nullable"].as_bool().unwrap_or(true),
        };
        let fields: Vec<_> = columns.iter().map(descriptor).collect();
        if fields.iter().any(|f| {
            !matches!(
                f.kind.as_str(),
                "string" | "uuid" | "integer" | "number" | "boolean"
            )
        }) {
            return Err(invalid("column decoder"));
        }
        let selected: Vec<_> = hint
            .list_fields
            .iter()
            .map(|name| {
                columns
                    .iter()
                    .find(|f| f["name"] == *name)
                    .ok_or_else(|| invalid(name))
            })
            .collect::<Result<_, _>>()?;
        if selected.is_empty()
            || hint.orders.is_empty()
            || hint.default_limit == 0
            || hint.max_limit < hint.default_limit
        {
            return Err(invalid("pagination/projection"));
        }
        for order in &hint.orders {
            if !columns
                .iter()
                .any(|f| logical(f) == order.field && physical(f) == order.db_name)
            {
                return Err(invalid("sort field"));
            }
        }
        let projection = |fs: &[&Value]| {
            fs.iter()
                .map(|f| quote(&physical(f)))
                .collect::<Vec<_>>()
                .join(", ")
        };
        let orders = hint
            .orders
            .iter()
            .map(|o| {
                format!(
                    "{} {}",
                    quote(&o.db_name),
                    if o.descending { "DESC" } else { "ASC" }
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        let writes = hint.writes.map(|write| NativeWritePlan {
            create: write.create,
            update: write.update,
            delete: write.delete,
            id_prefix: write.id_prefix,
            table_sql: quote(table_name),
            id_sql: quote(&physical(pk)),
            columns: columns
                .iter()
                .map(|field| NativeWriteField {
                    field: descriptor(field),
                    column_sql: quote(&physical(field)),
                })
                .collect(),
        });
        plans.push(NativeReadPlan {
            writes,
            service: hint.service,
            resource: hint.resource,
            plural_name: hint.plural_name,
            get: hint.get,
            list: hint.list,
            get_sql: format!(
                "SELECT {} FROM {} WHERE {} = ?1 LIMIT 1",
                projection(&columns.iter().collect::<Vec<_>>()),
                quote(table_name),
                quote(&physical(pk))
            ),
            count_sql: format!("SELECT count(*) FROM {}", quote(table_name)),
            list_sql: format!(
                "SELECT {} FROM {} ORDER BY {} LIMIT ?1 OFFSET ?2",
                projection(&selected),
                quote(table_name),
                orders
            ),
            list_fields: selected.iter().map(|f| descriptor(f)).collect(),
            fields,
            default_limit: hint.default_limit,
            max_limit: hint.max_limit,
            default_sort: hint.default_sort,
            primary_sort: hint.orders[0].field.clone(),
            id_field: logical(pk),
        });
    }
    Ok(plans)
}
