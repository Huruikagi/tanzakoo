import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "./Settings";
import { Chat } from "./Chat";
import { emptySnapshot } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  native: true,
  api: {
    action: vi.fn(),
    connection: vi.fn(),
    notificationSettings: vi.fn(() => new Promise(() => {})),
    planConnection: vi.fn(),
    send: vi.fn(),
  },
}));

const snapshot = {
  ...emptySnapshot,
  project: { ...emptySnapshot.project, id: "a" },
  externalAgentsAvailable: true,
  agents: [
    { id: "copilot", command: "copilot", args: ["--acp"] },
    { id: "claude-api", command: "claude-agent-acp", args: ["--hide-claude-auth"] },
  ],
};

beforeEach(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  useWorkspace.setState({
    snapshot,
    settings: { open: false, tab: "general", agent: null },
    newChatAgent: "codex",
    conversation: null,
    busy: null,
    switching: false,
    reviewAccess: null,
    connections: {},
    chatError: null,
    planStatus: null,
    planError: null,
    loaded: true,
  });
});

it("lists every external CLI by name with its connection state", async () => {
  const user = userEvent.setup();
  useWorkspace.setState({
    snapshot: {
      ...snapshot,
      externalConnectionChecks: {
        copilot: {
          status: { state: "ready", message: "ok", canLogin: false },
          config: snapshot.agents[0],
          checkedAt: 1_792_000_000_000,
        },
      },
    },
  });
  render(<Settings />);
  await user.click(screen.getByRole("button", { name: "設定" }));
  await user.click(screen.getByRole("tab", { name: "AI接続" }));
  const list = screen.getByRole("region", { name: "その他のAI" });
  const rows = within(list).getAllByRole("listitem");
  expect(rows.map((r) => r.querySelector("strong")?.textContent)).toEqual([
    "Antigravity",
    "Claude API",
    "GitHub Copilot CLI",
    "OpenCode",
    "Devin CLI",
  ]);
  expect(within(rows[2]).getByText("接続を確認済み")).toBeInTheDocument();
  expect(within(rows[1]).getByText("未確認")).toBeInTheDocument();
  expect(screen.queryByLabelText("CLIの実行ファイルまたはコマンド名")).not.toBeInTheDocument();
  expect(screen.queryByText(/確認日時:/)).not.toBeInTheDocument();

  await user.click(within(rows[1]).getByRole("button", { name: "Claude APIを設定" }));
  expect(screen.getByLabelText("CLIの実行ファイルまたはコマンド名")).toHaveValue(
    "claude-agent-acp",
  );
  await user.click(within(rows[2]).getByRole("button", { name: "GitHub Copilot CLIを設定" }));
  expect(screen.getAllByLabelText("CLIの実行ファイルまたはコマンド名")).toHaveLength(1);
  expect(screen.getByLabelText("CLIの実行ファイルまたはコマンド名")).toHaveValue("copilot");
  expect(screen.getByText(/確認日時:/)).toBeVisible();
});

it("hides the external list in builds without external CLIs", async () => {
  const user = userEvent.setup();
  useWorkspace.setState({ snapshot: { ...snapshot, externalAgentsAvailable: false } });
  render(<Settings />);
  await user.click(screen.getByRole("button", { name: "設定" }));
  await user.click(screen.getByRole("tab", { name: "AI接続" }));
  expect(screen.queryByRole("region", { name: "その他のAI" })).not.toBeInTheDocument();
});

it("shows the personal connection only when the native build enables it", async () => {
  const user = userEvent.setup();
  useWorkspace.setState({ snapshot: { ...snapshot, personalClaudeAvailable: true } });
  render(<Settings />);
  await user.click(screen.getByRole("button", { name: "設定" }));
  await user.click(screen.getByRole("tab", { name: "AI接続" }));
  await user.click(screen.getByRole("button", { name: "Claude (Personal)を設定" }));
  expect(screen.getByText(/個人用ビルド限定です/)).toBeVisible();
});

it("opens the selected CLI's settings from a new chat", async () => {
  const user = userEvent.setup();
  useWorkspace.setState({ newChatAgent: "claude-api" });
  render(
    <>
      <Settings />
      <Chat />
    </>,
  );
  expect(screen.getByText(/Claude APIはまだ接続を確認していません/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Claude APIを設定" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("tab", { name: "AI接続" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(within(dialog).getByLabelText("CLIの実行ファイルまたはコマンド名")).toHaveValue(
    "claude-agent-acp",
  );
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
});

it("offers connection settings from the chat target select without changing it", async () => {
  const user = userEvent.setup();
  render(
    <>
      <Settings />
      <Chat />
    </>,
  );
  await user.click(screen.getByRole("combobox", { name: "会話の接続先" }));
  await user.click(screen.getByRole("option", { name: "接続先を設定…" }));
  expect(useWorkspace.getState().newChatAgent).toBe("codex");
  expect(useWorkspace.getState().settings).toEqual({
    open: true,
    tab: "connection",
    agent: null,
  });
  expect(
    within(screen.getByRole("dialog")).getByRole("region", { name: "その他のAI" }),
  ).toBeVisible();
});

it("does not nag about a CLI that is already in use", () => {
  useWorkspace.setState({
    newChatAgent: "copilot",
    snapshot: { ...snapshot, consents: ["copilot"] },
  });
  render(<Chat />);
  expect(screen.queryByText(/まだ接続を確認していません/)).not.toBeInTheDocument();
});
