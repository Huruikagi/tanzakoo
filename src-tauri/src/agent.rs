mod notifications;
mod permissions;
mod prompt;
mod session;
#[cfg(test)]
use permissions::is_board_tool;

use crate::{model::*, store::Store};
use agent_client_protocol::{AcpAgent, Agent, ConnectionTo, schema::v1::*};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::sync::oneshot;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub conversation_id: String,
    pub kind: String,
    pub text: String,
    pub detail: Option<serde_json::Value>,
}
pub type Emit = Arc<dyn Fn(AgentEvent) + Send + Sync>;
#[derive(Default)]
pub struct AgentRuntime {
    pub review: Mutex<Option<crate::review::ReviewSession>>,
    busy: AtomicBool,
    cancel: Mutex<Option<oneshot::Sender<()>>>,
    permissions: Mutex<HashMap<String, oneshot::Sender<Option<String>>>>,
    next_id: AtomicU64,
}
/// Owns one reserved runtime slot, including early-return and cancelled-future paths.
#[must_use]
pub struct OperationGuard(Arc<AgentRuntime>);
impl Drop for OperationGuard {
    fn drop(&mut self) {
        self.0.finish();
    }
}
impl AgentRuntime {
    pub fn review_session(&self) -> Result<Option<crate::review::ReviewSession>, String> {
        self.review
            .lock()
            .map(|v| v.clone())
            .map_err(|_| "審査用接続を読み込めません。".into())
    }
    pub fn ensure_idle(&self) -> Result<(), String> {
        if self.busy.load(Ordering::SeqCst) {
            Err("エージェントの応答を待つか、停止してからプロジェクトを切り替えてください。".into())
        } else {
            Ok(())
        }
    }
    pub fn begin(self: &Arc<Self>) -> Result<(OperationGuard, oneshot::Receiver<()>), String> {
        let mut current = self.cancel.lock().map_err(|e| e.to_string())?;
        if self.busy.swap(true, Ordering::SeqCst) {
            return Err("エージェントの応答を待つか、停止してください。".into());
        }
        let (tx, rx) = oneshot::channel();
        *current = Some(tx);
        Ok((OperationGuard(self.clone()), rx))
    }
    pub fn cancel(&self) {
        if let Ok(mut value) = self.cancel.lock()
            && let Some(tx) = value.take()
        {
            let _ = tx.send(());
        }
    }
    fn finish(&self) {
        if let Ok(mut v) = self.cancel.lock() {
            *v = None;
        }
        if let Ok(mut p) = self.permissions.lock() {
            p.clear();
        }
        self.busy.store(false, Ordering::SeqCst);
    }
    pub fn answer(&self, id: String, option: Option<String>) -> Result<(), String> {
        let tx = self
            .permissions
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&id)
            .ok_or("この確認は終了しています。")?;
        tx.send(option)
            .map_err(|_| "この確認は終了しています。".into())
    }
}

pub fn default_config(id: &str) -> AgentConfig {
    if id == "codex" {
        return crate::agent_setup::managed_config();
    }
    let package = if id == "claude" {
        "claude-agent-acp"
    } else {
        "codex-acp"
    };
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../node_modules/@agentclientprotocol")
        .join(package)
        .join("dist/index.js");
    // Development adapters only: a release build never falls back to them.
    if cfg!(debug_assertions) && script.exists() {
        AgentConfig {
            id: id.into(),
            command: std::env::var("TANZAKOO_NODE").unwrap_or_else(|_| "node".into()),
            args: vec![script.to_string_lossy().into()],
        }
    } else if id == "claude" {
        AgentConfig {
            id: id.into(),
            command: crate::agent_setup::CLAUDE_UNAVAILABLE.into(),
            args: vec![],
        }
    } else {
        AgentConfig {
            id: id.into(),
            command: package.into(),
            args: vec![],
        }
    }
}

