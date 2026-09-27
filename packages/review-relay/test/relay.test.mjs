import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { Ledger } from "../src/ledger.mjs";
import { createRelay } from "../src/server.mjs";

const model = "fixture-model";
const completion = (usage = { input_tokens: 10, output_tokens: 5 }) =>
  `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_fixture", usage } })}\n\n`;
const eventResponse = () =>
  new Response(completion(), { headers: { "content-type": "text/event-stream" } });

function setup(options = {}) {
  const ledger = new Ledger(":memory:");
  const grant = ledger.issue({ model, expires: Date.now() + 60_000, maxRequests: 10 });
  const calls = [];
  const app = createRelay({
    ledger,
    apiKey: "fixture-upstream-secret",
    models: [model],
    intervalMs: 0,
    fetchImpl: async (...args) => {
      calls.push(args);
      return eventResponse();
    },
    ...options,
  });
  const inject = (body = {}, token = grant.token) =>
    app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: { authorization: `Bearer ${token}` },
      payload: { model, input: [], stream: true, ...body },
    });
  return {
    ledger,
    grant,
    app,
    calls,
    inject,
    async close() {
      await app.close();
      ledger.close();
    },
  };
}

test("relay forwards SSE with server credentials, restricts hosted tools and request options", async () => {
  const f = setup();
  try {
    const response = await f.inject({
      tools: [{ type: "web_search" }, { type: "function", name: "create_candidate" }],
      input: [
        {
          type: "additional_tools",
          tools: [
            { type: "mcp", server_url: "https://invalid.example" },
            { type: "custom", name: "exec" },
          ],
        },
      ],
      store: true,
      service_tier: "priority",
      max_output_tokens: 100_000,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, completion());
    assert.equal(f.calls.length, 1);
    const [url, options] = f.calls[0];
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.headers.Authorization, "Bearer fixture-upstream-secret");
    assert.equal(options.redirect, "error");
    assert.ok(!JSON.stringify(options).includes(f.grant.token));
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.equal(body.service_tier, "default");
    assert.equal(body.max_output_tokens, 8192);
    assert.deepEqual(
      body.tools.map((t) => t.name),
      ["create_candidate"],
    );
    assert.deepEqual(
      body.input[0].tools.map((t) => t.name),
      ["exec"],
    );
    assert.equal(f.ledger.list()[0].used, 1);
    assert.equal(f.ledger.list()[0].input_tokens, 10);
    assert.ok(!JSON.stringify(f.ledger.list()).includes(f.grant.token));
  } finally {
    await f.close();
  }
});

test("invalid auth, expiry, model, stateful input and oversized bodies never reach upstream", async () => {
  const f = setup();
  try {
    assert.equal((await f.inject({}, "bad")).statusCode, 401);
    assert.equal((await f.inject({ model: "other" })).statusCode, 403);
    assert.equal((await f.inject({ previous_response_id: "old" })).statusCode, 400);
    assert.equal(
      (await f.inject({ input: [{ type: "input_image", image_url: "https://invalid.example" }] }))
        .statusCode,
      400,
    );
    assert.equal((await f.inject({ instructions: "x".repeat(256 * 1024) })).statusCode, 413);
    assert.equal((await f.app.inject({ method: "GET", url: "/v1/models" })).statusCode, 404);
    const status = await f.app.inject({
      url: "/review/status",
      headers: { authorization: `Bearer ${f.grant.token}` },
    });
    assert.equal(status.json().remainingRequests, 10);
    f.ledger.db.prepare("UPDATE grants SET expires=0").run();
    assert.equal((await f.inject()).statusCode, 403);
    assert.equal(f.calls.length, 0);
  } finally {
    await f.close();
  }
});

