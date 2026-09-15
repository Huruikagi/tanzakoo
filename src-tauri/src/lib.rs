pub mod agent;
pub mod mcp;
pub mod model;
pub mod store;

use model::*;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};

pub struct AppState {
    pub store: store::Store,
    pub runtime: Arc<agent::AgentRuntime>,
}

fn snapshot(store: &store::Store) -> Result<Snapshot, String> {
    let mut s = store.snapshot().map_err(|e| e.to_string())?;
    for id in ["codex", "claude"] {
        if !s.agents.iter().any(|a| a.id == id) {
            s.agents.push(agent::default_config(id));
        }
    }
    Ok(s)
}

#[tauri::command]
async fn get_snapshot(state: State<'_, AppState>) -> Result<Snapshot, String> {
    let store = state.store.clone();
    tokio::task::spawn_blocking(move || snapshot(&store))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn board_action(action: BoardAction, state: State<'_, AppState>) -> Result<Snapshot, String> {
    let store = state.store.clone();
    tokio::task::spawn_blocking(move || {
        let result: store::Result<()> = match action {
            BoardAction::CreateCard { title, body } => {
                store.create_card(title, body, "user").map(|_| ())
            }
            BoardAction::UpdateCard { card } => store.update_card(card).map(|_| ()),
            BoardAction::ResolveProposal { id, apply } => store.resolve(&id, apply),
            BoardAction::NewConversation { agent } => store.create_conversation(&agent).map(|_| ()),
            BoardAction::ConfigureAgent { config } => store.set_agent(config),
        };
        result.map_err(|e| e.to_string())?;
        snapshot(&store)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn send_prompt(
    conversation_id: String,
    text: String,
    references: Vec<CardReference>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if text.trim().is_empty() || text.len() > 100_000 || references.len() > 20 {
        return Err("メッセージは1〜100000バイト、参照は20件以内にしてください。".into());
    }
    let store = state.store.clone();
    store
        .conversation(&conversation_id)
        .map_err(|e| e.to_string())?;
    let cancel = state.runtime.begin()?;
    let runtime = state.runtime.clone();
    if let Err(error) =
        store.append_message(&conversation_id, "user", text.clone(), references.clone())
    {
        runtime.finish();
        return Err(error.to_string());
    }
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
    runtime.finish();
    emit(agent::AgentEvent {
        conversation_id,
        kind: "finished".into(),
        text: result.as_ref().err().cloned().unwrap_or_default(),
        detail: None,
    });
    result
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

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = if let Some(path) = std::env::var_os("TANZAKOO_DATA_DIR") {
                std::path::PathBuf::from(path)
            } else {
                app.path().app_data_dir()?
            };
            std::fs::create_dir_all(&dir)?;
            app.manage(AppState {
                store: store::Store::open(dir.join("tanzakoo.db"))?,
                runtime: Arc::new(agent::AgentRuntime::default()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            board_action,
            send_prompt,
            cancel_prompt,
            answer_permission
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window.state::<AppState>().runtime.cancel();
            }
        })
        .run(tauri::generate_context!())
        .expect("Tanzakoo startup failed");
}
