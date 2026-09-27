use super::ProjectOperation;
use crate::{AppState, agent, agent_setup, chat_settings, language, model::*, review};
use std::sync::Arc;
use tauri::{Emitter, State};

#[tauri::command]
// Keep the existing IPC fields; State and AppHandle are injected by Tauri.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn send_prompt(
    project_id: String,
    conversation_id: String,
    text: String,
    references: Vec<CardReference>,
    question_answers: Option<Vec<QuestionAnswer>>,
    ui_language: Option<language::Language>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if text.trim().is_empty() || text.len() > 100_000 || references.len() > 20 {
        return Err("メッセージは1〜100000バイト、参照は20件以内にしてください。".into());
    }
    let ProjectOperation {
        store,
        guard,
        cancel,
    } = state.begin_project_operation(&project_id, |projects, store| {
        let conversation = store
            .conversation(&conversation_id)
            .map_err(|e| e.to_string())?;
        let review = state.runtime.review_session()?;
        review::ensure_conversation_route(conversation.session_id.as_deref(), review.is_some())?;
        if let Some(access) = &review {
            access.ensure_usable()?;
        } else if !projects
            .consented(&conversation.agent)
            .map_err(|e| e.to_string())?
        {
            return Err("AIへの送信に同意してください。".into());
        }
        Ok(())
    })?;
    let runtime = state.runtime.clone();
    let message = store
        .append_message_with_answer_in_language(
            &conversation_id,
            "user",
            text,
            references.clone(),
            question_answers,
            ui_language.unwrap_or_default(),
        )
        .map_err(|error| error.to_string())?;
    let emit: agent::Emit = Arc::new(move |event| {
        let _ = app.emit("agent-event", event);
    });
    let result = agent::run(
        store.clone(),
        runtime.clone(),
        conversation_id.clone(),
        message.text,
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
pub(crate) fn cancel_prompt(state: State<'_, AppState>) {
    state.runtime.cancel();
}
#[tauri::command]
pub(crate) fn answer_permission(
    id: String,
    option: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.runtime.answer(id, option)
}

#[tauri::command]
pub(crate) async fn agent_connection(
    project_id: String,
    agent: String,
    action: String,
    state: State<'_, AppState>,
) -> Result<ConnectionStatus, String> {
    let ProjectOperation {
        store,
        guard: _guard,
        cancel,
    } = state.begin_project_operation(&project_id, |_, _| Ok(()))?;
    if let Some(access) = state.runtime.review_session()? {
        if agent != "codex" || action != "check" {
            return Err("先に審査用接続を解除してください。".into());
        }
        let mut cancel = cancel;
        let status = tokio::select! {
            result = access.check() => result,
            _ = &mut cancel => Err("接続確認を中止しました。".into()),
        };
        return Ok(ConnectionStatus {
            state: if status.is_ok() { "ready" } else { "error" }.into(),
            message: status
                .map(|_| "審査用接続を確認しました。".into())
                .unwrap_or_else(|e| e),
            can_login: false,
        });
    }
    Ok(agent_setup::probe(store, agent, action, cancel).await)
}

#[tauri::command]
pub(crate) fn get_review_status(
    state: State<'_, AppState>,
) -> Result<Option<review::ReviewStatus>, String> {
    Ok(state.runtime.review_session()?.map(|r| r.status))
}

#[tauri::command]
pub(crate) async fn review_connection(
    project_id: String,
    action: String,
    code: Option<String>,
    consent: bool,
    state: State<'_, AppState>,
) -> Result<Option<review::ReviewStatus>, String> {
    let ProjectOperation {
        guard: _guard,
        mut cancel,
        ..
    } = state.begin_project_operation(&project_id, |_, _| Ok(()))?;
    if action == "disconnect" {
        *state.runtime.review.lock().map_err(|e| e.to_string())? = None;
        return Ok(None);
    }
    let access = match action.as_str() {
        "connect" => {
            if !consent {
                return Err("仲介サーバーとOpenAIへの送信に同意してください。".into());
            }
            tokio::select! {
                result = review::ReviewSession::connect(code.ok_or("審査用コードを入力してください。")?) => result?,
                _ = &mut cancel => return Err("審査用接続を中止しました。".into()),
            }
        }
        "check" => {
            let Some(mut access) = state.runtime.review_session()? else {
                return Ok(None);
            };
            access.status = tokio::select! {
                result = access.check() => result?,
                _ = &mut cancel => return Err("接続確認を中止しました。".into()),
            };
            access
        }
        _ => return Err("接続操作が不正です。".into()),
    };
    let status = access.status.clone();
    *state.runtime.review.lock().map_err(|e| e.to_string())? = Some(access);
    Ok(Some(status))
}

#[tauri::command]
pub(crate) async fn chat_options(
    project_id: String,
    model: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<ChatOption>, String> {
    let ProjectOperation {
        store,
        guard: _guard,
        cancel,
    } = state.begin_project_operation(&project_id, |_, _| Ok(()))?;
    if let Some(access) = state.runtime.review_session()? {
        return Ok(vec![ChatOption {
            id: "model".into(),
            current_value: access.status.model.clone(),
            options: vec![ChatOptionValue {
                value: access.status.model.clone(),
                name: access.status.model,
            }],
        }]);
    }
    chat_settings::discover(store, model, cancel).await
}
