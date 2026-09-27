# Review relay server

Relays model traffic from the device's Codex runtime to the OpenAI Responses API. The board, conversations, and MCP tools remain local. The relay and app connection have been tested with a mock API and the real API on Railway. See the [Railway deployment, shutdown, restart, and verification record](RAILWAY.md) for the exact scope. Store submission remains separate.

## Reviewer instructions

Use the English-only [Store review notes](../../notes/store-review-notes.md) for submission instructions and the end-to-end walkthrough. No Japanese copy is maintained. Provide current credentials, expiry, and a support contact privately in the store submission fields.

In the app, open **Settings** or **Connection status**, select **Use review access**, enter the code, consent to sending data through the relay to OpenAI, and select **Agree and connect**. The status check calls only `/review/status`; it sends no project content and consumes no model request. Start a new conversation to test card creation, proposals, and approval.

The panel displays the model and expiry. **Return to regular connection** disconnects review access. The code and consent remain only in Rust memory until the app exits and apply across projects. Regular authentication, consent, and model settings are preserved. Saved conversations must resume using their original connection. Connection failures, expiry, revocation, and exhausted limits never silently fall back to a personal account or delete local cards/conversations. Review Codex storage is separate, and the code is not saved in configuration files, project databases, or browser storage.

The server is fixed at build time using **`TANZAKOO_REVIEW_URL`**, an HTTPS origin without a path, query, or credentials. See [Railway operations](RAILWAY.md) for the deployed origin. An unconfigured build still shows the entry point but reports that review access is unavailable when connecting. Debug builds may use the same environment variable at launch and `http://127.0.0.1:<port>`; release builds reject runtime overrides. Status checks reject redirects and enforce a 15-second timeout and 4 KiB response limit.

Review access selects the model returned by `/review/status` when starting Codex. ACP 1.13.1 / Codex 0.156.1 recognizes the deployed `gpt-6-luna` model. A model absent from the bundled catalog can still be passed to ACP, but Codex may display a generic metadata warning. Review model selection is separate from regular connection settings.

## Supported behavior

- Issue and revoke review tokens with the admin CLI. Only SHA-256 token hashes are stored in SQLite.
- Enforce each token's model, expiry, and cumulative request-attempt limit. Reserve attempts in SQLite before forwarding; failures and cancellation still count, and restarting does not reset the counter.
- Restrict concurrent requests per token and require at least one second between requests. Revocation and expiry also stop active requests.
- Forward streams and cancel upstream work on client disconnect or after 120 seconds. Accumulate input/output token usage when reported upstream.
- `GET /review/status` returns the assigned model, expiry, and remaining attempts without calling AI.

The real API key stays on the server. The upstream URL is fixed to `https://api.openai.com/v1/responses`; client credentials and arbitrary destinations are not forwarded. Only tests may explicitly configure a loopback mock upstream. Normal request logging is disabled, and conversation bodies and tokens are not logged.

## Limitations

- Railway deployment and real-API checks are recorded in [the operations guide](RAILWAY.md). Those checks do not establish store approval or validate every signed distribution package. Keep availability monitoring, credentials, budget settings, and data-handling disclosures current for submission.
- Access currently uses expiring bearer credentials directly. Short-lived token exchange/refresh and OS credential-store integration are not implemented.
- The relay does not guarantee a monetary cap. It limits attempts, 256 KiB of input, up to 8192 output tokens, and one assigned model per token. Provider budget settings are separate; do not describe the request limit as a guaranteed currency limit.
- Only SSE for `POST /v1/responses` is supported. WebSockets, `/responses/compact`, upstream model listings, and restoration by upstream conversation ID are unavailable. Long-conversation compaction, API edge cases, and retry behavior after 429 need separate validation.
- Input is text-oriented with local tools. Image/file inputs are rejected; hosted web search and remote MCP tool definitions are removed. Disclose these differences for review access.
- Upstream requests use `store: false`, `background: false`, and `service_tier: default`. This does not guarantee zero retention by OpenAI.
- The server is tested on Node 24.21.0. Its built-in `node:sqlite` is Release Candidate in Node 24; retain persistence and concurrent-use tests when updating. Server dependencies are not bundled with the desktop app.

## Offline verification

Run from the repository root with mise and the Windows or Mac Rust build prerequisites:

```powershell
mise exec -- pnpm test:review
```

This builds the current app and tests the server boundaries plus the managed wrapper → pinned ACP → pinned Codex → local relay → mock API path. It uses an empty authentication directory, with no developer ChatGPT login or real API key. Real MCP tools create candidates and pending proposals in temporary SQLite storage. Tests check that saved card content is unchanged before approval, conversations restore after restarting the process, and review tokens are not persisted in Codex storage.

This does not test native UI operation, real AI judgment, or App Sandbox behavior. `pnpm test` covers UI consent, failure, disconnection, and code handling. `cargo test` covers status checks, redirect rejection, separate authentication storage, and real ACP gateway authentication. CI runs ordinary Mac processes; Sandbox verification remains separate.

## Server operation

Use the [Railway operations guide](RAILWAY.md) for the deployed service. For another deployment, configure HTTPS termination, disable request/header/body logging and stream buffering, and store the database in a private persistent directory. There is no public HTTP admin endpoint.

| Variable                | Purpose                                                                         |
| ----------------------- | ------------------------------------------------------------------------------- |
| `TANZAKOO_RELAY_DB`     | Absolute path to persistent SQLite storage; create its parent directory first   |
| `OPENAI_API_KEY`        | Secret for a dedicated API project; do not put it in files or command arguments |
| `TANZAKOO_RELAY_MODELS` | Comma-separated allowlist of explicitly available model IDs                     |
| `TANZAKOO_RELAY_HOST`   | Defaults to `127.0.0.1`; override only as required by the host                  |
| `PORT`                  | Defaults to `8787`                                                              |

Start with `mise exec -- pnpm --filter @tanzakoo/review-relay start`. Manage grants with:

```text
mise exec -- pnpm --filter @tanzakoo/review-relay grant issue <model-id> <ISO-expiry> <max-attempts>
mise exec -- pnpm --filter @tanzakoo/review-relay grant list
mise exec -- pnpm --filter @tanzakoo/review-relay grant revoke <grant-id>
```

Issuing a token displays it once on stdout. Deliver it through the store's private submission fields; do not paste it into Git, normal logs, or shared chats. `list` does not display tokens. Issue a new token for extensions or re-review and revoke unused grants. Keep the server and valid credentials available throughout review and follow-up checks.

## Dependencies

- Fastify 5.12.5 (MIT): HTTP routing, JSON Schema validation, and input limits. Stream forwarding was tested on Node 24.21.0. [Support policy](https://fastify.dev/docs/latest/Reference/LTS/)
- eventsource-parser 4.1.1 (MIT, Node 22.12+): bounded parsing of split SSE events, completion, and usage.
- Desktop reqwest 0.13.5 (MIT / Apache-2.0, Rust 1.85+): connection checks on the existing Tokio runtime, using `native-tls` on Windows and Mac. [Documentation](https://docs.rs/reqwest/0.13.5/reqwest/)
- `node:sqlite`: ledger storage bundled with the pinned Node version, without another native database add-on. [Node 24 documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)

The internal [design discussion](../../notes/store-review-relay.md) records the architecture and remaining Mac investigation.
