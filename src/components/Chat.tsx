import { t, systemMessage } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Plus, MessageCircle, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { chatRunning, useWorkspace } from "@/lib/workspace";
import { agentLabel, agentUnavailable, native } from "@/lib/api";
import { ChatHistory } from "./ChatHistory";
import { ChatActivity, ChatScrollAnchor } from "./ChatActivity";
import { ChatComposer } from "./ChatComposer";
import { AgentConnection, AgentConnectionDialog } from "./AgentConnection";
import { PendingProposals } from "./PendingProposals";
import { QuestionChoices } from "./QuestionChoices";
import { useChatDraft } from "@/lib/use-chat-draft";

export function Chat() {
  useTranslation();
  const { snapshot, conversation, busy, chatError } = useWorkspace(
    useShallow((s) => ({
      snapshot: s.snapshot,
      conversation: s.conversation,
      busy: s.busy,
      chatError: s.chatError,
    })),
  );
  const agent = "codex";
  const { text, setText, sendDraft } = useChatDraft(snapshot.project.id, conversation);
  const active = snapshot.conversations.find((c) => c.id === conversation);
  const selectedAgent = active?.agent ?? agent;
  const reviewAccess = useWorkspace((s) => s.reviewAccess);
  const consented = !!reviewAccess || snapshot.consents.includes(selectedAgent);
  const unavailable = agentUnavailable(snapshot, selectedAgent);
  const messages = snapshot.messages.filter((m) => m.conversationId === conversation);
  const isThisBusy = chatRunning(busy, conversation);
  const latestTurn = [...messages].reverse().find((m) => m.role === "user")?.id;
  const activeQuestions = snapshot.questions.filter(
    (q) => q.conversationId === conversation && q.messageId === latestTurn && q.state === "pending",
  );
  const questionTurn = activeQuestions[0]?.messageId;
  function submit() {
    if (!text.trim() || busy || !native || unavailable || !consented) return;
    sendDraft(agent);
  }
  return (
    <section className="chat-pane" data-answering={!!questionTurn}>
      <div className="pane-heading">
        <MessageCircle size={16} />
        <h2>{t("壁打ち")}</h2>
        {selectedAgent === "codex" && (
          <AgentConnectionDialog key={snapshot.project.id} agent={selectedAgent} />
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("チャットを閉じる")}
          onClick={() => useWorkspace.getState().setChatOpen(false)}
        >
          <X />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("新しい会話")}
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
              <SelectTrigger size="sm" aria-label={t("会話履歴")}>
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
                {t("履歴へ")}
              </Button>
            )}
          </>
        )}
      </div>
      <div className="chat-history" aria-label={t("会話メッセージ")}>
        {unavailable && <AgentConnection agent={selectedAgent} />}
        {chatError && (
          <p className="chat-error" role="alert">
            {systemMessage(chatError)}
          </p>
        )}
        {messages.length === 0 && !isThisBusy && !unavailable && (
          <div className="chat-welcome">
            <p>{t("作りたいものを、曖昧なままで話してください。論点はカードにしていきます。")}</p>
            <button
              className="suggestion"
              disabled={!native}
              onClick={() =>
                setText(t("個人用のTODOアプリを作りたい。まだぼんやりしているので、一緒に考えて。"))
              }
            >
              {t("個人用のTODOアプリを作りたい")}
              <ChevronRight size={14} />
            </button>
            <button
              className="suggestion"
              disabled={!native}
              onClick={() => setText(t("アイデアを整理したい。まず何から話そう？"))}
            >
              {t("アイデアを整理するところから")}
              <ChevronRight size={14} />
            </button>
          </div>
        )}
        <ChatHistory
          snapshot={snapshot}
          conversation={conversation}
          agent={selectedAgent}
          disabled={!!busy || !native || unavailable || !consented}
        />
        <ChatActivity agent={selectedAgent} />
        <ChatScrollAnchor />
      </div>
      <PendingProposals key={snapshot.project.id} questionTurn={questionTurn} />
      {questionTurn && (
        <QuestionChoices
          key={`${snapshot.project.id}:${questionTurn}`}
          questions={activeQuestions}
          disabled={!!busy || !native || unavailable || !consented}
          running={!!busy}
        />
      )}
      <ChatComposer
        text={text}
        setText={setText}
        submit={submit}
        selectedAgent={selectedAgent}
        unavailable={unavailable}
        consented={consented}
      />
    </section>
  );
}
