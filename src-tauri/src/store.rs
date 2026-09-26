use crate::model::*;
mod cards;
mod conversations;
mod discussion;
mod project;
mod proposals;
#[cfg(test)]
mod tests;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Serialize, de::DeserializeOwned};
use std::{
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("保存先にアクセスできません: {0}")]
    Io(#[from] std::io::Error),
    #[error("保存に失敗しました: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("データを読み取れません: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Invalid(String),
}
pub type Result<T> = std::result::Result<T, StoreError>;

#[derive(Clone)]
pub struct Store {
    path: PathBuf,
}

fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
        * 1000.0
}
fn invalid(message: &str) -> StoreError {
    StoreError::Invalid(message.into())
}
fn check_text(title: &str, body: &str) -> Result<()> {
    if title.trim().is_empty() || title.chars().count() > 200 || body.len() > 100_000 {
        return Err(invalid(
            "タイトルは1〜200文字、本文は100KB以内にしてください。",
        ));
    }
    Ok(())
}
fn get<T: DeserializeOwned>(db: &Connection, kind: &str, id: &str) -> Result<T> {
    let value: String = db
        .query_row(
            "SELECT data FROM records WHERE kind=?1 AND id=?2",
            params![kind, id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| invalid("対象が見つかりません。再読み込みしてください。"))?;
    Ok(serde_json::from_str(&value)?)
}
fn put<T: Serialize>(db: &Connection, kind: &str, id: &str, value: &T) -> Result<()> {
    db.execute("INSERT INTO records(kind,id,data) VALUES (?1,?2,?3) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data", params![kind,id,serde_json::to_string(value)?])?;
    Ok(())
}
fn list<T: DeserializeOwned>(db: &Connection, kind: &str) -> Result<Vec<T>> {
    let mut statement = db.prepare("SELECT data FROM records WHERE kind=?1 ORDER BY rowid")?;
    let rows = statement.query_map([kind], |r| r.get::<_, String>(0))?;
    rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
}
fn id(db: &Connection) -> Result<String> {
    Ok(db.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?)
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let store = Self {
            path: path.as_ref().to_owned(),
        };
        let db = store.connect()?;
        db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id)); PRAGMA user_version=1;")?;
        let project = Project {
            id: id(&db)?,
            name: "マイプロジェクト".into(),
            memory: String::new(),
            revision: 1,
        };
        db.execute(
            "INSERT OR IGNORE INTO records(kind,id,data) VALUES ('project','current',?1)",
            [serde_json::to_string(&project)?],
        )?;
        Ok(store)
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
    fn connect(&self) -> Result<Connection> {
        let db = Connection::open(&self.path)?;
        db.busy_timeout(Duration::from_secs(5))?;
        Ok(db)
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        let mut db = self.connect()?;
        let tx = db.transaction()?;
        let snapshot = Snapshot {
            project: get(&tx, "project", "current")?,
            projects: vec![],
            memory_proposals: list(&tx, "memoryProposal")?,
            cards: list(&tx, "card")?,
            proposals: list(&tx, "proposal")?,
            conversations: list(&tx, "conversation")?,
            messages: list(&tx, "message")?,
            discussions: list(&tx, "discussion")?,
            agents: list(&tx, "agent")?,
            chat_settings: list(&tx, "chatSettings")?.pop().unwrap_or_default(),
            consents: vec![],
        };
        tx.commit()?;
        Ok(snapshot)
    }
    pub fn set_agent(&self, config: AgentConfig) -> Result<()> {
        if !["codex", "claude"].contains(&config.id.as_str()) || config.command.trim().is_empty() {
            return Err(invalid("起動設定が不正です。"));
        }
        put(&self.connect()?, "agent", &config.id, &config)
    }
    pub fn set_chat_settings(&self, settings: ChatSettings) -> Result<()> {
        if [&settings.model, &settings.reasoning_effort]
            .into_iter()
            .flatten()
            .any(|value| value.trim().is_empty() || value.len() > 200)
        {
            return Err(invalid(
                "モデルと推論強度は1〜200バイトで指定してください。",
            ));
        }
        put(&self.connect()?, "chatSettings", "codex", &settings)
    }
}
