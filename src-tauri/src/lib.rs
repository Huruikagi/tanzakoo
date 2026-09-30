pub mod agent;
pub mod agent_setup;
pub mod chat_settings;
pub mod chatgpt_plan;
pub mod export;
pub mod language;
pub mod materials;
pub mod mcp;
pub mod model;
pub mod projects;
pub mod review;
pub mod storage;
pub mod store;
pub mod system_message;

mod commands;
#[cfg(all(target_os = "macos", feature = "sandbox-validation"))]
pub mod sandbox_check;

use std::sync::{Arc, Mutex};
use tauri::Manager;

#[derive(Clone)]
pub struct AppState {
    pub projects: Arc<Mutex<projects::Projects>>,
    pub runtime: Arc<agent::AgentRuntime>,
}

pub(crate) fn context() -> tauri::Context<tauri::Wry> {
    // macOS emits one embedded Info.plist symbol per invocation of this macro.
    tauri::generate_context!()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = storage::data_dir(app)?;
            agent_setup::initialize(app.path().resource_dir()?, dir.clone());
            app.manage(AppState {
                projects: Arc::new(Mutex::new(projects::Projects::open(dir)?)),
                runtime: Arc::new(agent::AgentRuntime::default()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::projects::get_snapshot,
            commands::materials::add_reference_materials,
            commands::materials::remove_reference_material,
            commands::export::export_decisions,
            commands::board::board_action,
            commands::projects::switch_project,
            commands::projects::create_project,
            commands::projects::delete_project,
            commands::agent::send_prompt,
            commands::projects::set_consent,
            commands::agent::cancel_prompt,
            commands::agent::answer_permission,
            commands::agent::agent_connection,
            commands::agent::review_connection,
            commands::agent::get_review_status,
            commands::agent::plan_connection,
            commands::agent::chat_options
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window.state::<AppState>().runtime.cancel();
            }
        })
        .run(context())
        .expect("Tanzakoo startup failed");
}
