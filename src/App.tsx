import { useEffect } from "react";
import { X, RefreshCw, MessageCircle } from "lucide-react";
import { usePanelRef } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Board } from "@/components/Board";
import { CardDetails } from "@/components/CardDetails";
import { Chat } from "@/components/Chat";
import { Settings } from "@/components/Settings";
import { Projects } from "@/components/Projects";
import { useWorkspace } from "@/lib/workspace";
import { api, native } from "@/lib/api";

export default function App() {
  const { error, busy, loaded, refresh, snapshot, switching, chatOpen, setChatOpen } =
    useWorkspace();
  const chatPanel = usePanelRef();
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
          <span className="local-status">
            <span />
            {native ? "ローカルに保存" : "ブラウザプレビュー"}
          </span>
          <Settings key={snapshot.project.id} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setChatOpen(!chatOpen)}
            aria-pressed={chatOpen}
          >
            <MessageCircle />
            AIと考える{busy ? " · 実行中" : ""}
          </Button>
        </div>
      </header>
      {!native && (
        <div className="preview-notice">
          画面プレビューです。保存とエージェント接続はデスクトップアプリで利用できます。
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="最新の状態を読み込む"
            onClick={() => void refresh()}
          >
            <RefreshCw />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="エラー表示を閉じる"
            onClick={() => useWorkspace.setState({ error: null })}
          >
            <X />
          </Button>
        </div>
      )}
      {!loaded ? (
        <div className="loading-state">ボードを開いています…</div>
      ) : (
        <main className="workspace" inert={switching} aria-busy={switching}>
          <ResizablePanelGroup orientation="horizontal" id="tanzakoo-workspace">
            <ResizablePanel id="board" defaultSize="47%" minSize="30%">
              <Board key={snapshot.project.id} />
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
