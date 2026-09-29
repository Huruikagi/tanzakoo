import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chat } from "./Chat";
import { useWorkspace } from "@/lib/workspace";
import { api, emptySnapshot } from "@/lib/api";
import type { Card } from "@/bindings/Card";
import type { Discussion } from "@/bindings/Discussion";
import type { ChoiceQuestion } from "@/bindings/ChoiceQuestion";
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  native: true,
  emptySnapshot: {
    project: { id: "a", name: "A", memory: "", revision: 1 },
    projects: [],
    memoryProposals: [],
    cards: [],
    proposals: [],
    conversations: [],
    messages: [],
    discussions: [],
    questions: [],
    agents: [],
    consents: [],
  },
  api: {
    action: vi.fn(),
    snapshot: vi.fn(),
    send: vi.fn(),
    cancel: vi.fn(),
    connection: vi.fn(),
    setConsent: vi.fn(),
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  useWorkspace.setState({
    loaded: true,
    snapshot: emptySnapshot,
    busy: null,
    conversation: null,
    references: [],
    permissions: [],
    stream: "",
    activity: "",
    error: null,
    chatError: null,
    connections: {},
    planStatus: { available: false, accounts: [], active: null, warning: null },
    planError: null,
    selected: null,
    switching: false,
    drafts: {},
    questionDrafts: {},
  });
});

