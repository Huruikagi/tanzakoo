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

export function AgentConnectionDialog({ agent }: { agent: string }) {
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
          aria-label="接続状況"
          title={connecting ? "接続処理中" : (status?.message ?? "接続状況")}
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
          <DialogTitle>Codexの接続状況</DialogTitle>
          <DialogDescription>
            接続の確認やサインインでは、プロジェクトの内容は送信しません。
          </DialogDescription>
        </DialogHeader>
        <AgentConnection agent={agent} />
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
  const workspace = useWorkspace(
    useShallow((s) => ({
      snapshot: s.snapshot,
      busy: s.busy,
      activity: s.activity,
      connect: s.connect,
      connections: s.connections,
    })),
  );
  const { snapshot, busy, activity, connect } = workspace;
  const status = connectionStatus(workspace, agent);
  const connecting = busy?.kind === "connecting" && busy.agent === agent;
  if (agent !== "codex")
    return (
      <div className="agent-connection">
        <output>この会話は閲覧のみです。新しい会話はCodexで始められます。</output>
      </div>
    );
  if (agentUnavailable(snapshot, agent) || status?.state === "unsupported")
    return (
      <div className="agent-connection">
        <output>
          {status?.message ??
            "この接続は利用できません。カードの閲覧・編集は引き続き利用できます。"}
        </output>
      </div>
    );
  const ready = status?.state === "ready";
  if (hideWhenReady && ready && !connecting) return null;
  return (
    <div className="agent-connection">
      <output>
        {connecting ? activity : (status?.message ?? "Codexの接続はまだ確認していません。")}
      </output>
      {status?.canLogin && !ready && (
        <p className="hint muted">ターミナルのCodexとは別に、Tanzakoo用のサインインが必要です。</p>
      )}
      <div className="connection-actions">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!native || !!busy}
          onClick={() => void connect(agent, "check")}
        >
          接続を確認
        </Button>
        {agent === "codex" && status?.canLogin && (
          <Button
            type="button"
            size="sm"
            disabled={!native || !!busy}
            onClick={() => void connect(agent, status.state === "ready" ? "logout" : "login")}
          >
            {status.state === "ready" ? "サインアウト" : "ChatGPTでサインイン"}
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
            接続処理を中止
          </Button>
        )}
      </div>
    </div>
  );
}
