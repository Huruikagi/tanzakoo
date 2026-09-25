use crate::store::Store;
use rmcp::{
    ServerHandler, ServiceExt,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ContentBlock, ServerCapabilities, ServerInfo},
    schemars, tool, tool_handler, tool_router,
};
use serde::Deserialize;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct NewCard {
    pub title: String,
    pub body: String,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct EditProposal {
    pub card_id: String,
    pub base_revision: u32,
    pub title: String,
    pub body: String,
    pub reason: String,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct MemoryChange {
    pub base_revision: u32,
    pub memory: String,
    pub reason: String,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DiscussionFocus {
    pub card_id: String,
    pub base_revision: u32,
    /// Concrete evidence in the user's current message that this topic is being discussed.
    pub reason: String,
    /// true when the target is ambiguous; show a choice without moving anything.
    pub suggest_only: bool,
}
#[derive(Clone)]
pub struct BoardTools {
    store: Store,
    source: String,
    turn: Option<(String, String)>,
    tool_router: ToolRouter<Self>,
}
fn response<T: serde::Serialize>(result: crate::store::Result<T>) -> CallToolResult {
    match result {
        Ok(value) => CallToolResult::success(vec![ContentBlock::text(
            serde_json::to_string(&value).unwrap_or_default(),
        )]),
        Err(error) => CallToolResult::error(vec![ContentBlock::text(error.to_string())]),
    }
}
#[tool_router]
impl BoardTools {
    pub fn new(store: Store, source: String, turn: Option<(String, String)>) -> Self {
        Self {
            store,
            source,
            turn,
            tool_router: Self::tool_router(),
        }
    }
    #[tool(
        description = "Read the authoritative Tanzakoo project name, memory, revision, board and pending proposals. Read before proposing edits. No chat or connection settings."
    )]
    fn get_board(&self) -> CallToolResult {
        response(self.store.snapshot().map(|s| {
            serde_json::json!({
                "project": s.project,
                "memoryProposals": s.memory_proposals.into_iter().filter(|p| p.state == "pending").collect::<Vec<_>>(),
                "cards": s.cards.into_iter().filter(|c| !c.deleted).collect::<Vec<_>>(),
                "proposals": s.proposals.into_iter().filter(|p| p.state == "pending").collect::<Vec<_>>(),
                "discussionActivity": s.discussions.into_iter().filter(|d| self.turn.as_ref().is_some_and(|(c, _)| *c == d.conversation_id)).collect::<Vec<_>>(),
            })
        }))
    }
    #[tool(
        description = "Create one candidate discussion card. This is automatically saved to the idea pile, not an agreed requirement. Reuse existing topics; do not create duplicates."
    )]
    fn create_candidate(&self, Parameters(p): Parameters<NewCard>) -> CallToolResult {
        response(self.store.create_card(p.title, p.body, &self.source))
    }
    #[tool(
        description = "Report a card the USER is actively discussing in this turn. Read get_board first. Use only for an explicit request to discuss it, or concrete wishes/questions unambiguously about its topic. Mere mentions, comparisons, attached references, and topics introduced only by the assistant do NOT qualify. Set suggest_only=true if the target is ambiguous. Clear idea/explore cards move to discuss with an Undo notice; decided cards always require a UI click. Deleted cards and user-overridden moves are protected. Never change content or infer a decision. Inspect the result; a suggestion is not a completed move."
    )]
    fn report_discussion(&self, Parameters(p): Parameters<DiscussionFocus>) -> CallToolResult {
        let Some((conversation_id, message_id)) = &self.turn else {
            return CallToolResult::error(vec![ContentBlock::text(
                "現在の会話に紐づいた操作ではありません。",
            )]);
        };
        response(self.store.report_discussion(
            conversation_id,
            message_id,
            &p.card_id,
            p.base_revision,
            p.reason,
            p.suggest_only,
        ))
    }
    #[tool(
        description = "Propose a complete new title/body for an existing card at its current revision. It stays pending until the USER applies it in the UI. This tool never applies the change. Explain the reason."
    )]
    fn propose_card_change(&self, Parameters(p): Parameters<EditProposal>) -> CallToolResult {
        response(
            self.store
                .propose(&p.card_id, p.base_revision, p.title, p.body, p.reason),
        )
    }
    #[tool(
        description = "Propose a complete replacement Markdown project memory at its current revision. Remains pending until USER approval in the UI. Never applies changes. Preserve relevant existing memory; explain the reason."
    )]
    fn propose_memory_change(&self, Parameters(p): Parameters<MemoryChange>) -> CallToolResult {
        response(
            self.store
                .propose_memory(p.base_revision, p.memory, p.reason),
        )
    }
}
#[tool_handler(router = self.tool_router)]
impl ServerHandler for BoardTools {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build()).with_instructions("Tanzakoo board tools. Ideas can be created freely. report_discussion may move an actively discussed candidate to discuss; it never approves content. Existing card content changes require a proposal and user approval in Tanzakoo. Never treat an unapproved proposal as board truth.")
    }
}
pub async fn serve(
    path: std::path::PathBuf,
    source: String,
    turn: Option<(String, String)>,
) -> Result<(), Box<dyn std::error::Error>> {
    let service = BoardTools::new(Store::open(path)?, source, turn)
        .serve(rmcp::transport::stdio())
        .await?;
    service.waiting().await?;
    Ok(())
}