const topic: Card = {
  id: "topic",
  title: "通知のタイミング",
  body: "いつ通知する？",
  status: "discuss",
  revision: 2,
  position: 1,
  source: "user",
  deleted: false,
  createdAt: 1,
  updatedAt: 2,
};
const choiceQuestion: ChoiceQuestion = {
  id: "q",
  conversationId: "c",
  messageId: "m",
  question: "誰が使いますか？",
  options: [
    { label: "自分用", description: "一人で使う" },
    { label: "チーム用", description: "共有する" },
  ],
  state: "pending",
  selectedOption: null,
  answerText: null,
};
function questionSnapshot() {
  return {
    ...emptySnapshot,
    consents: ["codex"],
    conversations: [{ id: "c", title: "相談", agent: "codex", sessionId: null, createdAt: 1 }],
    messages: [
      {
        id: "m",
        conversationId: "c",
        role: "user",
        text: "TODOを作りたい",
        references: [],
        createdAt: 1,
      },
    ],
    questions: [choiceQuestion],
  };
}
it("sends a choice once while preserving the draft and attached references", async () => {
  const user = userEvent.setup();
  const snapshot = questionSnapshot();
  useWorkspace.setState({ snapshot, conversation: "c" });
  useWorkspace.getState().attach(topic);
  let finish!: () => void;
  vi.mocked(api.send).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.mocked(api.snapshot).mockResolvedValue({
    ...snapshot,
    questions: [{ ...choiceQuestion, state: "answered", selectedOption: 0 }],
  });
  render(<Chat />);
  await user.type(screen.getByLabelText("エージェントへのメッセージ"), "考え途中");
  const option = screen.getByRole("button", { name: "自分用" });
  await user.click(option);
  expect(api.send).not.toHaveBeenCalled();
  await user.dblClick(screen.getByRole("button", { name: "回答を送信" }));
  expect(api.send).toHaveBeenCalledExactlyOnceWith("c", "質問への回答", [], "a", [
    {
      questionId: "q",
      optionIndex: 0,
      text: null,
    },
  ]);
  expect(option).toBeDisabled();
  await act(async () => finish());
  expect(screen.getByText("回答済み")).toBeVisible();
  expect(screen.queryByRole("button", { name: "回答を送信" })).not.toBeInTheDocument();
  await user.click(screen.getByText("回答済み"));
  expect(screen.getByText("自分用")).toBeVisible();
  expect(screen.getByLabelText("エージェントへのメッセージ")).toHaveValue("考え途中");
  expect(screen.getByRole("button", { name: `${topic.title}の参照を外す` })).toBeVisible();
  expect(api.action).not.toHaveBeenCalled();
});
it("keeps free-text replies available and isolates questions between conversations", async () => {
  const user = userEvent.setup();
  const snapshot = questionSnapshot();
  useWorkspace.setState({ snapshot, conversation: "c" });
  vi.mocked(api.send).mockResolvedValue();
  vi.mocked(api.snapshot).mockResolvedValue({
    ...snapshot,
    questions: [{ ...choiceQuestion, state: "dismissed" }],
  });
  render(<Chat />);
  await user.type(screen.getByLabelText("エージェントへのメッセージ"), "家族で使う");
  await user.click(screen.getByRole("button", { name: "メッセージを送信" }));
  expect(api.send).toHaveBeenCalledWith("c", "家族で使う", [], "a");
  expect(screen.queryByRole("button", { name: "回答を送信" })).not.toBeInTheDocument();
  act(() => useWorkspace.getState().selectConversation(null));
  expect(screen.queryByRole("region", { name: "誰が使いますか？" })).not.toBeInTheDocument();
});
it("shows errors and refreshes stale choices without clearing the draft", async () => {
  const user = userEvent.setup();
  const snapshot = questionSnapshot();
  useWorkspace.setState({ snapshot, conversation: "c" });
  vi.mocked(api.send).mockRejectedValue(new Error("回答受付は終了しています"));
  vi.mocked(api.snapshot).mockResolvedValue({
    ...snapshot,
    questions: [{ ...choiceQuestion, state: "cancelled" }],
  });
  render(<Chat />);
  await user.type(screen.getByLabelText("エージェントへのメッセージ"), "補足");
  await user.click(screen.getByRole("button", { name: "自分用" }));
  await user.click(screen.getByRole("button", { name: "回答を送信" }));
  expect(screen.getByRole("alert")).toHaveTextContent("回答受付は終了しています");
  expect(screen.getByText("この質問は取り消されました")).toBeVisible();
  expect(screen.getByLabelText("エージェントへのメッセージ")).toHaveValue("補足");
});
it("stacks questions, preserves per-question free text across navigation, and sends one complete batch", async () => {
  const user = userEvent.setup();
  const second: ChoiceQuestion = {
    ...choiceQuestion,
    id: "q2",
    question: "いつ使いますか？",
    options: [
      { label: "朝", description: "一日の始まり" },
      { label: "夜", description: "一日の終わり" },
    ],
  };
  const snapshot = { ...questionSnapshot(), questions: [choiceQuestion, second] };
  useWorkspace.setState({ snapshot, conversation: "c" });
  vi.mocked(api.send).mockResolvedValue();
  vi.mocked(api.snapshot).mockResolvedValue({
    ...snapshot,
    questions: [
      { ...choiceQuestion, state: "answered", answerText: "家族で使う" },
      { ...second, state: "answered", selectedOption: 0 },
    ],
  });
  const rendered = render(<Chat />);
  expect(screen.getByRole("button", { name: "まとめて送信" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "自分で回答する" }));
  expect(screen.getByRole("button", { name: "次の質問" })).toBeDisabled();
  await user.type(screen.getByLabelText("誰が使いますか？への自由入力"), "家族で使う");
  await user.click(screen.getByRole("button", { name: "次の質問" }));
  expect(screen.getByRole("button", { name: "まとめて送信" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "朝" }));
  expect(api.send).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "戻る" }));
  expect(screen.getByLabelText("誰が使いますか？への自由入力")).toHaveValue("家族で使う");
  await user.click(screen.getByRole("button", { name: "自分用" }));
  await user.click(screen.getByRole("button", { name: "戻る" }));
  await user.click(screen.getByRole("button", { name: "自分で回答する" }));
  expect(screen.getByLabelText("誰が使いますか？への自由入力")).toHaveValue("家族で使う");
  rendered.unmount();
  render(<Chat />);
  expect(screen.getByLabelText("誰が使いますか？への自由入力")).toHaveValue("家族で使う");
  await user.click(screen.getByRole("button", { name: "まとめて送信" }));
  expect(api.send).toHaveBeenCalledExactlyOnceWith("c", "質問への回答", [], "a", [
    { questionId: "q", optionIndex: null, text: "家族で使う" },
    { questionId: "q2", optionIndex: 0, text: null },
  ]);
  expect(screen.getByText("回答済み")).toBeVisible();
  await user.click(screen.getByText("回答済み"));
  expect(screen.getByText("家族で使う")).toBeVisible();
  expect(screen.getByText("朝", { exact: true })).toBeVisible();
  expect(useWorkspace.getState().questionDrafts.a).toEqual({});
});
it("retains batch answers after a pre-send failure and refuses blank or oversized free text", async () => {
  const user = userEvent.setup();
  const snapshot = questionSnapshot();
  useWorkspace.setState({ snapshot, conversation: "c" });
  vi.mocked(api.send).mockRejectedValueOnce(new Error("送信できませんでした"));
  vi.mocked(api.snapshot).mockResolvedValue(snapshot);
  render(<Chat />);
  await user.click(screen.getByRole("button", { name: "自分で回答する" }));
  const input = screen.getByLabelText("誰が使いますか？への自由入力");
  await user.type(input, "   ");
  expect(screen.getByRole("button", { name: "回答を送信" })).toBeDisabled();
  await user.clear(input);
  await user.click(input);
  await user.paste("長".repeat(2001));
  expect(screen.getByRole("button", { name: "回答を送信" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("2000文字以内");
  await user.clear(input);
  await user.type(input, "まだ決められない");
  await user.click(screen.getByRole("button", { name: "回答を送信" }));
  expect(screen.getByRole("alert")).toHaveTextContent("送信できませんでした");
  expect(input).toHaveValue("まだ決められない");
  expect(screen.getByRole("button", { name: "回答を送信" })).toBeEnabled();
});
it("keeps pending questions outside history and folds proposals without stealing the draft or focus", async () => {
  const user = userEvent.setup();
  const snapshot = {
    ...proposalSnapshot(),
    ...questionSnapshot(),
    cards: proposalSnapshot().cards,
    proposals: proposalSnapshot().proposals,
  };
  useWorkspace.setState({ snapshot: { ...snapshot, questions: [] }, conversation: "c" });
  useWorkspace.getState().attach(topic);
  render(<Chat />);
  const composer = screen.getByLabelText("エージェントへのメッセージ");
  await user.type(composer, "考え途中");
  act(() => useWorkspace.setState({ snapshot }));
  expect(composer).toHaveFocus();
  expect(composer).toHaveValue("考え途中");
  const history = screen.getByLabelText("会話メッセージ");
  const question = screen.getByRole("region", { name: "質問に回答" });
  expect(history).not.toContainElement(question);
  expect(screen.getByText("回答待ち")).toBeVisible();
  const proposals = screen.getByRole("button", { name: "未承認の変更 2" });
  expect(proposals).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: "まとめて承認 (2)" })).not.toBeInTheDocument();
  await user.click(within(question).getByRole("button", { name: "自分で回答する" }));
  const input = screen.getByLabelText("誰が使いますか？への自由入力");
  await user.type(input, "家族で使う");
  expect(screen.getByText("送信待ち")).toBeVisible();
  expect(within(question).queryByRole("status")).not.toBeInTheDocument();
  await user.click(proposals);
  expect(screen.getByRole("button", { name: "まとめて承認 (2)" })).toBeEnabled();
  act(() => useWorkspace.setState({ snapshot: { ...snapshot } }));
  expect(proposals).toHaveAttribute("aria-expanded", "true");
  await user.click(proposals);
  expect(input).toHaveValue("家族で使う");
  expect(composer).toHaveValue("考え途中");
  expect(screen.getByRole("button", { name: `${topic.title}の参照を外す` })).toBeVisible();
  expect(api.send).not.toHaveBeenCalled();
  expect(api.action).not.toHaveBeenCalled();
});
it("shows completed answers as folded history and only the current conversation's pending questions in the dock", async () => {
  const user = userEvent.setup();
  const snapshot = questionSnapshot();
  const oldQuestion: ChoiceQuestion = {
    ...choiceQuestion,
    id: "old-q",
    messageId: "old-m",
    state: "answered",
    selectedOption: 1,
  };
  useWorkspace.setState({
    conversation: "c",
    snapshot: {
      ...snapshot,
      messages: [{ ...snapshot.messages[0]!, id: "old-m", text: "前の相談" }, ...snapshot.messages],
      questions: [
        oldQuestion,
        choiceQuestion,
        { ...choiceQuestion, id: "elsewhere", conversationId: "other" },
      ],
    },
  });
  render(<Chat />);
  const history = screen.getByLabelText("会話メッセージ");
  const summary = within(history).getByText("回答済み");
  expect(summary.closest("details")).not.toHaveAttribute("open");
  expect(screen.getAllByRole("region", { name: "質問に回答" })).toHaveLength(1);
  await user.click(summary);
  expect(within(history).getByText("チーム用")).toBeVisible();
  expect(within(history).queryByRole("button", { name: "回答を送信" })).not.toBeInTheDocument();
  act(() => useWorkspace.getState().selectConversation(null));
  expect(screen.queryByRole("region", { name: "質問に回答" })).not.toBeInTheDocument();
});
it("reveals and focuses free text on request and simplifies a single question", async () => {
  const user = userEvent.setup();
  useWorkspace.setState({ snapshot: questionSnapshot(), conversation: "c" });
  render(<Chat />);
  const question = screen.getByRole("region", { name: "質問に回答" });
  const body = question.querySelector(".chat-question-body")!;
  Object.defineProperty(body, "scrollHeight", { value: 500 });
  const history = screen.getByLabelText("会話メッセージ");
  history.scrollTop = 25;
  expect(screen.queryByLabelText("質問の切り替え")).not.toBeInTheDocument();
  expect(screen.queryByText(/質問 1 \/ 1|あと1問/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "次の質問" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "回答を送信" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "自分で回答する" }));
  const input = screen.getByLabelText("誰が使いますか？への自由入力");
  expect(input).toHaveFocus();
  expect(body.scrollTop).toBe(500);
  expect(history.scrollTop).toBe(25);
  body.scrollTop = 10;
  await user.type(input, "家族");
  expect(body.scrollTop).toBe(10);
  await user.click(screen.getByRole("button", { name: "自分で回答する" }));
  expect(body.scrollTop).toBe(500);
  expect(input).toHaveFocus();
});
it("submits free text with Ctrl+Enter but preserves newlines and ignores IME, repeats and invalid input", async () => {
  const user = userEvent.setup();
  const snapshot = questionSnapshot();
  useWorkspace.setState({ snapshot, conversation: "c" });
  vi.mocked(api.send).mockImplementation(() => new Promise(() => {}));
  render(<Chat />);
  await user.click(screen.getByRole("button", { name: "自分で回答する" }));
  const input = screen.getByLabelText("誰が使いますか？への自由入力");
  const shortcut = { key: "Enter", ctrlKey: true };
  for (const text of ["   ", "長".repeat(2001)]) {
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, shortcut);
    expect(api.send).not.toHaveBeenCalled();
  }
  fireEvent.change(input, { target: { value: "家族" } });
  await user.keyboard("{Enter}で使う");
  expect(input).toHaveValue("家族\nで使う");
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, shortcut);
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { ...shortcut, isComposing: true });
  fireEvent.keyDown(input, { ...shortcut, repeat: true });
  expect(api.send).not.toHaveBeenCalled();
  fireEvent.keyDown(input, shortcut);
  fireEvent.keyDown(input, shortcut);
  expect(api.send).toHaveBeenCalledExactlyOnceWith("c", "質問への回答", [], "a", [
    { questionId: "q", optionIndex: null, text: "家族\nで使う" },
  ]);
});
it("advances free text to unanswered questions with Ctrl+Enter and submits the completed batch", async () => {
  const user = userEvent.setup();
  const snapshot = {
    ...questionSnapshot(),
    questions: [choiceQuestion, { ...choiceQuestion, id: "q2", question: "いつ使いますか？" }],
  };
  useWorkspace.setState({ snapshot, conversation: "c" });
  vi.mocked(api.send).mockImplementation(() => new Promise(() => {}));
  render(<Chat />);
  await user.click(screen.getByRole("button", { name: "自分で回答する" }));
  await user.type(screen.getByLabelText("誰が使いますか？への自由入力"), "家族");
  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(screen.getByText("いつ使いますか？", { exact: true })).toHaveFocus();
  expect(api.send).not.toHaveBeenCalled();
  // A later answer can return to an earlier question that is now incomplete.
  act(() => useWorkspace.setState({ questionDrafts: {} }));
  await user.click(screen.getByRole("button", { name: "自分で回答する" }));
  await user.type(screen.getByLabelText("いつ使いますか？への自由入力"), "夜");
  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(screen.getByText("誰が使いますか？", { exact: true })).toHaveFocus();
  expect(api.send).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "自分で回答する" }));
  await user.type(screen.getByLabelText("誰が使いますか？への自由入力"), "家族");
  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(api.send).toHaveBeenCalledExactlyOnceWith("c", "質問への回答", [], "a", [
    { questionId: "q", optionIndex: null, text: "家族" },
    { questionId: "q2", optionIndex: null, text: "夜" },
  ]);
});
function proposalSnapshot() {
  const cards = [topic, { ...topic, id: "second", title: "表示方法" }];
  return {
    ...emptySnapshot,
    cards,
    proposals: cards.map((card) => ({
      id: `p-${card.id}`,
      cardId: card.id,
      baseRevision: card.revision,
      beforeTitle: card.title,
      beforeBody: card.body,
      title: card.title,
      body: "提案された本文",
      reason: "会話を反映",
      state: "pending",
      createdAt: 1,
    })),
  };
}
it("lists project proposals across conversations and approves the displayed IDs without losing the composer", async () => {
  const user = userEvent.setup();
  const snapshot = proposalSnapshot();
  useWorkspace.setState({ snapshot });
  useWorkspace.getState().attach(topic);
  render(<Chat />);
  await user.type(screen.getByLabelText("エージェントへのメッセージ"), "考え途中");
  vi.mocked(Element.prototype.scrollIntoView).mockClear();
  act(() => useWorkspace.setState({ conversation: "another" }));
  expect(screen.getByRole("button", { name: topic.title })).toBeVisible();
  act(() => useWorkspace.setState({ conversation: null }));
  await user.click(screen.getByRole("button", { name: topic.title }));
  expect(useWorkspace.getState().selected).toBe(topic.id);
  expect(api.action).not.toHaveBeenCalled();
  let finish!: (value: typeof snapshot) => void;
  vi.mocked(api.action).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await user.click(screen.getByRole("button", { name: "まとめて承認 (2)" }));
  expect(screen.getByRole("button", { name: "承認中…" })).toBeDisabled();
  expect(api.action).toHaveBeenCalledExactlyOnceWith(
    { type: "applyProposals", ids: ["p-topic", "p-second"] },
    "a",
  );
  await act(async () =>
    finish({
      ...snapshot,
      proposals: [
        ...snapshot.proposals.map((p) => ({ ...p, state: "applied" })),
        { ...snapshot.proposals[0]!, id: "arrived-later", state: "pending" },
      ],
    }),
  );
  expect(screen.getByRole("status")).toHaveTextContent("2件の変更を承認しました");
  expect(screen.getByRole("button", { name: "まとめて承認 (1)" })).toBeEnabled();
  expect(screen.getByLabelText("エージェントへのメッセージ")).toHaveValue("考え途中");
  expect(screen.getByRole("button", { name: `${topic.title}の参照を外す` })).toBeVisible();
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
});
it("excludes drafts, archived and outdated cards, and replaces the list when switching projects", async () => {
  const user = userEvent.setup();
  const snapshot = proposalSnapshot();
  const stale = { ...topic, id: "stale", title: "更新済み", revision: 3 };
  const archived = { ...topic, id: "archived", title: "保管済み", deleted: true };
  const blocked = [stale, archived];
  useWorkspace.setState({
    snapshot: {
      ...snapshot,
      cards: [...snapshot.cards, ...blocked],
      proposals: [
        ...snapshot.proposals,
        ...blocked.map((c) => ({ ...snapshot.proposals[0]!, id: `p-${c.id}`, cardId: c.id })),
      ],
    },
    drafts: { [topic.id]: { title: topic.title, body: "編集中", revision: 2 } },
  });
  vi.mocked(api.action).mockResolvedValue(snapshot);
  render(<Chat />);
  expect(screen.getByText("未保存の編集があります")).toBeVisible();
  expect(screen.getByText("カードが更新されています")).toBeVisible();
  expect(screen.getByText("アーカイブ済み")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "まとめて承認 (1)" }));
  expect(api.action).toHaveBeenCalledWith({ type: "applyProposals", ids: ["p-second"] }, "a");
  act(() =>
    useWorkspace.setState({
      snapshot: { ...emptySnapshot, project: { ...emptySnapshot.project, id: "b" } },
    }),
  );
  expect(screen.queryByRole("region", { name: "未承認のカード変更" })).not.toBeInTheDocument();
});
it("refreshes a failed batch and keeps its replacement pending", async () => {
  const user = userEvent.setup();
  const snapshot = proposalSnapshot();
  useWorkspace.setState({ snapshot });
  vi.mocked(api.action).mockRejectedValue(new Error("提案が置き換わっています"));
  vi.mocked(api.snapshot).mockResolvedValue({
    ...snapshot,
    proposals: [{ ...snapshot.proposals[0]!, id: "replacement", reason: "最新の変更" }],
  });
  render(<Chat />);
  await user.click(screen.getByRole("button", { name: "まとめて承認 (2)" }));
  expect(await screen.findByText("最新の変更")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("承認できませんでした");
  expect(api.action).toHaveBeenCalledTimes(1);
});
it("keeps an unsent draft and its references when broadening creates the first conversation", async () => {
  const user = userEvent.setup();
  const snapshot = {
    ...emptySnapshot,
    consents: ["codex"],
    cards: [topic],
    conversations: [
      { id: "new-chat", title: "話題を広げる", agent: "codex", sessionId: null, createdAt: 1 },
    ],
  };
  useWorkspace.setState({ snapshot: { ...snapshot, conversations: [] } });
  useWorkspace.getState().attach(topic);
  vi.mocked(api.action).mockResolvedValue(snapshot);
  vi.mocked(api.snapshot).mockResolvedValue(snapshot);
  vi.mocked(api.send).mockResolvedValue();
  render(<Chat />);
  await user.type(screen.getByLabelText("エージェントへのメッセージ"), "入力途中の考え");
  await act(async () => {
    await useWorkspace.getState().broadenTopics();
  });
  expect(screen.getByLabelText("エージェントへのメッセージ")).toHaveValue("入力途中の考え");
  expect(screen.getByRole("button", { name: `${topic.title}の参照を外す` })).toBeVisible();
  expect(api.send).toHaveBeenCalledWith(
    "new-chat",
    expect.stringContaining("話題を広げてください"),
    [],
    "a",
  );
});
it("restores a failed first message in the created conversation without overwriting new input", async () => {
  const user = userEvent.setup();
  const snapshot = {
    ...emptySnapshot,
    consents: ["codex"],
    conversations: [
      { id: "new-chat", title: "会話", agent: "codex", sessionId: null, createdAt: 1 },
    ],
  };
  useWorkspace.setState({ snapshot: { ...snapshot, conversations: [] } });
  vi.mocked(api.action).mockResolvedValue(snapshot);
  vi.mocked(api.snapshot).mockResolvedValue(snapshot);
  vi.mocked(api.send).mockRejectedValueOnce(new Error("接続失敗"));
  render(<Chat />);
  const input = screen.getByLabelText("エージェントへのメッセージ");
  await user.type(input, "送信する文章");
  await user.click(screen.getByRole("button", { name: "メッセージを送信" }));
  expect(await screen.findByText(/接続失敗/)).toBeVisible();
  expect(input).toHaveValue("送信する文章");
  expect(useWorkspace.getState().conversation).toBe("new-chat");

  let fail!: (error: Error) => void;
  vi.mocked(api.send).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  await user.click(screen.getByRole("button", { name: "メッセージを送信" }));
  await user.type(input, "次の考え");
  await act(async () => fail(new Error("再接続失敗")));
  expect(input).toHaveValue("次の考え");
});

it("preserves drafts across projects and clears only a removed project's drafts", async () => {
  const user = userEvent.setup();
  const a = { id: "a", name: "A", memory: "", revision: 1 };
  const b = { ...a, id: "b", name: "B" };
  const snapshot = { ...emptySnapshot, project: a, projects: [a, b] };
  useWorkspace.setState({ snapshot });
  render(<Chat />);
  const input = screen.getByLabelText("エージェントへのメッセージ");
  await user.type(input, "Aの下書き");
  act(() => useWorkspace.setState({ snapshot: { ...snapshot, project: b } }));
  expect(input).toHaveValue("");
  await user.type(input, "Bの下書き");
  act(() => useWorkspace.setState({ snapshot }));
  expect(input).toHaveValue("Aの下書き");
  act(() => useWorkspace.setState({ snapshot: { ...snapshot, project: b, projects: [b] } }));
  expect(input).toHaveValue("Bの下書き");
  act(() => useWorkspace.setState({ snapshot }));
  expect(input).toHaveValue("");
});
const discussion: Discussion = {
  id: "discussion",
  conversationId: "c",
  messageId: "m",
  cardId: "topic",
  title: topic.title,
  reason: "通知の具体的な希望を話している",
  previousStatus: "idea",
  previousPosition: 1,
  cardRevision: 2,
  state: "moved",
  automatic: true,
};
function discussionSnapshot() {
  return {
    ...emptySnapshot,
    cards: [topic],
    conversations: [{ id: "c", title: "通知", agent: "codex", sessionId: null, createdAt: 1 }],
    messages: [
      {
        id: "m",
        conversationId: "c",
        role: "user",
        text: "朝に通知してほしい",
        references: [],
        createdAt: 1,
      },
    ],
    discussions: [] as Discussion[],
  };
}

it("shows an automatic move without navigating, scrolling or disturbing the composer", async () => {
  const user = userEvent.setup();
  const snapshot = discussionSnapshot();
  useWorkspace.setState({ snapshot, conversation: "c" });
  render(<Chat />);
  await user.type(screen.getByLabelText("エージェントへのメッセージ"), "考え中の下書き");
  vi.mocked(Element.prototype.scrollIntoView).mockClear();
  act(() => useWorkspace.setState({ snapshot: { ...snapshot, discussions: [discussion] } }));
  expect(screen.getByRole("button", { name: "元に戻す" })).toBeEnabled();
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  expect(useWorkspace.getState().selected).toBeNull();
  expect(screen.getByLabelText("エージェントへのメッセージ")).toHaveFocus();
  expect(screen.getByLabelText("エージェントへのメッセージ")).toHaveValue("考え中の下書き");
  await user.click(screen.getByRole("button", { name: "「通知のタイミング」" }));
  expect(useWorkspace.getState().selected).toBe(topic.id);
  expect(api.action).not.toHaveBeenCalled();
  vi.mocked(api.action).mockResolvedValue({
    ...snapshot,
    cards: [{ ...topic, status: "idea", revision: 3 }],
    discussions: [{ ...discussion, state: "undone" }],
  });
  await user.click(screen.getByRole("button", { name: "元に戻す" }));
  expect(api.action).toHaveBeenCalledWith(
    { type: "resolveDiscussion", id: discussion.id, action: "undo" },
    "a",
  );
  expect(screen.getByText(/の移動を取り消しました/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "元に戻す" })).not.toBeInTheDocument();
});

