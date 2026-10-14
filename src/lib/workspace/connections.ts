import { t } from "@/lib/i18n";
import { api, agentUnavailable } from "../api";
import type { WorkspaceSlice, Workspace } from "./types";
import type { Snapshot } from "@/bindings/Snapshot";
import type { ConnectionStatus } from "@/bindings/ConnectionStatus";
import { serialized, snapshotUpdate } from "./snapshot";
import { externalAgent } from "../external-agents";

export function launchKey(snapshot: Snapshot, agent: string) {
  const config = snapshot.agents.find((a) => a.id === agent);
  return JSON.stringify([config?.command, config?.args]);
}
export function connectionStatus(
  state: Pick<Workspace, "snapshot" | "connections">,
  agent: string,
): ConnectionStatus | undefined {
  if (externalAgent(agent)) return externalConnectionCheck(state, agent)?.status;
  const connection = state.connections[agent];
  return connection?.launch === launchKey(state.snapshot, agent) ? connection.status : undefined;
}

export function externalConnectionCheck(state: Pick<Workspace, "snapshot">, agent: string) {
  if (agentUnavailable(state.snapshot, agent)) return undefined;
  const check = state.snapshot.externalConnectionChecks[agent];
  return check &&
    JSON.stringify([check.config.command, check.config.args]) === launchKey(state.snapshot, agent)
    ? check
    : undefined;
}
export const createConnectionSlice: WorkspaceSlice<
  | "reviewAccess"
  | "reviewError"
  | "reviewConnect"
  | "connections"
  | "setConsent"
  | "connect"
  | "loadChatOptions"
> = (set, get) => ({
  reviewAccess: null,
  reviewError: null,
  reviewConnect: async (action, code, consent = false) => {
    if (get().busy || get().switching) return false;
    set({
      busy: { kind: "connecting", agent: "codex" },
      reviewError: null,
      activity: t("審査用接続を確認しています…"),
    });
    try {
      const reviewAccess = await api.reviewConnection(
        get().snapshot.project.id,
        action,
        code ?? null,
        consent,
      );
      set({ reviewAccess, connections: {}, chatError: null });
      if (action !== "check")
        set({ newChatAgent: "codex", conversation: null, references: [], stream: "" });
      return true;
    } catch (error) {
      set({ reviewError: String(error) });
      return false;
    } finally {
      set({ busy: null, activity: "" });
    }
  },
  connections: {},
  setConsent: async (agent, granted) =>
    serialized(async () => {
      try {
        const snapshot = await api.setConsent(agent, granted);
        set((state) => ({ ...snapshotUpdate(state, snapshot), chatError: null }));
      } catch (error) {
        set({ chatError: String(error) });
      }
    }),
  connect: async (agent, action) => {
    if (get().busy || get().switching) return;
    if (agentUnavailable(get().snapshot, agent)) return;
    const launch = launchKey(get().snapshot, agent);
    set({
      busy: { kind: "connecting", agent },
      chatError: null,
      activity:
        action === "login"
          ? t("ブラウザでサインインを完了してください…")
          : t("接続を確認しています…"),
    });
    try {
      const status = await api.connection(get().snapshot.project.id, agent, action);
      if (externalAgent(agent)) {
        await get().refresh();
        if (status.state !== "ready" && connectionStatus(get(), agent)?.message !== status.message)
          set({ chatError: status.message });
      } else {
        set((s) => ({ connections: { ...s.connections, [agent]: { status, launch } } }));
      }
    } catch (error) {
      set({ chatError: String(error) });
    } finally {
      set({ busy: null, activity: "" });
    }
  },
  loadChatOptions: async (agent, model) => {
    if (get().busy || get().switching) throw new Error(t("処理が終わってから設定してください。"));
    const projectId = get().snapshot.project.id;
    set({ busy: { kind: "settings" }, activity: t("モデルの選択肢を確認しています…") });
    try {
      return await api.chatOptions(projectId, agent, model);
    } finally {
      set({ busy: null, activity: "" });
    }
  },
});
