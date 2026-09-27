import { fromMarkdown } from "mdast-util-from-markdown";

const prefix = "tanzakoo:card/";

export function cardLinkId(url: string): string | null {
  if (!url.startsWith(prefix)) return null;
  const id = url.slice(prefix.length);
  return /^[a-zA-Z0-9_-]+$/.test(id) ? id : null;
}

export function cardLink(title: string, id: string): string {
  const label = title
    .replace(/\s/g, " ")
    .replace(/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/g, "\\$&");
  return `[${label}](${prefix}${id})`;
}

type Tree = ReturnType<typeof fromMarkdown>;
type Node = Tree | Tree["children"][number];

/** Parse links, including reference-style links; code, images and raw HTML are not references. */
export function referencedCardIds(body: string): Set<string> {
  const tree = fromMarkdown(body);
  const definitions = new Map<string, string>();
  const ids = new Set<string>();
  function walk(node: Node, visit: (node: Node) => void) {
    visit(node);
    if ("children" in node) node.children.forEach((child) => walk(child, visit));
  }
  walk(tree, (node) => {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
  });
  walk(tree, (node) => {
    const url =
      node.type === "link"
        ? node.url
        : node.type === "linkReference"
          ? definitions.get(node.identifier)
          : undefined;
    const id = url ? cardLinkId(url) : null;
    if (id) ids.add(id);
  });
  return ids;
}