it.each(["idea", "decided"] as const)(
  "waits for a UI choice for a suggested %s card",
  async (status) => {
    const user = userEvent.setup();
    const snapshot = {
      ...discussionSnapshot(),
      cards: [{ ...topic, status }],
      discussions: [
        { ...discussion, state: "suggested" as const, previousStatus: status, automatic: false },
      ],
    };
    useWorkspace.setState({ snapshot, conversation: "c" });
    render(<Chat />);
    expect(api.action).not.toHaveBeenCalled();
    expect(useWorkspace.getState().snapshot.cards[0].status).toBe(status);
    vi.mocked(api.action).mockResolvedValue({
      ...snapshot,
      cards: [topic],
      discussions: [{ ...discussion, automatic: false }],
    });
    await user.click(
      screen.getByRole("button", {
        name: status === "decided" ? "再検討する" : "このカードについて話す",
      }),
    );
    expect(api.action).toHaveBeenCalledWith(
      { type: "resolveDiscussion", id: discussion.id, action: "accept" },
      "a",
    );
    expect(useWorkspace.getState().snapshot.cards[0].status).toBe("discuss");
    expect(api.send).not.toHaveBeenCalled();
  },
);

it("does not offer stale undo or show notices from another conversation", () => {
  useWorkspace.setState({
    conversation: "c",
    snapshot: {
      ...discussionSnapshot(),
      cards: [{ ...topic, revision: 3, body: "編集後" }],
      discussions: [
        discussion,
        { ...discussion, id: "other", conversationId: "other", title: "別の会話のカード" },
      ],
    },
  });
  render(<Chat />);
  expect(screen.queryByRole("button", { name: "元に戻す" })).not.toBeInTheDocument();
  expect(screen.getByText(/カードが更新されています/)).toBeInTheDocument();
  expect(screen.queryByText(/別の会話のカード/)).not.toBeInTheDocument();
});

