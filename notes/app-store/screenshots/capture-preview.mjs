// Playwright is supplied externally; this adds no project dependency.
// Usage: node capture-preview.mjs <playwright-module-url> <base-url> <output-directory>
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const [moduleUrl, baseUrl, outputDirectory] = process.argv.slice(2);
if (!moduleUrl || !baseUrl || !outputDirectory) throw new Error("Missing capture arguments");
const base = new URL(baseUrl);
if (!["localhost", "127.0.0.1"].includes(base.hostname)) {
  throw new Error("Use a local preview server");
}
const { chromium } = await import(moduleUrl);
const browser = await chromium.launch({ channel: "msedge", headless: true });
await mkdir(outputDirectory, { recursive: true });
try {
  for (const language of ["ja", "en"]) {
    for (const [index, scene] of ["board", "proposal", "export"].entries()) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        locale: language === "ja" ? "ja-JP" : "en-US",
        colorScheme: "light",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const url = new URL("notes/app-store/screenshots/preview.html", base);
      url.searchParams.set("lang", language);
      url.searchParams.set("scene", scene);
      await page.goto(url.href, { waitUntil: "domcontentloaded" });
      await page
        .getByRole("heading", { name: language === "ja" ? "アイデアの山" : "Ideas", exact: true })
        .waitFor();
      await page.evaluate(() => document.fonts.ready);
      if (scene === "proposal") {
        const chatHandle = await page
          .locator('[data-slot="resizable-handle"]')
          .nth(1)
          .boundingBox();
        assert.ok(chatHandle);
        await page.mouse.move(
          chatHandle.x + chatHandle.width / 2,
          chatHandle.y + chatHandle.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(1148, chatHandle.y + chatHandle.height / 2, { steps: 12 });
        await page.mouse.up();
      }
      const handle = await page.locator('[data-slot="resizable-handle"]').first().boundingBox();
      assert.ok(handle);
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(scene === "proposal" ? 860 : 910, handle.y + handle.height / 2, {
        steps: 12,
      });
      await page.mouse.up();
      if (scene === "proposal") {
        await page
          .getByRole("button", { name: language === "ja" ? "適用する" : "Apply", exact: true })
          .scrollIntoViewIfNeeded();
      }
      if (scene === "export") {
        await page
          .getByRole("button", { name: language === "ja" ? "エクスポート" : "Export", exact: true })
          .click();
        await page.getByRole("dialog").waitFor();
      }
      // Let CSS transitions finish, then capture the rendered app without edits.
      await page.waitForTimeout(350);
      await page.locator(".board-grid").evaluate((element) => {
        element.scrollLeft = 0;
      });
      const board = await page.locator(".board-grid").evaluate((element) => ({
        width: element.clientWidth,
        content: element.scrollWidth,
      }));
      assert.ok(board.content <= board.width + 1, JSON.stringify(board));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 1440);
      assert.deepEqual(errors, []);
      const name = `${language}-${String(index + 1).padStart(2, "0")}-${scene}-DRAFT.png`;
      await page.screenshot({ path: resolve(outputDirectory, name), omitBackground: false });
      console.log(name);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
