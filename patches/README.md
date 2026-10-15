# Bundled ACP startup configuration

`@agentclientprotocol/codex-acp@2.2.2.patch` forwards five analytics/OTel
settings from `CODEX_CONFIG` as Codex `app-server -c` arguments when using the
bundled executable. Upstream applies `CODEX_CONFIG` to sessions, after the
process-wide analytics and OTel clients have already initialized. The managed
wrapper supplies the values from `packages/agent-runtime/reference-policy.json`.
The patch also covers app-server restarts and leaves custom executables alone.
ACP 2.2.2 forwards its hook configuration at startup, but still applies the
analytics/OTel settings only to sessions. The patch preserves those upstream
startup arguments and appends the five managed overrides.

No provider headers, tokens, model config or arbitrary JSON objects are put on
the command line. The selected settings have primitive TOML-compatible values.
The pinned dependency's license remains in the deployment.

On ACP upgrades, recheck whether upstream applies these settings before process
initialization. Remove the patch only after `test:review` passes with its invalid
inherited telemetry config fixture. That fixture fails at startup if an override
is missing; session-only configuration is insufficient. Also run the board routes
against a `pnpm deploy --prod --config.node-linker=hoisted` runtime to check that
packaging includes the patch. This does not test OpenAI server-side processing or
all possible network traffic.

The relay Docker build context also includes `patches/*.patch`, since it reads
the shared workspace and frozen lockfile. Its minimal build inputs were checked
with `pnpm deploy` on Windows; a Docker image build was not run locally.
