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

export function Projects() {
  const { snapshot, busy, switching, loaded, changeProject } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const disabled = !native || !loaded || !!busy || switching;
  const pending = snapshot.memoryProposals.filter((p) => p.state === "pending").length;
  return (
    <div className="project-controls">
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
              概要・目的・制約・進め方など、新しい会話でも引き継ぐ前提を残せます。送信時に、選んだエージェントへ渡します。
            </DialogDescription>
          </DialogHeader>
          <ProjectMemory />
        </DialogContent>
      </Dialog>
      {!!busy && <span className="hint muted">切り替えは応答終了・停止後に</span>}
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
  const value = projectDrafts[project.id] ?? project;
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = value.name !== project.name || value.memory !== project.memory;
  const stale = dirty && value.revision !== project.revision;
  const proposals = snapshot.memoryProposals.filter((p) => p.state === "pending");
  function update(fields: Partial<typeof value>) {
    const next = { ...value, ...fields };
    if (next.name === project.name && next.memory === project.memory) {
      reset();
      setMessage("");
      return;
    }
    useWorkspace.setState((s) => ({
      projectDrafts: { ...s.projectDrafts, [project.id]: next },
    }));
    setMessage("");
  }
  function reset() {
    useWorkspace.setState((s) => {
      const next = { ...s.projectDrafts };
      delete next[project.id];
      return { projectDrafts: next };
    });
  }
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
      setMessage("保存しました。次の送信から反映します。");
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
            rev. {project.revision} · {dirty ? "未保存" : "保存済み"}
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
            メモリが更新されています。下書きを控えてから「取り消す」で最新の内容を確認してください。
          </p>
        )}
        <p className="hint muted">
          下書きはプロジェクトを切り替えても保持します。アプリを閉じる前に保存してください。
        </p>
      </div>
      <output aria-live="polite">{message}</output>
      <section className="memory-proposals">
        <h3>エージェントの変更提案 · {proposals.length}</h3>
        {proposals.length === 0 && (
          <p className="hint muted">AIからの提案は、ここで確認して適用できます。</p>
        )}
        {proposals.map((p) => (
          <article key={p.id} className="memory-proposal">
            <p>{p.reason}</p>
            <details>
              <summary>変更前 · rev. {p.baseRevision}</summary>
              <Markdown>{p.beforeMemory || "（空）"}</Markdown>
            </details>
            <h4>変更案</h4>
            <Markdown>{p.memory || "（空）"}</Markdown>
            {p.baseRevision !== project.revision && (
              <p className="hint">提案後に内容が変わっています。再提案を依頼してください。</p>
            )}
            {dirty && <p className="hint">下書きを保存するか取り消してから適用してください。</p>}
            <div className="project-save">
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => void resolve(p.id, false)}
              >
                却下
              </Button>
              <Button
                size="sm"
                disabled={saving || dirty || p.baseRevision !== project.revision}
                onClick={() => void resolve(p.id, true)}
              >
                適用する
              </Button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
