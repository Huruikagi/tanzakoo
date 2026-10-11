import { externalAgent, externalAgents } from "@/lib/external-agents";
import { t, systemMessage } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Plus, MessageCircle, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { chatRunning, connectionStatus, useWorkspace } from "@/lib/workspace";
import { agentLabel, agentUnavailable, native } from "@/lib/api";
import { ChatHistory } from "./ChatHistory";
import { ChatActivity, ChatScrollAnchor } from "./ChatActivity";
import { ChatComposer } from "./ChatComposer";
import { AgentConnection, AgentConnectionDialog } from "./AgentConnection";
import { PendingProposals } from "./PendingProposals";
import { QuestionChoices } from "./QuestionChoices";
import { useChatDraft } from "@/lib/use-chat-draft";

/** A select entry that opens the connection settings instead of choosing an agent. */
const MANAGE_CONNECTIONS = "@tanzakoo/manage-connections";

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
  const chosenAgent = useWorkspace((s) => s.newChatAgent);
  const agent = agentUnavailable(snapshot, chosenAgent) ? "codex" : chosenAgent;
  const { text, setText, sendDraft } = useChatDraft(snapshot.project.id, conversation);
  const active = snapshot.conversations.find((c) => c.id === conversation);
  const selectedAgent = active?.agent ?? agent;
  const reviewAccess = useWorkspace((s) => s.reviewAccess);
  const consented =
    (selectedAgent === "codex" && !!reviewAccess) || snapshot.consents.includes(selectedAgent);
  const unavailable = agentUnavailable(snapshot, selectedAgent);
  const external = !unavailable ? externalAgent(selectedAgent) : undefined;
  const externalStatus = useWorkspace((s) => connectionStatus(s, selectedAgent));
  // Consent is cleared when the launch settings change, so it marks a CLI already in use.
  const needsSetup = !!external && (externalStatus ? externalStatus.state !== "ready" : !consented);
  const messages = snapshot.messages.filter((m) => m.conversationId === conversation);
  const isThisBusy = chatRunning(busy, conversation);
  const latestTurn = [...messages].reverse().find((m) => m.role === "user")?.id;
  const activeQuestions = snapshot.questions.filter(
    (q) => q.conversationId === conversation && q.messageId === latestTurn && q.state === "pending",
  );
  const questionTurn = activeQuestions[0]?.messageId;
  function submit() {
    if (!text.trim() || busy || !native || unavailable || !consented) return;
    sendDraft(selectedAgent);
  }
  return (
    <section className="chat-pane" data-answering={!!questionTurn}>
      <div className="pane-heading">
        <MessageCircle size={16} />
        <h2>{t("壁打ち")}</h2>
        {!unavailable && (
          <AgentConnectionDialog
            key={`${snapshot.project.id}:${selectedAgent}`}
            agent={selectedAgent}
          />
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
            <span className="agent-avatar">
              {active.agent === "claude" || active.agent === "claude-api" ? "✳" : "◎"}
            </span>
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
            {snapshot.externalAgentsAvailable && !reviewAccess ? (
              <Select
                value={agent}
                disabled={!!busy}
                onValueChange={(id) =>
                  id === MANAGE_CONNECTIONS
                    ? useWorkspace
                        .getState()
                        .openSettings("connection", externalAgent(agent) ? agent : null)
                    : useWorkspace.getState().setNewChatAgent(id)
                }
              >
                <SelectTrigger size="sm" aria-label={t("会話の接続先")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="codex">ChatGPT</SelectItem>
                  {externalAgents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                  <SelectSeparator />
                  <SelectItem value={MANAGE_CONNECTIONS}>{t("接続先を設定…")}</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <span>ChatGPT</span>
            )}
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
        {external && needsSetup && messages.length === 0 && !isThisBusy && (
          <div className="agent-connection">
            <p>
              {externalStatus
                ? systemMessage(externalStatus.message)
                : t(
                    "{{name}}はまだ接続を確認していません。CLIをインストールしてログインした後、設定で接続を確認してください。",
                    { name: external.name },
                  )}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => useWorkspace.getState().openSettings("connection", external.id)}
            >
              {t("{{name}}を設定", { name: external.name })}
            </Button>
          </div>
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
