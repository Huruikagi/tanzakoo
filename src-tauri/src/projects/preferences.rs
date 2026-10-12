//! App-wide preferences share the catalog database, independent of project contents.
//! Keep the existing Projects API and persisted keys so callers and saved data stay compatible.
use super::Projects;
use crate::store::Result;
use rusqlite::{Connection, OptionalExtension};

impl Projects {
    pub(super) fn consented_agents(&self, db: &Connection) -> Result<Vec<String>> {
        let mut query = db.prepare(
            "SELECT substr(key,9) FROM preferences WHERE key LIKE 'consent:%' ORDER BY key",
        )?;
        let mut agents = Vec::new();
        for row in query.query_map([], |r| r.get::<_, String>(0))? {
            let agent = row?;
            if self.consented(&agent)? {
                agents.push(agent);
            }
        }
        Ok(agents)
    }
    pub fn consented(&self, agent: &str) -> Result<bool> {
        let stored: Option<String> = self
            .catalog()?
            .query_row(
                "SELECT value FROM preferences WHERE key=?1",
                [format!("consent:{agent}")],
                |r| r.get(0),
            )
            .optional()?;
        Ok(stored.is_some_and(|value| {
            self.consent_value(agent)
                .is_ok_and(|expected| value == expected)
        }))
    }
    /// Only the registration ID is stored here; credentials stay in the plan helper.
    pub fn last_plan_account(&self) -> Result<Option<String>> {
        Ok(self
            .catalog()?
            .query_row(
                "SELECT value FROM preferences WHERE key='chatgpt-plan-account'",
                [],
                |r| r.get(0),
            )
            .optional()?)
    }
    pub fn set_last_plan_account(&self, id: &str) -> Result<()> {
        self.catalog()?.execute(
            "INSERT OR REPLACE INTO preferences(key,value) VALUES ('chatgpt-plan-account',?1)",
            [id],
        )?;
        Ok(())
    }
    pub fn notification_mode(&self) -> Result<crate::desktop_notifications::NotificationMode> {
        let value: Option<String> = self
            .catalog()?
            .query_row(
                "SELECT value FROM preferences WHERE key='notification-mode'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        Ok(value
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_default())
    }
    pub fn set_notification_mode(
        &self,
        mode: crate::desktop_notifications::NotificationMode,
    ) -> Result<()> {
        self.catalog()?.execute(
            "INSERT OR REPLACE INTO preferences(key,value) VALUES ('notification-mode',?1)",
            [serde_json::to_string(&mode)?],
        )?;
        Ok(())
    }
    fn consent_value(&self, agent: &str) -> Result<String> {
        if crate::external_agents::is_external(agent) {
            let config = self
                .active_store()?
                .snapshot()?
                .agents
                .into_iter()
                .find(|a| a.id == agent)
                .unwrap_or_else(|| crate::external_agents::default_config(agent));
            return Ok(serde_json::to_string(&config)?);
        }
        Ok("1".into())
    }
    pub fn set_consent(&self, agent: &str, granted: bool) -> Result<()> {
        let key = format!("consent:{agent}");
        let db = self.catalog()?;
        if granted {
            db.execute(
                "INSERT OR REPLACE INTO preferences(key,value) VALUES (?1,?2)",
                [key, self.consent_value(agent)?],
            )?;
        } else {
            db.execute("DELETE FROM preferences WHERE key=?1", [key])?;
        }
        Ok(())
    }
}
