use super::{ProjectOperation, snapshot, with_projects};
use crate::{AppState, language, model::*};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub(crate) async fn add_reference_materials(
    project_id: String,
    kind: MaterialKind,
    ui_language: Option<language::Language>,
    state: State<'_, AppState>,
    window: tauri::WebviewWindow,
) -> Result<Snapshot, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        // Reserve the same slot as an AI turn. A picker must not outlive a project switch.
        let ProjectOperation {
            guard: _guard,
            cancel: _cancel,
            ..
        } = state.begin_project_operation(&project_id, |_, _| Ok(()))?;
        let picker = window.dialog().file().set_parent(&window).set_title(
            ui_language.unwrap_or_default().choose(
                "AIが読み取れる参照資料を選択",
                "Select reference materials for AI to read",
            ),
        );
        let paths = match kind {
            MaterialKind::File => picker.blocking_pick_files(),
            MaterialKind::Folder => picker.blocking_pick_folders(),
        };
        let projects = state.projects.lock().map_err(|e| e.to_string())?;
        let store = projects
            .require_active(&project_id)
            .map_err(|e| e.to_string())?;
        if let Some(paths) = paths {
            let paths = paths
                .into_iter()
                .map(|p| p.into_path().map_err(|e| e.to_string()))
                .collect::<Result<Vec<_>, _>>()?;
            store
                .add_materials(&paths, kind)
                .map_err(|e| e.to_string())?;
        }
        snapshot(&projects)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn remove_reference_material(
    project_id: String,
    material_id: String,
    state: State<'_, AppState>,
) -> Result<Snapshot, String> {
    let runtime = state.runtime.clone();
    with_projects(&state, move |projects| {
        runtime.ensure_idle()?;
        projects
            .require_active(&project_id)
            .map_err(|e| e.to_string())?
            .remove_material(&material_id)
            .map_err(|e| e.to_string())
    })
    .await
}
