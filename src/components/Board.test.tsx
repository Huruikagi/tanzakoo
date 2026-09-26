import { Profiler, type ComponentProps } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { DragDropProvider, DragEndEvent } from "@dnd-kit/react";
import type { Card } from "@/bindings/Card";
import type { Snapshot } from "@/bindings/Snapshot";
import { api, emptySnapshot } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import { Board } from "./Board";
import { ARCHIVE_TARGET } from "./ArchiveShelf";

const drag = vi.hoisted(() => ({ props: {} as ComponentProps<typeof DragDropProvider> }));
vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: (props: ComponentProps<typeof DragDropProvider>) => {
    drag.props = props;
    return props.children;
  },
  DragOverlay: () => null,
  useDroppable: () => ({}),
}));
vi.mock("@dnd-kit/react/sortable", () => ({ useSortable: () => ({}) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  native: true,
  api: { action: vi.fn(), send: vi.fn(), snapshot: vi.fn() },
}));

const card: Card = {
  id: "a",
  title: "移動するカード",
  body: "本文",
  status: "idea",
  position: 1,
  revision: 1,
  source: "user",
  deleted: false,
  createdAt: 1,
  updatedAt: 1,
};
const initial = { ...emptySnapshot, cards: [card] };

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.setState({
    snapshot: structuredClone(initial),
    switching: false,
    error: null,
    busy: null,
    conversation: null,
    chatOpen: false,
    archiveNotice: null,
    archivePending: false,
    drafts: {},
  });
});

it("offers broadening in the idea column, opens consent guidance, and disables it during work", () => {
  render(<Board />);
  const button = within(screen.getByRole("region", { name: "アイデアの山" })).getByRole("button", {
    name: "話題を広げる",
  });
  fireEvent.click(button);
  expect(useWorkspace.getState().chatOpen).toBe(true);
  expect(useWorkspace.getState().chatError).toContain("同意");
  expect(api.send).not.toHaveBeenCalled();
  act(() => useWorkspace.setState({ busy: { kind: "chat", conversation: "c" } }));
  expect(button).toBeDisabled();
  act(() => useWorkspace.setState({ busy: null, switching: true }));
  expect(button).toBeDisabled();
});

function drop(canceled = false, target: string | null = "explore") {
  act(() => {
    drag.props.onDragEnd?.(
      {
        canceled,
        operation: { source: { id: card.id }, target: target ? { id: target } : null },
      } as DragEndEvent,
      // The component only consumes the event, not the drag manager.
      undefined as never,
    );
  });
}

function expectPlacement(column: string) {
  expect(within(screen.getByRole("region", { name: column })).getByText(card.title)).toBeVisible();
  expect(screen.getAllByText(card.title)).toHaveLength(1);
}

