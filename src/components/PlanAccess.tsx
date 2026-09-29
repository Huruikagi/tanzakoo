import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, native } from "@/lib/api";
import { t, systemMessage } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { Button } from "./ui/button";

export function PlanAccess() {
  useTranslation();
  const status = useWorkspace((s) => s.planStatus);
  const error = useWorkspace((s) => s.planError);
  const busy = useWorkspace((s) => s.busy);
  const switching = useWorkspace((s) => s.switching);
  const loaded = useWorkspace((s) => s.loaded);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (native && loaded && !status && !busy && !error)
      void useWorkspace.getState().planConnect("list");
  }, [loaded, status, busy, error]);
  const disabled = !native || !!busy || switching;
  const connect = useWorkspace.getState().planConnect;
  if (!status?.available)
    return error ? (
      <div>
        <p role="alert">{systemMessage(error)}</p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => void connect("list")}
        >
          {t("接続一覧を再取得")}
        </Button>
      </div>
    ) : null;
  return (
    <div className="agent-settings">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => setExpanded(!expanded)}
      >
        {t("ChatGPTプラン接続（プレビュー）")}
      </Button>
      {(expanded || status.active) && (
        <>
          <p className="hint">
            {t(
              "AI利用はChatGPTの利用枠を消費します。接続後は新しい会話を始めてください。アプリを再起動したら、保存済みアカウントを選んで再接続できます。",
            )}
          </p>
          {status.active && (
            <p className="hint">
              {status.active.signedIn
                ? t("接続中: {{value0}}", { value0: status.active.label })
                : t("サインアウト済み: {{value0}}", { value0: status.active.label })}
            </p>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => void connect("usage")}
          >
            {t("ChatGPTの利用量を管理")}
          </Button>
          {status.accounts.map((account) => (
            <div className="connection-actions" key={account.id}>
              <span className="hint">{account.label}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => void connect(account.signedIn ? "select" : "login", account.id)}
              >
                {account.signedIn ? t("このアカウントを使う") : t("再サインイン")}
              </Button>
              {account.signedIn && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
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
          ))}
          <div className="connection-actions">
            <Button
              type="button"
              size="sm"
              disabled={disabled}
              onClick={() => void connect("login")}
            >
              {t("ChatGPTで続ける")}
            </Button>
            {status.active && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => void connect("disconnect")}
              >
                {t("通常の接続に戻す")}
              </Button>
            )}
          </div>
        </>
      )}
      {busy?.kind === "connecting" && (
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
      )}
      {status.warning && <p role="alert">{systemMessage(status.warning)}</p>}
      {error && <p role="alert">{systemMessage(error)}</p>}
    </div>
  );
}
