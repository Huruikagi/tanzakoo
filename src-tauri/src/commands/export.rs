use crate::{AppState, export, language};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub(crate) async fn export_decisions(
    project_id: String,
    ui_language: Option<language::Language>,
    state: State<'_, AppState>,
    window: tauri::WebviewWindow,
) -> Result<Option<export::ExportResult>, String> {
    let projects = state.projects.clone();
    tokio::task::spawn_blocking(move || {
        // Freeze the saved board before opening the picker; release the lock while it is open.
        let bundle = {
            let projects = projects.lock().map_err(|e| e.to_string())?;
            let store = projects
                .require_active(&project_id)
                .map_err(|e| e.system_message())?;
            export::MarkdownExport::from_snapshot_in_language(
                store.snapshot().map_err(|e| e.system_message())?,
                ui_language.unwrap_or_default(),
            )?
        };
        let Some(parent) = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title(ui_language.unwrap_or_default().choose(
                "決めたことの出力先フォルダーを選択",
                "Choose a folder for exported decisions",
            ))
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let path = parent.into_path().map_err(|e| e.to_string())?;
        // Use the native panel's grant immediately. Do not persist this path for
        // later writes: reopening a sandboxed app requires a new user selection.
        bundle.write_to(&path).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}
