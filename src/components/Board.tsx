import { useState, type Ref } from "react";
import { useShallow } from "zustand/react/shallow";
import { DragDropProvider, DragOverlay, useDroppable, type DragEndEvent } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { GripVertical, Plus, Search, Sparkles, Archive, RotateCcw } from "lucide-react";
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
import { agentLabel, native } from "@/lib/api";

function Topic({ card, index }: { card: Card; index: number }) {
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: card.id,
    index,
    group: card.status,
  });
  return (
    <TopicView
      card={card}
      ref={ref}
      handleRef={handleRef}
      className={`${isDragging ? "dragging" : ""} ${isDropTarget && !isDragging ? "drop-target" : ""}`}
    />
  );
}
function TopicView({
  card,
  ref,
  handleRef,
  className = "",
}: {
  card: Card;
  ref?: Ref<HTMLElement>;
  handleRef?: Ref<HTMLButtonElement>;
  className?: string;
}) {
  const selected = useWorkspace((s) => s.selected === card.id);
  const proposals = useWorkspace(
    (s) => s.snapshot.proposals.filter((p) => p.cardId === card.id && p.state === "pending").length,
  );
  return (
    <article ref={ref} className={`topic ${selected ? "selected" : ""} ${className}`}>
      <div className="topic-top">
        <span className="topic-source">
          {card.source !== "user" && (
            <>
              <Sparkles size={11} />
              {agentLabel(card.source)}
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
        {card.body && <p>{card.body}</p>}
      </button>
      {proposals > 0 && (
        <div className="topic-bottom">
          <span className="proposal-dot">{proposals}件の変更提案</span>
        </div>
      )}
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
        {column.id === "idea" && <BroadenTopics />}
      </header>
      <div className="column-cards">
        {cards.map((card, index) => (
          <Topic key={card.id} card={card} index={index} />
        ))}
        {cards.length === 0 && <div className="column-empty" />}
      </div>
    </section>
  );
}
function BroadenTopics() {
  const { busy, switching, broadenTopics } = useWorkspace(
    useShallow((s) => ({ busy: s.busy, switching: s.switching, broadenTopics: s.broadenTopics })),
  );
  return (
    <Button
      className="mt-2.5 w-full"
      variant="outline"
      size="sm"
      disabled={!native || !!busy || switching}
      title="既存カードを見て、新しい切り口の候補を3〜5枚ほど追加します"
      onClick={() => void broadenTopics()}
    >
      <Sparkles />
      話題を広げる
    </Button>
  );
}
export function Board() {
  const { snapshot, act } = useWorkspace(useShallow((s) => ({ snapshot: s.snapshot, act: s.act })));
  const empty = snapshot.cards.every((c) => c.deleted);
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState(false);
  const [pendingMove, setPendingMove] = useState<Card | null>(null);
  // Preview only the placement. The saved snapshot remains authoritative for card content.
  const placedCards = snapshot.cards.map((card) =>
    card.id === pendingMove?.id
      ? { ...card, status: pendingMove.status, position: pendingMove.position }
      : card,
  );
  const cards = placedCards.filter(
    (c) =>
      !c.deleted &&
      `${c.title}\n${c.body}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const deleted = snapshot.cards.filter((c) => c.deleted);
  const pending = snapshot.proposals.filter((p) => p.state === "pending").length;
  function onDragEnd(event: DragEndEvent) {
    if (pendingMove || event.canceled || !event.operation.source || !event.operation.target) return;
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
    if (next) {
      setPendingMove(next);
      // act reports save failures and retains the previous snapshot, so clearing the
      // preview either reveals the committed position or rolls back the move.
      void act({ type: "updateCard", card: next }).finally(() => setPendingMove(null));
    }
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
      <h1 className="sr-only">{snapshot.project.name}</h1>
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
              <DialogTitle>新しいカード</DialogTitle>
              <DialogDescription>タイトルだけでも追加できます。</DialogDescription>
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
                  追加
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
      {empty && (
        <div className="board-welcome">
          <p>カードを作るか、AIと話して論点を出してみましょう。</p>
          <div className="connection-actions">
            <Button size="sm" disabled={!native} onClick={() => setOpen(true)}>
              最初のカードを作る
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => useWorkspace.getState().setChatOpen(true)}
            >
              AIと考える
            </Button>
          </div>
        </div>
      )}
      {/* Keep React in charge of DOM order while the asynchronous SQLite save is pending. */}
      <DragDropProvider
        onBeforeDragStart={(event) => {
          if (pendingMove) event.preventDefault();
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragEnd={onDragEnd}
      >
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
        {/* Cross-column moves unmount the source. Never animate toward that stale element. */}
        <DragOverlay dropAnimation={null}>
          {(source) => {
            const card = snapshot.cards.find((card) => card.id === source.id);
            return card ? (
              <div aria-hidden="true" inert>
                <TopicView card={card} className="dragging" />
              </div>
            ) : null;
          }}
        </DragOverlay>
      </DragDropProvider>
      <footer className="board-footer">
        <span>{snapshot.cards.filter((c) => !c.deleted).length}枚のカード</span>
        {pending > 0 && <span>{pending}件の変更提案</span>}
      </footer>
    </div>
  );
}
