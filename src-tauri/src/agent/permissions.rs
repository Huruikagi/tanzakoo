use super::{AgentEvent, AgentRuntime, Emit};
use agent_client_protocol::schema::v1::*;
use std::{
    collections::HashMap,
    sync::{Mutex, atomic::Ordering},
};
use tokio::sync::oneshot;

// Only the app-owned MCP operations are pre-authorized. The adapters identify
// them differently; Codex permission messages refer back to a prior tool notification.
pub(super) fn is_board_tool(agent: &str, call: &serde_json::Value) -> bool {
    let names = [
        "get_board",
        "create_candidate",
        "propose_card_change",
        "propose_memory_change",
        "report_discussion",
        "present_question",
    ];
    if agent == "codex" {
        call["_meta"]["is_mcp_tool_call"] == true
            && call["rawInput"]["server"] == "tanzakoo"
            && call["rawInput"]["tool"]
                .as_str()
                .is_some_and(|name| names.contains(&name))
    } else if agent == "claude" {
        call["title"].as_str().is_some_and(|title| {
            names
                .iter()
                .any(|name| title == format!("mcp__tanzakoo__{name}"))
        })
    } else {
        false
    }
}

pub(super) async fn respond(
    runtime: &AgentRuntime,
    agent: &str,
    calls: &Mutex<HashMap<String, serde_json::Value>>,
    request: RequestPermissionRequest,
    conversation_id: &str,
    emit: &Emit,
) -> RequestPermissionResponse {
    let direct = serde_json::to_value(&request.tool_call).unwrap_or_default();
    let call = calls
        .lock()
        .ok()
        .and_then(|mut calls| calls.remove(&request.tool_call.tool_call_id.to_string()))
        .unwrap_or(direct);
    if is_board_tool(agent, &call)
        && let Some(option) = request
            .options
            .iter()
            .find(|o| o.kind == PermissionOptionKind::AllowOnce)
    {
        return RequestPermissionResponse::new(RequestPermissionOutcome::Selected(
            SelectedPermissionOutcome::new(option.option_id.clone()),
        ));
    }
    let key = runtime.next_id.fetch_add(1, Ordering::SeqCst).to_string();
    let (tx, rx) = oneshot::channel();
    if let Ok(mut pending) = runtime.permissions.lock() {
        pending.insert(key.clone(), tx);
    }
    let mut shown = serde_json::to_value(&request).unwrap_or_default();
    shown["toolCall"] = call.clone();
    emit(AgentEvent {
        conversation_id: conversation_id.into(),
        kind: "permission".into(),
        text: call["title"].as_str().unwrap_or("操作の確認").into(),
        detail: Some(serde_json::json!({"id":key,"request":shown})),
    });
    let selected = rx.await.ok().flatten();
    let outcome = selected
        .and_then(|id| {
            request
                .options
                .iter()
                .find(|o| o.option_id.to_string() == id)
                .map(|o| o.option_id.clone())
        })
        .map(|id| RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(id)))
        .unwrap_or(RequestPermissionOutcome::Cancelled);
    RequestPermissionResponse::new(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn request() -> RequestPermissionRequest {
        serde_json::from_value(serde_json::json!({
            "sessionId":"session", "toolCall":{"toolCallId":"call", "title":"Tool"},
            "options":[{"optionId":"once", "name":"Allow once", "kind":"allow_once"}]
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn cached_board_tool_is_automatic_but_unrelated_calls_require_a_valid_answer() {
        let runtime = Arc::new(AgentRuntime::default());
        let calls = Mutex::new(HashMap::from([(
            "call".into(),
            serde_json::json!({
                "_meta":{"is_mcp_tool_call":true}, "rawInput":{"server":"tanzakoo", "tool":"get_board"}
            }),
        )]));
        let emit: Emit = Arc::new(|_| panic!("board tool must not ask for permission"));
        let response = respond(&runtime, "codex", &calls, request(), "c", &emit).await;
        assert_eq!(
            serde_json::to_value(response).unwrap()["outcome"]["optionId"],
            "once"
        );
        assert!(calls.lock().unwrap().is_empty());

        for (answer, expected) in [
            (Some("once"), "selected"),
            (Some("unknown"), "cancelled"),
            (None, "cancelled"),
        ] {
            let reply = runtime.clone();
            let emit: Emit = Arc::new(move |event| {
                assert_eq!(event.kind, "permission");
                assert_eq!(event.conversation_id, "c");
                let detail = event.detail.unwrap();
                assert_eq!(detail["request"]["toolCall"]["title"], "Tool");
                reply
                    .answer(
                        detail["id"].as_str().unwrap().into(),
                        answer.map(str::to_owned),
                    )
                    .unwrap();
            });
            let response = respond(&runtime, "codex", &calls, request(), "c", &emit).await;
            assert_eq!(
                serde_json::to_value(response).unwrap()["outcome"]["outcome"],
                expected
            );
        }
    }
}
