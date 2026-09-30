import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import {
  authorization,
  callback,
  exchange,
  signIn,
  tokenSet,
  issuer,
  resource,
  request,
} from "../plan/oauth.mjs";
import { operate, withStore } from "../plan/store.mjs";

const pair = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(pair.publicKey)), kid: "fixture" };
const json = (value) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
async function fixture(overrides = {}) {
  let nonce,
    count = 0;
  const requests = [],
    urls = [];
  const idToken = async (claims) =>
    new SignJWT({ nonce, email: "same@example.test", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "fixture" })
      .setIssuer(issuer)
      .setSubject("user-a")
      .setAudience("oaiapp_fixture")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(pair.privateKey);
  const fetcher = async (url, options = {}) => {
    requests.push({ url, options });
    assert.equal(options.redirect, "error");
    if (url.endsWith("openid-configuration"))
      return json({ issuer, jwks_uri: `${issuer}/jwks`, revocation_endpoint: `${issuer}/revoke` });
    if (url.endsWith("/jwks")) return json({ keys: [jwk] });
    if (url.endsWith("/revoke")) {
      if (overrides.revokeFails) throw new Error("secret must never appear");
      return new Response(null, { status: 200 });
    }
    if (url === `${resource}/models`) {
      assert.match(options.headers.Authorization, /^Bearer access-/);
      return json({
        models: [
          { slug: "fixture-model", display_name: "Fixture", visibility: "list" },
          { slug: "hidden", visibility: "hide" },
        ],
      });
    }
    assert.equal(url, `${issuer}/api/accounts/oauth/token`);
    assert.equal(options.body.get("client_id"), "oaiapp_fixture");
    assert.equal(options.body.get("resource"), resource);
    if (overrides.invalidGrant) return new Response('{"error":"invalid_grant"}', { status: 400 });
    count++;
    return json({
      access_token: `access-${count}`,
      refresh_token: `refresh-${count}`,
      id_token: await idToken(overrides.claims),
      token_type: "Bearer",
      expires_in: overrides.expires ?? 3600,
      scope:
        overrides.scope ??
        "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    });
  };
  const openBrowser = async (value) => {
    const url = new URL(value);
    urls.push(url);
    nonce = url.searchParams.get("nonce");
    const target = new URL(url.searchParams.get("redirect_uri"));
    assert.equal(target.hostname, "127.0.0.1");
    // Stray requests are rejected without terminating the valid pending attempt.
    const stray = new URL(target);
    stray.searchParams.set("state", "wrong");
    assert.equal((await fetch(stray)).status, 400);
    target.search = new URLSearchParams({
      code: "fixture-code",
      state: url.searchParams.get("state"),
      client_id: "oaiapp_fixture",
    });
    await fetch(target);
  };
  return { fetcher, openBrowser, requests, urls, idToken };
}

test("PKCE is fresh and callback rejects wrong state, duplicate parameters, errors and client substitution", () => {
  const tx = authorization("urn:uuid:fixture", "http://127.0.0.1:1000/auth/callback");
  const other = authorization("urn:uuid:fixture", tx.redirectUri);
  assert.notEqual(tx.verifier, other.verifier);
  assert.equal(tx.url.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(tx.url.searchParams.get("agent_name_hint"), "Tanzakoo");
  const url = new URL(tx.redirectUri);
  url.search = new URLSearchParams({ state: tx.state, code: "code", client_id: "oaiapp_fixture" });
  assert.equal(callback(tx, url).clientId, "oaiapp_fixture");
  for (const change of [
    (u) => u.searchParams.set("state", "bad"),
    (u) => u.searchParams.append("state", tx.state),
    (u) => u.searchParams.set("error", "access_denied"),
    (u) => u.searchParams.set("client_id", "dynamic_agent_client"),
    (u) => u.searchParams.delete("client_id"),
  ]) {
    const bad = new URL(url);
    change(bad);
    assert.throws(() => callback(tx, bad));
  }
  assert.throws(() => callback({ ...tx, expires: 0 }, url));
  assert.throws(() => callback({ ...tx, account: { client_id: "other" } }, url));
});

test("real loopback callback exchanges and verifies identity without leaking it in browser response", async () => {
  const f = await fixture();
  const result = await signIn("urn:uuid:fixture", undefined, f.openBrowser, f.fetcher);
  assert.equal(result.subject, "user-a");
  assert.equal(result.client_id, "oaiapp_fixture");
  const form = f.requests.find((r) => r.url.endsWith("/token")).options.body;
  assert.equal(form.get("redirect_uri"), f.urls[0].searchParams.get("redirect_uri"));
  assert.equal(form.get("client_secret"), null);
  assert.equal(form.get("code_verifier").length, 43);
});

test("invalid signature, issuer, audience, nonce, expiry and returning identity are rejected", async () => {
  const tx = authorization("host", "http://127.0.0.1:1000/auth/callback");
  const url = new URL(
    `${tx.redirectUri}?${new URLSearchParams({ state: tx.state, code: "code", client_id: "oaiapp_fixture" })}`,
  );
  const otherPair = await generateKeyPair("RS256");
  for (const variant of ["signature", "issuer", "audience", "nonce", "expiry", "subject"]) {
    const f = await fixture();
    const token = await new SignJWT({ nonce: variant === "nonce" ? "bad" : tx.nonce })
      .setProtectedHeader({ alg: "RS256", kid: "fixture" })
      .setIssuer(variant === "issuer" ? "https://evil.test" : issuer)
      .setAudience(variant === "audience" ? "wrong" : "oaiapp_fixture")
      .setSubject(variant === "subject" ? "different-user" : "user-a")
      .setIssuedAt()
      .setExpirationTime(variant === "expiry" ? 1 : Math.floor(Date.now() / 1000) + 3600)
      .sign(variant === "signature" ? otherPair.privateKey : pair.privateKey);
    const fetcher = (endpoint, options) =>
      endpoint.endsWith("/token")
        ? Promise.resolve(json({ id_token: token }))
        : f.fetcher(endpoint, options);
    await assert.rejects(
      exchange(
        { ...tx, account: { client_id: "oaiapp_fixture", subject: "user-a" } },
        url,
        fetcher,
      ),
      /invalid_identity/,
    );
  }
});

test("plan permission is checked on token response, not callback or ID token", () => {
  assert.throws(
    () =>
      tokenSet({
        access_token: "a",
        refresh_token: "r",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid email",
      }),
    /plan_permission/,
  );
});

test("registration survives logout, refresh rotates atomically and only public account info is listed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tanzakoo-plan-test-"));
  try {
    const f = await fixture({ expires: 1, revokeFails: true });
    const login = await operate(directory, "login", null, f);
    const id = login.account.id;
    const saved = JSON.parse(await readFile(join(directory, "accounts.json"), "utf8"));
    const access = await operate(directory, "access", id, f);
    assert.equal(access.token, "access-2");
    const rotated = JSON.parse(await readFile(join(directory, "accounts.json"), "utf8"));
    assert.equal(rotated.accounts[0].refresh_token, "refresh-2");
    assert.deepEqual(access.models, [{ value: "fixture-model", name: "Fixture" }]);
    assert.doesNotMatch(
      JSON.stringify(await operate(directory, "list", null, f)),
      /access-|refresh-|id_token/,
    );
    assert.equal((await operate(directory, "logout", id, f)).warning, "revocation_unconfirmed");
    const loggedOut = JSON.parse(await readFile(join(directory, "accounts.json"), "utf8"));
    assert.equal(loggedOut.host, saved.host);
    assert.equal(loggedOut.accounts[0].client_id, "oaiapp_fixture");
    assert.equal(loggedOut.accounts[0].refresh_token, undefined);
    await assert.rejects(operate(directory, "access", id, f), /reauthorize/);
    await operate(directory, "login", id, f);
    assert.equal(f.urls[1].searchParams.get("client_id"), "oaiapp_fixture");
    assert.equal(f.urls[1].searchParams.get("ext_agent_host_id"), saved.host);
    assert.equal(f.urls[1].searchParams.has("agent_name_hint"), false);
    if (process.platform !== "win32")
      assert.equal((await stat(join(directory, "accounts.json"))).mode & 0o777, 0o600);
    await withStore(directory, async () => {
      await assert.rejects(
        withStore(directory, async () => {}),
        /locked/,
      );
    });
    await withStore(directory, async () => {});
  } finally {
    assert.ok(
      resolve(directory).startsWith(resolve(tmpdir()) + "/") ||
        resolve(directory).startsWith(resolve(tmpdir()) + "\\"),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

test("HTTP errors redact upstream bodies and response size is bounded", async () => {
  await assert.rejects(
    request(`${resource}/models`, {}, async () => new Response("secret-token", { status: 403 })),
    /^Error: network$/,
  );
  await assert.rejects(
    request(`${resource}/models`, {}, async () => new Response("x".repeat(1_048_577))),
    /invalid_response/,
  );
});
