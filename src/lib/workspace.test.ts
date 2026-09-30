import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/bindings/Card";
import { api, emptySnapshot } from "./api";
import { connectionStatus, moveCard, useWorkspace } from "./workspace";
vi.mock("./api", () => ({
  emptySnapshot: {
    project: { id: "a", name: "A", memory: "", revision: 1 },
    projects: [],
    memoryProposals: [],
    cards: [],
    proposals: [],
    conversations: [],
    messages: [],
    discussions: [],
    questions: [],
    agents: [],
    consents: [],
  },
  api: {
    action: vi.fn(),
    snapshot: vi.fn(),
    send: vi.fn(),
    permission: vi.fn(),
    switchProject: vi.fn(),
    createProject: vi.fn(),
    deleteProject: vi.fn(),
    connection: vi.fn(),
    setConsent: vi.fn(),
  },
}));
export const card: Card = {
  id: "card-a",
  title: "利用場面",
  body: "毎朝の確認",
  status: "idea",
  revision: 1,
  position: 1,
  source: "codex",
  deleted: false,
  createdAt: 1,
  updatedAt: 1,
};
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  useWorkspace.setState({
    snapshot: { ...emptySnapshot, cards: [card], consents: ["codex", "claude"] },
    loaded: true,
    switching: false,
    selected: card.id,
    conversation: null,
    references: [],
    drafts: {},
    projectDrafts: {},
    busy: null,
    stream: "",
    permissions: [],
    error: null,
    chatError: null,
    connections: {},
    reviewAccess: null,
    planStatus: {
      available: true,
      accounts: [],
      active: { id: "account-a", label: "Account A", signedIn: true },
      warning: null,
    },
    archivePending: false,
    archiveNotice: null,
  });
});
it.each([null, { id: "account-a", label: "Account A", signedIn: false }])(
  "blocks sending without a signed-in ChatGPT account before creating a conversation",
  async (active) => {
    useWorkspace.setState({
      planStatus: { available: true, accounts: [], active, warning: null },
      references: [{ cardId: card.id, title: card.title, revision: 1, quote: "" }],
    });
    expect(await useWorkspace.getState().send("保存したい下書き", "codex")).toBe(false);
    expect(api.action).not.toHaveBeenCalled();
    expect(api.send).not.toHaveBeenCalled();
    expect(api.connection).not.toHaveBeenCalled();
    expect(useWorkspace.getState().references).toHaveLength(1);
    expect(useWorkspace.getState().chatError).toBe("接続状況からChatGPTでサインインしてください。");
  },
);
it("rechecks unsaved edits when a queued batch starts", async () => {
  const proposal = {
    id: "p",
    cardId: card.id,
    baseRevision: card.revision,
    beforeTitle: card.title,
    beforeBody: card.body,
    title: card.title,
    body: "提案",
    reason: "会話を反映",
    state: "pending",
    createdAt: 1,
  };
  const snapshot = { ...emptySnapshot, cards: [card], proposals: [proposal] };
  useWorkspace.setState({ snapshot });
  let finish!: (snapshot: typeof emptySnapshot) => void;
  vi.mocked(api.snapshot)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(snapshot);
  const refreshing = useWorkspace.getState().refresh();
  const approving = useWorkspace.getState().act({ type: "applyProposals", ids: [proposal.id] });
  useWorkspace.getState().draft(card.id, { title: card.title, body: "編集中", revision: 1 });
  await Promise.resolve();
  finish(snapshot);
  await refreshing;
  expect(await approving).toBeNull();
  expect(api.action).not.toHaveBeenCalled();
  expect(useWorkspace.getState().drafts[card.id]?.body).toBe("編集中");
  expect(useWorkspace.getState().error).toContain("未保存の編集があります");
});

