import type { StateCreator } from "zustand";
import type { AgentEvent } from "../api";
import type { Snapshot } from "@/bindings/Snapshot";
import type { BoardAction } from "@/bindings/BoardAction";
import type { Card } from "@/bindings/Card";
import type { CardReference } from "@/bindings/CardReference";
import type { ConnectionStatus } from "@/bindings/ConnectionStatus";
import type { ChatOption } from "@/bindings/ChatOption";

export type Permission = {
  id: string;
  title: string;
  request: { options: { optionId: string; name: string; kind: string }[]; toolCall: unknown };
};
export type Draft = { title: string; body: string; revision: number };
/** What the single agent slot is doing. `conversation: null` means the first message is creating one. */
export type Busy =
  | { kind: "chat"; conversation: string | null }
  | { kind: "settings" }
  | { kind: "connecting"; agent: string };
/**
 * Sign-in is shared by all projects, but each project has its own launch settings.
 * A status is reused only while the current project launches the agent the same way.
 */
type Connection = { status: ConnectionStatus; launch: string };
export type ProjectDraft = { name: string; memory: string; revision: number };
export type Workspace = {
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  chatError: string | null;
  /** Keyed by agent id. Read through `connectionStatus`. */
  connections: Record<string, Connection>;
  setConsent: (agent: string, granted: boolean) => Promise<void>;
  connect: (agent: string, action: "check" | "login" | "logout") => Promise<void>;
  loadChatOptions: (model: string | null) => Promise<ChatOption[]>;
  snapshot: Snapshot;
  loaded: boolean;
  switching: boolean;
  projectDrafts: Record<string, ProjectDraft>;
  changeProject: (id: string) => Promise<boolean>;
  createProject: (name: string, memory: string) => Promise<boolean>;
  deleteProject: (id: string) => Promise<boolean>;
  selected: string | null;
  conversation: string | null;
  references: CardReference[];
  drafts: Record<string, Draft>;
  error: string | null;
  busy: Busy | null;
  stream: string;
  activity: string;
  permissions: Permission[];
  select: (id: string) => void;
  selectConversation: (id: string | null) => void;
  refresh: () => Promise<void>;
  act: (action: BoardAction) => Promise<Snapshot | null>;
  archivePending: boolean;
  archiveNotice: { projectId: string; cardId: string; revision: number } | null;
  setArchived: (id: string, archived: boolean) => Promise<void>;
  newConversation: (agent: string) => Promise<string | null>;
  attach: (card: Card, quote?: string) => void;
  detach: (index: number) => void;
  draft: (id: string, value: Draft | null) => void;
  draftProject: (id: string, value: ProjectDraft | null) => void;
  send: (text: string, agent: string, options?: { useReferences?: boolean }) => Promise<boolean>;
  broadenTopics: () => Promise<boolean>;
  event: (event: AgentEvent) => void;
  answer: (id: string, option: string | null) => Promise<void>;
};

export type WorkspaceSlice<K extends keyof Workspace> = StateCreator<
  Workspace,
  [],
  [],
  Pick<Workspace, K>
>;
