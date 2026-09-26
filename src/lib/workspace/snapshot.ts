import type { Snapshot } from "@/bindings/Snapshot";
import type { Workspace, Draft } from "./types";

// Serialize snapshot reads and mutations so a slow earlier read cannot overwrite a newer result.
let queue: Promise<unknown> = Promise.resolve();
export function serialized<T>(job: () => Promise<T>): Promise<T> {
  const task = queue.then(job, job);
  queue = task.catch(() => {});
  return task;
}
export function restoredView(snapshot: Snapshot) {
  let view: { selected?: string | null; conversation?: string | null } = {};
  try {
    view = JSON.parse(localStorage.getItem(`tanzakoo-view-${snapshot.project.id}`) ?? "{}");
  } catch {
    /* Optional UI preferences. */
  }
  return {
    selected: snapshot.cards.some((c) => c.id === view?.selected) ? view.selected! : null,
    conversation:
      view?.conversation === null
        ? null
        : snapshot.conversations.some((c) => c.id === view?.conversation)
          ? view.conversation!
          : (snapshot.conversations.at(-1)?.id ?? null),
  };
}
function syncedDrafts(previous: Snapshot, snapshot: Snapshot, drafts: Record<string, Draft>) {
  if (previous.project.id !== snapshot.project.id) return drafts;
  const result = { ...drafts };
  for (const card of snapshot.cards) {
    const draft = drafts[card.id];
    const before = previous.cards.find((c) => c.id === card.id);
    // A column-only move must not turn an in-progress content edit into a conflict.
    if (
      draft &&
      before?.revision === draft.revision &&
      before.title === card.title &&
      before.body === card.body &&
      before.deleted === card.deleted
    ) {
      result[card.id] = { ...draft, revision: card.revision };
    }
  }
  return result;
}
/** All saved-board responses reconcile content drafts using the same revision rules. */
export function snapshotUpdate(state: Workspace, snapshot: Snapshot) {
  return { snapshot, drafts: syncedDrafts(state.snapshot, snapshot, state.drafts) };
}
export function projectView(snapshot: Snapshot, view = restoredView(snapshot)) {
  return {
    ...view,
    archiveNotice: null,
    references: [],
    stream: "",
    permissions: [],
    error: null,
    chatError: null,
    loaded: true,
  };
}
