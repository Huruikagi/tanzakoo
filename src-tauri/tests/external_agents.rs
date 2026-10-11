use std::{path::PathBuf, process::Command};
#[cfg(not(feature = "app-sandbox"))]
use tanzakoo_lib::projects::Projects;
use tanzakoo_lib::{
    agent_setup, external_agents,
    model::{AgentConfig, ChatSettings},
    store::Store,
};

fn directory() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "tanzakoo-external-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn external_distribution_gate_covers_launch_and_saved_configuration() {
    let path = directory();
    let store = Store::open(path.join("board.db")).unwrap();
    for &agent in external_agents::IDS {
        let config = AgentConfig {
            id: agent.into(),
            command: std::env::current_exe().unwrap().to_string_lossy().into(),
            args: external_agents::default_config(agent).args,
        };
        assert_eq!(
            store.set_agent(config.clone()).is_ok(),
            external_agents::available()
        );
        assert_eq!(
            store.create_conversation(agent).is_ok(),
            external_agents::available()
        );
        assert_eq!(
            agent_setup::launch(config.clone(), &store).is_ok(),
            external_agents::available()
        );
        assert!(agent_setup::launch_with_review(config, &store, Some("review-model")).is_err());
    }
    for removed_id in ["cursor", "gemini"] {
        let removed = AgentConfig {
            id: removed_id.into(),
            command: std::env::current_exe().unwrap().to_string_lossy().into(),
            args: vec![],
        };
        assert!(store.set_agent(removed.clone()).is_err());
        assert!(store.create_conversation(removed_id).is_err());
        assert!(agent_setup::launch(removed, &store).is_err());
    }
    if !external_agents::available() {
        let output = Command::new(env!("CARGO_BIN_EXE_tanzakoo"))
            .args(["--external-acp", "copilot"])
            .output()
            .unwrap();
        assert!(!output.status.success());
    }
}

#[cfg(not(feature = "app-sandbox"))]
#[test]
fn consent_matches_launch_across_projects_and_reconfiguration_drops_sessions() {
    let mut projects = Projects::open(directory()).unwrap();
    let first = projects.snapshot().unwrap().project.id;
    let config = external_agents::default_config("copilot");
    projects
        .active_store()
        .unwrap()
        .set_agent(config.clone())
        .unwrap();
    projects.set_consent("copilot", true).unwrap();
    projects.create("Other".into(), String::new()).unwrap();
    assert!(projects.consented("copilot").unwrap());
    let store = projects.active_store().unwrap();
    let conversation = store.create_conversation("copilot").unwrap();
    store
        .save_session(&conversation.id, "private-session".into())
        .unwrap();
    let mut changed = config;
    changed.args.push("--model=another-model".into());
    store.set_agent(changed).unwrap();
    assert!(
        store
            .conversation(&conversation.id)
            .unwrap()
            .session_id
            .is_none()
    );
    assert!(!projects.consented("copilot").unwrap());
    assert!(
        !projects
            .snapshot()
            .unwrap()
            .consents
            .contains(&"copilot".into())
    );
    projects.switch(&first).unwrap();
    assert!(projects.consented("copilot").unwrap());
}

