import { create } from "zustand";
import { api, emptySnapshot } from "./api";
import type { Workspace } from "./workspace/types";
import { serialized, snapshotUpdate, restoredView } from "./workspace/snapshot";
import { createProjectsSlice } from "./workspace/projects";
import { createBoardSlice } from "./workspace/board";
import { createAgentSlice } from "./workspace/agent";

export type { Permission, Busy, ProjectDraft } from "./workspace/types";
export { connectionStatus, chatRunning } from "./workspace/agent";
export { moveCard } from "./workspace/board";

export const columns = [
  { id: "idea", title: "アイデアの山", number: "01" },
  { id: "explore", title: "検討する", number: "02" },
  { id: "discuss", title: "話し合う", number: "03" },
  { id: "decided", title: "決めたこと", number: "04" },
] as const;

// One store and one snapshot queue coordinate all feature slices.
export const useWorkspace = create<Workspace>((...args) => {
  const [set] = args;
  return {
    ...createProjectsSlice(...args),
    ...createBoardSlice(...args),
    ...createAgentSlice(...args),
    chatOpen: (() => {
      try {
        return localStorage.getItem("tanzakoo-chat-open") === "true";
      } catch {
        return false;
      }
    })(),
    setChatOpen: (chatOpen) => {
      set({ chatOpen });
      try {
        localStorage.setItem("tanzakoo-chat-open", String(chatOpen));
      } catch {
        /* Optional UI preference. */
      }
    },
    snapshot: emptySnapshot,
    questionDrafts: {},
    loaded: false,
    error: null,
    refresh: () =>
      serialized(async () => {
        try {
          const snapshot = await api.snapshot();
          set((state) => ({
            ...snapshotUpdate(state, snapshot),
            loaded: true,
            ...(!state.loaded || snapshot.project.id !== state.snapshot.project.id
              ? { ...restoredView(snapshot), references: [] }
              : {}),
          }));
        } catch (error) {
          set({ error: String(error), loaded: true });
        }
      }),
  };
});

// Only remember navigation, not chat or unsaved content, in browser storage.
useWorkspace.subscribe((state, previous) => {
  const id = state.snapshot.project.id;
  if (
    !id ||
    (id === previous.snapshot.project.id &&
      state.selected === previous.selected &&
      state.conversation === previous.conversation)
  )
    return;
  try {
    localStorage.setItem(
      `tanzakoo-view-${id}`,
      JSON.stringify({ selected: state.selected, conversation: state.conversation }),
    );
  } catch {
    /* The database remains usable without UI preferences. */
  }
});
