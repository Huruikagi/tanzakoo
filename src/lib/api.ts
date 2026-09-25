import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Snapshot } from "@/bindings/Snapshot";
import type { BoardAction } from "@/bindings/BoardAction";
import type { CardReference } from "@/bindings/CardReference";
import type { ConnectionStatus } from "@/bindings/ConnectionStatus";

export type AgentEvent = {
  conversationId: string;
  kind: string;
  text: string;
  detail: unknown;
};
export const native = isTauri();
/** Matches `agent_setup::CLAUDE_UNAVAILABLE`: this build offers no Claude connection. */
export const CLAUDE_UNAVAILABLE = "@tanzakoo/claude-unavailable";
export const agentUnavailable = (snapshot: Snapshot, agent: string) =>
  agent !== "codex" ||
  snapshot.agents.some((a) => a.id === agent && a.command === CLAUDE_UNAVAILABLE);
export const emptySnapshot: Snapshot = {
  project: { id: "", name: "マイプロジェクト", memory: "", revision: 1 },
  projects: [],
  memoryProposals: [],
  cards: [],
  proposals: [],
  conversations: [],
  messages: [],
  agents: [],
};
export const api = {
  snapshot: () => (native ? invoke<Snapshot>("get_snapshot") : Promise.resolve(emptySnapshot)),
  action: (action: BoardAction, projectId: string) =>
    invoke<Snapshot>("board_action", { action, projectId }),
  switchProject: (projectId: string) => invoke<Snapshot>("switch_project", { projectId }),
  createProject: (name: string, memory: string) =>
    invoke<Snapshot>("create_project", { name, memory }),
  send: (conversationId: string, text: string, references: CardReference[], projectId: string) =>
    invoke<void>("send_prompt", { conversationId, text, references, projectId, consent: true }),
  connection: (projectId: string, agent: string, action: "check" | "login" | "logout") =>
    invoke<ConnectionStatus>("agent_connection", { projectId, agent, action }),
  cancel: () => invoke<void>("cancel_prompt"),
  permission: (id: string, option: string | null) =>
    invoke<void>("answer_permission", { id, option }),
  subscribe: (handler: (event: AgentEvent) => void) =>
    native
      ? listen<AgentEvent>("agent-event", (e) => handler(e.payload))
      : Promise.resolve(() => {}),
};
