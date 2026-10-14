import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

for (const distribution of ["public-distribution", "app-sandbox"]) {
  const result = spawnSync(
    "cargo",
    [
      "check",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--locked",
      "--features",
      `personal-claude,${distribution}`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 120_000 },
  );
  assert.ifError(result.error);
  assert.notEqual(result.status, 0, "A personal distribution build must fail");
  assert.match(result.stderr, /personal-claude cannot be included/);
}
console.log("Personal builds cannot enable public-distribution or app-sandbox.");
