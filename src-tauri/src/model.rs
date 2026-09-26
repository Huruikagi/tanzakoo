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

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum DiscussionState {
    Suggested,
    Moved,
    Undone,
    Dismissed,
    Superseded,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Discussion {
    pub id: String,
    pub conversation_id: String,
    pub message_id: String,
    pub card_id: String,
    pub title: String,
    pub reason: String,
    pub previous_status: CardStatus,
    pub previous_position: f64,
    pub card_revision: u32,
    pub state: DiscussionState,
    pub automatic: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct AgentConfig {
    pub id: String,
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ChatSettings {
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ChatOptionValue {
    pub value: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ChatOption {
    pub id: String,
    pub current_value: String,
    pub options: Vec<ChatOptionValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ConnectionStatus {
    pub state: String,
    pub message: String,
    pub can_login: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub memory: String,
    pub revision: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct MemoryProposal {
    pub id: String,
    pub base_revision: u32,
    pub before_memory: String,
    pub memory: String,
    pub reason: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Snapshot {
    pub project: Project,
    pub projects: Vec<ProjectSummary>,
    pub memory_proposals: Vec<MemoryProposal>,
    pub cards: Vec<Card>,
    pub proposals: Vec<Proposal>,
    pub conversations: Vec<Conversation>,
    pub messages: Vec<Message>,
    pub discussions: Vec<Discussion>,
    pub agents: Vec<AgentConfig>,
    pub chat_settings: ChatSettings,
    /// Agents the user has agreed to send project content to. App-wide, not per project.
    pub consents: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "../../src/bindings/")]
pub enum BoardAction {
    UpdateProject {
        name: String,
        memory: String,
        revision: u32,
    },
    ResolveMemoryProposal {
        id: String,
        apply: bool,
    },
    CreateCard {
        title: String,
        body: String,
    },
    UpdateCard {
        card: Card,
    },
    ResolveProposal {
        id: String,
        apply: bool,
    },
    ResolveDiscussion {
        id: String,
        action: DiscussionResolution,
    },
    NewConversation {
        agent: String,
    },
    ConfigureAgent {
        config: AgentConfig,
    },
    ConfigureChat {
        settings: ChatSettings,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum DiscussionResolution {
    Accept,
    Dismiss,
    Undo,
}
