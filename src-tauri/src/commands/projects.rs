use super::{snapshot, with_projects};
use crate::{AppState, model::*};
use tauri::State;

#[tauri::command]
pub(crate) async fn get_snapshot(state: State<'_, AppState>) -> Result<Snapshot, String> {
    with_projects(&state, |_| Ok(())).await
}

#[tauri::command]
pub(crate) async fn switch_project(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<Snapshot, String> {
    let runtime = state.runtime.clone();
    with_projects(&state, move |projects| {
        runtime.ensure_idle()?;
        projects.switch(&project_id).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn create_project(
    name: String,
    memory: String,
    state: State<'_, AppState>,
) -> Result<Snapshot, String> {
    let runtime = state.runtime.clone();
    with_projects(&state, move |projects| {
        runtime.ensure_idle()?;
        projects.create(name, memory).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_project(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<DeleteProjectResult, String> {
    let projects = state.projects.clone();
    let runtime = state.runtime.clone();
    tokio::task::spawn_blocking(move || {
        let mut projects = projects.lock().map_err(|e| e.to_string())?;
        runtime.ensure_idle()?;
        let warning = projects.delete(&project_id).map_err(|e| e.to_string())?;
        Ok(DeleteProjectResult {
            snapshot: snapshot(&projects)?,
            warning,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn set_consent(
    agent: String,
    granted: bool,
    state: State<'_, AppState>,
) -> Result<Snapshot, String> {
    if agent != "codex" && granted {
        return Err("この接続先には送信できません。".into());
    }
    let runtime = state.runtime.clone();
    with_projects(&state, move |projects| {
        runtime.ensure_idle()?;
        if runtime.review_session()?.is_some() {
            return Err("審査用接続の同意は、接続を解除すると取り消されます。".into());
        }
        projects
            .set_consent(&agent, granted)
            .map_err(|e| e.to_string())
    })
    .await
}
