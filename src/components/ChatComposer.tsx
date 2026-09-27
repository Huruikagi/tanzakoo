import { memo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { ArrowUp, Square, Paperclip, X } from "lucide-react";
import { t, systemMessage } from "@/lib/i18n";
import { api, native } from "@/lib/api";
import { chatRunning, useWorkspace } from "@/lib/workspace";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { ChatSettings } from "./ChatSettings";

export const ChatComposer = memo(function ChatComposer({
  text,
  setText,
  submit,
  selectedAgent,
  unavailable,
  consented,
}: {
  text: string;
  setText: (text: string) => void;
  submit: () => void;
  selectedAgent: string;
  unavailable: boolean;
  consented: boolean;
}) {
  useTranslation();
  const composing = useRef(false);
  const { references, busy, activity, isThisBusy } = useWorkspace(
    useShallow((s) => ({
      references: s.references,
      busy: s.busy,
      activity: s.activity,
      isThisBusy: chatRunning(s.busy, s.conversation),
    })),
  );
  return (
    <div className="composer-area">
      {selectedAgent === "codex" && <ChatSettings />}
      {!unavailable && !consented && (
        <div className="ai-consent">
          <p>
            {t(
              "話しかけると、そのプロジェクトのボード・メモリ・会話と、登録した参照資料のうちAIが読む箇所がOpenAIへ送信されます。同意は全プロジェクト共通で、設定から取り消せます。",
            )}
          </p>
          <Button
            size="sm"
            disabled={!native || !!busy}
            onClick={() => void useWorkspace.getState().setConsent(selectedAgent, true)}
          >
            {t("同意して使う")}
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
                  {r.quote && t(" · 引用")}
                </span>
                <button
                  aria-label={t("{{value0}}の参照を外す", { value0: r.title })}
                  onClick={() => useWorkspace.getState().detach(index)}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <Textarea
          aria-label={t("エージェントへのメッセージ")}
          placeholder={t("どんなものを作りたい？")}
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
              ? t("履歴の閲覧のみ")
              : busy
                ? systemMessage(activity) || t("検討しています…")
                : t("Ctrl + Enter で送信")}
          </span>
          {isThisBusy ? (
            <Button
              size="icon-sm"
              variant="secondary"
              aria-label={t("応答を停止")}
              onClick={() =>
                void api.cancel().catch((error) => useWorkspace.setState({ error: String(error) }))
              }
            >
              <Square />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              aria-label={t("メッセージを送信")}
              disabled={!text.trim() || !native || !!busy || unavailable || !consented}
              onClick={submit}
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});
