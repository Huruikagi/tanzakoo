import { memo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { t, systemMessage } from "@/lib/i18n";
import { agentLabel } from "@/lib/api";
import { chatRunning, useWorkspace } from "@/lib/workspace";
import { Button } from "./ui/button";
import { Markdown } from "./Markdown";

export const ChatActivity = memo(function ChatActivity({ agent }: { agent: string }) {
  useTranslation();
  const { isThisBusy, stream, activity, permissions, answer } = useWorkspace(
    useShallow((s) => ({
      isThisBusy: chatRunning(s.busy, s.conversation),
      stream: s.stream,
      activity: s.activity,
      permissions: s.permissions,
      answer: s.answer,
    })),
  );
  return (
    <>
      {" "}
      {isThisBusy && (
        <article className="message message-assistant">
          <div className="message-label">
            {agentLabel(agent)}
            <span className="thinking-dot" />
          </div>
          {stream ? (
            <Markdown>{stream}</Markdown>
          ) : (
            <p className="muted">{systemMessage(activity)}</p>
          )}
        </article>
      )}
      {isThisBusy &&
        permissions.map((p) => (
          <div className="permission" key={p.id}>
            <strong>
              {t("{{value0}}が操作の許可を求めています", { value0: agentLabel(agent) })}
            </strong>
            <p>{p.title}</p>
            <details>
              <summary>{t("操作の詳細")}</summary>
              <pre>{JSON.stringify(p.request.toolCall, null, 2)}</pre>
            </details>
            <div className="permission-actions">
              {p.request.options.map((option) => (
                <Button
                  key={option.optionId}
                  variant={option.kind.startsWith("reject") ? "outline" : "secondary"}
                  size="sm"
                  onClick={() => void answer(p.id, option.optionId)}
                >
                  {option.name}
                </Button>
              ))}
              <Button variant="ghost" size="sm" onClick={() => void answer(p.id, null)}>
                {t("キャンセル")}
              </Button>
            </div>
          </div>
        ))}
    </>
  );
});

// This subscriber keeps the existing scroll triggers without rerendering the history.
export function ChatScrollAnchor() {
  const end = useRef<HTMLDivElement>(null);
  const { messageCount, stream, permissionCount, questionCount } = useWorkspace(
    useShallow((s) => ({
      messageCount: s.snapshot.messages.filter((m) => m.conversationId === s.conversation).length,
      stream: s.stream,
      permissionCount: s.permissions.length,
      questionCount: s.snapshot.questions.filter((q) => q.conversationId === s.conversation).length,
    })),
  );
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messageCount, stream, permissionCount, questionCount]);
  return <div ref={end} />;
}
