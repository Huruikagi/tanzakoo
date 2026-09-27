#!/usr/bin/env bash
set -euo pipefail
image="${1:?Pass the review relay image tag}"
name="tanzakoo-review-smoke-${GITHUB_RUN_ID:-local}-$$"
volume="$name-data"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker volume create "$volume" >/dev/null
start() {
  docker run -d --name "$name" --network none \
    -v "$volume:/data" \
    -e RAILWAY_SERVICE_ID=offline-fixture -e RAILWAY_VOLUME_MOUNT_PATH=/data \
    -e OPENAI_API_KEY=offline-fixture -e TANZAKOO_RELAY_MODELS=fixture-model \
    "$image" >/dev/null
}
health() {
  for attempt in {1..30}; do
    if docker exec "$name" node --input-type=module -e \
      'const r = await fetch("http://127.0.0.1:8787/health"); if (!r.ok) process.exit(1)' 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  docker logs "$name"
  return 1
}
start
health
# Create the grant inside the container; never send a Responses request.
docker exec "$name" node --input-type=module -e '
  import { Ledger } from "./src/ledger.mjs";
  const db = new Ledger(process.env.TANZAKOO_RELAY_DB);
  const grant = db.issue({model:"fixture-model", expires:Date.now()+60000, maxRequests:2});
  db.revoke(grant.id);
  db.close();
  const r = await fetch("http://127.0.0.1:8787/review/status", {headers:{authorization:`Bearer ${grant.token}`}});
  if(r.status !== 401) throw new Error("Revoked token accepted");
'
docker exec "$name" node src/admin.mjs backup /data/snapshot.sqlite
docker stop --time 15 "$name" >/dev/null
test "$(docker inspect --format '{{.State.ExitCode}}' "$name")" = 0
docker rm "$name" >/dev/null
start
health
docker exec "$name" node --input-type=module -e '
  import assert from "node:assert/strict";
  import { Ledger } from "./src/ledger.mjs";
  const db = new Ledger(process.env.TANZAKOO_RELAY_DB);
  const backup = new Ledger("/data/snapshot.sqlite");
  assert.equal(db.list().length, 1);
  assert.equal(db.list()[0].revoked, 1);
  assert.deepEqual(db.list(), backup.list());
  db.close(); backup.close();
'
