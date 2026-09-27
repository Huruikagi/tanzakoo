use crate::{AppState, agent::AgentRuntime, projects::Projects};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, Ordering},
};

fn fixture() -> (AppState, String) {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "tanzakoo-command-{}-{nonce}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let projects = Projects::open(root).unwrap();
    let id = projects.snapshot().unwrap().project.id;
    (
        AppState {
            projects: Arc::new(Mutex::new(projects)),
            runtime: Arc::new(AgentRuntime::default()),
        },
        id,
    )
}

#[test]
fn rejects_stale_projects_and_failed_prerequisites_without_reserving() {
    let (state, id) = fixture();
    assert!(
        state
            .begin_project_operation("stale", |_, _| {
                panic!("A stale request must not reach validation")
            })
            .is_err()
    );
    assert!(state.runtime.ensure_idle().is_ok());
    let error = state
        .begin_project_operation(&id, |_, _| Err("consent required".into()))
        .err()
        .unwrap();
    assert_eq!(error, "consent required");
    assert!(state.runtime.ensure_idle().is_ok());
}

#[test]
fn holds_project_lock_through_validation_and_reserves_one_operation() {
    let (state, id) = fixture();
    let operation = state
        .begin_project_operation(&id, |_, store| {
            assert!(matches!(
                state.projects.try_lock(),
                Err(std::sync::TryLockError::WouldBlock)
            ));
            assert_eq!(store.project().unwrap().id, id);
            Ok(())
        })
        .unwrap();
    assert_eq!(operation.store.project().unwrap().id, id);
    // Project-switch commands can take the lock now but their idle check must fail.
    let projects = state.projects.lock().unwrap();
    assert!(state.runtime.ensure_idle().is_err());
    drop(projects);
    assert!(state.begin_project_operation(&id, |_, _| Ok(())).is_err());
    drop(operation);
    assert!(state.runtime.ensure_idle().is_ok());
    assert!(state.begin_project_operation(&id, |_, _| Ok(())).is_ok());
}

#[test]
fn cancellation_keeps_reservation_until_guard_drops_and_early_errors_release_it() {
    let (state, id) = fixture();
    let mut operation = state.begin_project_operation(&id, |_, _| Ok(())).unwrap();
    state.runtime.cancel();
    assert_eq!(operation.cancel.try_recv(), Ok(()));
    assert!(state.runtime.ensure_idle().is_err());
    drop(operation);
    assert!(state.runtime.ensure_idle().is_ok());
    let fail = || -> Result<(), String> {
        let _operation = state.begin_project_operation(&id, |_, _| Ok(()))?;
        Err("write failed".into())
    };
    assert!(fail().is_err());
    assert!(state.runtime.ensure_idle().is_ok());
}

#[tokio::test]
async fn dropping_an_in_flight_command_releases_the_reservation() {
    let (state, id) = fixture();
    let command_state = state.clone();
    let (ready, started) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        let _operation = command_state
            .begin_project_operation(&id, |_, _| Ok(()))
            .unwrap();
        ready.send(()).unwrap();
        std::future::pending::<()>().await;
    });
    started.await.unwrap();
    assert!(state.runtime.ensure_idle().is_err());
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert!(state.runtime.ensure_idle().is_ok());
}
