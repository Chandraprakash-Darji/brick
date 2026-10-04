//! Opt-in native HTTP gateway. Supported compiled SQLite reads execute here;
//! custom actions and unsupported features retain their TypeScript behavior.
use axum::{
    Json, Router,
    body::{Body, Bytes, to_bytes},
    extract::{Path, Query, Request, State},
    http::{HeaderMap, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use brickc::{NativeField, NativeReadPlan, RuntimeArtifact};
use rusqlite::{
    Connection, OpenFlags, Row, params_from_iter,
    types::{Value as SqlValue, ValueRef},
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    content_type: String,
    body: String,
}
struct Shared {
    started: Instant,
    architecture: Bytes,
    client: reqwest::Client,
    upstream: Option<String>,
    dispatcher: Option<Arc<dyn crate::callbacks::Dispatcher>>,
    callbacks: crate::callbacks::CallbackRoutes,
}
struct ResourceState {
    shared: Arc<Shared>,
    plan: NativeReadPlan,
    db: Mutex<Connection>,
}
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
struct Health {
    status: &'static str,
    uptime: f64,
    timestamp: u128,
}
async fn health(State(shared): State<Arc<Shared>>) -> Json<Health> {
    Json(Health {
        status: "ok",
        uptime: shared.started.elapsed().as_secs_f64(),
        timestamp: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    })
}
async fn architecture(State(shared): State<Arc<Shared>>) -> Response {
    (
        [("content-type", "application/json")],
        shared.architecture.clone(),
    )
        .into_response()
}

fn remove_hop_headers(headers: &mut HeaderMap) {
    let connection = headers
        .get("connection")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    for name in connection.split(',').map(str::trim) {
        headers.remove(name);
    }
    for name in [
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "content-length",
    ] {
        headers.remove(name);
    }
}
async fn forward(shared: &Shared, request: Request) -> Response {
    if let Some(dispatcher) = &shared.dispatcher {
        return shared
            .callbacks
            .dispatch(dispatcher.as_ref(), request)
            .await;
    }
    let Some(upstream_url) = &shared.upstream else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let (mut parts, body) = request.into_parts();
    remove_hop_headers(&mut parts.headers);
    let body = match to_bytes(body, 16 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
    };
    let url = format!(
        "{}{}",
        upstream_url.trim_end_matches('/'),
        parts
            .uri
            .path_and_query()
            .map(|p| p.as_str())
            .unwrap_or("/")
    );
    match shared
        .client
        .request(parts.method, url)
        .headers(parts.headers)
        .body(body)
        .send()
        .await
    {
        Ok(upstream) => {
            let status = upstream.status();
            let mut headers = upstream.headers().clone();
            remove_hop_headers(&mut headers);
            match upstream.bytes().await {
                Ok(body) => (status, headers, body).into_response(),
                Err(_) => StatusCode::BAD_GATEWAY.into_response(),
            }
        }
        Err(_) => StatusCode::BAD_GATEWAY.into_response(),
    }
}
async fn resource_fallback(State(state): State<Arc<ResourceState>>, request: Request) -> Response {
    forward(&state.shared, request).await
}
async fn fallback(State(shared): State<Arc<Shared>>, request: Request) -> Response {
    forward(&shared, request).await
}
async fn tracing(mut request: Request, next: Next) -> Response {
    let seq = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    for (name, prefix) in [("x-trace-id", "tr_"), ("x-request-id", "req_")] {
        if !request.headers().contains_key(name) {
            request
                .headers_mut()
                .insert(name, format!("{prefix}{seq:x}").parse().unwrap());
        }
    }
    let trace = request.headers()["x-trace-id"].clone();
    let id = request.headers()["x-request-id"].clone();
    let mut response = next.run(request).await;
    response.headers_mut().insert("x-trace-id", trace);
    response.headers_mut().insert("x-request-id", id);
    response
        .headers_mut()
        .insert("x-brick-runtime", "rust".parse().unwrap());
    response
}
fn decode(row: &Row<'_>, fields: &[NativeField]) -> rusqlite::Result<Value> {
    let mut object = Map::new();
    for (index, field) in fields.iter().enumerate() {
        let raw = row.get_ref(index)?;
        let value = match raw {
            ValueRef::Null if field.nullable => Value::Null,
            ValueRef::Integer(v) if field.kind == "boolean" => Value::Bool(v == 1),
            ValueRef::Integer(v) if matches!(field.kind.as_str(), "number" | "integer") => {
                Value::from(v)
            }
            ValueRef::Real(v) if matches!(field.kind.as_str(), "number" | "integer") => {
                Value::from(v)
            }
            ValueRef::Text(v) if matches!(field.kind.as_str(), "string" | "uuid") => {
                Value::String(String::from_utf8_lossy(v).into_owned())
            }
            _ => {
                return Err(rusqlite::Error::InvalidColumnType(
                    index,
                    field.name.clone(),
                    raw.data_type(),
                ));
            }
        };
        object.insert(field.name.clone(), value);
    }
    Ok(Value::Object(object))
}
fn error(status: StatusCode, name: &str, message: &str) -> Response {
    (
        status,
        Json(serde_json::json!({ "name": name, "message": message, "status": status.as_u16() })),
    )
        .into_response()
}
fn not_found(plan: &NativeReadPlan, id: &str, reading: bool) -> Response {
    let name = plan
        .resource
        .chars()
        .next()
        .map(|c| c.to_uppercase().to_string())
        .unwrap_or_default()
        + &plan.resource[plan
            .resource
            .chars()
            .next()
            .map(char::len_utf8)
            .unwrap_or(0)..];
    let suffix = if reading {
        "does not exist"
    } else {
        "not found"
    };
    (
        StatusCode::NOT_FOUND,
        Json(
            serde_json::json!({ "name": "ActionExecutionError", "code": "NOT_FOUND",
        "message": format!("{name} with ID '{id}' {suffix}"), "status": 404 }),
        ),
    )
        .into_response()
}
fn sql_value(value: &Value, kind: &str) -> Option<SqlValue> {
    match (kind, value) {
        ("string" | "uuid", Value::String(s)) => Some(SqlValue::Text(s.clone())),
        ("boolean", Value::Bool(b)) => Some(SqlValue::Integer(i64::from(*b))),
        ("number" | "integer", Value::Number(n)) => n
            .as_i64()
            .map(SqlValue::Integer)
            .or_else(|| n.as_f64().map(SqlValue::Real)),
        _ => None,
    }
}
async fn create_resource(State(state): State<Arc<ResourceState>>, request: Request) -> Response {
    write_resource(state, None, request).await
}
async fn mutate_resource(
    State(state): State<Arc<ResourceState>>,
    Path(id): Path<String>,
    request: Request,
) -> Response {
    write_resource(state, Some(id), request).await
}
async fn write_resource(
    state: Arc<ResourceState>,
    path_id: Option<String>,
    request: Request,
) -> Response {
    let operation = if request.method() == Method::POST {
        "create"
    } else if request.method() == Method::DELETE {
        "delete"
    } else {
        "update"
    };
    if state.shared.dispatcher.is_some()
        && state
            .shared
            .callbacks
            .overrides_resource(&request, &state.plan.resource, operation)
    {
        return forward(&state.shared, request).await;
    }
    let Some(plan) = &state.plan.writes else {
        return forward(&state.shared, request).await;
    };
    let method = request.method().clone();
    if request.uri().query().is_some() {
        return forward(&state.shared, request).await;
    }
    // Unsupported body formats and invalid schemas retain the existing TS errors.
    let is_json = request
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok())
        .is_some_and(|h| h.split(';').next().unwrap_or("").trim() == "application/json");
    if method != Method::DELETE && !is_json {
        return forward(&state.shared, request).await;
    }
    let (parts, body) = request.into_parts();
    let bytes = match to_bytes(body, 16 * 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
    };
    let request = Request::from_parts(parts, Body::from(bytes.clone()));
    let input = if bytes.is_empty() && method == Method::DELETE {
        Some(Map::new())
    } else {
        serde_json::from_slice::<Value>(&bytes)
            .ok()
            .and_then(|v| v.as_object().cloned())
    };
    let Some(input) = input else {
        return forward(&state.shared, request).await;
    };
    let creating = method == Method::POST;
    let deleting = method == Method::DELETE;
    let id = match input.get(&state.plan.id_field) {
        Some(Value::String(id)) if !id.is_empty() || !creating => id.clone(),
        Some(Value::String(_)) | None if creating => {
            // Match the configurable ID prefix; suffixes are opaque, unique IDs.
            format!(
                "{}_{:x}{:x}",
                plan.id_prefix,
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            )
        }
        None => path_id.unwrap_or_default(),
        _ => return forward(&state.shared, request).await,
    };
    let mut names = Vec::new();
    let mut values = Vec::new();
    for column in &plan.columns {
        if column.field.name == state.plan.id_field {
            continue;
        }
        match input.get(&column.field.name) {
            Some(value) if !deleting => match sql_value(value, &column.field.kind) {
                Some(value) => {
                    names.push(column.column_sql.clone());
                    values.push(value);
                }
                None => return forward(&state.shared, request).await,
            },
            None if creating && !column.field.nullable => {
                return forward(&state.shared, request).await;
            }
            _ => {}
        }
    }
    let result: rusqlite::Result<Option<Value>> = (|| {
        let db = state.db.lock().map_err(|_| rusqlite::Error::InvalidQuery)?;
        let transaction = db.unchecked_transaction()?;
        let read = |db: &Connection| -> rusqlite::Result<Option<Value>> {
            let mut statement = db.prepare_cached(&state.plan.get_sql)?;
            let mut rows = statement.query([&id])?;
            rows.next()?
                .map(|r| decode(r, &state.plan.fields))
                .transpose()
        };
        if creating {
            names.push(plan.id_sql.clone());
            values.push(SqlValue::Text(id.clone()));
            let placeholders = (1..=names.len())
                .map(|i| format!("?{i}"))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "INSERT INTO {} ({}) VALUES ({placeholders})",
                plan.table_sql,
                names.join(", ")
            );
            transaction
                .prepare_cached(&sql)?
                .execute(params_from_iter(values))?;
        } else if read(&transaction)?.is_none() {
            return Ok(None);
        } else if deleting {
            transaction
                .prepare_cached(&format!(
                    "DELETE FROM {} WHERE {} = ?1",
                    plan.table_sql, plan.id_sql
                ))?
                .execute([&id])?;
            transaction.commit()?;
            return Ok(Some(serde_json::json!({ "success": true, "id": id })));
        } else if !names.is_empty() {
            let set = names
                .iter()
                .enumerate()
                .map(|(i, name)| format!("{name} = ?{}", i + 1))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "UPDATE {} SET {set} WHERE {} = ?{}",
                plan.table_sql,
                plan.id_sql,
                names.len() + 1
            );
            values.push(SqlValue::Text(id.clone()));
            transaction
                .prepare_cached(&sql)?
                .execute(params_from_iter(values))?;
        }
        let row = read(&transaction)?;
        transaction.commit()?;
        Ok(row)
    })();
    match result {
        Ok(Some(value)) => Json(value).into_response(),
        Ok(None) => not_found(&state.plan, &id, false),
        Err(_) => error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "InternalServerError",
            "Native database write failed",
        ),
    }
}

