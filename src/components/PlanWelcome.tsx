import { useState } from "react";
import { useTranslation } from "react-i18next";
import { t } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

// Only a dismissal flag is stored here; credentials never enter the webview.
function Welcome({ accountId }: { accountId: string }) {
  useTranslation();
  const key = `tanzakoo.plan-welcome.v1.${accountId}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== "seen";
    } catch {
      return true;
    }
  });
  function dismiss() {
    try {
      localStorage.setItem(key, "seen");
    } catch {
      /* Keep the app usable if storage is unavailable. */
    }
    setOpen(false);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) dismiss();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("ChatGPTプランを使用中")}</DialogTitle>
          <DialogDescription>
            {t(
              "TanzakooのAI利用はChatGPTの利用枠を消費します。利用量や上限はChatGPTの設定で管理できます。",
            )}
          </DialogDescription>
        </DialogHeader>
        <Button onClick={dismiss}>{t("確認しました")}</Button>
      </DialogContent>
    </Dialog>
  );
}

export function PlanWelcome() {
  const account = useWorkspace((s) => s.planStatus?.active);
  const review = useWorkspace((s) => s.reviewAccess);
  return account?.signedIn && !review ? <Welcome key={account.id} accountId={account.id} /> : null;
}
