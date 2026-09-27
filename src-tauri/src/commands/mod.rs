pub(super) mod agent;
pub(super) mod board;
pub(super) mod export;
pub(super) mod materials;
pub(super) mod projects;

#[cfg(test)]
mod tests;

use crate::{AppState, model::Snapshot, store};
use tauri::State;

fn snapshot(projects: &crate::projects::Projects) -> Result<Snapshot, String> {
    let mut s = projects.snapshot().map_err(|e| e.to_string())?;
    for id in ["codex", "claude"] {
        if !s.agents.iter().any(|a| a.id == id) {
            s.agents.push(crate::agent::default_config(id));
        }
    }
    Ok(s)
}

/// Runs `job` on a blocking thread while holding the projects lock, then returns the latest
/// snapshot. SQLite work must not block the async runtime that also drives agent turns.
async fn with_projects(
    state: &State<'_, AppState>,
    job: impl FnOnce(&mut crate::projects::Projects) -> Result<(), String> + Send + 'static,
) -> Result<Snapshot, String> {
    let projects = state.projects.clone();
    tokio::task::spawn_blocking(move || {
        let mut projects = projects.lock().map_err(|e| e.to_string())?;
        job(&mut projects)?;
        snapshot(&projects)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(super) struct ProjectOperation {
    pub store: store::Store,
    pub guard: crate::agent::OperationGuard,
    pub cancel: tokio::sync::oneshot::Receiver<()>,
}

impl AppState {
    /// Check the project and request prerequisites before reserving the runtime.
    /// The projects lock stays held throughout, so switching cannot slip in between.
    fn begin_project_operation(
        &self,
        project_id: &str,
        validate: impl FnOnce(&crate::projects::Projects, &store::Store) -> Result<(), String>,
    ) -> Result<ProjectOperation, String> {
        let projects = self.projects.lock().map_err(|e| e.to_string())?;
        let store = projects
            .require_active(project_id)
            .map_err(|e| e.to_string())?;
        validate(&projects, &store)?;
        let (guard, cancel) = self.runtime.begin()?;
        Ok(ProjectOperation {
            store,
            guard,
            cancel,
        })
    }
}
