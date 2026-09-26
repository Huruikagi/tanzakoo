use super::*;

impl Store {
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
