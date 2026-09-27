import Fastify from "fastify";
import { createParser } from "eventsource-parser";
import { once } from "node:events";
import { RelayError } from "./ledger.mjs";

// Review supports local tools only. Hosted tools have separate cost/permission rules.
function localTools(tools) {
  return tools.flatMap((tool) => {
    if (tool.type === "namespace") return [{ ...tool, tools: localTools(tool.tools ?? []) }];
    return ["function", "custom"].includes(tool.type) ? [tool] : [];
  });
}
function assertTextInput(value) {
  if (!value || typeof value !== "object") return;
  if (
    [
      "input_image",
      "input_file",
      "input_audio",
      "input_video",
      "image_url",
      "video_url",
      "item_reference",
      "computer_screenshot",
    ].includes(value.type)
  )
    throw new RelayError(400, "text_input_required");
  for (const child of Object.values(value)) assertTextInput(child);
}

export function createRelay({
  ledger,
  apiKey,
  models,
  timeoutMs = 120_000,
  intervalMs = 1000,
  maxOutputTokens = 8192,
  testUpstream,
  fetchImpl = fetch,
}) {
  if (
    !apiKey ||
    !Array.isArray(models) ||
    models.length === 0 ||
    models.some((m) => !/^[a-zA-Z0-9._-]{1,100}$/.test(m))
  )
    throw new Error("API key and allowed models are required");
  for (const n of [timeoutMs, maxOutputTokens])
    if (!Number.isSafeInteger(n) || n < 1) throw new Error("Invalid limits");
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 0)
    throw new Error("Invalid request interval");
  let upstream = "https://api.openai.com/v1/responses";
  if (testUpstream) {
    const url = new URL(testUpstream);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.pathname !== "/v1/responses" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error("Test upstream must be an exact loopback Responses endpoint");
    upstream = url.href;
  }
  const app = Fastify({
    logger: false,
    bodyLimit: 256 * 1024,
    requestTimeout: 15_000,
    ajv: { customOptions: { removeAdditional: false } },
  });
  const active = new Set();
  app.addHook("preClose", async () => {
    for (const controller of active) controller.abort();
  });
  app.setErrorHandler((error, _request, reply) => {
    const status =
      error instanceof RelayError
        ? error.status
        : error.statusCode === 413
          ? 413
          : error.validation || error.statusCode === 400
            ? 400
            : 500;
    const code =
      error instanceof RelayError
        ? error.code
        : status === 413
          ? "request_too_large"
          : status === 400
            ? "invalid_request"
            : "relay_error";
    reply.code(status).send({ error: { type: "relay_error", code, message: code } });
  });
  const authenticate = (request) => {
    const auth = request.headers.authorization;
    if (typeof auth !== "string" || !auth.startsWith("Bearer "))
      throw new RelayError(401, "invalid_credentials");
    return auth.slice(7);
  };
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/review/status", async (request, reply) => {
    const grant = ledger.authenticate(authenticate(request));
    reply.header("cache-control", "no-store");
    return {
      model: grant.model,
      expiresAt: grant.expires,
      remainingRequests: Math.max(0, grant.max_requests - grant.used),
    };
  });
  app.post(
    "/v1/responses",
    {
      onRequest: async (request) => {
        ledger.authenticate(authenticate(request));
      },
      schema: {
        body: {
          type: "object",
          required: ["model", "input", "stream"],
          properties: {
            model: { type: "string" },
            input: { type: "array" },
            stream: { const: true },
            tools: { type: "array", items: { type: "object" } },
            max_output_tokens: { type: "integer", minimum: 1 },
          },
          additionalProperties: true,
        },
      },
    },
    async (request, reply) => {
      const token = authenticate(request);
      const body = request.body;
      if (!models.includes(body.model)) throw new RelayError(403, "model_not_allowed");
      if (body.previous_response_id || body.conversation || body.background)
        throw new RelayError(400, "stateless_request_required");
      assertTextInput(body.input);
      const input = body.input.map((item) =>
        item.type === "additional_tools" ? { ...item, tools: localTools(item.tools ?? []) } : item,
      );
      const payload = {
        ...body,
        input,
        ...(body.tools ? { tools: localTools(body.tools) } : {}),
        store: false,
        background: false,
        stream: true,
        service_tier: "default",
        max_output_tokens: Math.min(body.max_output_tokens ?? maxOutputTokens, maxOutputTokens),
      };
      const reservation = ledger.reserve(token, body.model, timeoutMs, intervalMs);
      const controller = new AbortController();
      active.add(controller);
      const abort = () => controller.abort();
      reply.raw.on("close", abort);
      if (reply.raw.destroyed) abort();
      const deadline = setTimeout(abort, timeoutMs);
      const validity = setInterval(() => {
        try {
          ledger.authenticate(token);
        } catch {
          abort();
        }
      }, 1000);
      let usage;
      let completed = false;
      let started = false;
      try {
        const upstreamResponse = await fetchImpl(upstream, {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(payload),
        });
        if (
          !upstreamResponse.ok ||
          !upstreamResponse.headers.get("content-type")?.startsWith("text/event-stream")
        ) {
          await upstreamResponse.body?.cancel();
          throw new RelayError(upstreamResponse.status === 429 ? 429 : 502, "upstream_unavailable");
        }
        const parser = createParser({
          maxBufferSize: 2 * 1024 * 1024,
          onEvent(event) {
            if (event.data === "[DONE]") return;
            const message = JSON.parse(event.data);
            if (
              ["response.completed", "response.incomplete", "response.failed"].includes(
                message.type,
              )
            ) {
              completed = true;
              usage = message.response?.usage;
            }
          },
          onError(error) {
            throw error;
          },
        });
        const decoder = new TextDecoder();
        reply.hijack();
        started = true;
        reply.raw.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        });
        let bytes = 0;
        for await (const chunk of upstreamResponse.body) {
          bytes += chunk.byteLength;
          if (bytes > 16 * 1024 * 1024) throw new Error("Response limit exceeded");
          parser.feed(decoder.decode(chunk, { stream: true }));
          if (!reply.raw.write(chunk))
            await once(reply.raw, "drain", { signal: controller.signal });
        }
        parser.feed(decoder.decode());
        if (!completed) throw new Error("Incomplete upstream stream");
        reply.raw.end();
      } catch (error) {
        controller.abort();
        if (started) reply.raw.destroy();
        else
          throw error instanceof RelayError ? error : new RelayError(502, "upstream_unavailable");
      } finally {
        clearTimeout(deadline);
        clearInterval(validity);
        reply.raw.off("close", abort);
        active.delete(controller);
        ledger.finish(reservation, usage);
      }
    },
  );
  return app;
}
