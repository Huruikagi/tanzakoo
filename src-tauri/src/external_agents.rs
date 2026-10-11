//! Optional, user-installed ACP executables. Credentials and installation stay with the CLI.
use crate::model::AgentConfig;
use agent_client_protocol::schema::v1::{McpServer, McpServerStdio};
use std::path::{Path, PathBuf};

pub const IDS: &[&str] = &["antigravity", "claude-api", "copilot", "opencode", "devin"];
pub const DISABLED: &str = "この配布版では外部CLI接続を利用できません。";
/// claude-agent-acp refuses turns billed to a claude.ai subscription under this flag.
/// Anthropic directs third-party Agent SDK products to API key authentication
/// (notes/claude-connection-terms.md), so the flag cannot be removed from the launch arguments.
pub const CLAUDE_API_GUARD: &str = "--hide-claude-auth";
const CLAUDE_API_GUARD_MESSAGE: &str =
    "Claude APIの起動引数から--hide-claude-authを外すことはできません。";
const CLAUDE_SUBSCRIPTION_REFUSED: &str = "Claudeのサブスクリプションでは利用できません。Anthropic APIキーを設定するか、Consoleアカウントでログインしてください。";
const CLAUDE_API_SIGNED_OUT: &str = "Claudeの認証が見つかりません。Anthropic APIキーを設定するか、Consoleアカウントでログインしてください。";

pub fn available() -> bool {
    !cfg!(feature = "app-sandbox")
}

pub fn is_external(id: &str) -> bool {
    IDS.contains(&id)
}

pub fn ensure_available(id: &str) -> Result<(), String> {
    if !available() || !is_external(id) {
        return Err(DISABLED.into());
    }
    Ok(())
}

pub fn default_config(id: &str) -> AgentConfig {
    let (command, args): (&str, &[&str]) = match id {
        "antigravity" if cfg!(windows) => ("agy_acp_server.exe", &[]),
        "antigravity" if cfg!(target_os = "linux") => ("agy_acp_server.par", &["--uid="]),
        "antigravity" => ("agy_acp_server.par", &[]),
        "claude-api" => ("claude-agent-acp", &[CLAUDE_API_GUARD]),
        "copilot" => ("copilot", &["--acp", "--stdio", "--disable-builtin-mcps"]),
        "opencode" => ("opencode", &["acp"]),
        "devin" => ("devin", &["acp"]),
        _ => ("", &[]),
    };
    AgentConfig {
        id: id.into(),
        command: command.into(),
        args: args.iter().map(|s| (*s).into()).collect(),
    }
}

pub fn validate(config: &AgentConfig) -> Result<(), String> {
    ensure_available(&config.id)?;
    if config.command.trim().is_empty()
        || config.command.len() > 4096
        || config.command.contains(['\0', '\n', '\r'])
        || config.command.starts_with('@')
        || config.args.len() > 64
        || config
            .args
            .iter()
            .any(|a| a.len() > 8192 || a.contains('\0'))
    {
        return Err("起動設定が不正です。".into());
    }
    if config.id == "claude-api" && !config.args.iter().any(|a| a == CLAUDE_API_GUARD) {
        return Err(CLAUDE_API_GUARD_MESSAGE.into());
    }
    Ok(())
}

/// The adapter answers both a signed-out CLI and a subscription-only account with
/// `authRequired`; only the latter carries a reason.
pub fn claude_api_auth_error(error: &agent_client_protocol::Error) -> Option<&'static str> {
    use agent_client_protocol::schema::v1::ErrorCode;
    (error.code == ErrorCode::AuthRequired).then(|| {
        match error.data.as_ref().and_then(|d| d["reason"].as_str()) {
            Some("claude_subscription_not_supported") => CLAUDE_SUBSCRIPTION_REFUSED,
            _ => CLAUDE_API_SIGNED_OUT,
        }
    })
}

/// Reported by the adapter after session creation. The account e-mail is never shown or kept.
pub fn claude_api_status(auth: Option<&serde_json::Value>) -> crate::model::ConnectionStatus {
    let status = |state: &str, message: String| crate::model::ConnectionStatus {
        state: state.into(),
        message,
        can_login: false,
    };
    let label = auth
        .and_then(|a| a["label"].as_str())
        .map(|l| l.chars().take(60).collect::<String>())
        .unwrap_or_default();
    match auth.and_then(|a| a["kind"].as_str()) {
        Some("none") => status("authRequired", CLAUDE_API_SIGNED_OUT.into()),
        Some("account") => status("authRequired", CLAUDE_SUBSCRIPTION_REFUSED.into()),
        Some("api_key") => status(
            "ready",
            "接続を確認しました（Anthropic APIキー）。利用料はAnthropicから直接請求されます。"
                .into(),
        ),
        Some("gateway" | "external") => status(
            "ready",
            format!("接続を確認しました（{label}）。料金はその接続先の契約に従います。"),
        ),
        _ => status(
            "ready",
            "接続を確認しました。認証の種類は確認できませんでした。送信時に認証が確認されます。"
                .into(),
        ),
    }
}

