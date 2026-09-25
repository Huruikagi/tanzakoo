import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chat } from "./Chat";
import { useWorkspace } from "@/lib/workspace";
import { api, emptySnapshot } from "@/lib/api";
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
    agents: [],
  },
  api: { action: vi.fn(), snapshot: vi.fn(), send: vi.fn(), cancel: vi.fn(), connection: vi.fn() },
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
    consents: {},
    connections: {},
  });
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
  vi.mocked(api.action).mockResolvedValue({ ...emptySnapshot, conversations: [conversation] });
  vi.mocked(api.snapshot).mockResolvedValue({ ...emptySnapshot, conversations: [conversation] });
  vi.mocked(api.send).mockResolvedValue();
  render(<Chat />);
  await user.type(
    screen.getByLabelText("エージェントへのメッセージ"),
    "TODOアプリ{Enter}朝に使いたい",
  );
  expect(api.send).not.toHaveBeenCalled();
  await user.click(screen.getByRole("checkbox"));
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
    consents: { "a:claude": true },
    snapshot: {
      ...emptySnapshot,
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
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "接続を確認" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /サインイン/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "新しい会話" }));
  expect(screen.getByText("Codex")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "接続を確認" })).toBeEnabled();
  expect(useWorkspace.getState().snapshot.messages[0].text).toBe("過去の検討内容");
  expect(api.connection).not.toHaveBeenCalled();
});
