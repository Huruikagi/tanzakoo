import { useState } from "react";
import type { ChoiceQuestion } from "@/bindings/ChoiceQuestion";
import type { QuestionAnswer } from "@/bindings/QuestionAnswer";
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

export function useQuestionAnswers(questions: ChoiceQuestion[], disabled: boolean) {
  const projectId = useWorkspace((s) => s.snapshot.project.id);
  const drafts = useWorkspace((s) => s.questionDrafts[projectId]);
  const [step, setStep] = useState(0);
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
  function advanceOrSubmit() {
    if (disabled || !pending || !complete(draft)) return;
    if (answeredCount === questions.length) {
      submit();
      return;
    }
    // Return to an earlier unanswered question when the user skipped ahead.
    const next = questions.findIndex((q, index) => index > step && !complete(drafts?.[q.id]));
    setStep(next >= 0 ? next : questions.findIndex((q) => !complete(drafts?.[q.id])));
  }
  return {
    step,
    setStep,
    pending,
    question,
    draft,
    answeredCount,
    currentAnswered: complete(draft),
    isAnswered: (id: string) => complete(drafts?.[id]),
    update,
    submit,
    advanceOrSubmit,
  };
}
