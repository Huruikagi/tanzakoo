import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { api, native } from "@/lib/api";
import { t, systemMessage } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import type { PlanStatus } from "@/bindings/PlanStatus";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

function SignIn({ disabled }: { disabled: boolean }) {
  return (
    <Button
      type="button"
      variant="chatgpt"
      size="signin"
      disabled={disabled}
      onClick={() => void useWorkspace.getState().planConnect("login")}
    >
      <img src="/siwc/chatgpt-logo-white.svg" alt="" className="size-5" />
      {t("ChatGPTで続ける")}
    </Button>
  );
}

function Accounts({ status, disabled }: { status: PlanStatus; disabled: boolean }) {
  const [selectedId, setSelectedId] = useState(status.active?.id ?? status.accounts[0]?.id);
  const account = status.accounts.find((a) => a.id === selectedId) ?? status.accounts[0];
  const connect = useWorkspace.getState().planConnect;
  return (
    <div className="connection-stack">
      {account && (
        <>
          <Select value={account.id} disabled={disabled} onValueChange={setSelectedId}>
            <SelectTrigger aria-label={t("保存済みアカウント")} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {status.accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="connection-actions">
            {account.id !== status.active?.id && account.signedIn ? (
              <Button
                type="button"
                size="sm"
                disabled={disabled}
                onClick={() => void connect("select", account.id)}
              >
                {t("このアカウントを使う")}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => void connect("login", account.id)}
              >
                {t("再サインイン")}
              </Button>
            )}
            {account.signedIn && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => void connect("logout", account.id)}
              >
                {t("サインアウト")}
              </Button>
            )}
          </div>
          <p className="hint muted">
            {t("切り替え後は新しい会話を始めます。過去の会話やカードは残ります。")}
          </p>
          <div className="connection-divider" />
          <span className="hint muted">{t("別のアカウントを追加")}</span>
        </>
      )}
      <SignIn disabled={disabled} />
    </div>
  );
}

export function PlanAccess() {
  useTranslation();
  const status = useWorkspace((s) => s.planStatus);
  const error = useWorkspace((s) => s.planError);
  const busy = useWorkspace((s) => s.busy);
  const activity = useWorkspace((s) => s.activity);
  const switching = useWorkspace((s) => s.switching);
  const loaded = useWorkspace((s) => s.loaded);
  useEffect(() => {
    if (native && loaded && !status && !busy && !error)
      void useWorkspace.getState().planConnect("list");
  }, [loaded, status, busy, error]);
  const disabled = !native || !!busy || switching;
  const connect = useWorkspace.getState().planConnect;
  const active = status?.active;
  return (
    <div className="connection-stack">
      <div className="connection-summary">
        <div className="connection-heading">
          <strong>ChatGPT</strong>
          <span className={active?.signedIn ? "connection-state connected" : "connection-state"}>
            {active?.signedIn && <CheckCircle2 size={13} />}
            {active?.signedIn ? t("接続中") : active ? t("サインアウト済み") : t("未接続")}
          </span>
        </div>
        {active && <p className="connection-account">{active.label}</p>}
        <p className="hint muted">{t("AIとの会話には、ご自身のChatGPTの利用枠を使います。")}</p>
        {active?.signedIn && (
          <Button
            type="button"
            size="sm"
            variant="link"
            disabled={disabled}
            onClick={() => void connect("usage")}
          >
            {t("ChatGPTの利用量を管理")}
          </Button>
        )}
      </div>
      {status?.available &&
        (active?.signedIn ? (
          <details className="connection-details">
            <summary>{t("アカウント管理")}</summary>
            <Accounts status={status} disabled={disabled} />
          </details>
        ) : (
          <Accounts status={status} disabled={disabled} />
        ))}
      {busy?.kind === "connecting" && (
        <output className="connection-progress">
          <LoaderCircle size={14} className="animate-spin" />
          <span>{systemMessage(activity) || t("接続処理中")}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              void api.cancel().catch((e) => useWorkspace.setState({ planError: String(e) }))
            }
          >
            {t("接続処理を中止")}
          </Button>
        </output>
      )}
      {status?.warning && (
        <p role="alert" className="chat-error">
          {systemMessage(status.warning)}
        </p>
      )}
      {error && (
        <p role="alert" className="chat-error">
          {systemMessage(error)}
        </p>
      )}
      {(!status || !status.available) && error && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => void connect("list")}
        >
          {t("接続一覧を再取得")}
        </Button>
      )}
    </div>
  );
}
