import { expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProposalCard } from "./Proposals";
import { Markdown } from "./Markdown";

const before = "# 通知\n\n期限の前日に通知する。";
const after = "# 通知\n\n期限の前日と当日に通知する。";
const props = {
  reason: "通知の機会を増やす",
  fields: [{ label: "本文", before, after }],
  after: <Markdown>{after}</Markdown>,
  dirty: false,
  outdated: null,
  onResolve: vi.fn(),
};

it("starts with a diff and switches to the rendered result without applying it", async () => {
  const user = userEvent.setup();
  const onResolve = vi.fn();
  render(<ProposalCard {...props} onResolve={onResolve} />);
  expect(screen.getByRole("tab", { name: "差分" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByLabelText("本文の差分")).toHaveTextContent("期限の前日に通知する。");
  expect(screen.getByText("と当日", { selector: "mark" })).toBeVisible();
  await user.click(screen.getByRole("tab", { name: "変更後" }));
  expect(screen.getByRole("heading", { name: "通知" })).toBeVisible();
  expect(screen.getByText("期限の前日と当日に通知する。")).toBeVisible();
  expect(screen.queryByLabelText("本文の差分")).not.toBeInTheDocument();
  expect(onResolve).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "却下" }));
  expect(onResolve).toHaveBeenCalledWith(false);
});

it("collapses distant context, keeps nearby lines, and allows expansion", async () => {
  const user = userEvent.setup();
  const context = Array.from({ length: 12 }, (_, i) => `前提${i}\n`).join("");
  render(
    <ProposalCard
      {...props}
      fields={[{ label: "本文", before: context + "前日", after: context + "当日" }]}
    />,
  );
  const summary = screen.getByText("変更のない10行を表示");
  const details = summary.closest("details")!;
  expect(details).not.toHaveAttribute("open");
  expect(screen.getByText(/前提10/)).toBeVisible();
  await user.click(summary);
  expect(details).toHaveAttribute("open");
  expect(within(details).getByText(/前提0/)).toBeVisible();
});

it("separates title and body changes and explains a removed final newline", () => {
  render(
    <ProposalCard
      {...props}
      fields={[
        { label: "タイトル", before: "毎日の通知", after: "期限の通知" },
        { label: "本文", before: "同じ本文\n", after: "同じ本文" },
      ]}
    />,
  );
  expect(screen.getByLabelText("タイトルの差分")).toHaveTextContent("毎日の通知");
  expect(screen.getByLabelText("タイトルの差分")).toHaveTextContent("期限の通知");
  expect(screen.getByLabelText("本文の差分")).toHaveTextContent("末尾の改行を削除");
});

it.each([
  { dirty: true, outdated: null },
  { dirty: false, outdated: "提案後に内容が変わりました。" },
])("keeps apply blocked after switching views: %j", async (state) => {
  const user = userEvent.setup();
  render(<ProposalCard {...props} {...state} />);
  expect(screen.getByRole("button", { name: "適用する" })).toBeDisabled();
  await user.click(screen.getByRole("tab", { name: "変更後" }));
  expect(screen.getByRole("button", { name: "適用する" })).toBeDisabled();
});
