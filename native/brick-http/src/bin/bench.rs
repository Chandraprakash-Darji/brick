//! Benchmark prototype, not the production Brick runtime.
use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

type Shared = Arc<AppState>;
struct AppState {
    db: Mutex<Connection>,
    custom_url: String,
    client: reqwest::Client,
}

#[derive(Serialize)]
struct Fixed {
    ok: bool,
}
#[derive(Serialize, Clone)]
struct Item {
    id: String,
    title: String,
}
#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct ListQuery {
    limit: Option<u32>,
    offset: Option<u32>,
}
#[derive(Serialize)]
struct Cursor<'a> {
    v: [&'a str; 2],
    s: &'a str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListResponse {
    records: Vec<Item>,
    items: Vec<Item>,
    total: u64,
    limit: u32,
    offset: u32,
    page: u64,
    page_count: u64,
    has_more: bool,
    next_cursor: Option<String>,
}

fn list_rows(db: &Connection, query: ListQuery) -> Result<ListResponse, rusqlite::Error> {
    let limit = query.limit.unwrap_or(20);
    let offset = query.offset.unwrap_or(0);
    // Execute both queries on every request, just like Brick's resource list.
    let total = db
        .prepare_cached("SELECT count(*) FROM bench_items")?
        .query_row([], |row| row.get::<_, i64>(0))? as u64;
    let mut statement =
        db.prepare_cached("SELECT id, title FROM bench_items ORDER BY id ASC LIMIT ?1 OFFSET ?2")?;
    let records = statement
        .query_map([limit, offset], |row| {
            Ok(Item {
                id: row.get(0)?,
                title: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let has_more = u64::from(offset) + (records.len() as u64) < total;
    let next_cursor = if has_more {
        records.last().map(|last| {
            URL_SAFE_NO_PAD.encode(
                serde_json::to_vec(&Cursor {
                    v: [&last.id, &last.id],
                    s: "id",
                })
                .unwrap(),
            )
        })
    } else {
        None
    };
    Ok(ListResponse {
        items: records.clone(),
        records,
        total,
        limit,
        offset,
        page: u64::from(offset) / u64::from(limit) + 1,
        page_count: total.div_ceil(u64::from(limit)),
        has_more,
        next_cursor,
    })
}

async fn list(
    State(state): State<Shared>,
    Query(query): Query<ListQuery>,
) -> Result<Json<ListResponse>, StatusCode> {
    if !matches!(query.limit.unwrap_or(20), 1..=100) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    list_rows(&db, query)
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn custom(State(state): State<Shared>) -> Result<Response, StatusCode> {
    // Only this dedicated custom-action route calls TypeScript.
    let upstream = state
        .client
        .get(&state.custom_url)
        .send()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;
    let status = upstream.status();
    let body = upstream
        .bytes()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;
    Ok((status, [("content-type", "application/json")], body).into_response())
}

// One event-loop thread, matching Bun's single JavaScript execution thread.
#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let port = args
        .next()
        .ok_or("usage: brick-runtime-bench PORT SQLITE_PATH CUSTOM_URL")?;
    let path = args.next().ok_or("missing sqlite path")?;
    let custom_url = args.next().ok_or("missing custom action URL")?;
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    db.prepare_cached("SELECT count(*) FROM bench_items")?;
    db.prepare_cached("SELECT id, title FROM bench_items ORDER BY id ASC LIMIT ?1 OFFSET ?2")?;
    let state = Arc::new(AppState {
        db: Mutex::new(db),
        custom_url,
        client: reqwest::Client::new(),
    });
    let app = Router::new()
        .route("/fixed", get(|| async { Json(Fixed { ok: true }) }))
        .route("/api/item", get(list))
        .route("/custom", get(custom))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await?;
    println!("native benchmark listening on {}", listener.local_addr()?);
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lists_query_the_database_and_preserve_pagination() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE bench_items (id TEXT PRIMARY KEY, title TEXT NOT NULL); INSERT INTO bench_items VALUES ('a', 'A'), ('b', 'B'), ('c', 'C');").unwrap();
        let first = list_rows(
            &db,
            ListQuery {
                limit: Some(2),
                offset: None,
            },
        )
        .unwrap();
        assert_eq!(first.total, 3);
        assert_eq!(first.records.len(), 2);
        assert!(first.has_more);
        assert_eq!(first.page_count, 2);
        assert_eq!(
            URL_SAFE_NO_PAD.decode(first.next_cursor.unwrap()).unwrap(),
            br#"{"v":["b","b"],"s":"id"}"#
        );
        db.execute(
            "UPDATE bench_items SET title = 'Changed' WHERE id = 'c'",
            [],
        )
        .unwrap();
        let last = list_rows(
            &db,
            ListQuery {
                limit: Some(2),
                offset: Some(2),
            },
        )
        .unwrap();
        assert_eq!(last.records[0].title, "Changed");
        assert!(!last.has_more);
        assert!(last.next_cursor.is_none());
    }
}
