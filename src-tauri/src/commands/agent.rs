use super::ProjectOperation;
use crate::{AppState, agent, chatgpt_plan, language, model::*, review};
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
            .map_err(|e| e.system_message())?;
        let review = state.runtime.review_session()?;
        let plan = if review.is_none() {
            state.runtime.plan_account()?
        } else {
            None
        };
        if review.is_none() {
            chatgpt_plan::require_account(plan.as_ref())?;
        }
        chatgpt_plan::ensure_route(conversation.session_id.as_deref(), plan.as_ref())?;
        review::ensure_conversation_route(conversation.session_id.as_deref(), review.is_some())?;
        if let Some(access) = &review {
            access.ensure_usable()?;
        } else if !projects
            .consented(&conversation.agent)
            .map_err(|e| e.system_message())?
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
        .map_err(|error| error.system_message())?;
    let event_app = app.clone();
    let emit: agent::Emit = Arc::new(move |event| {
        let _ = event_app.emit("agent-event", event);
    });
    let result = agent::run(
        store.clone(),
        runtime.clone(),
        conversation_id.clone(),
        message.text,
        references,
        ui_language.unwrap_or_default(),
        cancel,
        emit.clone(),
    )
    .await;
    if let Err(error) = &result {
        let _ = store.append_message(&conversation_id, "error", error.clone(), vec![]);
    }
    drop(guard);
    emit(agent::AgentEvent {
        conversation_id: conversation_id.clone(),
        kind: "finished".into(),
        text: result.as_ref().err().cloned().unwrap_or_default(),
        detail: None,
    });
    let succeeded = matches!(
        result,
        Ok(agent_client_protocol::schema::v1::StopReason::EndTurn)
    );
    // OS notification callbacks must never hold the completed chat request open.
    tauri::async_runtime::spawn(async move {
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            crate::desktop_notifications::completed(
                &app,
                crate::desktop_notifications::NotificationTarget {
                    project_id,
                    conversation_id,
                },
                ui_language.unwrap_or_default(),
                succeeded,
            ),
        )
        .await;
    });
    result.map(|_| ())
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
    if let Some(account) = state.runtime.plan_account()? {
        if agent != "codex" || action != "check" {
            return Err("ChatGPTプランの接続設定を使用してください。".into());
        }
        let mut cancel = cancel;
        tokio::select! {
            result = chatgpt_plan::access(&store, &account) => { result?; },
            _ = &mut cancel => return Err("接続確認を中止しました。".into()),
        };
        return Ok(ConnectionStatus {
            state: "ready".into(),
            message: "ChatGPTプランの接続を確認しました。".into(),
            can_login: false,
        });
    }
    Err(chatgpt_plan::SIGN_IN_REQUIRED.into())
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
    if let Some(account) = state.runtime.plan_account()? {
        chatgpt_plan::require_account(Some(&account))?;
        let mut cancel = cancel;
        let access = tokio::select! {
            result = chatgpt_plan::access(&store, &account) => result?,
            _ = &mut cancel => return Err("モデル一覧の取得を中止しました。".into()),
        };
        return crate::chat_settings::discover_plan(store, &account, access, model, cancel).await;
    }
    Err(chatgpt_plan::SIGN_IN_REQUIRED.into())
}

#[tauri::command]
pub(crate) async fn plan_connection(
    project_id: String,
    action: String,
    account_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<chatgpt_plan::PlanStatus, String> {
    let ProjectOperation {
        store,
        guard: _guard,
        mut cancel,
    } = state.begin_project_operation(&project_id, |_, _| Ok(()))?;
    let reviewing = state.runtime.review_session()?.is_some();
    if reviewing && !["list", "restore"].contains(&action.as_str()) {
        return Err("先に審査用接続を解除してください。".into());
    }
    let job = async {
        let mut warning = None;
        let mut active = state.runtime.plan_account()?;
        match action.as_str() {
            "list" => {}
            "restore" => {
                if active.is_none() && !reviewing {
                    let id = state
                        .projects
                        .lock()
                        .map_err(|e| e.to_string())?
                        .last_plan_account()
                        .map_err(|e| e.system_message())?;
                    let result = chatgpt_plan::helper(&store, "list", None).await?;
                    let accounts = serde_json::from_value(result["accounts"].clone())
                        .map_err(|_| chatgpt_plan::message("invalid_response"))?;
                    (active, warning) =
                        chatgpt_plan::restore_account(id.as_deref(), accounts, |account| {
                            let store = &store;
                            async move { chatgpt_plan::access(store, &account).await.map(|_| ()) }
                        })
                        .await;
                }
            }
            "usage" => {
                chatgpt_plan::helper(&store, "usage", None).await?;
            }
            "login" | "select" => {
                let account: chatgpt_plan::PlanAccount = if action == "login" {
                    let result =
                        chatgpt_plan::helper(&store, "login", account_id.as_deref()).await?;
                    serde_json::from_value(result["account"].clone())
                        .map_err(|_| chatgpt_plan::message("invalid_response"))?
                } else {
                    let result = chatgpt_plan::helper(&store, "list", None).await?;
                    let accounts: Vec<chatgpt_plan::PlanAccount> =
                        serde_json::from_value(result["accounts"].clone())
                            .map_err(|_| chatgpt_plan::message("invalid_response"))?;
                    accounts
                        .into_iter()
                        .find(|a| Some(&a.id) == account_id.as_ref())
                        .ok_or_else(|| chatgpt_plan::message("account_missing"))?
                };
                // Do not change the active connection until permission/model access succeeds.
                chatgpt_plan::access(&store, &account).await?;
                active = Some(account);
            }
            "logout" => {
                let id = account_id
                    .as_deref()
                    .ok_or_else(|| chatgpt_plan::message("account_missing"))?;
                let result = chatgpt_plan::helper(&store, "logout", Some(id)).await?;
                warning = result["warning"].as_str().map(chatgpt_plan::message);
                // Keep the selected route after logout so a send cannot fall back to Codex.
                if let Some(account) = active.as_mut()
                    && account.id == id
                {
                    account.signed_in = false;
                }
            }
            _ => return Err("接続操作が不正です。".into()),
        }
        let result = chatgpt_plan::helper(&store, "list", None).await?;
        let accounts = serde_json::from_value(result["accounts"].clone())
            .map_err(|_| chatgpt_plan::message("invalid_response"))?;
        // Commit the route after all cancellable work, keeping the native/UI result coherent.
        if ["login", "select"].contains(&action.as_str())
            && let Some(account) = &active
        {
            state
                .projects
                .lock()
                .map_err(|e| e.to_string())?
                .set_last_plan_account(&account.id)
                .map_err(|e| e.system_message())?;
        }
        *state
            .runtime
            .plan
            .lock()
            .map_err(|_| chatgpt_plan::message("runtime"))? = active.clone();
        Ok(chatgpt_plan::PlanStatus {
            available: true,
            accounts,
            active,
            warning,
        })
    };
    tokio::select! {
        result = job => result,
        _ = &mut cancel => Err("接続処理を中止しました。".into()),
    }
}
