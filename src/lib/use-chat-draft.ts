import { useEffect, useState } from "react";
import { useWorkspace } from "./workspace";

/** Keeps composer drafts across navigation and the first conversation's creation. */
export function useChatDraft(projectId: string, conversation: string | null) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const key = `${projectId}:${conversation ?? "new"}`;
  const text = drafts[key] ?? "";
  const setText = (value: string) => setDrafts((previous) => ({ ...previous, [key]: value }));
  useEffect(
    () =>
      useWorkspace.subscribe((state, previous) => {
        const removed = previous.snapshot.projects.filter(
          (project) => !state.snapshot.projects.some((current) => current.id === project.id),
        );
        if (removed.length) {
          setDrafts((current) =>
            Object.fromEntries(
              Object.entries(current).filter(
                ([key]) => !removed.some((project) => key.startsWith(`${project.id}:`)),
              ),
            ),
          );
        }
        // Preserve the composer when a board action creates the first conversation.
        if (
          previous.conversation === null &&
          state.conversation &&
          previous.busy?.kind === "chat" &&
          previous.busy.conversation === null &&
          previous.snapshot.project.id === state.snapshot.project.id
        ) {
          const from = `${state.snapshot.project.id}:new`;
          const to = `${state.snapshot.project.id}:${state.conversation}`;
          setDrafts((current) => {
            if (!current[from] || current[to]) return current;
            const next = { ...current, [to]: current[from] };
            delete next[from];
            return next;
          });
        }
      }),
    [],
  );
  function sendDraft(agent: string) {
    const pending = text;
    setText("");
    void useWorkspace
      .getState()
      .send(pending, agent)
      .then((ok) => {
        if (!ok)
          setDrafts((previous) => ({
            ...previous,
            [`${projectId}:${useWorkspace.getState().conversation ?? "new"}`]:
              previous[`${projectId}:${useWorkspace.getState().conversation ?? "new"}`] || pending,
          }));
      });
  }
  return { text, setText, sendDraft };
}
