use super::*;

fn status(state: &str) -> ConnectionStatus {
    ConnectionStatus {
        state: state.into(),
        message: "check result".into(),
        can_login: false,
    }
}

#[test]
fn external_checks_survive_reopening_and_are_isolated_by_project_and_launch() {
    let f = Fixture::new();
    let config = crate::external_agents::default_config("copilot");
    assert!(
        f.store
            .snapshot()
            .unwrap()
            .external_connection_checks
            .is_empty()
    );
    // Defaults do not require an explicit saved agent configuration.
    f.store
        .save_external_connection_check(&config, status("ready"))
        .unwrap();
    let reopened = Store::open(f.store.path()).unwrap();
    let check = reopened
        .snapshot()
        .unwrap()
        .external_connection_checks
        .remove("copilot")
        .unwrap();
    assert_eq!(check.status.state, "ready");
    assert!(check.checked_at > 0.0);
    assert_eq!(check.config.command, config.command);
    assert!(
        Store::open(f.dir.join("other.db"))
            .unwrap()
            .snapshot()
            .unwrap()
            .external_connection_checks
            .is_empty()
    );
    reopened
        .save_external_connection_check(&config, status("unknown"))
        .unwrap();
    assert_eq!(
        reopened.snapshot().unwrap().external_connection_checks["copilot"].checked_at,
        check.checked_at
    );
    reopened
        .save_external_connection_check(&config, status("authRequired"))
        .unwrap();
    assert_eq!(
        Store::open(f.store.path())
            .unwrap()
            .snapshot()
            .unwrap()
            .external_connection_checks["copilot"]
            .status
            .state,
        "authRequired"
    );
    let mut changed = config.clone();
    changed.args.push("--changed".into());
    reopened.set_agent(changed.clone()).unwrap();
    assert!(
        reopened
            .snapshot()
            .unwrap()
            .external_connection_checks
            .is_empty()
    );
    reopened
        .save_external_connection_check(&config, status("ready"))
        .unwrap();
    assert!(
        reopened
            .snapshot()
            .unwrap()
            .external_connection_checks
            .is_empty()
    );
    reopened
        .save_external_connection_check(&changed, status("ready"))
        .unwrap();
    changed.command = "another-cli".into();
    reopened.set_agent(changed).unwrap();
    assert!(
        reopened
            .snapshot()
            .unwrap()
            .external_connection_checks
            .is_empty()
    );
    reopened.set_agent(config).unwrap();
    assert!(
        reopened
            .snapshot()
            .unwrap()
            .external_connection_checks
            .is_empty()
    );
}
