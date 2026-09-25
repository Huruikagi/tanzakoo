use std::{path::PathBuf, sync::Arc, time::Duration};
use tanzakoo_lib::{
    agent::AgentRuntime,
    agent_setup::{OperationGuard, probe},
    model::AgentConfig,
    store::Store,
};

fn fixture(hang: bool) -> (Store, PathBuf) {
    let dir = std::env::temp_dir().join(format!(
        "tanzakoo-auth-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let store = Store::open(dir.join("project.db")).unwrap();
    let mut args = vec![
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/fake-agent.mjs")
            .to_string_lossy()
            .into_owned(),
    ];
    if hang {
        args.push("hang".into());
    }
    store
        .set_agent(AgentConfig {
            id: "codex".into(),
            command: std::env::var("TANZAKOO_NODE").unwrap_or_else(|_| "node".into()),
            args,
        })
        .unwrap();
    store
        .create_card(
            "PRIVATE_BOARD_CONTENT".into(),
            "must not be sent during login".into(),
            "user",
        )
        .unwrap();
    (store, dir)
}

#[tokio::test]
async fn login_check_and_logout_never_send_project_content() {
    let (store, dir) = fixture(false);
    let runtime = Arc::new(AgentRuntime::default());
    for (action, expected) in [
        ("check", "authRequired"),
        ("login", "ready"),
        ("check", "ready"),
        ("logout", "authRequired"),
    ] {
        let cancel = runtime.begin().unwrap();
        let guard = OperationGuard(runtime.clone());
        let status = probe(store.clone(), "codex".into(), action.into(), cancel).await;
        assert_eq!(status.state, expected, "{status:?}");
        assert!(status.can_login);
        drop(guard);
        assert!(runtime.ensure_idle().is_ok());
    }
    let trace = std::fs::read_to_string(dir.join("agents/codex/fake-trace.jsonl")).unwrap();
    assert!(!trace.contains("PRIVATE_BOARD_CONTENT"));
    assert!(!trace.contains("session/prompt"));
    for line in trace.lines() {
        let request: serde_json::Value = serde_json::from_str(line).unwrap();
        if request["method"] == "session/new" {
            assert!(
                request["params"]["mcpServers"]
                    .as_array()
                    .unwrap()
                    .is_empty()
            );
            assert_eq!(
                request["params"]["cwd"],
                dir.join("agents/connection-check")
                    .to_string_lossy()
                    .as_ref()
            );
        }
    }
    let snapshot = store.snapshot().unwrap();
    assert!(snapshot.conversations.is_empty());
    assert!(snapshot.messages.is_empty());
    assert_eq!(snapshot.cards.len(), 1);
}

#[tokio::test]
async fn cancellation_releases_the_operation_without_creating_a_chat() {
    let (store, _) = fixture(true);
    let runtime = Arc::new(AgentRuntime::default());
    let cancel = runtime.begin().unwrap();
    let guard = OperationGuard(runtime.clone());
    let stop = runtime.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
        stop.cancel();
    });
    let status = probe(store.clone(), "codex".into(), "check".into(), cancel).await;
    assert_eq!(status.state, "unknown");
    drop(guard);
    assert!(runtime.ensure_idle().is_ok());
    assert!(store.snapshot().unwrap().conversations.is_empty());
}
