import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";

export function MarkdownEditor({
  value,
  onChange,
  onSelection,
  label = "カード本文",
}: {
  value: string;
  onChange: (value: string) => void;
  onSelection: (quote: string) => void;
  label?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const syncing = useRef(false);
  const callbacks = useRef({ onChange, onSelection });
  useEffect(() => {
    callbacks.current = { onChange, onSelection };
  }, [onChange, onSelection]);
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: "",
        extensions: [
          markdown(),
          syntaxHighlighting(defaultHighlightStyle),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          placeholder("気になること、話したこと、決めたことをMarkdownで。"),
          EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing.current)
              callbacks.current.onChange(update.state.doc.toString());
            if (update.selectionSet || update.docChanged) {
              const { from, to } = update.state.selection.main;
              callbacks.current.onSelection(update.state.sliceDoc(from, to));
            }
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // Document synchronization is handled below; keep the editor and undo history alive.
  }, [label]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      syncing.current = true;
      try {
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
      } finally {
        syncing.current = false;
      }
    }
  }, [value]);
  return <div ref={host} className="markdown-editor" />;
}
