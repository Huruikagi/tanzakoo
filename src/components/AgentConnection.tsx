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
          <DialogTitle>{t("ChatGPTの接続状況")}</DialogTitle>
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
  if (agent !== "codex")
    return (
      <div className="agent-connection">
        <output>{t("この会話は閲覧のみです。新しい会話はChatGPTで始められます。")}</output>
      </div>
    );
  if (review) return hideWhenReady ? null : <ReviewAccess />;
  if (hideWhenReady && account?.signedIn) return null;
  return (
    <>
      <PlanAccess />
      <ReviewAccess />
    </>
  );
}
