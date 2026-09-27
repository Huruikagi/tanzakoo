//! Review credentials live only in memory, never in project settings or Codex config.
use agent_client_protocol::{Agent, ConnectionTo, schema::v1::AuthenticateRequest};
use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use ts_rs::TS;

pub const SESSION_PREFIX: &str = "tanzakoo-review-v1:";
const INVALID: &str = "審査用コードを確認して、もう一度入力してください。";
const NETWORK: &str = "審査用サーバーに接続できません。ネット接続を確認して再試行してください。";

#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ReviewStatus {
    pub model: String,
    pub expires_at: f64,
    pub remaining_requests: u32,
}

// Deliberately neither Debug nor Serialize: never return credentials to the UI.
#[derive(Clone)]
pub struct ReviewSession {
    endpoint: String,
    token: String,
    pub status: ReviewStatus,
}

fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64
}

pub fn endpoint() -> Result<String, String> {
    let configured = if cfg!(debug_assertions) {
        std::env::var("TANZAKOO_REVIEW_URL")
            .ok()
            .or_else(|| option_env!("TANZAKOO_REVIEW_URL").map(str::to_owned))
    } else {
        option_env!("TANZAKOO_REVIEW_URL").map(str::to_owned)
    };
    validate_endpoint(
        configured
            .as_deref()
            .ok_or("このビルドには審査用接続先が設定されていません。")?,
        cfg!(debug_assertions),
    )
}

fn validate_endpoint(value: &str, allow_local: bool) -> Result<String, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "審査用接続先の設定が不正です。")?;
    if !(url.scheme() == "https"
        || (allow_local && url.scheme() == "http" && url.host_str() == Some("127.0.0.1")))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("審査用接続先の設定が不正です。".into());
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

impl ReviewSession {
    pub async fn connect(token: String) -> Result<Self, String> {
        Self::connect_to(endpoint()?, token).await
    }

    async fn connect_to(endpoint: String, token: String) -> Result<Self, String> {
        let token = token.trim().to_owned();
        if token.len() != 47
            || !token.starts_with("trr_")
            || !token[4..]
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return Err(INVALID.into());
        }
        let mut session = Self {
            endpoint,
            token,
            status: ReviewStatus {
                model: String::new(),
                expires_at: 0.,
                remaining_requests: 0,
            },
        };
        session.status = session.check().await?;
        Ok(session)
    }

    pub fn ensure_usable(&self) -> Result<(), String> {
        if self.status.expires_at <= now() {
            return Err(
                "審査用コードの有効期限が切れています。新しいコードを入力してください。".into(),
            );
        }
        if self.status.remaining_requests == 0 {
            return Err(
                "審査用コードの利用上限に達しました。新しいコードを入力してください。".into(),
            );
        }
        Ok(())
    }

    pub async fn check(&self) -> Result<ReviewStatus, String> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| NETWORK)?;
        let mut response = client
            .get(format!("{}/review/status", self.endpoint))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|_| NETWORK)?;
        match response.status().as_u16() {
            200 => {}
            401 => {
                return Err(
                    "審査用コードが無効、または失効しています。新しいコードを入力してください。"
                        .into(),
                );
            }
            403 => {
                return Err(
                    "審査用コードの有効期限が切れています。新しいコードを入力してください。".into(),
                );
            }
            _ => return Err(NETWORK.into()),
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| NETWORK)? {
            if body.len() + chunk.len() > 4096 {
                return Err(NETWORK.into());
            }
            body.extend_from_slice(&chunk);
        }
        let status: ReviewStatus = serde_json::from_slice(&body).map_err(|_| NETWORK)?;
        if status.model.is_empty()
            || status.model.len() > 100
            || !status
                .model
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
            || !status.expires_at.is_finite()
            || status.expires_at <= now()
            || status.remaining_requests > 10_000
        {
            return Err("審査用コードまたはサーバーの応答を確認できませんでした。".into());
        }
        if status.remaining_requests == 0 {
            return Err(
                "審査用コードの利用上限に達しました。新しいコードを入力してください。".into(),
            );
        }
        Ok(status)
    }

    pub async fn authenticate(
        &self,
        cx: &ConnectionTo<Agent>,
    ) -> Result<(), agent_client_protocol::Error> {
        self.ensure_usable()
            .map_err(|e| agent_client_protocol::Error::invalid_params().data(e))?;
        let meta = serde_json::json!({"gateway": {
            "baseUrl": format!("{}/v1", self.endpoint),
            "headers": {"Authorization": format!("Bearer {}", self.token)},
            "providerName": "Tanzakoo review"
        }});
        cx.send_request(
            AuthenticateRequest::new("gateway").meta(meta.as_object().unwrap().clone()),
        )
        .block_task()
        .await
        .map_err(|_| agent_client_protocol::Error::auth_required())?;
        Ok(())
    }
}

