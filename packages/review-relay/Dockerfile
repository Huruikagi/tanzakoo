# Build from the repository root. Keep in sync with mise.toml.
FROM node:24.21.0-bookworm-slim AS build
RUN npm install --global pnpm@12.4.2
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/agent-runtime/package.json ./packages/agent-runtime/package.json
COPY packages/review-relay/package.json ./packages/review-relay/package.json
COPY packages/review-relay/src ./packages/review-relay/src
RUN pnpm --filter @tanzakoo/review-relay deploy --prod --frozen-lockfile /out

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production \
    TANZAKOO_RELAY_HOST=0.0.0.0 \
    TANZAKOO_RELAY_DB=/data/relay.sqlite \
    PORT=8787
WORKDIR /app
COPY --from=build /out/ ./
# Railway mounts its volume as root. Only the private ledger belongs in /data.
# Create the mount point, not a database: Railway must attach the volume at runtime.
RUN mkdir -p /data && chmod 700 /data
EXPOSE 8787
STOPSIGNAL SIGTERM
CMD ["node", "src/main.mjs"]
