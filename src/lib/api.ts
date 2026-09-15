import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Snapshot } from "@/bindings/Snapshot";
import type { BoardAction } from "@/bindings/BoardAction";
import type { CardReference } from "@/bindings/CardReference";

export type AgentEvent = {
  conversationId: string;
  kind: string;
  text: string;
  detail: unknown;
};
export const native = isTauri();
export const emptySnapshot: Snapshot = {
  cards: [],
  proposals: [],
  conversations: [],
  messages: [],
  agents: [],
};
export const api = {
  snapshot: () => (native ? invoke<Snapshot>("get_snapshot") : Promise.resolve(emptySnapshot)),
  action: (action: BoardAction) => invoke<Snapshot>("board_action", { action }),
  send: (conversationId: string, text: string, references: CardReference[]) =>
    invoke<void>("send_prompt", { conversationId, text, references }),
  cancel: () => invoke<void>("cancel_prompt"),
  permission: (id: string, option: string | null) =>
    invoke<void>("answer_permission", { id, option }),
  subscribe: (handler: (event: AgentEvent) => void) =>
    native
      ? listen<AgentEvent>("agent-event", (e) => handler(e.payload))
      : Promise.resolve(() => {}),
};
