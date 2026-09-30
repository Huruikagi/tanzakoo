import type { NotificationTarget } from "@/bindings/NotificationTarget";
import { useWorkspace } from "./workspace";

export async function openNotification(target: NotificationTarget) {
  const current = useWorkspace.getState();
  current.setChatOpen(true);
  if (current.busy || current.switching) return;
  if (current.snapshot.project.id !== target.projectId) {
    if (!(await current.changeProject(target.projectId))) return;
  } else {
    // A click can arrive before the normal completion refresh.
    await current.refresh();
  }
  const state = useWorkspace.getState();
  if (state.busy || state.switching || state.snapshot.project.id !== target.projectId) return;
  if (
    state.conversation !== target.conversationId &&
    state.snapshot.conversations.some((c) => c.id === target.conversationId)
  ) {
    state.selectConversation(target.conversationId);
  }
}
