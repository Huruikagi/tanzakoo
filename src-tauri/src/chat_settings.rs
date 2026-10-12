//! Discover session settings without sending project content, and apply them before a turn.
use crate::{agent_setup, chatgpt_plan, model::*, store::Store};
use agent_client_protocol::{
    AcpAgent, AcpAgentConfig, Agent, ConnectionTo,
    schema::{ProtocolVersion, v1::*},
};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::oneshot;

fn options(values: Vec<SessionConfigOption>) -> Vec<ChatOption> {
    values
        .into_iter()
        .filter_map(|option| {
            let id = option.id.to_string();
            if !["model", "reasoning_effort"].contains(&id.as_str()) {
                return None;
            }
            let SessionConfigKind::Select(select) = option.kind else {
                return None;
            };
            let choices = match select.options {
                SessionConfigSelectOptions::Ungrouped(values) => values,
                SessionConfigSelectOptions::Grouped(groups) => {
                    groups.into_iter().flat_map(|g| g.options).collect()
                }
                _ => return None,
            };
            Some(ChatOption {
                id,
                current_value: select.current_value.to_string(),
                options: choices
                    .into_iter()
                    .map(|v| ChatOptionValue {
                        value: v.value.to_string(),
                        name: v.name,
                    })
                    .collect(),
            })
        })
        .collect()
}

pub async fn apply(
    cx: &ConnectionTo<Agent>,
    session_id: &SessionId,
    settings: &ChatSettings,
) -> Result<(), agent_client_protocol::Error> {
    // Changing the model can change the supported effort values. Apply effort second.
    for (id, value) in [
        ("model", &settings.model),
        ("reasoning_effort", &settings.reasoning_effort),
    ] {
        if let Some(value) = value {
            let response = cx
                .send_request(SetSessionConfigOptionRequest::new(
                    session_id.clone(),
                    id,
                    value.as_str(),
                ))
                .block_task()
                .await?;
            if !options(response.config_options)
                .iter()
                .any(|o| o.id == id && o.current_value == *value)
            {
                return Err(agent_client_protocol::Error::invalid_params().data(
                    "モデル・推論強度を適用できませんでした。チャット設定を確認してください。",
                ));
            }
        }
    }
    Ok(())
}

pub async fn discover(
    store: Store,
    model: Option<String>,
    cancel: oneshot::Receiver<()>,
) -> Result<Vec<ChatOption>, String> {
    let config = store
        .snapshot()
        .map_err(|e| e.system_message())?
        .agents
        .into_iter()
        .find(|a| a.id == "codex")
        .unwrap_or_else(agent_setup::managed_config);
    let launch = agent_setup::launch(config, &store)?;
    discover_with_launch(store, launch, model, None, cancel).await
}

pub async fn discover_plan(
    store: Store,
    account: &chatgpt_plan::PlanAccount,
    access: chatgpt_plan::PlanAccess,
    model: Option<String>,
    cancel: oneshot::Receiver<()>,
) -> Result<Vec<ChatOption>, String> {
    chatgpt_plan::require_account(Some(account))?;
    let selected = model.filter(|m| access.models.iter().any(|o| o.value == *m));
    let model = access.model(selected.as_deref())?;
    let launch = agent_setup::launch_with_plan(&store, account, &model)?;
    discover_with_launch(store, launch, Some(model), Some(access), cancel).await
}

