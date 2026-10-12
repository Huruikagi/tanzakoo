use super::*;
use std::collections::BTreeMap;

impl Store {
    pub(super) fn external_connection_checks(
        &self,
        db: &Connection,
    ) -> Result<BTreeMap<String, ExternalConnectionCheck>> {
        if !crate::external_agents::available() {
            return Ok(BTreeMap::new());
        }
        let agents = list::<AgentConfig>(db, "agent")?;
        Ok(keyed::<ExternalConnectionCheck>(db, "connectionCheck")?
            .into_iter()
            .filter(|(id, check)| {
                crate::external_agents::is_external(id)
                    && same_launch(
                        &check.config,
                        &agents
                            .iter()
                            .find(|a| a.id == *id)
                            .cloned()
                            .unwrap_or_else(|| crate::external_agents::default_config(id)),
                    )
            })
            .collect())
    }

    /// Save only completed checks for the launch that actually ran. Cancellation
    /// and results from an obsolete launch must not replace a useful check.
    pub fn save_external_connection_check(
        &self,
        config: &AgentConfig,
        status: ConnectionStatus,
    ) -> Result<()> {
        if !crate::external_agents::is_external(&config.id) || status.state == "unknown" {
            return Ok(());
        }
        let mut db = self.connect()?;
        let tx = db.transaction()?;
        let current = list::<AgentConfig>(&tx, "agent")?
            .into_iter()
            .find(|a| a.id == config.id)
            .unwrap_or_else(|| crate::external_agents::default_config(&config.id));
        if same_launch(config, &current) {
            put(
                &tx,
                "connectionCheck",
                &config.id,
                &ExternalConnectionCheck {
                    config: config.clone(),
                    status,
                    checked_at: now(),
                },
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

fn same_launch(a: &AgentConfig, b: &AgentConfig) -> bool {
    a.id == b.id && a.command == b.command && a.args == b.args
}
