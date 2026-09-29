// Public-client SIWC flow. No client secret, API key, or ChatGPT backend endpoints.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createLocalJWKSet, jwtVerify } from "jose";

export const issuer = "https://auth.openai.com";
export const resource = "https://api.openai.com/v1";
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const scopes = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export class PlanError extends Error {}
const fail = (code) => new PlanError(code);

export async function request(url, options = {}, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    const reader = response.body?.getReader();
    const chunks = [];
    let length = 0;
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 1_048_576) throw fail("invalid_response");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
    }
    const body = Buffer.concat(chunks).toString("utf8");
    if (!response.ok) {
      let code;
      try {
        code = JSON.parse(body).error;
      } catch {
        /* Never echo provider content. */
      }
      throw fail(code === "invalid_grant" ? "reauthorize" : "network");
    }
    return body ? JSON.parse(body) : null;
  } catch (error) {
    throw error instanceof PlanError ? error : fail("network");
  }
}

export function authEndpoint(value) {
  const url = new URL(value);
  if (url.origin !== issuer || url.username || url.password || url.hash)
    throw fail("invalid_response");
  return url.href;
}

async function discovery(fetcher) {
  const metadata = await request(`${issuer}/.well-known/openid-configuration`, {}, fetcher);
  if (metadata?.issuer !== issuer) throw fail("invalid_identity");
  return metadata;
}

export async function verifyIdentity(idToken, clientId, nonce, subject, fetcher) {
  try {
    const metadata = await discovery(fetcher);
    const keys = await request(authEndpoint(metadata.jwks_uri), {}, fetcher);
    const { payload } = await jwtVerify(idToken, createLocalJWKSet(keys), {
      issuer,
      audience: clientId,
      algorithms: ["RS256", "ES256"],
      requiredClaims: ["sub", "exp", "iat"],
      clockTolerance: 5,
    });
    if (
      typeof payload.sub !== "string" ||
      !payload.sub ||
      (nonce !== undefined && payload.nonce !== nonce) ||
      (subject !== undefined && payload.sub !== subject) ||
      (payload.azp !== undefined && payload.azp !== clientId) ||
      (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)
    )
      throw fail("invalid_identity");
    return {
      subject: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
    };
  } catch {
    throw fail("invalid_identity");
  }
}

export function tokenSet(tokens, previous = {}) {
  if (
    typeof tokens?.access_token !== "string" ||
    !tokens.access_token ||
    typeof tokens.refresh_token !== "string" ||
    !tokens.refresh_token ||
    tokens.token_type?.toLowerCase() !== "bearer" ||
    !Number.isFinite(tokens.expires_in) ||
    tokens.expires_in <= 0 ||
    tokens.expires_in > 86400 ||
    typeof tokens.scope !== "string"
  )
    throw fail("invalid_response");
  const granted = tokens.scope.split(/\s+/);
  if (
    !["openid", "resource.invoke", "chatgpt.tokens.use.direct", "offline_access"].every((s) =>
      granted.includes(s),
    )
  )
    throw fail("plan_permission");
  return {
    ...previous,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    id_token: tokens.id_token ?? previous.id_token,
    scopes: granted,
    expires_at: Date.now() + tokens.expires_in * 1000,
  };
}

export function authorization(hostId, redirectUri, account) {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL(`${issuer}/api/accounts/authorize`);
  url.search = new URLSearchParams({
    client_id: account?.client_id ?? "dynamic_agent_client",
    ext_agent_host_id: hostId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: scopes,
    resource,
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    ...(!account ? { agent_name_hint: "Tanzakoo" } : {}),
    ...(account?.id_token ? { id_token_hint: account.id_token } : {}),
  }).toString();
  return { url, state, nonce, verifier, redirectUri, account, expires: Date.now() + 300_000 };
}

export function callback(transaction, url) {
  for (const key of ["state", "code", "client_id", "error"])
    if (url.searchParams.getAll(key).length > 1) throw fail("invalid_callback");
  if (Date.now() >= transaction.expires || url.searchParams.get("state") !== transaction.state)
    throw fail("invalid_callback");
  if (url.searchParams.has("error")) throw fail("consent_denied");
  const clientId = url.searchParams.get("client_id") ?? transaction.account?.client_id;
  const code = url.searchParams.get("code");
  if (
    !code ||
    !clientId ||
    clientId === "dynamic_agent_client" ||
    clientId.length > 512 ||
    (transaction.account && clientId !== transaction.account.client_id)
  )
    throw fail("invalid_callback");
  return { clientId, code };
}

