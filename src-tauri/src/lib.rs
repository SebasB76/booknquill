pub mod ai;
pub mod core;

use crate::core::{default_notes_dir, Notes};
use serde_json::Value;
use tauri::{Emitter, Manager};

struct AppState {
    notes: Notes,
}

// Async so a slow command (the formula request to Claude) runs off the UI thread.
#[tauri::command]
async fn core(state: tauri::State<'_, AppState>, cmd: String, args: Value) -> Result<Value, String> {
    state.notes.dispatch(&cmd, args)
}

/// Opens the system print dialog, where "Print to file" saves the note as PDF.
#[tauri::command]
fn print(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

pub fn run() {
    let notes = Notes::new(default_notes_dir()).expect("cannot open the notes folder");

    tauri::Builder::default()
        // A second launch (Super+N while the app is open) reuses this window.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if argv.iter().any(|a| a == "--new") {
                let _ = app.emit("new-note", ());
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .setup(move |app| {
            let dir = notes.dir().to_path_buf();
            app.asset_protocol_scope().allow_directory(&dir, true)?;
            if let Some(home) = dirs::home_dir() {
                // Older Omawrite notes link images by absolute path here.
                let _ = app.asset_protocol_scope().allow_directory(home.join(".local/share/Omacom"), true);
            }
            let handle = app.handle().clone();
            let watcher = core::watch(&dir, move |files| {
                let _ = handle.emit("notes-changed", files);
            })?;
            app.manage(watcher);
            app.manage(AppState { notes });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![core, print])
        .run(tauri::generate_context!())
        .expect("error while running BookNQuill");
}
