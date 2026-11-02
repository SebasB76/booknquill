//! E2E only: serves the same `Notes::dispatch` over HTTP so Playwright can drive the real UI
//! against the real Rust core in Chromium (Arch ships no WebKitWebDriver for tauri-driver).

use axum::extract::{Query, State};
use axum::http::{header, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use booknquill_lib::core::{watch, Invoke, Notes};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower_http::cors::CorsLayer;

type Watcher = notify_debouncer_mini::Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>;

#[derive(Clone)]
struct Bridge {
    notes: Arc<Mutex<Notes>>,
    watcher: Arc<Mutex<Option<Watcher>>>,
    changes: broadcast::Sender<Vec<String>>,
    fixtures: PathBuf,
}

static RUN: AtomicU32 = AtomicU32::new(0);

#[tokio::main]
async fn main() {
    let fixtures = PathBuf::from(std::env::var("BNQ_FIXTURES").expect("BNQ_FIXTURES must point to the fixture notes"));
    let port = std::env::var("BNQ_BRIDGE_PORT").unwrap_or_else(|_| "1421".into());
    let (changes, _) = broadcast::channel(64);
    let bridge = Bridge {
        notes: Arc::new(Mutex::new(Notes::new(fresh_dir(&fixtures)).unwrap())),
        watcher: Arc::new(Mutex::new(None)),
        changes,
        fixtures,
    };
    bridge.restart_watcher();

    let app = Router::new()
        .route("/invoke", post(invoke))
        .route("/events", get(events))
        .route("/file", get(file))
        .route("/__e2e/reset", post(reset))
        .route("/health", get(|| async { "ok" }))
        .layer(CorsLayer::very_permissive())
        .with_state(bridge);
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

impl Bridge {
    fn restart_watcher(&self) {
        let dir = self.notes.lock().unwrap().dir().to_path_buf();
        let tx = self.changes.clone();
        let w = watch(&dir, move |files| {
            let _ = tx.send(files);
        })
        .unwrap();
        *self.watcher.lock().unwrap() = Some(w);
    }
}

async fn invoke(State(b): State<Bridge>, Json(req): Json<Invoke>) -> impl IntoResponse {
    match b.notes.lock().unwrap().dispatch(&req.cmd, req.args) {
        Ok(v) => (StatusCode::OK, Json(v)),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))),
    }
}

async fn events(State(b): State<Bridge>) -> Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>> {
    let stream = BroadcastStream::new(b.changes.subscribe())
        .filter_map(|m| m.ok())
        .map(|files| Ok(Event::default().data(serde_json::to_string(&files).unwrap())));
    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// Serves note images, the stand-in for Tauri's asset protocol.
async fn file(State(b): State<Bridge>, Query(q): Query<HashMap<String, String>>) -> impl IntoResponse {
    let dir = b.notes.lock().unwrap().dir().to_path_buf();
    let Some(path) = q.get("path").map(PathBuf::from) else { return StatusCode::BAD_REQUEST.into_response() };
    if !path.starts_with(&dir) || path.components().any(|c| c.as_os_str() == "..") {
        return StatusCode::FORBIDDEN.into_response();
    }
    match std::fs::read(&path) {
        Ok(bytes) => {
            let mime = match path.extension().and_then(|e| e.to_str()) {
                Some("png") => "image/png",
                Some("jpg" | "jpeg") => "image/jpeg",
                Some("gif") => "image/gif",
                Some("webp") => "image/webp",
                _ => "application/octet-stream",
            };
            ([(header::CONTENT_TYPE, mime)], bytes).into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Gives each test its own copy of the fixture notes.
async fn reset(State(b): State<Bridge>) -> Json<Value> {
    let dir = fresh_dir(&b.fixtures);
    *b.notes.lock().unwrap() = Notes::new(dir.clone()).unwrap();
    b.restart_watcher();
    Json(json!({ "dir": dir.to_string_lossy() }))
}

fn fresh_dir(fixtures: &Path) -> PathBuf {
    let n = RUN.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("booknquill-e2e-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    copy_dir(fixtures, &dir);
    dir
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}
