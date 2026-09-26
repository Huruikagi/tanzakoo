import { api } from "../api";
import type { WorkspaceSlice, Workspace, Busy, Permission } from "./types";
import type { Snapshot } from "@/bindings/Snapshot";
import type { ConnectionStatus } from "@/bindings/ConnectionStatus";
import { serialized, snapshotUpdate } from "./snapshot";
const BROADEN_TOPICS_PROMPT =
  "話題を広げてください。既存カードとプロジェクトの前提を見て、新しい切り口の候補を3〜5枚ほど追加してください。既存カードやメモリの変更・移動は不要です。";
export function launchKey(snapshot: Snapshot, agent: string) {
  const config = snapshot.agents.find((a) => a.id === agent);
  return JSON.stringify([config?.command, config?.args]);
}
export function connectionStatus(
  state: Pick<Workspace, "snapshot" | "connections">,
  agent: string,
): ConnectionStatus | undefined {
  const connection = state.connections[agent];
  return connection?.launch === launchKey(state.snapshot, agent) ? connection.status : undefined;
}
/** Whether the chat for `conversation` (null: a new chat) is the one currently running. */
export function chatRunning(busy: Busy | null, conversation: string | null) {
  return (
    busy?.kind === "chat" && (busy.conversation === null || busy.conversation === conversation)
  );
}

export const createAgentSlice: WorkspaceSlice<
  | "chatError"
  | "connections"
  | "setConsent"
  | "connect"
  | "loadChatOptions"
  | "conversation"
  | "references"
  | "busy"
  | "stream"
  | "activity"
  | "permissions"
  | "selectConversation"
  | "newConversation"
  | "attach"
  | "detach"
  | "broadenTopics"
  | "send"
  | "event"
  | "answer"
> = (set, get) => ({
  chatError: null,
  connections: {},
  setConsent: async (agent, granted) =>
    serialized(async () => {
      try {
        const snapshot = await api.setConsent(agent, granted);
        set((state) => ({ ...snapshotUpdate(state, snapshot), chatError: null }));
      } catch (error) {
        set({ chatError: String(error) });
      }
    }),
  connect: async (agent, action) => {
    if (get().busy || get().switching) return;
    if (agent !== "codex") return;
    const launch = launchKey(get().snapshot, agent);
    set({
      busy: { kind: "connecting", agent },
      chatError: null,
      activity:
        action === "login" ? "ブラウザでサインインを完了してください…" : "接続を確認しています…",
    });
    try {
      const status = await api.connection(get().snapshot.project.id, agent, action);
      set((s) => ({ connections: { ...s.connections, [agent]: { status, launch } } }));
    } catch (error) {
      set({ chatError: String(error) });
    } finally {
      set({ busy: null, activity: "" });
    }
  },
  loadChatOptions: async (model) => {
    if (get().busy || get().switching) throw new Error("処理が終わってから設定してください。");
    const projectId = get().snapshot.project.id;
    set({ busy: { kind: "settings" }, activity: "モデルの選択肢を確認しています…" });
    try {
      return await api.chatOptions(projectId, model);
    } finally {
      set({ busy: null, activity: "" });
    }
  },
  conversation: null,
  references: [],
  busy: null,
  stream: "",
  activity: "",
  permissions: [],
  selectConversation: (conversation) => set({ conversation, references: [] }),
  newConversation: async (agent) => {
    const snapshot = await get().act({ type: "newConversation", agent });
    const id = snapshot?.conversations.at(-1)?.id ?? null;
    if (id) {
      get().selectConversation(id);
      set({ stream: "" });
    }
    return id;
  },
  attach: (card, quote = "") => {
    get().setChatOpen(true);
    const reference = { cardId: card.id, title: card.title, revision: card.revision, quote };
    if (get().references.length >= 20) {
      set({ error: "参照は20件までです。" });
      return;
    }
    if (
      !get().references.some(
        (r) => r.cardId === card.id && r.revision === card.revision && r.quote === quote,
      )
    )
      set({ references: [...get().references, reference] });
  },
  detach: (index) =>
    set((state) => ({ references: state.references.filter((_, i) => i !== index) })),
  broadenTopics: () => {
    if (get().busy || get().switching) return Promise.resolve(false);
    get().setChatOpen(true);
    return get().send(BROADEN_TOPICS_PROMPT, "codex", { useReferences: false });
  },
  send: async (text, agent, { useReferences = true, questionAnswers } = {}) => {
    if (get().busy || get().switching || !text.trim()) return false;
    const activeAgent =
      get().snapshot.conversations.find((c) => c.id === get().conversation)?.agent ?? agent;
    if (activeAgent !== "codex") {
      set({ chatError: "この会話は閲覧のみです。新しい会話をCodexで始めてください。" });
      return false;
    }
    if (!get().snapshot.consents.includes(activeAgent)) {
      set({ chatError: "AIへの送信に同意してください。" });
      return false;
    }
    // Lock before creating the first conversation to prevent duplicate sends on double click.
    set({
      busy: { kind: "chat", conversation: get().conversation },
      stream: "",
      activity: "接続しています…",
      error: null,
      chatError: null,
    });
    const pendingReferences = [...get().references];
    const references = useReferences ? pendingReferences : [];
    const id = get().conversation ?? (await get().newConversation(agent));
    if (!id) {
      set({ busy: null });
      return false;
    }
    set({
      busy: { kind: "chat", conversation: id },
      references: useReferences ? [] : pendingReferences,
    });
    try {
      if (questionAnswers) {
        await api.send(id, text, references, get().snapshot.project.id, questionAnswers);
      } else {
        await api.send(id, text, references, get().snapshot.project.id);
      }
      return true;
    } catch (error) {
      set({ chatError: String(error), ...(useReferences ? { references } : {}) });
      return false;
    } finally {
      await get().refresh();
      set({ busy: null, stream: "", activity: "", permissions: [] });
    }
  },
  event: (event) => {
    const busy = get().busy;
    if (busy?.kind !== "chat" || busy.conversation !== event.conversationId) return;
    if (event.kind === "delta")
      set({ stream: get().stream + event.text, activity: "応答しています…" });
    if (event.kind === "activity") set({ activity: event.text });
    if (event.kind === "permission" && event.detail && typeof event.detail === "object") {
      const detail = event.detail as Omit<Permission, "title">;
      set({
        permissions: [...get().permissions, { ...detail, title: event.text }],
        activity: "操作の確認を待っています",
      });
    }
  },
  answer: async (id, option) => {
    try {
      await api.permission(id, option);
      set({ permissions: get().permissions.filter((p) => p.id !== id) });
    } catch (error) {
      set({ error: String(error) });
    }
  },
});
