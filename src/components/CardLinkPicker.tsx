import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "lucide-react";
import type { Card } from "@/bindings/Card";
import { t } from "@/lib/i18n";
import { columns } from "@/lib/workspace";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "./ui/dialog";

export function CardLinkPicker({
  cards,
  onSelect,
  onClose,
}: {
  cards: Card[];
  onSelect: (card: Card) => void;
  onClose: () => void;
}) {
  useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const matches = cards.filter((card) =>
    card.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost">
          <Link />
          {t("カードリンクを挿入")}
        </Button>
      </DialogTrigger>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("参照するカード")}</DialogTitle>
          <DialogDescription>
            {t("カードを選ぶと、本文のカーソル位置にリンクを挿入します。")}
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label={t("カードを検索")}
          placeholder={t("カードを検索")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="card-link-results">
          {matches.length === 0 && <p className="muted">{t("該当するカードがありません。")}</p>}
          {matches.map((card) => (
            <button
              key={card.id}
              type="button"
              className="card-link-option"
              onClick={() => {
                onSelect(card);
                setOpen(false);
              }}
            >
              <span>{card.title}</span>
              <small className="muted">
                {t(columns.find((column) => column.id === card.status)!.title)} ·{" "}
                {card.body.slice(0, 80)}
              </small>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
