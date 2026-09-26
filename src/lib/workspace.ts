import { create } from "zustand";
import { api, emptySnapshot, type AgentEvent } from "./api";
import type { Snapshot } from "@/bindings/Snapshot";
import type { BoardAction } from "@/bindings/BoardAction";
import type { Card } from "@/bindings/Card";
import type { CardReference } from "@/bindings/CardReference";
import type { ConnectionStatus } from "@/bindings/ConnectionStatus";
import type { ChatOption } from "@/bindings/ChatOption";

export const columns = [
  { id: "idea", title: "アイデアの山", number: "01" },
  { id: "explore", title: "検討する", number: "02" },
  { id: "discuss", title: "話し合う", number: "03" },
  { id: "decided", title: "決めたこと", number: "04" },
] as const;
const BROADEN_TOPICS_PROMPT =
  "話題を広げてください。既存カードとプロジェクトの前提を見て、新しい切り口の候補を3〜5枚ほど追加してください。既存カードやメモリの変更・移動は不要です。";
export type Permission = {
  id: string;
  title: string;
  request: { options: { optionId: string; name: string; kind: string }[]; toolCall: unknown };
};
type Draft = { title: string; body: string; revision: number };
/** What the single agent slot is doing. `conversation: null` means the first message is creating one. */
export type Busy =
  | { kind: "chat"; conversation: string | null }
  | { kind: "settings" }
  | { kind: "connecting"; agent: string };
/**
 * Sign-in is shared by all projects, but each project has its own launch settings.
 * A status is reused only while the current project launches the agent the same way.
 */
type Connection = { status: ConnectionStatus; launch: string };
export type ProjectDraft = { name: string; memory: string; revision: number };
type Workspace = {
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  chatError: string | null;
  /** Keyed by agent id. Read through `connectionStatus`. */
  connections: Record<string, Connection>;
  setConsent: (agent: string, granted: boolean) => Promise<void>;
  connect: (agent: string, action: "check" | "login" | "logout") => Promise<void>;
  loadChatOptions: (model: string | null) => Promise<ChatOption[]>;
  snapshot: Snapshot;
  loaded: boolean;
  switching: boolean;
  projectDrafts: Record<string, ProjectDraft>;
  changeProject: (id: string) => Promise<boolean>;
  createProject: (name: string, memory: string) => Promise<boolean>;
  selected: string | null;
  conversation: string | null;
  references: CardReference[];
  drafts: Record<string, Draft>;
  error: string | null;
  busy: Busy | null;
  stream: string;
  activity: string;
  permissions: Permission[];
  select: (id: string) => void;
  selectConversation: (id: string | null) => void;
  refresh: () => Promise<void>;
  act: (action: BoardAction) => Promise<Snapshot | null>;
  newConversation: (agent: string) => Promise<string | null>;
  attach: (card: Card, quote?: string) => void;
  detach: (index: number) => void;
  draft: (id: string, value: Draft | null) => void;
  draftProject: (id: string, value: ProjectDraft | null) => void;
  send: (text: string, agent: string, options?: { useReferences?: boolean }) => Promise<boolean>;
  broadenTopics: () => Promise<boolean>;
  event: (event: AgentEvent) => void;
  answer: (id: string, option: string | null) => Promise<void>;
};

