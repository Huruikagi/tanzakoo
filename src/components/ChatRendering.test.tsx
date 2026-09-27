import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Chat } from "./Chat";
import { emptySnapshot } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import { setLanguage } from "@/lib/i18n";

const rendered = vi.hoisted(() => vi.fn());
vi.mock("./Markdown", async (importOriginal) => {
  const { Markdown } = await importOriginal<typeof import("./Markdown")>();
  return {
    Markdown: (props: { children: string }) => {
      rendered(props.children);
      return <Markdown {...props} />;
    },
  };
});
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  native: true,
}));

beforeEach(() => {
  setLanguage("ja");
  rendered.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  useWorkspace.setState({
    snapshot: {
      ...emptySnapshot,
      project: { id: "render", name: "Render", memory: "", revision: 1 },
      consents: ["codex"],
      conversations: [{ id: "c", title: "相談", agent: "codex", sessionId: null, createdAt: 1 }],
      messages: [
        {
          id: "m",
          conversationId: "c",
          role: "user",
          text: "保存済みの発言",
          references: [],
          createdAt: 1,
        },
      ],
    },
    conversation: "c",
    busy: { kind: "chat", conversation: "c" },
    stream: "",
    activity: "接続しています…",
    references: [],
    permissions: [],
    chatError: null,
    reviewAccess: null,
    switching: false,
    connections: {},
    questionDrafts: {},
  });
});

it("updates streaming and scrolling without rerendering saved history, and still refreshes saved content and language", () => {
  render(<Chat />);
  expect(rendered).toHaveBeenCalledWith("保存済みの発言");
  rendered.mockClear();
  vi.mocked(Element.prototype.scrollIntoView).mockClear();

  act(() =>
    useWorkspace
      .getState()
      .event({ conversationId: "c", kind: "delta", text: "応答の途中", detail: null }),
  );
  expect(screen.getByText("応答の途中")).toBeInTheDocument();
  expect(rendered).not.toHaveBeenCalledWith("保存済みの発言");
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "end" });

  fireEvent.change(screen.getByLabelText("エージェントへのメッセージ"), {
    target: { value: "書きかけ" },
  });
  expect(rendered).not.toHaveBeenCalledWith("保存済みの発言");
  act(() => setLanguage("en"));
  expect(screen.getByText("You")).toBeInTheDocument();
  expect(screen.getByDisplayValue("書きかけ")).toBeInTheDocument();

  act(() =>
    useWorkspace.setState((s) => ({
      snapshot: {
        ...s.snapshot,
        messages: [
          ...s.snapshot.messages,
          {
            id: "reply",
            conversationId: "c",
            role: "assistant",
            text: "保存された応答",
            references: [],
            createdAt: 2,
          },
        ],
      },
      busy: null,
      stream: "",
    })),
  );
  expect(screen.getByText("保存された応答")).toBeInTheDocument();
  expect(screen.queryByText("応答の途中")).not.toBeInTheDocument();
});
