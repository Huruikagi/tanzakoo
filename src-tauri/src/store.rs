use crate::model::*;
mod discussion;
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
    pub fn create_card(&self, title: String, body: String, source: &str) -> Result<Card> {
        check_text(&title, &body)?;
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let cards: Vec<Card> = list(&tx, "card")?;
        // Repeated tool retries must not fill the idea pile with identical cards.
        if let Some(card) = cards
            .iter()
            .find(|c| !c.deleted && c.title == title.trim() && c.body == body)
        {
            return Ok(card.clone());
        }
        let card = Card {
            id: id(&tx)?,
            title: title.trim().into(),
            body,
            status: CardStatus::Idea,
            revision: 1,
            position: cards.iter().map(|c| c.position).fold(0.0, f64::max) + 1.0,
            source: source.into(),
            deleted: false,
            created_at: now(),
            updated_at: now(),
        };
        put(&tx, "card", &card.id, &card)?;
        tx.commit()?;
        Ok(card)
    }
    pub fn project(&self) -> Result<Project> {
        get(&self.connect()?, "project", "current")
    }
    pub fn update_project(&self, name: String, memory: String, revision: u32) -> Result<()> {
        check_text(&name, &memory)?;
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut project: Project = get(&tx, "project", "current")?;
        if project.revision != revision {
            return Err(invalid(
                "プロジェクトメモリが更新されています。最新の内容を確認してください。",
            ));
        }
        project.name = name.trim().into();
        project.memory = memory;
        project.revision += 1;
        put(&tx, "project", "current", &project)?;
        tx.commit()?;
        Ok(())
    }
    pub fn propose_memory(
        &self,
        revision: u32,
        memory: String,
        reason: String,
    ) -> Result<MemoryProposal> {
        check_text("memory", &memory)?;
        if reason.trim().is_empty() || reason.len() > 10_000 {
            return Err(invalid("変更理由を1〜10000バイトで指定してください。"));
        }
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let project: Project = get(&tx, "project", "current")?;
        if project.revision != revision {
            return Err(invalid(
                "プロジェクトメモリが更新されています。読み直してください。",
            ));
        }
        let proposals: Vec<MemoryProposal> = list(&tx, "memoryProposal")?;
        if let Some(p) = proposals
            .into_iter()
            .find(|p| p.state == "pending" && p.base_revision == revision && p.memory == memory)
        {
            return Ok(p);
        }
        let p = MemoryProposal {
            id: id(&tx)?,
            base_revision: revision,
            before_memory: project.memory,
            memory,
            reason,
            state: "pending".into(),
        };
        put(&tx, "memoryProposal", &p.id, &p)?;
        tx.commit()?;
        Ok(p)
    }
    pub fn resolve_memory(&self, id: &str, apply: bool) -> Result<()> {
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut p: MemoryProposal = get(&tx, "memoryProposal", id)?;
        if p.state != "pending" {
            return Err(invalid("この提案は処理済みです。"));
        }
        if apply {
            let mut project: Project = get(&tx, "project", "current")?;
            if project.revision != p.base_revision {
                return Err(invalid(
                    "提案後にメモリが変わっています。再提案を依頼してください。",
                ));
            }
            project.memory = p.memory.clone();
            project.revision += 1;
            put(&tx, "project", "current", &project)?;
        }
        p.state = if apply { "applied" } else { "rejected" }.into();
        put(&tx, "memoryProposal", id, &p)?;
        tx.commit()?;
        Ok(())
    }
    pub fn update_card(&self, change: Card) -> Result<Card> {
        let Card {
            id,
            revision,
            title,
            body,
            status,
            position,
            deleted,
            ..
        } = change;
        check_text(&title, &body)?;
        if !position.is_finite() {
            return Err(invalid("並び順が不正です。"));
        }
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut card: Card = get(&tx, "card", &id)?;
        if card.revision != revision {
            return Err(invalid(
                "カードが更新されています。最新の内容を確認してください。",
            ));
        }
        discussion::on_manual_change(&tx, &card, &status, deleted)?;
        card.title = title.trim().into();
        card.body = body;
        card.status = status;
        card.position = position;
        card.deleted = deleted;
        card.revision += 1;
        card.updated_at = now();
        put(&tx, "card", &id, &card)?;
        tx.commit()?;
        Ok(card)
    }
    pub fn propose(
        &self,
        card_id: &str,
        revision: u32,
        title: String,
        body: String,
        reason: String,
    ) -> Result<Proposal> {
        check_text(&title, &body)?;
        if reason.trim().is_empty() || reason.len() > 10_000 {
            return Err(invalid("変更理由を1〜10000バイトで指定してください。"));
        }
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let card: Card = get(&tx, "card", card_id)?;
        if card.deleted || card.revision != revision {
            return Err(invalid(
                "対象カードが削除または更新されています。ボードを読み直してください。",
            ));
        }
        let proposals: Vec<Proposal> = list(&tx, "proposal")?;
        if let Some(p) = proposals.iter().find(|p| {
            p.state == "pending"
                && p.card_id == card_id
                && p.base_revision == revision
                && p.title == title
                && p.body == body
                && p.reason == reason
        }) {
            return Ok(p.clone());
        }
        for mut previous in proposals
            .into_iter()
            .filter(|p| p.state == "pending" && p.card_id == card_id)
        {
            previous.state = "superseded".into();
            put(&tx, "proposal", &previous.id, &previous)?;
        }
        let p = Proposal {
            id: id(&tx)?,
            card_id: card_id.into(),
            base_revision: revision,
            before_title: card.title,
            before_body: card.body,
            title,
            body,
            reason,
            state: "pending".into(),
            created_at: now(),
        };
        put(&tx, "proposal", &p.id, &p)?;
        tx.commit()?;
        Ok(p)
    }
    pub fn resolve(&self, id: &str, apply: bool) -> Result<()> {
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        resolve_proposal(&tx, id, apply)?;
        tx.commit()?;
        Ok(())
    }
    /// Apply exactly the proposals the user saw, atomically. A replaced or stale proposal
    /// rolls back the entire batch, including cards processed earlier in the request.
    pub fn apply_proposals(&self, ids: &[String]) -> Result<()> {
        if ids.is_empty() {
            return Err(invalid("承認する提案を指定してください。"));
        }
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        for id in ids {
            resolve_proposal(&tx, id, true)?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn create_conversation(&self, agent: &str) -> Result<Conversation> {
        if !["codex", "claude"].contains(&agent) {
            return Err(invalid("エージェントが不正です。"));
        }
        let db = self.connect()?;
        let c = Conversation {
            id: id(&db)?,
            title: "新しい壁打ち".into(),
            agent: agent.into(),
            session_id: None,
            created_at: now(),
        };
        put(&db, "conversation", &c.id, &c)?;
        Ok(c)
    }
    pub fn conversation(&self, id: &str) -> Result<Conversation> {
        get(&self.connect()?, "conversation", id)
    }
    pub fn save_session(&self, id: &str, session_id: String) -> Result<()> {
        let db = self.connect()?;
        let mut c: Conversation = get(&db, "conversation", id)?;
        c.session_id = Some(session_id);
        put(&db, "conversation", id, &c)
    }
    pub fn append_message(
        &self,
        conversation_id: &str,
        role: &str,
        text: String,
        references: Vec<CardReference>,
    ) -> Result<Message> {
        if !["user", "assistant", "error"].contains(&role) || text.len() > 1_000_000 {
            return Err(invalid("メッセージが不正です。"));
        }
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut c: Conversation = get(&tx, "conversation", conversation_id)?;
        if role == "user" && c.title == "新しい壁打ち" {
            c.title = text.chars().take(40).collect();
            put(&tx, "conversation", &c.id, &c)?;
        }
        let m = Message {
            id: id(&tx)?,
            conversation_id: conversation_id.into(),
            role: role.into(),
            text,
            references,
            created_at: now(),
        };
        put(&tx, "message", &m.id, &m)?;
        tx.commit()?;
        Ok(m)
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

fn resolve_proposal(tx: &rusqlite::Transaction<'_>, id: &str, apply: bool) -> Result<()> {
    let mut p: Proposal = get(tx, "proposal", id)?;
    if p.state == "superseded" {
        return Err(invalid(
            "この提案は新しい提案に置き換わっています。最新の提案を確認してください。",
        ));
    }
    if p.state != "pending" {
        return Err(invalid("この提案は処理済みです。"));
    }
    if apply {
        let mut card: Card = get(tx, "card", &p.card_id)?;
        if card.deleted || card.revision != p.base_revision {
            return Err(invalid(
                "提案後にカードが変わっています。再提案を依頼してください。",
            ));
        }
        card.title = p.title.clone();
        card.body = p.body.clone();
        card.revision += 1;
        card.updated_at = now();
        put(tx, "card", &card.id, &card)?;
    }
    p.state = if apply { "applied" } else { "rejected" }.into();
    put(tx, "proposal", id, &p)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        store: Store,
        dir: PathBuf,
    }
    static NEXT_FIXTURE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    impl Fixture {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "tanzakoo-test-{}-{}-{}",
                std::process::id(),
                now(),
                NEXT_FIXTURE.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self {
                store: Store::open(dir.join("board.db")).unwrap(),
                dir,
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }
    fn discussion_fixture(status: CardStatus) -> (Fixture, Card, Conversation, Message) {
        let f = Fixture::new();
        let mut card = f
            .store
            .create_card("通知のタイミング".into(), "いつ通知する？".into(), "user")
            .unwrap();
        if status != card.status {
            card = f.store.update_card(Card { status, ..card }).unwrap();
        }
        let conversation = f.store.create_conversation("codex").unwrap();
        let message = f
            .store
            .append_message(&conversation.id, "user", "通知は朝に欲しい".into(), vec![])
            .unwrap();
        (f, card, conversation, message)
    }
    fn report(
        f: &Fixture,
        card: &Card,
        c: &Conversation,
        m: &Message,
        suggest: bool,
    ) -> Result<Option<Discussion>> {
        f.store.report_discussion(
            &c.id,
            &m.id,
            &card.id,
            card.revision,
            "通知の具体的な希望を話している".into(),
            suggest,
        )
    }
    #[test]
    fn discussion_move_and_undo_persist_without_changing_content_or_approving_proposals() {
        let (f, card, c, m) = discussion_fixture(CardStatus::Idea);
        let p = f
            .store
            .propose(
                &card.id,
                card.revision,
                card.title.clone(),
                "朝に通知する".into(),
                "希望を反映".into(),
            )
            .unwrap();
        let d = report(&f, &card, &c, &m, false).unwrap().unwrap();
        assert_eq!(d.state, DiscussionState::Moved);
        assert!(d.automatic);
        assert_eq!(report(&f, &card, &c, &m, false).unwrap().unwrap().id, d.id);
        let reopened = Store::open(f.store.path()).unwrap();
        let s = reopened.snapshot().unwrap();
        assert_eq!(s.discussions.len(), 1);
        assert_eq!(s.cards[0].status, CardStatus::Discuss);
        assert_eq!(s.cards[0].body, card.body);
        assert_eq!(s.proposals[0].state, "pending");
        assert_eq!(s.proposals[0].base_revision, s.cards[0].revision);
        reopened
            .resolve_discussion(&d.id, DiscussionResolution::Undo)
            .unwrap();
        let s = reopened.snapshot().unwrap();
        assert_eq!(s.cards[0].status, card.status);
        assert_eq!(s.cards[0].position, card.position);
        assert_eq!(s.discussions[0].state, DiscussionState::Undone);
        assert!(
            reopened
                .resolve_discussion(&d.id, DiscussionResolution::Undo)
                .is_err()
        );
        // Suppression survives restart and further user turns in this conversation.
        let next = reopened
            .append_message(&c.id, "user", "朝の通知の続き".into(), vec![])
            .unwrap();
        assert!(
            reopened
                .report_discussion(
                    &c.id,
                    &next.id,
                    &card.id,
                    s.cards[0].revision,
                    "続き".into(),
                    false
                )
                .is_err()
        );
        reopened.resolve(&p.id, true).unwrap();
        assert_eq!(reopened.snapshot().unwrap().cards[0].body, "朝に通知する");
        let other = reopened.create_conversation("codex").unwrap();
        let next = reopened
            .append_message(&other.id, "user", "通知を検討したい".into(), vec![])
            .unwrap();
        assert!(
            reopened
                .report_discussion(
                    &other.id,
                    &next.id,
                    &card.id,
                    reopened.snapshot().unwrap().cards[0].revision,
                    "新しい議論".into(),
                    false
                )
                .unwrap()
                .is_some()
        );
    }
    #[test]
    fn uncertain_and_decided_cards_require_an_explicit_ui_choice() {
        for (status, suggest) in [(CardStatus::Explore, true), (CardStatus::Decided, false)] {
            let (f, card, c, m) = discussion_fixture(status.clone());
            let d = report(&f, &card, &c, &m, suggest).unwrap().unwrap();
            assert_eq!(d.state, DiscussionState::Suggested);
            assert_eq!(f.store.snapshot().unwrap().cards[0].status, status);
            assert!(!d.automatic);
            f.store
                .resolve_discussion(&d.id, DiscussionResolution::Accept)
                .unwrap();
            assert_eq!(
                f.store.snapshot().unwrap().cards[0].status,
                CardStatus::Discuss
            );
            assert!(
                f.store
                    .resolve_discussion(&d.id, DiscussionResolution::Accept)
                    .is_err()
            );
            f.store
                .resolve_discussion(&d.id, DiscussionResolution::Undo)
                .unwrap();
            assert_eq!(f.store.snapshot().unwrap().cards[0].status, status);
        }
    }
    #[test]
    fn references_alone_do_not_move_cards_and_clear_followup_can_replace_a_suggestion() {
        let (f, card, c, _) = discussion_fixture(CardStatus::Explore);
        let m = f
            .store
            .append_message(
                &c.id,
                "user",
                "比較の参考です".into(),
                vec![CardReference {
                    card_id: card.id.clone(),
                    title: card.title.clone(),
                    revision: card.revision,
                    quote: String::new(),
                }],
            )
            .unwrap();
        assert_eq!(
            f.store.snapshot().unwrap().cards[0].status,
            CardStatus::Explore
        );
        assert!(f.store.snapshot().unwrap().discussions.is_empty());
        let suggested = report(&f, &card, &c, &m, true).unwrap().unwrap();
        let next = f
            .store
            .append_message(&c.id, "user", "このカードを掘り下げたい".into(), vec![])
            .unwrap();
        let moved = report(&f, &card, &c, &next, false).unwrap().unwrap();
        assert_eq!(moved.state, DiscussionState::Moved);
        let s = f.store.snapshot().unwrap();
        assert_eq!(
            s.discussions
                .iter()
                .find(|d| d.id == suggested.id)
                .unwrap()
                .state,
            DiscussionState::Superseded
        );
        // A topic change does not revert the card.
        f.store
            .append_message(&c.id, "user", "色の話に移ろう".into(), vec![])
            .unwrap();
        assert_eq!(
            f.store.snapshot().unwrap().cards[0].status,
            CardStatus::Discuss
        );
    }
    #[test]
    fn dismissal_and_manual_column_changes_stop_repeated_agent_moves() {
        let (f, card, c, m) = discussion_fixture(CardStatus::Idea);
        let d = report(&f, &card, &c, &m, true).unwrap().unwrap();
        f.store
            .resolve_discussion(&d.id, DiscussionResolution::Dismiss)
            .unwrap();
        assert!(report(&f, &card, &c, &m, false).is_err());
        assert!(report(&f, &card, &c, &m, true).is_err());
        let (f, card, c, m) = discussion_fixture(CardStatus::Idea);
        let d = report(&f, &card, &c, &m, false).unwrap().unwrap();
        let moved = f.store.snapshot().unwrap().cards[0].clone();
        let manual = f
            .store
            .update_card(Card {
                status: CardStatus::Explore,
                ..moved
            })
            .unwrap();
        assert!(report(&f, &manual, &c, &m, false).is_err());
        assert!(
            f.store
                .resolve_discussion(&d.id, DiscussionResolution::Undo)
                .is_err()
        );
        assert_eq!(
            f.store.snapshot().unwrap().cards[0].status,
            CardStatus::Explore
        );
    }
    #[test]
    fn stale_actions_cannot_overwrite_later_edits_or_deleted_cards() {
        let (f, card, c, m) = discussion_fixture(CardStatus::Idea);
        let d = report(&f, &card, &c, &m, false).unwrap().unwrap();
        let moved = f.store.snapshot().unwrap().cards[0].clone();
        f.store
            .update_card(Card {
                body: "手動で編集した本文".into(),
                ..moved
            })
            .unwrap();
        assert!(
            f.store
                .resolve_discussion(&d.id, DiscussionResolution::Undo)
                .is_err()
        );
        assert_eq!(
            f.store.snapshot().unwrap().cards[0].body,
            "手動で編集した本文"
        );
        let (f, card, c, m) = discussion_fixture(CardStatus::Decided);
        let d = report(&f, &card, &c, &m, false).unwrap().unwrap();
        let edited = f
            .store
            .update_card(Card {
                body: "新しい結論".into(),
                ..card.clone()
            })
            .unwrap();
        assert!(
            f.store
                .resolve_discussion(&d.id, DiscussionResolution::Accept)
                .is_err()
        );
        assert_eq!(
            f.store.snapshot().unwrap().cards[0].status,
            CardStatus::Decided
        );
        let deleted = f
            .store
            .update_card(Card {
                deleted: true,
                ..edited
            })
            .unwrap();
        assert!(report(&f, &deleted, &c, &m, false).is_err());
    }
    #[test]
    fn discussion_reports_validate_the_turn_and_card_revision() {
        let (f, card, c, m) = discussion_fixture(CardStatus::Idea);
        let other = f.store.create_conversation("codex").unwrap();
        assert!(report(&f, &card, &other, &m, false).is_err());
        let next = f
            .store
            .append_message(&c.id, "user", "別の発言".into(), vec![])
            .unwrap();
        assert!(report(&f, &card, &c, &m, false).is_err());
        let edited = f
            .store
            .update_card(Card {
                body: "更新済み".into(),
                ..card.clone()
            })
            .unwrap();
        assert!(report(&f, &card, &c, &next, false).is_err());
        assert!(f.store.snapshot().unwrap().discussions.is_empty());
        assert_eq!(
            report(&f, &edited, &c, &next, false)
                .unwrap()
                .unwrap()
                .state,
            DiscussionState::Moved
        );
    }
    #[test]
    fn batch_approval_is_atomic_and_survives_reopen() {
        for conflict in [
            "none",
            "outdated",
            "archived",
            "replaced",
            "resolved",
            "missing",
            "duplicate",
        ] {
            let f = Fixture::new();
            let first = f
                .store
                .create_card("通知".into(), "元の本文".into(), "user")
                .unwrap();
            let second = f
                .store
                .create_card("表示".into(), "元の本文".into(), "user")
                .unwrap();
            let a = f
                .store
                .propose(
                    &first.id,
                    1,
                    "通知案".into(),
                    "変更後".into(),
                    "理由".into(),
                )
                .unwrap();
            let b = f
                .store
                .propose(
                    &second.id,
                    1,
                    "表示案".into(),
                    "変更後".into(),
                    "理由".into(),
                )
                .unwrap();
            let mut ids = vec![a.id.clone(), b.id.clone()];
            match conflict {
                "outdated" => {
                    f.store
                        .update_card(Card {
                            body: "手動編集".into(),
                            ..second
                        })
                        .unwrap();
                }
                "archived" => {
                    f.store
                        .update_card(Card {
                            deleted: true,
                            ..second
                        })
                        .unwrap();
                }
                "replaced" => {
                    f.store
                        .propose(
                            &second.id,
                            1,
                            "最新の案".into(),
                            "新しい本文".into(),
                            "理由".into(),
                        )
                        .unwrap();
                }
                "resolved" => {
                    f.store.resolve(&b.id, false).unwrap();
                }
                "missing" => {
                    ids[1] = "missing".into();
                }
                "duplicate" => {
                    ids[1] = a.id.clone();
                }
                _ => {}
            }
            let before = serde_json::to_value(f.store.snapshot().unwrap()).unwrap();
            let result = f.store.apply_proposals(&ids);
            let reopened = Store::open(f.store.path()).unwrap();
            let snapshot = reopened.snapshot().unwrap();
            if conflict == "none" {
                result.unwrap();
                assert!(
                    snapshot
                        .cards
                        .iter()
                        .all(|c| c.body == "変更後" && c.revision == 2)
                );
                assert!(snapshot.proposals.iter().all(|p| p.state == "applied"));
            } else {
                assert!(result.is_err(), "{conflict}");
                assert_eq!(
                    before,
                    serde_json::to_value(snapshot).unwrap(),
                    "{conflict}"
                );
            }
            assert!(reopened.apply_proposals(&[]).is_err());
        }
    }
    #[test]
    fn proposal_requires_apply_and_survives_reopen() {
        let f = Fixture::new();
        let c = f
            .store
            .create_card("通知".into(), "毎朝".into(), "codex")
            .unwrap();
        let p = f
            .store
            .propose(
                &c.id,
                1,
                "通知".into(),
                "毎夕".into(),
                "利用時間に合わせる".into(),
            )
            .unwrap();
        assert_eq!(f.store.snapshot().unwrap().cards[0].body, "毎朝");
        Store::open(f.store.path())
            .unwrap()
            .resolve(&p.id, true)
            .unwrap();
        let s = f.store.snapshot().unwrap();
        assert_eq!(s.cards[0].body, "毎夕");
        assert_eq!(s.proposals[0].state, "applied");
        assert!(f.store.resolve(&p.id, true).is_err());
    }
    #[test]
    fn replacing_a_proposal_preserves_the_card_and_rejects_old_ui_actions() {
        let f = Fixture::new();
        let card = f
            .store
            .create_card("通知".into(), "毎朝".into(), "user")
            .unwrap();
        let other = f
            .store
            .create_card("表示".into(), "一覧".into(), "user")
            .unwrap();
        let old = f
            .store
            .propose(&card.id, 1, "通知".into(), "毎夕".into(), "時間変更".into())
            .unwrap();
        let unrelated = f
            .store
            .propose(
                &other.id,
                1,
                "表示".into(),
                "カレンダー".into(),
                "表示変更".into(),
            )
            .unwrap();
        let latest = f
            .store
            .propose(
                &card.id,
                1,
                "平日の通知".into(),
                "平日の毎夕".into(),
                "曜日も指定".into(),
            )
            .unwrap();
        assert_ne!(old.id, latest.id);
        assert_eq!(latest.before_title, card.title);
        assert_eq!(latest.before_body, card.body);
        let reopened = Store::open(f.store.path()).unwrap();
        let s = reopened.snapshot().unwrap();
        assert_eq!(s.cards[0].body, card.body);
        assert_eq!(s.cards[0].revision, 1);
        assert_eq!(
            s.proposals
                .iter()
                .filter(|p| p.card_id == card.id && p.state == "pending")
                .count(),
            1
        );
        assert_eq!(
            s.proposals.iter().find(|p| p.id == old.id).unwrap().state,
            "superseded"
        );
        assert_eq!(
            s.proposals.iter().find(|p| p.id == old.id).unwrap().body,
            "毎夕"
        );
        assert_eq!(
            s.proposals
                .iter()
                .find(|p| p.id == unrelated.id)
                .unwrap()
                .state,
            "pending"
        );
        for apply in [true, false] {
            assert!(
                reopened
                    .resolve(&old.id, apply)
                    .unwrap_err()
                    .to_string()
                    .contains("置き換わっています")
            );
        }
        reopened.resolve(&latest.id, true).unwrap();
        let s = reopened.snapshot().unwrap();
        assert_eq!(s.cards[0].title, latest.title);
        assert_eq!(s.cards[0].body, latest.body);
        assert_eq!(s.cards[0].revision, 2);
    }
    #[test]
    fn proposal_retries_and_invalid_replacements_preserve_the_pending_proposal() {
        let f = Fixture::new();
        let card = f
            .store
            .create_card("通知".into(), "毎朝".into(), "user")
            .unwrap();
        let old = f
            .store
            .propose(&card.id, 1, "通知".into(), "毎夕".into(), "時間変更".into())
            .unwrap();
        assert_eq!(
            f.store
                .propose(
                    &card.id,
                    1,
                    old.title.clone(),
                    old.body.clone(),
                    old.reason.clone()
                )
                .unwrap()
                .id,
            old.id
        );
        assert!(
            f.store
                .propose(&card.id, 1, " ".into(), "無効".into(), "理由".into())
                .is_err()
        );
        assert!(
            f.store
                .propose(&card.id, 0, "通知".into(), "古い版".into(), "理由".into())
                .is_err()
        );
        let s = f.store.snapshot().unwrap();
        assert_eq!(s.proposals.len(), 1);
        assert_eq!(s.proposals[0].state, "pending");
        // A changed reason is also new content that the user must review.
        let revised = f
            .store
            .propose(&card.id, 1, old.title, old.body, "新しい理由".into())
            .unwrap();
        assert_ne!(revised.id, old.id);
        let edited = f
            .store
            .update_card(Card {
                body: "手動編集".into(),
                ..card
            })
            .unwrap();
        assert!(f.store.resolve(&revised.id, true).is_err());
        assert!(
            f.store
                .propose(&edited.id, 1, "通知".into(), "古い版".into(), "理由".into())
                .is_err()
        );
        let latest = f
            .store
            .propose(
                &edited.id,
                edited.revision,
                "通知".into(),
                "最新案".into(),
                "再検討".into(),
            )
            .unwrap();
        assert_eq!(latest.before_body, "手動編集");
        assert_eq!(
            f.store
                .snapshot()
                .unwrap()
                .proposals
                .iter()
                .filter(|p| p.state == "pending")
                .count(),
            1
        );
        f.store.resolve(&latest.id, false).unwrap();
        assert_eq!(f.store.snapshot().unwrap().cards[0].body, "手動編集");
    }
    #[test]
    fn simultaneous_proposals_leave_only_one_pending() {
        let f = Fixture::new();
        let card = f
            .store
            .create_card("通知".into(), "毎朝".into(), "user")
            .unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let handles: Vec<_> = (0..2)
            .map(|i| {
                let store = f.store.clone();
                let card_id = card.id.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    store
                        .propose(&card_id, 1, "通知".into(), format!("案{i}"), "変更".into())
                        .unwrap()
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }
        let s = f.store.snapshot().unwrap();
        assert_eq!(s.proposals.len(), 2);
        assert_eq!(
            s.proposals.iter().filter(|p| p.state == "pending").count(),
            1
        );
        assert_eq!(
            s.proposals
                .iter()
                .filter(|p| p.state == "superseded")
                .count(),
            1
        );
        f.store
            .resolve(
                &s.proposals
                    .iter()
                    .find(|p| p.state == "pending")
                    .unwrap()
                    .id,
                true,
            )
            .unwrap();
    }
    #[test]
    fn stale_or_deleted_card_cannot_apply() {
        let f = Fixture::new();
        let c = f
            .store
            .create_card("通知".into(), "毎朝".into(), "user")
            .unwrap();
        let p = f
            .store
            .propose(&c.id, 1, "通知".into(), "毎夕".into(), "変更".into())
            .unwrap();
        f.store.update_card(Card { deleted: true, ..c }).unwrap();
        assert!(f.store.resolve(&p.id, true).is_err());
        assert_eq!(f.store.snapshot().unwrap().proposals[0].state, "pending");
        f.store.resolve(&p.id, false).unwrap();
    }
    #[test]
    fn identical_retry_is_idempotent_and_empty_title_rejected() {
        let f = Fixture::new();
        let a = f
            .store
            .create_card("環境".into(), "Web?".into(), "codex")
            .unwrap();
        let b = f
            .store
            .create_card("環境".into(), "Web?".into(), "codex")
            .unwrap();
        assert_eq!(a.id, b.id);
        assert!(f.store.create_card(" ".into(), "".into(), "user").is_err());
    }
    #[test]
    fn memory_changes_require_approval_and_reject_stale_proposals() {
        let f = Fixture::new();
        f.store
            .update_project("アプリA".into(), "個人用".into(), 1)
            .unwrap();
        let p = f
            .store
            .propose_memory(2, "個人用。通知なし".into(), "前提を追加".into())
            .unwrap();
        assert_eq!(f.store.project().unwrap().memory, "個人用");
        assert_eq!(
            f.store
                .propose_memory(2, p.memory.clone(), "再試行".into())
                .unwrap()
                .id,
            p.id
        );
        let reopened = Store::open(f.store.path()).unwrap();
        reopened.resolve_memory(&p.id, true).unwrap();
        assert_eq!(reopened.project().unwrap().memory, "個人用。通知なし");
        assert_eq!(reopened.project().unwrap().revision, 3);
        assert!(reopened.resolve_memory(&p.id, true).is_err());
        let stale = reopened
            .propose_memory(3, "共有用".into(), "用途変更".into())
            .unwrap();
        reopened
            .update_project("新しい名前".into(), "個人用。通知なし".into(), 3)
            .unwrap();
        assert!(reopened.resolve_memory(&stale.id, true).is_err());
        reopened.resolve_memory(&stale.id, false).unwrap();
        assert_eq!(reopened.project().unwrap().memory, "個人用。通知なし");
        assert!(
            reopened
                .update_project("旧データ".into(), "".into(), 1)
                .is_err()
        );
        assert!(reopened.snapshot().unwrap().cards.is_empty());
    }
}
