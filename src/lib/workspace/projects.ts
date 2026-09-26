import { api } from "../api";
import type { WorkspaceSlice } from "./types";
import { serialized, snapshotUpdate, projectView } from "./snapshot";

export const createProjectsSlice: WorkspaceSlice<
  | "switching"
  | "projectDrafts"
  | "changeProject"
  | "createProject"
  | "deleteProject"
  | "draftProject"
> = (set, get) => ({
  switching: false,
  projectDrafts: {},
  changeProject: async (id) => {
    if (get().busy || get().switching) return false;
    set({ switching: true });
    return serialized(async () => {
      try {
        const snapshot = await api.switchProject(id);
        set((state) => ({ ...snapshotUpdate(state, snapshot), ...projectView(snapshot) }));
        return true;
      } catch (error) {
        set({ error: String(error) });
        return false;
      } finally {
        set({ switching: false });
      }
    });
  },
  createProject: async (name, memory) => {
    if (get().busy || get().switching) return false;
    set({ switching: true });
    return serialized(async () => {
      try {
        const snapshot = await api.createProject(name, memory);
        set((state) => ({
          ...snapshotUpdate(state, snapshot),
          ...projectView(snapshot, { selected: null, conversation: null }),
        }));
        return true;
      } catch (error) {
        set({ error: String(error) });
        return false;
      } finally {
        set({ switching: false });
      }
    });
  },
  deleteProject: async (id) => {
    if (get().busy || get().switching || get().snapshot.project.id !== id) return false;
    set({ switching: true, error: null });
    return serialized(async () => {
      try {
        const previous = get().snapshot;
        const { snapshot, warning } = await api.deleteProject(id);
        set((state) => {
          const drafts = { ...state.drafts };
          for (const card of previous.cards) delete drafts[card.id];
          const projectDrafts = { ...state.projectDrafts };
          delete projectDrafts[id];
          const questionDrafts = { ...state.questionDrafts };
          delete questionDrafts[id];
          return {
            snapshot,
            ...projectView(snapshot),
            drafts,
            projectDrafts,
            questionDrafts,
            error: warning,
          };
        });
        try {
          localStorage.removeItem(`tanzakoo-view-${id}`);
        } catch {
          /* Optional UI preference. */
        }
        return true;
      } catch (error) {
        set({ error: String(error) });
        return false;
      } finally {
        set({ switching: false });
      }
    });
  },
  draftProject: (id, value) =>
    set((state) => {
      const projectDrafts = { ...state.projectDrafts };
      if (value) projectDrafts[id] = value;
      else delete projectDrafts[id];
      return { projectDrafts };
    }),
});
