import type { Snapshot } from "@/bindings/Snapshot";

export const externalAgents = [
  {
    id: "antigravity",
    name: "Antigravity",
    url: "https://www.antigravity.google/docs/ide/extensions/zed",
    login: "agy",
    serverUrl:
      "https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json",
    loginUrl: "https://www.antigravity.google/docs/cli/install/",
  },
  {
    id: "claude-api",
    name: "Claude API",
    url: "https://github.com/agentclientprotocol/claude-agent-acp",
    login: "claude auth login --console",
    authUrl: "https://code.claude.com/docs/en/authentication",
  },
  {
    id: "copilot",
    name: "GitHub Copilot CLI",
    url: "https://docs.github.com/en/copilot/get-started/cli-quickstart",
    login: "copilot login",
  },
  {
    id: "opencode",
    name: "OpenCode",
    url: "https://opencode.ai/docs/",
    login: "opencode auth login",
  },
  { id: "devin", name: "Devin CLI", url: "https://docs.devin.ai/", login: "devin auth login" },
  {
    id: "claude-personal",
    name: "Claude (Personal)",
    url: "https://github.com/agentclientprotocol/claude-agent-acp",
    login: "claude auth login",
    authUrl: "https://code.claude.com/docs/en/authentication",
  },
] as const;
export const availableExternalAgents = (snapshot: Snapshot) =>
  snapshot.externalAgentsAvailable
    ? externalAgents.filter((a) => a.id !== "claude-personal" || snapshot.personalClaudeAvailable)
    : [];
export const externalAgent = (id: string) => externalAgents.find((a) => a.id === id);
export const externalConsent =
  "会話・ボード・メモリと、AIが読む参照資料を、選択したCLIとその接続先へ渡します。送信先・料金・モデルはCLI側の設定に従います。CLI自身のツールや拡張機能も動作する場合があります。同意は同じ起動設定のプロジェクト間で共通で、設定から取り消せます。";
