import { t, setLanguage, useLanguage, type LanguagePreference } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const consented = useWorkspace((s) => s.snapshot.consents.includes(config.id));
  const busy = useWorkspace((s) => s.busy);
  const reviewAccess = useWorkspace((s) => s.reviewAccess);
  return (
    <div className="agent-settings">
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
    </div>
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
          <DialogDescription>{t("表示言語と、ChatGPTの接続を設定します。")}</DialogDescription>
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
