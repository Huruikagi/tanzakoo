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
    reviewAccess: null,
    planStatus: {
      available: true,
      active: { id: "account-a", label: "Account A", signedIn: true },
      accounts: [],
      warning: null,
    },
  });
  vi.mocked(api.chatOptions).mockImplementation(async (_, __, model) =>
    choices(model ?? undefined),
  );
  vi.mocked(api.action).mockImplementation(async (action) => ({
    ...useWorkspace.getState().snapshot,
    ...(action.type === "configureChat"
      ? action.agent === "codex"
        ? { chatSettings: action.settings }
        : {
            externalChatSettings: {
              ...useWorkspace.getState().snapshot.externalChatSettings,
              [action.agent]: action.settings,
            },
          }
      : {}),
  }));
});

async function open(agent?: string) {
  const user = userEvent.setup();
  render(<ChatSettings agent={agent} />);
  await user.click(screen.getByRole("button", { name: "モデル・推論強度の設定" }));
  return user;
}

it("loads on request, refreshes effort choices after changing model, and saves for this project", async () => {
  const user = await open();
  expect(api.chatOptions).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "選択肢を取得" }));
  expect(api.chatOptions).toHaveBeenCalledWith("project-a", "codex", null);
  const model = screen.getByRole("combobox", { name: "モデル" });
  fireEvent.keyDown(model, { key: "ArrowDown" });
  await user.click(await screen.findByRole("option", { name: "Model B" }));
  expect(api.chatOptions).toHaveBeenLastCalledWith("project-a", "codex", "model-b");
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "推論強度" })).toHaveTextContent("低"),
  );
  await user.click(screen.getByRole("button", { name: "チャット設定を保存" }));
  expect(api.action).toHaveBeenCalledWith(
    {
      type: "configureChat",
      agent: "codex",
      settings: { model: "model-b", reasoningEffort: "low" },
    },
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

it("saves a supported plan effort and shows it in the current settings", async () => {
  const user = await open();
  await user.click(screen.getByRole("button", { name: "選択肢を取得" }));
  fireEvent.keyDown(screen.getByRole("combobox", { name: "推論強度" }), { key: "ArrowDown" });
  await user.click(await screen.findByRole("option", { name: "高" }));
  await user.click(screen.getByRole("button", { name: "チャット設定を保存" }));
  expect(api.action).toHaveBeenCalledWith(
    {
      type: "configureChat",
      agent: "codex",
      settings: { model: "model-a", reasoningEffort: "high" },
    },
    "project-a",
  );
  expect(await screen.findByText("現在の設定: model-a · 高")).toBeVisible();
});

it("clears a previous effort when the selected model has no advertised choices", async () => {
  useWorkspace.setState((s) => ({
    snapshot: { ...s.snapshot, chatSettings: { model: "model-a", reasoningEffort: "high" } },
  }));
  vi.mocked(api.chatOptions).mockImplementation(async (_, __, model) =>
    model === "model-b" ? choices(model).filter((o) => o.id === "model") : choices(),
  );
  const user = await open();
  await user.click(screen.getByRole("button", { name: "選択肢を取得" }));
  fireEvent.keyDown(screen.getByRole("combobox", { name: "モデル" }), { key: "ArrowDown" });
  await user.click(await screen.findByRole("option", { name: "Model B" }));
  expect(
    await screen.findByText("この接続では推論強度の選択肢を確認できないため、既定値を使います。"),
  ).toBeVisible();
  expect(screen.queryByRole("combobox", { name: "推論強度" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "チャット設定を保存" }));
  expect(api.action).toHaveBeenCalledWith(
    {
      type: "configureChat",
      agent: "codex",
      settings: { model: "model-b", reasoningEffort: null },
    },
    "project-a",
  );
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

it("chooses an external CLI's model and effort separately from the ChatGPT settings", async () => {
  useWorkspace.setState((s) => ({
    reviewAccess: { model: "review-model" } as never,
    snapshot: {
      ...s.snapshot,
      externalAgentsAvailable: true,
      chatSettings: { model: "model-a", reasoningEffort: "high" },
    },
  }));
  vi.mocked(api.chatOptions).mockImplementation(async (_, __, model) => [
    {
      id: "model",
      currentValue: model ?? "opus",
      options: [
        { value: "default", name: "Default (recommended)" },
        { value: "opus", name: "Opus" },
        { value: "sonnet", name: "Sonnet" },
      ],
    },
    {
      id: "reasoning_effort",
      currentValue: "medium",
      options: ["default", "low", "medium", "max"].map((value) => ({ value, name: value })),
    },
  ]);
  const user = await open("claude-api");
  expect(
    screen.getByText("このプロジェクトでこのCLIを使う会話に、次の送信から反映します。"),
  ).toBeVisible();
  expect(screen.getByText("現在の設定: 接続先の既定値 · 会話の既定の推論強度")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "選択肢を取得" }));
  expect(api.chatOptions).toHaveBeenCalledWith("project-a", "claude-api", null);
  fireEvent.keyDown(screen.getByRole("combobox", { name: "モデル" }), { key: "ArrowDown" });
  await user.click(await screen.findByRole("option", { name: "Sonnet" }));
  expect(api.chatOptions).toHaveBeenLastCalledWith("project-a", "claude-api", "sonnet");
  fireEvent.keyDown(screen.getByRole("combobox", { name: "推論強度" }), { key: "ArrowDown" });
  await user.click(await screen.findByRole("option", { name: "既定" }));
  await user.click(screen.getByRole("button", { name: "チャット設定を保存" }));
  expect(api.action).toHaveBeenCalledWith(
    {
      type: "configureChat",
      agent: "claude-api",
      settings: { model: "sonnet", reasoningEffort: "default" },
    },
    "project-a",
  );
  expect(await screen.findByText("現在の設定: sonnet · 既定")).toBeVisible();
  expect(useWorkspace.getState().snapshot.chatSettings.model).toBe("model-a");
});
