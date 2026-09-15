import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/bindings/Card";
import { api, emptySnapshot } from "./api";
import { moveCard, useWorkspace } from "./workspace";
vi.mock("./api", () => ({
  emptySnapshot: { cards: [], proposals: [], conversations: [], messages: [], agents: [] },
  api: { action: vi.fn(), snapshot: vi.fn(), send: vi.fn(), permission: vi.fn() },
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
  useWorkspace.setState({
    snapshot: { ...emptySnapshot, cards: [card] },
    loaded: true,
    selected: card.id,
    conversation: null,
    references: [],
    drafts: {},
    busy: null,
    stream: "",
    permissions: [],
    error: null,
  });
});
describe("card references and drafts", () => {
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
  it("creates one conversation on double submit and sends explicit references", async () => {
    const conversation = { id: "c1", title: "new", agent: "claude", sessionId: null, createdAt: 1 };
    vi.mocked(api.action).mockResolvedValue({ ...emptySnapshot, conversations: [conversation] });
    vi.mocked(api.snapshot).mockResolvedValue({ ...emptySnapshot, conversations: [conversation] });
    vi.mocked(api.send).mockResolvedValue();
    useWorkspace.getState().attach(card);
    const a = useWorkspace.getState().send("TODOアプリを考えたい", "claude");
    const b = useWorkspace.getState().send("TODOアプリを考えたい", "claude");
    expect(await b).toBe(false);
    expect(await a).toBe(true);
    expect(api.action).toHaveBeenCalledTimes(1);
    expect(api.send).toHaveBeenCalledWith("c1", "TODOアプリを考えたい", [
      { cardId: card.id, title: card.title, revision: 1, quote: "" },
    ]);
    expect(useWorkspace.getState().busy).toBeNull();
  });
  it("keeps a new conversation empty across refresh and unlocks after connection failure", async () => {
    vi.mocked(api.snapshot).mockResolvedValue({
      ...emptySnapshot,
      conversations: [{ id: "old", title: "old", agent: "codex", sessionId: null, createdAt: 1 }],
    });
    await useWorkspace.getState().refresh();
    expect(useWorkspace.getState().conversation).toBeNull();
    useWorkspace.setState({ conversation: "old" });
    vi.mocked(api.send).mockRejectedValue("接続失敗");
    expect(await useWorkspace.getState().send("test", "codex")).toBe(false);
    expect(useWorkspace.getState().busy).toBeNull();
    expect(useWorkspace.getState().error).toBe("接続失敗");
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
