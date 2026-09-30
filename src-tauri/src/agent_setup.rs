//! App-owned runtime and credentials. Reading a board never calls this module's probe.
use crate::{model::*, store::Store};
use agent_client_protocol::{
    AcpAgent, AcpAgentConfig, Agent, ConnectionTo, UntypedMessage,
    schema::{ProtocolVersion, v1::*},
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tokio::sync::{Notify, oneshot};

pub const MANAGED: &str = "@tanzakoo/managed";
/// Claude is not bundled, and Tanzakoo offers no Claude sign-in, until the
/// provider terms for a third-party app are confirmed (notes/claude-connection-terms.md).
pub const CLAUDE_UNAVAILABLE: &str = "@tanzakoo/claude-unavailable";
const CLAUDE_UNAVAILABLE_MESSAGE: &str = "このTanzakooはClaude接続を提供していません。提供条件を確認中です。カードの閲覧・編集は引き続き利用できます。";
/// Pushed by claude-agent-acp after `initialize` and session creation. Reporting only.
const AUTH_STATUS_UPDATE: &str = "_auth/status_update";
static PATHS: OnceLock<(PathBuf, PathBuf)> = OnceLock::new();

pub fn initialize(resources: PathBuf, data: PathBuf) {
    let _ = PATHS.set((resources, data));
}

pub fn app_data(store: &Store) -> PathBuf {
    PATHS
        .get()
        .map(|p| p.1.clone())
        .unwrap_or_else(|| store.path().parent().unwrap().to_owned())
}

pub fn managed_entry(filename: &str) -> Result<(PathBuf, PathBuf), String> {
    let resources = PATHS
        .get()
        .map(|p| p.0.clone())
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_owned()))
        })
        .ok_or("アプリの保存場所を取得できません。")?;
    let runtime = resources.join("agent-runtime");
    let node = runtime
        .join("bin")
        .join(if cfg!(windows) { "node.exe" } else { "node" });
    let entry = runtime.join(filename);
    if node.is_file() && entry.is_file() {
        return Ok((node, entry));
    }
    if cfg!(debug_assertions) {
        return Ok((
            std::env::var("TANZAKOO_NODE")
                .unwrap_or_else(|_| "node".into())
                .into(),
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../packages/agent-runtime")
                .join(filename),
        ));
    }
    Err("同梱エージェントが見つかりません。カードの閲覧・編集は引き続き利用できます。".into())
}

pub fn launch_with_plan(
    store: &Store,
    account: &crate::chatgpt_plan::PlanAccount,
    model: &str,
) -> Result<AcpAgentConfig, String> {
    let launch = launch(managed_config(), store)?;
    let directory = app_data(store)
        .join("chatgpt-plan/runtime")
        .join(&account.id);
    let home = crate::storage::credential_dir(&directory).map_err(|e| e.to_string())?;
    Ok(launch
        .env("CODEX_HOME", home.to_string_lossy())
        .env("TANZAKOO_PLAN_MODEL", model))
}

pub fn mcp_binary() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    #[cfg(all(target_os = "macos", feature = "app-sandbox"))]
    {
        // The GUI has the parent sandbox profile; the MCP child must inherit it.
        let helper = executable.with_file_name("tanzakoo-mcp");
        if !helper.is_file() {
            return Err("同梱のボード操作プログラムが見つかりません。".into());
        }
        Ok(helper)
    }
    #[cfg(not(all(target_os = "macos", feature = "app-sandbox")))]
    {
        Ok(executable)
    }
}

pub fn managed_config() -> AgentConfig {
    AgentConfig {
        id: "codex".into(),
        command: MANAGED.into(),
        args: vec![],
    }
}

pub fn launch(config: AgentConfig, store: &Store) -> Result<AcpAgentConfig, String> {
    launch_with_review(config, store, None)
}

