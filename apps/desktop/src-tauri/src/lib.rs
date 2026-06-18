//! Tauri shell for crawlie. A thin layer over `crawlie-core`: crawl commands
//! that stream progress, plus saved-report history backed by the core
//! `ReportStore` in the app data directory.

use crawlie_core::{crawl, CancelToken, CrawlConfig, CrawlResult, ReportMeta, ReportStore};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct CrawlState {
    cancel: Mutex<Option<CancelToken>>,
}

fn store(app: &AppHandle) -> ReportStore {
    let dir: PathBuf = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("reports");
    ReportStore::new(dir)
}

/// Run a crawl, emitting `crawl-event` to the webview, then auto-save it to
/// history. Returns the full result.
#[tauri::command]
async fn start_crawl(app: AppHandle, config: CrawlConfig) -> Result<CrawlResult, String> {
    let token = CancelToken::new();
    {
        let state = app.state::<CrawlState>();
        *state.cancel.lock().unwrap() = Some(token.clone());
    }

    let emitter = app.clone();
    let on_event = move |evt| {
        let _ = emitter.emit("crawl-event", evt);
    };

    let result = crawl(config, on_event, token).await.map_err(|e| e.to_string());

    {
        let state = app.state::<CrawlState>();
        *state.cancel.lock().unwrap() = None;
    }

    if let Ok(r) = &result {
        let _ = store(&app).save(r);
    }
    result
}

#[tauri::command]
fn cancel_crawl(state: State<'_, CrawlState>) {
    if let Some(token) = state.cancel.lock().unwrap().as_ref() {
        token.cancel();
    }
}

#[tauri::command]
fn list_reports(app: AppHandle) -> Vec<ReportMeta> {
    store(&app).list()
}

#[tauri::command]
fn load_report(app: AppHandle, id: String) -> Option<CrawlResult> {
    store(&app).load(&id)
}

#[tauri::command]
fn delete_report(app: AppHandle, id: String) -> Result<(), String> {
    store(&app).delete(&id).map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .manage(CrawlState::default())
        .invoke_handler(tauri::generate_handler![
            start_crawl,
            cancel_crawl,
            list_reports,
            load_report,
            delete_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running crawlie");
}
