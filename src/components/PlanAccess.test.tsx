import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanAccess } from "./PlanAccess";
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
  await user.click(screen.getByRole("button", { name: "ChatGPTプラン接続（プレビュー）" }));
  await user.click(screen.getByRole("button", { name: "このアカウントを使う" }));
  expect(api.planConnection).toHaveBeenCalledWith("p", "select", "account-a");
  expect(useWorkspace.getState().conversation).toBeNull();
  expect(useWorkspace.getState().drafts).toEqual({ existing: draft });
  expect(useWorkspace.getState().references).toEqual([reference]);
  expect(useWorkspace.getState().snapshot.consents).toEqual(["codex"]);
  expect(screen.getByText("接続中: Account A")).toBeInTheDocument();
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
  await user.click(screen.getByRole("button", { name: "再サインイン" }));
  expect(screen.getByRole("alert")).toHaveTextContent("failed");
  expect(useWorkspace.getState().conversation).toBe("existing");
  expect(useWorkspace.getState().planStatus?.active).toEqual(account);
  vi.mocked(api.planConnection).mockResolvedValueOnce({ ...status, active: account });
  await user.click(screen.getByRole("button", { name: "ChatGPTの利用量を管理" }));
  expect(api.planConnection).toHaveBeenLastCalledWith("p", "usage", null);
  expect(useWorkspace.getState().conversation).toBe("existing");
});

it("does not offer the preview in default builds", () => {
  useWorkspace.setState({ planStatus: { ...status, available: false } });
  render(<PlanAccess />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
