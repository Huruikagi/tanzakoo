// Uses the actual managed wrapper and pinned ACP/Codex against loopback fixtures.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, existsSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { startAcp } from "./lib/acp-client.mjs";
import { Ledger } from "../packages/review-relay/src/ledger.mjs";
import { createRelay } from "../packages/review-relay/src/server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function readAfterExit(path) {
  // Windows can briefly retain a child's file lock after taskkill has returned.
  // Retry the read, never skip the credential-persistence check.
  for (let attempt = 0; ; attempt++) {
    try {
      return await readFile(path);
    } catch (error) {
      if (error.code !== "EBUSY" || attempt >= 10) throw error;
      await delay(100);
    }
  }
}
for (const route of [
  "gateway",
  "providers",
  "gateway-board",
  "gateway-luna",
  "gateway-custom-model",
  "plan-board",
]) {
  test(
    `review ${route}: fresh credentials and real ACP streaming`,
    { timeout: 60_000 },
    async () => {
      const tempRoot = realpathSync(tmpdir());
      const dir = mkdtempSync(join(tempRoot, "tanzakoo-review-"));
      const home = join(dir, "home");
      const boardPath = join(dir, "board.db");
      const planMode = route === "plan-board";
      const boardMode = route === "gateway-board" || planMode;
      const model =
        route === "gateway-custom-model"
          ? "review-fixture-model"
          : boardMode || route === "gateway-luna"
            ? "gpt-6-luna"
            : "gpt-6-astra";
      mkdirSync(home);
      const requests = [];
      const failures = [];
      const ledger = new Ledger(":memory:");
      const { token } = ledger.issue({
        model,
        expires: Date.now() + 60_000,
        maxRequests: 10,
      });
      let relay;
      const server = createServer(async (request, response) => {
        try {
          assert.equal(request.url, "/v1/responses");
          assert.equal(request.headers.authorization, "Bearer fixture-upstream-key");
          let body = "";
          for await (const chunk of request) body += chunk;
          requests.push(JSON.parse(body));
          if (planMode) {
            assert.equal(request.headers.originator, "Tanzakoo");
            const input = requests.at(-1);
            assert.equal(input.store, false);
            assert.equal(input.stream, true);
            for (const key of [
              "previous_response_id",
              "background",
              "conversation",
              "max_output_tokens",
              "temperature",
              "metadata",
              "safety_identifier",
              "prompt_cache_retention",
            ])
              assert.equal(input[key], undefined, `SIWC unsupported field: ${key}`);
            const tools = [
              ...(input.tools ?? []),
              ...input.input.filter((i) => i.type === "additional_tools").flatMap((i) => i.tools),
            ];
            assert.ok(!JSON.stringify(tools).includes('"type":"tool_search"'));
          }
          let item = {
            id: `msg_review_${requests.length}`,
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "REVIEW_OK", annotations: [] }],
          };
          if (boardMode && requests.length <= 2) {
            let code;
            if (requests.length === 1) {
              const groups =
                requests[0].tools ??
                requests[0].input
                  .filter((i) => i.type === "additional_tools")
                  .flatMap((i) => i.tools);
              assert.ok(
                groups.some((g) => g.tools?.some((t) => t.name === "exec")),
                "code-mode entry point missing",
              );
              code =
                'text(await tools.mcp__tanzakoo__create_candidate({title:"審査接続の候補",body:"元の本文"}));';
            } else {
              const db = new DatabaseSync(boardPath, { readOnly: true });
              let card;
              try {
                card = JSON.parse(
                  db.prepare("SELECT data FROM records WHERE kind='card'").get().data,
                );
              } finally {
                db.close();
              }
              code = `text(await tools.mcp__tanzakoo__propose_card_change(${JSON.stringify({ card_id: card.id, base_revision: card.revision, title: card.title, body: "提案された本文", reason: "審査接続の検証" })}));`;
            }
            item = {
              id: `tool_${requests.length}`,
              type: "custom_tool_call",
              call_id: `call_${requests.length}`,
              name: "exec",
              namespace: "functions",
              input: code,
            };
          }
          response.writeHead(200, { "content-type": "text/event-stream" });
          response.end(
            [
              ...(item.type === "message"
                ? [
                    {
                      type: "response.output_item.added",
                      output_index: 0,
                      item: { ...item, content: [] },
                    },
                    {
                      type: "response.output_text.delta",
                      item_id: item.id,
                      output_index: 0,
                      content_index: 0,
                      delta: "REVIEW_OK",
                    },
                  ]
                : []),
              { type: "response.output_item.done", output_index: 0, item },
              {
                type: "response.completed",
                response: {
                  id: "resp_review",
                  status: "completed",
                  output: [item],
                  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
                },
              },
            ]
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join(""),
          );
        } catch (error) {
          failures.push(error);
          response.writeHead(400).end();
        }
      });
      let client;
      try {
        await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
        relay = createRelay({
          ledger,
          apiKey: "fixture-upstream-key",
          models: [model],
          intervalMs: 0,
          testUpstream: `http://127.0.0.1:${server.address().port}/v1/responses`,
        });
        await relay.listen({ host: "127.0.0.1", port: 0 });
        const launch = () =>
          startAcp({
            entry:
              process.env.TANZAKOO_TEST_RUNTIME_ENTRY ??
              join(root, "packages/agent-runtime/codex.mjs"),
            home,
            cwd: dir,
            env: planMode ? { TANZAKOO_PLAN_MODEL: model } : { TANZAKOO_REVIEW_MODEL: model },
            onRequest: (request) => {
              assert.equal(request.method, "session/request_permission");
              const option = request.params.options.find((o) => o.kind === "allow_once");
              assert.ok(option);
              return { outcome: { outcome: "selected", optionId: option.optionId } };
            },
          });
        client = launch();
        const initialized = await client.request("initialize", {
          protocolVersion: 1,
          clientInfo: { name: planMode ? "Tanzakoo" : "tanzakoo-review-test", version: "1" },
        });
        assert.equal(initialized.protocolVersion, 1);
        const gateway = {
          baseUrl: `http://127.0.0.1:${planMode ? server.address().port : relay.server.address().port}/v1`,
          headers: { Authorization: `Bearer ${planMode ? "fixture-upstream-key" : token}` },
          providerName: "Review fixture",
        };
        if (route.startsWith("gateway") || planMode)
          await client.request("authenticate", { methodId: "gateway", _meta: { gateway } });
        else
          await client.request("providers/set", {
            providerId: "openai",
            apiType: "openai",
            ...gateway,
          });
        const binary =
          process.env.TANZAKOO_TEST_MCP_BINARY ??
          join(
            root,
            "src-tauri/target/debug",
            process.platform === "win32" ? "tanzakoo.exe" : "tanzakoo",
          );
        if (boardMode)
          assert.ok(existsSync(binary), "Build the current Tanzakoo binary before this test");
        const mcpServers = boardMode
          ? [{ name: "tanzakoo", command: binary, args: ["--mcp", boardPath, "codex"], env: [] }]
          : [];
        const session = await client.request("session/new", { cwd: dir, mcpServers });
        assert.ok(session.sessionId);
        await client.request("session/set_config_option", {
          sessionId: session.sessionId,
          configId: "model",
          value: model,
        });
        assert.equal(requests.length, 0, "connection check must not send a model request");
        const result = await client.request("session/prompt", {
          sessionId: session.sessionId,
          prompt: [{ type: "text", text: "Only reply REVIEW_OK." }],
        });
        assert.equal(result.stopReason, "end_turn");
        assert.deepEqual(failures, []);
        assert.equal(requests.length, boardMode ? 3 : 1);
        assert.ok(requests.every((request) => request.model === model));
        assert.ok(
          client.notifications.some((m) => m.params?.update?.content?.text === "REVIEW_OK"),
        );
        assert.ok(!client.diagnostics().includes(token), "token leaked to stderr");
        if (model === "gpt-6-luna") {
          assert.doesNotMatch(
            JSON.stringify(client.notifications) + client.diagnostics(),
            /Model metadata for|fallback metadata/i,
            "the bundled Codex must recognize the review model without fallback metadata",
          );
        }
        if (boardMode) {
          const db = new DatabaseSync(boardPath, { readOnly: true });
          try {
            const cards = db
              .prepare("SELECT data FROM records WHERE kind='card'")
              .all()
              .map((r) => JSON.parse(r.data));
            assert.equal(cards.length, 1);
            assert.equal(cards[0].body, "元の本文");
            const proposals = db
              .prepare("SELECT data FROM records WHERE kind='proposal'")
              .all()
              .map((r) => JSON.parse(r.data));
            assert.equal(proposals.length, 1);
            assert.equal(proposals[0].state, "pending");
          } finally {
            db.close();
          }
        }
        await client.stop();
        // A restarted adapter needs the gateway configured again before restoring a session.
        client = launch();
        await client.request("initialize", {
          protocolVersion: 1,
          ...(planMode ? { clientInfo: { name: "Tanzakoo", version: "1" } } : {}),
        });
        await client.request("authenticate", { methodId: "gateway", _meta: { gateway } });
        await client.request("session/load", {
          sessionId: session.sessionId,
          cwd: dir,
          mcpServers,
        });
        assert.equal(requests.length, boardMode ? 3 : 1);
        await client.request("session/prompt", {
          sessionId: session.sessionId,
          prompt: [{ type: "text", text: "Reply REVIEW_OK again." }],
        });
        assert.equal(requests.length, boardMode ? 4 : 2);
        if (model === "gpt-6-luna") {
          assert.doesNotMatch(
            JSON.stringify(client.notifications) + client.diagnostics(),
            /Model metadata for|fallback metadata/i,
            "restored review sessions must also recognize the model",
          );
        }
        await client.stop();
        for (const file of readdirSync(home, { recursive: true, withFileTypes: true })) {
          if (file.isFile())
            assert.ok(
              !(await readAfterExit(join(file.parentPath, file.name))).includes(Buffer.from(token)),
              "review token persisted in Codex state",
            );
          if (planMode && file.isFile())
            assert.ok(
              !(await readAfterExit(join(file.parentPath, file.name))).includes(
                Buffer.from("fixture-upstream-key"),
              ),
              "plan token persisted in Codex state",
            );
        }
      } catch (error) {
        // This fixture has no user data or external credentials. Keep the local
        // grant out of diagnostics while exposing signed-runtime tool failures.
        const detail = JSON.stringify(client?.notifications ?? []).slice(-12_000);
        error.message += `\nACP diagnostics: ${client?.diagnostics() ?? ""}\nNotifications: ${detail}`;
        error.message = error.message.replaceAll(token, "[REDACTED]");
        throw error;
      } finally {
        await client?.stop();
        await relay?.close();
        ledger.close();
        server.closeAllConnections();
        await new Promise((done) => server.close(done));
        assert.ok(realpathSync(dir).startsWith(`${tempRoot}${sep}tanzakoo-review-`));
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    },
  );
}
