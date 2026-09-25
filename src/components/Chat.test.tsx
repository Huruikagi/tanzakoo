import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chat } from "./Chat";
import { useWorkspace } from "@/lib/workspace";
import { api, emptySnapshot } from "@/lib/api";
import type { Card } from "@/bindings/Card";
import type { Discussion } from "@/bindings/Discussion";
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  native: true,
  emptySnapshot: {
    project: { id: "a", name: "A", memory: "", revision: 1 },
    projects: [],
    memoryProposals: [],
    cards: [],
    proposals: [],
    conversations: [],
    messages: [],
    discussions: [],
    agents: [],
    consents: [],
  },
  api: {
    action: vi.fn(),
    snapshot: vi.fn(),
    send: vi.fn(),
    cancel: vi.fn(),
    connection: vi.fn(),
    setConsent: vi.fn(),
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  useWorkspace.setState({
    loaded: true,
    snapshot: emptySnapshot,
    busy: null,
    conversation: null,
    references: [],
    permissions: [],
    stream: "",
    activity: "",
    error: null,
    chatError: null,
    connections: {},
    selected: null,
    switching: false,
  });
});

const topic: Card = {
  id: "topic",
  title: "通知のタイミング",
  body: "いつ通知する？",
  status: "discuss",
  revision: 2,
  position: 1,
  source: "user",
  deleted: false,
  createdAt: 1,
  updatedAt: 2,
};
const discussion: Discussion = {
  id: "discussion",
  conversationId: "c",
  messageId: "m",
  cardId: "topic",
  title: topic.title,
  reason: "通知の具体的な希望を話している",
  previousStatus: "idea",
  previousPosition: 1,
  cardRevision: 2,
  state: "moved",
  automatic: true,
};
function discussionSnapshot() {
  return {
    ...emptySnapshot,
    cards: [topic],
    conversations: [{ id: "c", title: "通知", agent: "codex", sessionId: null, createdAt: 1 }],
    messages: [
      {
        id: "m",
        conversationId: "c",
        role: "user",
        text: "朝に通知してほしい",
        references: [],
        createdAt: 1,
      },
    ],
    discussions: [] as Discussion[],
  };
}

it("shows an automatic move without navigating, scrolling or disturbing the composer", async () => {
  const user = userEvent.setup();
  const snapshot = discussionSnapshot();
  useWorkspace.setState({ snapshot, conversation: "c" });
  render(<Chat />);
  await user.type(screen.getByLabelText("エージェントへのメッセージ"), "考え中の下書き");
  vi.mocked(Element.prototype.scrollIntoView).mockClear();
  act(() => useWorkspace.setState({ snapshot: { ...snapshot, discussions: [discussion] } }));
  expect(screen.getByRole("button", { name: "元に戻す" })).toBeEnabled();
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  expect(useWorkspace.getState().selected).toBeNull();
  expect(screen.getByLabelText("エージェントへのメッセージ")).toHaveFocus();
  expect(screen.getByLabelText("エージェントへのメッセージ")).toHaveValue("考え中の下書き");
  await user.click(screen.getByRole("button", { name: "「通知のタイミング」" }));
  expect(useWorkspace.getState().selected).toBe(topic.id);
  expect(api.action).not.toHaveBeenCalled();
  vi.mocked(api.action).mockResolvedValue({
    ...snapshot,
    cards: [{ ...topic, status: "idea", revision: 3 }],
    discussions: [{ ...discussion, state: "undone" }],
  });
  await user.click(screen.getByRole("button", { name: "元に戻す" }));
  expect(api.action).toHaveBeenCalledWith(
    { type: "resolveDiscussion", id: discussion.id, action: "undo" },
    "a",
  );
  expect(screen.getByText(/の移動を取り消しました/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "元に戻す" })).not.toBeInTheDocument();
});

it.each(["idea", "decided"] as const)(
  "waits for a UI choice for a suggested %s card",
  async (status) => {
    const user = userEvent.setup();
    const snapshot = {
      ...discussionSnapshot(),
      cards: [{ ...topic, status }],
      discussions: [
        { ...discussion, state: "suggested" as const, previousStatus: status, automatic: false },
      ],
    };
    useWorkspace.setState({ snapshot, conversation: "c" });
    render(<Chat />);
    expect(api.action).not.toHaveBeenCalled();
    expect(useWorkspace.getState().snapshot.cards[0].status).toBe(status);
    vi.mocked(api.action).mockResolvedValue({
      ...snapshot,
      cards: [topic],
      discussions: [{ ...discussion, automatic: false }],
    });
    await user.click(
      screen.getByRole("button", {
        name: status === "decided" ? "再検討する" : "このカードについて話す",
      }),
    );
    expect(api.action).toHaveBeenCalledWith(
      { type: "resolveDiscussion", id: discussion.id, action: "accept" },
      "a",
    );
    expect(useWorkspace.getState().snapshot.cards[0].status).toBe("discuss");
    expect(api.send).not.toHaveBeenCalled();
  },
);

it("does not offer stale undo or show notices from another conversation", () => {
  useWorkspace.setState({
    conversation: "c",
    snapshot: {
      ...discussionSnapshot(),
      cards: [{ ...topic, revision: 3, body: "編集後" }],
      discussions: [
        discussion,
        { ...discussion, id: "other", conversationId: "other", title: "別の会話のカード" },
      ],
    },
  });
  render(<Chat />);
  expect(screen.queryByRole("button", { name: "元に戻す" })).not.toBeInTheDocument();
  expect(screen.getByText(/カードが更新されています/)).toBeInTheDocument();
  expect(screen.queryByText(/別の会話のカード/)).not.toBeInTheDocument();
});

