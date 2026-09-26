import type { ReactNode } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  before,
  after,
  outdated,
  dirty,
  disabled = false,
  onResolve,
}: {
  reason: string;
  before: ReactNode;
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
      <details>
        <summary>変更前</summary>
        <div className="proposal-before">{before}</div>
      </details>
      <div className="proposal-after">
        <span className="small-label">変更案</span>
        {after}
      </div>
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