/// Copilot rejects stdio servers supplied by ACP clients, but accepts its official
/// session-only CLI configuration. Rebuild it each turn so restored conversations
/// bind questions and discussion activity to the current message. Never edit the CLI's settings
/// or add permission overrides. Connection probes do not call this function.
pub fn session_mcp(config: &mut AgentConfig, mcp: McpServerStdio) -> Vec<McpServer> {
    if config.id != "copilot" {
        return vec![McpServer::Stdio(mcp)];
    }
    config.args.extend([
        "--additional-mcp-config".into(),
        serde_json::json!({
            "mcpServers": {
                mcp.name: {
                    "type": "local",
                    "command": mcp.command,
                    "args": mcp.args,
                    "tools": ["*"],
                }
            }
        })
        .to_string(),
    ]);
    vec![]
}

/// Windows starts only these. npm also writes an extensionless `#!/bin/sh` shim
/// beside its `.cmd`, which CreateProcess rejects, so never pick a bare name there.
const WINDOWS_EXTENSIONS: &[&str] = &["exe", "cmd", "bat"];

fn candidates(path: &Path) -> Vec<PathBuf> {
    let runnable = path
        .extension()
        .is_some_and(|e| WINDOWS_EXTENSIONS.iter().any(|w| e.eq_ignore_ascii_case(w)));
    if !cfg!(windows) || runnable {
        return vec![path.into()];
    }
    WINDOWS_EXTENSIONS
        .iter()
        .map(|e| {
            let mut name = path.as_os_str().to_owned();
            name.push(format!(".{e}"));
            name.into()
        })
        .collect()
}

/// Resolve without a shell or login-shell evaluation; absolute paths work for GUI launches too.
pub fn resolve_command(command: &str) -> Result<PathBuf, String> {
    resolve_in(command, &std::env::var_os("PATH").unwrap_or_default())
}

fn resolve_in(command: &str, dirs: &std::ffi::OsStr) -> Result<PathBuf, String> {
    let path = Path::new(command);
    let found = if path.is_absolute() {
        candidates(path).into_iter().find(|c| c.is_file())
    } else if path.components().count() == 1 {
        std::env::split_paths(dirs)
            .filter(|p| p.is_absolute())
            .flat_map(|dir| candidates(&dir.join(path)))
            .find(|c| c.is_file())
    } else {
        None
    };
    found.ok_or_else(|| {
        "CLIが見つかりません。公式手順でインストールし、実行ファイルの絶対パスを指定してください。"
            .into()
    })
}

/// The ACP library inherits the GUI's working directory. Re-exec our small stdio
/// launcher so a CLI cannot load a caller's project instructions before session/new.
pub fn launch(
    config: AgentConfig,
    store: &crate::store::Store,
) -> Result<agent_client_protocol::AcpAgentConfig, String> {
    validate(&config)?;
    let command = resolve_command(&config.command)?;
    let cwd = crate::agent_setup::app_data(store)
        .join("agents/external-startup")
        .join(&config.id);
    std::fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
    Ok(agent_client_protocol::AcpAgentConfig::new(
        std::env::current_exe().map_err(|e| e.to_string())?,
    )
    .args([
        "--external-acp".into(),
        config.id,
        cwd.to_string_lossy().into_owned(),
        command.to_string_lossy().into_owned(),
    ])
    .args(config.args))
}

pub fn relay(args: &[String]) -> Result<i32, String> {
    let id = args.first().ok_or(DISABLED)?;
    ensure_available(id)?;
    let cwd = args.get(1).ok_or("Missing CLI working directory")?;
    let command = args.get(2).ok_or("Missing CLI executable")?;
    if !Path::new(cwd).is_absolute() || !Path::new(command).is_absolute() {
        return Err("CLI paths must be absolute".into());
    }
    #[cfg(windows)]
    contain_relay().map_err(|e| e.to_string())?;
    let mut child = std::process::Command::new(command);
    child.args(&args[3..]).current_dir(cwd);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        child.creation_flags(0x08000000); // CREATE_NO_WINDOW; std handles .cmd argument escaping.
    }
    Ok(child
        .status()
        .map_err(|e| e.to_string())?
        .code()
        .unwrap_or(1))
}