test("attempt caps survive reopen; secrets are hashed; revocation is persistent", () => {
  const tempRoot = realpathSync(tmpdir());
  const dir = mkdtempSync(join(tempRoot, "tanzakoo-relay-ledger-"));
  const path = join(dir, "ledger.db");
  let ledger;
  try {
    ledger = new Ledger(path);
    const grant = ledger.issue({ model, expires: Date.now() + 60_000, maxRequests: 1 });
    const reservation = ledger.reserve(grant.token, model, 1000, 0);
    assert.throws(() => ledger.reserve(grant.token, model, 1000, 0), /grant_limit_reached/);
    ledger.finish(reservation);
    ledger.close();
    ledger = new Ledger(path);
    assert.throws(() => ledger.reserve(grant.token, model, 1000, 0), /grant_limit_reached/);
    assert.ok(!readFileSync(path).includes(Buffer.from(grant.token)));
    assert.equal(ledger.revoke(grant.id), true);
    assert.throws(() => ledger.authenticate(grant.token), /invalid_credentials/);
  } finally {
    ledger?.close();
    assert.ok(realpathSync(dir).startsWith(`${tempRoot}${sep}tanzakoo-relay-ledger-`));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("concurrent ledger connections cannot spend the same last attempt", () => {
  const tempRoot = realpathSync(tmpdir());
  const dir = mkdtempSync(join(tempRoot, "tanzakoo-relay-race-"));
  const path = join(dir, "ledger.db");
  const first = new Ledger(path);
  const second = new Ledger(path);
  try {
    const grant = first.issue({ model, expires: Date.now() + 60_000, maxRequests: 1 });
    first.reserve(grant.token, model, 1000, 0);
    assert.throws(() => second.reserve(grant.token, model, 1000, 0), /grant_limit_reached/);
  } finally {
    first.close();
    second.close();
    assert.ok(realpathSync(dir).startsWith(`${tempRoot}${sep}tanzakoo-relay-race-`));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("upstream failure is sanitized and consumes an attempt without automatic retry", async () => {
  const f = setup({
    fetchImpl: async () => new Response("fixture-upstream-secret", { status: 401 }),
  });
  try {
    const response = await f.inject();
    assert.equal(response.statusCode, 502);
    assert.ok(!response.body.includes("fixture-upstream-secret"));
    assert.equal(f.ledger.list()[0].used, 1);
  } finally {
    await f.close();
  }
});

test("rate limits and crashed reservations remain closed until the lease expires", () => {
  let now = 100_000;
  const ledger = new Ledger(":memory:", () => now);
  try {
    const grant = ledger.issue({ model, expires: 200_000, maxRequests: 5 });
    const first = ledger.reserve(grant.token, model, 1000, 2000);
    ledger.finish(first);
    assert.throws(() => ledger.reserve(grant.token, model, 1000, 2000), /grant_limit_reached/);
    now += 2000;
    const second = ledger.reserve(grant.token, model, 1000, 2000);
    now += 2000;
    assert.throws(() => ledger.reserve(grant.token, model, 1000, 2000), /grant_limit_reached/);
    now += 4001;
    const third = ledger.reserve(grant.token, model, 1000, 2000);
    ledger.finish(second); // A late completion must not release a newer reservation.
    assert.throws(() => ledger.reserve(grant.token, model, 1000, 2000), /grant_limit_reached/);
    ledger.finish(third);
    assert.equal(ledger.list()[0].used, 3);
  } finally {
    ledger.close();
  }
});

test("revoking a grant aborts its active upstream request", async () => {
  let markStarted;
  const started = new Promise((done) => {
    markStarted = done;
  });
  const f = setup({
    fetchImpl: (_url, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        markStarted();
      }),
  });
  try {
    const pending = f.inject();
    await started;
    f.ledger.revoke(f.grant.id);
    assert.equal((await pending).statusCode, 502);
    assert.equal(f.ledger.list()[0].used, 1);
    assert.equal((await f.inject()).statusCode, 401);
  } finally {
    await f.close();
  }
});

test("a stalled upstream is aborted at the request deadline", async () => {
  const f = setup({
    timeoutMs: 30,
    fetchImpl: (_url, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("deadline")), { once: true });
      }),
  });
  try {
    assert.equal((await f.inject()).statusCode, 502);
    assert.equal(f.ledger.list()[0].used, 1);
  } finally {
    await f.close();
  }
});

test("disconnect propagates cancellation and keeps the attempt debit", async () => {
  let upstreamAborted;
  const cancelled = new Promise((done) => {
    upstreamAborted = done;
  });
  const f = setup({
    fetchImpl: async (_url, { signal }) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"type":"response.created"}\n\n'));
            signal.addEventListener(
              "abort",
              () => {
                controller.error(new Error("Cancelled"));
                upstreamAborted();
              },
              { once: true },
            );
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  });
  try {
    await f.app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${f.app.server.address().port}/v1/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${f.grant.token}`, "content-type": "application/json" },
      body: JSON.stringify({ model, input: [], stream: true }),
    });
    const reader = response.body.getReader();
    await reader.read();
    controller.abort();
    await Promise.race([
      cancelled,
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("Cancellation did not propagate")), 2000);
        timer.unref();
      }),
    ]);
    assert.equal(f.ledger.list()[0].used, 1);
  } finally {
    await f.close();
  }
});
