import { t } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { LoaderCircle, Plug, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useWorkspace } from "@/lib/workspace";
import { ReviewAccess } from "./ReviewAccess";
import { PlanAccess } from "./PlanAccess";
import { native } from "@/lib/api";

export function AgentConnectionDialog({ agent }: { agent: string }) {
  useTranslation();
  const review = useWorkspace((s) => s.reviewAccess);
  const account = useWorkspace((s) => s.planStatus?.active);
  const connecting = useWorkspace((s) => s.busy?.kind === "connecting" && s.busy.agent === agent);
  const ready = !!review || account?.signedIn;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("接続状況")}
          title={
            connecting
              ? t("接続処理中")
              : review
                ? t("審査用接続")
                : ready
                  ? t("ChatGPTプランを使用中")
                  : t("接続状況からChatGPTでサインインしてください。")
          }
        >
          {connecting ? (
            <LoaderCircle className="animate-spin" />
          ) : ready ? (
            <Plug />
          ) : (
            <TriangleAlert className="text-amber-600" />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("AI接続")}</DialogTitle>
          <DialogDescription>
            {t("接続の確認やサインインでは、プロジェクトの内容は送信しません。")}
          </DialogDescription>
        </DialogHeader>
        <div className="settings-scroll">
          <AgentConnection agent={agent} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AgentConnection({
  agent,
  hideWhenReady = false,
}: {
  agent: string;
  hideWhenReady?: boolean;
}) {
  useTranslation();
  const review = useWorkspace((s) => s.reviewAccess);
  const account = useWorkspace((s) => s.planStatus?.active);
  const consented = useWorkspace((s) => s.snapshot.consents.includes(agent));
  const disabled = useWorkspace((s) => !!s.busy || s.switching) || !native;
  if (agent !== "codex")
    return (
      <div className="agent-connection">
        <output>{t("この会話は閲覧のみです。新しい会話はChatGPTで始められます。")}</output>
      </div>
    );
  if (review) return hideWhenReady ? null : <ReviewAccess />;
  if (hideWhenReady && account?.signedIn) return null;
  return (
    <div className="connection-stack">
      <PlanAccess />
      <details className="connection-details">
        <summary>{t("送信する内容と同意")}</summary>
        <div className="connection-stack">
          <p className="hint muted">
            {t(
              "話しかけると、そのプロジェクトのボード・メモリ・会話と、登録した参照資料のうちAIが読む箇所がOpenAIへ送信されます。同意は全プロジェクト共通で、設定から取り消せます。",
            )}
          </p>
          {consented ? (
            <div className="connection-actions">
              <span className="hint">{t("送信に同意済み")}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => void useWorkspace.getState().setConsent(agent, false)}
              >
                {t("同意を取り消す")}
              </Button>
            </div>
          ) : (
            <p className="hint">{t("初めて会話を送るときに、チャットで同意を確認します。")}</p>
          )}
          <p className="hint muted">
            {t(
              "Tanzakooは無料です。アプリを再起動したら、保存済みアカウントを選んで再接続できます。",
            )}
          </p>
        </div>
      </details>
      <ReviewAccess />
    </div>
  );
}