pub fn launch_with_review(
    config: AgentConfig,
    store: &Store,
    review_model: Option<&str>,
) -> Result<AcpAgentConfig, String> {
    let review = review_model.is_some();
    // Only the pinned, app-owned runtime may receive review credentials.
    let config = if review { managed_config() } else { config };
    let managed = config.command == MANAGED;
    let mut command = config.command.clone();
    let mut args = config.args;
    if command == CLAUDE_UNAVAILABLE {
        return Err(CLAUDE_UNAVAILABLE_MESSAGE.into());
    }
    if command == MANAGED {
        if config.id != "codex" {
            return Err("このエージェントの同梱版はまだ利用できません。".into());
        }
        let (node, entry) = managed_entry("codex.mjs")?;
        command = node.to_string_lossy().into();
        args = vec![entry.to_string_lossy().into()];
    }
    let mut launch = AcpAgentConfig::new(command)
        .args(args)
        .env("INITIAL_AGENT_MODE", "read-only");
    if managed {
        launch = launch
            .env("NODE_OPTIONS", "")
            .env("TANZAKOO_PLAN_MODEL", "")
            .env("TANZAKOO_REVIEW_MODEL", review_model.unwrap_or(""));
    }
    if config.id == "codex" {
        launch = launch.env(
            "CODEX_CONFIG",
            include_str!("../../packages/agent-runtime/reference-policy.json"),
        );
        let data = PATHS
            .get()
            .map(|p| p.1.clone())
            .unwrap_or_else(|| store.path().parent().unwrap().to_owned());
        let data = if review { data.join("review") } else { data };
        let home = crate::storage::credential_dir(&data).map_err(|e| e.to_string())?;
        launch = launch.env("CODEX_HOME", home.to_string_lossy());
    }
    Ok(launch)
}

