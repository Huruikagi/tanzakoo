use serde_json::{Value, json};
use std::{path::PathBuf, process::Stdio, time::Duration};
use tanzakoo_lib::{model::*, store::Store};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

struct Fixture {
    dir: PathBuf,
    store: Store,
}
static NEXT_FIXTURE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[tokio::test]
async fn mcp_presents_a_persisted_question_but_cannot_answer_it() {
    let f = Fixture::new();
    let c = f.store.create_conversation("codex").unwrap();
    let m = f
        .store
        .append_message(&c.id, "user", "TODOを作りたい".into(), vec![])
        .unwrap();
    let mut mcp = Mcp::start(&f.store, Some((&c.id, &m.id))).await;
    let tools = mcp
        .request(json!({"jsonrpc":"2.0", "id":2, "method":"tools/list"}))
        .await;
    let names: Vec<_> = tools["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"present_question"));
    assert!(!names.contains(&"answer_question"));
    let request = json!({"jsonrpc":"2.0", "id":3, "method":"tools/call", "params":{
        "name":"present_question", "arguments":{"question":"誰が使いますか？", "options":[
            {"label":"自分用", "description":"一人で使う"},
            {"label":"チーム用", "description":"共有して使う"}
        ]}
    }});
    let result = mcp.request(request.clone()).await;
    assert_eq!(result["result"]["isError"], false, "{result}");
    let saved = f.store.snapshot().unwrap();
    assert_eq!(saved.questions[0].message_id, m.id);
    assert_eq!(saved.questions[0].state, QuestionState::Pending);
    assert_eq!(saved.messages.len(), 1);
    mcp.stop().await;
    let mut unbound = Mcp::start(&f.store, None).await;
    let result = unbound.request(request).await;
    assert_eq!(result["result"]["isError"], true);
    assert_eq!(f.store.snapshot().unwrap().questions.len(), 1);
    unbound.stop().await;
}
#[tokio::test]
async fn mcp_presents_the_entire_question_batch_once() {
    let f = Fixture::new();
    let c = f.store.create_conversation("codex").unwrap();
    let m = f
        .store
        .append_message(&c.id, "user", "まとめて確認して".into(), vec![])
        .unwrap();
    let mut mcp = Mcp::start(&f.store, Some((&c.id, &m.id))).await;
    let request = json!({"jsonrpc":"2.0", "id":2, "method":"tools/call", "params":{
        "name":"present_questions", "arguments":{"questions":[
            {"question":"誰が使いますか？", "options":[{"label":"自分", "description":"一人で使う"}, {"label":"家族", "description":"共有する"}]},
            {"question":"通知は必要ですか？", "options":[{"label":"必要", "description":"時刻を決める"}, {"label":"不要", "description":"自分で確認する"}]}
        ]}
    }});
    let result = mcp.request(request.clone()).await;
    assert_eq!(result["result"]["isError"], false, "{result}");
    assert_eq!(f.store.snapshot().unwrap().questions.len(), 2);
    let result = mcp.request(request.clone()).await;
    assert_eq!(result["result"]["isError"], false, "{result}");
    assert_eq!(f.store.snapshot().unwrap().questions.len(), 2);
    mcp.stop().await;
    let mut unbound = Mcp::start(&f.store, None).await;
    let result = unbound.request(request).await;
    assert_eq!(result["result"]["isError"], true);
    unbound.stop().await;
}

impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "tanzakoo-discussion-mcp-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT_FIXTURE.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::open(dir.join("board.db")).unwrap();
        Self { dir, store }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
struct Mcp {
    child: tokio::process::Child,
    input: tokio::process::ChildStdin,
    output: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
}
impl Mcp {
    async fn start(store: &Store, turn: Option<(&str, &str)>) -> Self {
        let mut command = tokio::process::Command::new(env!("CARGO_BIN_EXE_tanzakoo"));
        command.arg("--mcp").arg(store.path()).arg("codex");
        if let Some((conversation, message)) = turn {
            command.arg(conversation).arg(message);
        }
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let output = BufReader::new(child.stdout.take().unwrap()).lines();
        let mut mcp = Self {
            child,
            input,
            output,
        };
        let result = mcp.request(json!({"jsonrpc":"2.0", "id":1, "method":"initialize", "params": {
            "protocolVersion":"2024-11-05", "capabilities":{}, "clientInfo":{"name":"discussion-test","version":"1"}
        }})).await;
        assert!(result.get("result").is_some(), "{result}");
        mcp.input
            .write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n")
            .await
            .unwrap();
        mcp
    }
    async fn request(&mut self, request: Value) -> Value {
        self.input
            .write_all(format!("{request}\n").as_bytes())
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let line = self
                    .output
                    .next_line()
                    .await
                    .unwrap()
                    .expect("MCP closed early");
                let response: Value = serde_json::from_str(&line).unwrap();
                if response["id"] == request["id"] {
                    return response;
                }
            }
        })
        .await
        .expect("MCP response timeout")
    }
    async fn report(&mut self, id: u32, card: &Card) -> Value {
        self.request(
            json!({"jsonrpc":"2.0", "id":id, "method":"tools/call", "params": {
                "name":"report_discussion", "arguments": {
                    "card_id":card.id, "base_revision":card.revision,
                    "reason":"ユーザーが通知の希望を話している", "suggest_only":false
                }
            }}),
        )
        .await
    }
    async fn stop(mut self) {
        self.child.kill().await.unwrap();
        self.child.wait().await.unwrap();
    }
}

