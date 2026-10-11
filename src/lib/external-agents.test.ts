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
