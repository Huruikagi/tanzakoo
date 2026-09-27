import { t } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Check, MessageCircleQuestion } from "lucide-react";
import type { ChoiceQuestion } from "@/bindings/ChoiceQuestion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useQuestionAnswers } from "@/lib/use-question-answers";
import { QuestionHistory } from "./QuestionHistory";

export function QuestionChoices({
  questions,
  disabled,
  running = false,
}: {
  questions: ChoiceQuestion[];
  disabled: boolean;
  running?: boolean;
}) {
  useTranslation();
  const {
    step,
    setStep,
    pending,
    question,
    draft,
    answeredCount,
    currentAnswered,
    isAnswered,
    update,
    submit,
    advanceOrSubmit,
  } = useQuestionAnswers(questions, disabled);
  const multiple = questions.length > 1;
  const title = useRef<HTMLParagraphElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const revealInput = useRef(false);
  const composing = useRef(false);
  const previousStep = useRef(step);
  useLayoutEffect(() => {
    if (!revealInput.current) return;
    revealInput.current = false;
    input.current?.focus({ preventScroll: true });
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  });
  useEffect(() => {
    if (previousStep.current !== step) title.current?.focus({ preventScroll: true });
    composing.current = false;
    previousStep.current = step;
  }, [step]);
  if (!pending) return <QuestionHistory questions={questions} />;
  return (
    <section
      className="chat-question chat-question-active"
      aria-label={multiple ? t("質問にまとめて回答") : t("質問に回答")}
    >
      <div className="chat-question-heading">
        <Badge>
          <MessageCircleQuestion />
          {running
            ? t("AI応答中")
            : answeredCount === questions.length
              ? t("送信待ち")
              : t("回答待ち")}
        </Badge>
        {multiple && (
          <span className="chat-question-counter">
            {t("質問 {{value0}} / {{value1}}", { value0: step + 1, value1: questions.length })}
          </span>
        )}
      </div>
      {multiple && (
        <div className="chat-question-progress" aria-label={t("質問の切り替え")}>
          {questions.map((q, index) => (
            <Button
              key={q.id}
              size="sm"
              variant={step === index ? "default" : "ghost"}
              aria-label={t("質問{{value0}}{{value1}}", {
                value0: index + 1,
                value1: isAnswered(q.id) ? t(" 回答入力済み") : t(" 未回答"),
              })}
              aria-current={step === index ? "step" : undefined}
              disabled={disabled}
              onClick={() => setStep(index)}
            >
              {index + 1}
              {isAnswered(q.id) && <Check size={12} />}
            </Button>
          ))}
        </div>
      )}
      <div className="chat-question-body" key={question.id} ref={body}>
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
            onClick={() => {
              revealInput.current = true;
              update({ ...draft, mode: "text" });
            }}
          >
            {t("自分で回答する")}
          </Button>
        </div>
        {draft.mode === "text" && (
          <div className="chat-question-free-text">
            <Textarea
              ref={input}
              aria-label={t("{{value0}}への自由入力", { value0: question.question })}
              value={draft.text}
              disabled={disabled}
              placeholder={t("希望や条件を書いてください。「まだ決められない」でも大丈夫です。")}
              onChange={(event) => update({ ...draft, text: event.target.value })}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
                if (event.nativeEvent.isComposing || composing.current) return;
                event.preventDefault();
                if (!event.repeat) advanceOrSubmit();
              }}
            />
            <p className="muted chat-question-hint">
              {t("{{value0}} / 2000文字 · Ctrl + Enter で{{value1}}", {
                value0: [...draft.text].length,
                value1: multiple && answeredCount !== questions.length ? t("次の質問") : t("送信"),
              })}
            </p>
            {[...draft.text].length > 2000 && (
              <p role="alert">{t("2000文字以内にしてください。")}</p>
            )}
          </div>
        )}
      </div>
      <div className="chat-question-footer">
        <div className="chat-question-navigation">
          {step > 0 && (
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setStep(step - 1)}>
              {t("戻る")}
            </Button>
          )}
          {step < questions.length - 1 && (
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled || !currentAnswered}
              onClick={() => setStep(step + 1)}
            >
              {t("次の質問")}
            </Button>
          )}
          <Button
            size="sm"
            disabled={disabled || answeredCount !== questions.length}
            onClick={submit}
          >
            {multiple ? t("まとめて送信") : t("回答を送信")}
          </Button>
        </div>
        {(multiple || running) && (
          <output className="muted chat-question-hint">
            {running
              ? t("AIの応答が終わると回答できます。")
              : answeredCount === questions.length
                ? t("回答がそろいました。「まとめて送信」で会話を続けます。")
                : t("あと{{value0}}問に回答してください。", {
                    value0: questions.length - answeredCount,
                  })}
          </output>
        )}
      </div>
    </section>
  );
}