describe("card archive", () => {
  it("uses the latest saved card after a queued edit and prevents duplicate submissions", async () => {
    let finish!: (snapshot: typeof emptySnapshot) => void;
    const updated = {
      ...card,
      body: "保存された新しい内容",
      status: "explore" as const,
      revision: 2,
    };
    vi.mocked(api.action)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValueOnce({
        ...emptySnapshot,
        cards: [{ ...updated, deleted: true, revision: 3 }],
      });
    const saving = useWorkspace
      .getState()
      .act({ type: "updateCard", card: { ...card, body: updated.body } });
    const archiving = useWorkspace.getState().setArchived(card.id, true);
    await useWorkspace.getState().setArchived(card.id, true);
    finish({ ...emptySnapshot, cards: [updated] });
    await Promise.all([saving, archiving]);
    expect(api.action).toHaveBeenCalledTimes(2);
    expect(api.action).toHaveBeenLastCalledWith(
      { type: "updateCard", card: { ...updated, deleted: true } },
      "a",
    );
    expect(useWorkspace.getState().archiveNotice).toEqual({
      projectId: "a",
      cardId: card.id,
      revision: 3,
    });
  });
  it("keeps a failed restore archived and clears undo when changing projects", async () => {
    const archived = { ...card, deleted: true, revision: 2 };
    const notice = { projectId: "a", cardId: card.id, revision: 2 };
    useWorkspace.setState({
      snapshot: { ...emptySnapshot, cards: [archived] },
      archiveNotice: notice,
    });
    vi.mocked(api.action).mockRejectedValue(new Error("復元失敗"));
    await useWorkspace.getState().setArchived(card.id, false);
    expect(useWorkspace.getState().snapshot.cards[0]).toEqual(archived);
    expect(useWorkspace.getState().archiveNotice).toEqual(notice);
    vi.mocked(api.switchProject).mockResolvedValue({
      ...emptySnapshot,
      project: { id: "b", name: "B", memory: "", revision: 1 },
    });
    await useWorkspace.getState().changeProject("b");
    expect(useWorkspace.getState().archiveNotice).toBeNull();
  });
});
describe("card references and drafts", () => {
  it("reconciles drafts when a consent response includes a concurrent column move", async () => {
    useWorkspace.getState().draft(card.id, { title: card.title, body: "編集中", revision: 1 });
    vi.mocked(api.setConsent).mockResolvedValue({
      ...emptySnapshot,
      cards: [{ ...card, status: "discuss", revision: 2 }],
    });
    await useWorkspace.getState().setConsent("codex", true);
    expect(useWorkspace.getState().drafts[card.id]).toEqual({
      title: card.title,
      body: "編集中",
      revision: 2,
    });
  });
  it("keeps a content draft editable when only the card's column changes", async () => {
    useWorkspace
      .getState()
      .draft(card.id, { title: card.title, body: "編集中の本文", revision: 1 });
    vi.mocked(api.snapshot).mockResolvedValue({
      ...emptySnapshot,
      cards: [{ ...card, status: "discuss", revision: 2 }],
    });
    await useWorkspace.getState().refresh();
    expect(useWorkspace.getState().drafts[card.id]).toEqual({
      title: card.title,
      body: "編集中の本文",
      revision: 2,
    });
    expect(useWorkspace.getState().selected).toBe(card.id);
  });
  it("keeps a revision-specific quote when the card changes, without approving a change", () => {
    useWorkspace.getState().attach(card, "毎朝");
    useWorkspace.getState().attach(card, "毎朝");
    useWorkspace.setState({
      snapshot: { ...emptySnapshot, cards: [{ ...card, body: "夜", revision: 2 }] },
    });
    expect(useWorkspace.getState().references).toEqual([
      { cardId: card.id, title: card.title, revision: 1, quote: "毎朝" },
    ]);
    expect(api.action).not.toHaveBeenCalled();
  });
  it("keeps unsaved edits when a background snapshot changes", async () => {
    useWorkspace.getState().draft(card.id, { title: card.title, body: "私の下書き", revision: 1 });
    vi.mocked(api.snapshot).mockResolvedValue({
      ...emptySnapshot,
      cards: [{ ...card, body: "別の変更", revision: 2 }],
    });
    await useWorkspace.getState().refresh();
    expect(useWorkspace.getState().drafts[card.id]).toEqual({
      title: card.title,
      body: "私の下書き",
      revision: 1,
    });
  });
});
describe("chat lifecycle", () => {
  it.each([null, "c1"])(
    "broadens the board in %s without consuming references or duplicating sends",
    async (selected) => {
      const conversation = {
        id: "c1",
        title: "new",
        agent: "codex",
        sessionId: null,
        createdAt: 1,
      };
      const snapshot = { ...useWorkspace.getState().snapshot, conversations: [conversation] };
      if (selected) useWorkspace.setState({ snapshot, conversation: selected });
      useWorkspace.getState().attach(card);
      const references = useWorkspace.getState().references;
      useWorkspace.setState({ chatOpen: false });
      vi.mocked(api.action).mockResolvedValue(snapshot);
      vi.mocked(api.snapshot).mockResolvedValue(snapshot);
      let finish!: () => void;
      vi.mocked(api.send).mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const first = useWorkspace.getState().broadenTopics();
      expect(await useWorkspace.getState().broadenTopics()).toBe(false);
      await vi.waitFor(() => expect(api.send).toHaveBeenCalledOnce());
      expect(api.send).toHaveBeenCalledWith(
        "c1",
        expect.stringContaining("話題を広げてください"),
        [],
        "a",
      );
      expect(useWorkspace.getState().chatOpen).toBe(true);
      expect(useWorkspace.getState().references).toEqual(references);
      expect(useWorkspace.getState().busy).toEqual({ kind: "chat", conversation: "c1" });
      finish();
      expect(await first).toBe(true);
      expect(useWorkspace.getState().references).toEqual(references);
      expect(useWorkspace.getState().busy).toBeNull();
      expect(api.action).toHaveBeenCalledTimes(selected ? 0 : 1);
    },
  );
  it("opens consent guidance without sending and leaves references intact on failure", async () => {
    useWorkspace.getState().attach(card);
    const references = useWorkspace.getState().references;
    useWorkspace.setState((s) => ({ snapshot: { ...s.snapshot, consents: [] }, chatOpen: false }));
    expect(await useWorkspace.getState().broadenTopics()).toBe(false);
    expect(useWorkspace.getState().chatOpen).toBe(true);
    expect(useWorkspace.getState().chatError).toContain("同意");
    expect(api.send).not.toHaveBeenCalled();
    expect(api.action).not.toHaveBeenCalled();
    const snapshot = {
      ...useWorkspace.getState().snapshot,
      consents: ["codex"],
      conversations: [{ id: "c", title: "new", agent: "codex", sessionId: null, createdAt: 1 }],
    };
    useWorkspace.setState({ snapshot, conversation: "c" });
    vi.mocked(api.send).mockRejectedValue("接続失敗");
    vi.mocked(api.snapshot).mockResolvedValue(snapshot);
    expect(await useWorkspace.getState().broadenTopics()).toBe(false);
    expect(useWorkspace.getState().chatError).toBe("接続失敗");
    expect(useWorkspace.getState().references).toEqual(references);
    expect(useWorkspace.getState().busy).toBeNull();
  });
  it("clears references on every conversation selection without losing content drafts", () => {
    useWorkspace.getState().draft(card.id, { title: card.title, body: "編集中", revision: 1 });
    for (const id of ["history", null]) {
      useWorkspace.getState().attach(card);
      useWorkspace.getState().selectConversation(id);
      expect(useWorkspace.getState().conversation).toBe(id);
      expect(useWorkspace.getState().references).toEqual([]);
      expect(useWorkspace.getState().drafts[card.id].body).toBe("編集中");
    }
  });
  it("creates one conversation on double submit and sends explicit references", async () => {
    const conversation = { id: "c1", title: "new", agent: "codex", sessionId: null, createdAt: 1 };
    vi.mocked(api.action).mockResolvedValue({ ...emptySnapshot, conversations: [conversation] });
    vi.mocked(api.snapshot).mockResolvedValue({ ...emptySnapshot, conversations: [conversation] });
    vi.mocked(api.send).mockResolvedValue();
    useWorkspace.getState().attach(card);
    const a = useWorkspace.getState().send("TODOアプリを考えたい", "codex");
    const b = useWorkspace.getState().send("TODOアプリを考えたい", "codex");
    expect(await b).toBe(false);
    expect(await a).toBe(true);
    expect(api.action).toHaveBeenCalledTimes(1);
    expect(api.send).toHaveBeenCalledWith(
      "c1",
      "TODOアプリを考えたい",
      [{ cardId: card.id, title: card.title, revision: 1, quote: "" }],
      "a",
    );
    expect(useWorkspace.getState().busy).toBeNull();
  });
  it("keeps a new conversation empty across refresh and unlocks after connection failure", async () => {
    vi.mocked(api.snapshot).mockResolvedValue({
      ...emptySnapshot,
      consents: ["codex"],
      conversations: [{ id: "old", title: "old", agent: "codex", sessionId: null, createdAt: 1 }],
    });
    await useWorkspace.getState().refresh();
    expect(useWorkspace.getState().conversation).toBeNull();
    useWorkspace.setState({ conversation: "old" });
    vi.mocked(api.send).mockRejectedValue("接続失敗");
    expect(await useWorkspace.getState().send("test", "codex")).toBe(false);
    expect(useWorkspace.getState().busy).toBeNull();
    expect(useWorkspace.getState().chatError).toBe("接続失敗");
    expect(useWorkspace.getState().error).toBeNull();
  });
});
describe("connection status", () => {
  const codex = { id: "codex", command: "@tanzakoo/managed", args: [] };
  const ready = { state: "ready", message: "接続できました。", canLogin: true };
  it("is shared across projects only while they launch the agent the same way", async () => {
    useWorkspace.setState((s) => ({ snapshot: { ...s.snapshot, agents: [codex] } }));
    vi.mocked(api.connection).mockResolvedValue(ready);
    await useWorkspace.getState().connect("codex", "check");
    const other = { ...emptySnapshot, project: { ...emptySnapshot.project, id: "b" } };
    useWorkspace.setState({ snapshot: { ...other, agents: [codex] } });
    expect(connectionStatus(useWorkspace.getState(), "codex")).toEqual(ready);
    useWorkspace.setState({
      snapshot: { ...other, agents: [{ ...codex, command: "node", args: ["custom.mjs"] }] },
    });
    expect(connectionStatus(useWorkspace.getState(), "codex")).toBeUndefined();
  });
  it("replaces a signed-in status for every matching project after sign-out", async () => {
    useWorkspace.setState((s) => ({ snapshot: { ...s.snapshot, agents: [codex] } }));
    vi.mocked(api.connection).mockResolvedValueOnce(ready).mockResolvedValueOnce({
      state: "authRequired",
      message: "サインアウトしました。",
      canLogin: true,
    });
    await useWorkspace.getState().connect("codex", "check");
    await useWorkspace.getState().connect("codex", "logout");
    const other = { ...emptySnapshot, project: { ...emptySnapshot.project, id: "b" } };
    useWorkspace.setState({ snapshot: { ...other, agents: [codex] } });
    expect(connectionStatus(useWorkspace.getState(), "codex")?.state).toBe("authRequired");
  });
});
describe("project isolation", () => {
  it("deletes only the active project's drafts and restores the remaining project's selection", async () => {
    useWorkspace.setState({
      questionDrafts: {
        a: { q: { mode: "text", optionIndex: null, text: "Aの回答" } },
        b: { q: { mode: "text", optionIndex: null, text: "Bの回答" } },
      },
      projectDrafts: {
        a: { name: "A", memory: "A draft", revision: 1 },
        b: { name: "B", memory: "B draft", revision: 1 },
      },
      drafts: {
        [card.id]: { title: "A", body: "A draft", revision: 1 },
        other: { title: "B", body: "B draft", revision: 1 },
      },
    });
    useWorkspace.getState().attach(card);
    localStorage.setItem(
      "tanzakoo-view-b",
      JSON.stringify({ selected: "other", conversation: null }),
    );
    localStorage.setItem("tanzakoo-view-a", "{}");
    const snapshot = {
      ...emptySnapshot,
      project: { ...emptySnapshot.project, id: "b" },
      cards: [{ ...card, id: "other" }],
    };
    vi.mocked(api.deleteProject).mockResolvedValue({
      snapshot,
      warning: "ファイル消去を再試行します",
    });
    expect(await useWorkspace.getState().deleteProject("a")).toBe(true);
    expect(useWorkspace.getState().snapshot).toBe(snapshot);
    expect(useWorkspace.getState().selected).toBe("other");
    expect(useWorkspace.getState().references).toEqual([]);
    expect(Object.keys(useWorkspace.getState().drafts)).toEqual(["other"]);
    expect(Object.keys(useWorkspace.getState().projectDrafts)).toEqual(["b"]);
    expect(Object.keys(useWorkspace.getState().questionDrafts)).toEqual(["b"]);
    expect(useWorkspace.getState().questionDrafts.b?.q?.text).toBe("Bの回答");
    expect(localStorage.getItem("tanzakoo-view-a")).toBeNull();
    expect(useWorkspace.getState().error).toContain("再試行");
  });
  it("blocks stale deletion, deletion during agent work, and duplicate requests", async () => {
    expect(await useWorkspace.getState().deleteProject("b")).toBe(false);
    for (const busy of [
      { kind: "chat", conversation: "c" },
      { kind: "connecting", agent: "codex" },
      { kind: "settings" },
    ] as const) {
      useWorkspace.setState({ busy });
      expect(await useWorkspace.getState().deleteProject("a")).toBe(false);
    }
    expect(api.deleteProject).not.toHaveBeenCalled();
    useWorkspace.setState({ busy: null });
    let reject!: (error: string) => void;
    vi.mocked(api.deleteProject).mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    const deleting = useWorkspace.getState().deleteProject("a");
    expect(await useWorkspace.getState().deleteProject("a")).toBe(false);
    expect(await useWorkspace.getState().changeProject("b")).toBe(false);
    expect(await useWorkspace.getState().send("hello", "codex")).toBe(false);
    await vi.waitFor(() => expect(api.deleteProject).toHaveBeenCalledOnce());
    reject("失敗");
    expect(await deleting).toBe(false);
    expect(useWorkspace.getState().snapshot.project.id).toBe("a");
    expect(useWorkspace.getState().switching).toBe(false);
  });
  it("does not route legacy Claude history to Codex or start a Claude connection", async () => {
    useWorkspace.setState({
      conversation: "legacy",
      snapshot: {
        ...emptySnapshot,
        conversations: [
          { id: "legacy", title: "old", agent: "claude", sessionId: null, createdAt: 1 },
        ],
      },
    });
    expect(await useWorkspace.getState().send("続けたい", "codex")).toBe(false);
    await useWorkspace.getState().connect("claude", "check");
    expect(api.send).not.toHaveBeenCalled();
    expect(api.connection).not.toHaveBeenCalled();
    expect(api.action).not.toHaveBeenCalled();
  });
  it("does not send or create a conversation before consent", async () => {
    useWorkspace.setState((s) => ({ snapshot: { ...s.snapshot, consents: [] } }));
    expect(await useWorkspace.getState().send("test", "codex")).toBe(false);
    expect(api.send).not.toHaveBeenCalled();
    expect(api.action).not.toHaveBeenCalled();
  });
  it("locks project switching during login and releases it after cancellation", async () => {
    let finish!: (value: { state: string; message: string; canLogin: boolean }) => void;
    vi.mocked(api.connection).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const connecting = useWorkspace.getState().connect("codex", "login");
    expect(await useWorkspace.getState().changeProject("b")).toBe(false);
    expect(await useWorkspace.getState().send("test", "codex")).toBe(false);
    finish({ state: "unknown", message: "中止", canLogin: false });
    await connecting;
    expect(useWorkspace.getState().busy).toBeNull();
    expect(api.send).not.toHaveBeenCalled();
    expect(api.switchProject).not.toHaveBeenCalled();
  });
  it("clears references, restores navigation, and preserves project-specific drafts on a round trip", async () => {
    const a = useWorkspace.getState().snapshot;
    useWorkspace.setState({ conversation: null });
    useWorkspace.getState().select("other");
    useWorkspace.getState().select(card.id);
    useWorkspace.getState().attach(card);
    useWorkspace.getState().draft(card.id, { title: card.title, body: "Aの下書き", revision: 1 });
    const b = { ...emptySnapshot, project: { id: "b", name: "B", memory: "Bの前提", revision: 1 } };
    vi.mocked(api.switchProject).mockResolvedValueOnce(b).mockResolvedValueOnce(a);
    expect(await useWorkspace.getState().changeProject("b")).toBe(true);
    expect(useWorkspace.getState().references).toEqual([]);
    expect(useWorkspace.getState().selected).toBeNull();
    expect(useWorkspace.getState().snapshot.cards).toEqual([]);
    expect(await useWorkspace.getState().changeProject("a")).toBe(true);
    expect(useWorkspace.getState().selected).toBe(card.id);
    expect(useWorkspace.getState().drafts[card.id].body).toBe("Aの下書き");
  });
  it("blocks switching during a response and blocks sends while switching", async () => {
    useWorkspace.setState({ busy: { kind: "chat", conversation: "running" } });
    expect(await useWorkspace.getState().changeProject("b")).toBe(false);
    expect(api.switchProject).not.toHaveBeenCalled();
    useWorkspace.setState({ busy: null });
    let finish!: (snapshot: typeof emptySnapshot) => void;
    vi.mocked(api.switchProject).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const switching = useWorkspace.getState().changeProject("b");
    expect(await useWorkspace.getState().send("混入させない", "codex")).toBe(false);
    await Promise.resolve();
    finish({ ...emptySnapshot, project: { ...emptySnapshot.project, id: "b" } });
    expect(await switching).toBe(true);
    expect(api.send).not.toHaveBeenCalled();
  });
});
it("moves into empty columns and between cards without changing other cards", () => {
  const cards = [card, { ...card, id: "b", position: 2 }, { ...card, id: "c", position: 3 }];
  expect(moveCard(cards, "c", "idea", 1)?.position).toBe(1.5);
  expect(moveCard(cards, "card-a", "explore", 0)).toMatchObject({
    status: "explore",
    position: 1,
    revision: 1,
  });
  expect(cards[0].status).toBe("idea");
});