pub async fn probe(
    store: Store,
    agent: String,
    action: String,
    mut cancel: oneshot::Receiver<()>,
) -> ConnectionStatus {
    let result = |state: &str, message: &str, can_login: bool| ConnectionStatus {
        state: state.into(),
        message: message.into(),
        can_login,
    };
    if !["check", "login", "logout"].contains(&action.as_str())
        || !["codex", "claude"].contains(&agent.as_str())
    {
        return result("error", "接続操作が不正です。", false);
    }
    // Claude sign-in and sign-out stay with the user's own Claude Code; Tanzakoo
    // neither starts them nor advertises terminal auth to the adapter.
    if action != "check" && agent != "codex" {
        return result(
            "unsupported",
            "TanzakooはClaudeのサインイン・サインアウトを提供していません。提供条件を確認中です。",
            false,
        );
    }
    let snapshot = match store.snapshot() {
        Ok(s) => s,
        Err(_) => return result("error", "接続設定を読み込めませんでした。", false),
    };
    let config = snapshot
        .agents
        .into_iter()
        .find(|c| c.id == agent)
        .unwrap_or_else(|| crate::agent::default_config(&agent));
    if config.command == CLAUDE_UNAVAILABLE {
        return result("unsupported", CLAUDE_UNAVAILABLE_MESSAGE, false);
    }
    let launch = match launch(config, &store) {
        Ok(v) => v,
        Err(e) => return result("error", &e, false),
    };
    // No project data, MCP servers, prompts or model requests in connection checks.
    let check_dir = PATHS
        .get()
        .map(|p| p.1.clone())
        .unwrap_or_else(|| store.path().parent().unwrap().to_owned())
        .join("agents/connection-check");
    if std::fs::create_dir_all(&check_dir).is_err() {
        return result("error", "接続確認用の保存場所を作れませんでした。", false);
    }
    let status = Arc::new(Mutex::new(result(
        "error",
        "接続を確認できませんでした。起動設定を確認してください。",
        false,
    )));
    let output = status.clone();
    let login = action == "login";
    let auth = Arc::new(Mutex::new(None::<serde_json::Value>));
    let auth_seen = Arc::new(Notify::new());
    let (notify_auth, notify_seen) = (auth.clone(), auth_seen.clone());
    let job = agent_client_protocol::Client
        .builder()
        .on_receive_notification(
            async move |notice: UntypedMessage, _cx| {
                if notice.method == AUTH_STATUS_UPDATE
                    && let Ok(mut current) = notify_auth.lock()
                {
                    *current = Some(notice.params["authStatus"].clone());
                    notify_seen.notify_one();
                }
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .connect_with(
            AcpAgent::new(launch),
            |cx: ConnectionTo<Agent>| async move {
                let initialized = cx
                    .send_request(InitializeRequest::new(ProtocolVersion::V1))
                    .block_task()
                    .await?;
                let methods = serde_json::to_value(&initialized.auth_methods).unwrap_or_default();
                let can_login = agent == "codex"
                    && methods
                        .as_array()
                        .is_some_and(|methods| methods.iter().any(|m| m["id"] == "chat-gpt"));
                if action == "logout" {
                    cx.send_request(LogoutRequest::new()).block_task().await?;
                    *output.lock().unwrap() =
                        result("authRequired", "サインアウトしました。", can_login);
                    return Ok(());
                }
                if login {
                    if !can_login {
                        return Err(agent_client_protocol::Error::invalid_params());
                    }
                    cx.send_request(AuthenticateRequest::new("chat-gpt"))
                        .block_task()
                        .await?;
                }
                let session = cx
                    .send_request(NewSessionRequest::new(check_dir))
                    .block_task()
                    .await;
                if session.is_ok() && agent == "claude" {
                    // The adapter reads the CLI's auth state in the background.
                    if auth.lock().unwrap().is_none() {
                        let _ = tokio::time::timeout(Duration::from_secs(6), auth_seen.notified())
                            .await;
                    }
                    *output.lock().unwrap() = claude_status(auth.lock().unwrap().as_ref());
                    return Ok(());
                }
                *output.lock().unwrap() = match session {
                    Ok(_) => result("ready", "接続できました。", can_login),
                    Err(e) if e.code == ErrorCode::AuthRequired => {
                        result("authRequired", "サインインが必要です。", can_login)
                    }
                    Err(_) => result(
                        "error",
                        "会話の開始を確認できませんでした。起動設定と認証を確認してください。",
                        can_login,
                    ),
                };
                Ok(())
            },
        );
    tokio::select! {
        response = tokio::time::timeout(Duration::from_secs(if login { 300 } else { 45 }), job) => {
            match response {
                Ok(Ok(())) => status.lock().unwrap().clone(),
                Ok(Err(_)) => result("error", "接続処理が完了しませんでした。起動設定・ネット接続を確認して再試行してください。", false),
                Err(_) => result("error", "接続処理が時間内に完了しませんでした。再試行できます。", false),
            }
        }
        _ = &mut cancel => result("unknown", "接続処理を中止しました。", false),
    }
}

/// Describes which credential the user's own Claude Code would use. The e-mail
/// address in the payload is deliberately not shown or kept.
pub fn claude_status(auth: Option<&serde_json::Value>) -> ConnectionStatus {
    let status = |state: &str, message: String| ConnectionStatus {
        state: state.into(),
        message,
        can_login: false,
    };
    let label = auth
        .and_then(|a| a["label"].as_str())
        .map(|l| l.chars().take(60).collect::<String>())
        .unwrap_or_default();
    match auth.and_then(|a| a["kind"].as_str()) {
        Some("none") => status(
            "authRequired",
            "Claudeにログインしていません。TanzakooはClaudeのサインインを提供していません（提供条件を確認中）。".into(),
        ),
        Some("account") => status(
            "ready",
            format!("接続を確認しました（{label}）。Tanzakooからのサブスクリプション利用は提供条件を確認中の開発用接続です。送信時に利用枠が確認されます。"),
        ),
        Some("api_key") => status(
            "ready",
            "接続を確認しました（Anthropic APIキー）。Claudeの月額契約とは別の従量課金です。".into(),
        ),
        Some("gateway" | "external") => status(
            "ready",
            format!("接続を確認しました（{label}）。料金はその接続先の契約に従います。"),
        ),
        _ => status(
            "ready",
            "接続を確認しました。認証の種類は確認できませんでした。送信時に認証と利用枠が確認されます。".into(),
        ),
    }
}
