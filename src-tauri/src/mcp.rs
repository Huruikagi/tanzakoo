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
#[derive(Clone)]
pub struct BoardTools {
    store: Store,
    source: String,
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
    pub fn new(store: Store, source: String) -> Self {
        Self {
            store,
            source,
            tool_router: Self::tool_router(),
        }
    }
    #[tool(
        description = "Read the authoritative Tanzakoo board. Read before proposing edits. Cards and pending proposals only; no chat or settings."
    )]
    fn get_board(&self) -> CallToolResult {
        response(self.store.snapshot().map(|s|serde_json::json!({"cards":s.cards.into_iter().filter(|c|!c.deleted).collect::<Vec<_>>(),"proposals":s.proposals.into_iter().filter(|p|p.state=="pending").collect::<Vec<_>>()})))
    }
    #[tool(
        description = "Create one candidate discussion card. This is automatically saved to the idea pile, not an agreed requirement. Reuse existing topics; do not create duplicates."
    )]
    fn create_candidate(&self, Parameters(p): Parameters<NewCard>) -> CallToolResult {
        response(self.store.create_card(p.title, p.body, &self.source))
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
}
#[tool_handler(router = self.tool_router)]
impl ServerHandler for BoardTools {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build()).with_instructions("Tanzakoo board tools. Ideas can be created freely; existing card content changes require a proposal and user approval in Tanzakoo. Never treat an unapproved proposal as board truth.")
    }
}
pub async fn serve(
    path: std::path::PathBuf,
    source: String,
) -> Result<(), Box<dyn std::error::Error>> {
    let service = BoardTools::new(Store::open(path)?, source)
        .serve(rmcp::transport::stdio())
        .await?;
    service.waiting().await?;
    Ok(())
}
