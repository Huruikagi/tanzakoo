import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace";
import { api, native } from "@/lib/api";

export function AgentConnection({ agent }: { agent: string }) {
  const { snapshot, connections, busy, activity, connect } = useWorkspace();
  const status = connections[`${snapshot.project.id}:${agent}`];
  const connecting = busy === `connection:${agent}`;
  return (
    <div className="agent-connection">
      <output>
        {connecting
          ? activity
          : (status?.message ?? "AIは任意です。利用する場合は接続を確認してください。")}
      </output>
      {agent === "codex" && (
        <p className="hint muted">
          Tanzakoo専用のログインを使います。ターミナルのCodexとは別にサインインしてください。
        </p>
      )}
      {agent === "claude" && (
        <p className="hint muted">
          Claudeの配布版ログインは提供条件を確認中です。現在は詳細設定の既存接続を確認できます。
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
          接続を確認
        </Button>
        {status?.canLogin && (
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
