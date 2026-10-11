//! Optional, user-installed ACP executables. Credentials and installation stay with the CLI.
use crate::model::AgentConfig;
use agent_client_protocol::schema::v1::{McpServer, McpServerStdio};
use std::path::{Path, PathBuf};

pub const IDS: &[&str] = &["antigravity", "copilot", "opencode", "devin"];
pub const DISABLED: &str = "この配布版では外部CLI接続を利用できません。";

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
    Ok(())
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

/// Resolve without a shell or login-shell evaluation; absolute paths work for GUI launches too.
pub fn resolve_command(command: &str) -> Result<PathBuf, String> {
    let path = Path::new(command);
    if path.is_absolute() && path.is_file() {
        return Ok(path.into());
    }
    if path.components().count() == 1 {
        let dirs = std::env::var_os("PATH").unwrap_or_default();
        for dir in std::env::split_paths(&dirs).filter(|p| p.is_absolute()) {
            for suffix in if cfg!(windows) {
                &["", ".exe", ".cmd", ".bat"][..]
            } else {
                &[""][..]
            } {
                let candidate = dir.join(format!("{command}{suffix}"));
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }
    Err(
        "CLIが見つかりません。公式手順でインストールし、実行ファイルの絶対パスを指定してください。"
            .into(),
    )
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
