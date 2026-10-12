use std::{path::PathBuf, sync::Arc};
use tanzakoo_lib::{
    agent::{self, AgentRuntime},
    chat_settings,
    model::{AgentConfig, ChatSettings},
    store::Store,
};

fn fixture(hang: bool) -> (Store, PathBuf) {
    static NEXT_FIXTURE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!(
        "tanzakoo-models-{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        NEXT_FIXTURE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let store = Store::open(dir.join("project.db")).unwrap();
    let mut args = vec![
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/chat-options-agent.mjs")
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
        .create_card("PRIVATE_BOARD_CONTENT".into(), "private".into(), "user")
        .unwrap();
    (store, dir)
}

fn trace(dir: &std::path::Path) -> Vec<serde_json::Value> {
    std::fs::read_to_string(dir.join("agents/codex/options-trace.jsonl"))
        .unwrap()
        .lines()
        .map(|s| serde_json::from_str(s).unwrap())
        .collect()
}

#[tokio::test]
async fn discovery_uses_model_specific_options_without_sending_content() {
    let (store, dir) = fixture(false);
    let runtime = Arc::new(AgentRuntime::default());
    for (model, expected) in [
        (None, vec!["medium", "high"]),
        (Some("model-b".into()), vec!["low"]),
    ] {
        let (guard, cancel) = runtime.begin().unwrap();
        let values = chat_settings::discover(store.clone(), model, cancel)
            .await
            .unwrap();
        assert_eq!(
            values
                .iter()
                .find(|o| o.id == "reasoning_effort")
                .unwrap()
                .options
                .iter()
                .map(|o| o.value.as_str())
                .collect::<Vec<_>>(),
            expected
        );
        drop(guard);
    }
    let requests = trace(&dir);
    assert!(
        !serde_json::to_string(&requests)
            .unwrap()
            .contains("PRIVATE_BOARD_CONTENT")
    );
    for request in requests {
        assert_ne!(request["method"], "session/prompt");
        if request["method"] == "session/new" {
            assert_eq!(request["params"]["mcpServers"], serde_json::json!([]));
            assert_eq!(
                request["params"]["cwd"],
                dir.join("agents/model-check").to_string_lossy().as_ref()
            );
        }
    }
    let snapshot = store.snapshot().unwrap();
    assert!(snapshot.conversations.is_empty());
    assert!(snapshot.messages.is_empty());
    assert_eq!(snapshot.chat_settings, ChatSettings::default());
}

#[tokio::test]
async fn settings_persist_and_apply_before_new_and_resumed_turns() {
    let (store, dir) = fixture(false);
    let conversation = store.create_conversation("codex").unwrap();
    let runtime = Arc::new(AgentRuntime::default());
    for (model, effort) in [("model-a", "high"), ("model-b", "low")] {
        let settings = ChatSettings {
            model: Some(model.into()),
            reasoning_effort: Some(effort.into()),
        };
        store.set_chat_settings(settings.clone()).unwrap();
        let reopened = Store::open(store.path()).unwrap();
        assert_eq!(reopened.snapshot().unwrap().chat_settings, settings);
        store
            .append_message(&conversation.id, "user", "hello".into(), vec![])
            .unwrap();
        let (guard, cancel) = runtime.begin().unwrap();
        agent::run(
            reopened,
            runtime.clone(),
            conversation.id.clone(),
            "hello".into(),
            vec![],
            tanzakoo_lib::language::Language::En,
            cancel,
            Arc::new(|_| {}),
        )
        .await
        .unwrap();
        drop(guard);
    }
    let requests = trace(&dir);
    let methods: Vec<_> = requests
        .iter()
        .map(|r| r["method"].as_str().unwrap())
        .collect();
    assert_eq!(
        methods,
        [
            "initialize",
            "session/new",
            "session/set_config_option",
            "session/set_config_option",
            "session/prompt",
            "initialize",
            "session/load",
            "session/set_config_option",
            "session/set_config_option",
            "session/prompt"
        ]
    );
    assert_eq!(requests[2]["params"]["value"], "model-a");
    assert_eq!(requests[3]["params"]["value"], "high");
    assert_eq!(requests[7]["params"]["value"], "model-b");
    assert_eq!(requests[8]["params"]["value"], "low");
    let other = Store::open(dir.join("other.db")).unwrap();
    assert_eq!(
        other.snapshot().unwrap().chat_settings,
        ChatSettings::default()
    );
}

#[tokio::test]
async fn prompt_language_reaches_new_and_resumed_sessions_and_can_change_each_turn() {
    use tanzakoo_lib::language::Language;

    let (store, dir) = fixture(false);
    let conversation = store.create_conversation("codex").unwrap();
    let runtime = Arc::new(AgentRuntime::default());
    let languages = [Language::En, Language::En, Language::Ja];
    for language in languages {
        store
            .append_message(
                &conversation.id,
                "user",
                "Let's explore a TODO app.".into(),
                vec![],
            )
            .unwrap();
        let (_guard, cancel) = runtime.begin().unwrap();
        agent::run(
            store.clone(),
            runtime.clone(),
            conversation.id.clone(),
            "Let's explore a TODO app.".into(),
            vec![],
            language,
            cancel,
            Arc::new(|_| {}),
        )
        .await
        .unwrap();
    }
    let requests = trace(&dir);
    let prompts: Vec<_> = requests
        .iter()
        .filter(|r| r["method"] == "session/prompt")
        .collect();
    assert_eq!(prompts.len(), languages.len());
    assert_eq!(
        requests
            .iter()
            .filter(|r| r["method"] == "session/load")
            .count(),
        2
    );
    for (index, (request, language)) in prompts.iter().zip(languages).enumerate() {
        let text = request["params"]["prompt"][0]["text"].as_str().unwrap();
        assert!(text.contains(language.choose(
            "あなたはTanzakooの壁打ち相手です",
            "You are Tanzakoo's brainstorming partner"
        )));
        assert!(!text.contains("以前の会話（参考情報"));
        assert_eq!(
            text.contains("Previous conversation (reference only"),
            index == 0
        );
        assert_eq!(
            text.contains("ユーザーが明示した言語を優先"),
            language == Language::Ja
        );
        assert!(text.contains("Let's explore a TODO app."));
        assert!(text.contains("PRIVATE_BOARD_CONTENT"));
    }
}

#[tokio::test]
async fn unsupported_settings_stop_the_turn_before_sending_a_prompt() {
    let (store, dir) = fixture(false);
    store
        .set_chat_settings(ChatSettings {
            model: Some("model-b".into()),
            reasoning_effort: Some("high".into()),
        })
        .unwrap();
    let conversation = store.create_conversation("codex").unwrap();
    store
        .append_message(&conversation.id, "user", "hello".into(), vec![])
        .unwrap();
    let runtime = Arc::new(AgentRuntime::default());
    let (_guard, cancel) = runtime.begin().unwrap();
    assert!(
        agent::run(
            store,
            runtime.clone(),
            conversation.id,
            "hello".into(),
            vec![],
            tanzakoo_lib::language::Language::En,
            cancel,
            Arc::new(|_| {})
        )
        .await
        .is_err()
    );
    assert!(!trace(&dir).iter().any(|r| r["method"] == "session/prompt"));
}

#[tokio::test]
async fn discovery_cancellation_releases_the_slot() {
    let (store, _) = fixture(true);
    let runtime = Arc::new(AgentRuntime::default());
    let (guard, cancel) = runtime.begin().unwrap();
    let stop = runtime.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        stop.cancel();
    });
    assert!(
        chat_settings::discover(store, None, cancel)
            .await
            .unwrap_err()
            .contains("中止")
    );
    drop(guard);
    assert!(runtime.ensure_idle().is_ok());
}
