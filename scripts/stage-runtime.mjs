import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = readFileSync(join(root, "mise.toml"), "utf8").match(/node\s*=\s*"([^"]+)"/)?.[1];
if (process.versions.node !== version) throw new Error(`Use mise Node ${version}`);
const destination = join(root, "src-tauri/resources/agent-runtime");
const deployment = join(root, ".local", `runtime-deploy-${Date.now()}`);
// pnpm owns the dependency layout. Never copy a developer's entire node_modules.
if (existsSync(destination))
  throw new Error(
    "Runtime already staged. Remove src-tauri/resources/agent-runtime before staging again.",
  );
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("Run with mise exec -- pnpm runtime:stage");
const result = spawnSync(
  /\.[cm]?js$/.test(pnpm) ? process.execPath : pnpm,
  [
    ...(/\.[cm]?js$/.test(pnpm) ? [pnpm] : []),
    "--filter",
    "@tanzakoo/agent-runtime",
    "deploy",
    "--prod",
    "--config.node-linker=hoisted",
    deployment,
  ],
  { cwd: root, stdio: "inherit" },
);
if (result.error || result.status !== 0)
  throw new Error("pnpm deploy failed", { cause: result.error });
// Use a flat deployment and materialize any remaining links before bundling.
cpSync(deployment, destination, { recursive: true, dereference: true });
const packageVersion = (name) =>
  JSON.parse(readFileSync(join(destination, "node_modules", name, "package.json"), "utf8")).version;
const codexVersion = packageVersion("@openai/codex");
if (codexVersion !== "0.153.4")
  throw new Error("Update the bundled Codex LICENSE and NOTICE for the resolved version.");
const bin = join(destination, "bin");
mkdirSync(bin, { recursive: true });
cpSync(process.execPath, join(bin, process.platform === "win32" ? "node.exe" : "node"));
const nodeRoot =
  process.platform === "win32"
    ? dirname(process.execPath)
    : resolve(dirname(process.execPath), "..");
const license = join(nodeRoot, "LICENSE");
if (!existsSync(license))
  throw new Error("Node LICENSE was not found; do not distribute this staging directory.");
cpSync(license, join(destination, "NODE-LICENSE.txt"));
writeFileSync(
  join(destination, "runtime.json"),
  JSON.stringify(
    {
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      codexAcp: packageVersion("@agentclientprotocol/codex-acp"),
      codex: codexVersion,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Staged ${process.platform}/${process.arch} runtime at ${destination}`);
