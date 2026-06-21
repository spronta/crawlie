//! Tauri shell for crawlie. A thin layer over `crawlie-core`: crawl commands
//! that stream progress, plus saved-report history backed by the core
//! `ReportStore` in the app data directory.

use crawlie_core::{crawl, report_html, CancelToken, CrawlConfig, CrawlResult, ReportMeta, ReportStore};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct CrawlState {
    cancel: Mutex<Option<CancelToken>>,
}

/// User-configurable app settings, persisted to `settings.json` in the app data
/// directory. Surfaced in the in-app Settings panel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    /// Check for a newer release when the app launches.
    check_on_launch: bool,
    /// Download and install updates automatically (no prompt).
    auto_update: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            check_on_launch: true,
            auto_update: false,
        }
    }
}

fn settings_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("settings.json")
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Settings {
    std::fs::read_to_string(settings_path(&app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn set_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let path = settings_path(&app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(path, body).map_err(|e| e.to_string())
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

/// Render a shareable, self-contained HTML report and save it (to Downloads if
/// possible). Returns the absolute path written.
#[tauri::command]
fn save_html_report(app: AppHandle, result: CrawlResult) -> Result<String, String> {
    let html = report_html::render(&result);
    let host = url::Url::parse(&result.config.url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.replace('.', "-")))
        .unwrap_or_else(|| "site".into());
    let name = format!("crawlie-{host}-{}.html", result.started_at);

    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())?;
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join(name);
    std::fs::write(&path, html).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(CrawlState::default())
        .invoke_handler(tauri::generate_handler![
            start_crawl,
            cancel_crawl,
            list_reports,
            load_report,
            delete_report,
            save_html_report,
            get_settings,
            set_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running crawlie");
}
