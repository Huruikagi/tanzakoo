import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

for (const distribution of ["public-distribution", "app-sandbox"]) {
  const features = `personal-claude,${distribution}`;
  console.log(`Checking that ${features} cannot be built.`);
  // Reuse the build artifacts from the preceding Cargo tests. `cargo check`
  // needs separate metadata artifacts before it can reach the build.rs guard.
  const result = spawnSync(
    "cargo",
    [
      "build",
      "--lib",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--locked",
      "--features",
      features,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 600_000 },
  );
  try {
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, "A personal distribution build must fail");
    assert.match(result.stderr, /personal-claude cannot be included/);
  } catch (error) {
    process.stderr.write(`Build boundary check failed for ${features}.\n`);
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw error;
  }
}
console.log("Personal builds cannot enable public-distribution or app-sandbox.");
