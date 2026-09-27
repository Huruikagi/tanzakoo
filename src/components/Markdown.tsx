import { t } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
export function Markdown({ children }: { children: string }) {
  useTranslation();
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children }) => <span className="markdown-link">{children}</span>,
          img: ({ alt }) => <span>{t("[画像: {{value0}}]", { value0: alt ?? "" })}</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
