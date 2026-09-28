import { t, systemMessage } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { CircleCheck, Download, Folder, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api, native } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import type { ExportResult } from "@/bindings/ExportResult";

export function ExportDecisions() {
  useTranslation();
  const snapshot = useWorkspace((s) => s.snapshot);
  const loaded = useWorkspace((s) => s.loaded);
  const switching = useWorkspace((s) => s.switching);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ExportResult | "canceled" | null>(null);
  const completed = result && result !== "canceled" ? result : null;
  const doneButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (completed) doneButton.current?.focus();
  }, [completed]);
  const [error, setError] = useState("");
  const cards = snapshot.cards.filter((card) => !card.deleted && card.status === "decided");
  async function exportFiles() {
    if (saving) return;
    setSaving(true);
    setResult(null);
    setError("");
    try {
      const result = await api.exportDecisions(snapshot.project.id);
      setResult(result ?? "canceled");
    } catch (error) {
      setError(String(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) {
          setOpen(next);
          setResult(null);
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" disabled={!native || !loaded || switching}>
          <Download />
          {t("エクスポート")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>
            {completed ? t("エクスポートが完了しました") : t("決めたことをMarkdownに出力")}
          </DialogTitle>
          <DialogDescription>
            {completed
              ? t("出力したフォルダーを、開発の入力として使えます。")
              : t("{{value0}}の決定事項を、アプリ開発の入力として渡せるファイル群にします。", {
                  value0: snapshot.project.name,
                })}
          </DialogDescription>
        </DialogHeader>
        {!completed && (
          <>
            <p>
              {t("「決めたこと」のカード {{value0}}件と、プロジェクトメモリを出力します。", {
                value0: cards.length,
              })}
            </p>
            <ul className="list-disc pl-5">
              <li>{t("index.md — 読み方と決定事項の一覧")}</li>
              <li>{t("project.md — プロジェクトの背景・前提")}</li>
              <li>{t("decisions/ — 1つの話題につき1つのMarkdown")}</li>
            </ul>
            <p className="hint muted">
              {t(
                "カードリンクは出力先ファイルへのMarkdownリンクに変換します。出力対象外の参照先は、理由を添えた文字として残します。",
              )}
            </p>
            <p className="hint muted">
              {t(
                "保存済みの内容を出力します。編集中の内容は先に保存してください。未適用の提案や会話履歴は含みません。 選択した保存先の中に、新しいフォルダーを作成します。",
              )}
            </p>
            {cards.length === 0 && <p>{t("決定した話題を「決めたこと」に移すと出力できます。")}</p>}
            {error && (
              <p role="alert" className="break-all">
                {systemMessage(error)}
              </p>
            )}
          </>
        )}
        <output aria-live="polite" aria-atomic="true">
          {completed ? (
            <span className="flex flex-col items-center gap-5 py-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300">
              <span className="flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <CircleCheck className="size-9" aria-hidden="true" />
              </span>
              <span className="text-center text-base font-medium">
                {t("{{value0}}件の決定事項を出力しました。", { value0: completed.cardCount })}
              </span>
              <span className="w-full min-w-0 rounded-lg border bg-muted/50 p-3">
                <span className="mb-2 flex items-center gap-2 text-muted-foreground">
                  <Folder className="size-4" aria-hidden="true" />
                  {t("保存先")}
                </span>
                <span className="block max-h-32 overflow-y-auto break-all select-text">
                  {completed.path}
                </span>
              </span>
            </span>
          ) : result === "canceled" ? (
            t("出力をキャンセルしました。")
          ) : null}
        </output>
        {completed ? (
          <DialogClose asChild>
            <Button ref={doneButton}>{t("完了")}</Button>
          </DialogClose>
        ) : (
          <Button
            disabled={saving || cards.length === 0 || switching}
            onClick={() => void exportFiles()}
          >
            {saving ? (
              <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <Download />
            )}
            {saving ? t("出力しています…") : t("保存先を選んで出力")}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
