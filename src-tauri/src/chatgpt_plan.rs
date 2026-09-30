//! Standard ChatGPT plan connection. Credentials stay in the native helper and Rust memory.
use crate::{agent_setup, model::ChatOptionValue, store::Store};
use agent_client_protocol::{Agent, ConnectionTo, schema::v1::AuthenticateRequest};
use serde::{Deserialize, Serialize};
use std::{process::Stdio, time::Duration};
use tokio::io::AsyncReadExt;
use ts_rs::TS;

pub const PREFIX: &str = "tanzakoo-plan-v1:";
pub const SIGN_IN_REQUIRED: &str = "接続状況からChatGPTでサインインしてください。";
#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct PlanAccount {
    pub id: String,
    pub label: String,
    pub signed_in: bool,
}
#[derive(Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct PlanStatus {
    pub available: bool,
    pub accounts: Vec<PlanAccount>,
    pub active: Option<PlanAccount>,
    pub warning: Option<String>,
}

// Never Serialize or Debug this type: it holds a bearer credential.
#[derive(Deserialize)]
pub struct PlanAccess {
    token: String,
    pub models: Vec<ChatOptionValue>,
}
impl PlanAccess {
    pub async fn authenticate(
        &self,
        cx: &ConnectionTo<Agent>,
    ) -> Result<(), agent_client_protocol::Error> {
        let meta = serde_json::json!({"gateway": {
            "baseUrl": "https://api.openai.com/v1",
            "headers": {"Authorization": format!("Bearer {}", self.token)},
            "providerName": "Tanzakoo ChatGPT plan"
        }});
        cx.send_request(
            AuthenticateRequest::new("gateway").meta(meta.as_object().unwrap().clone()),
        )
        .block_task()
        .await
        .map_err(|_| agent_client_protocol::Error::auth_required())?;
        Ok(())
    }
    pub fn model(&self, requested: Option<&str>) -> Result<String, String> {
        if let Some(value) = requested {
            if self.models.iter().any(|m| m.value == value) {
                return Ok(value.into());
            }
            return Err(
                "このモデルはChatGPTプランの一覧にありません。チャット設定から選び直してください。"
                    .into(),
            );
        }
        self.models
            .first()
            .map(|m| m.value.clone())
            .ok_or_else(|| "利用できるモデルがありません。".into())
    }
}

pub fn ensure_route(session: Option<&str>, account: Option<&PlanAccount>) -> Result<(), String> {
    if let Some(session) = session {
        let valid = match account {
            Some(account) => session.starts_with(&format!("{PREFIX}{}:", account.id)),
            None => !session.starts_with(PREFIX),
        };
        if !valid {
            return Err("この会話は別の接続で開始しています。対応する接続に戻すか、新しい会話を始めてください。".into());
        }
    }
    Ok(())
}

/// The application must never fall back to the engine's own credentials.
pub fn require_account(account: Option<&PlanAccount>) -> Result<&PlanAccount, String> {
    account
        .filter(|a| a.signed_in)
        .ok_or_else(|| SIGN_IN_REQUIRED.into())
}

pub async fn helper(
    store: &Store,
    action: &str,
    account: Option<&str>,
) -> Result<serde_json::Value, String> {
    let (node, script) = agent_setup::managed_entry("plan-cli.mjs")?;
    let directory = agent_setup::app_data(store).join("chatgpt-plan");
    let mut command = tokio::process::Command::new(node);
    command
        .args([script.as_os_str(), directory.as_os_str()])
        .arg(action);
    if let Some(id) = account {
        command.arg(id);
    }
    command
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_EXTRA_CA_CERTS")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let job = async {
        let mut child = command.spawn().map_err(|_| message("runtime"))?;
        let mut output = Vec::new();
        child
            .stdout
            .take()
            .ok_or_else(|| message("runtime"))?
            .take(1_048_577)
            .read_to_end(&mut output)
            .await
            .map_err(|_| message("runtime"))?;
        if output.len() > 1_048_576 {
            return Err(message("invalid_response"));
        }
        let status = child.wait().await.map_err(|_| message("runtime"))?;
        let value: serde_json::Value =
            serde_json::from_slice(&output).map_err(|_| message("invalid_response"))?;
        if let Some(error) = value["error"].as_str() {
            return Err(message(error));
        }
        if !status.success() {
            return Err(message("runtime"));
        }
        Ok(value["result"].clone())
    };
    tokio::time::timeout(
        Duration::from_secs(if action == "login" { 330 } else { 90 }),
        job,
    )
    .await
    .map_err(|_| message("timeout"))?
}

pub async fn access(store: &Store, account: &PlanAccount) -> Result<PlanAccess, String> {
    serde_json::from_value(helper(store, "access", Some(&account.id)).await?)
        .map_err(|_| message("invalid_response"))
}
pub fn message(code: &str) -> String {
    match code {
        "reauthorize" => "ChatGPTプランへの再サインインが必要です。接続設定から同じアカウントを選んでください。",
        "plan_permission" | "consent_denied" => "ChatGPTプランの利用が許可されませんでした。利用権限を確認して再試行してください。",
        "invalid_identity" | "invalid_callback" => "サインインを安全に確認できませんでした。もう一度サインインしてください。",
        "timeout" => "ChatGPTプランの接続がタイムアウトしました。再試行してください。",
        "locked" => "別のTanzakooがChatGPTプランの接続を処理しています。完了後に再試行してください。",
        "revocation_unconfirmed" => "この端末からサインアウトしましたが、サーバーでの失効を確認できませんでした。ChatGPTの設定から接続を解除できます。",
        _ => "ChatGPTプランへ接続できませんでした。ネット接続とアカウントを確認して再試行してください。",
    }.into()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conversations_are_bound_to_route_and_registration() {
        let account = PlanAccount {
            id: "a".into(),
            label: "Account".into(),
            signed_in: true,
        };
        assert!(ensure_route(None, Some(&account)).is_ok());
        assert!(ensure_route(Some("tanzakoo-plan-v1:a:thread"), Some(&account)).is_ok());
        for session in [
            "tanzakoo-v1:thread",
            "tanzakoo-review-v1:thread",
            "tanzakoo-plan-v1:b:thread",
            "legacy",
        ] {
            assert!(ensure_route(Some(session), Some(&account)).is_err());
        }
        assert!(ensure_route(Some("tanzakoo-plan-v1:a:thread"), None).is_err());
    }

    #[test]
    fn normal_connection_requires_a_signed_in_plan_account() {
        assert!(require_account(None).is_err());
        let mut account = PlanAccount {
            id: "a".into(),
            label: "Account".into(),
            signed_in: false,
        };
        assert!(require_account(Some(&account)).is_err());
        account.signed_in = true;
        assert!(require_account(Some(&account)).is_ok());
    }
}
