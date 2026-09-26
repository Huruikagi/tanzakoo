import type { ReactNode } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TextDiff } from "./TextDiff";

/** Pending AI proposals for one target. Renders nothing when there are none. */
export function Proposals({ count, children }: { count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="proposals">
      <div className="section-label">
        <Sparkles size={14} />
        <h3>AIの変更提案</h3>
        <span>{count}</span>
      </div>
      {children}
    </section>
  );
}

/**
 * One proposal with its before/after and the user's decision. Applying is blocked while the
 * target has unsaved edits, or when the proposal was made against an older revision.
 */
export function ProposalCard({
  reason,
  fields,
  after,
  outdated,
  dirty,
  disabled = false,
  onResolve,
}: {
  reason: string;
  fields: { label: string; before: string; after: string }[];
  after: ReactNode;
  /** Why the proposal can no longer be applied, if it can't. */
  outdated: string | null;
  dirty: boolean;
  disabled?: boolean;
  onResolve: (apply: boolean) => void;
}) {
  return (
    <article className="proposal">
      <p className="proposal-reason">{reason}</p>
      <Tabs defaultValue="diff">
        <div className="proposal-view-switch">
          <TabsList aria-label="変更提案の表示">
            <TabsTrigger value="diff">差分</TabsTrigger>
            <TabsTrigger value="after">変更後</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="diff">
          <div className="diff-legend">
            <span>− 削除</span>
            <span>+ 追加</span>
          </div>
          {fields.map((field) => (
            <TextDiff key={field.label} {...field} />
          ))}
        </TabsContent>
        <TabsContent value="after">
          <div className="proposal-after">{after}</div>
        </TabsContent>
      </Tabs>
      {outdated ? (
        <p className="inline-error">{outdated}</p>
      ) : (
        dirty && (
          <p className="proposal-note hint muted">
            適用する前に、下書きを保存するか取り消してください。
          </p>
        )
      )}
      <div className="proposal-actions">
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onResolve(false)}>
          <X />
          却下
        </Button>
        <Button
          size="sm"
          disabled={disabled || !!outdated || dirty}
          onClick={() => onResolve(true)}
        >
          <Check />
          適用する
        </Button>
      </div>
    </article>
  );
}
