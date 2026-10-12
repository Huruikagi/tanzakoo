import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, native } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { NotificationMode } from "@/bindings/NotificationMode";
import type { NotificationSettings as Settings } from "@/bindings/NotificationSettings";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function NotificationSettings() {
  useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const refresh = () => {
      void api
        .notificationSettings()
        .then((value) => {
          if (!disposed) {
            setSettings(value);
          }
        })
        .catch(() => {
          if (!disposed) setError(true);
        });
    };
    // Re-check after returning from OS settings, without asking for permission.
    if (!busy) refresh();
    if (!busy) window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      window.removeEventListener("focus", refresh);
    };
  }, [busy]);

  const configure = async (mode: NotificationMode) => {
    setBusy(true);
    setError(false);
    setSent(false);
    try {
      setSettings(await api.configureNotifications(mode));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    setError(false);
    setSent(false);
    try {
      const permission = await api.testNotification();
      setSettings((previous) => previous && { ...previous, permission });
      setSent(permission === "granted" || permission === "unknown");
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="connection-stack">
      <label htmlFor="completion-notifications">{t("AIの応答完了通知")}</label>
      <Select
        value={settings?.mode ?? "inactive"}
        disabled={!native || !settings || busy}
        onValueChange={(value) => void configure(value as NotificationMode)}
      >
        <SelectTrigger
          id="completion-notifications"
          aria-label={t("AIの応答完了通知")}
          className="w-full"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="never">{t("通知しない")}</SelectItem>
          <SelectItem value="inactive">{t("非アクティブ時のみ")}</SelectItem>
          <SelectItem value="always">{t("常に通知する")}</SelectItem>
        </SelectContent>
      </Select>
      <p className="muted">
        {t("全プロジェクト共通です。非アクティブ時は、別のアプリを操作中や最小化中に通知します。")}
      </p>
      {settings?.permission === "notDetermined" && settings.mode !== "never" && (
        <>
          <p className="muted">{t("通知するには、OSの通知許可が必要です。")}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void configure(settings.mode)}
          >
            {t("通知を許可する")}
          </Button>
        </>
      )}
      {settings?.permission === "denied" && (
        <output>
          {t("OSで通知が無効になっています。システム設定の「通知」でTanzakooを許可してください。")}
        </output>
      )}
      {!native && <p className="muted">{t("デスクトップ通知はWindows・Mac版で利用できます。")}</p>}
      {native && settings?.permission === "unavailable" && (
        <p className="muted">
          {t("この環境では通知を利用できません。Macではインストールしたアプリからお試しください。")}
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={!native || !settings || busy || settings.permission === "unavailable"}
        onClick={() => void test()}
      >
        {t("テスト通知を送る")}
      </Button>
      <p className="muted">{t("OSの集中モードなどにより表示されないことがあります。")}</p>
      {sent && <output>{t("テスト通知をOSへ送りました。")}</output>}
      {error && (
        <p role="alert">
          {t("通知の設定・送信に失敗しました。設定画面を開き直して再試行してください。")}
        </p>
      )}
    </div>
  );
}
