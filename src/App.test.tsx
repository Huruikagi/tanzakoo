import type { ReactNode } from "react";
import { act, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import App from "./App";
import { Board } from "@/components/Board";
import { api, emptySnapshot } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

vi.mock("@/components/Board", () => ({ Board: vi.fn(() => null) }));
vi.mock("@/components/CardDetails", () => ({ CardDetails: () => null }));
vi.mock("@/components/Chat", () => ({ Chat: () => null }));
vi.mock("@/components/Settings", () => ({ Settings: () => null }));
vi.mock("@/components/Projects", () => ({ Projects: () => null }));
vi.mock("@/components/ExportDecisions", () => ({ ExportDecisions: () => null }));
vi.mock("@/components/ui/resizable", () => ({
  ResizablePanel: ({ children }: { children: ReactNode }) => children,
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => children,
  ResizableHandle: () => null,
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: { snapshot: vi.fn(), subscribe: vi.fn() },
}));

it("does not redraw workspace children for chat deltas or a same-project refresh", async () => {
  const snapshot = { ...emptySnapshot, project: { ...emptySnapshot.project, id: "a" } };
  useWorkspace.setState({
    snapshot,
    loaded: true,
    busy: { kind: "chat", conversation: "c" },
    error: null,
  });
  vi.mocked(api.snapshot).mockResolvedValue(snapshot);
  vi.mocked(api.subscribe).mockResolvedValue(() => {});
  await act(async () => {
    render(<App />);
  });
  vi.mocked(Board).mockClear();
  act(() =>
    useWorkspace
      .getState()
      .event({ conversationId: "c", kind: "delta", text: "応答", detail: null }),
  );
  await act(async () => {
    await useWorkspace.getState().refresh();
  });
  expect(Board).not.toHaveBeenCalled();
  act(() =>
    useWorkspace.setState({ snapshot: { ...snapshot, project: { ...snapshot.project, id: "b" } } }),
  );
  expect(Board).toHaveBeenCalledOnce();
});
