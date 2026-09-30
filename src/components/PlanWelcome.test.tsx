import { beforeEach, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useWorkspace } from "@/lib/workspace";
import { PlanWelcome } from "./PlanWelcome";

const account = { id: "account-a", label: "Account A", signedIn: true };
beforeEach(() => {
  localStorage.clear();
  useWorkspace.setState({
    reviewAccess: null,
    planStatus: { available: true, accounts: [account], active: account, warning: null },
  });
});
it("confirms plan usage once for a saved account, including after restarting and signing in again", async () => {
  const user = userEvent.setup();
  const view = render(<PlanWelcome />);
  expect(screen.getByRole("dialog")).toHaveTextContent("ChatGPTの利用枠を消費します");
  await user.click(screen.getByRole("button", { name: "確認しました" }));
  view.unmount();
  render(<PlanWelcome />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("keeps the welcome specific to each account and excludes signed-out connections", async () => {
  localStorage.setItem("tanzakoo.plan-welcome.v1.another-account", "seen");
  const view = render(<PlanWelcome />);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  view.unmount();
  useWorkspace.setState({
    planStatus: {
      available: true,
      accounts: [],
      active: { ...account, signedIn: false },
      warning: null,
    },
  });
  render(<PlanWelcome />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
