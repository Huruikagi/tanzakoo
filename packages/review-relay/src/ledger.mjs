import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const digest = (token) => createHash("sha256").update(token).digest("hex");
export class RelayError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// Durable attempt caps: debit before forwarding, never refund ambiguous failures.
export class Ledger {
  constructor(path, now = Date.now) {
    this.now = now;
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS grants (
        id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, model TEXT NOT NULL,
        expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
        max_requests INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0,
        next_request INTEGER NOT NULL DEFAULT 0, busy_until INTEGER NOT NULL DEFAULT 0,
        active_request TEXT, input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0
      );`);
  }
  issue({ model, expires, maxRequests }) {
    if (
      typeof model !== "string" ||
      !/^[a-zA-Z0-9._-]{1,100}$/.test(model) ||
      !Number.isSafeInteger(expires) ||
      expires <= this.now() ||
      !Number.isSafeInteger(maxRequests) ||
      maxRequests < 1 ||
      maxRequests > 10_000
    )
      throw new Error("Invalid grant parameters");
    const token = `trr_${randomBytes(32).toString("base64url")}`;
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO grants(id, token_hash, model, expires, max_requests) VALUES(?,?,?,?,?)")
      .run(id, digest(token), model, expires, maxRequests);
    return { id, token, model, expires, maxRequests };
  }
  authenticate(token) {
    if (typeof token !== "string" || !/^trr_[A-Za-z0-9_-]{43}$/.test(token))
      throw new RelayError(401, "invalid_credentials");
    const grant = this.db.prepare("SELECT * FROM grants WHERE token_hash=?").get(digest(token));
    if (!grant || grant.revoked) throw new RelayError(401, "invalid_credentials");
    if (grant.expires <= this.now()) throw new RelayError(403, "grant_expired");
    return grant;
  }
  reserve(token, model, timeoutMs, intervalMs) {
    const grant = this.authenticate(token);
    if (grant.model !== model) throw new RelayError(403, "model_not_allowed");
    const now = this.now();
    const requestId = randomUUID();
    const result = this.db
      .prepare(`UPDATE grants SET used=used+1, next_request=?, busy_until=?, active_request=?
      WHERE id=? AND revoked=0 AND expires>? AND used<max_requests AND next_request<=? AND busy_until<=?`)
      .run(now + intervalMs, now + timeoutMs + 5000, requestId, grant.id, now, now, now);
    if (result.changes !== 1) throw new RelayError(429, "grant_limit_reached");
    return { grantId: grant.id, requestId };
  }
  finish({ grantId, requestId }, usage) {
    const count = (n) => (Number.isSafeInteger(n) && n >= 0 && n <= 10_000_000 ? n : 0);
    this.db
      .prepare(`UPDATE grants SET busy_until=0, active_request=NULL,
      input_tokens=input_tokens+?, output_tokens=output_tokens+? WHERE id=? AND active_request=?`)
      .run(count(usage?.input_tokens), count(usage?.output_tokens), grantId, requestId);
  }
  revoke(id) {
    return this.db.prepare("UPDATE grants SET revoked=1 WHERE id=?").run(id).changes === 1;
  }
  list() {
    return this.db
      .prepare(
        "SELECT id, model, expires, revoked, max_requests, used, input_tokens, output_tokens FROM grants ORDER BY rowid",
      )
      .all();
  }
  close() {
    this.db.close();
  }
}
