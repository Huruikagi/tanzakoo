import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { databasePath } from "../src/config.mjs";
import { Ledger } from "../src/ledger.mjs";

test("Railway refuses missing volumes and database paths outside the mount", (t) => {
  const root = mkdtempSync(join(tmpdir(), "relay-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const mount = join(root, "data");
  mkdirSync(mount);
  const env = { RAILWAY_SERVICE_ID: "fixture", TANZAKOO_RELAY_DB: join(mount, "relay.sqlite") };
  assert.throws(() => databasePath({}), /absolute/);
  assert.throws(() => databasePath({ TANZAKOO_RELAY_DB: "relative.sqlite" }), /absolute/);
  assert.throws(() => databasePath(env), /Attach a Railway volume/);
  env.RAILWAY_VOLUME_MOUNT_PATH = mount;
  assert.equal(databasePath(env), env.TANZAKOO_RELAY_DB);
  assert.throws(
    () => databasePath({ ...env, TANZAKOO_RELAY_DB: join(root, "outside.sqlite") }),
    /inside the Railway volume/,
  );
});

test("admin backup preserves live WAL usage and revocations without overwriting a snapshot", (t) => {
  const root = mkdtempSync(join(tmpdir(), "relay-backup-"));
  const path = join(root, "relay.sqlite");
  const snapshot = join(root, "snapshot.sqlite");
  const ledger = new Ledger(path);
  t.after(() => {
    ledger.close();
    rmSync(root, { recursive: true, force: true });
  });
  const grant = ledger.issue({
    model: "fixture-model",
    expires: Date.now() + 60_000,
    maxRequests: 5,
  });
  ledger.finish(ledger.reserve(grant.token, grant.model, 1000, 0), {
    input_tokens: 12,
    output_tokens: 3,
  });
  ledger.revoke(grant.id);
  const env = { ...process.env, TANZAKOO_RELAY_DB: path };
  delete env.RAILWAY_SERVICE_ID;
  delete env.RAILWAY_ENVIRONMENT_ID;
  const admin = fileURLToPath(new URL("../src/admin.mjs", import.meta.url));
  const backup = () =>
    spawnSync(process.execPath, [admin, "backup", snapshot], {
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
  const result = backup();
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(grant.token));
  assert.notEqual(backup().status, 0);
  const restored = new Ledger(snapshot);
  try {
    assert.deepEqual(restored.list(), ledger.list());
    assert.equal(restored.list()[0].used, 1);
    assert.equal(restored.list()[0].revoked, 1);
    assert.throws(() => restored.authenticate(grant.token), /invalid_credentials/);
  } finally {
    restored.close();
  }
});
