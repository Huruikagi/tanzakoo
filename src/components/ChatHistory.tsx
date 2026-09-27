import { memo, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Paperclip } from "lucide-react";
import { t, systemMessage } from "@/lib/i18n";
import { agentLabel } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import type { Snapshot } from "@/bindings/Snapshot";
import { Markdown } from "./Markdown";
import { DiscussionNotice } from "./DiscussionNotice";
import { QuestionChoices } from "./QuestionChoices";

export const ChatHistory = memo(function ChatHistory({
  snapshot,
  conversation,
  agent,
  disabled,
}: {
  snapshot: Snapshot;
  conversation: string | null;
  agent: string;
  disabled: boolean;
}) {
  useTranslation();
  const messages = snapshot.messages.filter((m) => m.conversationId === conversation);
  // Keep completed question batches next to their originating turn in history.
  const questionsByMessage = new Map<string, typeof snapshot.questions>();
  let turnId: string | undefined;
  messages.forEach((message, index) => {
    if (message.role === "user") turnId = message.id;
    if (!messages[index + 1] || messages[index + 1]?.role === "user") {
      questionsByMessage.set(
        message.id,
        snapshot.questions.filter(
          (q) =>
            q.conversationId === conversation && q.messageId === turnId && q.state !== "pending",
        ),
      );
    }
  });

  return (
    <>
      {" "}
      {messages.map((m) => (
        <Fragment key={m.id}>
          <article className={`message message-${m.role}`}>
            <div className="message-label">
              {m.role === "user"
                ? t("あなた")
                : m.role === "error"
                  ? t("エラー")
                  : agentLabel(agent)}
            </div>
            {m.references.length > 0 && (
              <div className="message-references">
                {m.references.map((r, index) => (
                  <button
                    key={index}
                    className="reference-chip"
                    title={r.quote || r.title}
                    onClick={() => useWorkspace.getState().select(r.cardId)}
                  >
                    <Paperclip size={11} />
                    {r.title}
                    {r.quote && t(" · 引用")}
                  </button>
                ))}
              </div>
            )}
            <Markdown>{m.role === "error" ? systemMessage(m.text) : m.text}</Markdown>
          </article>
          {snapshot.discussions
            .filter((d) => d.conversationId === conversation && d.messageId === m.id)
            .map((d) => (
              <DiscussionNotice key={d.id} discussion={d} />
            ))}
          {!!questionsByMessage.get(m.id)?.length && (
            <QuestionChoices
              key={`${snapshot.project.id}:${questionsByMessage.get(m.id)![0]!.messageId}`}
              questions={questionsByMessage.get(m.id)!}
              disabled={disabled}
            />
          )}
        </Fragment>
      ))}
    </>
  );
});