it("lets the user dismiss a suggestion without moving the card", async () => {
  const user = userEvent.setup();
  const snapshot = {
    ...discussionSnapshot(),
    cards: [{ ...topic, status: "idea" as const }],
    discussions: [{ ...discussion, state: "suggested" as const, automatic: false }],
  };
  useWorkspace.setState({ snapshot, conversation: "c" });
  vi.mocked(api.action).mockResolvedValue({
    ...snapshot,
    discussions: [{ ...discussion, state: "dismissed" }],
  });
  render(<Chat />);
  await user.click(screen.getByRole("button", { name: "今は移さない" }));
  expect(api.action).toHaveBeenCalledWith(
    { type: "resolveDiscussion", id: discussion.id, action: "dismiss" },
    "a",
  );
  expect(useWorkspace.getState().snapshot.cards[0].status).toBe("idea");
});
it("shows the freeform starting point with no conversation and no active agent", () => {
  render(<Chat />);
  expect(screen.getByRole("button", { name: /個人用のTODOアプリ/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "メッセージを送信" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "応答を停止" })).not.toBeInTheDocument();
  expect(screen.getByText("Codex")).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "エージェント" })).not.toBeInTheDocument();
});
it("keeps ordinary Enter for newlines and sends with Ctrl+Enter", async () => {
  const user = userEvent.setup();
  const conversation = { id: "c", title: "test", agent: "codex", sessionId: null, createdAt: 1 };
  const consented = { ...emptySnapshot, consents: ["codex"] };
  vi.mocked(api.setConsent).mockResolvedValue(consented);
  vi.mocked(api.action).mockResolvedValue({ ...consented, conversations: [conversation] });
  vi.mocked(api.snapshot).mockResolvedValue({ ...consented, conversations: [conversation] });
  vi.mocked(api.send).mockResolvedValue();
  render(<Chat />);
  await user.type(
    screen.getByLabelText("エージェントへのメッセージ"),
    "TODOアプリ{Enter}朝に使いたい",
  );
  expect(api.send).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "同意して使う" }));
  expect(api.setConsent).toHaveBeenCalledWith("codex", true);
  expect(screen.queryByRole("button", { name: "同意して使う" })).not.toBeInTheDocument();
  await user.click(screen.getByLabelText("エージェントへのメッセージ"));
  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(api.send).toHaveBeenCalledWith("c", "TODOアプリ\n朝に使いたい", [], "a");
});

