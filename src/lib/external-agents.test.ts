import { expect, it } from "vitest";
import capability from "../../src-tauri/capabilities/default.json";
import { agentLabel, agentUnavailable, emptySnapshot } from "./api";
import { externalAgents } from "./external-agents";

it("allows every official setup link through the native opener capability", () => {
  const permission = capability.permissions.find(
    (p) => typeof p !== "string" && p.identifier === "opener:allow-open-url",
  );
  if (!permission || typeof permission === "string") throw new Error("Missing opener capability");
  for (const agent of externalAgents) {
    expect(permission.allow).toContainEqual({ url: agent.url });
    if ("serverUrl" in agent) {
      expect(permission.allow).toContainEqual({ url: agent.serverUrl });
      expect(permission.allow).toContainEqual({ url: agent.loginUrl });
    }
    if ("authUrl" in agent) expect(permission.allow).toContainEqual({ url: agent.authUrl });
  }
});

it("keeps excluded Gemini history labelled and unavailable despite saved consent", () => {
  const snapshot = {
    ...emptySnapshot,
    externalAgentsAvailable: true,
    consents: ["gemini"],
    agents: [{ id: "gemini", command: "gemini", args: ["--acp"] }],
  };
  expect(agentLabel("gemini")).toBe("Gemini CLI");
  expect(agentUnavailable(snapshot, "gemini")).toBe(true);
  expect(agentUnavailable(snapshot, "antigravity")).toBe(false);
  expect(agentUnavailable({ ...snapshot, externalAgentsAvailable: false }, "antigravity")).toBe(
    true,
  );
});

it("labels the Claude API connection without reusing legacy Claude history", () => {
  const snapshot = { ...emptySnapshot, externalAgentsAvailable: true };
  expect(agentLabel("claude-api")).toBe("Claude API");
  expect(agentLabel("claude")).toBe("Claude");
  expect(agentUnavailable(snapshot, "claude-api")).toBe(false);
  expect(agentUnavailable(snapshot, "claude")).toBe(true);
  expect(agentUnavailable({ ...snapshot, externalAgentsAvailable: false }, "claude-api")).toBe(
    true,
  );
});
