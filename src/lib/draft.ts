/**
 * Shared editing rules for a saved value and its unsaved draft. The draft keeps the revision it
 * started from, so a newer saved revision marks it stale instead of silently overwriting.
 */
export function editDraft<T extends { revision: number }>(
  saved: T,
  draft: T | undefined,
  setDraft: (value: T | null) => void,
) {
  const changed = (value: T) =>
    (Object.keys(saved) as (keyof T)[]).some((k) => k !== "revision" && value[k] !== saved[k]);
  const value = draft ?? saved;
  const dirty = changed(value);
  return {
    value,
    dirty,
    stale: dirty && value.revision !== saved.revision,
    update: (fields: Partial<Omit<T, "revision">>) => {
      const next = { ...value, ...fields };
      // Typing back to the saved content is the same as having no draft.
      setDraft(changed(next) ? next : null);
    },
    reset: () => setDraft(null),
  };
}
