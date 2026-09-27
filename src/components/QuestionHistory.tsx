import { t } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { CheckCircle2, MessageCircleQuestion, ChevronRight } from "lucide-react";
import type { ChoiceQuestion } from "@/bindings/ChoiceQuestion";

export function QuestionHistory({ questions }: { questions: ChoiceQuestion[] }) {
  useTranslation();
  return (
    <details className="chat-question-history">
      <summary>
        {questions[0]?.state === "answered" ? (
          <CheckCircle2 size={14} />
        ) : (
          <MessageCircleQuestion size={14} />
        )}
        <span>
          {questions[0]?.state === "answered"
            ? t("回答済み")
            : questions[0]?.state === "cancelled"
              ? t("この質問は取り消されました")
              : t("会話を続けました")}
        </span>
        <span>{t("{{value0}}問", { value0: questions.length })}</span>
        <ChevronRight size={14} className="question-history-chevron" />
      </summary>
      <div className="chat-question-history-content">
        {questions.map((q) => (
          <div key={q.id} className="chat-question-result">
            <p className="chat-question-title">{q.question}</p>
            {q.state === "answered" ? (
              <p className="chat-question-answer">
                {q.answerText ??
                  (q.selectedOption !== null ? q.options[q.selectedOption]?.label : "")}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}
