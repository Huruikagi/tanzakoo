import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api, native } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

export function ExportDecisions() {
  const snapshot = useWorkspace((s) => s.snapshot);
  const loaded = useWorkspace((s) => s.loaded);
  const switching = useWorkspace((s) => s.switching);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const cards = snapshot.cards.filter((card) => !card.deleted && card.status === "decided");
  async function exportFiles() {
    if (saving) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const result = await api.exportDecisions(snapshot.project.id);
      setMessage(
        result
          ? `${result.cardCount}件の決定事項を出力しました。保存先: ${result.path}`
          : "出力をキャンセルしました。",
      );
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
          setMessage("");
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" disabled={!native || !loaded || switching}>
          <Download />
          エクスポート
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>決めたことをMarkdownに出力</DialogTitle>
          <DialogDescription>
            {snapshot.project.name}の決定事項を、アプリ開発の入力として渡せるファイル群にします。
          </DialogDescription>
        </DialogHeader>
        <p>「決めたこと」のカード {cards.length}件と、プロジェクトメモリを出力します。</p>
        <ul className="list-disc pl-5">
          <li>README.md — 読み方と決定事項の一覧</li>
          <li>project.md — プロジェクトの背景・前提</li>
          <li>decisions/ — 1つの話題につき1つのMarkdown</li>
        </ul>
        <p className="hint muted">
          保存済みの内容を出力します。編集中の内容は先に保存してください。未適用の提案や会話履歴は含みません。
          選択した保存先の中に、新しいフォルダーを作成します。
        </p>
        {cards.length === 0 && <p>決定した話題を「決めたこと」に移すと出力できます。</p>}
        {error && (
          <p role="alert" className="break-all">
            {error}
          </p>
        )}
        <output aria-live="polite" className="break-all">
          {message}
        </output>
        <Button
          disabled={saving || cards.length === 0 || switching}
          onClick={() => void exportFiles()}
        >
          <Download />
          {saving ? "出力しています…" : "保存先を選んで出力"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
