// Prepare local drafts and original screenshots. Never publish or submit.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.argv[2];
if (!output) throw new Error("Usage: node scripts/prepare-store-listing.mjs NEW_OUTPUT_DIRECTORY");
const target = path.resolve(output);
const read = (name) => readFile(path.join(root, name), "utf8");
const mac = JSON.parse(await read("notes/app-store/metadata.json"));
const windows = JSON.parse(await read("notes/windows-store/metadata.json"));
const checks = [];
for (const [locale, fields] of Object.entries(mac.localizations)) {
  for (const [field, max] of Object.entries({
    name: 30,
    subtitle: 30,
    promotionalText: 170,
    description: 4000,
    keywords: 100,
  })) {
    const length =
      field === "keywords" ? Buffer.byteLength(fields[field], "utf8") : [...fields[field]].length;
    if (!length || length > max)
      throw new Error(`${locale}/${field}: ${length} exceeds ${max} or is empty`);
    checks.push({ locale, field, length, max });
  }
}
const review = await read("notes/app-store/review-notes.txt");
if (review.length > 4000) throw new Error("Mac review notes exceed 4000 characters");
const windowsChecks = [];
for (const [locale, fields] of Object.entries(windows.localizations)) {
  for (const [field, max] of Object.entries({ description: 10000, shortDescription: 1000 })) {
    const length = [...fields[field]].length;
    if (!length || length > max)
      throw new Error(`Windows ${locale}/${field}: invalid length ${length}`);
    windowsChecks.push({ locale, field, length, max });
  }
  if (fields.features.length > 20 || fields.features.some((feature) => [...feature].length > 200)) {
    throw new Error(`Windows ${locale}: too many or overlong features`);
  }
}
const selections = [];
for (const language of ["ja", "en"]) {
  for (const [number, scene] of [
    ["01", "board"],
    ["02", "proposal"],
    ["03", "export"],
  ]) {
    const batch =
      language === "ja" && scene === "proposal"
        ? "20261001-012748-5oarn_x8"
        : "20261001-011811-zgitbmen";
    const folder = `notes/app-store/screenshots/native/${batch}`;
    const file = `${language}-${number}-${scene}-local.jpg`;
    const manifest = JSON.parse(await read(`${folder}/manifest.json`));
    const capture = manifest.captures.find((item) => item.file === file);
    const sha256 = createHash("sha256")
      .update(await readFile(path.join(root, folder, file)))
      .digest("hex");
    if (!capture || capture.sha256 !== sha256 || capture.pixels.join("x") !== "2560x1600")
      throw new Error(`Screenshot provenance mismatch: ${file}`);
    selections.push({
      source: `${folder}/${file}`,
      file,
      sha256,
      pixels: capture.pixels,
      submissionBuildMatch: manifest.submissionBuildMatch,
    });
  }
}
// Refuse to merge into an existing kit, where obsolete images might remain.
await mkdir(target);
for (const [platform, data, folder] of [
  ["mac", mac, "app-store"],
  ["windows", windows, "windows-store"],
]) {
  const dir = path.join(target, platform);
  await mkdir(dir);
  await writeFile(path.join(dir, "metadata.json"), JSON.stringify(data, null, 2) + "\n");
  await copyFile(
    path.join(root, `notes/${folder}/review-notes.txt`),
    path.join(dir, "review-notes.txt"),
  );
  for (const [locale, fields] of Object.entries(data.localizations)) {
    const localeDir = path.join(dir, locale);
    await mkdir(localeDir);
    for (const [field, value] of Object.entries(fields)) {
      await writeFile(
        path.join(localeDir, `${field}.txt`),
        (Array.isArray(value) ? value.join("\n") : String(value)) + "\n",
      );
    }
  }
}
await mkdir(path.join(target, "mac/screenshots"));
for (const item of selections)
  await copyFile(path.join(root, item.source), path.join(target, "mac/screenshots", item.file));
await writeFile(
  path.join(target, "mac/screenshots/selection.json"),
  JSON.stringify(selections, null, 2) + "\n",
);
const pages = path.join(target, "pages-preview");
await mkdir(pages);
for (const name of ["privacy-ja", "privacy-en", "support"]) {
  const source = await read(`notes/app-store/${name}.md`);
  // Replace internal drafting links with a visible notice. Keep the original drafts in the repository.
  const publicText = source.replace(/^>.*(?:\r?\n|$)/m, "");
  const body = renderToStaticMarkup(
    React.createElement(
      Markdown,
      {
        components: {
          a: ({ href, children }) =>
            React.createElement(
              "a",
              { href: href?.replace(/^(privacy-ja|privacy-en|support)\.md$/, "$1.html") },
              children,
            ),
        },
      },
      publicText,
    ),
  );
  await writeFile(
    path.join(pages, `${name}.html`),
    `<!doctype html><html lang="${name === "privacy-en" ? "en" : "ja"}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Tanzakoo — ${name}</title><style>body{max-width:760px;margin:40px auto;padding:0 24px;font:17px/1.8 system-ui;color:#263d32;background:#fafbf7}a{color:#285e46}aside{padding:16px;background:#fff0bf}h1,h2{line-height:1.3}nav{display:flex;gap:24px;flex-wrap:wrap}</style><nav><a href="support.html">Support</a><a href="privacy-ja.html">プライバシー</a><a href="privacy-en.html">Privacy</a></nav><aside>公開前の確認用原稿 / Draft for review. Not a published policy.</aside><main>${body}</main></html>`,
  );
}
await writeFile(
  path.join(target, "readiness.json"),
  JSON.stringify(
    {
      status: "draft-not-submitted",
      macFieldChecks: checks,
      windowsFieldChecks: windowsChecks,
      macScreenshotCount: selections.length,
      windowsScreenshots: "not-captured-do-not-reuse-mac-images",
      remaining: [
        "Final signed build and screenshot match",
        "Approve and publish privacy/support pages; add in-app policy link",
        "Finalize privacy declarations and retention operations",
        "Private review code and contact",
        "Windows packaged installation, certification and native screenshots",
        "Store pricing, distribution, age rating and final submission approval",
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(`Prepared draft listing kit: ${target}`);
