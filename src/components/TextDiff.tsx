import { useMemo } from "react";
import { buildTextDiff, type DiffBlock } from "@/lib/text-diff";

function DiffRow({ block }: { block: DiffBlock }) {
  const label = block.kind === "removed" ? "削除" : block.kind === "added" ? "追加" : "変更なし";
  return (
    <div className={`diff-row diff-${block.kind}`}>
      <span className="sr-only">{label}：</span>
      <span className="diff-sign" aria-hidden="true">
        {block.kind === "removed" ? "−" : block.kind === "added" ? "+" : " "}
      </span>
      <div className="diff-text">
        {block.parts.map((part, index) =>
          part.changed ? (
            <mark key={index}>{part.text}</mark>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </div>
    </div>
  );
}

function Context({ text, first, last }: { text: string; first: boolean; last: boolean }) {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const head = first ? 0 : 2;
  const tail = last ? 0 : 2;
  const row = (value: string) => (
    <DiffRow block={{ kind: "same", parts: [{ text: value, changed: false }] }} />
  );
  if (lines.length <= head + tail + 3) return row(text);
  const end = lines.length - tail;
  return (
    <>
      {head > 0 && row(lines.slice(0, head).join(""))}
      <details className="diff-context">
        <summary>変更のない{end - head}行を表示</summary>
        {row(lines.slice(head, end).join(""))}
      </details>
      {tail > 0 && row(lines.slice(end).join(""))}
    </>
  );
}

export function TextDiff({
  label,
  before,
  after,
}: {
  label: string;
  before: string;
  after: string;
}) {
  const blocks = useMemo(() => buildTextDiff(before, after), [before, after]);
  const unchanged = blocks.every((block) => block.kind === "same");
  const newlineChanged = before.endsWith("\n") !== after.endsWith("\n");
  return (
    <section className="diff-field" aria-label={`${label}の差分`}>
      <h4 className="diff-label">
        {label}
        {unchanged && <span>変更なし</span>}
      </h4>
      {!unchanged &&
        blocks.map((block, index) =>
          block.kind === "same" ? (
            <Context
              key={index}
              text={block.parts[0].text}
              first={index === 0}
              last={index === blocks.length - 1}
            />
          ) : (
            <DiffRow key={index} block={block} />
          ),
        )}
      {newlineChanged && (
        <p className="diff-newline">末尾の改行を{after.endsWith("\n") ? "追加" : "削除"}</p>
      )}
    </section>
  );
}
