import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Card } from "@/bindings/Card";
import { emptySnapshot } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import { Markdown } from "./Markdown";
import { CardBacklinks } from "./CardBacklinks";
import { CardLinkPicker } from "./CardLinkPicker";
import { MarkdownEditor } from "./MarkdownEditor";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";

const target: Card = {
  id: "target",
  title: "通知設定",
  body: "通知する時間",
  status: "decided",
  revision: 1,
  position: 1,
  source: "user",
  deleted: false,
  createdAt: 1,
  updatedAt: 1,
};
beforeEach(() => {
  useWorkspace.setState({
    selected: "source",
    drafts: { source: { title: "通知", body: "編集中", revision: 1 } },
    references: [],
    snapshot: { ...emptySnapshot, cards: [target] },
  });
});

it("opens saved targets without discarding drafts and follows renamed and archived targets", async () => {
  const user = userEvent.setup();
  render(
    <Markdown>
      {"[古い名前](tanzakoo:card/target) [欠損](tanzakoo:card/missing) [外部](https://example.com)"}
    </Markdown>,
  );
  await user.click(screen.getByRole("button", { name: "通知設定" }));
  expect(useWorkspace.getState().selected).toBe("target");
  expect(useWorkspace.getState().drafts.source?.body).toBe("編集中");
  expect(screen.getByText(/欠損.*参照先なし/)).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  act(() => {
    useWorkspace.setState({
      snapshot: { ...emptySnapshot, cards: [{ ...target, title: "新しい名前", deleted: true }] },
    });
  });
  expect(screen.getByRole("button", { name: "新しい名前 （アーカイブ済み）" })).toBeInTheDocument();
});

it("derives backlinks only from saved bodies and updates after links are removed", async () => {
  const source = { ...target, id: "source", title: "通知", body: "[設定](tanzakoo:card/target)" };
  useWorkspace.setState({
    snapshot: {
      ...emptySnapshot,
      cards: [
        target,
        source,
        { ...source, id: "code", title: "コード例", body: "`[設定](tanzakoo:card/target)`" },
      ],
      proposals: [
        {
          id: "p",
          cardId: "code",
          baseRevision: 1,
          beforeTitle: "",
          beforeBody: "",
          title: "案",
          body: source.body,
          reason: "提案",
          state: "pending",
          createdAt: 1,
        },
      ],
    },
  });
  const user = userEvent.setup();
  render(<CardBacklinks cardId="target" />);
  const region = screen.getByRole("region", { name: "このカードを参照しているカード" });
  expect(within(region).getAllByRole("button")).toHaveLength(1);
  await user.click(within(region).getByRole("button", { name: "通知" }));
  expect(useWorkspace.getState().selected).toBe("source");
  act(() => {
    useWorkspace.setState({
      snapshot: { ...emptySnapshot, cards: [target, { ...source, body: "削除後" }] },
    });
  });
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
});

it("searches card titles and passes the selected ID even when titles are duplicated", async () => {
  const onSelect = vi.fn();
  const user = userEvent.setup();
  render(
    <CardLinkPicker
      cards={[target, { ...target, id: "second", body: "別の設定" }]}
      onSelect={onSelect}
      onClose={() => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: "カードリンクを挿入" }));
  await user.type(screen.getByRole("textbox", { name: "カードを検索" }), "通知");
  await user.click(screen.getByRole("button", { name: /通知設定.*別の設定/ }));
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "second" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("inserts at the editor selection, retains surrounding text, and supports undo", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const { container } = render(
    <MarkdownEditor
      value="前 選択 後"
      onChange={onChange}
      onSelection={() => {}}
      linkCards={[target]}
    />,
  );
  const editor = EditorView.findFromDOM(container.querySelector(".cm-editor")!)!;
  act(() => editor.dispatch({ selection: { anchor: 2, head: 4 } }));
  await user.click(screen.getByRole("button", { name: "カードリンクを挿入" }));
  await user.click(screen.getByRole("button", { name: /通知設定.*通知する時間/ }));
  expect(onChange).toHaveBeenLastCalledWith("前 [通知設定](tanzakoo:card/target) 後");
  expect(editor.state.doc.toString()).toBe("前 [通知設定](tanzakoo:card/target) 後");
  act(() => {
    expect(undo(editor)).toBe(true);
  });
  expect(editor.state.doc.toString()).toBe("前 選択 後");
});
