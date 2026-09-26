import { Fragment, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
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
import { chatRunning, useWorkspace } from "@/lib/workspace";
import { agentLabel, agentUnavailable, api, native } from "@/lib/api";
import { Markdown } from "./Markdown";
import { AgentConnection, AgentConnectionDialog } from "./AgentConnection";
import { DiscussionNotice } from "./DiscussionNotice";
import { ChatSettings } from "./ChatSettings";
import { PendingProposals } from "./PendingProposals";

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
  } = useWorkspace(
    useShallow((s) => ({
      snapshot: s.snapshot,
      conversation: s.conversation,
      busy: s.busy,
      stream: s.stream,
      activity: s.activity,
      references: s.references,
      permissions: s.permissions,
      send: s.send,
      answer: s.answer,
      chatError: s.chatError,
    })),
  );
  const agent = "codex";
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const key = `${snapshot.project.id}:${conversation ?? "new"}`;
  const text = drafts[key] ?? "";
  const setText = (value: string) => setDrafts((previous) => ({ ...previous, [key]: value }));
  const end = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const active = snapshot.conversations.find((c) => c.id === conversation);
  const selectedAgent = active?.agent ?? agent;
  const consented = snapshot.consents.includes(selectedAgent);
  const unavailable = agentUnavailable(snapshot, selectedAgent);
  const messages = snapshot.messages.filter((m) => m.conversationId === conversation);
  const isThisBusy = chatRunning(busy, conversation);
  useEffect(
    () =>
      useWorkspace.subscribe((state, previous) => {
        const removed = previous.snapshot.projects.filter(
          (project) => !state.snapshot.projects.some((current) => current.id === project.id),
        );
        if (removed.length) {
          setDrafts((current) =>
            Object.fromEntries(
              Object.entries(current).filter(
                ([key]) => !removed.some((project) => key.startsWith(`${project.id}:`)),
              ),
            ),
          );
        }
        // Preserve the composer when a board action creates the first conversation.
        if (
          previous.conversation === null &&
          state.conversation &&
          previous.busy?.kind === "chat" &&
          previous.busy.conversation === null &&
          previous.snapshot.project.id === state.snapshot.project.id
        ) {
          const from = `${state.snapshot.project.id}:new`;
          const to = `${state.snapshot.project.id}:${state.conversation}`;
          setDrafts((current) => {
            if (!current[from] || current[to]) return current;
            const next = { ...current, [to]: current[from] };
            delete next[from];
            return next;
          });
        }
      }),
    [],
  );
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, stream, permissions.length]);
  function submit() {
    if (!text.trim() || busy || !native || unavailable || !consented) return;
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
        {selectedAgent === "codex" && (
          <AgentConnectionDialog key={snapshot.project.id} agent={selectedAgent} />
        )}
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
            useWorkspace.getState().selectConversation(null);
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
              onValueChange={(id) => useWorkspace.getState().selectConversation(id)}
            >
              <SelectTrigger size="sm" aria-label="会話履歴">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...snapshot.conversations].reverse().map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {agentLabel(c.agent)} · {c.title}
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
                  useWorkspace.getState().selectConversation(snapshot.conversations.at(-1)!.id)
                }
              >
                履歴へ
              </Button>
            )}
          </>
        )}
      </div>
      <div className="chat-history" aria-label="会話メッセージ">
        {unavailable && <AgentConnection agent={selectedAgent} />}
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
          <Fragment key={m.id}>
            <article className={`message message-${m.role}`}>
              <div className="message-label">
                {m.role === "user"
                  ? "あなた"
                  : m.role === "error"
                    ? "エラー"
                    : agentLabel(active?.agent)}
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
            {snapshot.discussions
              .filter((d) => d.conversationId === conversation && d.messageId === m.id)
              .map((d) => (
                <DiscussionNotice key={d.id} discussion={d} />
              ))}
          </Fragment>
        ))}
        {isThisBusy && (
          <article className="message message-assistant">
            <div className="message-label">
              {agentLabel(active?.agent)}
              <span className="thinking-dot" />
            </div>
            {stream ? <Markdown>{stream}</Markdown> : <p className="muted">{activity}</p>}
          </article>
        )}
        {isThisBusy &&
          permissions.map((p) => (
            <div className="permission" key={p.id}>
              <strong>{agentLabel(active?.agent)}が操作の許可を求めています</strong>
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
      <PendingProposals key={snapshot.project.id} />
      <div className="composer-area">
        {selectedAgent === "codex" && <ChatSettings />}
        {!unavailable && !consented && (
          <div className="ai-consent">
            <p>
              話しかけると、そのプロジェクトのボード・メモリ・会話がOpenAIへ送信されます。同意は全プロジェクト共通で、設定から取り消せます。
            </p>
            <Button
              size="sm"
              disabled={!native || !!busy}
              onClick={() => void useWorkspace.getState().setConsent(selectedAgent, true)}
            >
              同意して使う
            </Button>
          </div>
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
                    onClick={() => useWorkspace.getState().detach(index)}
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
                disabled={!text.trim() || !native || !!busy || unavailable || !consented}
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
