//! Keep Windows managed-runtime descendants inside a connection-owned job.
//! Other launches retain the SDK's transport and process-group handling.
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Agent, Client, ConnectTo};

pub(crate) struct ProcessAgent(pub AcpAgentConfig);

impl ConnectTo<Client> for ProcessAgent {
    async fn connect_to(
        self,
        client: impl ConnectTo<Agent>,
    ) -> Result<(), agent_client_protocol::Error> {
        #[cfg(windows)]
        if self
            .0
            .environment()
            .get("TANZAKOO_ACP_PROCESS_GATE")
            .map(String::as_str)
            == Some("1")
        {
            return windows::connect(self.0, client).await;
        }
        ConnectTo::<Client>::connect_to(AcpAgent::new(self.0), client).await
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use ::windows::Win32::{
        Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0},
        System::Threading::{
            OpenProcess, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE, TerminateProcess,
            WaitForSingleObject,
        },
    };
    use agent_client_protocol::{
        ConnectionTo,
        schema::{ProtocolVersion, v1::InitializeRequest},
    };
    use std::{
        path::PathBuf,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    // Keep handles to these exact fixture processes, never terminate by a reused PID.
    struct Fixtures(Vec<HANDLE>);
    impl Drop for Fixtures {
        fn drop(&mut self) {
            for handle in &self.0 {
                unsafe {
                    let _ = TerminateProcess(*handle, 1);
                    let _ = CloseHandle(*handle);
                }
            }
        }
    }

    #[tokio::test]
    async fn managed_job_releases_descendant_locks_on_success_error_exit_and_cancel() {
        for mode in ["success", "error", "exit", "cancel"] {
            let directory = std::env::temp_dir().join(format!(
                "tanzakoo-process-{}-{}-{mode}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir(&directory).unwrap();
            let fixture =
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/locked-agent.mjs");
            let config = AcpAgentConfig::new(
                std::env::var("TANZAKOO_NODE").unwrap_or_else(|_| "node".into()),
            )
            .args([
                fixture.to_string_lossy().into_owned(),
                directory.to_string_lossy().into_owned(),
                mode.into(),
            ])
            .env("TANZAKOO_ACP_PROCESS_GATE", "1");
            let task = tokio::spawn(Client.builder().connect_with(
                ProcessAgent(config),
                move |cx: ConnectionTo<Agent>| async move {
                    cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
                        .block_task()
                        .await?;
                    if mode == "error" {
                        return Err(agent_client_protocol::Error::invalid_params());
                    }
                    Ok(())
                },
            ));
            // Observe the lock while the connection is active. Keep the callback
            // pending until handles have been captured, including the exit case.
            let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
            let tree = loop {
                if let Ok(bytes) = std::fs::read(directory.join("tree.json"))
                    && let Ok(tree) = serde_json::from_slice::<serde_json::Value>(&bytes)
                {
                    break tree;
                }
                assert!(
                    tokio::time::Instant::now() < deadline,
                    "fixture startup timed out: {mode}"
                );
                tokio::time::sleep(Duration::from_millis(10)).await;
            };
            let mut handles = Fixtures(vec![]);
            for field in ["adapter", "descendant"] {
                let handle = unsafe {
                    OpenProcess(
                        PROCESS_SYNCHRONIZE | PROCESS_TERMINATE,
                        false,
                        tree[field].as_u64().unwrap() as u32,
                    )
                }
                .unwrap();
                handles.0.push(handle);
            }
            assert_eq!(
                std::fs::remove_file(directory.join("locked.txt"))
                    .unwrap_err()
                    .raw_os_error(),
                Some(32)
            );
            std::fs::write(directory.join("release"), "ready").unwrap();
            if mode == "cancel" {
                task.abort();
            }
            let result = tokio::time::timeout(Duration::from_secs(10), task)
                .await
                .expect("connection shutdown timed out");
            match mode {
                "success" => result.unwrap().unwrap(),
                "cancel" => assert!(result.unwrap_err().is_cancelled()),
                _ => assert!(result.unwrap().is_err()),
            }
            for (index, handle) in handles.0.iter().enumerate() {
                assert_eq!(
                    // Node may already be closing its own descendant job when
                    // it exits, before our snapshot can capture those handles.
                    unsafe { WaitForSingleObject(*handle, if mode == "exit" { 5000 } else { 0 }) },
                    WAIT_OBJECT_0,
                    "fixture process survived: {mode}, index={index}, tree={tree}"
                );
            }
            std::fs::remove_dir_all(&directory)
                .unwrap_or_else(|error| panic!("{mode}: {directory:?}: {error}"));
        }
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use futures::{AsyncReadExt, AsyncWriteExt};
    use std::{
        collections::VecDeque,
        sync::{Arc, Mutex},
        time::Duration,
    };

    pub(super) async fn connect(
        config: AcpAgentConfig,
        client: impl ConnectTo<Agent>,
    ) -> Result<(), agent_client_protocol::Error> {
        use agent_client_protocol::{ByteStreams, Error};
        let mut job = crate::windows_job::ProcessJob::new().map_err(Error::into_internal_error)?;
        let (mut stdin, stdout, mut stderr, mut child) = AcpAgent::new(config).spawn_process()?;
        // The Node bootstrap cannot spawn Codex until this assignment succeeds.
        // Assigning a running, ungated launcher would leave a startup race.
        if let Err(error) = job.assign_child(&child) {
            let _ = child.kill();
            let _ = child.status().await;
            return Err(Error::into_internal_error(error));
        }
        stdin
            .write_all(b"tanzakoo-process-ready\n")
            .await
            .map_err(Error::into_internal_error)?;
        stdin.flush().await.map_err(Error::into_internal_error)?;

        // Preserve a bounded stderr tail, without allowing a full stderr pipe to
        // block the adapter. Never log ACP traffic or credential-bearing config.
        let tail = Arc::new(Mutex::new(VecDeque::<u8>::new()));
        let captured = tail.clone();
        let drain = async move {
            let mut buffer = [0u8; 8192];
            loop {
                let read = stderr
                    .read(&mut buffer)
                    .await
                    .map_err(Error::into_internal_error)?;
                if read == 0 {
                    return Ok::<_, Error>(());
                }
                let mut tail = captured.lock().unwrap();
                tail.extend(&buffer[..read]);
                let excess = tail.len().saturating_sub(64 * 1024);
                tail.drain(..excess);
            }
        };
        let protocol = ConnectTo::<Client>::connect_to(ByteStreams::new(stdin, stdout), client);
        tokio::pin!(protocol);
        let drive = async {
            tokio::select! {
                result = &mut protocol => result,
                status = child.status() => {
                    let status = status.map_err(Error::into_internal_error)?;
                    if !status.success() {
                        let mut error = Error::internal_error();
                        error.message = format!("Agent process exited with {status}");
                        let bytes: Vec<_> = tail.lock().unwrap().iter().copied().collect();
                        if !bytes.is_empty() {
                            error = error.data(String::from_utf8_lossy(&bytes).into_owned());
                        }
                        return Err(error);
                    }
                    // Like the SDK, allow already-written responses to drain,
                    // but do not hang on pipes inherited by descendants.
                    tokio::time::timeout(Duration::from_secs(1), &mut protocol).await.unwrap_or(Ok(()))
                }
            }
        };
        tokio::pin!(drive, drain);
        let result = tokio::select! {
            result = &mut drive => result,
            result = &mut drain => { result?; drive.await }
        };
        // Also runs on cancellation, timeout, error and panic via the job guard.
        // Wait for every job member to exit before allowing callers to remove homes.
        job.stop().map_err(Error::into_internal_error)?;
        result
    }
}
