import { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, MessageCircleQuestion, ChevronRight } from "lucide-react";
import type { ChoiceQuestion } from "@/bindings/ChoiceQuestion";
import type { QuestionAnswer } from "@/bindings/QuestionAnswer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/lib/workspace";
import type { QuestionDraft } from "@/lib/workspace/types";

const emptyDraft: QuestionDraft = { mode: "option", optionIndex: null, text: "" };
function complete(draft: QuestionDraft | undefined) {
  return (
    !!draft &&
    (draft.mode === "option"
      ? draft.optionIndex !== null
      : !!draft.text.trim() && [...draft.text].length <= 2000)
  );
}

export function QuestionChoices({
  questions,
  disabled,
  running = false,
}: {
  questions: ChoiceQuestion[];
  disabled: boolean;
  running?: boolean;
}) {
  const projectId = useWorkspace((s) => s.snapshot.project.id);
  const drafts = useWorkspace((s) => s.questionDrafts[projectId]);
  const [step, setStep] = useState(0);
  const title = useRef<HTMLParagraphElement>(null);
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current !== step) title.current?.focus({ preventScroll: true });
    previousStep.current = step;
  }, [step]);
  const pending = questions.every((q) => q.state === "pending");
  const question = questions[Math.min(step, questions.length - 1)]!;
  const draft = drafts?.[question.id] ?? emptyDraft;
  const answeredCount = questions.filter((q) => complete(drafts?.[q.id])).length;
  function update(value: QuestionDraft) {
    if (disabled || !pending) return;
    useWorkspace.setState((state) => ({
      questionDrafts: {
        ...state.questionDrafts,
        [projectId]: { ...state.questionDrafts[projectId], [question.id]: value },
      },
    }));
  }
  function submit() {
    const state = useWorkspace.getState();
    if (
      disabled ||
      !pending ||
      state.snapshot.project.id !== projectId ||
      state.conversation !== question.conversationId
    )
      return;
    const current = state.questionDrafts[projectId];
    if (!questions.every((q) => complete(current?.[q.id]))) return;
    const answers: QuestionAnswer[] = questions.map((q) => {
      const value = current![q.id]!;
      return {
        questionId: q.id,
        optionIndex: value.mode === "option" ? value.optionIndex : null,
        text: value.mode === "text" ? value.text.trim() : null,
      };
    });
    void state.send("質問への回答", "codex", { useReferences: false, questionAnswers: answers });
  }
  if (!pending) {
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
              ? "回答済み"
              : questions[0]?.state === "cancelled"
                ? "この質問は取り消されました"
                : "会話を続けました"}
          </span>
          <span>{questions.length}問</span>
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
  return (
    <section className="chat-question chat-question-active" aria-label="質問にまとめて回答">
      <div className="chat-question-heading">
        <Badge>
          <MessageCircleQuestion />
          {running ? "AI応答中" : answeredCount === questions.length ? "送信待ち" : "回答待ち"}
        </Badge>
        <span>
          質問 {step + 1} / {questions.length}
        </span>
      </div>
      <div className="chat-question-progress" aria-label="質問の切り替え">
        {questions.map((q, index) => (
          <Button
            key={q.id}
            size="sm"
            variant={step === index ? "default" : "ghost"}
            aria-label={`質問${index + 1}${complete(drafts?.[q.id]) ? " 回答入力済み" : " 未回答"}`}
            aria-current={step === index ? "step" : undefined}
            disabled={disabled}
            onClick={() => setStep(index)}
          >
            {index + 1}
            {complete(drafts?.[q.id]) && <Check size={12} />}
          </Button>
        ))}
      </div>
      <div className="chat-question-body" key={question.id}>
        <p ref={title} tabIndex={-1} className="chat-question-title">
          {question.question}
        </p>
        <div className="chat-question-options">
          {question.options.map((option, index) => (
            <Button
              key={index}
              variant={
                draft.mode === "option" && draft.optionIndex === index ? "secondary" : "outline"
              }
              size="choice"
              disabled={disabled}
              aria-label={option.label}
              aria-describedby={option.description ? `${question.id}-option-${index}` : undefined}
              aria-pressed={draft.mode === "option" && draft.optionIndex === index}
              onClick={() => {
                update({ ...draft, mode: "option", optionIndex: index });
                if (step < questions.length - 1) setStep(step + 1);
              }}
            >
              <span>
                {draft.mode === "option" && draft.optionIndex === index ? "✓ " : ""}
                {option.label}
              </span>
              {option.description && (
                <span id={`${question.id}-option-${index}`} className="chat-question-description">
                  {option.description}
                </span>
              )}
            </Button>
          ))}
          <Button
            variant={draft.mode === "text" ? "secondary" : "outline"}
            size="sm"
            disabled={disabled}
            aria-pressed={draft.mode === "text"}
            onClick={() => update({ ...draft, mode: "text" })}
          >
            自分で回答する
          </Button>
        </div>
        {draft.mode === "text" && (
          <div className="chat-question-free-text">
            <Textarea
              aria-label={`${question.question}への自由入力`}
              value={draft.text}
              disabled={disabled}
              placeholder="希望や条件を書いてください。「まだ決められない」でも大丈夫です。"
              onChange={(event) => update({ ...draft, text: event.target.value })}
            />
            <p className="muted chat-question-hint">{[...draft.text].length} / 2000文字</p>
            {[...draft.text].length > 2000 && <p role="alert">2000文字以内にしてください。</p>}
          </div>
        )}
      </div>
      <div className="chat-question-footer">
        <div className="chat-question-navigation">
          {step > 0 && (
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setStep(step - 1)}>
              戻る
            </Button>
          )}
          {step < questions.length - 1 && (
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled || !complete(draft)}
              onClick={() => setStep(step + 1)}
            >
              次の質問
            </Button>
          )}
          <Button
            size="sm"
            disabled={disabled || answeredCount !== questions.length}
            onClick={submit}
          >
            まとめて送信
          </Button>
        </div>
        <output className="muted chat-question-hint">
          {running
            ? "AIの応答が終わると回答できます。"
            : answeredCount === questions.length
              ? "回答がそろいました。「まとめて送信」で会話を続けます。"
              : `あと${questions.length - answeredCount}問に回答してください。`}
        </output>
      </div>
    </section>
  );
}
