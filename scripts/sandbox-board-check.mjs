// Fixed local fixture, launched by the signed sandbox parent with inherited Node.
// No account, real API key, or external AI request is used.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startAcp } from "./lib/acp-client.mjs";

const [runtime, helper, canary] = process.argv.slice(2);
assert.throws(
  () => readFileSync(canary),
  (error) => ["EACCES", "EPERM"].includes(error.code),
);
execFileSync(helper, ["--sandbox-denial-check", canary], { timeout: 10_000 });
const work = mkdtempSync(join(tmpdir(), "board-"));
const home = join(work, "home");
mkdirSync(home);
const board = join(work, "board.db");
const token = "sandbox-fixture-token";
const failures = [];
let requests = 0;
let client;
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.url, "/v1/responses");
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    let body = "";
    for await (const chunk of request) body += chunk;
    assert.equal(JSON.parse(body).model, "gpt-6-luna");
    requests++;
    let code;
    if (requests === 1) {
      code =
        'text(await tools.mcp__tanzakoo__create_candidate({title:"Sandbox test",body:"Original"}));';
    } else if (requests === 2) {
      const db = new DatabaseSync(board, { readOnly: true });
      try {
        const card = JSON.parse(
          db.prepare("SELECT data FROM records WHERE kind='card'").get().data,
        );
        code = `text(await tools.mcp__tanzakoo__propose_card_change(${JSON.stringify({ card_id: card.id, base_revision: card.revision, title: card.title, body: "Proposed", reason: "Sandbox test" })}));`;
      } finally {
        db.close();
      }
    }
    const item = code
      ? {
          id: `tool_${requests}`,
          type: "custom_tool_call",
          call_id: `call_${requests}`,
          name: "exec",
          namespace: "functions",
          input: code,
        }
      : {
          id: `msg_${requests}`,
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "SANDBOX_OK", annotations: [] }],
        };
    const events = [
      ...(code
        ? []
        : [
            { type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
            {
              type: "response.output_text.delta",
              item_id: item.id,
              output_index: 0,
              content_index: 0,
              delta: "SANDBOX_OK",
            },
          ]),
      { type: "response.output_item.done", output_index: 0, item },
      {
        type: "response.completed",
        response: {
          id: `resp_${requests}`,
          status: "completed",
          output: [item],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      },
    ];
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  } catch (error) {
    failures.push(error);
    response.writeHead(400).end();
  }
});
try {
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  const gateway = {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    headers: { Authorization: `Bearer ${token}` },
    providerName: "Sandbox fixture",
  };
  const mcpServers = [
    { name: "tanzakoo", command: helper, args: ["--mcp", board, "codex"], env: [] },
  ];
  let session;
  for (const resume of [false, true]) {
    client = startAcp({
      entry: join(runtime, "codex.mjs"),
      home,
      cwd: work,
      env: { TANZAKOO_REVIEW_MODEL: "gpt-6-luna" },
      onRequest: (request) => {
        assert.equal(request.method, "session/request_permission");
        const option = request.params.options.find((o) => o.kind === "allow_once");
        assert.ok(option);
        return { outcome: { outcome: "selected", optionId: option.optionId } };
      },
    });
    await client.request("initialize", { protocolVersion: 1 });
    await client.request("authenticate", { methodId: "gateway", _meta: { gateway } });
    if (resume)
      await client.request("session/load", { sessionId: session.sessionId, cwd: work, mcpServers });
    else {
      session = await client.request("session/new", { cwd: work, mcpServers });
      await client.request("session/set_config_option", {
        sessionId: session.sessionId,
        configId: "model",
        value: "gpt-6-luna",
      });
    }
    const result = await client.request(
      "session/prompt",
      { sessionId: session.sessionId, prompt: [{ type: "text", text: "Run the Sandbox check." }] },
      45_000,
    );
    assert.equal(result.stopReason, "end_turn");
    assert.deepEqual(failures, []);
    assert.equal(requests, resume ? 4 : 3);
    await client.stop();
  }
  const db = new DatabaseSync(board, { readOnly: true });
  try {
    const cards = db
      .prepare("SELECT data FROM records WHERE kind='card'")
      .all()
      .map((r) => JSON.parse(r.data));
    const proposals = db
      .prepare("SELECT data FROM records WHERE kind='proposal'")
      .all()
      .map((r) => JSON.parse(r.data));
    assert.equal(cards.length, 1);
    assert.equal(cards[0].body, "Original");
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].state, "pending");
  } finally {
    db.close();
  }
  for (const file of readdirSync(home, { recursive: true, withFileTypes: true })) {
    if (file.isFile())
      assert.ok(!readFileSync(join(file.parentPath, file.name)).includes(token), "Token persisted");
  }
  console.log(
    "Sandbox: external access denied in Node/MCP; real ACP/code-mode/card/proposal/resume PASS",
  );
} catch (error) {
  console.error(client?.diagnostics().replaceAll(token, "[REDACTED]"));
  console.error(
    JSON.stringify(client?.notifications).slice(-12_000).replaceAll(token, "[REDACTED]"),
  );
  throw error;
} finally {
  await client?.stop();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  rmSync(work, { recursive: true, force: true });
}
