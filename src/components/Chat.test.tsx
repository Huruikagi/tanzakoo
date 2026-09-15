import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chat } from "./Chat";
import { useWorkspace } from "@/lib/workspace";
import { api, emptySnapshot } from "@/lib/api";
vi.mock("@/lib/api", () => ({
  native: true,
  emptySnapshot: { cards: [], proposals: [], conversations: [], messages: [], agents: [] },
  api: { action: vi.fn(), snapshot: vi.fn(), send: vi.fn(), cancel: vi.fn() },
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
  });
});
it("shows the freeform starting point with no conversation and no active agent", () => {
  render(<Chat />);
  expect(screen.getByText("まだ、曖昧なままで。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "メッセージを送信" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "応答を停止" })).not.toBeInTheDocument();
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
  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(api.send).toHaveBeenCalledWith("c", "TODOアプリ\n朝に使いたい", []);
});
