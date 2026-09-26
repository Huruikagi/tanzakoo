import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { FileText, FolderOpen, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { native } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

function displayPath(path: string) {
  return path.replace(/^\\\\\?\\UNC\\/, "\\\\").replace(/^\\\\\?\\/, "");
}

export function ReferenceMaterials() {
  const { snapshot, busy, switching, loaded, updateMaterials } = useWorkspace(
    useShallow((s) => ({
      snapshot: s.snapshot,
      busy: s.busy,
      switching: s.switching,
      loaded: s.loaded,
      updateMaterials: s.updateMaterials,
    })),
  );
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const materials = snapshot.materials ?? [];
  const disabled = !native || !loaded || !!busy || switching;
  async function change(value: { kind: "file" | "folder" } | { remove: string }) {
    setError("");
    if (!(await updateMaterials(value)))
      setError(useWorkspace.getState().error ?? "参照資料を更新できませんでした。");
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!switching) {
          setOpen(next);
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" disabled={!native || !loaded || switching}>
          <BookOpen />
          参照資料
          {materials.length > 0 && <span className="proposal-count">{materials.length}</span>}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[640px]" showCloseButton={!switching}>
        <DialogHeader>
          <DialogTitle>参照資料</DialogTitle>
          <DialogDescription>
            {snapshot.project.name}
            の壁打ちで、AIが読み取れるソースコードやMarkdownを登録します。編集やコマンド実行はできません。
          </DialogDescription>
        </DialogHeader>
        <p className="hint muted">
          会話に必要な箇所を読む際、その内容がOpenAIへ送信されます。登録だけでは送信しません。元ファイルの変更は次の読み取りに反映されます。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || materials.length >= 32}
            onClick={() => void change({ kind: "file" })}
          >
            <FileText />
            ファイルを追加
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || materials.length >= 32}
            onClick={() => void change({ kind: "folder" })}
          >
            <FolderOpen />
            フォルダーを追加
          </Button>
        </div>
        {materials.length === 0 ? (
          <p className="muted">参照資料はまだありません。</p>
        ) : (
          <ul className="max-h-64 space-y-2 overflow-y-auto" aria-label="登録済みの参照資料">
            {materials.map((material) => (
              <li key={material.id} className="flex items-start gap-2 rounded-md border p-3">
                {material.kind === "folder" ? (
                  <FolderOpen size={16} aria-hidden="true" />
                ) : (
                  <FileText size={16} aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="break-all text-sm">{displayPath(material.path)}</p>
                  <p className="hint muted">
                    {material.kind === "folder"
                      ? "フォルダー配下・読み取り専用"
                      : "このファイルのみ・読み取り専用"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={`${displayPath(material.path)}の参照を解除`}
                  onClick={() => void change({ remove: material.id })}
                >
                  解除
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="hint muted">
          UTF-8のテキスト（1ファイル1MiB以下）に対応します。.git・node_modules・ビルド成果物・.env・秘密鍵・リンクなどは対象外です。
        </p>
        <p className="hint muted">
          登録はこのプロジェクトで次の会話にも引き継ぎます。解除しても元ファイルは消えず、過去の会話に渡した内容は残ります。
        </p>
        {busy && (
          <p className="hint muted">AIの処理を停止するか、完了を待つと追加・解除できます。</p>
        )}
        {switching && <output>参照資料を更新しています…</output>}
        {error && (
          <p role="alert" className="break-all">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
