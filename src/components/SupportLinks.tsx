import { useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "@tauri-apps/api/core";
import { currentLocale, t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

const base = "https://huruikagi.github.io/tanzakoo/";

export function SupportLinks() {
  useTranslation();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const open = async (url: string) => {
    setFailedUrl(null);
    try {
      if (isTauri()) await openUrl(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setFailedUrl(url);
    }
  };
  return (
    <section className="connection-stack" aria-label={t("サポートとプライバシー")}>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void open(`${base}privacy-${currentLocale()}.html`)}
        >
          {t("プライバシーポリシー")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void open(`${base}support.html`)}>
          {t("サポート")}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t("標準ブラウザーで開きます。")}</p>
      {failedUrl && (
        <p role="alert" className="text-sm break-all">
          {t("ブラウザーを開けませんでした。次のURLをコピーして開いてください。")} {failedUrl}
        </p>
      )}
    </section>
  );
}
