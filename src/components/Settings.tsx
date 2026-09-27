import { t, systemMessage, setLanguage, useLanguage, type LanguagePreference } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
function AgentSettings({ config }: { config: AgentConfig }) {
  useTranslation();
  const [command, setCommand] = useState(config.command);
  const [args, setArgs] = useState(JSON.stringify(config.args, null, 2));
  const [message, setMessage] = useState("");
  const consented = useWorkspace((s) => s.snapshot.consents.includes(config.id));
  const busy = useWorkspace((s) => s.busy);
  const reviewAccess = useWorkspace((s) => s.reviewAccess);
  async function save() {
    try {
      const parsed: unknown = JSON.parse(args);
      if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string"))
        throw new Error(t("引数には文字列のJSON配列を指定してください。"));
      const result = await useWorkspace
        .getState()
        .act({ type: "configureAgent", config: { ...config, command, args: parsed } });
      setMessage(
        result
          ? consented
            ? t("保存しました。送信先が変わりうるため、送信の同意は取り消しました。")
            : t("保存しました。")
          : t("保存に失敗しました。"),
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
      {consented && !reviewAccess && (
        <div className="settings-save">
          <span className="hint muted">{t("OpenAIへの送信に同意済み（全プロジェクト共通）")}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!!busy}
            onClick={() => void useWorkspace.getState().setConsent(config.id, false)}
          >
            {t("同意を取り消す")}
          </Button>
        </div>
      )}
      {!reviewAccess && (
        <details>
          <summary>{t("詳細な起動設定")}</summary>
          <label htmlFor={`${config.id}-command`}>{t("実行ファイル")}</label>
          <Input
            id={`${config.id}-command`}
            value={command}
            disabled={!!busy}
            onChange={(e) => setCommand(e.target.value)}
          />
          <label htmlFor={`${config.id}-args`}>{t("引数（JSON配列）")}</label>
          <Textarea
            id={`${config.id}-args`}
            value={args}
            disabled={!!busy}
            onChange={(e) => setArgs(e.target.value)}
          />
          <div className="settings-save">
            <output>{systemMessage(message)}</output>
            <Button size="sm" type="submit" disabled={!!busy || !command.trim()}>
              {t("設定を保存")}
            </Button>
          </div>
          {config.id === "codex" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!!busy}
              onClick={() => {
                setCommand("@tanzakoo/managed");
                setArgs("[]");
              }}
            >
              {t("同梱版の設定に戻す")}
            </Button>
          )}
        </details>
      )}
    </form>
  );
}
export function Settings() {
  useTranslation();
  const agents = useWorkspace((s) => s.snapshot.agents);
  const preference = useLanguage((s) => s.preference);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={t("エージェント設定")}>
          <Settings2 />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("設定")}</DialogTitle>
          <DialogDescription>
            {t("表示言語と、このプロジェクトのCodex接続を設定します。")}
          </DialogDescription>
        </DialogHeader>
        <div className="settings-scroll">
          <label htmlFor="display-language">{t("表示言語")}</label>
          <Select
            value={preference}
            onValueChange={(value) => setLanguage(value as LanguagePreference)}
          >
            <SelectTrigger id="display-language" aria-label={t("表示言語")} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t("システムに合わせる")}</SelectItem>
              <SelectItem value="ja">日本語</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
          <fieldset disabled={!native}>
            {agents
              .filter((a) => a.id === "codex")
              .map((a) => (
                <AgentSettings key={`${a.id}-${a.command}-${a.args.join()}`} config={a} />
              ))}
          </fieldset>
        </div>
      </DialogContent>
    </Dialog>
  );
}
