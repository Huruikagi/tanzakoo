pub mod agent;
pub mod agent_setup;
pub mod chat_settings;
pub mod export;
pub mod mcp;
pub mod model;
pub mod projects;
pub mod store;

use model::*;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

pub struct AppState {
    pub projects: Arc<Mutex<projects::Projects>>,
    pub runtime: Arc<agent::AgentRuntime>,
}

fn snapshot(projects: &projects::Projects) -> Result<Snapshot, String> {
    let mut s = projects.snapshot().map_err(|e| e.to_string())?;
    for id in ["codex", "claude"] {
        if !s.agents.iter().any(|a| a.id == id) {
            s.agents.push(agent::default_config(id));
        }
    }
    Ok(s)
}

/// Runs `job` on a blocking thread while holding the projects lock, then returns the latest
/// snapshot. SQLite work must not block the async runtime that also drives agent turns.
async fn with_projects(
    state: &State<'_, AppState>,
    job: impl FnOnce(&mut projects::Projects) -> Result<(), String> + Send + 'static,
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

#[tauri::command]
async fn get_snapshot(state: State<'_, AppState>) -> Result<Snapshot, String> {
    with_projects(&state, |_| Ok(())).await
}

#[tauri::command]
async fn export_decisions(
    project_id: String,
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
                .map_err(|e| e.to_string())?;
            export::MarkdownExport::from_snapshot(store.snapshot().map_err(|e| e.to_string())?)?
        };
        let Some(parent) = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("決めたことの出力先フォルダーを選択")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let path = parent.into_path().map_err(|e| e.to_string())?;
        bundle.write_to(&path).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn board_action(
    project_id: String,
    action: BoardAction,
    state: State<'_, AppState>,
) -> Result<Snapshot, String> {
    let runtime = state.runtime.clone();
    with_projects(&state, move |projects| {
        let store = projects
            .require_active(&project_id)
            .map_err(|e| e.to_string())?;
        let result: store::Result<()> = match action {
            BoardAction::UpdateProject {
                name,
                memory,
                revision,
            } => store.update_project(name, memory, revision),
            BoardAction::ResolveMemoryProposal { id, apply } => store.resolve_memory(&id, apply),
            BoardAction::CreateCard { title, body } => {
                store.create_card(title, body, "user").map(|_| ())
            }
            BoardAction::UpdateCard { card } => store.update_card(card).map(|_| ()),
            BoardAction::ResolveProposal { id, apply } => store.resolve(&id, apply),
            BoardAction::ResolveDiscussion { id, action } => store.resolve_discussion(&id, action),
            BoardAction::NewConversation { agent } => store.create_conversation(&agent).map(|_| ()),
            BoardAction::ConfigureAgent { config } => {
                // A changed launch command may send data elsewhere, so ask again.
                let agent = config.id.clone();
                store
                    .set_agent(config)
                    .and_then(|_| projects.set_consent(&agent, false))
            }
            BoardAction::ConfigureChat { settings } => {
                runtime.ensure_idle()?;
                store.set_chat_settings(settings)
            }
        };
        result.map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
async fn switch_project(
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
async fn create_project(
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
async fn send_prompt(
    project_id: String,
    conversation_id: String,
    text: String,
    references: Vec<CardReference>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if text.trim().is_empty() || text.len() > 100_000 || references.len() > 20 {
        return Err("メッセージは1〜100000バイト、参照は20件以内にしてください。".into());
    }
    // Select the store and reserve the runtime under the same lock used for switching.
    let (store, guard, cancel) = {
        let projects = state.projects.lock().map_err(|e| e.to_string())?;
        let store = projects
            .require_active(&project_id)
            .map_err(|e| e.to_string())?;
        let conversation = store
            .conversation(&conversation_id)
            .map_err(|e| e.to_string())?;
        if !projects
            .consented(&conversation.agent)
            .map_err(|e| e.to_string())?
        {
            return Err("AIへの送信に同意してください。".into());
        }
        let (guard, cancel) = state.runtime.begin()?;
        (store, guard, cancel)
    };
    let runtime = state.runtime.clone();
    store
        .append_message(&conversation_id, "user", text.clone(), references.clone())
        .map_err(|error| error.to_string())?;
    let emit: agent::Emit = Arc::new(move |event| {
        let _ = app.emit("agent-event", event);
    });
    let result = agent::run(
        store.clone(),
        runtime.clone(),
        conversation_id.clone(),
        text,
        references,
        cancel,
        emit.clone(),
    )
    .await;
    if let Err(error) = &result {
        let _ = store.append_message(&conversation_id, "error", error.clone(), vec![]);
    }
    drop(guard);
    emit(agent::AgentEvent {
        conversation_id,
        kind: "finished".into(),
        text: result.as_ref().err().cloned().unwrap_or_default(),
        detail: None,
    });
    result
}

#[tauri::command]
async fn set_consent(
    agent: String,
    granted: bool,
    state: State<'_, AppState>,
) -> Result<Snapshot, String> {
    if agent != "codex" && granted {
        return Err("この接続先には送信できません。".into());
    }
    with_projects(&state, move |projects| {
        projects
            .set_consent(&agent, granted)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
fn cancel_prompt(state: State<'_, AppState>) {
    state.runtime.cancel();
}
#[tauri::command]
fn answer_permission(
    id: String,
    option: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.runtime.answer(id, option)
}

#[tauri::command]
async fn agent_connection(
    project_id: String,
    agent: String,
    action: String,
    state: State<'_, AppState>,
) -> Result<ConnectionStatus, String> {
    let (store, (_guard, cancel)) = {
        let projects = state.projects.lock().map_err(|e| e.to_string())?;
        let store = projects
            .require_active(&project_id)
            .map_err(|e| e.to_string())?;
        (store, state.runtime.begin()?)
    };
    Ok(agent_setup::probe(store, agent, action, cancel).await)
}

#[tauri::command]
async fn chat_options(
    project_id: String,
    model: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<ChatOption>, String> {
    let (store, (_guard, cancel)) = {
        let projects = state.projects.lock().map_err(|e| e.to_string())?;
        let store = projects
            .require_active(&project_id)
            .map_err(|e| e.to_string())?;
        (store, state.runtime.begin()?)
    };
    chat_settings::discover(store, model, cancel).await
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = if let Some(path) = std::env::var_os("TANZAKOO_DATA_DIR") {
                std::path::PathBuf::from(path)
            } else {
                app.path().app_data_dir()?
            };
            std::fs::create_dir_all(&dir)?;
            agent_setup::initialize(app.path().resource_dir()?, dir.clone());
            app.manage(AppState {
                projects: Arc::new(Mutex::new(projects::Projects::open(dir)?)),
                runtime: Arc::new(agent::AgentRuntime::default()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            export_decisions,
            board_action,
            switch_project,
            create_project,
            send_prompt,
            set_consent,
            cancel_prompt,
            answer_permission,
            agent_connection,
            chat_options
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window.state::<AppState>().runtime.cancel();
            }
        })
        .run(tauri::generate_context!())
        .expect("Tanzakoo startup failed");
}
