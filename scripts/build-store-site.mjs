import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicPages, renderPage } from "./store-site.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.resolve(process.argv[2] || ".local/store-site");
// A fresh folder and an explicit allowlist prevent private submission material
// or obsolete files from accidentally entering the Pages artifact.
const rendered = await Promise.all(
  publicPages.map(async (page) => ({
    name: page.name,
    html: renderPage(page, await readFile(path.join(root, page.source), "utf8")),
  })),
);
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output);
for (const page of rendered) await writeFile(path.join(output, `${page.name}.html`), page.html);
await copyFile(path.join(root, "site/style.css"), path.join(output, "style.css"));
await writeFile(path.join(output, ".nojekyll"), "");
console.log(`Built ${rendered.length} public pages: ${output}`);