it("checks connectivity without sending a prompt and preserves a draft when sign-in is required", async () => {
  const user = userEvent.setup();
  vi.mocked(api.connection).mockResolvedValue({
    state: "authRequired",
    message: "サインインが必要です。",
    canLogin: true,
  });
  render(<Chat />);
  await user.type(screen.getByLabelText("エージェントへのメッセージ"), "残しておきたい文章");
  expect(screen.queryByRole("button", { name: "接続を確認" })).not.toBeInTheDocument();
  expect(screen.queryByText("Codexの接続はまだ確認していません。")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "接続状況" }));
  expect(api.connection).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "接続を確認" }));
  expect(await screen.findByRole("button", { name: "ChatGPTでサインイン" })).toBeEnabled();
  expect(api.send).not.toHaveBeenCalled();
  expect(api.action).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "接続状況" })).toHaveFocus();
  expect(screen.getByLabelText("エージェントへのメッセージ")).toHaveValue("残しておきたい文章");
  expect(screen.getByRole("button", { name: "メッセージを送信" })).toBeDisabled();
});

it("shows Claude as not provided without starting a check, sign-in or send", async () => {
  const user = userEvent.setup();
  const conversation = { id: "c", title: "old", agent: "claude", sessionId: null, createdAt: 1 };
  useWorkspace.setState({
    conversation: "c",
    snapshot: {
      ...emptySnapshot,
      consents: ["claude"],
      conversations: [conversation],
      agents: [{ id: "claude", command: "@tanzakoo/claude-unavailable", args: [] }],
    },
  });
  render(<Chat />);
  expect(screen.getByText(/この会話は閲覧のみです/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "接続を確認" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /サインイン/ })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("エージェントへのメッセージ"), "履歴は読める");
  expect(screen.getByRole("button", { name: "メッセージを送信" })).toBeDisabled();
  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(api.send).not.toHaveBeenCalled();
  expect(api.connection).not.toHaveBeenCalled();
  expect(screen.getByLabelText("エージェントへのメッセージ")).toHaveValue("履歴は読める");
});

it("keeps legacy Claude history readable and starts new chats with Codex", async () => {
  const user = userEvent.setup();
  const conversation = { id: "c", title: "dev", agent: "claude", sessionId: null, createdAt: 1 };
  useWorkspace.setState({
    conversation: "c",
    snapshot: {
      ...emptySnapshot,
      conversations: [conversation],
      messages: [
        {
          id: "m",
          conversationId: "c",
          role: "assistant",
          text: "過去の検討内容",
          references: [],
          createdAt: 1,
        },
      ],
    },
  });
  render(<Chat />);
  expect(screen.getByText("過去の検討内容")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "同意して使う" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "接続を確認" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /サインイン/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "新しい会話" }));
  expect(screen.getByText("Codex")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "接続状況" }));
  expect(screen.getByRole("button", { name: "接続を確認" })).toBeEnabled();
  expect(useWorkspace.getState().snapshot.messages[0].text).toBe("過去の検討内容");
  expect(api.connection).not.toHaveBeenCalled();
});
