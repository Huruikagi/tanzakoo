//! Discover session settings without sending project content, and apply them before a turn.
use crate::{agent_setup, model::*, store::Store};
use agent_client_protocol::{
    AcpAgent, Agent, ConnectionTo,
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
    mut cancel: oneshot::Receiver<()>,
) -> Result<Vec<ChatOption>, String> {
    let config = store
        .snapshot()
        .map_err(|e| e.to_string())?
        .agents
        .into_iter()
        .find(|a| a.id == "codex")
        .unwrap_or_else(agent_setup::managed_config);
    let launch = agent_setup::launch(config, &store)?;
    let directory = store
        .path()
        .parent()
        .ok_or("保存先が不正です。")?
        .join("agents/model-check");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let result = Arc::new(Mutex::new(Vec::new()));
    let output = result.clone();
    let job = agent_client_protocol::Client.builder().connect_with(
        AcpAgent::new(launch),
        |cx: ConnectionTo<Agent>| async move {
            cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            // No MCP servers, project memory, history or prompt. This only reads configuration.
            let session = cx
                .send_request(NewSessionRequest::new(directory))
                .block_task()
                .await?;
            let values = if let Some(model) = model {
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
            *output.lock().unwrap() = values;
            Ok(())
        },
    );
    tokio::select! {
        response = tokio::time::timeout(Duration::from_secs(60), job) => {
            response.map_err(|_| "モデル一覧の取得がタイムアウトしました。")?.map_err(|e| format!("モデル一覧を取得できませんでした。Codexの接続とサインインを確認してください: {e}"))?;
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
