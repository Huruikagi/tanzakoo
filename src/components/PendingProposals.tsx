import { t } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useId, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { native } from "@/lib/api";
import { proposalBlockReason } from "@/lib/proposals";
import { useWorkspace } from "@/lib/workspace";

export function PendingProposals({ questionTurn }: { questionTurn?: string }) {
  useTranslation();
  const snapshot = useWorkspace((s) => s.snapshot);
  const drafts = useWorkspace((s) => s.drafts);
  const switching = useWorkspace((s) => s.switching);
  const [normallyExpanded, setNormallyExpanded] = useState(true);
  const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null);
  const expanded = questionTurn ? expandedQuestion === questionTurn : normallyExpanded;
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<number | "failed" | null>(null);
  const listId = useId();
  const pending = snapshot.proposals
    .filter((p) => p.state === "pending")
    .map((proposal) => {
      const card = snapshot.cards.find((c) => c.id === proposal.cardId);
      return {
        proposal,
        card,
        blocked: proposalBlockReason(proposal, card, drafts[proposal.cardId]),
      };
    });
  const eligible = pending.filter((p) => !p.blocked);
  async function approve() {
    if (applying || !eligible.length) return;
    setApplying(true);
    setResult(null);
    const saved = await useWorkspace.getState().act({
      type: "applyProposals",
      ids: eligible.map((p) => p.proposal.id),
    });
    setResult(saved ? eligible.length : "failed");
    setApplying(false);
  }
  if (!pending.length && !result) return null;
  return (
    <section
      className="pending-proposals"
      aria-label={t("未承認のカード変更")}
      data-compact={!!questionTurn}
    >
      {pending.length > 0 && (
        <>
          <div className="pending-proposals-heading">
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() =>
                questionTurn
                  ? setExpandedQuestion(expanded ? null : questionTurn)
                  : setNormallyExpanded(!expanded)
              }
            >
              {expanded ? <ChevronDown /> : <ChevronRight />}
              {t("未承認の変更")} <span className="proposal-count">{pending.length}</span>
            </Button>
            {(!questionTurn || expanded) && (
              <Button
                size="sm"
                variant="secondary"
                disabled={!native || switching || applying || !eligible.length}
                onClick={() => void approve()}
              >
                <Check />
                {applying
                  ? t("承認中…")
                  : t("まとめて承認 ({{value0}})", { value0: eligible.length })}
              </Button>
            )}
          </div>
          <div id={listId} hidden={!expanded}>
            <p className="hint muted">{t("このプロジェクト全体 · カードを開いて差分を確認")}</p>
            <ul className="pending-proposals-list">
              {pending.map(({ proposal, card, blocked }) => (
                <li key={proposal.id}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!card}
                    onClick={() => useWorkspace.getState().select(proposal.cardId)}
                    title={card?.title ?? proposal.title}
                  >
                    <span>{card?.title ?? proposal.title}</span>
                    <ChevronRight />
                  </Button>
                  <p>{blocked ?? proposal.reason}</p>
                </li>
              ))}
            </ul>
            {eligible.length < pending.length && (
              <p className="hint muted">{t("承認できないカードは一覧に残ります。")}</p>
            )}
          </div>
        </>
      )}
      {result !== null && (
        <output className="hint">
          {typeof result === "number"
            ? t("{{value0}}件の変更を承認しました", { value0: result })
            : t("承認できませんでした。最新の提案を確認してください。")}
        </output>
      )}
    </section>
  );
}
