// Fixture only. Run against source 2a5adab; this is not a production entry point.
import React from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import "../../../src/index.css";
import "../../../src/workspace.css";

const params = new URLSearchParams(location.search);
const ja = params.get("lang") === "ja";
const scene = params.get("scene") ?? "board";
localStorage.setItem("tanzakoo-language", ja ? "ja" : "en");
window.isTauri = true;
const project = {
  id: "store-preview",
  name: ja ? "週末の小さなアプリ" : "A small weekend app",
  memory: ja
    ? "忙しい平日でも、次の一歩が見つかる個人用メモ。最初は一人で使う。"
    : "A personal notebook that makes the next step clear, even on busy days. Start with one user.",
  revision: 1,
};
const entries = ja
  ? [
      ["idea", "あとで考える箱", "思いついたことを短く残す。整理はあとで。"],
      ["idea", "週末の振り返り", "今週進んだことを、数分で見返したい。"],
      ["explore", "最初に使う場面", "朝、今日の作業を始める前に開く。"],
      ["explore", "入力の手間を減らす", "タイトルだけでも保存できるようにする。"],
      ["discuss", "今日の一歩を選ぶ", "今日取り組むことを選べるようにする。"],
      ["decided", "まずは一人で使う", "初版は個人向け。共有機能は後から検討する。"],
      ["decided", "文章で持ち出せる", "決まった内容をMarkdownで保存できるようにする。"],
    ]
  : [
      ["idea", "An inbox for later", "Capture a short thought now. Organize it later."],
      ["idea", "A weekend reflection", "Review the week's progress in a few minutes."],
      ["explore", "The first moment of use", "Open it in the morning, before starting work."],
      ["explore", "Make capture easy", "A title should be enough to save a thought."],
      ["discuss", "Choose today's next step", "Let me choose what to work on today."],
      ["decided", "Start with one user", "Build for personal use first. Consider sharing later."],
      ["decided", "Take decisions with you", "Save decisions as Markdown files."],
    ];
const cards = entries.map(([status, title, body], index) => ({
  id: `card-${index}`,
  title,
  body,
  status,
  revision: 1,
  position: index,
  source: "user",
  deleted: false,
  createdAt: 1790553600000,
  updatedAt: 1790553600000,
}));
const target = cards[4];
const snapshot = {
  project,
  projects: [project],
  memoryProposals: [],
  cards,
  proposals:
    scene === "proposal"
      ? [
          {
            id: "preview-proposal",
            cardId: target.id,
            baseRevision: 1,
            beforeTitle: target.title,
            beforeBody: target.body,
            title: target.title,
            body: ja
              ? "今日取り組むことを一つ選ぶ。終わったら、次の一歩を選べる。"
              : "Choose one thing to work on today. When it is done, choose the next step.",
            reason: ja ? "一度に考えることを絞ります。" : "Keep the focus on one action at a time.",
            state: "pending",
            createdAt: 1790553601000,
          },
        ]
      : [],
  conversations: [
    {
      id: "preview-chat",
      title: ja ? "朝の使い方を考える" : "Explore the morning routine",
      agent: "codex",
      sessionId: null,
      createdAt: 1790553600000,
    },
  ],
  messages: [
    {
      id: "preview-user",
      conversationId: "preview-chat",
      role: "user",
      text: ja
        ? "「今日の一歩を選ぶ」の内容を具体的にする変更案を出して。"
        : "Suggest a more specific description for Choose today's next step.",
      references: [],
      createdAt: 1790553600000,
    },
    {
      id: "preview-assistant",
      conversationId: "preview-chat",
      role: "assistant",
      text: ja
        ? "一つ選んでから次へ進む案にしました。カードの変更案を確認して、適用するか決められます。"
        : "The proposal focuses on choosing one action before moving to the next. Review the change on the card and decide whether to apply it.",
      references: [],
      createdAt: 1790553601000,
    },
  ],
  questions: [],
  discussions: [],
  agents: [{ id: "codex", command: "@tanzakoo/managed", args: [] }],
  consents: ["codex"],
  chatSettings: { model: null, reasoningEffort: null },
  materials: [],
};

// No requests reach a native backend, AI provider, or relay.
mockIPC(async (command) => {
  if (command === "get_snapshot") return structuredClone(snapshot);
  if (command === "get_review_status") return null;
  if (command === "agent_connection") return { state: "ready", message: null, canLogin: false };
  if (command === "plugin:event|listen") return 1;
  throw new Error(`Preview does not implement ${command}`);
});
const { default: App } = await import("../../../src/App");
const { useWorkspace } = await import("../../../src/lib/workspace");
useWorkspace.setState({
  snapshot,
  loaded: true,
  selected: scene === "proposal" ? target.id : cards[5].id,
  conversation: "preview-chat",
  chatOpen: scene === "proposal",
});
createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <div
      style={{
        position: "fixed",
        bottom: 4,
        left: 8,
        padding: "3px 8px",
        background: "#fff9e8",
        border: "1px solid #c0ad76",
        font: "11px sans-serif",
        color: "#59441a",
        zIndex: 100,
        pointerEvents: "none",
      }}
    >
      {ja
        ? "構図案・サンプルデータ / Mac実機画像ではありません"
        : "Composition draft · Sample data · Not a Mac capture"}
    </div>
  </>,
);
