import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanAccess, PlanConnectionRestore } from "./PlanAccess";
import { api, emptySnapshot } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  native: true,
  api: { planConnection: vi.fn(), connection: vi.fn(), cancel: vi.fn() },
}));
const account = { id: "account-a", label: "Account A", signedIn: true };
const status = { available: true, accounts: [account], active: null, warning: null };
const draft = { title: "Draft", body: "keep draft", revision: 1 };
const reference = { cardId: "card-a", title: "Card A", revision: 1, quote: "" };
beforeEach(() => {
  vi.resetAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  useWorkspace.setState({
    snapshot: {
      ...emptySnapshot,
      project: { ...emptySnapshot.project, id: "p" },
      consents: ["codex"],
    },
    loaded: true,
    busy: null,
    switching: false,
    planStatus: status,
    planError: null,
    reviewAccess: null,
    conversation: "existing",
    stream: "",
    connections: {},
    drafts: { existing: draft },
    references: [reference],
  });
});

it("selects a saved account, starts a new conversation, and retains drafts and consent", async () => {
  const user = userEvent.setup();
  vi.mocked(api.planConnection).mockResolvedValue({ ...status, active: account });
  render(<PlanAccess />);
  await user.click(screen.getByRole("button", { name: "このアカウントを使う" }));
  expect(api.planConnection).toHaveBeenCalledWith("p", "select", "account-a");
  expect(useWorkspace.getState().conversation).toBeNull();
  expect(useWorkspace.getState().drafts).toEqual({ existing: draft });
  expect(useWorkspace.getState().references).toEqual([reference]);
  expect(useWorkspace.getState().snapshot.consents).toEqual(["codex"]);
  expect(screen.getByText("接続中")).toBeInTheDocument();
});

it("restores on startup without opening settings or clearing the selected conversation", async () => {
  useWorkspace.setState({ planStatus: null, loaded: false });
  vi.mocked(api.planConnection).mockResolvedValue({ ...status, active: account });
  const view = render(<PlanConnectionRestore />);
  expect(api.planConnection).not.toHaveBeenCalled();
  await act(async () => useWorkspace.setState({ loaded: true }));
  await waitFor(() => expect(useWorkspace.getState().planStatus?.active).toEqual(account));
  expect(api.planConnection).toHaveBeenCalledExactlyOnceWith("p", "restore", null);
  expect(useWorkspace.getState().conversation).toBe("existing");
  expect(useWorkspace.getState().drafts).toEqual({ existing: draft });
  expect(useWorkspace.getState().references).toEqual([reference]);
  expect(useWorkspace.getState().snapshot.consents).toEqual(["codex"]);
  view.unmount();
  render(<PlanConnectionRestore />);
  expect(api.planConnection).toHaveBeenCalledTimes(1);
});

it("keeps a failed saved account disconnected and offers retry without selecting another account", async () => {
  const other = { id: "account-b", label: "Account B", signedIn: true };
  useWorkspace.setState({ planStatus: null });
  vi.mocked(api.planConnection).mockResolvedValue({
    ...status,
    accounts: [other, account],
    active: { ...account, signedIn: false },
    warning: "offline",
  });
  render(
    <>
      <PlanConnectionRestore />
      <PlanAccess />
    </>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  expect(screen.getByText("接続を確認してください")).toBeVisible();
  expect(screen.getByRole("combobox", { name: "保存済みアカウント" })).toHaveTextContent(
    "Account A",
  );
  expect(screen.getByRole("button", { name: "このアカウントを使う" })).toBeEnabled();
  expect(useWorkspace.getState().planStatus?.active?.signedIn).toBe(false);
  expect(useWorkspace.getState().conversation).toBe("existing");
  expect(api.planConnection).toHaveBeenCalledTimes(1);
  expect(api.connection).not.toHaveBeenCalled();
});

it("does not repeatedly restore after cancellation or a helper error", async () => {
  useWorkspace.setState({ planStatus: null });
  vi.mocked(api.planConnection).mockRejectedValue("cancelled");
  render(
    <>
      <PlanConnectionRestore />
      <PlanAccess />
    </>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("cancelled");
  expect(screen.getByRole("button", { name: "接続一覧を再取得" })).toBeEnabled();
  expect(api.planConnection).toHaveBeenCalledTimes(1);
  expect(useWorkspace.getState().busy).toBeNull();
});

it("keeps the selected plan route after logout and never invokes ordinary Codex login", async () => {
  useWorkspace.setState({ planStatus: { ...status, active: account } });
  const signedOut = { ...account, signedIn: false };
  vi.mocked(api.planConnection).mockResolvedValue({
    ...status,
    accounts: [signedOut],
    active: signedOut,
  });
  const user = userEvent.setup();
  render(<PlanAccess />);
  await user.click(screen.getByText("アカウント管理"));
  await user.click(screen.getByRole("button", { name: "サインアウト" }));
  expect(useWorkspace.getState().planStatus?.active).toEqual(signedOut);
  expect(api.connection).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "再サインイン" })).toBeInTheDocument();
});

it("retains conversation and selected account when reauthentication fails or usage opens", async () => {
  useWorkspace.setState({ planStatus: { ...status, active: account } });
  vi.mocked(api.planConnection).mockRejectedValueOnce("failed");
  const user = userEvent.setup();
  render(<PlanAccess />);
  await user.click(screen.getByText("アカウント管理"));
  await user.click(screen.getByRole("button", { name: "再サインイン" }));
  expect(screen.getByRole("alert")).toHaveTextContent("failed");
  expect(useWorkspace.getState().conversation).toBe("existing");
  expect(useWorkspace.getState().planStatus?.active).toEqual(account);
  vi.mocked(api.planConnection).mockResolvedValueOnce({ ...status, active: account });
  await user.click(screen.getByRole("button", { name: "ChatGPTの利用量を管理" }));
  expect(api.planConnection).toHaveBeenLastCalledWith("p", "usage", null);
  expect(useWorkspace.getState().conversation).toBe("existing");
});

it("keeps account operations collapsed while connected and switches only after confirmation", async () => {
  const other = { id: "account-b", label: "Account B", signedIn: true };
  useWorkspace.setState({ planStatus: { ...status, active: account, accounts: [account, other] } });
  const user = userEvent.setup();
  render(<PlanAccess />);
  expect(screen.getByRole("button", { name: "再サインイン" })).not.toBeVisible();
  expect(screen.getByRole("button", { name: "サインアウト" })).not.toBeVisible();
  expect(screen.getByRole("button", { name: "ChatGPTで続ける" })).not.toBeVisible();
  expect(screen.getByRole("button", { name: "ChatGPTの利用量を管理" })).toBeEnabled();
  await user.click(screen.getByText("アカウント管理"));
  await user.click(screen.getByRole("combobox", { name: "保存済みアカウント" }));
  await user.click(screen.getByRole("option", { name: "Account B" }));
  expect(api.planConnection).not.toHaveBeenCalled();
  expect(useWorkspace.getState().conversation).toBe("existing");
  vi.mocked(api.planConnection).mockResolvedValue({
    ...status,
    accounts: [account, other],
    active: other,
  });
  await user.click(screen.getByRole("button", { name: "このアカウントを使う" }));
  expect(api.planConnection).toHaveBeenCalledWith("p", "select", "account-b");
});

it("offers ChatGPT directly without a preview toggle or a legacy fallback", () => {
  render(<PlanAccess />);
  expect(screen.getByRole("button", { name: "ChatGPTで続ける" })).toBeEnabled();
  expect(screen.queryByText(/プレビュー/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "通常の接続に戻す" })).not.toBeInTheDocument();
});
