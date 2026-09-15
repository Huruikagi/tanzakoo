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
function AgentSettings({ config }: { config: AgentConfig }) {
  const [command, setCommand] = useState(config.command);
  const [args, setArgs] = useState(JSON.stringify(config.args, null, 2));
  const [message, setMessage] = useState("");
  async function save() {
    try {
      const parsed: unknown = JSON.parse(args);
      if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string"))
        throw new Error("引数には文字列のJSON配列を指定してください。");
      const result = await useWorkspace
        .getState()
        .act({ type: "configureAgent", config: { ...config, command, args: parsed } });
      setMessage(result ? "保存しました。次の送信から使用します。" : "保存に失敗しました。");
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
      <h3>{config.id === "claude" ? "Claude" : "Codex"}</h3>
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
          <DialogTitle>エージェントの接続設定</DialogTitle>
          <DialogDescription>
            ログイン済みのCodex／ClaudeをACPアダプター経由で使います。会話・ボード・参照した内容は、選んだエージェントに送られます。
          </DialogDescription>
        </DialogHeader>
        <div className="settings-scroll">
          <p className="hint muted">
            通常は既定値のまま使えます。起動できない場合はNodeの実行ファイルを絶対パスで指定してください。
          </p>
          {agents.map((a) => (
            <AgentSettings key={`${a.id}-${a.command}-${a.args.join()}`} config={a} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
