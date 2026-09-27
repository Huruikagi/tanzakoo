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
    if (result) setMessage("保存しました。次の送信から反映します。");
    else setError("保存に失敗しました。もう一度お試しください。");
  }
  return (
    <div className="agent-settings">
      <p className="hint muted">
        現在の設定: {saved?.model ?? "Codexの既定値"} ·{" "}
        {saved?.reasoningEffort
          ? (effortNames[saved.reasoningEffort] ?? saved.reasoningEffort)
          : "会話の既定の推論強度"}
      </p>
      <div className="connection-actions">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => void load(model || null)}
        >
          {busy?.kind === "settings" ? "選択肢を取得中…" : "選択肢を取得"}
        </Button>
        {error && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => void load(null, "")}
          >
            既定のモデルで再取得
          </Button>
        )}
        {busy?.kind === "settings" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void api.cancel().catch((e) => setError(String(e)))}
          >
            取得を中止
          </Button>
        )}
      </div>
      <p className="hint muted">
        サインイン済みのCodexから取得します。この操作では会話やボードの内容は送信しません。
      </p>
      {models && (
        <>
          <label htmlFor={`${id}-model`}>モデル</label>
          <Select value={model} disabled={disabled} onValueChange={(value) => void load(value)}>
            <SelectTrigger id={`${id}-model`} aria-label="モデル" className="w-full">
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
              <label htmlFor={`${id}-effort`}>推論強度</label>
              <Select
                value={effort}
                disabled={disabled}
                onValueChange={(value) => {
                  setEffort(value);
                  setMessage("");
                }}
              >
                <SelectTrigger id={`${id}-effort`} aria-label="推論強度" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {efforts.options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {effortNames[o.value] ?? o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          ) : (
            <p className="hint muted">このモデルでは推論強度を選択できません。</p>
          )}
          <Button type="button" size="sm" disabled={disabled || !valid} onClick={() => void save()}>
            チャット設定を保存
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="chat-error">
          {error}
        </p>
      )}
      {message && <output>{message}</output>}
    </div>
  );
}

export function ChatSettings() {
  const reviewAccess = useWorkspace((s) => s.reviewAccess);
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
          aria-label="モデル・推論強度の設定"
          className="max-w-full"
        >
          <SlidersHorizontal />
          <span className="truncate">
            {reviewAccess?.model ?? settings?.model ?? "モデル・推論強度"}
            {!reviewAccess &&
              settings?.reasoningEffort &&
              ` · ${effortNames[settings.reasoningEffort] ?? settings.reasoningEffort}`}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>モデル・推論強度</DialogTitle>
          <DialogDescription>
            {reviewAccess
              ? "審査用コードに指定されたモデルで接続します。"
              : "このプロジェクトのすべてのCodex会話に、次の送信から反映します。"}
          </DialogDescription>
        </DialogHeader>
        {reviewAccess ? (
          <p>審査用接続では {reviewAccess.model} を使います。通常接続の設定は保持されています。</p>
        ) : (
          <ChatSettingsForm key={JSON.stringify([snapshot.project.id, config])} />
        )}
      </DialogContent>
    </Dialog>
  );
}
