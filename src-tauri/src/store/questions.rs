use super::*;

impl Store {
    pub fn present_question(
        &self,
        conversation_id: &str,
        message_id: &str,
        question: String,
        options: Vec<QuestionOption>,
    ) -> Result<ChoiceQuestion> {
        Ok(self
            .present_questions(
                conversation_id,
                message_id,
                vec![QuestionInput { question, options }],
            )?
            .remove(0))
    }

    pub fn present_questions(
        &self,
        conversation_id: &str,
        message_id: &str,
        questions: Vec<QuestionInput>,
    ) -> Result<Vec<ChoiceQuestion>> {
        if !(1..=4).contains(&questions.len()) {
            return Err(invalid("一度に提示する質問は1〜4個にしてください。"));
        }
        for (index, QuestionInput { question, options }) in questions.iter().enumerate() {
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
                || questions[..index]
                    .iter()
                    .any(|q| q.question.trim() == question.trim())
            {
                return Err(invalid(
                    "質問は1〜500文字、異なる選択肢を2〜4個（ラベル100文字・説明300文字以内）で指定してください。",
                ));
            }
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
        let existing: Vec<_> = list::<ChoiceQuestion>(&tx, "question")?
            .into_iter()
            .filter(|q| q.conversation_id == conversation_id && q.message_id == message_id)
            .collect();
        if !existing.is_empty() {
            if existing.len() == questions.len()
                && existing.iter().zip(&questions).all(|(saved, input)| {
                    saved.state == QuestionState::Pending
                        && saved.question == input.question
                        && saved.options == input.options
                })
            {
                return Ok(existing);
            }
            return Err(invalid(
                "この発言への質問はすでに提示済みです。ユーザーの返答を待ってください。",
            ));
        }
        let mut values = Vec::new();
        for QuestionInput { question, options } in questions {
            let value = ChoiceQuestion {
                id: id(&tx)?,
                conversation_id: conversation_id.into(),
                message_id: message_id.into(),
                question,
                options,
                state: QuestionState::Pending,
                selected_option: None,
                answer_text: None,
            };
            put(&tx, "question", &value.id, &value)?;
            values.push(value);
        }
        tx.commit()?;
        Ok(values)
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
    answers: Option<Vec<QuestionAnswer>>,
) -> Result<String> {
    if let Some(answers) = answers {
        let latest = list::<Message>(db, "message")?
            .into_iter()
            .rev()
            .find(|m| m.conversation_id == conversation_id && m.role == "user")
            .ok_or_else(|| invalid("現在のユーザー発言が見つかりません。"))?;
        let pending: Vec<_> = list::<ChoiceQuestion>(db, "question")?
            .into_iter()
            .filter(|q| {
                q.conversation_id == conversation_id
                    && q.message_id == latest.id
                    && q.state == QuestionState::Pending
            })
            .collect();
        if pending.is_empty()
            || pending.len() != answers.len()
            || pending
                .iter()
                .any(|q| answers.iter().filter(|a| a.question_id == q.id).count() != 1)
        {
            return Err(invalid(
                "現在の質問すべてに1回ずつ回答してください。古い質問には回答できません。",
            ));
        }
        let mut parts = Vec::new();
        for mut q in pending {
            let answer = answers
                .iter()
                .find(|a| a.question_id == q.id)
                .expect("validated answer set");
            let content = match (answer.option_index, &answer.text) {
                (Some(index), None) => {
                    let option = q
                        .options
                        .get(index as usize)
                        .ok_or_else(|| invalid("選択肢が見つかりません。"))?;
                    if option.description.is_empty() {
                        option.label.clone()
                    } else {
                        format!("{}\n{}", option.label, option.description)
                    }
                }
                (None, Some(value))
                    if !value.trim().is_empty() && value.chars().count() <= 2000 =>
                {
                    value.trim().to_owned()
                }
                _ => {
                    return Err(invalid(
                        "各質問は選択肢か自由入力（1〜2000文字）のどちらかで回答してください。",
                    ));
                }
            };
            parts.push(format!("「{}」への回答：{}", q.question, content));
            q.state = QuestionState::Answered;
            q.selected_option = answer.option_index;
            q.answer_text = answer.text.as_ref().map(|value| value.trim().to_owned());
            put(db, "question", &q.id, &q)?;
        }
        text = parts.join("\n\n");
    }
    for mut q in list::<ChoiceQuestion>(db, "question")? {
        if q.conversation_id == conversation_id && q.state == QuestionState::Pending {
            q.state = QuestionState::Dismissed;
            put(db, "question", &q.id, &q)?;
        }
    }
    Ok(text)
}
