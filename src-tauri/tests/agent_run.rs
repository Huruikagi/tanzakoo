use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tanzakoo_lib::{
    agent::{self, AgentEvent, AgentRuntime},
    model::{AgentConfig, QuestionOption, QuestionState},
    store::Store,
};

struct Fixture {
    dir: PathBuf,
    store: Store,
    conversation: String,
}

impl Fixture {
    fn new(mode: &str) -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "tanzakoo-turn-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed),
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::open(dir.join("project.db")).unwrap();
        store
            .set_agent(AgentConfig {
                id: "codex".into(),
                command: std::env::var("TANZAKOO_NODE").unwrap_or_else(|_| "node".into()),
                args: vec![
                    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("tests/fixtures/turn-agent.mjs")
                        .to_string_lossy()
                        .into_owned(),
                    mode.into(),
                ],
            })
            .unwrap();
        let conversation = store.create_conversation("codex").unwrap().id;
        Self {
            dir,
            store,
            conversation,
        }
    }

    fn start_turn(&self) {
        let message = self
            .store
            .append_message(&self.conversation, "user", "続けて".into(), vec![])
            .unwrap();
        self.store
            .present_question(
                &self.conversation,
                &message.id,
                "どちらにしますか？".into(),
                ["A", "B"]
                    .into_iter()
                    .map(|label| QuestionOption {
                        label: label.into(),
                        description: String::new(),
                    })
                    .collect(),
            )
            .unwrap();
    }

    async fn run(&self, cancel_on_delta: bool) -> (Result<(), String>, Vec<AgentEvent>) {
        let runtime = Arc::new(AgentRuntime::default());
        let (guard, cancel) = runtime.begin().unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let emitted = events.clone();
        let stop = runtime.clone();
        let result = tokio::time::timeout(
            Duration::from_secs(15),
            agent::run(
                self.store.clone(),
                runtime.clone(),
                self.conversation.clone(),
                "続けて".into(),
                vec![],
                cancel,
                Arc::new(move |event| {
                    let should_cancel = cancel_on_delta && event.kind == "delta";
                    emitted.lock().unwrap().push(event);
                    if should_cancel {
                        stop.cancel();
                    }
                }),
            ),
        )
        .await
        .expect("mock turn must finish");
        drop(guard);
        assert!(runtime.ensure_idle().is_ok());
        let events = events.lock().unwrap().clone();
        assert!(
            events
                .iter()
                .all(|event| event.conversation_id == self.conversation)
        );
        (result, events)
    }

    fn trace(&self) -> Vec<serde_json::Value> {
        std::fs::read_to_string(self.dir.join("agents/codex/turn-trace.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[tokio::test]
async fn resumed_turns_do_not_emit_or_persist_replayed_history() {
    let f = Fixture::new("complete");
    for _ in 0..2 {
        f.start_turn();
        let (result, events) = f.run(false).await;
        result.unwrap();
        assert_eq!(
            events
                .iter()
                .filter(|e| e.kind == "delta")
                .map(|e| e.text.as_str())
                .collect::<String>(),
            "途中の回答です。"
        );
    }
    let snapshot = Store::open(f.store.path()).unwrap().snapshot().unwrap();
    let replies: Vec<_> = snapshot
        .messages
        .iter()
        .filter(|m| m.role == "assistant")
        .map(|m| m.text.as_str())
        .collect();
    assert_eq!(replies, ["途中の回答です。", "途中の回答です。"]);
    assert_eq!(
        snapshot.conversations[0].session_id.as_deref(),
        Some("tanzakoo-v1:turn-session")
    );
    assert_eq!(
        snapshot.questions.last().unwrap().state,
        QuestionState::Pending
    );
    let methods: Vec<_> = f
        .trace()
        .iter()
        .map(|r| r["method"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(
        methods,
        [
            "initialize",
            "session/new",
            "session/prompt",
            "initialize",
            "session/load",
            "session/prompt"
        ]
    );
}

#[tokio::test]
async fn cancellation_and_failure_preserve_partial_text_and_cancel_turn_questions() {
    for mode in ["cancel", "fail"] {
        let f = Fixture::new(mode);
        f.start_turn();
        let (result, events) = f.run(mode == "cancel").await;
        let error = result.unwrap_err();
        assert!(
            error.contains(if mode == "cancel" {
                "応答を停止しました"
            } else {
                "Mock turn failure"
            }),
            "{error}"
        );
        assert_eq!(
            events
                .iter()
                .filter(|e| e.kind == "delta")
                .map(|e| e.text.as_str())
                .collect::<String>(),
            "途中の回答"
        );
        let snapshot = Store::open(f.store.path()).unwrap().snapshot().unwrap();
        assert_eq!(snapshot.messages.last().unwrap().role, "assistant");
        assert_eq!(snapshot.messages.last().unwrap().text, "途中の回答");
        assert_eq!(snapshot.questions[0].state, QuestionState::Cancelled);
    }
}

#[tokio::test]
async fn legacy_or_unsupported_sessions_start_a_fresh_session() {
    for (mode, saved) in [
        ("complete", "user-cli-session"),
        ("no-load", "tanzakoo-v1:old-session"),
    ] {
        let f = Fixture::new(mode);
        f.store.save_session(&f.conversation, saved.into()).unwrap();
        f.start_turn();
        f.run(false).await.0.unwrap();
        let requests = f.trace();
        assert!(requests.iter().any(|r| r["method"] == "session/new"));
        assert!(!requests.iter().any(|r| r["method"] == "session/load"));
        assert_eq!(
            f.store
                .conversation(&f.conversation)
                .unwrap()
                .session_id
                .as_deref(),
            Some("tanzakoo-v1:turn-session")
        );
    }
}
