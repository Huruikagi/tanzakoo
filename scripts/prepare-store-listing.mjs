// Prepare local drafts and original screenshots. Never publish or submit.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicPages, renderPage } from "./store-site.mjs";

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
const windowsFolder = "notes/windows-store/screenshots/native/20261002";
const windowsSelection = JSON.parse(await read(`${windowsFolder}/selection.json`));
const windowsSelections = [];
for (const language of ["ja", "en"]) {
  for (const [number, scene] of [
    ["01", "board"],
    ["02", "memory"],
    ["03", "export"],
  ]) {
    const file = `${language}-${number}-${scene}-windows.png`;
    const selected = windowsSelection.captures.filter((item) => item.file === file);
    if (selected.length !== 1) throw new Error(`Missing or duplicate Windows screenshot: ${file}`);
    const item = selected[0];
    const bytes = await readFile(path.join(root, windowsFolder, file));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const record = JSON.parse(await read(`${windowsFolder}/${item.record}`));
    const capture = record.captures.find((entry) => entry.file === file);
    const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (
      !isPng ||
      bytes.length < 33 ||
      bytes.readUInt32BE(16) < 1366 ||
      bytes.readUInt32BE(20) < 768 ||
      bytes.length >= 50 * 1024 * 1024 ||
      item.sha256 !== sha256 ||
      capture?.sha256 !== sha256 ||
      item.pixels[0] !== bytes.readUInt32BE(16) ||
      item.pixels[1] !== bytes.readUInt32BE(20) ||
      capture.pixels.join("x") !== item.pixels.join("x") ||
      item.contentReview !== "passed" ||
      record.executableSHA256 !== windowsSelection.executableSHA256
    ) {
      throw new Error(`Windows screenshot provenance or image mismatch: ${file}`);
    }
    windowsSelections.push({ ...item, source: `${windowsFolder}/${file}` });
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
await mkdir(path.join(target, "windows/screenshots"));
for (const item of windowsSelections)
  await copyFile(path.join(root, item.source), path.join(target, "windows/screenshots", item.file));
await writeFile(
  path.join(target, "windows/screenshots/selection.json"),
  JSON.stringify(windowsSelections, null, 2) + "\n",
);
const pages = path.join(target, "pages-preview");
await mkdir(pages);
for (const page of publicPages) {
  await writeFile(
    path.join(pages, `${page.name}.html`),
    renderPage(page, await read(page.source), { preview: true }),
  );
}
await copyFile(path.join(root, "site/style.css"), path.join(pages, "style.css"));
await writeFile(
  path.join(target, "readiness.json"),
  JSON.stringify(
    {
      status: "draft-not-submitted",
      macFieldChecks: checks,
      windowsFieldChecks: windowsChecks,
      macScreenshotCount: selections.length,
      windowsScreenshotCount: windowsSelections.length,
      windowsScreenshots: "native-captured-reviewed-final-build-match-pending",
      remaining: [
        "Final signed build and screenshot match",
        "Verify public privacy/support URLs and in-app links in the final signed build",
        "Finalize store privacy declarations and provider settings checks",
        "Private review code and contact",
        "Windows packaged installation and certification",
        "Store pricing, distribution, age rating and final submission approval",
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(`Prepared draft listing kit: ${target}`);
