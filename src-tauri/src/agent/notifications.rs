//! Turn-local notification state shared with permission checks and session replay.
use super::{AgentEvent, Emit};
use agent_client_protocol::schema::v1::{ContentBlock, SessionUpdate};
use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

pub(super) struct Notifications {
    conversation_id: String,
    emit: Emit,
    text: Mutex<String>,
    pub(super) tool_calls: Mutex<HashMap<String, serde_json::Value>>,
    pub(super) replaying: AtomicBool,
}

impl Notifications {
    pub(super) fn new(conversation_id: String, emit: Emit) -> Self {
        Self {
            conversation_id,
            emit,
            text: Mutex::new(String::new()),
            tool_calls: Mutex::new(HashMap::new()),
            replaying: AtomicBool::new(false),
        }
    }

    pub(super) fn receive(&self, update: SessionUpdate) {
        if self.replaying.load(Ordering::SeqCst) {
            return;
        }
        let data = serde_json::to_value(&update).unwrap_or_default();
        if data["sessionUpdate"] == "tool_call"
            && let Some(id) = data["toolCallId"].as_str()
            && let Ok(mut calls) = self.tool_calls.lock()
        {
            calls.insert(id.into(), data.clone());
        }
        if let SessionUpdate::AgentMessageChunk(chunk) = &update {
            if let ContentBlock::Text(t) = &chunk.content {
                if let Ok(mut whole) = self.text.lock() {
                    whole.push_str(&t.text);
                }
                (self.emit)(AgentEvent {
                    conversation_id: self.conversation_id.clone(),
                    kind: "delta".into(),
                    text: t.text.clone(),
                    detail: None,
                });
            }
        } else {
            (self.emit)(AgentEvent {
                conversation_id: self.conversation_id.clone(),
                kind: "activity".into(),
                text: "検討しています".into(),
                detail: Some(serde_json::to_value(&update).unwrap_or_default()),
            });
        }
    }

    pub(super) fn text(&self) -> String {
        self.text.lock().map(|s| s.clone()).unwrap_or_default()
    }
}
