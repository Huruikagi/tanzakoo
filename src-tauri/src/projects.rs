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
        db.execute_batch("CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, path TEXT NOT NULL); CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS pending_deletions(path TEXT PRIMARY KEY);")?;
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
        // Retry interrupted file cleanup without ever adding deleted projects back to the catalog.
        if let Err(error) = projects.cleanup_deleted() {
            tracing::warn!(%error, "Deleted project files could not be removed");
        }
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
        let mut query = db.prepare(
            "SELECT substr(key,9) FROM preferences WHERE key LIKE 'consent:%' ORDER BY key",
        )?;
        for row in query.query_map([], |r| r.get::<_, String>(0))? {
            snapshot.consents.push(row?);
        }
        Ok(snapshot)
    }
    pub fn consented(&self, agent: &str) -> Result<bool> {
        Ok(self
            .catalog()?
            .query_row(
                "SELECT 1 FROM preferences WHERE key=?1",
                [format!("consent:{agent}")],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }
    pub fn set_consent(&self, agent: &str, granted: bool) -> Result<()> {
        let key = format!("consent:{agent}");
        let db = self.catalog()?;
        if granted {
            db.execute(
                "INSERT OR REPLACE INTO preferences(key,value) VALUES (?1,'1')",
                [key],
            )?;
        } else {
            db.execute("DELETE FROM preferences WHERE key=?1", [key])?;
        }
        Ok(())
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

    /// Remove only the currently displayed project. Catalog removal and the next selection
    /// commit together; file cleanup is durable and can be retried after a crash or file lock.
    pub fn delete(&mut self, id: &str) -> Result<Option<String>> {
        let store = self.require_active(id)?;
        let mut db = self.catalog()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let path: String =
            tx.query_row("SELECT path FROM projects WHERE id=?1", [id], |r| r.get(0))?;
        self.deletion_targets(&path)?;
        let next: Option<String> = tx
            .query_row(
                "SELECT id FROM projects WHERE id<>?1 ORDER BY rowid LIMIT 1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        let next = if let Some(next) = next {
            self.store(&next)?;
            next
        } else {
            let folder: String =
                tx.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
            let relative = format!("projects/{folder}/tanzakoo.db");
            let full = self.root.join(&relative);
            std::fs::create_dir_all(full.parent().expect("project directory"))?;
            let replacement = Store::open(full)?;
            for config in store.snapshot()?.agents {
                replacement.set_agent(config)?;
            }
            let next = replacement.project()?.id;
            tx.execute(
                "INSERT INTO projects(id,path) VALUES (?1,?2)",
                params![next, relative],
            )?;
            next
        };
        tx.execute("INSERT INTO pending_deletions(path) VALUES (?1)", [&path])?;
        tx.execute("DELETE FROM projects WHERE id=?1", [id])?;
        tx.execute(
            "UPDATE preferences SET value=?1 WHERE key='active'",
            [&next],
        )?;
        tx.commit()?;
        self.active = next;
        Ok(self.cleanup_deleted().err().map(|error| format!(
            "プロジェクトは削除しましたが、保存ファイルの一部を消去できませんでした。次回起動時に再試行します。{error}"
        )))
    }

    fn deletion_targets(&self, relative: &str) -> Result<Vec<PathBuf>> {
        // Legacy projects share the app root with the catalog and sign-in data.
        let targets = if relative == "tanzakoo.db" {
            vec![
                "tanzakoo.db".into(),
                "tanzakoo.db-wal".into(),
                "tanzakoo.db-shm".into(),
                "agent-workspace".into(),
            ]
        } else {
            let parts: Vec<_> = relative.split('/').collect();
            if parts.len() != 3
                || parts[0] != "projects"
                || parts[2] != "tanzakoo.db"
                || parts[1].len() != 32
                || !parts[1].bytes().all(|c| c.is_ascii_hexdigit())
            {
                return Err(StoreError::Invalid(
                    "プロジェクトの保存先が不正なため削除できません。".into(),
                ));
            }
            vec![PathBuf::from("projects").join(parts[1])]
        };
        let root = self.root.canonicalize()?;
        let mut result = Vec::new();
        for target in targets {
            let full = root.join(target);
            // Reject links/junctions at each boundary, including the projects directory.
            let mut parent = full.as_path();
            while parent != root {
                match std::fs::symlink_metadata(parent) {
                    Ok(metadata) if is_link(&metadata) => {
                        return Err(StoreError::Invalid(
                            "プロジェクトの保存先がリンクのため削除できません。".into(),
                        ));
                    }
                    Ok(_) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error.into()),
                }
                parent = parent
                    .parent()
                    .ok_or_else(|| StoreError::Invalid("保存先が不正です。".into()))?;
            }
            if full.exists() && !full.canonicalize()?.starts_with(&root) {
                return Err(StoreError::Invalid(
                    "保存先がアプリのデータ領域外です。".into(),
                ));
            }
            result.push(full);
        }
        Ok(result)
    }

    fn cleanup_deleted(&self) -> Result<()> {
        let db = self.catalog()?;
        let paths = db
            .prepare("SELECT path FROM pending_deletions")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for path in paths {
            for target in self.deletion_targets(&path)? {
                let result = if target.is_dir() {
                    std::fs::remove_dir_all(&target)
                } else {
                    std::fs::remove_file(&target)
                };
                if let Err(error) = result
                    && error.kind() != std::io::ErrorKind::NotFound
                {
                    return Err(error.into());
                }
            }
            db.execute("DELETE FROM pending_deletions WHERE path=?1", [&path])?;
        }
        Ok(())
    }
}

fn is_link(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0 // FILE_ATTRIBUTE_REPARSE_POINT
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn deletion_fixture(name: &str) -> (PathBuf, Projects) {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "tanzakoo-delete-{name}-{}-{nonce}",
            std::process::id()
        ));
        let projects = Projects::open(root.clone()).unwrap();
        (root, projects)
    }

    #[test]
    fn deletes_project_files_and_keeps_other_projects_after_reopen() {
        let (root, mut projects) = deletion_fixture("isolated");
        let a = projects.snapshot().unwrap().project.id;
        projects
            .active_store()
            .unwrap()
            .create_card("残す".into(), "A".into(), "user")
            .unwrap();
        projects
            .create("削除対象".into(), "Bの前提".into())
            .unwrap();
        let b = projects.snapshot().unwrap().project.id;
        let folder = projects
            .active_store()
            .unwrap()
            .path()
            .parent()
            .unwrap()
            .to_owned();
        std::fs::create_dir_all(folder.join("agent-workspace")).unwrap();
        std::fs::write(folder.join("agent-workspace/note.txt"), "private").unwrap();
        assert!(projects.delete(&b).unwrap().is_none());
        assert!(!folder.exists());
        let projects = Projects::open(root.clone()).unwrap();
        let snapshot = projects.snapshot().unwrap();
        assert_eq!(snapshot.project.id, a);
        assert_eq!(snapshot.projects.len(), 1);
        assert_eq!(snapshot.cards[0].title, "残す");
        assert!(projects.store(&b).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deleting_last_legacy_project_creates_empty_project_and_preserves_app_settings() {
        let (root, mut projects) = deletion_fixture("legacy");
        let a = projects.snapshot().unwrap().project.id;
        let store = projects.active_store().unwrap();
        store
            .create_card("消す".into(), "内容".into(), "user")
            .unwrap();
        store.create_conversation("codex").unwrap();
        store
            .set_agent(AgentConfig {
                id: "codex".into(),
                command: "test-agent".into(),
                args: vec![],
            })
            .unwrap();
        projects.set_consent("codex", true).unwrap();
        std::fs::create_dir_all(root.join("agent-workspace")).unwrap();
        std::fs::write(root.join("agent-workspace/secret"), "private").unwrap();
        std::fs::create_dir_all(root.join("codex-home")).unwrap();
        std::fs::write(root.join("codex-home/auth.json"), "keep").unwrap();
        assert!(projects.delete(&a).unwrap().is_none());
        assert!(!root.join("tanzakoo.db").exists());
        assert!(!root.join("agent-workspace").exists());
        assert_eq!(
            std::fs::read_to_string(root.join("codex-home/auth.json")).unwrap(),
            "keep"
        );
        let projects = Projects::open(root.clone()).unwrap();
        let snapshot = projects.snapshot().unwrap();
        assert_ne!(snapshot.project.id, a);
        assert_eq!(snapshot.projects.len(), 1);
        assert!(
            snapshot.cards.is_empty()
                && snapshot.conversations.is_empty()
                && snapshot.project.memory.is_empty()
        );
        assert_eq!(snapshot.agents[0].command, "test-agent");
        assert!(projects.consented("codex").unwrap());
        assert!(projects.store(&a).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stale_ids_and_failed_catalog_commit_do_not_delete_data() {
        let (root, mut projects) = deletion_fixture("failure");
        let a = projects.snapshot().unwrap().project.id;
        projects.create("B".into(), String::new()).unwrap();
        let b = projects.snapshot().unwrap().project.id;
        let path = projects.active_store().unwrap().path().to_owned();
        assert!(projects.delete(&a).is_err());
        assert!(projects.delete("missing").is_err());
        projects.catalog().unwrap().execute_batch(
            "CREATE TRIGGER prevent_delete BEFORE DELETE ON projects BEGIN SELECT RAISE(ABORT, 'test failure'); END;"
        ).unwrap();
        assert!(projects.delete(&b).is_err());
        assert!(path.exists());
        assert_eq!(projects.snapshot().unwrap().project.id, b);
        let reopened = Projects::open(root.clone()).unwrap();
        assert_eq!(reopened.snapshot().unwrap().projects.len(), 2);
        assert_eq!(reopened.snapshot().unwrap().project.id, b);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn interrupted_cleanup_is_retried_without_restoring_the_deleted_project() {
        let (root, mut projects) = deletion_fixture("retry");
        let a = projects.snapshot().unwrap().project.id;
        projects.create("B".into(), String::new()).unwrap();
        // Simulate interruption after the catalog commit but before legacy file cleanup.
        let db = projects.catalog().unwrap();
        db.execute("DELETE FROM projects WHERE id=?1", [&a])
            .unwrap();
        db.execute(
            "INSERT INTO pending_deletions(path) VALUES ('tanzakoo.db')",
            [],
        )
        .unwrap();
        drop(db);
        let projects = Projects::open(root.clone()).unwrap();
        assert!(!root.join("tanzakoo.db").exists());
        assert_eq!(projects.snapshot().unwrap().projects.len(), 1);
        assert_eq!(projects.snapshot().unwrap().project.name, "B");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleanup_rejects_paths_outside_managed_project_storage() {
        let (root, projects) = deletion_fixture("paths");
        for path in [
            "../tanzakoo.db",
            "projects/../tanzakoo.db",
            "projects.db",
            "C:/outside/tanzakoo.db",
            "projects/no/tanzakoo.db",
        ] {
            assert!(projects.deletion_targets(path).is_err(), "{path}");
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn locked_files_report_a_warning_and_are_cleaned_up_on_reopen() {
        use std::os::windows::fs::OpenOptionsExt;
        let (root, mut projects) = deletion_fixture("locked");
        projects.create("B".into(), String::new()).unwrap();
        let b = projects.snapshot().unwrap().project.id;
        let path = projects.active_store().unwrap().path().to_owned();
        let locked = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(3)
            .open(&path)
            .unwrap();
        let warning = projects.delete(&b).unwrap().unwrap();
        assert!(warning.contains("次回起動時に再試行"));
        assert!(path.exists());
        assert!(projects.store(&b).is_err());
        drop(locked);
        let projects = Projects::open(root.clone()).unwrap();
        assert!(!path.exists());
        assert_eq!(projects.snapshot().unwrap().projects.len(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }
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
    #[test]
    fn consent_is_app_wide_and_survives_reopen() {
        let root =
            std::env::temp_dir().join(format!("tanzakoo-consent-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let mut projects = Projects::open(root.clone()).unwrap();
        assert!(!projects.consented("codex").unwrap());
        projects.set_consent("codex", true).unwrap();
        projects.create("アプリB".into(), String::new()).unwrap();
        let projects = Projects::open(root.clone()).unwrap();
        assert!(projects.consented("codex").unwrap());
        assert_eq!(projects.snapshot().unwrap().consents, vec!["codex"]);
        projects.set_consent("codex", false).unwrap();
        assert!(!projects.consented("codex").unwrap());
        assert!(projects.snapshot().unwrap().consents.is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
}
