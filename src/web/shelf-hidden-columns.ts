/**
 * Which of the shelf table's columns this reader has hidden, remembered in this
 * browser.
 *
 * Greg, 2026-09-28: *"Maybe I can right-click a column to hide it? but then I'd
 * need a way to reveal it again. Or maybe they always all re-show on
 * re-opening the table?"* Remembered, rather than re-shown on every visit:
 * somebody who hides Opens hides it because they never want it, and making
 * them do it again each time is the annoyance. The trap re-showing protects
 * against — a column gone with no way back — is closed instead by the Columns
 * control, which is always drawn in table view and says how many are hidden.
 * docs/plans/260928a-shelf-table-view-row-card-full-titles-hide-columns.md,
 * Decision 3 and assumption A2.
 *
 * **Per browser, not per account and not in the URL.** It is a preference about
 * this screen, not a view of the shelf worth sending to somebody.
 *
 * ## Everything unreadable lands on "everything shown"
 *
 * Storage that throws, a value that is not JSON, not an array, or names a
 * column we no longer have — each is read as nothing hidden (an unknown id is
 * dropped on its own, so one stale id does not cost the reader the rest). The
 * failure that matters is the other direction: a list that hid the title would
 * leave rows with nothing to click. So the list is filtered against the
 * columns that say they *can* be hidden — `enableHiding: false` on Article and
 * Actions in library-columns.tsx — and those two can never come back out of
 * here, whatever the store holds.
 */
import { useCallback, useMemo, useState } from "react";
import { functionalUpdate, type OnChangeFn, type VisibilityState } from "@tanstack/react-table";

/** One key, holding a JSON array of hidden column ids. */
export const HIDDEN_COLUMNS_KEY = "spya.shelf.hiddenColumns";

/** Just enough of a column definition to know whether it may be hidden. */
interface HideableColumn {
  id: string;
  enableHiding?: boolean;
}

/**
 * The hidden ids in `raw`, keeping only those in `hideable`.
 *
 * Exported so the parsing can be read on its own; the hook is what the page
 * uses.
 */
export function parseHiddenColumns(raw: string | null, hideable: readonly string[]): string[] {
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string" && hideable.includes(id));
}

/**
 * Wrapped for the three reasons small-screen-hint.ts gives: Safari's private
 * mode throws outright, site data may be blocked, and under vitest with jsdom
 * `localStorage` is shadowed by Node's own global and reads `undefined`.
 */
function readRaw(): string | null {
  try {
    return window.localStorage.getItem(HIDDEN_COLUMNS_KEY);
  } catch {
    return null;
  }
}

function writeHidden(ids: string[]): void {
  try {
    window.localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(ids));
  } catch {
    /* See `readRaw`. The choice still holds for this visit — it is React
       state — and is simply not there on the next one. */
  }
}

/** TanStack's shape: a hidden column is `false`; a shown one is absent. */
function toVisibility(hidden: readonly string[]): VisibilityState {
  return Object.fromEntries(hidden.map((id) => [id, false]));
}

/**
 * **`[columnVisibility, onColumnVisibilityChange]`, for `useSortedTable`.**
 *
 * The state is React state, so its identity only changes when the reader
 * changes it — TanStack keys its visible-column memos on that identity, and a
 * fresh object per render is the shape of lib/DataTable.tsx's render-loop
 * history. Written to storage in the setter rather than in an effect, so
 * mounting writes nothing.
 */
export function useShelfHiddenColumns(
  columns: readonly HideableColumn[],
): [VisibilityState, OnChangeFn<VisibilityState>] {
  /* Joined, so a `columns` rebuilt with the same ids (Library.tsx rebuilds it
     when `now` ticks) does not count as a change. */
  const key = columns
    .filter((c) => c.enableHiding !== false)
    .map((c) => c.id)
    .join("\n");
  const hideable = useMemo(() => (key ? key.split("\n") : []), [key]);

  const [visibility, setVisibility] = useState<VisibilityState>(() =>
    toVisibility(parseHiddenColumns(readRaw(), hideable)),
  );

  const onChange = useCallback<OnChangeFn<VisibilityState>>(
    (updater) => {
      const next = functionalUpdate(updater, visibility);
      /* Only what may be hidden, and only what is: a stray `title: false` from
         anywhere never reaches the table or the store. */
      const hidden = hideable.filter((id) => next[id] === false);
      writeHidden(hidden);
      setVisibility(toVisibility(hidden));
    },
    [visibility, hideable],
  );

  return [visibility, onChange];
}
