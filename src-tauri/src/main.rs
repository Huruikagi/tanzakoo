#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--mcp") {
        let Some(path) = args.get(2) else {
            std::process::exit(2)
        };
        let result =
            tokio::runtime::Runtime::new()
                .expect("runtime")
                .block_on(tanzakoo_lib::mcp::serve(
                    path.into(),
                    args.get(3).cloned().unwrap_or_else(|| "agent".into()),
                ));
        if let Err(error) = result {
            eprintln!("{error}");
            std::process::exit(1);
        }
    } else if matches!(
        args.get(1).map(String::as_str),
        Some("--smoke" | "--smoke-resume" | "--smoke-cancel")
    ) {
        let agent = args.get(2).expect("agent: codex or claude").clone();
        let path = std::path::PathBuf::from(args.get(3).expect("test data directory"));
        std::fs::create_dir_all(&path).expect("test directory");
        let store = tanzakoo_lib::store::Store::open(path.join("smoke.db")).expect("test database");
        let runtime = std::sync::Arc::new(tanzakoo_lib::agent::AgentRuntime::default());
        let conversation = if args[1] == "--smoke-resume" {
            store
                .snapshot()
                .expect("snapshot")
                .conversations
                .into_iter()
                .rev()
                .find(|c| c.agent == agent)
                .expect("existing conversation")
        } else {
            store.create_conversation(&agent).expect("conversation")
        };
        let prompt = args.get(4).cloned().unwrap_or_else(|| {
            "個人用のTODOアプリを作りたい。まず論点を1枚だけ候補カードとして起票してください。"
                .into()
        });
        store
            .append_message(&conversation.id, "user", prompt.clone(), vec![])
            .expect("message");
        let cancel = runtime.begin().expect("begin");
        let permission_runtime = runtime.clone();
        let cancel_on_delta = args[1] == "--smoke-cancel";
        let emit: tanzakoo_lib::agent::Emit = std::sync::Arc::new(move |event| {
            println!("{}", serde_json::to_string(&event).unwrap());
            if cancel_on_delta && event.kind == "delta" {
                permission_runtime.cancel();
            }
            // Smoke tests refuse unrelated host operations; no unattended approvals.
            if event.kind == "permission"
                && let Some(id) = event.detail.as_ref().and_then(|d| d["id"].as_str())
            {
                let _ = permission_runtime.answer(id.into(), None);
            }
        });
        let result =
            tokio::runtime::Runtime::new()
                .expect("runtime")
                .block_on(tanzakoo_lib::agent::run(
                    store.clone(),
                    runtime.clone(),
                    conversation.id,
                    prompt,
                    vec![],
                    cancel,
                    emit,
                ));
        runtime.finish();
        println!(
            "{}",
            serde_json::to_string(&store.snapshot().unwrap()).unwrap()
        );
        if let Err(error) = result {
            if cancel_on_delta
                && error == "応答を停止しました。"
                && store
                    .snapshot()
                    .unwrap()
                    .messages
                    .iter()
                    .any(|m| m.role == "assistant" && !m.text.is_empty())
            {
                println!("Cancellation and partial persistence: PASS");
                return;
            }
            eprintln!("{error}");
            std::process::exit(1);
        }
    } else {
        tanzakoo_lib::run();
    }
}
