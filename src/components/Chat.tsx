import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, Plus, MessageCircle, X, Paperclip, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace";
import { agentUnavailable, api, native } from "@/lib/api";
import { Markdown } from "./Markdown";
import { AgentConnection } from "./AgentConnection";

export function Chat() {
  const {
    snapshot,
    conversation,
    busy,
    stream,
    activity,
    references,
    permissions,
    send,
    answer,
    chatError,
    consents,
  } = useWorkspace();
  const agent = "codex";
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const key = `${snapshot.project.id}:${conversation ?? "new"}`;
  const text = drafts[key] ?? "";
  const setText = (value: string) => setDrafts((previous) => ({ ...previous, [key]: value }));
  const end = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const active = snapshot.conversations.find((c) => c.id === conversation);
  const selectedAgent = active?.agent ?? agent;
  const consentKey = `${snapshot.project.id}:${selectedAgent}`;
  const unavailable = agentUnavailable(snapshot, selectedAgent);
  const messages = snapshot.messages.filter((m) => m.conversationId === conversation);
  const isThisBusy = busy !== null && (busy === conversation || busy === "starting");
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, stream, permissions.length]);
  function submit() {
    if (!text.trim() || busy || !native || unavailable || !consents[consentKey]) return;
    const pending = text;
    setText("");
    void send(pending, agent).then((ok) => {
      if (!ok)
        setDrafts((previous) => ({
          ...previous,
          [`${snapshot.project.id}:${useWorkspace.getState().conversation ?? "new"}`]:
            previous[`${snapshot.project.id}:${useWorkspace.getState().conversation ?? "new"}`] ||
            pending,
        }));
    });
  }
  return (
    <section className="chat-pane">
      <div className="pane-heading">
        <MessageCircle size={16} />
        <h2>壁打ち</h2>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="チャットを閉じる"
          onClick={() => useWorkspace.getState().setChatOpen(false)}
        >
          <X />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="新しい会話"
          disabled={!!busy || !native}
          onClick={() => {
            useWorkspace.setState({ conversation: null, references: [] });
          }}
        >
          <Plus />
        </Button>
      </div>
      <div className="chat-selector">
        {active ? (
          <>
            <span className="agent-avatar">{active.agent === "claude" ? "✳" : "◎"}</span>
            <Select
              value={conversation!}
              disabled={!!busy}
              onValueChange={(id) => useWorkspace.setState({ conversation: id, references: [] })}
            >
              <SelectTrigger size="sm" aria-label="会話履歴">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...snapshot.conversations].reverse().map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.agent === "claude" ? "Claude" : "Codex"} · {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : (
          <>
            <span className="agent-avatar">◎</span>
            <span>Codex</span>
            {snapshot.conversations.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  useWorkspace.setState({ conversation: snapshot.conversations.at(-1)!.id })
                }
              >
                履歴へ
              </Button>
            )}
          </>
        )}
      </div>
      <div className="chat-history" aria-label="会話メッセージ">
        <AgentConnection agent={selectedAgent} hideWhenReady />
        {chatError && (
          <p className="chat-error" role="alert">
            {chatError}
          </p>
        )}
        {messages.length === 0 && !isThisBusy && !unavailable && (
          <div className="chat-welcome">
            <p>作りたいものを、曖昧なままで話してください。論点はカードにしていきます。</p>
            <button
              className="suggestion"
              disabled={!native}
              onClick={() =>
                setText("個人用のTODOアプリを作りたい。まだぼんやりしているので、一緒に考えて。")
              }
            >
              個人用のTODOアプリを作りたい
              <ChevronRight size={14} />
            </button>
            <button
              className="suggestion"
              disabled={!native}
              onClick={() => setText("アイデアを整理したい。まず何から話そう？")}
            >
              アイデアを整理するところから
              <ChevronRight size={14} />
            </button>
          </div>
        )}
        {messages.map((m) => (
          <article key={m.id} className={`message message-${m.role}`}>
            <div className="message-label">
              {m.role === "user"
                ? "あなた"
                : m.role === "error"
                  ? "エラー"
                  : active?.agent === "claude"
                    ? "Claude"
                    : "Codex"}
            </div>
            {m.references.length > 0 && (
              <div className="message-references">
                {m.references.map((r, index) => (
                  <button
                    key={index}
                    className="reference-chip"
                    title={r.quote || r.title}
                    onClick={() => useWorkspace.getState().select(r.cardId)}
                  >
                    <Paperclip size={11} />
                    {r.title}
                    {r.quote && " · 引用"}
                  </button>
                ))}
              </div>
            )}
            <Markdown>{m.text}</Markdown>
          </article>
        ))}
        {isThisBusy && (
          <article className="message message-assistant">
            <div className="message-label">
              {active?.agent === "claude" ? "Claude" : "Codex"}
              <span className="thinking-dot" />
            </div>
            {stream ? <Markdown>{stream}</Markdown> : <p className="muted">{activity}</p>}
          </article>
        )}
        {isThisBusy &&
          permissions.map((p) => (
            <div className="permission" key={p.id}>
              <strong>
                {active?.agent === "claude" ? "Claude" : "Codex"}が操作の許可を求めています
              </strong>
              <p>{p.title}</p>
              <details>
                <summary>操作の詳細</summary>
                <pre>{JSON.stringify(p.request.toolCall, null, 2)}</pre>
              </details>
              <div className="permission-actions">
                {p.request.options.map((option) => (
                  <Button
                    key={option.optionId}
                    variant={option.kind.startsWith("reject") ? "outline" : "secondary"}
                    size="sm"
                    onClick={() => void answer(p.id, option.optionId)}
                  >
                    {option.name}
                  </Button>
                ))}
                <Button variant="ghost" size="sm" onClick={() => void answer(p.id, null)}>
                  キャンセル
                </Button>
              </div>
            </div>
          ))}
        <div ref={end} />
      </div>
      <div className="composer-area">
        {!unavailable && (
          <label className="ai-consent">
            <input
              type="checkbox"
              checked={!!consents[consentKey]}
              disabled={!!busy}
              onChange={(event) =>
                useWorkspace.setState({
                  consents: { ...consents, [consentKey]: event.target.checked },
                })
              }
            />
            <span>
              このプロジェクトのボード・メモリ・会話を
              {selectedAgent === "claude" ? "Anthropic" : "OpenAI"}
              へ送信することに同意する
            </span>
          </label>
        )}
        <div className="composer">
          {references.length > 0 && (
            <div className="composer-references">
              {references.map((r, index) => (
                <span className="reference-chip" key={index} title={r.quote || r.title}>
                  <Paperclip size={11} />
                  <span>
                    {r.title}
                    {r.quote && " · 引用"}
                  </span>
                  <button
                    aria-label={`${r.title}の参照を外す`}
                    onClick={() =>
                      useWorkspace.setState({
                        references: references.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <Textarea
            aria-label="エージェントへのメッセージ"
            placeholder="どんなものを作りたい？"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!native}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                (e.ctrlKey || e.metaKey) &&
                !e.nativeEvent.isComposing &&
                !composing.current
              ) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="composer-bottom">
            <span>
              {unavailable
                ? "履歴の閲覧のみ"
                : busy
                  ? activity || "検討しています…"
                  : "Ctrl + Enter で送信"}
            </span>
            {isThisBusy ? (
              <Button
                size="icon-sm"
                variant="secondary"
                aria-label="応答を停止"
                onClick={() =>
                  void api
                    .cancel()
                    .catch((error) => useWorkspace.setState({ error: String(error) }))
                }
              >
                <Square />
              </Button>
            ) : (
              <Button
                size="icon-sm"
                aria-label="メッセージを送信"
                disabled={!text.trim() || !native || !!busy || unavailable || !consents[consentKey]}
                onClick={submit}
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
