use super::*;

impl Store {
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
}