#[cfg(windows)]
fn contain_relay() -> windows::core::Result<()> {
    use windows::Win32::System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject,
        },
        Threading::GetCurrentProcess,
    };
    // Assign the launcher itself BEFORE spawning. Descendants inherit membership,
    // including npm/PowerShell wrappers. The ACP library kills only its immediate
    // child on Windows; closing this process's last job handle then kills the tree.
    // Deliberately retain the raw handle until process exit (main calls exit).
    unsafe {
        let job = CreateJobObjectW(None, None)?;
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _,
            std::mem::size_of_val(&limits) as u32,
        )?;
        AssignProcessToJobObject(job, GetCurrentProcess())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distribution_gate_and_known_agents() {
        for id in IDS {
            assert_eq!(validate(&default_config(id)).is_ok(), available());
        }
        assert!(ensure_available("claude").is_err());
        assert!(ensure_available("cursor").is_err());
        assert!(ensure_available("gemini").is_err());
        assert!(ensure_available("unknown").is_err());
        assert!(resolve_command("./missing-agent").is_err());
    }

    #[test]
    fn resolve_skips_npm_shell_shims_on_windows() {
        let dir = std::env::temp_dir().join(format!("tanzakoo-resolve-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let shim = dir.join("claude-agent-acp");
        std::fs::write(&shim, "#!/bin/sh\n").unwrap();
        std::fs::write(dir.join("claude-agent-acp.cmd"), "@echo off\r\n").unwrap();
        let expected = if cfg!(windows) {
            dir.join("claude-agent-acp.cmd")
        } else {
            shim.clone()
        };
        let path = std::env::join_paths([&dir]).unwrap();
        assert_eq!(resolve_in("claude-agent-acp", &path).unwrap(), expected);
        assert_eq!(resolve_in(shim.to_str().unwrap(), &path).unwrap(), expected);
        let explicit = dir.join("claude-agent-acp.cmd");
        assert_eq!(
            resolve_in(explicit.to_str().unwrap(), &path).unwrap(),
            explicit
        );
        if cfg!(windows) {
            std::fs::remove_file(dir.join("claude-agent-acp.cmd")).unwrap();
            assert!(resolve_in("claude-agent-acp", &path).is_err());
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn claude_api_keeps_the_subscription_guard() {
        let config = default_config("claude-api");
        assert_eq!(config.args, [CLAUDE_API_GUARD]);
        let mut extended = config.clone();
        extended.args.push("--verbose".into());
        assert_eq!(validate(&extended).is_ok(), available());
        let mut removed = config.clone();
        removed.args.clear();
        assert!(validate(&removed).is_err());
        if available() {
            assert_eq!(validate(&removed).unwrap_err(), CLAUDE_API_GUARD_MESSAGE);
        }
    }

    #[test]
    fn claude_api_explains_refused_credentials() {
        let refused = agent_client_protocol::Error::auth_required()
            .data(serde_json::json!({"reason": "claude_subscription_not_supported"}));
        assert_eq!(
            claude_api_auth_error(&refused),
            Some(CLAUDE_SUBSCRIPTION_REFUSED)
        );
        let signed_out = agent_client_protocol::Error::auth_required();
        assert_eq!(
            claude_api_auth_error(&signed_out),
            Some(CLAUDE_API_SIGNED_OUT)
        );
        let other = agent_client_protocol::Error::internal_error();
        assert_eq!(claude_api_auth_error(&other), None);
        let state = |kind: &str| {
            claude_api_status(Some(
                &serde_json::json!({"kind": kind, "label": "a@example.com"}),
            ))
        };
        assert_eq!(state("api_key").state, "ready");
        assert_eq!(state("account").state, "authRequired");
        assert_eq!(state("none").state, "authRequired");
        assert!(!state("api_key").message.contains("example.com"));
    }

    #[test]
    fn copilot_mcp_is_turn_scoped_and_preserves_permission_flags() {
        let original = AgentConfig {
            id: "copilot".into(),
            command: "copilot".into(),
            args: vec!["--acp".into(), "--deny-tool".into(), "shell".into()],
        };
        for message in ["first", "second"] {
            let mut config = original.clone();
            let command = std::path::PathBuf::from("C:/Test space/日本語/tanzakoo.exe");
            let args = vec![
                "--mcp".into(),
                "test.db".into(),
                "copilot".into(),
                "chat".into(),
                message.into(),
            ];
            let servers = session_mcp(
                &mut config,
                McpServerStdio::new("tanzakoo", &command).args(args.clone()),
            );
            assert!(servers.is_empty());
            assert_eq!(&config.args[..3], &original.args);
            assert_eq!(config.args[3], "--additional-mcp-config");
            let injected: serde_json::Value = serde_json::from_str(&config.args[4]).unwrap();
            assert_eq!(
                injected["mcpServers"]["tanzakoo"]["command"],
                command.to_string_lossy().as_ref()
            );
            assert_eq!(
                injected["mcpServers"]["tanzakoo"]["args"],
                serde_json::json!(args)
            );
            assert_eq!(config.args.len(), 5);
        }
        let mut other = default_config("devin");
        let saved = other.args.clone();
        assert_eq!(
            session_mcp(&mut other, McpServerStdio::new("tanzakoo", "app")).len(),
            1
        );
        assert_eq!(other.args, saved);
    }
}
