import { useState } from "react";
import { FolderOpen, Plus, NotebookPen, Save } from "lucide-react";
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
  const { snapshot, busy, switching, loaded, changeProject } = useWorkspace();
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
  const { createProject, switching } = useWorkspace();
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
  const { snapshot, projectDrafts, act } = useWorkspace();
  const project = snapshot.project;
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const { value, dirty, stale, update, reset } = editDraft(
    { name: project.name, memory: project.memory, revision: project.revision },
    projectDrafts[project.id],
    (next) => {
      useWorkspace.setState((s) => {
        const drafts = { ...s.projectDrafts };
        if (next) drafts[project.id] = next;
        else delete drafts[project.id];
        return { projectDrafts: drafts };
      });
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
    </div>
  );
}
