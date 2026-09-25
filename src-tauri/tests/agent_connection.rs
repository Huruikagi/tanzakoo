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

fn claude_fixture(mode: &str) -> (Store, PathBuf) {
    let (store, dir) = fixture(false);
    store
        .set_agent(AgentConfig {
            id: "claude".into(),
            command: std::env::var("TANZAKOO_NODE").unwrap_or_else(|_| "node".into()),
            args: vec![
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("tests/fixtures/fake-agent.mjs")
                    .to_string_lossy()
                    .into_owned(),
                format!(
                    "--trace={}",
                    dir.join("claude-trace.jsonl").to_string_lossy()
                ),
                format!("claude={mode}"),
            ],
        })
        .unwrap();
    (store, dir)
}

#[tokio::test]
async fn claude_check_reports_the_credential_without_sending_project_content() {
    for (mode, state, needle) in [
        ("none", "authRequired", "ログインしていません"),
        ("account", "ready", "Claude Max"),
        ("api_key:late", "ready", "従量課金"),
        ("silent", "ready", "確認できませんでした"),
    ] {
        let (store, dir) = claude_fixture(mode);
        let runtime = Arc::new(AgentRuntime::default());
        let cancel = runtime.begin().unwrap();
        let guard = OperationGuard(runtime.clone());
        let status = probe(store.clone(), "claude".into(), "check".into(), cancel).await;
        drop(guard);
        assert!(runtime.ensure_idle().is_ok());
        assert_eq!(status.state, state, "{mode}: {status:?}");
        assert!(status.message.contains(needle), "{mode}: {status:?}");
        assert!(!status.can_login);
        assert!(!status.message.contains("PRIVATE_EMAIL"));
        let trace = std::fs::read_to_string(dir.join("claude-trace.jsonl")).unwrap();
        assert!(!trace.contains("PRIVATE_BOARD_CONTENT"));
        for line in trace.lines() {
            let request: serde_json::Value = serde_json::from_str(line).unwrap();
            assert!(
                ["initialize", "session/new"].contains(&request["method"].as_str().unwrap()),
                "{line}"
            );
            if request["method"] == "initialize" {
                // Tanzakoo must not ask the adapter to offer claude.ai login.
                let caps = &request["params"]["clientCapabilities"];
                assert_ne!(caps["auth"]["terminal"], true);
                assert!(caps["_meta"]["terminal-auth"].is_null());
            } else {
                assert!(
                    request["params"]["mcpServers"]
                        .as_array()
                        .unwrap()
                        .is_empty()
                );
            }
        }
        let snapshot = store.snapshot().unwrap();
        assert!(snapshot.conversations.is_empty());
        assert!(snapshot.messages.is_empty());
    }
}

#[tokio::test]
async fn claude_sign_in_and_unbundled_default_never_start_a_process() {
    let (store, dir) = claude_fixture("account");
    let runtime = Arc::new(AgentRuntime::default());
    for action in ["login", "logout"] {
        let cancel = runtime.begin().unwrap();
        let guard = OperationGuard(runtime.clone());
        let status = probe(store.clone(), "claude".into(), action.into(), cancel).await;
        drop(guard);
        assert_eq!(status.state, "unsupported");
        assert!(!status.can_login);
    }
    assert!(!dir.join("claude-trace.jsonl").exists());

    store
        .set_agent(AgentConfig {
            id: "claude".into(),
            command: tanzakoo_lib::agent_setup::CLAUDE_UNAVAILABLE.into(),
            args: vec![],
        })
        .unwrap();
    let cancel = runtime.begin().unwrap();
    let guard = OperationGuard(runtime.clone());
    let status = probe(store.clone(), "claude".into(), "check".into(), cancel).await;
    drop(guard);
    assert_eq!(status.state, "unsupported");
    assert!(runtime.ensure_idle().is_ok());
    assert!(!dir.join("claude-trace.jsonl").exists());
}

/// Real claude-agent-acp from the dev dependencies. Run with an empty, isolated
/// CLAUDE_CONFIG_DIR so no personal login is read, e.g.
/// `CLAUDE_CONFIG_DIR=<empty dir> cargo test -- --ignored real_claude`.
#[tokio::test]
#[ignore = "starts the real adapter and Claude Code binary"]
async fn real_claude_adapter_reports_signed_out_without_content() {
    assert!(
        std::env::var_os("CLAUDE_CONFIG_DIR").is_some()
            && std::env::var_os("ANTHROPIC_API_KEY").is_none(),
        "use an isolated CLAUDE_CONFIG_DIR and no API key"
    );
    let (store, _) = fixture(false);
    store
        .set_agent(tanzakoo_lib::agent::default_config("claude"))
        .unwrap();
    let runtime = Arc::new(AgentRuntime::default());
    let cancel = runtime.begin().unwrap();
    let guard = OperationGuard(runtime.clone());
    let status = probe(store.clone(), "claude".into(), "check".into(), cancel).await;
    drop(guard);
    assert_eq!(status.state, "authRequired", "{status:?}");
    // Mapped from the adapter's `_auth/status_update` push, not a session error.
    assert!(
        status.message.contains("ログインしていません"),
        "{status:?}"
    );
    assert!(!status.can_login);
    assert!(store.snapshot().unwrap().conversations.is_empty());
}
