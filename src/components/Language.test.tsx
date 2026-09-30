import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "./Settings";
import { Board } from "./Board";
import { ReviewAccess } from "./ReviewAccess";
import { MarkdownEditor } from "./MarkdownEditor";
import { AgentConnection } from "./AgentConnection";
import { setLanguage, readLanguagePreference } from "@/lib/i18n";
import { api, emptySnapshot } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import type { ReactNode } from "react";

vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: ({ children }: { children: ReactNode }) => children,
  DragOverlay: () => null,
  useDroppable: () => ({}),
}));
vi.mock("@dnd-kit/react/sortable", () => ({ useSortable: () => ({}) }));

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  native: true,
  api: { reviewConnection: vi.fn(), action: vi.fn(), connection: vi.fn() },
}));

beforeEach(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
  vi.clearAllMocks();
  useWorkspace.setState({
    snapshot: { ...emptySnapshot },
    busy: null,
    switching: false,
    reviewAccess: null,
    reviewError: null,
    connections: {},
    loaded: true,
    archiveNotice: null,
    archivePending: false,
  });
});

it("switches language through Settings, updates open views, and leaves saved cards untouched", async () => {
  const user = userEvent.setup();
  const card = {
    id: "a",
    title: "検討する",
    body: "Japanese content stays as written.",
    status: "idea" as const,
    position: 0,
    revision: 1,
    source: "user",
    deleted: false,
    createdAt: 1,
    updatedAt: 1,
  };
  useWorkspace.setState({ snapshot: { ...emptySnapshot, cards: [card] } });
  render(
    <>
      <Settings />
      <Board />
    </>,
  );
  await user.click(screen.getByRole("button", { name: "設定" }));
  await user.click(screen.getByRole("combobox", { name: "表示言語" }));
  await user.click(screen.getByRole("option", { name: "English" }));
  expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  expect(readLanguagePreference()).toBe("en");
  await user.keyboard("{Escape}");
  expect(screen.getByRole("heading", { name: "Ideas" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Exploring" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "検討する" })).toBeInTheDocument();
  expect(useWorkspace.getState().snapshot.cards[0]).toEqual(card);
  expect(api.action).not.toHaveBeenCalled();
});

it("keeps editor content, selection, and undo history when its language changes", () => {
  const onChange = vi.fn();
  const { container } = render(
    <MarkdownEditor value="保存済み" onChange={onChange} onSelection={() => {}} />,
  );
  const editor = EditorView.findFromDOM(container.querySelector(".cm-editor")!)!;
  act(() =>
    editor.dispatch({
      changes: { from: editor.state.doc.length, insert: " draft" },
      selection: { anchor: 3 },
    }),
  );
  act(() => setLanguage("en"));
  expect(EditorView.findFromDOM(container.querySelector(".cm-editor")!)).toBe(editor);
  expect(editor.state.doc.toString()).toBe("保存済み draft");
  expect(editor.state.selection.main.anchor).toBe(3);
  expect(screen.getByRole("textbox", { name: "Card content" })).toBeInTheDocument();
  act(() => {
    expect(undo(editor)).toBe(true);
  });
  expect(editor.state.doc.toString()).toBe("保存済み");
});

it("uses English for review consent and native failures without clearing the code", async () => {
  const user = userEvent.setup();
  setLanguage("en");
  vi.mocked(api.reviewConnection).mockRejectedValue(
    "審査用コードの有効期限が切れています。新しいコードを入力してください。",
  );
  render(<ReviewAccess />);
  await user.click(screen.getByRole("button", { name: "Use review access" }));
  await user.type(screen.getByLabelText("Review access code"), "review-test-code");
  expect(screen.getByRole("button", { name: "Agree and connect" })).toBeDisabled();
  await user.click(
    screen.getByRole("checkbox", {
      name: "I agree to send data through the relay server to OpenAI",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Agree and connect" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The review access code has expired. Enter a new code.",
  );
  expect(screen.getByLabelText("Review access code")).toHaveValue("review-test-code");
  act(() => setLanguage("ja"));
  expect(screen.getByRole("alert")).toHaveTextContent("審査用コードの有効期限が切れています。");
  expect(screen.getByLabelText("審査用コード")).toHaveValue("review-test-code");
});

it("translates a native connection status when the language changes", () => {
  useWorkspace.setState({
    planStatus: { available: true, accounts: [], active: null, warning: null },
    planError: "接続状況からChatGPTでサインインしてください。",
  });
  render(<AgentConnection agent="codex" />);
  act(() => setLanguage("en"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Sign in with ChatGPT from connection settings.",
  );
});
