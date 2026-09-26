use super::*;

impl Store {
    pub fn present_question(
        &self,
        conversation_id: &str,
        message_id: &str,
        question: String,
        options: Vec<QuestionOption>,
    ) -> Result<ChoiceQuestion> {
        if question.trim().is_empty()
            || question.chars().count() > 500
            || !(2..=4).contains(&options.len())
            || options.iter().any(|o| {
                o.label.trim().is_empty()
                    || o.label.chars().count() > 100
                    || o.description.chars().count() > 300
            })
            || options.iter().enumerate().any(|(i, o)| {
                options[..i]
                    .iter()
                    .any(|other| other.label.trim() == o.label.trim())
            })
        {
            return Err(invalid(
                "質問は1〜500文字、異なる選択肢を2〜4個（ラベル100文字・説明300文字以内）で指定してください。",
            ));
        }
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let latest = list::<Message>(&tx, "message")?
            .into_iter()
            .rev()
            .find(|m| m.conversation_id == conversation_id && m.role == "user")
            .ok_or_else(|| invalid("現在のユーザー発言が見つかりません。"))?;
        if latest.id != message_id {
            return Err(invalid("この会話はすでに次の発言へ進んでいます。"));
        }
        if let Some(existing) = list::<ChoiceQuestion>(&tx, "question")?
            .into_iter()
            .find(|q| q.conversation_id == conversation_id && q.message_id == message_id)
        {
            if existing.state == QuestionState::Pending
                && existing.question == question
                && existing.options == options
            {
                return Ok(existing);
            }
            return Err(invalid(
                "一度に提示する質問は1つです。ユーザーの返答を待ってください。",
            ));
        }
        let value = ChoiceQuestion {
            id: id(&tx)?,
            conversation_id: conversation_id.into(),
            message_id: message_id.into(),
            question,
            options,
            state: QuestionState::Pending,
            selected_option: None,
        };
        put(&tx, "question", &value.id, &value)?;
        tx.commit()?;
        Ok(value)
    }

    pub fn cancel_questions(&self, conversation_id: &str, message_id: &str) -> Result<()> {
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        for mut question in list::<ChoiceQuestion>(&tx, "question")? {
            if question.conversation_id == conversation_id
                && question.message_id == message_id
                && question.state == QuestionState::Pending
            {
                question.state = QuestionState::Cancelled;
                put(&tx, "question", &question.id, &question)?;
            }
        }
        tx.commit()?;
        Ok(())
    }
}

// The answer and user message share a transaction: stale/double clicks cannot
// append a second message or close another conversation's question.
pub(super) fn resolve_answer(
    db: &Connection,
    conversation_id: &str,
    mut text: String,
    answer: Option<QuestionAnswer>,
) -> Result<String> {
    if let Some(answer) = answer {
        let mut q: ChoiceQuestion = get(db, "question", &answer.question_id)?;
        let latest = list::<Message>(db, "message")?
            .into_iter()
            .rev()
            .find(|m| m.conversation_id == conversation_id && m.role == "user");
        if q.conversation_id != conversation_id
            || q.state != QuestionState::Pending
            || latest.is_none_or(|m| m.id != q.message_id)
        {
            return Err(invalid("この質問への回答受付は終了しています。"));
        }
        let option = q
            .options
            .get(answer.option_index as usize)
            .ok_or_else(|| invalid("選択肢が見つかりません。"))?;
        text = format!("「{}」への回答：{}", q.question, option.label);
        if !option.description.is_empty() {
            text.push_str(&format!("\n{}", option.description));
        }
        q.state = QuestionState::Answered;
        q.selected_option = Some(answer.option_index);
        put(db, "question", &q.id, &q)?;
    }
    for mut q in list::<ChoiceQuestion>(db, "question")? {
        if q.conversation_id == conversation_id && q.state == QuestionState::Pending {
            q.state = QuestionState::Dismissed;
            put(db, "question", &q.id, &q)?;
        }
    }
    Ok(text)
}
