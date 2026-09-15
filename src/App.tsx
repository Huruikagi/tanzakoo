import { useEffect } from "react";
import { LayoutDashboard, X, RefreshCw } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Board } from "@/components/Board";
import { CardDetails } from "@/components/CardDetails";
import { Chat } from "@/components/Chat";
import { Settings } from "@/components/Settings";
import { useWorkspace } from "@/lib/workspace";
import { api, native } from "@/lib/api";

export default function App() {
  const { error, busy, loaded, refresh } = useWorkspace();
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
        <div className="workspace-title">
          <LayoutDashboard size={14} />
          <span>マイボード</span>
        </div>
        <div className="header-right">
          <span className="local-status">
            <span />
            {native ? "ローカルに保存" : "ブラウザプレビュー"}
          </span>
          <Settings />
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
        <main className="workspace">
          <ResizablePanelGroup orientation="horizontal" id="tanzakoo-workspace">
            <ResizablePanel id="board" defaultSize="47%" minSize="30%">
              <Board />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="details" defaultSize="26%" minSize="280px">
              <CardDetails />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="chat" defaultSize="27%" minSize="290px">
              <Chat />
            </ResizablePanel>
          </ResizablePanelGroup>
        </main>
      )}
    </div>
  );
}
