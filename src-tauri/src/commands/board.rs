use super::with_projects;
use crate::{AppState, model::*, store};
use tauri::State;

#[tauri::command]
pub(crate) async fn board_action(
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
            BoardAction::ApplyProposals { ids } => store.apply_proposals(&ids),
            BoardAction::ResolveDiscussion { id, action } => store.resolve_discussion(&id, action),
            BoardAction::NewConversation { agent } => store.create_conversation(&agent).map(|_| ()),
            BoardAction::ConfigureAgent { config } => {
                runtime.ensure_idle()?;
                if runtime.review_session()?.is_some() {
                    return Err("審査用接続を解除してから起動設定を変更してください。".into());
                }
                // A changed launch command may send data elsewhere, so ask again.
                let agent = config.id.clone();
                store
                    .set_agent(config)
                    .and_then(|_| projects.set_consent(&agent, false))
            }
            BoardAction::ConfigureChat { settings } => {
                runtime.ensure_idle()?;
                if runtime.review_session()?.is_some() {
                    return Err("審査用接続では指定されたモデルを使います。".into());
                }
                store.set_chat_settings(settings)
            }
        };
        result.map_err(|e| e.to_string())
    })
    .await
}