// Serialize snapshot reads and mutations so a slow earlier read cannot overwrite a newer result.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(job: () => Promise<T>): Promise<T> {
  const task = queue.then(job, job);
  queue = task.catch(() => {});
  return task;
}
function launchKey(snapshot: Snapshot, agent: string) {
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
function restoredView(snapshot: Snapshot) {
  let view: { selected?: string | null; conversation?: string | null } = {};
  try {
    view = JSON.parse(localStorage.getItem(`tanzakoo-view-${snapshot.project.id}`) ?? "{}");
  } catch {
    /* Optional UI preferences. */
  }
  return {
    selected: snapshot.cards.some((c) => c.id === view?.selected) ? view.selected! : null,
    conversation:
      view?.conversation === null
        ? null
        : snapshot.conversations.some((c) => c.id === view?.conversation)
          ? view.conversation!
          : (snapshot.conversations.at(-1)?.id ?? null),
  };
}
function syncedDrafts(previous: Snapshot, snapshot: Snapshot, drafts: Record<string, Draft>) {
  if (previous.project.id !== snapshot.project.id) return drafts;
  const result = { ...drafts };
  for (const card of snapshot.cards) {
    const draft = drafts[card.id];
    const before = previous.cards.find((c) => c.id === card.id);
    // A column-only move must not turn an in-progress content edit into a conflict.
    if (
      draft &&
      before?.revision === draft.revision &&
      before.title === card.title &&
      before.body === card.body &&
      before.deleted === card.deleted
    ) {
      result[card.id] = { ...draft, revision: card.revision };
    }
  }
  return result;
}
/** All saved-board responses reconcile content drafts using the same revision rules. */
function snapshotUpdate(state: Workspace, snapshot: Snapshot) {
  return { snapshot, drafts: syncedDrafts(state.snapshot, snapshot, state.drafts) };
}
function projectView(snapshot: Snapshot, view = restoredView(snapshot)) {
  return {
    ...view,
    references: [],
    stream: "",
    permissions: [],
    error: null,
    chatError: null,
    loaded: true,
  };
}
export const useWorkspace = create<Workspace>((set, get) => ({
  chatOpen: (() => {
    try {
      return localStorage.getItem("tanzakoo-chat-open") === "true";
    } catch {
      return false;
    }
  })(),
  setChatOpen: (chatOpen) => {
    set({ chatOpen });
    try {
      localStorage.setItem("tanzakoo-chat-open", String(chatOpen));
    } catch {
      /* Optional UI preference. */
    }
  },
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
  snapshot: emptySnapshot,
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
  loaded: false,
  switching: false,
  projectDrafts: {},
  changeProject: async (id) => {
    if (get().busy || get().switching) return false;
    set({ switching: true });
    return serialized(async () => {
      try {
        const snapshot = await api.switchProject(id);
        set((state) => ({ ...snapshotUpdate(state, snapshot), ...projectView(snapshot) }));
        return true;
      } catch (error) {
        set({ error: String(error) });
        return false;
      } finally {
        set({ switching: false });
      }
    });
  },
  createProject: async (name, memory) => {
    if (get().busy || get().switching) return false;
    set({ switching: true });
    return serialized(async () => {
      try {
        const snapshot = await api.createProject(name, memory);
        set((state) => ({
          ...snapshotUpdate(state, snapshot),
          ...projectView(snapshot, { selected: null, conversation: null }),
        }));
        return true;
      } catch (error) {
        set({ error: String(error) });
        return false;
      } finally {
        set({ switching: false });
      }
    });
  },
  selected: null,
  conversation: null,
  references: [],
  drafts: {},
  error: null,
  busy: null,
  stream: "",
  activity: "",
  permissions: [],
  select: (id) => set({ selected: id }),
  selectConversation: (conversation) => set({ conversation, references: [] }),
  refresh: () =>
    serialized(async () => {
      try {
        const snapshot = await api.snapshot();
        set((state) => ({
          ...snapshotUpdate(state, snapshot),
          loaded: true,
          ...(!state.loaded || snapshot.project.id !== state.snapshot.project.id
            ? { ...restoredView(snapshot), references: [] }
            : {}),
        }));
      } catch (error) {
        set({ error: String(error), loaded: true });
      }
    }),
  act: (action) => {
    if (get().switching) return Promise.resolve(null);
    const projectId = get().snapshot.project.id;
    return serialized(async () => {
      try {
        const snapshot = await api.action(action, projectId);
        set((state) => ({
          ...snapshotUpdate(state, snapshot),
          error: null,
        }));
        if (action.type === "configureAgent") {
          const agent = action.config.id;
          set((s) => ({
            connections: {
              ...s.connections,
              [agent]: {
                status: {
                  state: "unknown",
                  message: "設定を変更しました。接続を確認してください。",
                  canLogin: false,
                },
                launch: launchKey(snapshot, agent),
              },
            },
          }));
        }
        return snapshot;
      } catch (error) {
        set({ error: String(error) });
        return null;
      }
    });
  },
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
  draftProject: (id, value) =>
    set((state) => {
      const projectDrafts = { ...state.projectDrafts };
      if (value) projectDrafts[id] = value;
      else delete projectDrafts[id];
      return { projectDrafts };
    }),
  draft: (id, value) =>
    set((state) => {
      const drafts = { ...state.drafts };
      if (value) drafts[id] = value;
      else delete drafts[id];
      return { drafts };
    }),
  broadenTopics: () => {
    if (get().busy || get().switching) return Promise.resolve(false);
    get().setChatOpen(true);
    return get().send(BROADEN_TOPICS_PROMPT, "codex", { useReferences: false });
  },
  send: async (text, agent, { useReferences = true } = {}) => {
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
      await api.send(id, text, references, get().snapshot.project.id);
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
}));

// Only remember navigation, not chat or unsaved content, in browser storage.
useWorkspace.subscribe((state, previous) => {
  const id = state.snapshot.project.id;
  if (
    !id ||
    (id === previous.snapshot.project.id &&
      state.selected === previous.selected &&
      state.conversation === previous.conversation)
  )
    return;
  try {
    localStorage.setItem(
      `tanzakoo-view-${id}`,
      JSON.stringify({ selected: state.selected, conversation: state.conversation }),
    );
  } catch {
    /* The database remains usable without UI preferences. */
  }
});

export function moveCard(
  cards: Card[],
  id: string,
  status: Card["status"],
  index: number,
): Card | null {
  const card = cards.find((c) => c.id === id && !c.deleted);
  if (!card) return null;
  const others = cards
    .filter((c) => c.id !== id && !c.deleted && c.status === status)
    .sort((a, b) => a.position - b.position);
  const next = others[Math.max(0, index)];
  const previous = others[Math.max(0, index) - 1];
  const position =
    previous && next
      ? (previous.position + next.position) / 2
      : next
        ? next.position - 1
        : (previous?.position ?? others.at(-1)?.position ?? 0) + 1;
  return { ...card, status, position };
}
