use super::*;

impl Store {
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
}
