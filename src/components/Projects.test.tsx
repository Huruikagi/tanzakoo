import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Projects } from "./Projects";
import { api, emptySnapshot } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

vi.mock("@/lib/api", () => ({
  native: true,
  emptySnapshot: {
    project: { id: "a", name: "アプリA", memory: "個人用", revision: 1 },
    projects: [{ id: "a", name: "アプリA" }],
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
  api: { action: vi.fn(), createProject: vi.fn(), switchProject: vi.fn(), deleteProject: vi.fn() },
}));
vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange: (value: string) => void;
    label: string;
  }) => <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
}));
beforeEach(() => {
  vi.resetAllMocks();
  useWorkspace.setState({
    snapshot: {
      ...emptySnapshot,
      memoryProposals: [
        {
          id: "p",
          baseRevision: 1,
          beforeMemory: "個人用",
          memory: "個人用。通知なし",
          reason: "方針を記録",
          state: "pending",
        },
      ],
    },
    loaded: true,
    switching: false,
    busy: null,
    projectDrafts: {},
    error: null,
  });
});
it("keeps memory unchanged until approval and prevents applying over a draft", async () => {
  const user = userEvent.setup();
  render(<Projects />);
  await user.click(screen.getByRole("button", { name: "プロジェクトメモリ" }));
  expect(screen.getByLabelText("プロジェクトメモリ本文")).toHaveValue("個人用");
  expect(screen.getByLabelText("メモリの差分")).toHaveTextContent("個人用。通知なし");
  await user.click(screen.getByRole("tab", { name: "変更後" }));
  expect(screen.getByText("個人用。通知なし")).toBeVisible();
  expect(api.action).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("プロジェクトメモリ本文"), "の予定");
  expect(screen.getByRole("button", { name: "適用する" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "取り消す" }));
  vi.mocked(api.action).mockResolvedValue({
    ...emptySnapshot,
    project: { ...emptySnapshot.project, memory: "個人用。通知なし", revision: 2 },
  });
  await user.click(screen.getByRole("button", { name: "適用する" }));
  expect(api.action).toHaveBeenCalledWith(
    { type: "resolveMemoryProposal", id: "p", apply: true },
    "a",
  );
  expect(screen.getByLabelText("プロジェクトメモリ本文")).toHaveValue("個人用。通知なし");
});
it("creates a project with its initial memory and switches to the empty board", async () => {
  const user = userEvent.setup();
  render(<Projects />);
  await user.click(screen.getByRole("button", { name: "新しいプロジェクト" }));
  await user.type(screen.getByLabelText("プロジェクト名"), "アプリB");
  await user.type(screen.getByLabelText("プロジェクトメモリ（任意）"), "家族で使う");
  vi.mocked(api.createProject).mockResolvedValue({
    ...emptySnapshot,
    project: { id: "b", name: "アプリB", memory: "家族で使う", revision: 2 },
  });
  await user.click(screen.getByRole("button", { name: "作成して開く" }));
  expect(api.createProject).toHaveBeenCalledWith("アプリB", "家族で使う");
  expect(useWorkspace.getState().snapshot.project.id).toBe("b");
  expect(useWorkspace.getState().conversation).toBeNull();
});

it("confirms the project and deletion scope, supports cancellation, and deletes only on confirmation", async () => {
  const user = userEvent.setup();
  render(<Projects />);
  await user.click(screen.getByRole("button", { name: "プロジェクトメモリ" }));
  await user.click(screen.getByRole("button", { name: "プロジェクトを削除" }));
  expect(screen.getByRole("heading", { name: "「アプリA」を削除しますか？" })).toBeVisible();
  expect(screen.getByText(/元に戻せません/)).toHaveTextContent("空のプロジェクト");
  expect(api.deleteProject).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "キャンセル" }));
  expect(api.deleteProject).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "プロジェクトを削除" }));
  vi.mocked(api.deleteProject).mockResolvedValue({
    snapshot: { ...emptySnapshot, project: { ...emptySnapshot.project, id: "b", name: "B" } },
    warning: null,
  });
  await user.click(screen.getByRole("button", { name: "削除する" }));
  expect(api.deleteProject).toHaveBeenCalledWith("a");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps the confirmation and project visible after a failure", async () => {
  const user = userEvent.setup();
  render(<Projects />);
  await user.click(screen.getByRole("button", { name: "プロジェクトメモリ" }));
  await user.click(screen.getByRole("button", { name: "プロジェクトを削除" }));
  vi.mocked(api.deleteProject).mockRejectedValue("保存に失敗しました");
  await user.click(screen.getByRole("button", { name: "削除する" }));
  expect(screen.getByRole("alert")).toHaveTextContent("保存に失敗しました");
  expect(useWorkspace.getState().snapshot.project.id).toBe("a");
  expect(screen.getByRole("button", { name: "削除する" })).toBeEnabled();
});

it("disables deletion while the agent is running", async () => {
  useWorkspace.setState({ busy: { kind: "chat", conversation: "c" } });
  const user = userEvent.setup();
  render(<Projects />);
  await user.click(screen.getByRole("button", { name: "プロジェクトメモリ" }));
  expect(screen.getByRole("button", { name: "プロジェクトを削除" })).toBeDisabled();
});
