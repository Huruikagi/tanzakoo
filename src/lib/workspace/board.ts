import { t } from "@/lib/i18n";
import { api } from "../api";
import type { WorkspaceSlice } from "./types";
import type { Card } from "@/bindings/Card";
import { proposalBlockReason } from "../proposals";
import { serialized, snapshotUpdate } from "./snapshot";
import { launchKey } from "./agent";

export const createBoardSlice: WorkspaceSlice<
  | "selected"
  | "archivePending"
  | "archiveNotice"
  | "setArchived"
  | "drafts"
  | "select"
  | "act"
  | "draft"
> = (set, get) => ({
  selected: null,
  archivePending: false,
  archiveNotice: null,
  setArchived: async (id, archived) => {
    if (get().switching || get().archivePending) return;
    const projectId = get().snapshot.project.id;
    set({ archivePending: true });
    await serialized(async () => {
      try {
        const state = get();
        if (state.snapshot.project.id !== projectId) return;
        const card = state.snapshot.cards.find((c) => c.id === id);
        if (!card || card.deleted === archived) return;
        const draft = state.drafts[id];
        if (archived && draft && (draft.title !== card.title || draft.body !== card.body)) {
          set({
            error: t("未保存の編集があります。保存するか取り消してからアーカイブしてください。"),
          });
          return;
        }
        const snapshot = await api.action(
          { type: "updateCard", card: { ...card, deleted: archived } },
          projectId,
        );
        const saved = snapshot.cards.find((c) => c.id === id);
        set((current) => ({
          ...snapshotUpdate(current, snapshot),
          error: null,
          archiveNotice:
            archived && saved
              ? { projectId, cardId: id, revision: saved.revision }
              : current.archiveNotice?.cardId === id
                ? null
                : current.archiveNotice,
        }));
      } catch (error) {
        set({ error: String(error) });
      } finally {
        set({ archivePending: false });
      }
    });
  },
  drafts: {},
  select: (id) => set({ selected: id }),
  act: (action) => {
    if (get().switching) return Promise.resolve(null);
    const projectId = get().snapshot.project.id;
    return serialized(async () => {
      try {
        if (action.type === "applyProposals") {
          const state = get();
          if (state.snapshot.project.id !== projectId)
            throw new Error(t("プロジェクトが変わっています。"));
          for (const id of action.ids) {
            const proposal = state.snapshot.proposals.find(
              (p) => p.id === id && p.state === "pending",
            );
            if (!proposal)
              throw new Error(t("提案が更新されています。最新の提案を確認してください。"));
            const reason = proposalBlockReason(
              proposal,
              state.snapshot.cards.find((c) => c.id === proposal.cardId),
              state.drafts[proposal.cardId],
            );
            if (reason) throw new Error(reason);
          }
        }
        const snapshot = await api.action(action, projectId);
        set((state) => ({
          ...snapshotUpdate(state, snapshot),
          error: null,
        }));
        if (action.type === "configureAgent") {
          const agent = action.config.id;
          set((s) => ({
            connections: {
              ...s.connections,
              [agent]: {
                status: {
                  state: "unknown",
                  message: t("設定を変更しました。接続を確認してください。"),
                  canLogin: false,
                },
                launch: launchKey(snapshot, agent),
              },
            },
          }));
        }
        return snapshot;
      } catch (error) {
        set({ error: String(error) });
        if (action.type === "applyProposals") {
          // A proposal may have been replaced by the agent since it was displayed.
          try {
            const snapshot = await api.snapshot();
            if (snapshot.project.id === get().snapshot.project.id)
              set((state) => snapshotUpdate(state, snapshot));
          } catch {
            // Keep the approval error visible if refreshing also fails.
          }
        }
        return null;
      }
    });
  },
  draft: (id, value) =>
    set((state) => {
      const drafts = { ...state.drafts };
      if (value) drafts[id] = value;
      else delete drafts[id];
      return { drafts };
    }),
});

export function moveCard(
  cards: Card[],
  id: string,
  status: Card["status"],
  index: number,
): Card | null {
  const card = cards.find((c) => c.id === id && !c.deleted);
  if (!card) return null;
  const others = cards
    .filter((c) => c.id !== id && !c.deleted && c.status === status)
    .sort((a, b) => a.position - b.position);
  const next = others[Math.max(0, index)];
  const previous = others[Math.max(0, index) - 1];
  const position =
    previous && next
      ? (previous.position + next.position) / 2
      : next
        ? next.position - 1
        : (previous?.position ?? others.at(-1)?.position ?? 0) + 1;
  return { ...card, status, position };
}