async fn discover_with_launch(
    store: Store,
    launch: AcpAgentConfig,
    model: Option<String>,
    plan: Option<chatgpt_plan::PlanAccess>,
    mut cancel: oneshot::Receiver<()>,
) -> Result<Vec<ChatOption>, String> {
    let directory = store
        .path()
        .parent()
        .ok_or("保存先が不正です。")?
        .join("agents/model-check");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let result = Arc::new(Mutex::new(Vec::new()));
    let output = result.clone();
    let is_plan = plan.is_some();
    let job = agent_client_protocol::Client.builder().connect_with(
        AcpAgent::new(launch),
        |cx: ConnectionTo<Agent>| async move {
            let mut initialize = InitializeRequest::new(ProtocolVersion::V1);
            if is_plan {
                initialize = initialize
                    .client_info(Implementation::new("Tanzakoo", env!("CARGO_PKG_VERSION")));
            }
            cx.send_request(initialize).block_task().await?;
            if let Some(access) = &plan {
                access.authenticate(&cx).await?;
            }
            // No MCP servers, project memory, history or prompt. This only reads configuration.
            let session = cx
                .send_request(NewSessionRequest::new(directory))
                .block_task()
                .await?;
            let mut values = if let Some(model) = model {
                let response = cx
                    .send_request(SetSessionConfigOptionRequest::new(
                        session.session_id,
                        "model",
                        model.as_str(),
                    ))
                    .block_task()
                    .await?;
                let values = options(response.config_options);
                if !values
                    .iter()
                    .any(|o| o.id == "model" && o.current_value == model)
                {
                    return Err(agent_client_protocol::Error::invalid_params());
                }
                values
            } else {
                options(session.config_options.unwrap_or_default())
            };
            if let Some(access) = plan {
                // ACP may expose cached models unavailable to this account. Keep
                // only its effort capability; the OAuth catalog owns model choices.
                for option in &mut values {
                    if option.id == "model" {
                        option.options = access.models.clone();
                    }
                }
                values.retain(|o| o.id == "model" || !o.options.is_empty());
            }
            *output.lock().unwrap() = values;
            Ok(())
        },
    );
    tokio::select! {
        response = tokio::time::timeout(Duration::from_secs(60), job) => {
            response.map_err(|_| "モデル一覧の取得がタイムアウトしました。")?.map_err(|e| if is_plan {
                // Credentials passed through ACP must never enter UI diagnostics.
                chatgpt_plan::message("runtime")
            } else { crate::system_message::detail(
                crate::system_message::Code::ModelOptions,
                &e.to_string(),
                &format!("モデル一覧を取得できませんでした。Codexの接続とサインインを確認してください: {e}"),
            ) })?;
        }
        _ = &mut cancel => return Err("モデル一覧の取得を中止しました。".into()),
    }
    let values = result.lock().map_err(|e| e.to_string())?.clone();
    if !values
        .iter()
        .any(|o| o.id == "model" && !o.options.is_empty())
    {
        return Err("この接続先はモデルの選択に対応していません。".into());
    }
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn plan_discovery_authenticates_and_preserves_account_models_without_prompting() {
        let directory = std::env::temp_dir().join(format!(
            "tanzakoo-plan-options-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let store = Store::open(directory.join("project.db")).unwrap();
        store
            .create_card("PRIVATE_BOARD_CONTENT".into(), "private".into(), "user")
            .unwrap();
        for model in ["model-a", "model-b", "unknown-model"] {
            let launch = AcpAgentConfig::new(
                std::env::var("TANZAKOO_NODE").unwrap_or_else(|_| "node".into()),
            )
            .args([std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/chat-options-agent.mjs")
                .to_string_lossy()
                .into_owned()])
            .env("CODEX_HOME", directory.to_string_lossy())
            .env("TANZAKOO_PLAN_MODEL", model);
            let access = serde_json::from_value(serde_json::json!({
                "token": "fixture-token",
                "models": [{"value": model, "name": "Account model"}]
            }))
            .unwrap();
            let (_stop, cancel) = oneshot::channel();
            let values = discover_with_launch(
                store.clone(),
                launch,
                Some(model.into()),
                Some(access),
                cancel,
            )
            .await
            .unwrap();
            let models = values.iter().find(|o| o.id == "model").unwrap();
            assert_eq!(models.current_value, model);
            assert_eq!(models.options.len(), 1);
            assert_eq!(models.options[0].name, "Account model");
            let efforts = values.iter().find(|o| o.id == "reasoning_effort");
            if model == "unknown-model" {
                assert!(efforts.is_none());
            } else {
                assert_eq!(
                    efforts
                        .unwrap()
                        .options
                        .iter()
                        .map(|o| o.value.as_str())
                        .collect::<Vec<_>>(),
                    if model == "model-a" {
                        vec!["medium", "high"]
                    } else {
                        vec!["low"]
                    }
                );
            }
        }
        let trace = std::fs::read_to_string(directory.join("options-trace.jsonl")).unwrap();
        assert!(!trace.contains("PRIVATE_BOARD_CONTENT"));
        let requests: Vec<serde_json::Value> = trace
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        for run in requests.chunks_exact(4) {
            assert_eq!(run[0]["params"]["clientInfo"]["name"], "Tanzakoo");
            assert_eq!(run[1]["method"], "authenticate");
            assert_eq!(
                run[1]["params"]["_meta"]["gateway"]["baseUrl"],
                "https://api.openai.com/v1"
            );
            assert_eq!(run[2]["method"], "session/new");
            assert_eq!(run[2]["params"]["mcpServers"], serde_json::json!([]));
            assert_eq!(run[3]["method"], "session/set_config_option");
        }
        assert_eq!(requests.len(), 12);
        assert!(store.snapshot().unwrap().conversations.is_empty());
    }
}
