import { expect, it } from "vitest";
import capability from "../../src-tauri/capabilities/default.json";
import { externalAgents } from "./external-agents";

it("allows every official setup link through the native opener capability", () => {
  const permission = capability.permissions.find(
    (p) => typeof p !== "string" && p.identifier === "opener:allow-open-url",
  );
  if (!permission || typeof permission === "string") throw new Error("Missing opener capability");
  for (const agent of externalAgents) {
    expect(permission.allow).toContainEqual({ url: agent.url });
  }
});