it("does not render the board again for streamed chat text", () => {
  const rendered = vi.fn();
  render(
    <Profiler id="board" onRender={rendered}>
      <Board />
    </Profiler>,
  );
  rendered.mockClear();
  act(() => useWorkspace.setState({ stream: "新しい応答", activity: "応答しています…" }));
  expect(rendered).not.toHaveBeenCalled();
  act(() => useWorkspace.setState({ selected: card.id }));
  expect(screen.getByRole("button", { name: `${card.title} ${card.body}` })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it("shows the destination before saving and keeps the committed position", async () => {
  let resolve!: (snapshot: Snapshot) => void;
  vi.mocked(api.action).mockReturnValue(new Promise((done) => (resolve = done)));
  render(<Board />);
  drop();
  expectPlacement("検討する");
  expect(useWorkspace.getState().snapshot.cards[0].status).toBe("idea");
  await act(async () => {
    resolve({
      ...initial,
      cards: [{ ...card, status: "explore", revision: 2, body: "保存後の本文" }],
    });
  });
  expectPlacement("検討する");
  expect(screen.getByText("保存後の本文")).toBeVisible();
  expect(api.action).toHaveBeenCalledTimes(1);
});

it("rolls back a failed save, preserves other changes, and permits another drag", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(api.action).mockReturnValue(new Promise((_, fail) => (reject = fail)));
  render(<Board />);
  drop();
  expectPlacement("検討する");
  const preventDefault = vi.fn();
  act(() => {
    drag.props.onBeforeDragStart?.({ preventDefault } as never, undefined as never);
  });
  expect(preventDefault).toHaveBeenCalledOnce();
  drop(false, "discuss");
  await act(async () => {
    useWorkspace.setState({
      snapshot: { ...initial, cards: [{ ...card, body: "更新された本文" }] },
    });
    reject(new Error("保存失敗"));
  });
  expectPlacement("アイデアの山");
  expect(screen.getByText("更新された本文")).toBeVisible();
  expect(useWorkspace.getState().error).toContain("保存失敗");
  expect(api.action).toHaveBeenCalledTimes(1);
  preventDefault.mockClear();
  act(() => {
    drag.props.onBeforeDragStart?.({ preventDefault } as never, undefined as never);
  });
  expect(preventDefault).not.toHaveBeenCalled();
});

it("leaves canceled and out-of-board drops unchanged without saving", () => {
  render(<Board />);
  drop(true);
  drop(false, null);
  expectPlacement("アイデアの山");
  expect(api.action).not.toHaveBeenCalled();
});

it("archives a dropped card after saving and undoes using the saved revision", async () => {
  const archived = { ...card, deleted: true, revision: 2 };
  vi.mocked(api.action).mockResolvedValue({ ...initial, cards: [archived] });
  render(<Board />);
  await act(async () => drop(false, ARCHIVE_TARGET));
  expect(api.action).toHaveBeenCalledWith(
    { type: "updateCard", card: { ...card, deleted: true } },
    initial.project.id,
  );
  expect(
    screen.queryByRole("button", { name: `${card.title} ${card.body}` }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "アーカイブ 1件" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("アーカイブしました");
  vi.mocked(api.action).mockResolvedValue({ ...initial, cards: [{ ...card, revision: 3 }] });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "元に戻す" })));
  expect(api.action).toHaveBeenLastCalledWith(
    { type: "updateCard", card: { ...archived, deleted: false } },
    initial.project.id,
  );
  expectPlacement("アイデアの山");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("keeps failed or canceled archive drops on the board without a success notice", async () => {
  vi.mocked(api.action).mockRejectedValue(new Error("保存できません"));
  render(<Board />);
  await act(async () => drop(true, ARCHIVE_TARGET));
  expect(api.action).not.toHaveBeenCalled();
  await act(async () => drop(false, ARCHIVE_TARGET));
  expectPlacement("アイデアの山");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(useWorkspace.getState().error).toContain("保存できません");
  expect(useWorkspace.getState().archivePending).toBe(false);
});

it("archives from the card menu and restores from the footer list", async () => {
  const user = userEvent.setup();
  const archived = { ...card, deleted: true, revision: 2 };
  vi.mocked(api.action).mockResolvedValue({ ...initial, cards: [archived] });
  render(<Board />);
  await user.click(screen.getByRole("button", { name: `${card.title}のメニュー` }));
  await user.click(screen.getByRole("menuitem", { name: "アーカイブ" }));
  await user.click(screen.getByRole("button", { name: "アーカイブ 1件" }));
  expect(within(screen.getByRole("dialog")).getByText(card.title)).toBeVisible();
  vi.mocked(api.action).mockResolvedValue({ ...initial, cards: [{ ...card, revision: 3 }] });
  await user.click(screen.getByRole("button", { name: `${card.title}を元の列へ戻す` }));
  expect(useWorkspace.getState().snapshot.cards[0]).toMatchObject({
    deleted: false,
    status: "idea",
  });
});

it("preserves unsaved edits and refuses an archive drop", async () => {
  useWorkspace.setState({
    drafts: { [card.id]: { title: card.title, body: "編集中", revision: 1 } },
  });
  render(<Board />);
  await act(async () => drop(false, ARCHIVE_TARGET));
  expect(api.action).not.toHaveBeenCalled();
  expectPlacement("アイデアの山");
  expect(useWorkspace.getState().drafts[card.id].body).toBe("編集中");
  expect(useWorkspace.getState().error).toContain("未保存");
});
