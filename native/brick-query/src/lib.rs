use brick_resource::ResourcePlan;

#[derive(Debug, Clone, PartialEq)]
pub struct Table(pub String);

#[derive(Debug, Clone, PartialEq)]
pub struct Field(pub String);

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Param(pub u32);

#[derive(Debug, Clone, PartialEq)]
pub enum Predicate {
    Eq(Field, Param),
    And(Vec<Predicate>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct SortKey {
    pub field: Field,
    pub descending: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RelExpr {
    Scan {
        table: Table,
    },
    Filter {
        input: Box<RelExpr>,
        pred: Predicate,
    },
    Project {
        input: Box<RelExpr>,
        fields: Vec<Field>,
    },
    Sort {
        input: Box<RelExpr>,
        keys: Vec<SortKey>,
    },
    Limit {
        input: Box<RelExpr>,
        limit: Param,
    },
}

impl RelExpr {
    pub fn scan(table: &str) -> Self {
        RelExpr::Scan {
            table: Table(table.to_string()),
        }
    }

    pub fn filter(self, pred: Predicate) -> Self {
        RelExpr::Filter {
            input: Box::new(self),
            pred,
        }
    }

    pub fn project(self, fields: Vec<&str>) -> Self {
        let input: Box<RelExpr> = Box::new(self);
        let mut fs: Vec<Field> = vec![];
        for f in fields {
            fs.push(Field(f.to_string()));
        }
        RelExpr::Project { input, fields: fs }
    }

    pub fn sort(self, keys: Vec<SortKey>) -> Self {
        RelExpr::Sort {
            input: Box::new(self),
            keys,
        }
    }

    pub fn limit(self, param: Param) -> Self {
        RelExpr::Limit {
            input: Box::new(self),
            limit: param,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum QueryError {
    #[error("invalid operation {0}")]
    InvalidOperation(String),
}

/// Lower an enabled `list` or `get` operation into a parameterized query.
///
/// `get` binds the primary key at $1, followed by the owner (if present).
/// `list` binds the owner first, then an optional limit. The limit value must
/// be bound by the caller; this function only uses its presence. Limits apply
/// only to `list`. Resource names are the scan targets supplied by ResourcePlan.
pub fn plan_for_operation(
    plan: &ResourcePlan,
    operation: &str,
    limit: Option<u32>,
) -> Result<RelExpr, QueryError> {
    if !matches!(operation, "list" | "get") || !plan.operations.iter().any(|op| op == operation) {
        return Err(QueryError::InvalidOperation(operation.to_string()));
    }

    let mut fields = vec![plan.primary_key_name.as_str()];
    if let Some(owner) = &plan.owner_field_name
        && owner != &plan.primary_key_name
    {
        fields.push(owner);
    }
    let mut expr = RelExpr::scan(&plan.resource_name).project(fields);
    let mut predicates = Vec::new();
    let mut next_param = 1;
    if operation == "get" {
        predicates.push(Predicate::Eq(
            Field(plan.primary_key_name.clone()),
            Param(next_param),
        ));
        next_param += 1;
    }
    if let Some(owner) = &plan.owner_field_name {
        predicates.push(Predicate::Eq(Field(owner.clone()), Param(next_param)));
        next_param += 1;
    }
    if predicates.len() == 1 {
        expr = expr.filter(predicates.remove(0));
    } else if !predicates.is_empty() {
        expr = expr.filter(Predicate::And(predicates));
    }
    if operation == "list" && limit.is_some() {
        expr = expr.limit(Param(next_param));
    }
    Ok(expr)
}

pub fn to_sql(expr: &RelExpr) -> String {
    match expr {
        RelExpr::Scan { table } => format!("SELECT * FROM {}", identifier(&table.0)),
        RelExpr::Project { input, fields } => {
            let from = match input.as_ref() {
                RelExpr::Scan { table } => identifier(&table.0),
                _ => format!("({}) AS query", to_sql(input)),
            };
            format!("SELECT {} FROM {}", field_list(fields), from)
        }
        RelExpr::Filter { input, pred } => {
            let sql = match input.as_ref() {
                RelExpr::Filter { .. } | RelExpr::Sort { .. } | RelExpr::Limit { .. } => {
                    format!("SELECT * FROM ({}) AS query", to_sql(input))
                }
                _ => to_sql(input),
            };
            format!("{} WHERE {}", sql, pred_sql(pred))
        }
        RelExpr::Sort { input, keys } => {
            if keys.is_empty() {
                return to_sql(input);
            }
            let sql = match input.as_ref() {
                RelExpr::Sort { .. } | RelExpr::Limit { .. } => {
                    format!("SELECT * FROM ({}) AS query", to_sql(input))
                }
                _ => to_sql(input),
            };
            format!("{} ORDER BY {}", sql, sort_sql(keys))
        }
        RelExpr::Limit { input, limit } => {
            let sql = match input.as_ref() {
                RelExpr::Limit { .. } => format!("SELECT * FROM ({}) AS query", to_sql(input)),
                _ => to_sql(input),
            };
            format!("{} LIMIT ${}", sql, limit.0)
        }
    }
}

fn field_list(fields: &[Field]) -> String {
    fields
        .iter()
        .map(|f| identifier(&f.0))
        .collect::<Vec<String>>()
        .join(", ")
}

fn identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn pred_sql(pred: &Predicate) -> String {
    match pred {
        Predicate::Eq(field, param) => format!("{} = ${}", identifier(&field.0), param.0),
        Predicate::And(preds) if preds.is_empty() => "TRUE".to_string(),
        Predicate::And(preds) => preds
            .iter()
            .map(pred_sql)
            .collect::<Vec<String>>()
            .join(" AND "),
    }
}

fn sort_sql(keys: &[SortKey]) -> String {
    keys.iter()
        .map(|k| {
            if k.descending {
                format!("{} DESC", identifier(&k.field.0))
            } else {
                format!("{} ASC", identifier(&k.field.0))
            }
        })
        .collect::<Vec<String>>()
        .join(", ")
}
