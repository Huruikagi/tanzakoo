import { t, currentLocale, systemMessage } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, native } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

export function ReviewAccess() {
  useTranslation();
  const access = useWorkspace((s) => s.reviewAccess);
  const error = useWorkspace((s) => s.reviewError);
  const busy = useWorkspace((s) => s.busy);
  const switching = useWorkspace((s) => s.switching);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [consent, setConsent] = useState(false);
  const id = useId();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const disabled = !native || !!busy || switching;
  const connecting = busy?.kind === "connecting";

  async function connect() {
    if (disabled || !consent || !code.trim()) return;
    const ok = await useWorkspace.getState().reviewConnect("connect", code.trim(), consent);
    if (ok) {
      setCode("");
      setConsent(false);
      setOpen(false);
    }
  }
  return (
    <div className="agent-settings review-access">
      {access && (
        <>
          <strong>{t("審査用接続")}</strong>
          <p className="hint">
            {t("有効期限: {{value0}}", {
              value0: new Date(access.expiresAt).toLocaleString(currentLocale()),
            })}
            <br />
            {t("モデル: {{value0}}", { value0: access.model })}
          </p>
          <p className="hint muted">
            {t(
              "仲介サーバーとOpenAIへの送信に同意済み（起動中・全プロジェクト共通）。接続を解除すると同意も取り消されます。",
            )}
          </p>
          {access.expiresAt <= now && (
            <p role="alert">{t("有効期限が切れています。新しいコードを入力してください。")}</p>
          )}
          <div className="connection-actions">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => void useWorkspace.getState().reviewConnect("check")}
            >
              {t("接続を確認")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => void useWorkspace.getState().reviewConnect("disconnect")}
            >
              {t("通常の接続に戻す")}
            </Button>
          </div>
        </>
      )}
      {!open ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          {access ? t("新しい審査用コードを入力") : t("審査用アクセスを利用する")}
        </Button>
      ) : (
        <div className="agent-settings">
          <label htmlFor={`${id}-code`}>{t("審査用コード")}</label>
          <Input
            id={`${id}-code`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            maxLength={80}
            value={code}
            disabled={disabled}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void connect();
              }
            }}
          />
          <p className="hint">
            {t(
              "審査員向けの接続です。会話を送ると、ボード・プロジェクトメモリ・会話と、登録した参照資料のうちAIが読む箇所を、Tanzakooの仲介サーバー経由でOpenAIへ送信します。審査用AIの費用は提供者が負担します。",
            )}
          </p>
          <p className="hint muted">
            {t(
              "接続確認ではプロジェクトの内容を送りません。コードは起動中だけ保持し、アプリを終了すると再入力が必要です。切り替え後は新しい会話から始めます。カードや過去の会話は残ります。",
            )}
          </p>
          <label className="hint" htmlFor={`${id}-consent`}>
            <input
              id={`${id}-consent`}
              type="checkbox"
              checked={consent}
              disabled={disabled}
              onChange={(e) => setConsent(e.target.checked)}
            />
            {t("仲介サーバーとOpenAIへの送信に同意する")}
          </label>
          <div className="connection-actions">
            <Button
              type="button"
              size="sm"
              disabled={disabled || !consent || !code.trim()}
              onClick={() => void connect()}
            >
              {t("同意して接続する")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                setCode("");
                setConsent(false);
                setOpen(false);
              }}
            >
              {t("閉じる")}
            </Button>
          </div>
        </div>
      )}
      {connecting && (open || access) && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() =>
            void api.cancel().catch((e) => useWorkspace.setState({ reviewError: String(e) }))
          }
        >
          {t("接続処理を中止")}
        </Button>
      )}
      {error && <p role="alert">{systemMessage(error)}</p>}
    </div>
  );
}
