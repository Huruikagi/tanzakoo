import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { FolderOpen, Plus, NotebookPen, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/lib/workspace";
import { native } from "@/lib/api";
import { MarkdownEditor } from "./MarkdownEditor";
import { Markdown } from "./Markdown";
import { ProposalCard, Proposals } from "./Proposals";
import { editDraft } from "@/lib/draft";

export function Projects() {
  const { snapshot, busy, switching, loaded, changeProject } = useWorkspace(
    useShallow((s) => ({
      snapshot: s.snapshot,
      busy: s.busy,
      switching: s.switching,
      loaded: s.loaded,
      changeProject: s.changeProject,
    })),
  );
  const [creating, setCreating] = useState(false);
  const disabled = !native || !loaded || !!busy || switching;
  const pending = snapshot.memoryProposals.filter((p) => p.state === "pending").length;
  return (
    <div
      className="project-controls"
      title={busy ? "AIの応答中はプロジェクトを切り替えられません" : undefined}
    >
      <FolderOpen size={15} aria-hidden="true" />
      <Select
        value={snapshot.project.id}
        disabled={disabled}
        onValueChange={(id) => void changeProject(id)}
      >
        <SelectTrigger aria-label="プロジェクト" size="sm">
          <SelectValue placeholder="プロジェクト" />
        </SelectTrigger>
        <SelectContent>
          {snapshot.projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="新しいプロジェクト"
            disabled={disabled}
          >
            <Plus />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新しいプロジェクト</DialogTitle>
            <DialogDescription>
              ボード・会話・メモリを、このプロジェクト専用に保存します。
            </DialogDescription>
          </DialogHeader>
          <CreateProject onCreated={() => setCreating(false)} />
        </DialogContent>
      </Dialog>
      <Dialog key={snapshot.project.id}>
        <DialogTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            disabled={!native || !loaded || switching}
            aria-label="プロジェクトメモリ"
          >
            <NotebookPen />
            メモリ{pending > 0 && <span className="proposal-count">{pending}</span>}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[740px]">
          <DialogHeader>
            <DialogTitle>プロジェクトメモリ</DialogTitle>
            <DialogDescription>
              目的・制約・進め方など、会話をまたいでAIと共有したい前提を書いておけます。
            </DialogDescription>
          </DialogHeader>
          <ProjectMemory />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateProject({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [memory, setMemory] = useState("");
  const [error, setError] = useState("");
  const { createProject, switching } = useWorkspace(
    useShallow((s) => ({ createProject: s.createProject, switching: s.switching })),
  );
  async function create() {
    if (await createProject(name, memory)) onCreated();
    else setError(useWorkspace.getState().error ?? "作成できませんでした。");
  }
  return (
    <form
      className="project-form"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <label htmlFor="new-project-name">プロジェクト名</label>
      <Input
        id="new-project-name"
        value={name}
        maxLength={200}
        onChange={(e) => setName(e.target.value)}
        disabled={switching}
      />
      <label htmlFor="new-project-memory">プロジェクトメモリ（任意）</label>
      <Textarea
        id="new-project-memory"
        value={memory}
        onChange={(e) => setMemory(e.target.value)}
        disabled={switching}
        placeholder="何を作るか、誰のためか、大切にしたいこと…"
        rows={6}
      />
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={!name.trim() || switching}>
        {switching ? "作成しています…" : "作成して開く"}
      </Button>
    </form>
  );
}

function ProjectMemory() {
  const { snapshot, projectDrafts, act } = useWorkspace(
    useShallow((s) => ({ snapshot: s.snapshot, projectDrafts: s.projectDrafts, act: s.act })),
  );
  const project = snapshot.project;
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const { value, dirty, stale, update, reset } = editDraft(
    { name: project.name, memory: project.memory, revision: project.revision },
    projectDrafts[project.id],
    (next) => {
      useWorkspace.getState().draftProject(project.id, next);
      setMessage("");
    },
  );
  const proposals = snapshot.memoryProposals.filter((p) => p.state === "pending");
  async function save() {
    setSaving(true);
    const result = await act({
      type: "updateProject",
      name: value.name,
      memory: value.memory,
      revision: value.revision,
    });
    if (result) {
      reset();
      setMessage("保存しました。");
    } else setMessage(useWorkspace.getState().error ?? "保存できませんでした。");
    setSaving(false);
  }
  async function resolve(id: string, apply: boolean) {
    setSaving(true);
    const result = await act({ type: "resolveMemoryProposal", id, apply });
    setMessage(
      result
        ? apply
          ? "メモリに適用しました。"
          : "提案を却下しました。"
        : (useWorkspace.getState().error ?? "操作に失敗しました。"),
    );
    setSaving(false);
  }
  return (
    <div className="project-memory-scroll">
      <div className="project-form" inert={saving}>
        <label htmlFor="project-name">プロジェクト名</label>
        <Input
          id="project-name"
          value={value.name}
          maxLength={200}
          onChange={(e) => update({ name: e.target.value })}
        />
        <Tabs defaultValue="edit">
          <TabsList>
            <TabsTrigger value="edit">編集</TabsTrigger>
            <TabsTrigger value="preview">プレビュー</TabsTrigger>
          </TabsList>
          <TabsContent value="edit">
            <MarkdownEditor
              label="プロジェクトメモリ本文"
              value={value.memory}
              onChange={(memory) => update({ memory })}
              onSelection={() => {}}
            />
          </TabsContent>
          <TabsContent value="preview">
            <Markdown>{value.memory || "まだメモリはありません。"}</Markdown>
          </TabsContent>
        </Tabs>
        <div className="project-save">
          <span className="hint muted">
            {dirty && "未保存の変更は、アプリを閉じると失われます"}
          </span>
          <Button size="sm" variant="ghost" disabled={!dirty} onClick={reset}>
            取り消す
          </Button>
          <Button
            size="sm"
            disabled={!dirty || stale || !value.name.trim()}
            onClick={() => void save()}
          >
            <Save />
            保存
          </Button>
        </div>
        {stale && (
          <p role="alert">
            ほかの操作でメモリが更新されました。下書きを控えてから「取り消す」で最新の内容を確認してください。
          </p>
        )}
      </div>
      <output aria-live="polite">{message}</output>
      <Proposals count={proposals.length}>
        {proposals.map((p) => (
          <ProposalCard
            key={p.id}
            reason={p.reason}
            before={<Markdown>{p.beforeMemory || "（空）"}</Markdown>}
            after={<Markdown>{p.memory || "（空）"}</Markdown>}
            outdated={
              p.baseRevision !== project.revision
                ? "提案後にメモリが変わったため適用できません。"
                : null
            }
            dirty={dirty}
            disabled={saving}
            onResolve={(apply) => void resolve(p.id, apply)}
          />
        ))}
      </Proposals>
      <DeleteProject disabled={saving} />
    </div>
  );
}

function DeleteProject({ disabled }: { disabled: boolean }) {
  const { snapshot, busy, switching, deleteProject } = useWorkspace(
    useShallow((s) => ({
      snapshot: s.snapshot,
      busy: s.busy,
      switching: s.switching,
      deleteProject: s.deleteProject,
    })),
  );
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const blocked = disabled || !!busy || switching;
  async function remove() {
    setError("");
    if (!(await deleteProject(snapshot.project.id))) {
      setError(useWorkspace.getState().error ?? "処理が終わってから削除してください。");
    }
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
      <div className="mt-6 border-t pt-4">
        <DialogTrigger asChild>
          <Button variant="destructive" size="sm" disabled={blocked}>
            <Trash2 />
            プロジェクトを削除
          </Button>
        </DialogTrigger>
        {busy && <p className="hint muted">AIの処理が終わってから削除できます。</p>}
      </div>
      <DialogContent showCloseButton={!switching}>
        <DialogHeader>
          <DialogTitle>「{snapshot.project.name}」を削除しますか？</DialogTitle>
          <DialogDescription>
            このプロジェクトのカード・会話・メモリ・変更提案と未保存の下書きを削除します。元に戻せません。
            {snapshot.projects.length === 1
              ? "削除後は空のプロジェクトを開きます。"
              : "削除後は別のプロジェクトを開きます。"}
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={switching} onClick={() => setOpen(false)}>
            キャンセル
          </Button>
          <Button variant="destructive" disabled={blocked} onClick={() => void remove()}>
            {switching ? "削除しています…" : "削除する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
