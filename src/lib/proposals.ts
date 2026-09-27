import { t } from "@/lib/i18n";
import type { Card } from "@/bindings/Card";
import type { Proposal } from "@/bindings/Proposal";

export function proposalBlockReason(
  proposal: Proposal,
  card: Card | undefined,
  draft: { title: string; body: string } | undefined,
): string | null {
  if (!card || card.deleted) return t("アーカイブ済み");
  if (proposal.baseRevision !== card.revision) return t("カードが更新されています");
  if (draft && (draft.title !== card.title || draft.body !== card.body))
    return t("未保存の編集があります");
  return null;
}
