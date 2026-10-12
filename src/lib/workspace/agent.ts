import { t } from "@/lib/i18n";
import { api, agentUnavailable } from "../api";
import type { WorkspaceSlice, Busy, Permission } from "./types";
const BROADEN_TOPICS_PROMPT =
  "話題を広げてください。既存カードとプロジェクトの前提を見て、新しい切り口の候補を3〜5枚ほど追加してください。既存カードやメモリの変更・移動は不要です。";
/** Whether the chat for `conversation` (null: a new chat) is the one currently running. */
export function chatRunning(busy: Busy | null, conversation: string | null) {
  return (
    busy?.kind === "chat" && (busy.conversation === null || busy.conversation === conversation)
  );
}

export const createAgentSlice: WorkspaceSlice<
  | "newChatAgent"
  | "setNewChatAgent"
  | "chatError"
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
  newChatAgent: "codex",
  setNewChatAgent: (agent) => {
    if (!get().busy && !agentUnavailable(get().snapshot, agent))
      set({ newChatAgent: agent, chatError: null });
  },
  chatError: null,
  conversation: null,
  references: [],
  busy: null,
  stream: "",
  activity: "",
  permissions: [],
  selectConversation: (conversation) => set({ conversation, references: [], chatError: null }),
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
      set({ error: t("参照は20件までです。") });
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
    return get().send(t(BROADEN_TOPICS_PROMPT), get().newChatAgent, { useReferences: false });
  },
  send: async (text, agent, { useReferences = true, questionAnswers } = {}) => {
    if (get().busy || get().switching || !text.trim()) return false;
    const activeAgent =
      get().snapshot.conversations.find((c) => c.id === get().conversation)?.agent ?? agent;
    if (agentUnavailable(get().snapshot, activeAgent)) {
      set({ chatError: t("この会話は閲覧のみです。新しい会話をCodexで始めてください。") });
      return false;
    }
    if (activeAgent !== "codex" && get().reviewAccess) {
      set({ chatError: t("先に審査用接続を解除してください。") });
      return false;
    }
    if (!get().reviewAccess && !get().snapshot.consents.includes(activeAgent)) {
      set({ chatError: t("AIへの送信に同意してください。") });
      return false;
    }
    if (activeAgent === "codex" && !get().reviewAccess && !get().planStatus?.active?.signedIn) {
      set({ chatError: t("接続状況からChatGPTでサインインしてください。") });
      return false;
    }
    if (get().reviewAccess && get().reviewAccess!.expiresAt <= Date.now()) {
      set({
        chatError: t(
          "審査用コードの有効期限が切れています。接続状況から新しいコードを入力してください。",
        ),
      });
      return false;
    }
    // Lock before creating the first conversation to prevent duplicate sends on double click.
    set({
      busy: { kind: "chat", conversation: get().conversation },
      stream: "",
      activity: t("接続しています…"),
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
      set({ stream: get().stream + event.text, activity: t("応答しています…") });
    if (event.kind === "activity") set({ activity: event.text });
    if (event.kind === "permission" && event.detail && typeof event.detail === "object") {
      const detail = event.detail as Omit<Permission, "title">;
      set({
        permissions: [...get().permissions, { ...detail, title: event.text }],
        activity: t("操作の確認を待っています"),
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