async fn get_resource(
    State(state): State<Arc<ResourceState>>,
    Path(id): Path<String>,
    request: Request,
) -> Response {
    if state.shared.dispatcher.is_some()
        && state
            .shared
            .callbacks
            .overrides_resource(&request, &state.plan.resource, "get")
    {
        return forward(&state.shared, request).await;
    }
    if request.uri().query().is_some() {
        return forward(&state.shared, request).await;
    }
    let result = (|| {
        let db = state.db.lock().map_err(|_| rusqlite::Error::InvalidQuery)?;
        let mut statement = db.prepare_cached(&state.plan.get_sql)?;
        let mut rows = statement.query([&id])?;
        rows.next()?
            .map(|row| decode(row, &state.plan.fields))
            .transpose()
    })();
    match result {
        Ok(Some(row)) => Json(row).into_response(),
        Ok(None) => not_found(&state.plan, &id, true),
        Err(_) => error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "InternalServerError",
            "Native database read failed",
        ),
    }
}
#[derive(Serialize)]
struct Cursor<'a> {
    v: [&'a Value; 2],
    s: &'a str,
}
async fn list_resource(
    State(state): State<Arc<ResourceState>>,
    Query(query): Query<HashMap<String, String>>,
    request: Request,
) -> Response {
    if state.shared.dispatcher.is_some()
        && state
            .shared
            .callbacks
            .overrides_resource(&request, &state.plan.resource, "list")
    {
        return forward(&state.shared, request).await;
    }
    // Rich query shapes remain in Bun so existing filters/search/cursors are preserved.
    if query
        .keys()
        .any(|key| !matches!(key.as_str(), "limit" | "offset" | "page"))
    {
        return forward(&state.shared, request).await;
    }
    let number = |name: &str, default: u32| {
        query
            .get(name)
            .map(|s| s.parse::<u32>())
            .unwrap_or(Ok(default))
    };
    let limit = match number("limit", state.plan.default_limit) {
        Ok(v) if v > 0 && v <= state.plan.max_limit => v,
        _ => return forward(&state.shared, request).await,
    };
    let mut offset = match number("offset", 0) {
        Ok(v) => v,
        _ => return forward(&state.shared, request).await,
    };
    if query.contains_key("page") {
        offset = match number("page", 1)
            .ok()
            .filter(|p| *p > 0)
            .and_then(|p| (p - 1).checked_mul(limit))
        {
            Some(v) => v,
            None => return forward(&state.shared, request).await,
        };
    }
    let result: rusqlite::Result<Value> = (|| {
        let db = state.db.lock().map_err(|_| rusqlite::Error::InvalidQuery)?;
        let total: i64 = db
            .prepare_cached(&state.plan.count_sql)?
            .query_row([], |r| r.get(0))?;
        let mut statement = db.prepare_cached(&state.plan.list_sql)?;
        let records = statement
            .query_map([limit, offset], |row| decode(row, &state.plan.list_fields))?
            .collect::<Result<Vec<_>, _>>()?;
        let has_more = i64::from(offset) + (records.len() as i64) < total;
        let next_cursor = if has_more {
            records.last().and_then(|last| {
                let value = last
                    .get(&state.plan.primary_sort)
                    .filter(|v| !v.is_null())?;
                let id = last.get(&state.plan.id_field).unwrap_or(&Value::Null);
                Some(
                    URL_SAFE_NO_PAD.encode(
                        serde_json::to_vec(&Cursor {
                            v: [value, id],
                            s: &state.plan.default_sort,
                        })
                        .unwrap(),
                    ),
                )
            })
        } else {
            None
        };
        let mut result = serde_json::json!({ "items": records, "total": total, "limit": limit, "offset": offset,
            "page": offset / limit + 1, "pageCount": (total as u64).div_ceil(u64::from(limit)), "hasMore": has_more, "nextCursor": next_cursor });
        result[state.plan.plural_name.clone()] = result["items"].clone();
        Ok(result)
    })();
    match result {
        Ok(value) => Json(value).into_response(),
        Err(_) => error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "InternalServerError",
            "Native database read failed",
        ),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    pub plans: String,
    pub databases: String,
    pub architecture: String,
    pub documents: Option<String>,
    pub upstream: Option<String>,
    pub prefix: String,
    #[serde(default)]
    pub bindings: Vec<crate::callbacks::CallbackBinding>,
}

