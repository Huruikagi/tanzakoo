import { expect, it } from "vitest";
import { buildTextDiff } from "./text-diff";

it("highlights a small Japanese edit without highlighting the surrounding sentence", () => {
  const blocks = buildTextDiff("期限の前日に通知する。", "期限の前日と当日に通知する。");
  expect(blocks.find((b) => b.kind === "added")?.parts.filter((p) => p.changed)).toEqual([
    { text: "と当日", changed: true },
  ]);
});

it("keeps emoji graphemes whole", () => {
  const blocks = buildTextDiff("担当👩‍💻です", "担当👨‍💻です");
  expect(blocks[0].parts.filter((p) => p.changed)).toEqual([{ text: "👩‍💻", changed: true }]);
  expect(blocks[1].parts.filter((p) => p.changed)).toEqual([{ text: "👨‍💻", changed: true }]);
});

it.each([
  ["", "# 新しい本文\n"],
  ["すべて削除する\n", ""],
  ["同じ本文", "同じ本文"],
  ["- 通知する\n\n末尾", "-  通知する\n\n末尾\n"],
  ["最初\n削除\n最後\n", "最初\n最後\n追加\n"],
  ["あ".repeat(21000), "い".repeat(21000)],
])("preserves the complete old and new text (%#. case)", (before, after) => {
  const blocks = buildTextDiff(before, after);
  const text = (side: "removed" | "added") =>
    blocks
      .filter((b) => b.kind === "same" || b.kind === side)
      .flatMap((b) => b.parts.map((p) => p.text))
      .join("");
  expect(text("removed")).toBe(before);
  expect(text("added")).toBe(after);
});

it("does not report Windows line endings as wording changes", () => {
  expect(buildTextDiff("同じ\r\n本文\r\n", "同じ\n本文\n").every((b) => b.kind === "same")).toBe(
    true,
  );
});
