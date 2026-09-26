import type { ChoiceQuestion } from "@/bindings/ChoiceQuestion";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace";

export function QuestionChoices({
  question,
  disabled,
}: {
  question: ChoiceQuestion;
  disabled: boolean;
}) {
  const pending = question.state === "pending";
  return (
    <section className="chat-question" aria-label={question.question}>
      <p className="chat-question-title">{question.question}</p>
      <div className="chat-question-options">
        {question.options.map((option, index) => (
          <Button
            key={index}
            variant={question.selectedOption === index ? "secondary" : "outline"}
            size="choice"
            disabled={disabled || !pending}
            aria-label={option.label}
            aria-describedby={option.description ? `${question.id}-option-${index}` : undefined}
            aria-pressed={question.selectedOption === index}
            onClick={() => {
              const state = useWorkspace.getState();
              if (state.conversation !== question.conversationId) return;
              void state.send(option.label, "codex", {
                useReferences: false,
                questionAnswer: { questionId: question.id, optionIndex: index },
              });
            }}
          >
            <span>
              {question.selectedOption === index ? "✓ " : ""}
              {option.label}
            </span>
            {option.description && (
              <span id={`${question.id}-option-${index}`} className="chat-question-description">
                {option.description}
              </span>
            )}
          </Button>
        ))}
      </div>
      <p className="muted chat-question-hint">
        {pending
          ? "選ぶと送信します。下の入力欄から自由に返答することもできます。"
          : question.state === "answered"
            ? "回答済み"
            : question.state === "cancelled"
              ? "この質問は取り消されました"
              : "会話を続けました"}
      </p>
    </section>
  );
}
