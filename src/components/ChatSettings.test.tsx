import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatSettings } from "./ChatSettings";
import { api, emptySnapshot } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import type { ChatOption } from "@/bindings/ChatOption";

vi.mock("@/lib/api", async (original) => {
  const module = await original<typeof import("@/lib/api")>();
  return {
    ...module,
    native: true,
    api: { ...module.api, chatOptions: vi.fn(), action: vi.fn(), cancel: vi.fn() },
  };
});

const choices = (model = "model-a"): ChatOption[] => [
  {
    id: "model",
    currentValue: model,
    options: [
      { value: "model-a", name: "Model A" },
      { value: "model-b", name: "Model B" },
    ],
  },
  {
    id: "reasoning_effort",
    currentValue: model === "model-a" ? "medium" : "low",
    options: (model === "model-a" ? ["medium", "high"] : ["low"]).map((value) => ({
      value,
      name: value,
    })),
  },
];
beforeEach(() => {
  vi.resetAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  useWorkspace.setState({
    snapshot: {
      ...emptySnapshot,
      project: { ...emptySnapshot.project, id: "project-a" },
      consents: ["codex"],
    },
    busy: null,
    switching: false,
    activity: "",
    error: null,
  });
  vi.mocked(api.chatOptions).mockImplementation(async (_, model) => choices(model ?? undefined));
  vi.mocked(api.action).mockImplementation(async (action) => ({
    ...useWorkspace.getState().snapshot,
    ...(action.type === "configureChat" ? { chatSettings: action.settings } : {}),
  }));
});

async function open() {
  const user = userEvent.setup();
  render(<ChatSettings />);
  await user.click(screen.getByRole("button", { name: "モデル・推論強度の設定" }));
  return user;
}

it("loads on request, refreshes effort choices after changing model, and saves for this project", async () => {
  const user = await open();
  expect(api.chatOptions).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "選択肢を取得" }));
  expect(api.chatOptions).toHaveBeenCalledWith("project-a", null);
  const model = screen.getByRole("combobox", { name: "モデル" });
  fireEvent.keyDown(model, { key: "ArrowDown" });
  await user.click(await screen.findByRole("option", { name: "Model B" }));
  expect(api.chatOptions).toHaveBeenLastCalledWith("project-a", "model-b");
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "推論強度" })).toHaveTextContent("低"),
  );
  await user.click(screen.getByRole("button", { name: "チャット設定を保存" }));
  expect(api.action).toHaveBeenCalledWith(
    { type: "configureChat", settings: { model: "model-b", reasoningEffort: "low" } },
    "project-a",
  );
  expect(await screen.findByText("保存しました。次の送信から反映します。")).toBeVisible();
  expect(useWorkspace.getState().snapshot.consents).toEqual(["codex"]);
});

it("blocks sending and project switching during discovery and recovers after a failure", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(api.chatOptions).mockReturnValueOnce(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  const user = await open();
  await user.click(screen.getByRole("button", { name: "選択肢を取得" }));
  expect(useWorkspace.getState().busy?.kind).toBe("settings");
  expect(await useWorkspace.getState().changeProject("project-b")).toBe(false);
  expect(screen.getByRole("button", { name: "選択肢を取得中…" })).toBeDisabled();
  await act(async () => reject(new Error("サインインしてください")));
  expect(screen.getByRole("alert")).toHaveTextContent("サインインしてください");
  expect(useWorkspace.getState().busy).toBeNull();
  expect(screen.queryByRole("button", { name: "チャット設定を保存" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "既定のモデルで再取得" }));
  expect(await screen.findByRole("combobox", { name: "モデル" })).toHaveTextContent("Model A");
});

it("keeps saved values on save failure and disables entry during a response", async () => {
  useWorkspace.setState((s) => ({
    snapshot: { ...s.snapshot, chatSettings: { model: "model-a", reasoningEffort: "high" } },
  }));
  vi.mocked(api.action).mockRejectedValueOnce(new Error("disk full"));
  const user = await open();
  await user.click(screen.getByRole("button", { name: "選択肢を取得" }));
  expect(screen.getByRole("combobox", { name: "推論強度" })).toHaveTextContent("高");
  await user.click(screen.getByRole("button", { name: "チャット設定を保存" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("保存に失敗");
  expect(useWorkspace.getState().snapshot.chatSettings.reasoningEffort).toBe("high");
  await user.keyboard("{Escape}");
  act(() => useWorkspace.setState({ busy: { kind: "chat", conversation: "c" } }));
  expect(screen.getByRole("button", { name: "モデル・推論強度の設定" })).toBeDisabled();
});