export async function exchange(transaction, url, fetcher = fetch) {
  const { clientId, code } = callback(transaction, url);
  const tokens = await request(
    tokenEndpoint,
    {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: transaction.verifier,
        redirect_uri: transaction.redirectUri,
        resource,
      }),
    },
    fetcher,
  );
  const identity = await verifyIdentity(
    tokens?.id_token,
    clientId,
    transaction.nonce,
    transaction.account?.subject,
    fetcher,
  );
  return { ...tokenSet(tokens), ...identity, client_id: clientId };
}

// Listener exists only during a user-initiated sign-in. Invalid state never redeems a code.
export async function signIn(hostId, account, openBrowser, fetcher = fetch) {
  let transaction,
    consumed = false,
    settle,
    timer;
  const result = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  // Attach a rejection handler while the browser launcher is starting.
  void result.catch(() => {});
  const server = createServer({ maxHeaderSize: 16_384 }, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    res.setHeader("Referrer-Policy", "no-referrer");
    const expectedHost = new URL(transaction.redirectUri).host;
    if (req.method !== "GET" || req.headers.host !== expectedHost || consumed) {
      res.writeHead(400).end("Invalid sign-in request.");
      return;
    }
    let url;
    try {
      url = new URL(req.url, transaction.redirectUri);
    } catch {
      res.writeHead(400).end("Invalid sign-in request.");
      return;
    }
    if (url.pathname !== "/auth/callback") {
      res.writeHead(404).end();
      return;
    }
    // A stray request must not cancel the user's valid pending sign-in.
    if (url.searchParams.get("state") !== transaction.state) {
      res.writeHead(400).end("Invalid sign-in request.");
      return;
    }
    consumed = true;
    try {
      const record = await exchange(transaction, url, fetcher);
      res
        .writeHead(200, { "content-type": "text/plain; charset=utf-8" })
        .end("Signed in. Return to Tanzakoo.");
      settle.resolve(record);
    } catch (error) {
      res.writeHead(400).end("Sign-in failed. Return to Tanzakoo and try again.");
      settle.reject(error);
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    transaction = authorization(
      hostId,
      `http://127.0.0.1:${server.address().port}/auth/callback`,
      account,
    );
    timer = setTimeout(() => settle.reject(fail("timeout")), 300_000);
    await openBrowser(transaction.url.href);
    return await result;
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

export async function renew(account, fetcher = fetch) {
  if (!account.access_token || !account.refresh_token) throw fail("reauthorize");
  if (account.expires_at > Date.now() + 120_000) return account;
  const tokens = await request(
    tokenEndpoint,
    {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: account.client_id,
        refresh_token: account.refresh_token,
        resource,
      }),
    },
    fetcher,
  );
  if (tokens?.id_token)
    await verifyIdentity(tokens.id_token, account.client_id, undefined, account.subject, fetcher);
  return tokenSet(tokens, account);
}

export async function revoke(account, fetcher = fetch) {
  if (!account.refresh_token) return;
  const metadata = await discovery(fetcher);
  await request(
    authEndpoint(metadata.revocation_endpoint),
    {
      method: "POST",
      body: new URLSearchParams({
        token: account.refresh_token,
        token_type_hint: "refresh_token",
        client_id: account.client_id,
      }),
    },
    fetcher,
  );
}

export async function models(account, fetcher = fetch) {
  const body = await request(
    `${resource}/models`,
    { headers: { Authorization: `Bearer ${account.access_token}` } },
    fetcher,
  );
  if (!Array.isArray(body?.models)) throw fail("invalid_response");
  const result = body.models
    .filter((m) => m.visibility === "list")
    .map((m) => {
      if (!/^[a-zA-Z0-9._-]{1,100}$/.test(m.slug) || typeof m.display_name !== "string")
        throw fail("invalid_response");
      return { value: m.slug, name: m.display_name.slice(0, 200) };
    });
  if (!result.length) throw fail("no_models");
  return result;
}
