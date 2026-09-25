import { Button } from "@/components/ui/button";
import { connectionStatus, useWorkspace } from "@/lib/workspace";
import { agentUnavailable, api, native } from "@/lib/api";

export function AgentConnection({
  agent,
  hideWhenReady = false,
}: {
  agent: string;
  hideWhenReady?: boolean;
}) {
  const workspace = useWorkspace();
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
