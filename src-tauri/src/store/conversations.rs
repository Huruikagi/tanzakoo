use super::*;

impl Store {
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
        self.append_message_with_answer(conversation_id, role, text, references, None)
    }

    pub fn append_message_with_answer(
        &self,
        conversation_id: &str,
        role: &str,
        mut text: String,
        references: Vec<CardReference>,
        answer: Option<Vec<QuestionAnswer>>,
    ) -> Result<Message> {
        if !["user", "assistant", "error"].contains(&role) || text.len() > 1_000_000 {
            return Err(invalid("メッセージが不正です。"));
        }
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut c: Conversation = get(&tx, "conversation", conversation_id)?;
        if role == "user" {
            text = questions::resolve_answer(&tx, conversation_id, text, answer)?;
        } else if answer.is_some() {
            return Err(invalid("選択肢への回答はユーザーのみ送信できます。"));
        }
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
}
