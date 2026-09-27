import { t } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useDroppable } from "@dnd-kit/react";
import { Archive, RotateCcw } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { native } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

export const ARCHIVE_TARGET = "board-archive";

export function ArchiveShelf({ dragging }: { dragging: boolean }) {
  useTranslation();
  const { snapshot, archiveNotice, archivePending, setArchived, switching } = useWorkspace(
    useShallow((s) => ({
      snapshot: s.snapshot,
      archiveNotice: s.archiveNotice,
      archivePending: s.archivePending,
      setArchived: s.setArchived,
      switching: s.switching,
    })),
  );
  const disabled = !native || archivePending || switching;
  const { ref, isDropTarget } = useDroppable({ id: ARCHIVE_TARGET, disabled });
  const [hoveredNotice, setHoveredNotice] = useState<typeof archiveNotice>(null);
  const [focusedNotice, setFocusedNotice] = useState<typeof archiveNotice>(null);
  const archived = snapshot.cards.filter((c) => c.deleted);
  const pending = snapshot.proposals.filter((p) => p.state === "pending").length;
  const noticeCard =
    archiveNotice?.projectId === snapshot.project.id
      ? archived.find((c) => c.id === archiveNotice.cardId && c.revision === archiveNotice.revision)
      : undefined;
  useEffect(() => {
    if (!archiveNotice || hoveredNotice === archiveNotice || focusedNotice === archiveNotice)
      return;
    const timer = window.setTimeout(() => {
      if (useWorkspace.getState().archiveNotice === archiveNotice) {
        useWorkspace.setState({ archiveNotice: null });
      }
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [archiveNotice, hoveredNotice, focusedNotice]);
  return (
    <footer className="board-footer">
      {noticeCard && (
        <div className="archive-notice">
          <output>{t("アーカイブしました")}</output>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onMouseEnter={() => setHoveredNotice(archiveNotice)}
            onMouseLeave={() => setHoveredNotice(null)}
            onFocus={() => setFocusedNotice(archiveNotice)}
            onBlur={() => setFocusedNotice(null)}
            onClick={() => void setArchived(noticeCard.id, false)}
          >
            <RotateCcw />
            {t("元に戻す")}
          </Button>
        </div>
      )}
      <div className="board-footer-summary">
        <span>
          {t("{{value0}}枚のカード", { value0: snapshot.cards.length - archived.length })}
        </span>
        {pending > 0 && <span>{t("{{value0}}件の変更提案", { value0: pending })}</span>}
        <Dialog>
          <DialogTrigger asChild>
            <Button
              className="ml-auto"
              variant="ghost"
              size="sm"
              aria-label={t("アーカイブ {{value0}}件", { value0: archived.length })}
            >
              <Archive />
              {t("アーカイブ · {{value0}}", { value0: archived.length })}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("アーカイブ")}</DialogTitle>
              <DialogDescription>{t("必要になったら、元の列へ戻せます。")}</DialogDescription>
            </DialogHeader>
            <div className="archive-list">
              {archived.length === 0 ? (
                <p className="muted">{t("アーカイブしたカードはありません。")}</p>
              ) : (
                archived.map((card) => (
                  <div className="archive-row" key={card.id}>
                    <span>{card.title}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      aria-label={t("{{value0}}を元の列へ戻す", { value0: card.title })}
                      onClick={() => void setArchived(card.id, false)}
                    >
                      <RotateCcw />
                      {t("戻す")}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div
        ref={ref}
        className={`archive-drop ${dragging ? "visible" : ""} ${isDropTarget ? "drop-target" : ""}`}
      >
        <Archive size={20} />
        <span>{isDropTarget ? t("離してアーカイブ") : t("ここに置いてアーカイブ")}</span>
      </div>
    </footer>
  );
}
