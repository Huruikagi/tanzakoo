import { useState } from "react";
import {
  FileText,
  MessageSquarePlus,
  Save,
  Trash2,
  RotateCcw,
  Check,
  X,
  Sparkles,
  Quote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { columns, useWorkspace } from "@/lib/workspace";
import type { Card } from "@/bindings/Card";
import { Markdown } from "./Markdown";
import { MarkdownEditor } from "./MarkdownEditor";

export function CardDetails() {
  const selected = useWorkspace((s) => s.selected);
  const card = useWorkspace((s) => s.snapshot.cards.find((c) => c.id === selected));
  if (!card)
    return (
      <section className="details-pane">
        <div className="pane-heading">
          <FileText size={16} />
          <h2>カード詳細</h2>
        </div>
        <div className="details-empty">
          <div className="paper-stack" aria-hidden="true">
            <span />
            <span />
            <span>
              <FileText size={26} />
            </span>
          </div>
          <h3>一枚に、焦点を合わせる。</h3>
          <p>
            ボードのカードを選ぶと、ここで
            <br />
            内容を編集したり、会話に参照できます。
          </p>
          <span className="small-label">SELECT A CARD TO BEGIN</span>
        </div>
      </section>
    );
  return <Details key={card.id} card={card} />;
}
function Details({ card }: { card: Card }) {
  const { drafts, draft, act, attach, snapshot } = useWorkspace();
  const [quote, setQuote] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("edit");
  const value = drafts[card.id] ?? { title: card.title, body: card.body, revision: card.revision };
  const dirty = value.title !== card.title || value.body !== card.body;
  const stale = dirty && value.revision !== card.revision;
  const proposals = snapshot.proposals.filter((p) => p.cardId === card.id && p.state === "pending");
  const update = (fields: Partial<typeof value>) => draft(card.id, { ...value, ...fields });
  async function save() {
    setSaving(true);
    const result = await act({ type: "updateCard", card: { ...card, ...value } });
    if (result) draft(card.id, null);
    setSaving(false);
  }
  return (
    <section className="details-pane">
      <div className="pane-heading">
        <FileText size={16} />
        <h2>カード詳細</h2>
        <span className="revision">rev. {card.revision}</span>
      </div>
      <div className="details-scroll">
        {card.deleted && (
          <div className="notice">
            このカードは削除されています。
            <Button
              size="sm"
              variant="outline"
              onClick={() => void act({ type: "updateCard", card: { ...card, deleted: false } })}
            >
              <RotateCcw />
              戻す
            </Button>
          </div>
        )}
        <div className="detail-meta">
          <Select
            value={card.status}
            disabled={card.deleted || dirty}
            onValueChange={(status) =>
              void act({ type: "updateCard", card: { ...card, status: status as Card["status"] } })
            }
          >
            <SelectTrigger size="sm" aria-label="カードの列">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {columns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span>
            {card.source === "user"
              ? "あなたが作成"
              : `${card.source === "claude" ? "Claude" : "Codex"}が起票`}
          </span>
        </div>
        <label className="field-label" htmlFor="card-title">
          タイトル
        </label>
        <Input
          id="card-title"
          value={value.title}
          maxLength={200}
          disabled={card.deleted}
          onChange={(e) => update({ title: e.target.value })}
        />
        <Tabs value={tab} onValueChange={setTab}>
          <div className="editor-toolbar">
            <TabsList>
              <TabsTrigger value="edit">編集</TabsTrigger>
              <TabsTrigger value="preview">プレビュー</TabsTrigger>
            </TabsList>
            <span className="small-label">MARKDOWN</span>
          </div>
          <TabsContent value="edit">
            {card.deleted ? (
              <Markdown>{card.body}</Markdown>
            ) : (
              <MarkdownEditor
                value={value.body}
                onChange={(body) => update({ body })}
                onSelection={setQuote}
              />
            )}
          </TabsContent>
          <TabsContent value="preview">
            <div className="preview-body">
              <Markdown>{value.body || "まだ本文はありません。"}</Markdown>
            </div>
          </TabsContent>
        </Tabs>
        {stale && (
          <p className="inline-error">
            編集中にカードが更新されました。下書きをコピーするか、取り消して最新の内容を確認してください。
          </p>
        )}
        <div className="editor-actions">
          <span className="muted">{dirty ? "未保存の変更" : "保存済み"}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={!dirty || saving}
            onClick={() => {
              draft(card.id, null);
              setQuote("");
            }}
          >
            取り消す
          </Button>
          <Button
            size="sm"
            disabled={!dirty || stale || saving || !value.title.trim() || card.deleted}
            onClick={() => void save()}
          >
            <Save />
            保存
          </Button>
        </div>
        <div className="reference-actions">
          <Button
            variant="outline"
            size="sm"
            disabled={dirty || card.deleted}
            onClick={() => attach(card)}
          >
            <MessageSquarePlus />
            会話に参照
          </Button>
          {quote && tab === "edit" && (
            <Button
              size="sm"
              variant="secondary"
              disabled={dirty || card.deleted}
              onClick={() => attach(card, quote)}
            >
              <Quote />
              選択範囲を参照
            </Button>
          )}
        </div>
        {dirty && <p className="muted hint">保存すると、編集した内容を会話に参照できます。</p>}
        <section className="proposals">
          <div className="section-label">
            <Sparkles size={14} />
            <h3>エージェントの変更提案</h3>
            <span>{proposals.length}</span>
          </div>
          {proposals.length === 0 ? (
            <p className="muted hint">提案が届くと、変更前後をここで確認できます。</p>
          ) : (
            proposals.map((p) => {
              const conflict = card.deleted || p.baseRevision !== card.revision;
              return (
                <article className="proposal" key={p.id}>
                  <p className="proposal-reason">{p.reason}</p>
                  <details>
                    <summary>変更前 · rev. {p.baseRevision}</summary>
                    <div className="proposal-before">
                      <strong>{p.beforeTitle}</strong>
                      <Markdown>{p.beforeBody}</Markdown>
                    </div>
                  </details>
                  <div className="proposal-after">
                    <span className="small-label">変更案</span>
                    <h4>{p.title}</h4>
                    <Markdown>{p.body}</Markdown>
                  </div>
                  {conflict && (
                    <p className="inline-error">
                      元のカードが更新されています。再提案を依頼してください。
                    </p>
                  )}
                  <div className="proposal-actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void act({ type: "resolveProposal", id: p.id, apply: false })}
                    >
                      <X />
                      却下
                    </Button>
                    <Button
                      size="sm"
                      disabled={conflict || dirty}
                      onClick={() => void act({ type: "resolveProposal", id: p.id, apply: true })}
                    >
                      <Check />
                      適用する
                    </Button>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
      <footer className="details-footer">
        <span className="muted">{new Date(card.updatedAt).toLocaleDateString("ja-JP")} 更新</span>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={card.deleted || dirty}
          aria-label="カードを削除"
          onClick={() => void act({ type: "updateCard", card: { ...card, deleted: true } })}
        >
          <Trash2 />
        </Button>
      </footer>
    </section>
  );
}
