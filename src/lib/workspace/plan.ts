import { api } from "../api";
import { t } from "../i18n";
import type { WorkspaceSlice } from "./types";

export const createPlanSlice: WorkspaceSlice<"planStatus" | "planError" | "planConnect"> = (
  set,
  get,
) => ({
  planStatus: null,
  planError: null,
  planConnect: async (action, accountId = null) => {
    if (get().busy || get().switching) return false;
    set({
      busy: { kind: "connecting", agent: "codex" },
      planError: null,
      activity:
        action === "login"
          ? t("ブラウザでサインインを完了してください…")
          : t("接続を確認しています…"),
    });
    try {
      const planStatus = await api.planConnection(get().snapshot.project.id, action, accountId);
      set({ planStatus });
      if (action !== "list" && action !== "usage")
        set({ connections: {}, chatError: null, conversation: null, stream: "" });
      return true;
    } catch (error) {
      set({ planError: String(error) });
      return false;
    } finally {
      set({ busy: null, activity: "" });
    }
  },
});
