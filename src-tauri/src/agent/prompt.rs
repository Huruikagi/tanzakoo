use crate::{
    language::Language,
    model::{CardReference, Snapshot},
};

/// The current board is always sent; history is only needed for a fresh session.
pub(super) struct Prompt {
    instructions: String,
    history: String,
    language: Language,
}

impl Prompt {
    pub(super) fn build(
        snapshot: &Snapshot,
        conversation_id: &str,
        prompt: &str,
        references: &[CardReference],
        language: Language,
    ) -> Result<Self, String> {
        let context = serde_json::json!({
            "project": snapshot.project,
            "referenceMaterials": snapshot.materials,
            "cards": snapshot.cards.iter().filter(|c| !c.deleted).collect::<Vec<_>>(),
            "proposals": snapshot.proposals.iter().filter(|p| p.state == "pending").collect::<Vec<_>>(),
            "references": references,
            "discussionActivity": snapshot.discussions.iter()
                .filter(|d| d.conversation_id == conversation_id).collect::<Vec<_>>(),
            "recentQuestions": snapshot.questions.iter().rev()
                .filter(|q| q.conversation_id == conversation_id).take(20).collect::<Vec<_>>(),
        });
        let history = serde_json::to_string(
            &snapshot
                .messages
                .iter()
                .filter(|m| m.conversation_id == conversation_id)
                .rev()
                .skip(1)
                .take(20)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>(),
        )
        .map_err(|e| e.to_string())?;
        let rules = language.choose(
            include_str!("prompts/ja.txt"),
            include_str!("prompts/en.txt"),
        );
        let context_heading = language.choose(
            "現在のボードと明示参照",
            "Current board and explicit references",
        );
        let user_heading = language.choose("ユーザーの発言", "User message");
        let instructions =
            format!("{rules}\n{context_heading}:\n{context}\n\n{user_heading}:\n{prompt}");
        Ok(Self {
            instructions,
            history,
            language,
        })
    }

