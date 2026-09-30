import { t, setLanguage, useLanguage, type LanguagePreference } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentConnection } from "./AgentConnection";

export function Settings() {
  useTranslation();
  const preference = useLanguage((s) => s.preference);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={t("設定")}>
          <Settings2 />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("設定")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("表示言語と、ChatGPTの接続を設定します。")}
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="general">
          <TabsList variant="line" aria-label={t("設定の種類")}>
            <TabsTrigger value="general">{t("一般")}</TabsTrigger>
            <TabsTrigger value="connection">{t("AI接続")}</TabsTrigger>
          </TabsList>
          <TabsContent value="general">
            <div className="settings-section connection-stack">
              <label htmlFor="display-language">{t("表示言語")}</label>
              <Select
                value={preference}
                onValueChange={(value) => setLanguage(value as LanguagePreference)}
              >
                <SelectTrigger id="display-language" aria-label={t("表示言語")} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">{t("システムに合わせる")}</SelectItem>
                  <SelectItem value="ja">日本語</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>
          <TabsContent value="connection">
            <div className="settings-section settings-scroll">
              <AgentConnection agent="codex" />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
