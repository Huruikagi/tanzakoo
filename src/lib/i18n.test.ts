import { afterEach, expect, it, vi } from "vitest";
import { i18n, readLanguagePreference, resolveLocale, setLanguage, systemMessage, t } from "./i18n";
import english from "./locales/en.json";
import systemEnglish from "./locales/system-en.json";
import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

afterEach(() => vi.restoreAllMocks());

it("resolves system language, persists overrides, and tracks system changes only in automatic mode", () => {
  expect(resolveLocale("system", "ja-JP")).toBe("ja");
  expect(resolveLocale("system", "en-US")).toBe("en");
  expect(resolveLocale("system", "fr-FR")).toBe("en");
  expect(resolveLocale("ja", "en-US")).toBe("ja");
  setLanguage("en");
  expect(readLanguagePreference()).toBe("en");
  expect(document.documentElement.lang).toBe("en");
  vi.spyOn(navigator, "language", "get").mockReturnValue("ja-JP");
  window.dispatchEvent(new Event("languagechange"));
  expect(document.documentElement.lang).toBe("en");
  setLanguage("system");
  expect(readLanguagePreference()).toBe("system");
  expect(document.documentElement.lang).toBe("ja");
  vi.spyOn(navigator, "language", "get").mockReturnValue("de-DE");
  window.dispatchEvent(new Event("languagechange"));
  expect(document.documentElement.lang).toBe("en");
  localStorage.setItem("tanzakoo-language", "invalid");
  expect(readLanguagePreference()).toBe("system");
});

it("works without storage and preserves technical details and interpolated user text", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  expect(readLanguagePreference()).toBe("system");
  setLanguage("en");
  expect(t("{{value0}}を並べ替える", { value0: "保存 <sample> {{x}}" })).toBe(
    "Reorder 保存 <sample> {{x}}",
  );
  expect(
    systemMessage("審査用コードの有効期限が切れています。新しいコードを入力してください。"),
  ).toBe("The review access code has expired. Enter a new code.");
  expect(systemMessage("保存に失敗しました: G:\\日本語\\data.db")).toBe(
    "Could not save: G:\\日本語\\data.db",
  );
  expect(systemMessage("unrecognized technical error")).toBe("unrecognized technical error");
  setLanguage("ja");
  expect(systemMessage("Connected.")).toBe("接続できました。");
});

it("has complete translations and preserves every interpolation placeholder", () => {
  const resources: Record<string, string> = { ...english, ...systemEnglish };
  const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  for (const [source, translated] of Object.entries(resources)) {
    expect(translated.trim(), source).not.toBe("");
    expect(translated, source).not.toMatch(/[ぁ-んァ-ヶ一-龠]/);
    expect(placeholders(translated), source).toEqual(placeholders(source));
  }
  // Ensure new UI text cannot quietly fall back to Japanese in English mode.
  const root = join(process.cwd(), "src");
  for (const filename of readdirSync(root, { recursive: true }) as string[]) {
    if (!/\.tsx?$/.test(filename) || /\.test\.|bindings|locales/.test(filename)) continue;
    const contents = readFileSync(join(root, filename), "utf8");
    const source = ts.createSourceFile(filename, contents, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source) === "t" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        expect(
          Object.hasOwn(resources, node.arguments[0].text),
          `${filename}: ${node.arguments[0].text}`,
        ).toBe(true);
      }
      if (
        ts.isJsxText(node) &&
        /[ぁ-んァ-ヶ一-龠]/.test(node.text) &&
        node.text.trim() !== "日本語"
      ) {
        throw new Error(`Untranslated JSX in ${filename}: ${node.text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(i18n.isInitialized).toBe(true);
});
