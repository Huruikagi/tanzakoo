import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CardDetails } from "./CardDetails";
import { useWorkspace } from "@/lib/workspace";
import { emptySnapshot, api } from "@/lib/api";
import type { Card } from "@/bindings/Card";
vi.mock("@/lib/api", () => ({
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
  api: { action: vi.fn() },
}));
vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="カード本文" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
const card: Card = {
  id: "a",
  title: "通知",
  body: "毎朝",
  status: "idea",
  revision: 1,
  position: 1,
  source: "codex",
  deleted: false,
  createdAt: 1,
  updatedAt: 1,
};
beforeEach(() => {
  vi.resetAllMocks();
  useWorkspace.setState({
    selected: card.id,
    drafts: {},
    references: [],
    snapshot: {
      ...emptySnapshot,
      cards: [card],
      proposals: [
        {
          id: "p",
          cardId: card.id,
          baseRevision: 1,
          beforeTitle: "通知",
          beforeBody: "毎朝",
          title: "通知",
          body: "毎夕",
          reason: "利用時間に合わせる",
          state: "pending",
          createdAt: 1,
        },
      ],
    },
  });
});
it("shows a proposal separately and only applies after clicking Apply", async () => {
  const user = userEvent.setup();
  render(<CardDetails />);
  expect(screen.getByLabelText("カード本文")).toHaveValue("毎朝");
  expect(screen.getByText("毎夕")).toBeInTheDocument();
  expect(api.action).not.toHaveBeenCalled();
  vi.mocked(api.action).mockResolvedValue({
    ...emptySnapshot,
    cards: [{ ...card, body: "毎夕", revision: 2 }],
  });
  await user.click(screen.getByRole("button", { name: "適用する" }));
  expect(api.action).toHaveBeenCalledWith({ type: "resolveProposal", id: "p", apply: true }, "a");
  expect(screen.getByLabelText("カード本文")).toHaveValue("毎夕");
});
it("attaches the saved card and disables proposal apply while there is an unsaved draft", async () => {
  const user = userEvent.setup();
  render(<CardDetails />);
  await user.click(screen.getByRole("button", { name: "会話に参照" }));
  expect(useWorkspace.getState().references[0]).toMatchObject({ cardId: "a", revision: 1 });
  await user.type(screen.getByLabelText("カード本文"), "の予定");
  expect(screen.getByRole("button", { name: "適用する" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "会話に参照" })).toBeDisabled();
});
