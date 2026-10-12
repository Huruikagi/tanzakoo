import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentConnectionDialog } from "./AgentConnection";
import { Settings } from "./Settings";
import { useWorkspace } from "@/lib/workspace";
import { api, emptySnapshot } from "@/lib/api";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  native: true,
  api: {
    reviewConnection: vi.fn(),
    connection: vi.fn(),
    cancel: vi.fn(),
    action: vi.fn(),
    notificationSettings: vi.fn(),
  },
}));
const access = { model: "review-model", expiresAt: Date.now() + 3600000, remainingRequests: 50 };
const code = `trr_${"a".repeat(43)}`;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.notificationSettings).mockResolvedValue({
    mode: "inactive",
    permission: "granted",
  });
  localStorage.clear();
  useWorkspace.setState({
    snapshot: {
      ...emptySnapshot,
      project: { ...emptySnapshot.project, id: "p" },
      agents: [{ id: "codex", command: "@tanzakoo/managed", args: [] }],
      consents: ["codex"],
    },
    reviewAccess: null,
    reviewError: null,
    loaded: true,
    planStatus: { available: true, accounts: [], active: null, warning: null },
    planError: null,
    busy: null,
    switching: false,
    connections: {},
    conversation: "personal-conversation",
    references: [],
    chatError: null,
  });
});

it("opens from the compact connection dialog and requires separate relay consent", async () => {
  const user = userEvent.setup();
  vi.mocked(api.reviewConnection).mockResolvedValue(access);
  render(<AgentConnectionDialog agent="codex" />);
  expect(screen.queryByText("審査用アクセスを利用する")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "接続状況" }));
  await user.click(screen.getByRole("button", { name: "審査用アクセスを利用する" }));
  await user.type(screen.getByLabelText("審査用コード"), code);
  expect(screen.getByRole("button", { name: "同意して接続する" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "同意して接続する" }));
  expect(api.reviewConnection).toHaveBeenCalledWith("p", "connect", code, true);
  expect(screen.getByText("審査用接続")).toBeInTheDocument();
  expect(screen.queryByLabelText("審査用コード")).not.toBeInTheDocument();
  expect(useWorkspace.getState().conversation).toBeNull();
  expect(useWorkspace.getState().snapshot.consents).toEqual(["codex"]);
  expect(JSON.stringify(useWorkspace.getState())).not.toContain(code);
  expect(JSON.stringify(localStorage)).not.toContain(code);
  await user.click(screen.getByRole("button", { name: "新しい審査用コードを入力" }));
  expect(screen.getByLabelText("審査用コード")).toHaveValue("");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
});

it("preserves the current route and input after failure, and disconnects without signing out", async () => {
  const user = userEvent.setup();
  useWorkspace.setState({ reviewAccess: access, conversation: "review-conversation" });
  vi.mocked(api.reviewConnection).mockRejectedValueOnce("コードが失効しています。");
  render(<AgentConnectionDialog agent="codex" />);
  await user.click(screen.getByRole("button", { name: "接続状況" }));
  await user.click(screen.getByRole("button", { name: "新しい審査用コードを入力" }));
  await user.type(screen.getByLabelText("審査用コード"), code);
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "同意して接続する" }));
  expect(screen.getByRole("alert")).toHaveTextContent("コードが失効しています。");
  expect(screen.getByLabelText("審査用コード")).toHaveValue(code);
  expect(useWorkspace.getState().reviewAccess).toEqual(access);
  expect(useWorkspace.getState().conversation).toBe("review-conversation");
  vi.mocked(api.reviewConnection).mockResolvedValueOnce(null);
  await user.click(screen.getByRole("button", { name: "通常の接続に戻す" }));
  expect(useWorkspace.getState().reviewAccess).toBeNull();
  expect(useWorkspace.getState().snapshot.consents).toEqual(["codex"]);
  expect(api.connection).not.toHaveBeenCalled();
});

it("Enter in the review code field never submits the surrounding launch settings form", async () => {
  const user = userEvent.setup();
  vi.mocked(api.reviewConnection).mockResolvedValue(access);
  render(<Settings />);
  await user.click(screen.getByRole("button", { name: "設定" }));
  await user.click(screen.getByRole("tab", { name: "AI接続" }));
  await user.click(screen.getByRole("button", { name: "審査用アクセスを利用する" }));
  await user.type(screen.getByLabelText("審査用コード"), code);
  await user.click(screen.getByRole("checkbox"));
  await act(async () => {
    fireEvent.keyDown(screen.getByLabelText("審査用コード"), { key: "Enter" });
  });
  expect(api.reviewConnection).toHaveBeenCalledTimes(1);
  expect(api.action).not.toHaveBeenCalled();
});

it("blocks expired access without falling back to an existing personal consent", async () => {
  useWorkspace.setState({ reviewAccess: { ...access, expiresAt: Date.now() - 1 } });
  expect(await useWorkspace.getState().send("test", "codex")).toBe(false);
  expect(useWorkspace.getState().chatError).toContain("有効期限");
  expect(api.action).not.toHaveBeenCalled();
  expect(useWorkspace.getState().reviewAccess).not.toBeNull();
});