pub fn build_router(
    config: ServerConfig,
    dispatcher: Option<Arc<dyn crate::callbacks::Dispatcher>>,
) -> Result<Router, Box<dyn std::error::Error + Send + Sync>> {
    let artifact: RuntimeArtifact = serde_json::from_str(&&config.plans)?;
    if artifact.version != 1 {
        return Err("unsupported artifact version".into());
    }
    // Revalidate native descriptors against compiler input, rejecting edited SQL.
    let expected = brickc::compile_runtime_json(&artifact.source_manifest)?;
    if serde_json::to_value(&expected)? != serde_json::to_value(&artifact)? {
        return Err("artifact does not match compiler input".into());
    }
    let databases: HashMap<String, String> = serde_json::from_str(&&config.databases)?;
    let architecture_bytes = config.architecture.into_bytes();
    let _: Value = serde_json::from_slice(&architecture_bytes)?;
    let shared = Arc::new(Shared {
        started: Instant::now(),
        architecture: Bytes::from(architecture_bytes),
        client: reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()?,
        upstream: config.upstream,
        dispatcher,
        callbacks: crate::callbacks::CallbackRoutes::new(config.bindings)?,
    });
    let mut router = Router::new()
        .route("/_health", get(health))
        .route("/_brick/services", get(architecture));
    if let Some(documents_json) = config.documents {
        let documents: HashMap<String, Document> = serde_json::from_str(&documents_json)?;
        for (path, document) in documents {
            let content_type: axum::http::HeaderValue = document.content_type.parse()?;
            let body = Bytes::from(document.body);
            router = router.route(
                &path,
                get(move || {
                    let content_type = content_type.clone();
                    let body = body.clone();
                    async move { ([("content-type", content_type)], body).into_response() }
                }),
            );
        }
    }
    for plan in artifact.native_reads {
        let Some(path) = databases.get(&plan.service) else {
            continue;
        };
        let writable = plan
            .writes
            .as_ref()
            .is_some_and(|p| p.create || p.update || p.delete);
        let db = Connection::open_with_flags(
            path,
            if writable {
                OpenFlags::SQLITE_OPEN_READ_WRITE
            } else {
                OpenFlags::SQLITE_OPEN_READ_ONLY
            },
        )?;
        for sql in [&plan.get_sql, &plan.count_sql, &plan.list_sql] {
            db.prepare_cached(sql)?;
        }
        let collection = format!("{}/{}", config.prefix.trim_end_matches('/'), plan.resource);
        let item = format!("{collection}/{{id}}");
        let get_enabled = plan.get;
        let list_enabled = plan.list;
        let state = Arc::new(ResourceState {
            shared: shared.clone(),
            plan,
            db: Mutex::new(db),
        });
        let mut resource_router = Router::new();
        let writes = state.plan.writes.as_ref();
        let mut collection_methods = axum::routing::MethodRouter::new().fallback(resource_fallback);
        if list_enabled {
            collection_methods = collection_methods.get(list_resource);
        }
        if writes.is_some_and(|p| p.create) {
            collection_methods = collection_methods.post(create_resource);
        }
        if list_enabled || writes.is_some_and(|p| p.create) {
            resource_router = resource_router.route(&collection, collection_methods);
        }
        let mut item_methods = axum::routing::MethodRouter::new().fallback(resource_fallback);
        if get_enabled {
            item_methods = item_methods.get(get_resource);
        }
        if writes.is_some_and(|p| p.update) {
            item_methods = item_methods.patch(mutate_resource).put(mutate_resource);
        }
        if writes.is_some_and(|p| p.delete) {
            item_methods = item_methods.delete(mutate_resource);
        }
        if get_enabled || writes.is_some_and(|p| p.update || p.delete) {
            resource_router = resource_router.route(&item, item_methods);
        }
        router = router.merge(resource_router.with_state::<Arc<Shared>>(state));
        println!("native reads: GET {collection}, GET {item}");
    }
    let router = router
        .fallback(fallback)
        .with_state(shared)
        .layer(middleware::from_fn(tracing));
    Ok(router)
}
