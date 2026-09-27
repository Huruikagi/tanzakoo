import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { t } from "@/lib/i18n";
import { referencedCardIds } from "@/lib/card-links";
import { useWorkspace } from "@/lib/workspace";

export function CardBacklinks({ cardId }: { cardId: string }) {
  useTranslation();
  const cards = useWorkspace((s) => s.snapshot.cards);
  const select = useWorkspace((s) => s.select);
  const sources = useMemo(
    () => cards.filter((card) => card.id !== cardId && referencedCardIds(card.body).has(cardId)),
    [cards, cardId],
  );
  if (sources.length === 0) return null;
  return (
    <section className="card-backlinks" aria-label={t("このカードを参照しているカード")}>
      <h3>{t("このカードを参照しているカード")}</h3>
      <ul>
        {sources.map((card) => (
          <li key={card.id}>
            <button
              type="button"
              className="markdown-link card-link"
              onClick={() => select(card.id)}
            >
              {card.title}
              {card.deleted && ` ${t("（アーカイブ済み）")}`}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