pub async fn run(
    store: Store,
    runtime: Arc<AgentRuntime>,
    conversation_id: String,
    prompt: String,
    references: Vec<CardReference>,
    mut cancel: oneshot::Receiver<()>,
    emit: Emit,
) -> Result<(), String> {
    let conversation = store
        .conversation(&conversation_id)
        .map_err(|e| e.system_message())?;
    let mut review = runtime.review_session()?;
    crate::review::ensure_conversation_route(conversation.session_id.as_deref(), review.is_some())?;
    if let Some(access) = &mut review {
        access.ensure_usable()?;
        access.status = tokio::select! {
            result = access.check() => result?,
            _ = &mut cancel => return Err("応答を停止しました。".into()),
        };
        *runtime.review.lock().map_err(|e| e.to_string())? = Some(access.clone());
    }
    let snapshot = store.snapshot().map_err(|e| e.system_message())?;
    let message_id = snapshot
        .messages
        .iter()
        .rev()
        .find(|m| m.conversation_id == conversation_id && m.role == "user")
        .ok_or("現在のユーザー発言が見つかりません。")?
        .id
        .clone();
    let config = snapshot
        .agents
        .iter()
        .find(|a| a.id == conversation.agent)
        .cloned()
        .unwrap_or_else(|| default_config(&conversation.agent));
    let workspace = store
        .path()
        .parent()
        .ok_or("保存先が不正です。")?
        .join("agent-workspace");
    std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
    let mcp = McpServer::Stdio(
        McpServerStdio::new("tanzakoo", crate::agent_setup::mcp_binary()?).args(vec![
            "--mcp".into(),
            store.path().to_string_lossy().into(),
            conversation.agent.clone(),
            conversation_id.clone(),
            message_id.clone(),
        ]),
    );
    let prompt = prompt::Prompt::build(&snapshot, &conversation_id, &prompt, &references)?;
    let notifications = Arc::new(notifications::Notifications::new(
        conversation_id.clone(),
        emit.clone(),
    ));
    let notify = notifications.clone();
    let permission_notifications = notifications.clone();
    let session_notifications = notifications.clone();
    let permission_agent = conversation.agent.clone();
    let permission_emit = emit.clone();
    let permission_id = conversation_id.clone();
    let permission_runtime = runtime.clone();
    let launch = crate::agent_setup::launch_with_review(
        config,
        &store,
        review.as_ref().map(|access| access.status.model.as_str()),
    )?;
    let session_store = store.clone();
    let is_review = review.is_some();
    let job = agent_client_protocol::Client
        .builder()
        .on_receive_notification(
            async move |notice: SessionNotification, _cx| {
                notify.receive(notice.update);
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _cx| {
                let response = permissions::respond(
                    &permission_runtime,
                    &permission_agent,
                    &permission_notifications.tool_calls,
                    request,
                    &permission_id,
                    &permission_emit,
                )
                .await;
                responder.respond(response)
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(
            AcpAgent::new(launch),
            |cx: ConnectionTo<Agent>| async move {
                let prepared = session::prepare(
                    &cx,
                    &session_store,
                    &conversation,
                    workspace,
                    mcp,
                    &session_notifications.replaying,
                    review.as_ref(),
                )
                .await?;
                let session_id = prepared.id;
                let input = prompt.into_input(prepared.restoring);
                if conversation.agent == "codex" {
                    let settings = review.as_ref().map(|r| ChatSettings {
                        model: Some(r.status.model.clone()),
                        reasoning_effort: None,
                    });
                    crate::chat_settings::apply(
                        &cx,
                        &session_id,
                        settings.as_ref().unwrap_or(&snapshot.chat_settings),
                    )
                    .await?;
                }
                cx.send_request(PromptRequest::new(
                    session_id,
                    vec![ContentBlock::Text(TextContent::new(input))],
                ))
                .block_task()
                .await?;
                Ok(())
            },
        );
    let result = tokio::select! {
        result = tokio::time::timeout(Duration::from_secs(600), job) => match result {
            Ok(result) => result.map_err(|e| if is_review {
                "審査用接続で送信できませんでした。接続状況からコードの期限・利用上限とサーバーへの接続を確認してください。".into()
            } else { crate::system_message::detail(
                crate::system_message::Code::AgentConnection,
                &e.to_string(),
                &format!("エージェント接続に失敗しました: {e}. ログインと起動設定を確認してください。"),
            ) }),
            Err(_) => Err("応答が10分以内に完了しませんでした。".into()),
        },
        _ = &mut cancel => Err("応答を停止しました。".into()),
    };
    let full = notifications.text();
    if result.is_err() {
        store
            .cancel_questions(&conversation_id, &message_id)
            .map_err(|e| e.system_message())?;
    }
    // Persist partial responses too: cancelling must not erase text already shown.
    if !full.is_empty() {
        store
            .append_message(&conversation_id, "assistant", full, vec![])
            .map_err(|e| e.system_message())?;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn dropping_an_unfinished_operation_releases_the_slot_and_pending_permissions() {
        let runtime = Arc::new(AgentRuntime::default());
        let (guard, _cancel) = runtime.begin().unwrap();
        let (tx, rx) = oneshot::channel();
        runtime
            .permissions
            .lock()
            .unwrap()
            .insert("pending".into(), tx);
        let (started, ready) = oneshot::channel();
        let task = tokio::spawn(async move {
            let _guard = guard;
            started.send(()).unwrap();
            std::future::pending::<()>().await;
        });
        ready.await.unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert!(rx.await.is_err());
        assert!(runtime.ensure_idle().is_ok());
        assert!(runtime.begin().is_ok());
    }
    #[tokio::test]
    async fn cancelling_keeps_the_slot_busy_until_the_run_finishes() {
        let runtime = Arc::new(AgentRuntime::default());
        let (guard, cancel) = runtime.begin().unwrap();
        assert!(runtime.begin().is_err());
        assert!(runtime.ensure_idle().is_err());
        runtime.cancel();
        assert!(cancel.await.is_ok());
        assert!(runtime.begin().is_err());
        drop(guard);
        assert!(runtime.ensure_idle().is_ok());
        assert!(runtime.begin().is_ok());
        assert!(
            runtime
                .answer("expired".into(), Some("allow_once".into()))
                .is_err()
        );
    }
    #[test]
    fn only_app_owned_tools_are_automatic() {
        for tool in [
            "get_board",
            "create_candidate",
            "propose_card_change",
            "propose_memory_change",
            "report_discussion",
            "present_question",
            "present_questions",
            "list_reference_materials",
            "list_reference_files",
            "read_reference_file",
            "search_reference_files",
        ] {
            assert!(is_board_tool(
                "codex",
                &serde_json::json!({"_meta":{"is_mcp_tool_call":true},"rawInput":{"server":"tanzakoo","tool":tool}})
            ));
            assert!(is_board_tool(
                "claude",
                &serde_json::json!({"title":format!("mcp__tanzakoo__{tool}")})
            ));
        }
        assert!(!is_board_tool(
            "claude",
            &serde_json::json!({"title":"mcp__tanzakoo__apply_proposal"})
        ));
        assert!(!is_board_tool(
            "claude",
            &serde_json::json!({"title":"Bash","rawInput":{"command":"mcp__tanzakoo__create_candidate"}})
        ));
        assert!(!is_board_tool(
            "codex",
            &serde_json::json!({"title":"mcp.tanzakoo.create_candidate"})
        ));
        assert!(!is_board_tool(
            "codex",
            &serde_json::json!({"_meta":{"is_mcp_tool_call":true},"rawInput":{"server":"other","tool":"create_candidate"}})
        ));
    }
}
