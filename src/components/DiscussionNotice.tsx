import { useState } from "react";
import type { Discussion } from "@/bindings/Discussion";
import type { DiscussionResolution } from "@/bindings/DiscussionResolution";
import { Button } from "@/components/ui/button";
import { native } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

export function DiscussionNotice({ discussion: d }: { discussion: Discussion }) {
  const snapshot = useWorkspace((s) => s.snapshot);
  const act = useWorkspace((s) => s.act);
  const select = useWorkspace((s) => s.select);
  const [saving, setSaving] = useState(false);
  const card = snapshot.cards.find((c) => c.id === d.cardId && !c.deleted);
  const current = card?.revision === d.cardRevision;
  const suggested = d.state === "suggested";
  const moved = d.state === "moved";
  const actionable = current && (suggested || (moved && card.status === "discuss"));
  async function resolve(action: DiscussionResolution) {
    if (saving) return;
    setSaving(true);
    try {
      await act({ type: "resolveDiscussion", id: d.id, action });
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="discussion-notice" aria-live="polite">
      <p>
        <button className="discussion-card-link" disabled={!card} onClick={() => select(d.cardId)}>
          「{d.title}」
        </button>
        {d.state === "undone"
          ? "の移動を取り消しました"
          : d.state === "dismissed"
            ? "の案内を見送りました"
            : d.state === "superseded"
              ? "の案内後にカードが整理されました"
              : suggested
                ? d.previousStatus === "decided"
                  ? "をもう一度話し合いますか？"
                  : "について話しますか？"
                : d.automatic
                  ? "を「話し合う」へ移しました"
                  : "を「話し合う」へ移しました（選択済み）"}
      </p>
      {suggested && <p className="discussion-reason">{d.reason}</p>}
      {(suggested || moved) && (
        <div className="discussion-actions">
          {actionable ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={!native || saving}
              onClick={() => void resolve(suggested ? "accept" : "undo")}
            >
              {suggested
                ? d.previousStatus === "decided"
                  ? "再検討する"
                  : "このカードについて話す"
                : "元に戻す"}
            </Button>
          ) : (
            <span>カードが更新されています。列の変更はカード詳細から行えます。</span>
          )}
          {suggested && (
            <Button
              size="sm"
              variant="ghost"
              disabled={!native || saving}
              onClick={() => void resolve("dismiss")}
            >
              今は移さない
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
