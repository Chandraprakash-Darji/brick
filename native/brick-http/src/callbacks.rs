//! Routes and compiled JSON-schema checks for in-process JavaScript callbacks.
use axum::{
    Json,
    body::to_bytes,
    extract::Request,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::{collections::HashMap, future::Future, pin::Pin, time::Duration};

#[derive(Clone)]
pub struct Header {
    pub name: String,
    pub value: String,
}
pub struct CallbackRequest {
    pub binding_id: u32,
    pub method: String,
    pub url: String,
    pub headers: Vec<Header>,
    pub params: String,
    pub query: String,
    pub body: Vec<u8>,
    pub input: Option<String>,
    pub input_validated: bool,
    pub output_validated: bool,
}
pub struct CallbackResponse {
    pub status: u16,
    pub headers: Vec<Header>,
    pub body: Vec<u8>,
    pub json: bool,
}
pub trait Dispatcher: Send + Sync {
    fn call(
        &self,
        request: CallbackRequest,
    ) -> Pin<Box<dyn Future<Output = Result<CallbackResponse, String>> + Send + '_>>;
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallbackBinding {
    pub id: u32,
    pub method: String,
    pub path: String,
    pub action_name: Option<String>,
    #[serde(default)]
    pub has_input: bool,
    #[serde(default)]
    pub is_get_like: bool,
    #[serde(default)]
    pub native_validation: bool,
    pub input_schema: Option<Value>,
    pub output_schema: Option<Value>,
}
struct CompiledBinding {
    binding: CallbackBinding,
    input: Option<jsonschema::Validator>,
    output: Option<jsonschema::Validator>,
}
pub struct CallbackRoutes {
    routes: matchit::Router<Vec<CompiledBinding>>,
}
fn path_pattern(path: &str) -> String {
    path.split('/')
        .map(|segment| {
            if let Some(name) = segment.strip_prefix(':') {
                format!("{{{name}}}")
            } else if segment == "*" {
                "{*wildcard}".to_owned()
            } else {
                segment.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}
impl CallbackRoutes {
    pub fn new(
        bindings: Vec<CallbackBinding>,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let mut grouped: HashMap<String, Vec<CompiledBinding>> = HashMap::new();
        for binding in bindings {
            let compile =
                |schema: Option<&Value>| -> Result<_, Box<dyn std::error::Error + Send + Sync>> {
                    Ok(if binding.native_validation {
                        schema.map(jsonschema::validator_for).transpose()?
                    } else {
                        None
                    })
                };
            let input = compile(binding.input_schema.as_ref())?;
            let output = compile(binding.output_schema.as_ref())?;
            grouped
                .entry(path_pattern(&binding.path))
                .or_default()
                .push(CompiledBinding {
                    binding,
                    input,
                    output,
                });
        }
        let mut routes = matchit::Router::new();
        for (path, bindings) in grouped {
            routes.insert(path, bindings)?;
        }
        Ok(Self { routes })
    }
    pub fn overrides_resource(&self, request: &Request, resource: &str, operation: &str) -> bool {
        self.routes
            .at(request.uri().path())
            .ok()
            .and_then(|matched| {
                matched
                    .value
                    .iter()
                    .find(|b| b.binding.method == request.method().as_str())
            })
            .is_some_and(|route| {
                route.binding.action_name.as_deref() != Some(&format!("{resource}.{operation}"))
            })
    }
    pub async fn dispatch(&self, dispatcher: &dyn Dispatcher, request: Request) -> Response {
        let matched = match self.routes.at(request.uri().path()) {
            Ok(m) => m,
            Err(_) => return (StatusCode::NOT_FOUND, "NOT_FOUND").into_response(),
        };
        let Some(route) = matched
            .value
            .iter()
            .find(|b| b.binding.method == request.method().as_str())
        else {
            return (StatusCode::NOT_FOUND, "NOT_FOUND").into_response();
        };
        let mut params = Map::new();
        for (name, value) in matched.params.iter() {
            let Ok(value) = percent_encoding::percent_decode_str(value).decode_utf8() else {
                return StatusCode::BAD_REQUEST.into_response();
            };
            params.insert(name.to_owned(), Value::String(value.into_owned()));
        }
        let query_pairs: Vec<(String, String)> =
            match serde_urlencoded::from_str(request.uri().query().unwrap_or("")) {
                Ok(q) => q,
                Err(_) => return StatusCode::BAD_REQUEST.into_response(),
            };
        let query: Map<String, Value> = query_pairs
            .into_iter()
            .map(|(k, v)| (k, Value::String(v)))
            .collect();
        let method = request.method().to_string();
        let host = request
            .headers()
            .get("host")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("localhost");
        let url = format!("http://{host}{}", request.uri());
        let headers = request
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                value.to_str().ok().map(|value| Header {
                    name: name.to_string(),
                    value: value.to_owned(),
                })
            })
            .collect();
        let is_json = request
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.split(';').next().unwrap_or("").trim() == "application/json");
        let body = match to_bytes(request.into_body(), 16 * 1024 * 1024).await {
            Ok(b) => b,
            Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
        };
        let body_json: Option<Value> = if is_json && !body.is_empty() {
            match serde_json::from_slice(&body) { Ok(v) => Some(v), Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"name":"ParseError","message":"Invalid request body","status":400}))).into_response() }
        } else {
            None
        };
        // Unusual numeric coercions / non-JSON body formats use the JS checks in-process.
        let prepared = if route.binding.native_validation && (body.is_empty() || is_json) {
            prepare_input(route, &params, &query, body_json.as_ref())
        } else {
            None
        };
        let input_validated = prepared.is_some();
        let input = prepared.flatten();
        if input_validated {
            if let Some(validator) = &route.input {
                if let Some(error) =
                    validation_error(validator, input.as_ref(), route, "input", 400)
                {
                    return error;
                }
            }
        }
        let response = tokio::time::timeout(
            Duration::from_secs(30),
            dispatcher.call(CallbackRequest {
                binding_id: route.binding.id,
                method,
                url,
                headers,
                params: serde_json::to_string(&params).unwrap(),
                query: serde_json::to_string(&query).unwrap(),
                body: body.to_vec(),
                input: input.map(|v| serde_json::to_string(&v).unwrap()),
                input_validated,
                output_validated: route.output.is_some(),
            }),
        )
        .await;
        let response = match response {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
            Err(_) => return StatusCode::GATEWAY_TIMEOUT.into_response(),
        };
        if (200..300).contains(&response.status) && response.json {
            if let Some(validator) = &route.output {
                let value = if response.json {
                    serde_json::from_slice(&response.body).ok()
                } else {
                    None
                };
                if let Some(error) =
                    validation_error(validator, value.as_ref(), route, "output", 500)
                {
                    return error;
                }
            }
        }
        let mut headers = HeaderMap::new();
        for header in response.headers {
            let (Ok(name), Ok(value)) = (
                header.name.parse::<axum::http::HeaderName>(),
                header.value.parse::<axum::http::HeaderValue>(),
            ) else {
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            };
            headers.append(name, value);
        }
        (
            StatusCode::from_u16(response.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            headers,
            response.body,
        )
            .into_response()
    }
}
fn nonempty(value: &Value) -> bool {
    match value {
        Value::Object(v) => !v.is_empty(),
        Value::Array(v) => !v.is_empty(),
        Value::String(v) => !v.is_empty(),
        _ => false,
    }
}
fn prepare_input(
    route: &CompiledBinding,
    params: &Map<String, Value>,
    query: &Map<String, Value>,
    body: Option<&Value>,
) -> Option<Option<Value>> {
    if !route.binding.has_input {
        return Some(None);
    }
    let mut query = query.clone();
    if let Some(properties) = route
        .binding
        .input_schema
        .as_ref()
        .and_then(|s| s["properties"].as_object())
    {
        for (name, schema) in properties {
            if let Some(Value::String(raw)) = query.get(name) {
                let value = match schema["type"].as_str() {
                    Some("number" | "integer") => {
                        let number = if raw.trim().is_empty() {
                            0.0
                        } else {
                            match raw.parse::<f64>() {
                                Ok(v) if v.is_finite() => v,
                                _ => return None,
                            }
                        };
                        Some(Value::from(number))
                    }
                    Some("boolean") => match raw.as_str() {
                        "true" | "1" => Some(Value::Bool(true)),
                        "false" | "0" => Some(Value::Bool(false)),
                        _ => None,
                    },
                    _ => None,
                };
                if let Some(value) = value {
                    query.insert(name.clone(), value);
                }
            }
        }
    }
    let params = Value::Object(params.clone());
    let query = Value::Object(query);
    let empty = Value::Null;
    let body = body.unwrap_or(&empty);
    let sources = if route.binding.is_get_like {
        [&query, &params, body]
    } else {
        [&params, body, &query]
    };
    let present: Vec<_> = sources.into_iter().filter(|v| nonempty(v)).collect();
    if present.len() == 1 {
        return Some(Some(present[0].clone()));
    }
    if present.is_empty() {
        return Some(None);
    }
    let mut input = Map::new();
    for value in present {
        match value {
            Value::Object(map) => input.extend(map.clone()),
            _ => return None,
        }
    }
    Some(Some(Value::Object(input)))
}
fn validation_error(
    validator: &jsonschema::Validator,
    value: Option<&Value>,
    route: &CompiledBinding,
    direction: &str,
    status: u16,
) -> Option<Response> {
    if value.is_none() {
        return Some((StatusCode::from_u16(status).unwrap(), Json(serde_json::json!({ "name": "ValidationError",
            "message": format!("Validation failed for action '{}' {direction}", route.binding.action_name.as_deref().unwrap_or("endpoint")),
            "status": status, "errors": [{ "path": "", "message": "Expected a value matching the schema" }] }))).into_response());
    }
    let value = value.unwrap();
    if validator.is_valid(value) {
        return None;
    }
    let errors: Vec<_> = validator.iter_errors(value).map(|e| serde_json::json!({ "path": e.instance_path().to_string(), "message": e.to_string(), "value": e.instance() })).collect();
    Some((StatusCode::from_u16(status).unwrap(), Json(serde_json::json!({ "name": "ValidationError", "message": format!("Validation failed for action '{}' {direction}", route.binding.action_name.as_deref().unwrap_or("endpoint")), "status": status, "errors": errors }))).into_response())
}
