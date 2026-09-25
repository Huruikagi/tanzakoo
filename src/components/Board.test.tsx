import type { ComponentProps } from "react";
import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { DragDropProvider, DragEndEvent } from "@dnd-kit/react";
import type { Card } from "@/bindings/Card";
import type { Snapshot } from "@/bindings/Snapshot";
import { api, emptySnapshot } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import { Board } from "./Board";

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
  api: { action: vi.fn() },
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
  useWorkspace.setState({ snapshot: structuredClone(initial), switching: false, error: null });
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
