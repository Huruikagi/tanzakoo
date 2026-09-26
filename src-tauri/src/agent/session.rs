//! Initialize ACP and restore only sessions owned by this app's credentials.
use crate::{model::Conversation, store::Store};
use agent_client_protocol::{
    Agent, ConnectionTo,
    schema::{ProtocolVersion, v1::*},
};
use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};

pub(super) struct PreparedSession {
    pub(super) id: SessionId,
    pub(super) restoring: bool,
}

pub(super) async fn prepare(
    cx: &ConnectionTo<Agent>,
    store: &Store,
    conversation: &Conversation,
    workspace: PathBuf,
    mcp: McpServer,
    replaying: &AtomicBool,
) -> Result<PreparedSession, agent_client_protocol::Error> {
    let initialized = cx
        .send_request(InitializeRequest::new(ProtocolVersion::V1))
        .block_task()
        .await?;
    // Sessions created before app-owned credentials live in the user's
    // CLI home. Keep the chat history, but start a fresh app-owned session.
    let saved_session = conversation.session_id.clone().and_then(|id| {
        if conversation.agent == "codex" {
            id.strip_prefix("tanzakoo-v1:").map(str::to_owned)
        } else {
            Some(id)
        }
    });
    let restoring = saved_session.is_some() && initialized.agent_capabilities.load_session;
    let session_id = if let Some(saved) =
        saved_session.filter(|_| initialized.agent_capabilities.load_session)
    {
        replaying.store(true, Ordering::SeqCst);
        cx.send_request(LoadSessionRequest::new(saved.clone(), workspace).mcp_servers(vec![mcp]))
            .block_task()
            .await?;
        replaying.store(false, Ordering::SeqCst);
        SessionId::new(saved)
    } else {
        let response = cx
            .send_request(NewSessionRequest::new(workspace).mcp_servers(vec![mcp]))
            .block_task()
            .await?;
        store
            .save_session(
                &conversation.id,
                if conversation.agent == "codex" {
                    format!("tanzakoo-v1:{}", response.session_id)
                } else {
                    response.session_id.to_string()
                },
            )
            .map_err(|e| agent_client_protocol::Error::internal_error().data(e.to_string()))?;
        response.session_id
    };
    Ok(PreparedSession {
        id: session_id,
        restoring,
    })
}
