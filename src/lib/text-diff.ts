import { diffArrays, diffLines } from "diff";

export type DiffPart = { text: string; changed: boolean };
export type DiffBlock = {
  kind: "same" | "removed" | "added";
  parts: DiffPart[];
};

const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const characters = (text: string) => Array.from(segmenter.segment(text), (part) => part.segment);

/** Keep whitespace significant, but treat Windows and Unix line endings alike. */
export function buildTextDiff(before: string, after: string): DiffBlock[] {
  before = before.replace(/\r\n/g, "\n");
  after = after.replace(/\r\n/g, "\n");
  const deadline = performance.now() + 80;
  const changes = diffLines(before, after, { timeout: 40, maxEditLength: 2000 });
  if (!changes) {
    return [
      { kind: "removed", parts: [{ text: before, changed: true }] },
      { kind: "added", parts: [{ text: after, changed: true }] },
    ];
  }
  const blocks: DiffBlock[] = [];
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const next = changes[i + 1];
    if (change.removed && next?.added) {
      // Bound expensive comparisons. Large rewrites still show the complete before/after.
      const remaining = deadline - performance.now();
      const inline =
        remaining > 0 && change.value.length + next.value.length < 20000
          ? diffArrays(characters(change.value), characters(next.value), {
              timeout: Math.min(10, remaining),
              maxEditLength: 1000,
            })
          : undefined;
      blocks.push(
        {
          kind: "removed",
          parts: inline
            ? inline
                .filter((p) => !p.added)
                .map((p) => ({ text: p.value.join(""), changed: p.removed }))
            : [{ text: change.value, changed: true }],
        },
        {
          kind: "added",
          parts: inline
            ? inline
                .filter((p) => !p.removed)
                .map((p) => ({ text: p.value.join(""), changed: p.added }))
            : [{ text: next.value, changed: true }],
        },
      );
      i++;
    } else {
      blocks.push({
        kind: change.added ? "added" : change.removed ? "removed" : "same",
        parts: [{ text: change.value, changed: change.added || change.removed }],
      });
    }
  }
  return blocks;
}