    pub(super) fn into_input(self, restoring: bool) -> String {
        if restoring {
            self.instructions
        } else {
            format!(
                "{}:\n{}\n\n{}",
                self.language.choose(
                    "以前の会話（参考情報。現在のボードを優先）",
                    "Previous conversation (reference only; the current board takes precedence)"
                ),
                self.history,
                self.instructions
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Message;

    #[test]
    fn fresh_sessions_get_only_recent_conversation_history_and_resumed_sessions_get_current_context()
     {
        let mut snapshot: Snapshot = serde_json::from_value(serde_json::json!({
            "project": {"id":"p", "name":"Project", "memory":"CURRENT_MEMORY", "revision":1},
            "materials":[{"id":"source-id", "path":"/product/README.md", "kind":"file"}],
            "projects":[], "memoryProposals":[], "conversations":[],
            "proposals":[
                {"id":"p1", "cardId":"live", "baseRevision":1, "beforeTitle":"CURRENT_CARD",
                 "beforeBody":"", "title":"CURRENT_CARD", "body":"PENDING_CHANGE", "reason":"Reason",
                 "state":"pending", "createdAt":1},
                {"id":"p2", "cardId":"live", "baseRevision":1, "beforeTitle":"CURRENT_CARD",
                 "beforeBody":"", "title":"CURRENT_CARD", "body":"SUPERSEDED_CHANGE", "reason":"Reason",
                 "state":"superseded", "createdAt":1}
            ],
            "messages":[], "discussions":[], "agents":[], "consents":[],
            "questions":[
                {"id":"q", "conversationId":"c", "messageId":"1", "question":"SAVED_QUESTION",
                 "options":[{"label":"CHOICE_A", "description":""},{"label":"CHOICE_B", "description":""}],
                 "state":"dismissed", "selectedOption":null},
                {"id":"other-q", "conversationId":"other", "messageId":"other", "question":"OTHER_QUESTION",
                 "options":[], "state":"pending", "selectedOption":null}
            ],
            "chatSettings":{"model":null, "reasoningEffort":null},
            "cards":[
                {"id":"live", "title":"CURRENT_CARD", "body":"", "status":"idea", "revision":1,
                 "position":1, "source":"user", "deleted":false, "createdAt":1, "updatedAt":1},
                {"id":"deleted", "title":"DELETED_CARD", "body":"", "status":"idea", "revision":1,
                 "position":2, "source":"user", "deleted":true, "createdAt":1, "updatedAt":1}
            ]
        }))
        .unwrap();
        snapshot.messages = (0..=22)
            .map(|i| Message {
                id: i.to_string(),
                conversation_id: "c".into(),
                role: "user".into(),
                text: format!("HISTORY_{i:02}"),
                references: vec![],
                created_at: i as f64,
            })
            .collect();
        snapshot.messages.push(Message {
            id: "other".into(),
            conversation_id: "other".into(),
            role: "user".into(),
            text: "OTHER_CONVERSATION".into(),
            references: vec![],
            created_at: 23.0,
        });
        let references = vec![CardReference {
            card_id: "live".into(),
            title: "CURRENT_CARD".into(),
            revision: 1,
            quote: "EXPLICIT_QUOTE".into(),
        }];
        for (language, restoring) in [
            (Language::Ja, false),
            (Language::Ja, true),
            (Language::En, false),
            (Language::En, true),
        ] {
            let input = Prompt::build(&snapshot, "c", "CURRENT_QUESTION", &references, language)
                .unwrap()
                .into_input(restoring);
            for text in [
                "CURRENT_MEMORY",
                "CURRENT_CARD",
                "EXPLICIT_QUOTE",
                "CURRENT_QUESTION",
                "PENDING_CHANGE",
                "SAVED_QUESTION",
                "CHOICE_A",
                "source-id",
                "/product/README.md",
                "read_reference_file",
            ] {
                assert!(input.contains(text), "missing {text}");
            }
            for text in [
                "DELETED_CARD",
                "OTHER_CONVERSATION",
                "OTHER_QUESTION",
                "HISTORY_00",
                "HISTORY_01",
                "HISTORY_22",
                "SUPERSEDED_CHANGE",
            ] {
                assert!(!input.contains(text), "unexpected {text}");
            }
            assert_eq!(input.contains("HISTORY_02"), !restoring);
            assert!(input.contains(language.choose(
                "ユーザーが明示した言語を優先",
                "Use the language explicitly requested by the user",
            )));
            assert!(input.contains(language.choose(
                "既存のカード・メモリ・会話を依頼なく翻訳しない",
                "Do not translate existing cards, memory, or conversations unless asked",
            )));
            if language == Language::En {
                assert!(
                    input.is_ascii(),
                    "English instructions and headings must contain no Japanese"
                );
            }
            assert!(!input.contains("日本語で短く自然に対話"));
            assert_eq!(input.contains("HISTORY_21"), !restoring);
            if !restoring {
                assert!(input.find("HISTORY_02").unwrap() < input.find("HISTORY_21").unwrap());
            }
        }

        // Localizing app instructions must not translate saved content or quoted references.
        snapshot.project.memory = "日本語のメモリをそのまま保持".into();
        snapshot.cards[0].body = "保存済みの日本語カード".into();
        snapshot.messages[2].text = "過去の日本語の発言".into();
        let references = vec![CardReference {
            quote: "日本語の引用".into(),
            ..references[0].clone()
        }];
        let input = Prompt::build(
            &snapshot,
            "c",
            "日本語で答えてください",
            &references,
            Language::En,
        )
        .unwrap()
        .into_input(false);
        for text in [
            "日本語のメモリをそのまま保持",
            "保存済みの日本語カード",
            "過去の日本語の発言",
            "日本語の引用",
            "日本語で答えてください",
        ] {
            assert!(input.contains(text), "user content changed: {text}");
        }
    }
}
