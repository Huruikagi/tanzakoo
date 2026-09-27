import { t } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cardLinkId } from "@/lib/card-links";
import { useWorkspace } from "@/lib/workspace";

function CardLink({ id, children }: { id: string; children: React.ReactNode }) {
  const card = useWorkspace((s) => s.snapshot.cards.find((c) => c.id === id));
  const select = useWorkspace((s) => s.select);
  if (!card)
    return (
      <span className="markdown-link muted">
        {children} {t("（参照先なし）")}
      </span>
    );
  return (
    <button type="button" className="markdown-link card-link" onClick={() => select(id)}>
      {card.title}
      {card.deleted && ` ${t("（アーカイブ済み）")}`}
    </button>
  );
}
export function Markdown({ children }: { children: string }) {
  useTranslation();
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (cardLinkId(url) ? url : defaultUrlTransform(url))}
        components={{
          a: ({ children, href }) => {
            const id = href ? cardLinkId(href) : null;
            return id ? (
              <CardLink id={id}>{children}</CardLink>
            ) : (
              <span className="markdown-link">{children}</span>
            );
          },
          img: ({ alt }) => <span>{t("[画像: {{value0}}]", { value0: alt ?? "" })}</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
