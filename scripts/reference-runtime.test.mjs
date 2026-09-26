// Offline contract check against the pinned Codex binary. No account or real model call.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(
  readFileSync(join(root, "packages/agent-runtime/reference-policy.json"), "utf8"),
);
const require = createRequire(import.meta.url);
const adapterRequire = createRequire(require.resolve("@agentclientprotocol/codex-acp"));
const codex = join(dirname(adapterRequire.resolve("@openai/codex/package.json")), "bin/codex.js");

for (const model of ["gpt-5.4", "gpt-6-astra"]) {
  test(
    `reference policy removes filesystem escape tools and blocks patches (${model})`,
    { timeout: 45_000 },
    async () => {
      const tempRoot = realpathSync(tmpdir());
      const fixture = mkdtempSync(join(tempRoot, "tanzakoo-reference-runtime-"));
      const requests = [];
      const failures = [];
      let child;
      let closed;
      mkdirSync(join(fixture, "home"));
      writeFileSync(join(fixture, "private.txt"), "unchanged\n");
      const server = createServer(async (request, response) => {
        try {
          assert.equal(request.url, "/v1/responses");
          let body = "";
          for await (const chunk of request) body += chunk;
          const payload = JSON.parse(body);
          requests.push(payload);
          assert.ok(requests.length <= 2, "unexpected retry or extra model turn");
          // apply_patch remains advertised by Codex, but must fail before file access.
          // Fail closed on newly introduced built-in tools; review them on runtime upgrades.
          const toolGroups =
            payload.tools ??
            payload.input
              .filter((item) => item.type === "additional_tools")
              .flatMap((item) => item.tools);
          const tools = toolGroups.flatMap((tool) => tool.tools ?? [tool]);
          const allowed = new Set([
            "request_user_input",
            "request_user_input_async",
            "apply_patch",
            "web_search",
            "exec",
            "wait",
            "sleep",
            "run",
            "followup_task",
            "interrupt_agent",
            "list_agents",
            "send_message",
            "spawn_agent",
            "wait_agent",
          ]);
          assert.ok(
            tools.every((tool) => allowed.has(tool.name ?? tool.type)),
            `unexpected tools: ${tools.map((tool) => tool.name ?? tool.type).join(", ")}`,
          );
          const execTool = tools.find((tool) => tool.name === "exec");
          if (execTool) {
            const nested = [
              ...execTool.description.matchAll(/declare const tools: \{ (\w+)\(/g),
            ].map((match) => match[1]);
            assert.deepEqual(nested.sort(), ["apply_patch", "clock__curr_time"]);
          } else assert.ok(tools.some((tool) => tool.name === "apply_patch"));
          const item = {
            type: "custom_tool_call",
            id: "tool_test",
            call_id: "call_test",
            name: "apply_patch",
            input:
              "*** Begin Patch\n*** Update File: private.txt\n@@\n-unchanged\n+changed\n*** End Patch",
          };
          if (execTool) {
            item.input = `text(await tools.apply_patch(${JSON.stringify(item.input)}));`;
            item.name = "exec";
            item.namespace = "functions";
          }
          const events =
            requests.length === 1
              ? [{ type: "response.output_item.done", output_index: 0, item }]
              : [];
          events.push({
            type: "response.completed",
            response: {
              id: "resp_test",
              status: "completed",
              output: requests.length === 1 ? [item] : [],
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            },
          });
          response.writeHead(200, { "content-type": "text/event-stream" });
          response.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
        } catch (error) {
          failures.push(error);
          response.writeHead(400);
          response.end("fixture request failed");
        }
      });
      try {
        await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
        const args = [
          codex,
          "exec",
          "--skip-git-repo-check",
          "--ephemeral",
          "--sandbox",
          "read-only",
          "--model",
          model,
        ];
        const config = (key, value) => args.push("-c", `${key}=${JSON.stringify(value)}`);
        for (const [key, value] of Object.entries(policy)) {
          if (typeof value === "object") {
            for (const [subkey, setting] of Object.entries(value))
              config(`${key}.${subkey}`, setting);
          } else config(key, value);
        }
        config("model_provider", "fixture");
        config("model_providers.fixture.name", "fixture");
        config("model_providers.fixture.base_url", `http://127.0.0.1:${server.address().port}/v1`);
        config("model_providers.fixture.wire_api", "responses");
        config("model_providers.fixture.requires_openai_auth", false);
        args.push("--", "Only reply OK.");
        const env = { ...process.env, CODEX_HOME: join(fixture, "home") };
        for (const key of [
          "CODEX_API_KEY",
          "OPENAI_API_KEY",
          "CODEX_ACCESS_TOKEN",
          "OPENAI_BASE_URL",
          "CODEX_CONFIG",
          "NODE_OPTIONS",
        ])
          delete env[key];
        child = spawn(process.execPath, args, {
          cwd: fixture,
          env,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout.resume();
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr = (stderr + chunk).slice(-2000);
        });
        closed = new Promise((done, reject) => {
          child.once("close", done);
          child.once("error", reject);
        });
        const timeout = setTimeout(() => child.kill(), 30_000);
        let code;
        try {
          code = await closed;
        } finally {
          clearTimeout(timeout);
        }
        assert.deepEqual(failures, []);
        assert.equal(code, 0, stderr);
        assert.equal(requests.length, 2, stderr);
        const output = requests[1].input.find((item) => item.type === "custom_tool_call_output");
        assert.match(JSON.stringify(output?.output ?? ""), /read-only sandbox/);
        assert.equal(readFileSync(join(fixture, "private.txt"), "utf8"), "unchanged\n");
      } finally {
        if (child?.exitCode === null) child.kill();
        if (closed) await closed;
        server.closeAllConnections();
        await new Promise((done) => server.close(done));
        const resolved = realpathSync(fixture);
        assert.ok(resolved.startsWith(`${tempRoot}${sep}tanzakoo-reference-runtime-`));
        rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    },
  );
}