#[cfg(not(feature = "app-sandbox"))]
#[test]
fn app_binary_probes_and_chats_without_copying_credentials_or_using_plan_auth() {
    for agent in ["copilot", "antigravity"] {
        let dir = directory();
        let trace = dir.join("trace.jsonl");
        let node = std::env::var("TANZAKOO_NODE").unwrap_or_else(|_| "node".into());
        let config = AgentConfig {
            id: agent.into(),
            command: node,
            args: vec![
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("tests/fixtures/external-agent.mjs")
                    .to_string_lossy()
                    .into(),
                trace.to_string_lossy().into(),
            ],
        };
        Store::open(dir.join("check.db"))
            .unwrap()
            .set_agent(config.clone())
            .unwrap();
        let store = Store::open(dir.join("smoke.db")).unwrap();
        store.set_agent(config).unwrap();
        store
            .create_card("PRIVATE_BOARD_CONTENT".into(), "test only".into(), "user")
            .unwrap();
        let run = |mode: &str| {
            let output = Command::new(env!("CARGO_BIN_EXE_tanzakoo"))
                .args([
                    mode,
                    agent,
                    dir.to_str().unwrap(),
                    "Reply only EXTERNAL_ACP_OK",
                ])
                .env("CODEX_HOME", "user-cli-home-sentinel")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        run("--connection-check");
        let initial = std::fs::read_to_string(&trace).unwrap();
        assert!(!initial.contains("PRIVATE_BOARD_CONTENT"));
        assert!(!initial.contains("session/prompt"));
        assert!(initial.contains("user-cli-home-sentinel"));
        assert!(initial.contains("external-startup"));
        run("--smoke");
        run("--smoke-resume");
        let full = std::fs::read_to_string(trace).unwrap();
        assert!(!full.contains("\"method\":\"authenticate\""));
        assert!(full.contains("session/load"));
        assert!(full.contains("tanzakoo"));
        let snapshot = store.snapshot().unwrap();
        assert_eq!(snapshot.conversations.len(), 1);
        let launches: Vec<serde_json::Value> = full
            .lines()
            .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
            .filter(|line| line.get("cwd").is_some())
            .collect();
        assert_eq!(launches.len(), 3);
        assert_eq!(launches[0]["args"], serde_json::json!([]));
        for (index, (launch, message)) in launches[1..]
            .iter()
            .zip(
                snapshot
                    .messages
                    .iter()
                    .filter(|message| message.role == "user"),
            )
            .enumerate()
        {
            if agent == "copilot" {
                assert_eq!(launch["args"][0], "--additional-mcp-config");
                let mcp: serde_json::Value =
                    serde_json::from_str(launch["args"][1].as_str().unwrap()).unwrap();
                let args = &mcp["mcpServers"]["tanzakoo"]["args"];
                assert_eq!(args[3], snapshot.conversations[0].id);
                assert_eq!(args[4], message.id);
            } else {
                assert_eq!(launch["args"], serde_json::json!([]));
                let requests: Vec<serde_json::Value> = full
                    .lines()
                    .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
                    .filter(|line| {
                        matches!(
                            line["method"].as_str(),
                            Some("session/new" | "session/load")
                        )
                    })
                    .collect();
                let servers = &requests[index + 1]["params"]["mcpServers"];
                assert_eq!(servers.as_array().unwrap().len(), 1);
                assert_eq!(servers[0]["name"], "tanzakoo");
                assert_eq!(servers[0]["args"][2], "antigravity");
                assert_eq!(servers[0]["args"][3], snapshot.conversations[0].id);
                assert_eq!(servers[0]["args"][4], message.id);
            }
        }
        assert_eq!(
            snapshot
                .messages
                .iter()
                .filter(|m| m.role == "assistant" && m.text == "EXTERNAL_ACP_OK")
                .count(),
            2
        );
    }
}

#[cfg(not(feature = "app-sandbox"))]
#[test]
fn external_model_and_effort_follow_the_cli_pickers() {
    let dir = directory();
    let trace = dir.join("trace.jsonl");
    let config = AgentConfig {
        id: "devin".into(),
        command: std::env::var("TANZAKOO_NODE").unwrap_or_else(|_| "node".into()),
        args: vec![
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/external-agent.mjs")
                .to_string_lossy()
                .into(),
            trace.to_string_lossy().into(),
            "--config-options".into(),
        ],
    };
    Store::open(dir.join("check.db"))
        .unwrap()
        .set_agent(config.clone())
        .unwrap();
    let store = Store::open(dir.join("smoke.db")).unwrap();
    store.set_agent(config.clone()).unwrap();
    store
        .create_card("PRIVATE_BOARD_CONTENT".into(), "test only".into(), "user")
        .unwrap();
    let app = |args: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_tanzakoo"))
            .args(args)
            .output()
            .unwrap()
    };
    let path = dir.to_str().unwrap();
    // Discovery reports the pickers by role, whatever the CLI calls them.
    for (model, efforts) in [
        (None, Some(vec!["low", "medium", "high"])),
        (Some("sonnet"), Some(vec!["low", "high"])),
        (Some("haiku"), None),
    ] {
        let mut args = vec!["--chat-options", "devin", path];
        args.extend(model);
        let output = app(&args);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let values: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        let ids: Vec<_> = values
            .as_array()
            .unwrap()
            .iter()
            .map(|o| o["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids[0], "model");
        assert_eq!(values[0]["currentValue"], model.unwrap_or("opus"));
        assert_eq!(values[0]["options"][1]["name"], "SONNET");
        let found = values
            .as_array()
            .unwrap()
            .iter()
            .find(|o| o["id"] == "reasoning_effort")
            .map(|o| {
                o["options"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v["value"].as_str().unwrap().to_owned())
                    .collect::<Vec<_>>()
            });
        assert_eq!(
            found,
            efforts.map(|e| e.iter().map(|v| v.to_string()).collect())
        );
        assert!(!ids.contains(&"mode"));
    }
    let discovery = std::fs::read_to_string(&trace).unwrap();
    assert!(!discovery.contains("PRIVATE_BOARD_CONTENT"));
    assert!(!discovery.contains("session/prompt"));
    assert!(!discovery.contains("\"name\":\"tanzakoo\""));
    assert!(
        !app(&["--chat-options", "devin", path, "unknown"])
            .status
            .success()
    );

    let requests = |from: usize| -> Vec<serde_json::Value> {
        std::fs::read_to_string(&trace)
            .unwrap()
            .lines()
            .skip(from)
            .map(|l| serde_json::from_str::<serde_json::Value>(l).unwrap())
            .filter(|l| l.get("method").is_some())
            .collect()
    };
    let lines = || std::fs::read_to_string(&trace).unwrap().lines().count();
    let methods = |requests: &[serde_json::Value]| -> Vec<String> {
        requests
            .iter()
            .map(|r| r["method"].as_str().unwrap().to_owned())
            .collect()
    };
    let settings = |model: &str, effort: Option<&str>| ChatSettings {
        model: Some(model.into()),
        reasoning_effort: effort.map(Into::into),
    };
    let smoke = |mode: &str| app(&[mode, "devin", path, "Reply only EXTERNAL_ACP_OK"]);

    // The model is applied before effort, using the CLI's own ids.
    store
        .set_chat_settings("devin", settings("sonnet", Some("high")))
        .unwrap();
    let start = lines();
    assert!(smoke("--smoke").status.success());
    let turn = requests(start);
    assert_eq!(
        methods(&turn),
        [
            "initialize",
            "session/new",
            "session/set_config_option",
            "session/set_config_option",
            "session/prompt"
        ]
    );
    assert_eq!(turn[2]["params"]["configId"], "model");
    assert_eq!(turn[2]["params"]["value"], "sonnet");
    assert_eq!(turn[3]["params"]["configId"], "effort");
    assert_eq!(turn[3]["params"]["value"], "high");

    // Selections the restored session already uses are not sent again.
    store
        .set_chat_settings("devin", settings("opus", Some("medium")))
        .unwrap();
    let start = lines();
    assert!(smoke("--smoke-resume").status.success());
    assert_eq!(
        methods(&requests(start)),
        ["initialize", "session/load", "session/prompt"]
    );

    // An effort the chosen model does not offer stops before the prompt.
    store
        .set_chat_settings("devin", settings("sonnet", Some("medium")))
        .unwrap();
    let start = lines();
    let refused = smoke("--smoke-resume");
    assert!(!refused.status.success());
    let stderr = String::from_utf8_lossy(&refused.stderr);
    assert!(
        stderr.contains("チャット設定を確認してください"),
        "{stderr}"
    );
    assert!(!methods(&requests(start)).contains(&"session/prompt".to_string()));

    // Settings belong to one CLI and are dropped when its launch changes.
    let snapshot = store.snapshot().unwrap();
    assert_eq!(snapshot.chat_settings, ChatSettings::default());
    assert_eq!(snapshot.external_chat_settings.len(), 1);
    assert!(
        store
            .set_chat_settings("gemini", settings("x", None))
            .is_err()
    );
    let mut changed = config.clone();
    changed.args.push("--verbose".into());
    store.set_agent(changed).unwrap();
    assert!(store.snapshot().unwrap().external_chat_settings.is_empty());
}

#[cfg(not(feature = "app-sandbox"))]
#[test]
fn claude_api_accepts_only_non_subscription_credentials() {
    let dir = directory();
    let node = std::env::var("TANZAKOO_NODE").unwrap_or_else(|_| "node".into());
    let fixture =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/external-agent.mjs");
    let config = |kind: &str| AgentConfig {
        id: "claude-api".into(),
        command: node.clone(),
        args: vec![
            fixture.to_string_lossy().into(),
            dir.join(format!("{kind}.jsonl")).to_string_lossy().into(),
            format!("--claude-auth={kind}"),
            external_agents::CLAUDE_API_GUARD.into(),
        ],
    };
    let mut unguarded = config("account");
    unguarded.args.pop();
    assert!(
        Store::open(dir.join("unguarded.db"))
            .unwrap()
            .set_agent(unguarded)
            .is_err()
    );
    for (kind, state, message) in [
        ("api_key", "ready", "Anthropic APIキー"),
        (
            "account",
            "authRequired",
            "サブスクリプションでは利用できません",
        ),
        ("none", "authRequired", "認証が見つかりません"),
    ] {
        let data = dir.join(kind);
        std::fs::create_dir_all(&data).unwrap();
        Store::open(data.join("check.db"))
            .unwrap()
            .set_agent(config(kind))
            .unwrap();
        let output = Command::new(env!("CARGO_BIN_EXE_tanzakoo"))
            .args(["--connection-check", "claude-api", data.to_str().unwrap()])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let status: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(status["state"], state, "{kind}: {status}");
        let text = status["message"].as_str().unwrap();
        assert!(text.contains(message), "{kind}: {text}");
        assert!(!text.contains("example.com"));
        let trace = std::fs::read_to_string(dir.join(format!("{kind}.jsonl"))).unwrap();
        assert!(!trace.contains("\"method\":\"authenticate\""));
        assert!(!trace.contains("session/prompt"));
    }
}

/// Real claude-agent-acp from the dev dependencies, with an empty Claude home and no
/// API key: the subscription guard must refuse before any prompt.
/// `cargo test --test external_agents -- --ignored real_claude_api`.
#[cfg(not(feature = "app-sandbox"))]
#[test]
#[ignore = "starts the real Claude adapter"]
fn real_claude_api_adapter_refuses_without_api_credentials() {
    let dir = directory();
    let adapter = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js");
    Store::open(dir.join("check.db"))
        .unwrap()
        .set_agent(AgentConfig {
            id: "claude-api".into(),
            command: std::env::var("TANZAKOO_NODE").unwrap_or_else(|_| "node".into()),
            args: vec![
                adapter.to_string_lossy().into(),
                external_agents::CLAUDE_API_GUARD.into(),
            ],
        })
        .unwrap();
    let home = dir.join("claude-home");
    std::fs::create_dir_all(&home).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_tanzakoo"))
        .args(["--connection-check", "claude-api", dir.to_str().unwrap()])
        .env("CLAUDE_CONFIG_DIR", &home)
        .env_remove("ANTHROPIC_API_KEY")
        .env_remove("ANTHROPIC_AUTH_TOKEN")
        .output()
        .unwrap();
    let status: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(status["state"], "authRequired", "{status}");
    assert!(
        status["message"]
            .as_str()
            .unwrap()
            .contains("認証が見つかりません")
    );
}

#[cfg(all(windows, not(feature = "app-sandbox")))]
#[test]
fn killing_the_launcher_terminates_cli_and_descendants() {
    use std::{
        process::Stdio,
        time::{Duration, Instant},
    };
    use windows::Win32::{
        Foundation::{CloseHandle, WAIT_OBJECT_0},
        System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject},
    };
    let dir = directory();
    let trace = dir.join("tree.jsonl");
    let node = external_agents::resolve_command(
        &std::env::var("TANZAKOO_NODE").unwrap_or_else(|_| "node".into()),
    )
    .unwrap();
    let fixture =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/external-agent.mjs");
    let mut launcher = Command::new(env!("CARGO_BIN_EXE_tanzakoo"))
        .args([
            "--external-acp",
            "copilot",
            dir.to_str().unwrap(),
            node.to_str().unwrap(),
            fixture.to_str().unwrap(),
            trace.to_str().unwrap(),
            "--descendant",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let start = Instant::now();
    let tree = loop {
        if let Some(tree) = std::fs::read_to_string(&trace).ok().and_then(|text| {
            text.lines()
                .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
                .find(|v| v["descendant"].is_number())
        }) {
            break tree;
        }
        if start.elapsed() > Duration::from_secs(10) {
            let _ = launcher.kill();
            panic!("launcher did not start the fixture");
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    unsafe {
        let handles = ["pid", "descendant"].map(|key| {
            OpenProcess(
                PROCESS_SYNCHRONIZE,
                false,
                tree[key].as_u64().unwrap() as u32,
            )
            .unwrap()
        });
        launcher.kill().unwrap();
        launcher.wait().unwrap();
        for handle in handles {
            let state = WaitForSingleObject(handle, 5000);
            let _ = CloseHandle(handle);
            assert_eq!(state, WAIT_OBJECT_0);
        }
    }
}
