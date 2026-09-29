import { t, systemMessage } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { LoaderCircle, Plug, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useShallow } from "zustand/react/shallow";
import { connectionStatus, useWorkspace } from "@/lib/workspace";
import { agentUnavailable, api, native } from "@/lib/api";
import { ReviewAccess } from "./ReviewAccess";
import { PlanAccess } from "./PlanAccess";

export function AgentConnectionDialog({ agent }: { agent: string }) {
  useTranslation();
  const review = useWorkspace((s) => s.reviewAccess);
  const status = useWorkspace((s) => connectionStatus(s, agent));
  const connecting = useWorkspace((s) => s.busy?.kind === "connecting" && s.busy.agent === agent);
  const needsAttention = status && status.state !== "ready";
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("接続状況")}
          title={
            connecting
              ? t("接続処理中")
              : review
                ? t("審査用接続")
                : systemMessage(status?.message ?? t("接続状況"))
          }
        >
          {connecting ? (
            <LoaderCircle className="animate-spin" />
          ) : needsAttention ? (
            <TriangleAlert className="text-amber-600" />
          ) : (
            <Plug />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Codexの接続状況")}</DialogTitle>
          <DialogDescription>
            {t("接続の確認やサインインでは、プロジェクトの内容は送信しません。")}
          </DialogDescription>
        </DialogHeader>
        <div className="settings-scroll">
          <AgentConnection agent={agent} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AgentConnection({
  agent,
  hideWhenReady = false,
}: {
  agent: string;
  hideWhenReady?: boolean;
}) {
  useTranslation();
  const workspace = useWorkspace(
    useShallow((s) => ({
      snapshot: s.snapshot,
      busy: s.busy,
      activity: s.activity,
      connect: s.connect,
      connections: s.connections,
      reviewAccess: s.reviewAccess,
      planStatus: s.planStatus,
    })),
  );
  const { snapshot, busy, activity, connect } = workspace;
  const status = connectionStatus(workspace, agent);
  const connecting = busy?.kind === "connecting" && busy.agent === agent;
  if (agent !== "codex")
    return (
      <div className="agent-connection">
        <output>{t("この会話は閲覧のみです。新しい会話はCodexで始められます。")}</output>
      </div>
    );
  if (workspace.reviewAccess) return hideWhenReady ? null : <ReviewAccess />;
  if (workspace.planStatus?.active)
    return hideWhenReady ? null : (
      <>
        <PlanAccess />
        <ReviewAccess />
      </>
    );
  if (agentUnavailable(snapshot, agent) || status?.state === "unsupported")
    return (
      <div className="agent-connection">
        <output>
          {systemMessage(
            status?.message ??
              t("この接続は利用できません。カードの閲覧・編集は引き続き利用できます。"),
          )}
        </output>
      </div>
    );
  const ready = status?.state === "ready";
  if (hideWhenReady && ready && !connecting) return null;
  return (
    <div className="agent-connection">
      <output>
        {systemMessage(
          connecting ? activity : (status?.message ?? t("Codexの接続はまだ確認していません。")),
        )}
      </output>
      {status?.canLogin && !ready && (
        <p className="hint muted">
          {t("ターミナルのCodexとは別に、Tanzakoo用のサインインが必要です。")}
        </p>
      )}
      <div className="connection-actions">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!native || !!busy}
          onClick={() => void connect(agent, "check")}
        >
          {t("接続を確認")}
        </Button>
        {agent === "codex" && status?.canLogin && (
          <Button
            type="button"
            size="sm"
            disabled={!native || !!busy}
            onClick={() => void connect(agent, status.state === "ready" ? "logout" : "login")}
          >
            {status.state === "ready" ? t("サインアウト") : t("ChatGPTでサインイン")}
          </Button>
        )}
        {connecting && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              void api
                .cancel()
                .catch((error) => useWorkspace.setState({ chatError: String(error) }))
            }
          >
            {t("接続処理を中止")}
          </Button>
        )}
      </div>
      {!hideWhenReady && <ReviewAccess />}
      {!hideWhenReady && <PlanAccess />}
    </div>
  );
}