it("lets the user dismiss a suggestion without moving the card", async () => {
  const user = userEvent.setup();
  const snapshot = {
    ...discussionSnapshot(),
    cards: [{ ...topic, status: "idea" as const }],
    discussions: [{ ...discussion, state: "suggested" as const, automatic: false }],
  };
  useWorkspace.setState({ snapshot, conversation: "c" });
  vi.mocked(api.action).mockResolvedValue({
    ...snapshot,
    discussions: [{ ...discussion, state: "dismissed" }],
  });
  render(<Chat />);
  await user.click(screen.getByRole("button", { name: "今は移さない" }));
  expect(api.action).toHaveBeenCalledWith(
    { type: "resolveDiscussion", id: discussion.id, action: "dismiss" },
    "a",
  );
  expect(useWorkspace.getState().snapshot.cards[0].status).toBe("idea");
});
it("shows the freeform starting point with no conversation and no active agent", () => {
  render(<Chat />);
  expect(screen.getByRole("button", { name: /個人用のTODOアプリ/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "メッセージを送信" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "応答を停止" })).not.toBeInTheDocument();
  expect(screen.getByText("Codex")).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "エージェント" })).not.toBeInTheDocument();
});
it("keeps ordinary Enter for newlines and sends with Ctrl+Enter", async () => {
  const user = userEvent.setup();
  const conversation = { id: "c", title: "test", agent: "codex", sessionId: null, createdAt: 1 };
  const consented = { ...emptySnapshot, consents: ["codex"] };
  vi.mocked(api.setConsent).mockResolvedValue(consented);
  vi.mocked(api.action).mockResolvedValue({ ...consented, conversations: [conversation] });
  vi.mocked(api.snapshot).mockResolvedValue({ ...consented, conversations: [conversation] });
  vi.mocked(api.send).mockResolvedValue();
  render(<Chat />);
  await user.type(
    screen.getByLabelText("エージェントへのメッセージ"),
    "TODOアプリ{Enter}朝に使いたい",
  );
  expect(api.send).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "同意して使う" }));
  expect(api.setConsent).toHaveBeenCalledWith("codex", true);
  expect(screen.queryByRole("button", { name: "同意して使う" })).not.toBeInTheDocument();
  await user.click(screen.getByLabelText("エージェントへのメッセージ"));
  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(api.send).toHaveBeenCalledWith("c", "TODOアプリ\n朝に使いたい", [], "a");
});

it("checks connectivity without sending a prompt and preserves a draft when sign-in is required", async () => {
  const user = userEvent.setup();
  vi.mocked(api.connection).mockResolvedValue({
    state: "authRequired",
    message: "サインインが必要です。",
    canLogin: true,
  });
  render(<Chat />);
  await user.type(screen.getByLabelText("エージェントへのメッセージ"), "残しておきたい文章");
  await user.click(screen.getByRole("button", { name: "接続を確認" }));
  expect(await screen.findByRole("button", { name: "ChatGPTでサインイン" })).toBeEnabled();
  expect(api.send).not.toHaveBeenCalled();
  expect(api.action).not.toHaveBeenCalled();
  expect(screen.getByLabelText("エージェントへのメッセージ")).toHaveValue("残しておきたい文章");
  expect(screen.getByRole("button", { name: "メッセージを送信" })).toBeDisabled();
});

it("shows Claude as not provided without starting a check, sign-in or send", async () => {
  const user = userEvent.setup();
  const conversation = { id: "c", title: "old", agent: "claude", sessionId: null, createdAt: 1 };
  useWorkspace.setState({
    conversation: "c",
    snapshot: {
      ...emptySnapshot,
      consents: ["claude"],
      conversations: [conversation],
      agents: [{ id: "claude", command: "@tanzakoo/claude-unavailable", args: [] }],
    },
  });
  render(<Chat />);
  expect(screen.getByText(/この会話は閲覧のみです/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "接続を確認" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /サインイン/ })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("エージェントへのメッセージ"), "履歴は読める");
  expect(screen.getByRole("button", { name: "メッセージを送信" })).toBeDisabled();
  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(api.send).not.toHaveBeenCalled();
  expect(api.connection).not.toHaveBeenCalled();
  expect(screen.getByLabelText("エージェントへのメッセージ")).toHaveValue("履歴は読める");
});

it("keeps legacy Claude history readable and starts new chats with Codex", async () => {
  const user = userEvent.setup();
  const conversation = { id: "c", title: "dev", agent: "claude", sessionId: null, createdAt: 1 };
  useWorkspace.setState({
    conversation: "c",
    snapshot: {
      ...emptySnapshot,
      conversations: [conversation],
      messages: [
        {
          id: "m",
          conversationId: "c",
          role: "assistant",
          text: "過去の検討内容",
          references: [],
          createdAt: 1,
        },
      ],
    },
  });
  render(<Chat />);
  expect(screen.getByText("過去の検討内容")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "同意して使う" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "接続を確認" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /サインイン/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "新しい会話" }));
  expect(screen.getByText("Codex")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "接続を確認" })).toBeEnabled();
  expect(useWorkspace.getState().snapshot.messages[0].text).toBe("過去の検討内容");
  expect(api.connection).not.toHaveBeenCalled();
});
