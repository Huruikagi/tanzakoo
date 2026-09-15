use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum CardStatus {
    Idea,
    Explore,
    Discuss,
    Decided,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Card {
    pub id: String,
    pub title: String,
    pub body: String,
    pub status: CardStatus,
    pub revision: u32,
    pub position: f64,
    pub source: String,
    pub deleted: bool,
    pub created_at: f64,
    pub updated_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Proposal {
    pub id: String,
    pub card_id: String,
    pub base_revision: u32,
    pub before_title: String,
    pub before_body: String,
    pub title: String,
    pub body: String,
    pub reason: String,
    pub state: String,
    pub created_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct CardReference {
    pub card_id: String,
    pub title: String,
    pub revision: u32,
    pub quote: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub agent: String,
    pub session_id: Option<String>,
    pub created_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub text: String,
    pub references: Vec<CardReference>,
    pub created_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct AgentConfig {
    pub id: String,
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Snapshot {
    pub cards: Vec<Card>,
    pub proposals: Vec<Proposal>,
    pub conversations: Vec<Conversation>,
    pub messages: Vec<Message>,
    pub agents: Vec<AgentConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "../../src/bindings/")]
pub enum BoardAction {
    CreateCard { title: String, body: String },
    UpdateCard { card: Card },
    ResolveProposal { id: String, apply: bool },
    NewConversation { agent: String },
    ConfigureAgent { config: AgentConfig },
}
