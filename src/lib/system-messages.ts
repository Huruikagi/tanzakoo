import type { Locale } from "./i18n";

// The keys are the native wire contract; changing the displayed copy does not
// change which diagnostic is translated. Detail and paths remain verbatim.
export const systemMessages = {
  storage_access: {
    ja: "保存先にアクセスできません: {{detail}}",
    en: "Cannot access storage: {{detail}}",
  },
  storage_write: {
    ja: "保存に失敗しました: {{detail}}",
    en: "Could not save: {{detail}}",
  },
  storage_read: {
    ja: "データを読み取れません: {{detail}}",
    en: "Could not read data: {{detail}}",
  },
  export_open: {
    ja: "保存先を開けません: {{detail}}",
    en: "Could not open the export location: {{detail}}",
  },
  export_create: {
    ja: "出力フォルダーを作成できません: {{detail}}",
    en: "Could not create the export folder: {{detail}}",
  },
  export_write: {
    ja: "Markdownの出力に失敗しました: {{detail}}",
    en: "Could not export Markdown: {{detail}}",
  },
  export_partial: {
    ja: "Markdownの出力に失敗しました: {{detail}}。不完全な出力が {{path}} に残っています。",
    en: "Could not export Markdown: {{detail}}. Incomplete output remains at {{path}}.",
  },
  model_options: {
    ja: "モデル一覧を取得できませんでした。Codexの接続とサインインを確認してください: {{detail}}",
    en: "Could not load models. Check the Codex connection and sign-in status: {{detail}}",
  },
  agent_connection: {
    ja: "エージェント接続に失敗しました: {{detail}}. ログインと起動設定を確認してください。",
    en: "Agent connection failed: {{detail}}. Check sign-in and launch settings.",
  },
  project_cleanup: {
    ja: "プロジェクトは削除しましたが、保存ファイルの一部を消去できませんでした。次回起動時に再試行します。{{detail}}",
    en: "The project was deleted, but some files could not be removed. Cleanup will be retried on the next launch. {{detail}}",
  },
} satisfies Record<string, Record<Locale, string>>;

const prefix = "@tanzakoo/system:";

export function decodeSystemMessage(message: string, locale: Locale): string | null {
  if (!message.startsWith(prefix)) return null;
  try {
    const payload: unknown = JSON.parse(message.slice(prefix.length));
    if (!payload || typeof payload !== "object") return null;
    const { code, args, fallback } = payload as Record<string, unknown>;
    if (typeof fallback !== "string" || typeof code !== "string") return null;
    if (!Object.hasOwn(systemMessages, code)) return fallback;
    if (!args || typeof args !== "object") return fallback;
    const values = args as Record<string, unknown>;
    const template = systemMessages[code as keyof typeof systemMessages][locale];
    if ([...template.matchAll(/\{\{(\w+)\}\}/g)].some(([, key]) => typeof values[key] !== "string"))
      return fallback;
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] as string);
  } catch {
    return null;
  }
}
