import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";

export const publicPages = [
  {
    name: "index",
    source: "site/index.md",
    lang: "ja",
    title: "Tanzakoo — アイデアから、決めたことへ",
  },
  {
    name: "support",
    source: "notes/app-store/support.md",
    lang: "ja",
    title: "Tanzakoo — サポート / Support",
  },
  {
    name: "privacy-ja",
    source: "notes/app-store/privacy-ja.md",
    lang: "ja",
    title: "Tanzakoo — プライバシーポリシー",
  },
  {
    name: "privacy-en",
    source: "notes/app-store/privacy-en.md",
    lang: "en",
    title: "Tanzakoo — Privacy Policy",
  },
];

export function renderPage(page, source, { preview = false } = {}) {
  if (!preview && /公開前原稿|Pre-publication draft|privacy-assessment\.md/.test(source)) {
    throw new Error(`Unresolved publication draft: ${page.source}`);
  }
  const body = renderToStaticMarkup(
    React.createElement(
      Markdown,
      {
        components: {
          a: ({ href, children }) =>
            React.createElement(
              "a",
              {
                href: href?.replace(/^(privacy-ja|privacy-en|support)\.md$/, "$1.html"),
              },
              children,
            ),
        },
      },
      source,
    ),
  );
  return `<!doctype html>
<html lang="${page.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
${preview ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="https://huruikagi.github.io/tanzakoo/${page.name === "index" ? "" : `${page.name}.html`}">`}
<title>${page.title}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<a class="skip" href="#content">${page.lang === "en" ? "Skip to content" : "本文へ"}</a>
<header><a class="brand" href="index.html"><span aria-hidden="true">▰</span> Tanzakoo.</a>
<nav aria-label="${page.lang === "en" ? "Site navigation" : "サイト内の案内"}"><a href="support.html">サポート / Support</a><a href="privacy-ja.html" lang="ja">プライバシー</a><a href="privacy-en.html" lang="en">Privacy</a></nav></header>
${preview ? "<aside>確認用プレビュー / Local preview</aside>" : ""}
<main id="content">${body}</main>
<footer>Tanzakoo · Huruikagi<br><a href="mailto:huruikagi@gmail.com">huruikagi@gmail.com</a></footer>
</body></html>\n`;
}
