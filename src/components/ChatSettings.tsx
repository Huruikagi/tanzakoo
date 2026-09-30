import { t, systemMessage } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useId, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, native } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import type { ChatOption } from "@/bindings/ChatOption";

const effortNames: Record<string, string> = {
  none: "なし",
  minimal: "最小",
  low: "低",
  medium: "標準",
  high: "高",
  xhigh: "非常に高",
  max: "最大",
  ultra: "Ultra",
};

function ChatSettingsForm() {
  useTranslation();
  const saved = useWorkspace((s) => s.snapshot.chatSettings);
  const busy = useWorkspace((s) => s.busy);
  const switching = useWorkspace((s) => s.switching);
  const [options, setOptions] = useState<ChatOption[] | null>(null);
  const [model, setModel] = useState(saved?.model ?? "");
  const [effort, setEffort] = useState(saved?.reasoningEffort ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const id = useId();
  const models = options?.find((o) => o.id === "model");
  const efforts = options?.find((o) => o.id === "reasoning_effort");
  const disabled = !!busy || switching || saving || !native;
  const valid =
    models?.options.some((o) => o.value === model) &&
    (!efforts || efforts.options.some((o) => o.value === effort));

  async function load(nextModel: string | null, preferredEffort = effort) {
    setError("");
    setMessage("");
    try {
      const result = await useWorkspace.getState().loadChatOptions(nextModel);
      const nextModels = result.find((o) => o.id === "model");
      const nextEfforts = result.find((o) => o.id === "reasoning_effort");
      setOptions(result);
      setModel(nextModels?.currentValue ?? "");
      setEffort(
        nextEfforts?.options.some((o) => o.value === preferredEffort)
          ? preferredEffort
          : (nextEfforts?.currentValue ?? ""),
      );
    } catch (e) {
      setOptions(null);
      setError(String(e));
    }
  }
  async function save() {
    if (disabled || !valid) return;
    setSaving(true);
    setError("");
    setMessage("");
    const result = await useWorkspace.getState().act({
      type: "configureChat",
      settings: { model, reasoningEffort: efforts ? effort : null },
    });
    setSaving(false);
    if (result) setMessage(t("保存しました。次の送信から反映します。"));
    else setError(t("保存に失敗しました。もう一度お試しください。"));
  }
  return (
    <div className="agent-settings">
      <p className="hint muted">
        {t("現在の設定: {{value0}} · {{value1}}", {
          value0: saved?.model ?? t("接続先の既定値"),
          value1: saved?.reasoningEffort
            ? t(effortNames[saved.reasoningEffort] ?? saved.reasoningEffort)
            : t("会話の既定の推論強度"),
        })}
      </p>
      <div className="connection-actions">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => void load(model || null)}
        >
          {busy?.kind === "settings" ? t("選択肢を取得中…") : t("選択肢を取得")}
        </Button>
        {error && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => void load(null, "")}
          >
            {t("既定のモデルで再取得")}
          </Button>
        )}
        {busy?.kind === "settings" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void api.cancel().catch((e) => setError(String(e)))}
          >
            {t("取得を中止")}
          </Button>
        )}
      </div>
      <p className="hint muted">
        {t("ChatGPTプランで利用できるモデルを取得します。会話やボードの内容は送信しません。")}
      </p>
      {models && (
        <>
          <label htmlFor={`${id}-model`}>{t("モデル")}</label>
          <Select value={model} disabled={disabled} onValueChange={(value) => void load(value)}>
            <SelectTrigger id={`${id}-model`} aria-label={t("モデル")} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {models.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {efforts ? (
            <>
              <label htmlFor={`${id}-effort`}>{t("推論強度")}</label>
              <Select
                value={effort}
                disabled={disabled}
                onValueChange={(value) => {
                  setEffort(value);
                  setMessage("");
                }}
              >
                <SelectTrigger id={`${id}-effort`} aria-label={t("推論強度")} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {efforts.options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {t(effortNames[o.value] ?? o.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          ) : (
            <p className="hint muted">
              {t("この接続では推論強度の選択肢を確認できないため、既定値を使います。")}
            </p>
          )}
          <Button type="button" size="sm" disabled={disabled || !valid} onClick={() => void save()}>
            {t("チャット設定を保存")}
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="chat-error">
          {systemMessage(error)}
        </p>
      )}
      {message && <output>{systemMessage(message)}</output>}
    </div>
  );
}

export function ChatSettings() {
  useTranslation();
  const reviewAccess = useWorkspace((s) => s.reviewAccess);
  const accountId = useWorkspace((s) => s.planStatus?.active?.id);
  const snapshot = useWorkspace((s) => s.snapshot);
  const busy = useWorkspace((s) => s.busy);
  const switching = useWorkspace((s) => s.switching);
  const config = snapshot.agents.find((a) => a.id === "codex");
  const settings = snapshot.chatSettings;
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && useWorkspace.getState().busy?.kind === "settings") {
          void api.cancel().catch((error) => useWorkspace.setState({ chatError: String(error) }));
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!native || !!busy || switching}
          aria-label={t("モデル・推論強度の設定")}
          className="max-w-full"
        >
          <SlidersHorizontal />
          <span className="truncate">
            {reviewAccess?.model ?? settings?.model ?? t("モデル・推論強度")}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("モデル・推論強度")}</DialogTitle>
          <DialogDescription>
            {reviewAccess
              ? t("審査用コードに指定されたモデルで接続します。")
              : t("このプロジェクトのすべてのAI会話に、次の送信から反映します。")}
          </DialogDescription>
        </DialogHeader>
        {reviewAccess ? (
          <p>
            {t("審査用接続では {{value0}} を使います。通常接続の設定は保持されています。", {
              value0: reviewAccess.model,
            })}
          </p>
        ) : (
          <ChatSettingsForm key={JSON.stringify([snapshot.project.id, config, accountId])} />
        )}
      </DialogContent>
    </Dialog>
  );
}
