use super::*;

#[derive(serde::Serialize, serde::Deserialize)]
struct Suppression {
    conversation_id: String,
    card_id: String,
}

fn suppress(db: &Connection, discussion: &Discussion) -> Result<()> {
    put(
        db,
        "discussionSuppression",
        &format!("{}:{}", discussion.conversation_id, discussion.card_id),
        &Suppression {
            conversation_id: discussion.conversation_id.clone(),
            card_id: discussion.card_id.clone(),
        },
    )
}

// A user's column/deletion choice wins over earlier automatic moves and suggestions.
pub(super) fn on_manual_change(
    db: &Connection,
    card: &Card,
    status: &CardStatus,
    deleted: bool,
) -> Result<()> {
    if card.status != *status || card.deleted != deleted {
        for mut d in list::<Discussion>(db, "discussion")? {
            if d.card_id == card.id {
                suppress(db, &d)?;
                if matches!(d.state, DiscussionState::Moved | DiscussionState::Suggested) {
                    d.state = DiscussionState::Superseded;
                    put(db, "discussion", &d.id, &d)?;
                }
            }
        }
    }
    Ok(())
}

fn save_move(db: &Connection, card: &mut Card) -> Result<()> {
    // Moving a card does not change the content the user is asked to approve.
    // Keep only already-current content proposals applicable across this metadata change.
    for mut p in list::<Proposal>(db, "proposal")? {
        if p.card_id == card.id
            && p.state == "pending"
            && p.base_revision == card.revision
            && p.before_title == card.title
            && p.before_body == card.body
        {
            p.base_revision += 1;
            put(db, "proposal", &p.id, &p)?;
        }
    }
    card.revision += 1;
    card.updated_at = now();
    put(db, "card", &card.id, card)
}

fn move_to_discuss(db: &Connection, card: &mut Card) -> Result<()> {
    card.position = list::<Card>(db, "card")?
        .iter()
        .filter(|c| !c.deleted && c.status == CardStatus::Discuss)
        .map(|c| c.position)
        .fold(0.0, f64::max)
        + 1.0;
    card.status = CardStatus::Discuss;
    save_move(db, card)
}

impl Store {
    /// Conversation and message are bound by the host, never chosen by the model.
    pub fn report_discussion(
        &self,
        conversation_id: &str,
        message_id: &str,
        card_id: &str,
        revision: u32,
        reason: String,
        suggest_only: bool,
    ) -> Result<Option<Discussion>> {
        if reason.trim().is_empty() || reason.len() > 10_000 {
            return Err(invalid(
                "議論対象と判断した理由を1〜10000バイトで指定してください。",
            ));
        }
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let _: Conversation = get(&tx, "conversation", conversation_id)?;
        let messages: Vec<Message> = list(&tx, "message")?;
        if !messages
            .iter()
            .rev()
            .find(|m| m.conversation_id == conversation_id && m.role == "user")
            .is_some_and(|m| m.id == message_id)
        {
            return Err(invalid(
                "会話が更新されています。現在の発言で判断し直してください。",
            ));
        }
        let mut card: Card = get(&tx, "card", card_id)?;
        if card.deleted {
            return Err(invalid("削除されたカードは議論対象に移せません。"));
        }
        if list::<Suppression>(&tx, "discussionSuppression")?
            .iter()
            .any(|s| s.conversation_id == conversation_id && s.card_id == card_id)
        {
            return Err(invalid(
                "ユーザーが移動を取り消したか、手動で整理したカードです。この会話では再移動・再提案しないでください。",
            ));
        }
        let discussions: Vec<Discussion> = list(&tx, "discussion")?;
        // Retries do not create duplicate notices or move the card again.
        if let Some(d) = discussions.iter().rev().find(|d| {
            d.conversation_id == conversation_id
                && d.card_id == card_id
                && d.message_id == message_id
                && matches!(d.state, DiscussionState::Moved | DiscussionState::Suggested)
        }) {
            return Ok(Some(d.clone()));
        }
        if card.status == CardStatus::Discuss {
            return Ok(None);
        }
        if card.revision != revision {
            return Err(invalid(
                "カードが更新されています。ボードを読み直してください。",
            ));
        }
        let suggested = suggest_only || card.status == CardStatus::Decided;
        if suggested
            && let Some(d) = discussions.iter().find(|d| {
                d.conversation_id == conversation_id
                    && d.card_id == card_id
                    && d.state == DiscussionState::Suggested
                    && d.card_revision == revision
            })
        {
            return Ok(Some(d.clone()));
        }
        for mut d in discussions {
            if d.card_id == card_id
                && d.state == DiscussionState::Suggested
                && (d.conversation_id == conversation_id || !suggested)
            {
                d.state = DiscussionState::Superseded;
                put(&tx, "discussion", &d.id, &d)?;
            }
        }
        let mut d = Discussion {
            id: id(&tx)?,
            conversation_id: conversation_id.into(),
            message_id: message_id.into(),
            card_id: card_id.into(),
            title: card.title.clone(),
            reason,
            previous_status: card.status.clone(),
            previous_position: card.position,
            card_revision: card.revision,
            state: if suggested {
                DiscussionState::Suggested
            } else {
                DiscussionState::Moved
            },
            automatic: !suggested,
        };
        if !suggested {
            move_to_discuss(&tx, &mut card)?;
            d.card_revision = card.revision;
        }
        put(&tx, "discussion", &d.id, &d)?;
        tx.commit()?;
        Ok(Some(d))
    }

    /// Only exposed as a UI action, never as an agent tool.
    pub fn resolve_discussion(&self, id: &str, action: DiscussionResolution) -> Result<()> {
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut d: Discussion = get(&tx, "discussion", id)?;
        let mut card: Card = get(&tx, "card", &d.card_id)?;
        match action {
            DiscussionResolution::Dismiss if d.state == DiscussionState::Suggested => {
                d.state = DiscussionState::Dismissed;
                suppress(&tx, &d)?;
            }
            DiscussionResolution::Accept if d.state == DiscussionState::Suggested => {
                if card.deleted
                    || card.revision != d.card_revision
                    || card.status != d.previous_status
                {
                    return Err(invalid(
                        "案内後にカードが変わっています。現在のカードから列を選んでください。",
                    ));
                }
                // Explicit acceptance invalidates older actions in other conversations too.
                on_manual_change(&tx, &card, &CardStatus::Discuss, false)?;
                move_to_discuss(&tx, &mut card)?;
                d.card_revision = card.revision;
                d.state = DiscussionState::Moved;
            }
            DiscussionResolution::Undo if d.state == DiscussionState::Moved => {
                if card.deleted
                    || card.revision != d.card_revision
                    || card.status != CardStatus::Discuss
                {
                    return Err(invalid(
                        "移動後にカードが変わっています。現在のカードから列を選んでください。",
                    ));
                }
                card.status = d.previous_status.clone();
                card.position = d.previous_position;
                save_move(&tx, &mut card)?;
                d.state = DiscussionState::Undone;
                suppress(&tx, &d)?;
            }
            _ => return Err(invalid("この案内は処理済みです。")),
        }
        put(&tx, "discussion", id, &d)?;
        tx.commit()?;
        Ok(())
    }
}