#[tokio::test]
async fn mcp_is_turn_bound_and_only_the_ui_can_undo_or_reopen_decisions() {
    let f = Fixture::new();
    let card = f
        .store
        .create_card("通知".into(), "いつ？".into(), "user")
        .unwrap();
    let c = f.store.create_conversation("codex").unwrap();
    let m = f
        .store
        .append_message(&c.id, "user", "通知は朝にほしい".into(), vec![])
        .unwrap();
    let mut mcp = Mcp::start(&f.store, Some((&c.id, &m.id))).await;
    let tools = mcp
        .request(json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}))
        .await;
    let names: Vec<_> = tools["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"report_discussion"));
    assert!(!names.contains(&"resolve_discussion"));
    assert!(!names.contains(&"update_card"));
    let result = mcp.report(3, &card).await;
    assert_eq!(result["result"]["isError"], false, "{result}");
    let s = f.store.snapshot().unwrap();
    assert_eq!(s.cards[0].status, CardStatus::Discuss);
    assert_eq!(s.cards[0].body, "いつ？");
    assert_eq!(s.discussions[0].message_id, m.id);
    let retry = mcp.report(4, &card).await;
    assert_eq!(retry["result"]["isError"], false);
    assert_eq!(f.store.snapshot().unwrap().discussions.len(), 1);
    f.store
        .resolve_discussion(&s.discussions[0].id, DiscussionResolution::Undo)
        .unwrap();
    let denied = mcp.report(5, &card).await;
    assert_eq!(denied["result"]["isError"], true);
    assert_eq!(
        f.store.snapshot().unwrap().cards[0].status,
        CardStatus::Idea
    );
    let decided = f
        .store
        .create_card("決めた通知".into(), "夕方".into(), "user")
        .unwrap();
    let decided = f
        .store
        .update_card(Card {
            status: CardStatus::Decided,
            ..decided
        })
        .unwrap();
    let result = mcp.report(6, &decided).await;
    assert_eq!(result["result"]["isError"], false);
    let s = f.store.snapshot().unwrap();
    assert_eq!(s.cards[1].status, CardStatus::Decided);
    assert_eq!(s.discussions[1].state, DiscussionState::Suggested);
    mcp.stop().await;
    let mut unbound = Mcp::start(&f.store, None).await;
    let result = unbound.report(2, &decided).await;
    assert_eq!(result["result"]["isError"], true);
    assert_eq!(f.store.snapshot().unwrap().discussions.len(), 2);
    unbound.stop().await;
}
