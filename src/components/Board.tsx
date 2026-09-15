import { useState } from "react";
import { DragDropProvider, useDroppable, type DragEndEvent } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import {
  GripVertical,
  Plus,
  Search,
  Sparkles,
  Archive,
  RotateCcw,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Card } from "@/bindings/Card";
import { columns, moveCard, useWorkspace } from "@/lib/workspace";
import { native } from "@/lib/api";

function Topic({ card, index }: { card: Card; index: number }) {
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: card.id,
    index,
    group: card.status,
  });
  const selected = useWorkspace((s) => s.selected === card.id);
  const proposals = useWorkspace(
    (s) => s.snapshot.proposals.filter((p) => p.cardId === card.id && p.state === "pending").length,
  );
  return (
    <article
      ref={ref}
      className={`topic ${selected ? "selected" : ""} ${isDragging ? "dragging" : ""} ${isDropTarget && !isDragging ? "drop-target" : ""}`}
    >
      <div className="topic-top">
        <span className="topic-source">
          {card.source === "user" ? (
            "あなたのメモ"
          ) : (
            <>
              <Sparkles size={11} />
              {card.source === "claude" ? "Claude" : "Codex"}
            </>
          )}
        </span>
        <button ref={handleRef} className="drag-handle" aria-label={`${card.title}を並べ替える`}>
          <GripVertical size={14} />
        </button>
      </div>
      <button
        className="topic-open"
        onClick={() => useWorkspace.getState().select(card.id)}
        aria-pressed={selected}
      >
        <h3>{card.title}</h3>
        <p>{card.body || "まだ本文はありません"}</p>
      </button>
      <div className="topic-bottom">
        <span>
          {proposals ? (
            <span className="proposal-dot">{proposals}件の変更提案</span>
          ) : (
            `rev. ${card.revision}`
          )}
        </span>
        <ArrowUpRight size={13} />
      </div>
    </article>
  );
}
function Column({ column, cards }: { column: (typeof columns)[number]; cards: Card[] }) {
  const { ref, isDropTarget } = useDroppable({ id: column.id });
  return (
    <section
      ref={ref}
      className={`board-column column-${column.id} ${isDropTarget ? "drop-target" : ""}`}
      aria-label={column.title}
    >
      <header className="column-header">
        <div>
          <span className="column-number">{column.number}</span>
          <h2>{column.title}</h2>
          <span className="column-count">{cards.length}</span>
        </div>
        <p>{column.hint}</p>
      </header>
      <div className="column-cards">
        {cards.map((card, index) => (
          <Topic key={card.id} card={card} index={index} />
        ))}
        {cards.length === 0 && (
          <div className="column-empty">
            {column.id === "idea"
              ? "会話から生まれた論点が\nここに集まります"
              : "カードをここへ移動"}
          </div>
        )}
      </div>
    </section>
  );
}
export function Board() {
  const { snapshot, act } = useWorkspace();
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState(false);
  const cards = snapshot.cards.filter(
    (c) =>
      !c.deleted &&
      `${c.title}\n${c.body}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const deleted = snapshot.cards.filter((c) => c.deleted);
  const pending = snapshot.proposals.filter((p) => p.state === "pending").length;
  function onDragEnd(event: DragEndEvent) {
    if (event.canceled || !event.operation.source || !event.operation.target) return;
    const { source, target } = event.operation;
    if (source.id === target.id) return;
    let status: Card["status"] | undefined;
    let index = 0;
    const targetCard = snapshot.cards.find((c) => c.id === target.id && !c.deleted);
    if (targetCard) {
      status = targetCard.status;
      index = snapshot.cards
        .filter((c) => !c.deleted && c.status === status)
        .sort((a, b) => a.position - b.position)
        .findIndex((c) => c.id === targetCard.id);
    }
    if (columns.some((c) => c.id === target.id)) {
      status = target.id as Card["status"];
      index = snapshot.cards.filter(
        (c) => !c.deleted && c.status === status && c.id !== source.id,
      ).length;
    }
    if (!status || !columns.some((c) => c.id === status)) return;
    const next = moveCard(snapshot.cards, String(source.id), status, index);
    if (next) void act({ type: "updateCard", card: next });
  }
  async function create() {
    const result = await act({ type: "createCard", title, body: "" });
    if (result) {
      const created = result.cards.find((c) => c.title === title.trim() && !c.deleted && !c.body);
      if (created) useWorkspace.getState().select(created.id);
      setTitle("");
      setOpen(false);
    }
  }
  return (
    <div className="board-pane">
      <div className="board-heading">
        <div>
          <p className="eyebrow">YOUR THINKING SPACE</p>
          <h1>アイデアを、少しずつ。</h1>
          <p>全部を決めなくていい。気になる一枚から話そう。</p>
        </div>
        <span className="board-mark" aria-hidden="true">
          ✳
        </span>
      </div>
      <div className="board-toolbar">
        <div className="search-field">
          <Search size={14} />
          <Input
            aria-label="カードを検索"
            placeholder="カードを探す"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={!native}>
              <Plus />
              カード
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>思いついたことを一枚に</DialogTitle>
              <DialogDescription>まずはタイトルだけでも大丈夫です。</DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <Input
                aria-label="新しいカードのタイトル"
                placeholder="例：どんな場面で使う？"
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <div className="dialog-actions">
                <Button type="submit" disabled={!title.trim()}>
                  アイデアの山に追加
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`削除したカード ${deleted.length}件`}
            >
              <Archive />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>削除したカード</DialogTitle>
              <DialogDescription>必要になったら、元の列へ戻せます。</DialogDescription>
            </DialogHeader>
            <div className="archive-list">
              {deleted.length === 0 ? (
                <p className="muted">削除したカードはありません。</p>
              ) : (
                deleted.map((c) => (
                  <div className="archive-row" key={c.id}>
                    <span>{c.title}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void act({ type: "updateCard", card: { ...c, deleted: false } })
                      }
                    >
                      <RotateCcw />
                      戻す
                    </Button>
                  </div>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {/* Keep React in charge of DOM order while the asynchronous SQLite save is pending. */}
      <DragDropProvider onDragOver={(event) => event.preventDefault()} onDragEnd={onDragEnd}>
        <div className="board-grid">
          {columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              cards={cards
                .filter((c) => c.status === column.id)
                .sort((a, b) => a.position - b.position)}
            />
          ))}
        </div>
      </DragDropProvider>
      <footer className="board-footer">
        <span>{snapshot.cards.filter((c) => !c.deleted).length}枚のカード</span>
        <span>
          {pending ? `${pending}件の提案が確認を待っています` : "候補は消えずに、ここに残ります"}
        </span>
      </footer>
    </div>
  );
}
