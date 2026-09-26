import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReferenceMaterials } from "./ReferenceMaterials";
import { api, emptySnapshot } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  native: true,
  api: { addMaterials: vi.fn(), removeMaterial: vi.fn(), switchProject: vi.fn() },
}));
const material = { id: "source", path: "G:\\product", kind: "folder" as const };
beforeEach(() => {
  vi.resetAllMocks();
  useWorkspace.setState({
    snapshot: { ...emptySnapshot, project: { ...emptySnapshot.project, id: "a" }, materials: [] },
    loaded: true,
    switching: false,
    busy: null,
    error: null,
    questionDrafts: {},
    projectDrafts: { a: { name: "下書き", memory: "保持する", revision: 1 } },
    references: [{ cardId: "card", title: "参照", revision: 1, quote: "本文" }],
  });
});
it("registers picker results for the active project and removes only the grant", async () => {
  const user = userEvent.setup();
  render(<ReferenceMaterials />);
  await user.click(screen.getByRole("button", { name: "参照資料" }));
  expect(screen.getByText(/OpenAIへ送信されます/)).toBeVisible();
  const saved = { ...useWorkspace.getState().snapshot, materials: [material] };
  vi.mocked(api.addMaterials).mockResolvedValue(saved);
  await user.click(screen.getByRole("button", { name: "フォルダーを追加" }));
  expect(api.addMaterials).toHaveBeenCalledWith("a", "folder");
  expect(screen.getByText(material.path)).toBeVisible();
  expect(useWorkspace.getState().projectDrafts.a.memory).toBe("保持する");
  expect(useWorkspace.getState().references).toHaveLength(1);
  vi.mocked(api.removeMaterial).mockResolvedValue({ ...saved, materials: [] });
  await user.click(screen.getByRole("button", { name: `${material.path}の参照を解除` }));
  expect(api.removeMaterial).toHaveBeenCalledWith("a", "source");
  expect(screen.getByText("参照資料はまだありません。")).toBeVisible();
});

it("keeps grants after cancellation or failure and releases the project lock", async () => {
  const user = userEvent.setup();
  const saved = { ...useWorkspace.getState().snapshot, materials: [material] };
  useWorkspace.setState({ snapshot: saved });
  render(<ReferenceMaterials />);
  await user.click(screen.getByRole("button", { name: /参照資料/ }));
  vi.mocked(api.addMaterials).mockResolvedValue(saved);
  await user.click(screen.getByRole("button", { name: "ファイルを追加" }));
  expect(useWorkspace.getState().snapshot.materials).toEqual([material]);
  vi.mocked(api.removeMaterial).mockRejectedValue(new Error("保存失敗"));
  await user.click(screen.getByRole("button", { name: `${material.path}の参照を解除` }));
  expect(screen.getByRole("alert")).toHaveTextContent("保存失敗");
  expect(screen.getByText(material.path)).toBeVisible();
  expect(useWorkspace.getState().switching).toBe(false);
});

it("blocks concurrent switches and agent-time grant changes", async () => {
  let finish!: (snapshot: typeof emptySnapshot) => void;
  vi.mocked(api.addMaterials).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const job = useWorkspace.getState().updateMaterials({ kind: "file" });
  expect(useWorkspace.getState().switching).toBe(true);
  expect(await useWorkspace.getState().changeProject("b")).toBe(false);
  expect(await useWorkspace.getState().updateMaterials({ kind: "folder" })).toBe(false);
  finish(useWorkspace.getState().snapshot);
  expect(await job).toBe(true);
  useWorkspace.setState({ busy: { kind: "chat", conversation: "c" } });
  expect(await useWorkspace.getState().updateMaterials({ remove: "source" })).toBe(false);
  const user = userEvent.setup();
  render(<ReferenceMaterials />);
  await user.click(screen.getByRole("button", { name: "参照資料" }));
  expect(screen.getByRole("button", { name: "ファイルを追加" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "フォルダーを追加" })).toBeDisabled();
});
