import { beforeEach, expect, it, vi } from "vitest";
import { api, emptySnapshot } from "./api";
import { useWorkspace } from "./workspace";
import { openNotification } from "./notification-navigation";

const snapshot = {
  ...emptySnapshot,
  project: { ...emptySnapshot.project, id: "p" },
  conversations: [{ id: "c", agent: "codex", title: "Chat", sessionId: null, createdAt: 0 }],
};
beforeEach(() => {
  vi.restoreAllMocks();
  useWorkspace.setState({
    snapshot,
    loaded: true,
    busy: null,
    switching: false,
    chatOpen: false,
    conversation: null,
  });
  vi.spyOn(api, "snapshot").mockResolvedValue(snapshot);
});
it("opens the completed conversation after refreshing saved messages", async () => {
  await openNotification({ projectId: "p", conversationId: "c" });
  expect(useWorkspace.getState().conversation).toBe("c");
  expect(useWorkspace.getState().chatOpen).toBe(true);
});
it("does not navigate away from an active turn or select a deleted conversation", async () => {
  useWorkspace.setState({
    conversation: "current",
    busy: { kind: "chat", conversation: "current" },
  });
  await openNotification({ projectId: "other", conversationId: "c" });
  expect(useWorkspace.getState().conversation).toBe("current");
  expect(api.snapshot).not.toHaveBeenCalled();
  useWorkspace.setState({ busy: null });
  await openNotification({ projectId: "p", conversationId: "deleted" });
  expect(useWorkspace.getState().conversation).toBe("current");
});

it("keeps attachments when the notification points to the conversation already open", async () => {
  const references = [{ cardId: "card", title: "Draft reference", revision: 1, quote: "excerpt" }];
  useWorkspace.setState({ conversation: "c", references });
  await openNotification({ projectId: "p", conversationId: "c" });
  expect(useWorkspace.getState().references).toEqual(references);
});
