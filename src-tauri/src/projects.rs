use crate::{
    model::*,
    store::{Result, Store, StoreError},
};
use rusqlite::{Connection, OptionalExtension, params};
use std::{path::PathBuf, time::Duration};

// The catalog stores locators only. Each project's content lives in its own database.
pub struct Projects {
    root: PathBuf,
    active: String,
}
impl Projects {
    pub fn open(root: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&root)?;
        let mut projects = Self {
            root,
            active: String::new(),
        };
        let mut db = projects.catalog()?;
        db.execute_batch("CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, path TEXT NOT NULL); CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY, value TEXT NOT NULL);")?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if tx.query_row("SELECT count(*) FROM projects", [], |r| r.get::<_, i64>(0))? == 0 {
            // Keep the legacy DB and agent working directory in place, including saved ACP sessions.
            let store = Store::open(projects.root.join("tanzakoo.db"))?;
            let p = store.project()?;
            tx.execute(
                "INSERT INTO projects(id,path) VALUES (?1,'tanzakoo.db')",
                [&p.id],
            )?;
            tx.execute(
                "INSERT OR REPLACE INTO preferences(key,value) VALUES ('active',?1)",
                [&p.id],
            )?;
        }
        projects.active = tx.query_row(
            "SELECT value FROM preferences WHERE key='active'",
            [],
            |r| r.get(0),
        )?;
        tx.commit()?;
        projects.store(&projects.active)?;
        Ok(projects)
    }
    fn catalog(&self) -> Result<Connection> {
        let db = Connection::open(self.root.join("projects.db"))?;
        db.busy_timeout(Duration::from_secs(5))?;
        Ok(db)
    }
    pub fn active_store(&self) -> Result<Store> {
        self.store(&self.active)
    }
    pub fn require_active(&self, id: &str) -> Result<Store> {
        if id != self.active {
            return Err(StoreError::Invalid(
                "プロジェクトが切り替わっています。画面を読み直してください。".into(),
            ));
        }
        self.store(id)
    }
    fn store(&self, id: &str) -> Result<Store> {
        let path: String = self
            .catalog()?
            .query_row("SELECT path FROM projects WHERE id=?1", [id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| StoreError::Invalid("プロジェクトが見つかりません。".into()))?;
        let full = self.root.join(path);
        // A missing project must be reported, never silently replaced by an empty DB.
        if !full.is_file() {
            return Err(StoreError::Invalid(
                "プロジェクトのDBが見つかりません。".into(),
            ));
        }
        let store = Store::open(full)?;
        if store.project()?.id != id {
            return Err(StoreError::Invalid(
                "プロジェクトのDBが一致しません。".into(),
            ));
        }
        Ok(store)
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        let mut snapshot = self.active_store()?.snapshot()?;
        let db = self.catalog()?;
        let mut query = db.prepare("SELECT id FROM projects ORDER BY rowid")?;
        for row in query.query_map([], |r| r.get::<_, String>(0))? {
            let p = self.store(&row?)?.project()?;
            snapshot.projects.push(ProjectSummary {
                id: p.id,
                name: p.name,
            });
        }
        Ok(snapshot)
    }
    pub fn switch(&mut self, id: &str) -> Result<()> {
        self.store(id)?;
        self.catalog()?
            .execute("UPDATE preferences SET value=?1 WHERE key='active'", [id])?;
        self.active = id.into();
        Ok(())
    }
    pub fn create(&mut self, name: String, memory: String) -> Result<()> {
        if name.trim().is_empty() || name.chars().count() > 200 || memory.len() > 100_000 {
            return Err(StoreError::Invalid(
                "名前は1〜200文字、メモリは100KB以内にしてください。".into(),
            ));
        }
        let db = self.catalog()?;
        let folder: String = db.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
        let relative = format!("projects/{folder}/tanzakoo.db");
        let path = self.root.join(&relative);
        std::fs::create_dir_all(path.parent().expect("project directory"))?;
        let store = Store::open(path)?;
        store.update_project(name, memory, 1)?;
        // Connection settings start from the current project, then remain independently editable.
        for config in self.active_store()?.snapshot()?.agents {
            store.set_agent(config)?;
        }
        let p = store.project()?;
        db.execute(
            "INSERT INTO projects(id,path) VALUES (?1,?2)",
            params![p.id, relative],
        )?;
        self.switch(&p.id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_data_is_retained_and_projects_are_isolated_after_reopen() {
        let root =
            std::env::temp_dir().join(format!("tanzakoo-project-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let old = Store::open(root.join("tanzakoo.db")).unwrap();
        old.create_card("Aのカード".into(), "Aの秘密".into(), "user")
            .unwrap();
        let conversation = old.create_conversation("codex").unwrap();
        old.save_session(&conversation.id, "old-session".into())
            .unwrap();
        let mut projects = Projects::open(root.clone()).unwrap();
        let a = projects.snapshot().unwrap().project.id;
        projects.create("アプリB".into(), "Bの前提".into()).unwrap();
        let b = projects.snapshot().unwrap();
        assert_eq!(b.project.memory, "Bの前提");
        assert!(b.cards.is_empty() && b.conversations.is_empty());
        assert!(projects.require_active(&a).is_err());
        let mut projects = Projects::open(root.clone()).unwrap();
        assert_eq!(projects.snapshot().unwrap().project.id, b.project.id);
        projects.switch(&a).unwrap();
        let snapshot = projects.snapshot().unwrap();
        assert_eq!(snapshot.cards.len(), 1);
        assert_eq!(
            snapshot.conversations[0].session_id.as_deref(),
            Some("old-session")
        );
        assert_eq!(snapshot.projects.len(), 2);
        assert!(snapshot.project.memory.is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
}
