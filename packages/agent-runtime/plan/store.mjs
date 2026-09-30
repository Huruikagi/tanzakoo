import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, chmod } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { PlanError, signIn, renew, revoke, models } from "./oauth.mjs";

async function write(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
    await file.close();
    await rename(temporary, path);
  } finally {
    await file.close();
    await unlink(temporary).catch(() => {});
  }
}

// SQLite's OS lock serializes refresh across app processes and is released even
// when cancellation kills the helper. This database never contains credentials.
export async function withStore(directory, operation) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(directory, 0o700);
  const lock = new DatabaseSync(join(directory, "session-lock.sqlite"));
  try {
    try {
      lock.exec("BEGIN EXCLUSIVE");
    } catch {
      throw new PlanError("locked");
    }
    const path = join(directory, "accounts.json");
    let data;
    try {
      data = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw new PlanError("storage");
      data = { version: 1, host: `urn:uuid:${randomUUID()}`, accounts: [] };
      await write(path, data); // Host is stable even if the first login fails.
    }
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
    if (
      data.version !== 1 ||
      !uuid.test(data.host?.replace(/^urn:uuid:/, "")) ||
      !Array.isArray(data.accounts) ||
      data.accounts.some(
        (a) =>
          !a ||
          !uuid.test(a.id) ||
          typeof a.client_id !== "string" ||
          !a.client_id ||
          a.client_id === "dynamic_agent_client" ||
          typeof a.subject !== "string" ||
          !a.subject ||
          (a.email != null && typeof a.email !== "string"),
      )
    )
      throw new PlanError("storage");
    return await operation(data, () => write(path, data));
  } finally {
    lock.close();
  }
}

const publicAccount = (a) => ({
  id: a.id,
  label: `${a.email ?? "ChatGPT"} · ${a.id.slice(0, 8)}`,
  signedIn: !!a.refresh_token,
});
export async function operate(directory, action, id, dependencies) {
  if (action === "usage") {
    await dependencies.openBrowser("https://chatgpt.com/settings/usage");
    return {};
  }
  return withStore(directory, async (data, save) => {
    const fetcher = dependencies.fetcher;
    let account = id ? data.accounts.find((a) => a.id === id) : undefined;
    if (id && !account) throw new PlanError("account_missing");
    if (action === "list") return { accounts: data.accounts.map(publicAccount) };
    if (action === "login") {
      const next = await signIn(data.host, account, dependencies.openBrowser, fetcher);
      account ??= data.accounts.find(
        (a) => a.client_id === next.client_id && a.subject === next.subject,
      );
      if (account) Object.assign(account, next);
      else {
        account = { ...next, id: randomUUID() };
        data.accounts.push(account);
      }
      await save();
      return { account: publicAccount(account) };
    }
    if (!account) throw new PlanError("account_missing");
    if (action === "logout") {
      let warning = null;
      try {
        await revoke(account, fetcher);
      } catch {
        warning = "revocation_unconfirmed";
      }
      for (const key of ["access_token", "refresh_token", "id_token", "expires_at", "scopes"])
        delete account[key];
      await save();
      return { warning };
    }
    if (!["access", "models"].includes(action)) throw new PlanError("invalid_action");
    try {
      Object.assign(account, await renew(account, fetcher));
    } catch (error) {
      if (error.message === "reauthorize") {
        for (const key of ["access_token", "refresh_token", "expires_at"]) delete account[key];
        await save();
      }
      throw error;
    }
    await save(); // Persist rotated token before any later operation can fail.
    const catalog = await models(account, fetcher);
    if (action === "models") return { models: catalog };
    // Private Rust IPC only; this result must never be returned to the webview.
    return { token: account.access_token, models: catalog };
  });
}
