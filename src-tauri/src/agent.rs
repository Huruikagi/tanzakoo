mod permissions;
mod prompt;
#[cfg(test)]
use permissions::is_board_tool;

use crate::{model::*, store::Store};
use agent_client_protocol::{
    AcpAgent, Agent, ConnectionTo,
    schema::{ProtocolVersion, v1::*},
};
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
        .map_err(|e| e.to_string())?;
    let snapshot = store.snapshot().map_err(|e| e.to_string())?;
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
        McpServerStdio::new(
            "tanzakoo",
            std::env::current_exe().map_err(|e| e.to_string())?,
        )
        .args(vec![
            "--mcp".into(),
            store.path().to_string_lossy().into(),
            conversation.agent.clone(),
            conversation_id.clone(),
            message_id.clone(),
        ]),
    );
    let prompt = prompt::Prompt::build(&snapshot, &conversation_id, &prompt, &references)?;
    let text = Arc::new(Mutex::new(String::new()));
    let tool_calls = Arc::new(Mutex::new(HashMap::<String, serde_json::Value>::new()));
    let notify_calls = tool_calls.clone();
    let permission_calls = tool_calls;
    let permission_agent = conversation.agent.clone();
    let replaying = Arc::new(AtomicBool::new(false));
    let notify_text = text.clone();
    let notify_replay = replaying.clone();
    let notify_emit = emit.clone();
    let notify_id = conversation_id.clone();
    let permission_emit = emit.clone();
    let permission_id = conversation_id.clone();
    let permission_runtime = runtime.clone();
    let launch = crate::agent_setup::launch(config, &store)?;
    let session_store = store.clone();
    let session_conversation_id = conversation_id.clone();
    let job = agent_client_protocol::Client
        .builder()
        .on_receive_notification(
            async move |notice: SessionNotification, _cx| {
                if notify_replay.load(Ordering::SeqCst) {
                    return Ok(());
                }
                let data = serde_json::to_value(&notice.update).unwrap_or_default();
                if data["sessionUpdate"] == "tool_call"
                    && let Some(id) = data["toolCallId"].as_str()
                    && let Ok(mut calls) = notify_calls.lock()
                {
                    calls.insert(id.into(), data.clone());
                }
                if let SessionUpdate::AgentMessageChunk(chunk) = &notice.update {
                    if let ContentBlock::Text(t) = &chunk.content {
                        if let Ok(mut whole) = notify_text.lock() {
                            whole.push_str(&t.text);
                        }
                        notify_emit(AgentEvent {
                            conversation_id: notify_id.clone(),
                            kind: "delta".into(),
                            text: t.text.clone(),
                            detail: None,
                        });
                    }
                } else {
                    notify_emit(AgentEvent {
                        conversation_id: notify_id.clone(),
                        kind: "activity".into(),
                        text: "検討しています".into(),
                        detail: Some(serde_json::to_value(&notice.update).unwrap_or_default()),
                    });
                }
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _cx| {
                let response = permissions::respond(
                    &permission_runtime,
                    &permission_agent,
                    &permission_calls,
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
                let initialized = cx
                    .send_request(InitializeRequest::new(ProtocolVersion::V1))
                    .block_task()
                    .await?;
                // Sessions created before app-owned credentials live in the user's
                // CLI home. Keep the chat history, but start a fresh app-owned session.
                let saved_session = conversation.session_id.and_then(|id| {
                    if conversation.agent == "codex" {
                        id.strip_prefix("tanzakoo-v1:").map(str::to_owned)
                    } else {
                        Some(id)
                    }
                });
                let restoring =
                    saved_session.is_some() && initialized.agent_capabilities.load_session;
                let session_id = if let Some(saved) =
                    saved_session.filter(|_| initialized.agent_capabilities.load_session)
                {
                    replaying.store(true, Ordering::SeqCst);
                    cx.send_request(
                        LoadSessionRequest::new(saved.clone(), workspace).mcp_servers(vec![mcp]),
                    )
                    .block_task()
                    .await?;
                    replaying.store(false, Ordering::SeqCst);
                    SessionId::new(saved)
                } else {
                    let response = cx
                        .send_request(NewSessionRequest::new(workspace).mcp_servers(vec![mcp]))
                        .block_task()
                        .await?;
                    session_store
                        .save_session(
                            &session_conversation_id,
                            if conversation.agent == "codex" {
                                format!("tanzakoo-v1:{}", response.session_id)
                            } else {
                                response.session_id.to_string()
                            },
                        )
                        .map_err(|e| {
                            agent_client_protocol::Error::internal_error().data(e.to_string())
                        })?;
                    response.session_id
                };
                let input = prompt.into_input(restoring);
                if conversation.agent == "codex" {
                    crate::chat_settings::apply(&cx, &session_id, &snapshot.chat_settings).await?;
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
        r=tokio::time::timeout(Duration::from_secs(600),job)=>match r {Ok(r)=>r.map_err(|e|format!("エージェント接続に失敗しました: {e}. ログインと起動設定を確認してください。")),Err(_)=>Err("応答が10分以内に完了しませんでした。".into())},
        _=&mut cancel=>Err("応答を停止しました。".into()),
    };
    let full = text.lock().map(|s| s.clone()).unwrap_or_default();
    if result.is_err() {
        store
            .cancel_questions(&conversation_id, &message_id)
            .map_err(|e| e.to_string())?;
    }
    // Persist partial responses too: cancelling must not erase text already shown.
    if !full.is_empty() {
        store
            .append_message(&conversation_id, "assistant", full, vec![])
            .map_err(|e| e.to_string())?;
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
