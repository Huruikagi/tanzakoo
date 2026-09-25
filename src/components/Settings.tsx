import { useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useWorkspace } from "@/lib/workspace";
import type { AgentConfig } from "@/bindings/AgentConfig";
import { native } from "@/lib/api";
import { AgentConnection } from "./AgentConnection";
function AgentSettings({ config }: { config: AgentConfig }) {
  const [command, setCommand] = useState(config.command);
  const [args, setArgs] = useState(JSON.stringify(config.args, null, 2));
  const [message, setMessage] = useState("");
  const consented = useWorkspace((s) => s.snapshot.consents.includes(config.id));
  const busy = useWorkspace((s) => s.busy);
  async function save() {
    try {
      const parsed: unknown = JSON.parse(args);
      if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string"))
        throw new Error("引数には文字列のJSON配列を指定してください。");
      const result = await useWorkspace
        .getState()
        .act({ type: "configureAgent", config: { ...config, command, args: parsed } });
      setMessage(
        result
          ? consented
            ? "保存しました。送信先が変わりうるため、送信の同意は取り消しました。"
            : "保存しました。"
          : "保存に失敗しました。",
      );
    } catch (error) {
      setMessage(String(error));
    }
  }
  return (
    <form
      className="agent-settings"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <AgentConnection agent={config.id} />
      {consented && (
        <div className="settings-save">
          <span className="hint muted">OpenAIへの送信に同意済み（全プロジェクト共通）</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!!busy}
            onClick={() => void useWorkspace.getState().setConsent(config.id, false)}
          >
            同意を取り消す
          </Button>
        </div>
      )}
      <details>
        <summary>詳細な起動設定</summary>
        <label htmlFor={`${config.id}-command`}>実行ファイル</label>
        <Input
          id={`${config.id}-command`}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
        />
        <label htmlFor={`${config.id}-args`}>引数（JSON配列）</label>
        <Textarea id={`${config.id}-args`} value={args} onChange={(e) => setArgs(e.target.value)} />
        <div className="settings-save">
          <output>{message}</output>
          <Button size="sm" type="submit" disabled={!command.trim()}>
            設定を保存
          </Button>
        </div>
        {config.id === "codex" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setCommand("@tanzakoo/managed");
              setArgs("[]");
            }}
          >
            同梱版の設定に戻す
          </Button>
        )}
      </details>
    </form>
  );
}
export function Settings() {
  const agents = useWorkspace((s) => s.snapshot.agents);
  const busy = useWorkspace((s) => s.busy);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="エージェント設定"
          disabled={!native || !!busy}
        >
          <Settings2 />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Codexの接続設定</DialogTitle>
          <DialogDescription>このプロジェクトでCodexを使うための設定です。</DialogDescription>
        </DialogHeader>
        <div className="settings-scroll">
          {agents
            .filter((a) => a.id === "codex")
            .map((a) => (
              <AgentSettings key={`${a.id}-${a.command}-${a.args.join()}`} config={a} />
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
