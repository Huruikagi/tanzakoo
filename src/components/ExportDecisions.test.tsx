import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportDecisions } from "./ExportDecisions";
import { api, emptySnapshot } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import type { Card } from "@/bindings/Card";
import type { ExportResult } from "@/bindings/ExportResult";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  native: true,
  api: { exportDecisions: vi.fn() },
}));
const card: Card = {
  id: "decision",
  title: "通知",
  body: "朝に通知",
  status: "decided",
  revision: 2,
  position: 1,
  source: "user",
  deleted: false,
  createdAt: 1,
  updatedAt: 1,
};
beforeEach(() => {
  vi.resetAllMocks();
  useWorkspace.setState({
    snapshot: {
      ...emptySnapshot,
      project: { id: "a", name: "アプリA", memory: "個人用", revision: 1 },
      cards: [card],
    },
    loaded: true,
    switching: false,
    busy: null,
  });
});
it("exports the current project's saved decisions and reports the actual output", async () => {
  const user = userEvent.setup();
  render(<ExportDecisions />);
  await user.click(screen.getByRole("button", { name: "エクスポート" }));
  expect(api.exportDecisions).not.toHaveBeenCalled();
  expect(screen.getByText(/カード 1件/)).toBeInTheDocument();
  let finish!: (result: ExportResult) => void;
  vi.mocked(api.exportDecisions).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await user.click(screen.getByRole("button", { name: "保存先を選んで出力" }));
  expect(api.exportDecisions).toHaveBeenCalledWith("a");
  expect(screen.getByRole("button", { name: "出力しています…" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await act(async () => {
    finish({ path: "C:\\exports\\app", cardCount: 2 });
  });
  expect(screen.getByRole("status")).toHaveTextContent(
    "2件の決定事項を出力しました。保存先: C:\\exports\\app",
  );
});
it("allows retry after cancellation or failure without claiming success", async () => {
  const user = userEvent.setup();
  render(<ExportDecisions />);
  await user.click(screen.getByRole("button", { name: "エクスポート" }));
  vi.mocked(api.exportDecisions).mockResolvedValue(null);
  await user.click(screen.getByRole("button", { name: "保存先を選んで出力" }));
  expect(screen.getByRole("status")).toHaveTextContent("出力をキャンセルしました。");
  vi.mocked(api.exportDecisions).mockRejectedValue("保存先にアクセスできません");
  await user.click(screen.getByRole("button", { name: "保存先を選んで出力" }));
  expect(screen.getByRole("alert")).toHaveTextContent("保存先にアクセスできません");
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  expect(screen.getByRole("button", { name: "保存先を選んで出力" })).toBeEnabled();
});
it("does not export undecided or deleted cards", async () => {
  useWorkspace.setState({
    snapshot: {
      ...emptySnapshot,
      cards: [
        { ...card, status: "discuss" },
        { ...card, id: "deleted", deleted: true },
      ],
    },
  });
  const user = userEvent.setup();
  render(<ExportDecisions />);
  await user.click(screen.getByRole("button", { name: "エクスポート" }));
  expect(screen.getByText(/カード 0件/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "保存先を選んで出力" })).toBeDisabled();
  expect(api.exportDecisions).not.toHaveBeenCalled();
});
