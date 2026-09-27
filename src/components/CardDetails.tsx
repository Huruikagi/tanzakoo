import { t, currentLocale } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { FileText, MessageSquarePlus, Save, Archive, RotateCcw, Quote } from "lucide-react";
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
import { ProposalCard, Proposals } from "./Proposals";
import { editDraft } from "@/lib/draft";

export function CardDetails() {
  useTranslation();
  const selected = useWorkspace((s) => s.selected);
  const card = useWorkspace((s) => s.snapshot.cards.find((c) => c.id === selected));
  if (!card)
    return (
      <section className="details-pane">
        <div className="pane-heading">
          <FileText size={16} />
          <h2>{t("カード詳細")}</h2>
        </div>
        <div className="details-empty">
          <div className="paper-stack" aria-hidden="true">
            <span />
            <span />
            <span>
              <FileText size={26} />
            </span>
          </div>
          <p>{t("カードを選ぶと、ここで編集できます。")}</p>
        </div>
      </section>
    );
  return <Details key={card.id} card={card} />;
}
function Details({ card }: { card: Card }) {
  useTranslation();
  const { drafts, draft, act, attach, snapshot } = useWorkspace(
    useShallow((s) => ({
      drafts: s.drafts,
      draft: s.draft,
      act: s.act,
      attach: s.attach,
      snapshot: s.snapshot,
    })),
  );
  const [quote, setQuote] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("edit");
  const archivePending = useWorkspace((s) => s.archivePending);
  const { value, dirty, stale, update, reset } = editDraft(
    { title: card.title, body: card.body, revision: card.revision },
    drafts[card.id],
    (next) => draft(card.id, next),
  );
  const proposals = snapshot.proposals.filter((p) => p.cardId === card.id && p.state === "pending");
  async function save() {
    setSaving(true);
    const result = await act({ type: "updateCard", card: { ...card, ...value } });
    if (result) reset();
    setSaving(false);
  }
  return (
    <section className="details-pane">
      <div className="pane-heading">
        <FileText size={16} />
        <h2>{t("カード詳細")}</h2>
      </div>
      <div className="details-scroll">
        {card.deleted && (
          <div className="notice">
            {t("このカードはアーカイブされています。")}
            <Button
              size="sm"
              variant="outline"
              disabled={archivePending}
              onClick={() => void useWorkspace.getState().setArchived(card.id, false)}
            >
              <RotateCcw />
              {t("戻す")}
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
            <SelectTrigger size="sm" aria-label={t("カードの列")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {columns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {t(c.title)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="field-label" htmlFor="card-title">
          {t("タイトル")}
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
              <TabsTrigger value="edit">{t("編集")}</TabsTrigger>
              <TabsTrigger value="preview">{t("プレビュー")}</TabsTrigger>
            </TabsList>
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
              <Markdown>{value.body || t("まだ本文はありません。")}</Markdown>
            </div>
          </TabsContent>
        </Tabs>
        {stale && (
          <p className="inline-error">
            {t(
              "編集中にカードが更新されました。下書きを控えてから「取り消す」で最新の内容を確認してください。",
            )}
          </p>
        )}
        <div className="editor-actions">
          <span className="muted">{dirty && t("未保存の変更")}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={!dirty || saving}
            onClick={() => {
              reset();
              setQuote("");
            }}
          >
            {t("取り消す")}
          </Button>
          <Button
            size="sm"
            disabled={!dirty || stale || saving || !value.title.trim() || card.deleted}
            onClick={() => void save()}
          >
            <Save />
            {t("保存")}
          </Button>
        </div>
        <div className="reference-actions">
          <Button
            variant="outline"
            size="sm"
            disabled={dirty || card.deleted}
            title={dirty ? t("保存すると参照できます") : undefined}
            onClick={() => attach(card)}
          >
            <MessageSquarePlus />
            {t("会話に参照")}
          </Button>
          {quote && tab === "edit" && (
            <Button
              size="sm"
              variant="secondary"
              disabled={dirty || card.deleted}
              onClick={() => attach(card, quote)}
            >
              <Quote />
              {t("選択範囲を参照")}
            </Button>
          )}
        </div>
        <Proposals count={proposals.length}>
          {proposals.map((p) => (
            <ProposalCard
              key={p.id}
              reason={p.reason}
              fields={[
                { label: t("タイトル"), before: p.beforeTitle, after: p.title },
                { label: t("本文"), before: p.beforeBody, after: p.body },
              ]}
              after={
                <>
                  <h4>{p.title}</h4>
                  <Markdown>{p.body}</Markdown>
                </>
              }
              outdated={
                card.deleted || p.baseRevision !== card.revision
                  ? t("提案後にカードが変わったため適用できません。")
                  : null
              }
              dirty={dirty}
              onResolve={(apply) => void act({ type: "resolveProposal", id: p.id, apply })}
            />
          ))}
        </Proposals>
      </div>
      <footer className="details-footer">
        <span className="muted">
          {t("{{value0}} 更新", {
            value0: new Date(card.updatedAt).toLocaleDateString(currentLocale()),
          })}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={card.deleted || dirty || archivePending}
          aria-label={t("カードをアーカイブ")}
          title={t("アーカイブ")}
          onClick={() => void useWorkspace.getState().setArchived(card.id, true)}
        >
          <Archive />
        </Button>
      </footer>
    </section>
  );
}
