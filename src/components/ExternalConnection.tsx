import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t, systemMessage } from "@/lib/i18n";
import { native } from "@/lib/api";
import { connectionStatus, useWorkspace } from "@/lib/workspace";
import { externalAgent, externalAgents, externalConsent } from "@/lib/external-agents";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export function ExternalConnections() {
  const available = useWorkspace((s) => s.snapshot.externalAgentsAvailable);
  const project = useWorkspace((s) => s.snapshot.project.id);
  const [agent, setAgent] = useState<string>(externalAgents[0].id);
  useTranslation();
  if (!available) return null;
  return (
    <details className="connection-details">
      <summary>{t("インストール済みの外部CLI")}</summary>
      <div className="connection-stack">
        <Select value={agent} onValueChange={setAgent}>
          <SelectTrigger aria-label={t("外部CLI")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {externalAgents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ExternalConnection key={`${project}:${agent}`} agent={agent} />
      </div>
    </details>
  );
}

export function ExternalConnection({ agent }: { agent: string }) {
  useTranslation();
  const config = useWorkspace((s) => s.snapshot.agents.find((a) => a.id === agent));
  const available = useWorkspace((s) => s.snapshot.externalAgentsAvailable);
  const disabled = useWorkspace((s) => !!s.busy || s.switching || !!s.reviewAccess) || !native;
  const status = useWorkspace((s) => connectionStatus(s, agent));
  const consented = useWorkspace((s) => s.snapshot.consents.includes(agent));
  const [command, setCommand] = useState(config?.command ?? "");
  const [args, setArgs] = useState(JSON.stringify(config?.args ?? []));
  const [error, setError] = useState("");
  const id = useId();
  const info = externalAgent(agent);
  const dirty = command !== config?.command || args !== JSON.stringify(config?.args ?? []);
  if (!available || !info) return <p>{t("この配布版では外部CLI接続を利用できません。")}</p>;
  async function save() {
    setError("");
    try {
      const parsed: unknown = JSON.parse(args);
      if (!Array.isArray(parsed) || !parsed.every((a) => typeof a === "string"))
        throw new Error(t("引数は文字列のJSON配列で入力してください。"));
      const result = await useWorkspace.getState().act({
        type: "configureAgent",
        config: { id: agent, command: command.trim(), args: parsed },
      });
      if (!result) throw new Error(t("保存に失敗しました。もう一度お試しください。"));
      setCommand(command.trim());
      setArgs(JSON.stringify(parsed));
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className="connection-stack">
      <p className="hint">
        {t(
          "CLIのインストールとログインは、公式手順に従って行ってください。Tanzakooは自動インストールせず、認証情報をコピー・保存しません。",
        )}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void openUrl(info.url).catch(() => setError(info.url))}
      >
        {t("公式の導入手順")}
      </Button>
      {"serverUrl" in info && (
        <div className="connection-actions">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openUrl(info.serverUrl).catch(() => setError(info.serverUrl))}
          >
            {t("公式ACPサーバーの配布情報")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openUrl(info.loginUrl).catch(() => setError(info.loginUrl))}
          >
            {t("公式CLIのログイン手順")}
          </Button>
        </div>
      )}
      {agent === "antigravity" && (
        <p className="hint">
          {t(
            "公式ACPサーバーを導入し、Windowsはagy_acp_server.exe、Macはagy_acp_server.parの絶対パスを指定してください。通常のagyコマンドは接続先に使いません。同じOSユーザーで公式CLIにログイン後、接続を確認してください。",
          )}
        </p>
      )}
      <p className="hint">{t("ターミナルでのログイン: {{command}}", { command: info.login })}</p>
      <label htmlFor={`${id}-command`}>{t("CLIの実行ファイルまたはコマンド名")}</label>
      <Input
        id={`${id}-command`}
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        disabled={disabled}
        spellCheck={false}
      />
      <details>
        <summary>{t("起動引数（詳細設定）")}</summary>
        <Textarea
          aria-label={t("起動引数（JSON配列）")}
          value={args}
          onChange={(e) => setArgs(e.target.value)}
          disabled={disabled}
          spellCheck={false}
        />
        <p className="hint">
          {t("トークンやパスワードは入力しないでください。認証はCLI側で設定します。")}
        </p>
      </details>
      <div className="connection-actions">
        <Button
          size="sm"
          disabled={disabled || !dirty || !command.trim()}
          onClick={() => void save()}
        >
          {t("保存")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || dirty}
          onClick={() => void useWorkspace.getState().connect(agent, "check")}
        >
          {t("接続を確認")}
        </Button>
      </div>
      <p className="hint">
        {t(
          "接続確認はセッション作成までを確認します。AIの応答や利用枠は、最初の送信時に確認されます。モデルはCLI側の既定値を使います。",
        )}
      </p>
      {status && <output>{systemMessage(status.message)}</output>}
      {error && <p role="alert">{systemMessage(error)}</p>}
      <details>
        <summary>{t("送信する内容と同意")}</summary>
        <p className="hint">{t(externalConsent)}</p>
        {consented && (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => void useWorkspace.getState().setConsent(agent, false)}
          >
            {t("同意を取り消す")}
          </Button>
        )}
      </details>
    </div>
  );
}