pub fn ensure_conversation_route(session_id: Option<&str>, review: bool) -> Result<(), String> {
    if let Some(id) = session_id
        && id.starts_with(SESSION_PREFIX) != review
    {
        return Err("この会話は別の接続で開始しています。対応する接続に戻すか、新しい会話を始めてください。".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };

    fn token() -> String {
        format!("trr_{}", "a".repeat(43))
    }

    fn status_server(
        status: u16,
        body: String,
        headers: &str,
    ) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let response = format!(
            "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n{headers}\r\n{body}",
            body.len()
        );
        let task = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut request = Vec::new();
            let mut bytes = [0u8; 2048];
            while !request.ends_with(b"\r\n\r\n") {
                let n = stream.read(&mut bytes).unwrap();
                assert!(n > 0);
                request.extend_from_slice(&bytes[..n]);
            }
            let _ = stream.write_all(response.as_bytes());
            String::from_utf8(request).unwrap()
        });
        (endpoint, task)
    }

    #[tokio::test]
    async fn status_check_sends_only_auth_and_never_returns_the_code() {
        let body = serde_json::json!({"model":"fixture-model", "expiresAt":now()+60000., "remainingRequests":50}).to_string();
        let (endpoint, task) = status_server(200, body, "");
        let mut session = ReviewSession::connect_to(endpoint, token())
            .await
            .unwrap_or_else(|e| panic!("{e}"));
        let request = task.join().unwrap();
        assert!(request.starts_with("GET /review/status HTTP/1.1\r\n"));
        assert!(request.contains(&format!("authorization: Bearer {}\r\n", token())));
        assert!(request.ends_with("\r\n\r\n"));
        assert!(
            !serde_json::to_string(&session.status)
                .unwrap()
                .contains(&token())
        );
        assert!(session.ensure_usable().is_ok());
        session.status.expires_at = now() - 1.;
        assert!(session.ensure_usable().unwrap_err().contains("有効期限"));
    }

    #[tokio::test]
    async fn invalid_revoked_expired_exhausted_and_redirected_codes_fail_closed() {
        for (status, body, headers, message) in [
            (401, token(), "", "失効"),
            (403, token(), "", "有効期限"),
            (302, String::new(), "Location: http://127.0.0.1:1/stolen\r\n", "接続できません"),
            (200, serde_json::json!({"model":"fixture-model", "expiresAt":now()+60000., "remainingRequests":0}).to_string(), "", "利用上限"),
            (200, "x".repeat(5000), "", "接続できません"),
            (200, "{}".into(), "", "接続できません"),
        ] {
            let (endpoint, task) = status_server(status, body, headers);
            let error = ReviewSession::connect_to(endpoint, token()).await.err().unwrap();
            assert!(error.contains(message), "{error}");
            assert!(!error.contains(&token()));
            task.join().unwrap();
        }
        // No listener: validation must finish before any network request.
        for value in ["bad".into(), format!("trr_{}", "あ".repeat(14) + "a")] {
            assert_eq!(
                ReviewSession::connect_to("http://127.0.0.1:1".into(), value)
                    .await
                    .err()
                    .unwrap(),
                INVALID
            );
        }
    }

    #[tokio::test]
    async fn managed_acp_accepts_memory_only_gateway_and_uses_separate_home() {
        use agent_client_protocol::{
            AcpAgent,
            schema::{ProtocolVersion, v1::*},
        };
        let directory = std::env::temp_dir().join(format!(
            "tanzakoo-review-auth-{}-{}",
            std::process::id(),
            now()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let store = crate::store::Store::open(directory.join("project.db")).unwrap();
        let body = serde_json::json!({"model":"review-fixture-model", "expiresAt":now()+60000., "remainingRequests":50}).to_string();
        let (endpoint, task) = status_server(200, body, "");
        let access = ReviewSession::connect_to(endpoint, token())
            .await
            .unwrap_or_else(|e| panic!("{e}"));
        task.join().unwrap();
        // An arbitrary project command must never receive the review credential.
        let config = crate::model::AgentConfig {
            id: "codex".into(),
            command: "must-not-execute".into(),
            args: vec![],
        };
        let launch =
            crate::agent_setup::launch_with_review(config, &store, Some(&access.status.model))
                .unwrap();
        let workspace = directory.clone();
        let job = agent_client_protocol::Client.builder().connect_with(
            AcpAgent::new(launch),
            |cx: ConnectionTo<Agent>| async move {
                cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
                    .block_task()
                    .await?;
                access.authenticate(&cx).await?;
                let session = cx
                    .send_request(NewSessionRequest::new(workspace))
                    .block_task()
                    .await?;
                crate::chat_settings::apply(
                    &cx,
                    &session.session_id,
                    &crate::model::ChatSettings {
                        model: Some(access.status.model.clone()),
                        reasoning_effort: None,
                    },
                )
                .await?;
                Ok(())
            },
        );
        tokio::time::timeout(Duration::from_secs(45), job)
            .await
            .unwrap()
            .unwrap();
        // No real model request; the status fixture is already closed.
        assert!(directory.join("review/agents/codex").is_dir());
        assert!(!directory.join("agents/codex").exists());
        fn scan(path: &std::path::Path) {
            for entry in std::fs::read_dir(path).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    scan(&path);
                } else if let Ok(bytes) = std::fs::read(&path) {
                    assert!(
                        !bytes
                            .windows(token().len())
                            .any(|w| w == token().as_bytes()),
                        "credential persisted"
                    );
                }
            }
        }
        scan(&directory);
        drop(store);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn endpoints_are_fixed_https_origins_with_debug_loopback_only() {
        assert!(validate_endpoint("https://example.com", false).is_ok());
        assert!(validate_endpoint("http://127.0.0.1:8787", true).is_ok());
        for value in [
            "http://example.com",
            "http://127.0.0.1:8787",
            "https://user:pass@example.com",
            "https://example.com/v1",
            "https://example.com/?token=x",
            "https://example.com/#x",
        ] {
            assert!(validate_endpoint(value, false).is_err());
        }
    }

    #[test]
    fn conversations_never_silently_switch_credentials() {
        assert!(ensure_conversation_route(None, true).is_ok());
        assert!(ensure_conversation_route(Some("tanzakoo-v1:123"), true).is_err());
        assert!(ensure_conversation_route(Some("tanzakoo-review-v1:123"), false).is_err());
        assert!(ensure_conversation_route(Some("tanzakoo-review-v1:123"), true).is_ok());
    }
}
