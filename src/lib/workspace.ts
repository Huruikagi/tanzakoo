import { create } from "zustand";
import { api, emptySnapshot, type AgentEvent } from "./api";
import type { Snapshot } from "@/bindings/Snapshot";
import type { BoardAction } from "@/bindings/BoardAction";
import type { Card } from "@/bindings/Card";
import type { CardReference } from "@/bindings/CardReference";

export const columns = [
  { id: "idea", title: "アイデアの山", hint: "いつか拾う、小さな種", number: "01" },
  { id: "explore", title: "検討する", hint: "気になることから", number: "02" },
  { id: "discuss", title: "話し合う", hint: "会話で掘り下げる", number: "03" },
  { id: "decided", title: "決めたこと", hint: "今の答えを残す", number: "04" },
] as const;
export type Permission = {
  id: string;
  title: string;
  request: { options: { optionId: string; name: string; kind: string }[]; toolCall: unknown };
};
type Draft = { title: string; body: string; revision: number };
export type ProjectDraft = { name: string; memory: string; revision: number };
type Workspace = {
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
  busy: string | null;
  stream: string;
  activity: string;
  permissions: Permission[];
  select: (id: string) => void;
  refresh: () => Promise<void>;
  act: (action: BoardAction) => Promise<Snapshot | null>;
  newConversation: (agent: string) => Promise<string | null>;
  attach: (card: Card, quote?: string) => void;
  draft: (id: string, value: Draft | null) => void;
  send: (text: string, agent: string) => Promise<boolean>;
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
export const useWorkspace = create<Workspace>((set, get) => ({
  snapshot: emptySnapshot,
  loaded: false,
  switching: false,
  projectDrafts: {},
  changeProject: async (id) => {
    if (get().busy || get().switching) return false;
    set({ switching: true });
    return serialized(async () => {
      try {
        const snapshot = await api.switchProject(id);
        set({
          snapshot,
          ...restoredView(snapshot),
          references: [],
          stream: "",
          permissions: [],
          error: null,
          loaded: true,
        });
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
        set({
          snapshot,
          selected: null,
          conversation: null,
          references: [],
          stream: "",
          permissions: [],
          error: null,
          loaded: true,
        });
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
  refresh: () =>
    serialized(async () => {
      try {
        const snapshot = await api.snapshot();
        set({
          snapshot,
          loaded: true,
          ...(!get().loaded || snapshot.project.id !== get().snapshot.project.id
            ? { ...restoredView(snapshot), references: [] }
            : {}),
        });
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
        set({ snapshot, error: null });
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
    if (id) set({ conversation: id, stream: "", references: [] });
    return id;
  },
  attach: (card, quote = "") => {
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
  draft: (id, value) =>
    set((state) => {
      const drafts = { ...state.drafts };
      if (value) drafts[id] = value;
      else delete drafts[id];
      return { drafts };
    }),
  send: async (text, agent) => {
    if (get().busy || get().switching || !text.trim()) return false;
    // Lock before creating the first conversation to prevent duplicate sends on double click.
    set({
      busy: get().conversation ?? "starting",
      stream: "",
      activity: "接続しています…",
      error: null,
    });
    const references = [...get().references];
    const id = get().conversation ?? (await get().newConversation(agent));
    if (!id) {
      set({ busy: null });
      return false;
    }
    set({ busy: id, references: [] });
    try {
      await api.send(id, text, references, get().snapshot.project.id);
      return true;
    } catch (error) {
      set({ error: String(error) });
      return false;
    } finally {
      await get().refresh();
      set({ busy: null, stream: "", activity: "", permissions: [] });
    }
  },
  event: (event) => {
    if (event.conversationId !== get().busy) return;
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
