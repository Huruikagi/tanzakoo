import { t, systemMessage } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { X, RefreshCw, MessageCircle } from "lucide-react";
import { usePanelRef } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Board } from "@/components/Board";
import { CardDetails } from "@/components/CardDetails";
import { Chat } from "@/components/Chat";
import { Settings } from "@/components/Settings";
import { PlanWelcome } from "@/components/PlanWelcome";
import { PlanConnectionRestore } from "@/components/PlanAccess";
import { Projects } from "@/components/Projects";
import { ExportDecisions } from "@/components/ExportDecisions";
import { useWorkspace } from "@/lib/workspace";
import { api, native } from "@/lib/api";
import { openNotification } from "@/lib/notification-navigation";

export default function App() {
  useTranslation();
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void api
      .subscribeNotifications((target) => void openNotification(target))
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => useWorkspace.setState({ error: String(error) }));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const { error, busy, loaded, refresh, projectId, switching, chatOpen, setChatOpen } =
    useWorkspace(
      useShallow((s) => ({
        error: s.error,
        busy: s.busy,
        loaded: s.loaded,
        refresh: s.refresh,
        projectId: s.snapshot.project.id,
        switching: s.switching,
        chatOpen: s.chatOpen,
        setChatOpen: s.setChatOpen,
      })),
    );
  const chatPanel = usePanelRef();
  const pendingCount = useWorkspace(
    (s) => s.snapshot.proposals.filter((p) => p.state === "pending").length,
  );
  useEffect(() => {
    if (loaded) {
      if (chatOpen) chatPanel.current?.expand();
      else chatPanel.current?.collapse();
    }
  }, [chatOpen, loaded, chatPanel]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void api
      .subscribe((event) => useWorkspace.getState().event(event))
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => useWorkspace.setState({ error: String(error) }));
    void refresh();
    void api
      .reviewStatus()
      .then((reviewAccess) => {
        if (!disposed) useWorkspace.setState({ reviewAccess });
      })
      .catch((error) => useWorkspace.setState({ error: String(error) }));
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void refresh(), 1200);
    return () => window.clearInterval(timer);
  }, [busy, refresh]);
  return (
    <div className="app-shell">
      <PlanConnectionRestore />
      <PlanWelcome />
      <header className="app-header">
        <div className="brand">
          <span className="brand-symbol" aria-hidden="true">
            <i />
            <i />
          </span>
          <span>
            Tanzakoo<span className="brand-period">.</span>
          </span>
        </div>
        <Projects />
        <div className="header-right">
          <ExportDecisions key={`export-${projectId}`} />
          <Settings key={projectId} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setChatOpen(!chatOpen)}
            aria-pressed={chatOpen}
          >
            <MessageCircle />
            {t("AIと考える")}
            {busy ? t(" · 実行中") : ""}
            {pendingCount > 0 && (
              <span className="proposal-count">
                {t("未承認 {{value0}}", { value0: pendingCount })}
              </span>
            )}
          </Button>
        </div>
      </header>
      {!native && (
        <div className="preview-notice">
          {t("ブラウザプレビューのため、保存とAI接続は使えません。")}
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <span>{systemMessage(error)}</span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t("最新の状態を読み込む")}
            onClick={() => void refresh()}
          >
            <RefreshCw />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t("エラー表示を閉じる")}
            onClick={() => useWorkspace.setState({ error: null })}
          >
            <X />
          </Button>
        </div>
      )}
      {!loaded ? (
        <div className="loading-state">{t("ボードを開いています…")}</div>
      ) : (
        <main className="workspace" inert={switching} aria-busy={switching}>
          <ResizablePanelGroup orientation="horizontal" id="tanzakoo-workspace">
            <ResizablePanel id="board" defaultSize="47%" minSize="30%">
              <Board key={projectId} />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="details" defaultSize="26%" minSize="280px">
              <CardDetails />
            </ResizablePanel>
            <ResizableHandle withHandle disabled={!chatOpen} />
            <ResizablePanel
              id="chat"
              panelRef={chatPanel}
              collapsible
              collapsedSize={0}
              defaultSize="27%"
              minSize="290px"
              onResize={(size, _id, previous) => {
                if (previous && (size.asPercentage === 0) !== (previous.asPercentage === 0)) {
                  setChatOpen(size.asPercentage > 0);
                }
              }}
            >
              <div className="chat-panel-content" inert={!chatOpen} aria-hidden={!chatOpen}>
                <Chat />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </main>
      )}
    </div>
  );
}
