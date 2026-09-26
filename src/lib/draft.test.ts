import { describe, expect, it, vi } from "vitest";
import { editDraft } from "./draft";

const saved = { title: "利用場面", body: "毎朝", revision: 2 };

describe("editDraft", () => {
  it("keeps the starting revision so a newer save marks the draft stale", () => {
    const setDraft = vi.fn();
    editDraft(saved, undefined, setDraft).update({ body: "毎晩" });
    const draft = setDraft.mock.calls[0][0];
    expect(draft).toEqual({ title: "利用場面", body: "毎晩", revision: 2 });
    expect(editDraft(saved, draft, setDraft)).toMatchObject({ dirty: true, stale: false });
    expect(editDraft({ ...saved, revision: 3 }, draft, setDraft).stale).toBe(true);
  });
  it("drops the draft when edits return to the saved content", () => {
    const setDraft = vi.fn();
    editDraft(saved, { ...saved, body: "毎晩" }, setDraft).update({ body: "毎朝" });
    expect(setDraft).toHaveBeenCalledWith(null);
  });
  it("treats a draft at an older revision with unchanged content as clean", () => {
    const state = editDraft({ ...saved, revision: 3 }, saved, vi.fn());
    expect(state).toMatchObject({ dirty: false, stale: false });
  });
});
