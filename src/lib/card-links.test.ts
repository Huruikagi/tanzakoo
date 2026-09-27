import { expect, it } from "vitest";
import { fromMarkdown } from "mdast-util-from-markdown";
import { cardLink, cardLinkId, referencedCardIds } from "./card-links";

it("recognizes actual Markdown links, deduplicates targets and ignores code and images", () => {
  const body = [
    "[first](tanzakoo:card/a) and [again](tanzakoo:card/a)",
    "[reference][target]",
    "",
    "[target]: tanzakoo:card/b",
    "",
    "`[code](tanzakoo:card/c)`",
    "```md\n[example](tanzakoo:card/d)\n```",
    "![image](tanzakoo:card/e)",
    "\\[escaped](tanzakoo:card/f)",
    "[web](https://example.com/tanzakoo:card/g)",
  ].join("\n");
  expect([...referencedCardIds(body)]).toEqual(["a", "b"]);
  expect(cardLinkId("tanzakoo:card/../../a")).toBeNull();
  expect(cardLinkId("javascript:alert(1)")).toBeNull();
});

it("inserts titles containing Markdown and entity characters as a single literal label", () => {
  const title = "通知 [毎日] *朝* `設定` \\ &copy; | <sample>";
  const tree = fromMarkdown(cardLink(title, "card-1"));
  expect(tree.children[0]).toMatchObject({
    type: "paragraph",
    children: [
      { type: "link", url: "tanzakoo:card/card-1", children: [{ type: "text", value: title }] },
    ],
  });
});
