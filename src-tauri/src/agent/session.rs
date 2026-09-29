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

#[allow(clippy::too_many_arguments)]
pub(super) async fn prepare(
    cx: &ConnectionTo<Agent>,
    store: &Store,
    conversation: &Conversation,
    workspace: PathBuf,
    mcp: McpServer,
    replaying: &AtomicBool,
    review: Option<&crate::review::ReviewSession>,
    plan: Option<(
        &crate::chatgpt_plan::PlanAccount,
        &crate::chatgpt_plan::PlanAccess,
    )>,
) -> Result<PreparedSession, agent_client_protocol::Error> {
    let mut initialize = InitializeRequest::new(ProtocolVersion::V1);
    if plan.is_some() {
        // ACP forwards this name as Codex's originator; match agent_name_hint.
        initialize =
            initialize.client_info(Implementation::new("Tanzakoo", env!("CARGO_PKG_VERSION")));
    }
    let initialized = cx.send_request(initialize).block_task().await?;
    if let Some(access) = review {
        access.authenticate(cx).await?;
    }
    if let Some((_, access)) = plan {
        access.authenticate(cx).await?;
    }
    let prefix = if let Some((account, _)) = plan {
        format!("{}{}:", crate::chatgpt_plan::PREFIX, account.id)
    } else if review.is_some() {
        crate::review::SESSION_PREFIX.into()
    } else {
        "tanzakoo-v1:".into()
    };
    // Sessions created before app-owned credentials live in the user's
    // CLI home. Keep the chat history, but start a fresh app-owned session.
    let saved_session = conversation.session_id.clone().and_then(|id| {
        if conversation.agent == "codex" {
            id.strip_prefix(&prefix).map(str::to_owned)
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
                    format!("{prefix}{}", response.session_id)
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
