/**
 * **Debate's threads: the themes the sources share, and the key sources, as
 * filters on the list** — plan 260930j (SPIDERYARN-READING2-6M). Pure, so the
 * panel draws what these return and a test can check it without a DOM.
 *
 * A *thread* is one button above the list. Pressing it narrows the list to its
 * rows; `?debatethread=` holds which one (url-state.md: nothing the reader can
 * change lives in `useState`). The key sources are a thread too, `key`, so the
 * box has one kind of button and the list one kind of filter.
 *
 * **The filter runs after the relevance bar**, as a second narrowing. So a
 * thread's count is the rows *on screen* in it, and a thread the bar has
 * emptied is drawn disabled rather than offered as a button that empties the
 * list.
 *
 * **Scoped to the sub-mode on screen**, since 2026-10-03 (plan 261003o, step
 * 6). Reception and Claims each draw one search's rows, and one synthesis spans
 * both. So a thread is offered in a sub-mode only when it has a **stored** row
 * there (`threadsWithin`), and one the address names that has none there
 * narrows nothing and is not drawn as selected — Greg's `debatethread=key`
 * link, whose key sources were all on one claim, must not empty Reception.
 * *No stored row here* and *rows here hidden by the bar* are different facts
 * and stay different: the second keeps its disabled button and its sentence.
 */
import type { DebateKeyRole, DebateKeySource, DebateSynthesis } from "../types.js";
/* The constant lives in params.ts, the eager file, so that file need not
   import this one (tests/eager-client-graph.test.ts). */
import { KEY_THREAD } from "./params.js";

export { KEY_THREAD };

export interface Thread {
  /** What `?debatethread=` holds. */
  id: string;
  kind: "key" | "theme";
  label: string;
  /** The theme's one sentence; `null` for the key sources, whose reasons are on their rows. */
  gist: string | null;
  rowIds: ReadonlySet<string>;
}

/** The reason on a key row, in words a reader reads rather than the stored enum. */
export const KEY_ROLE_LABEL: Record<DebateKeyRole, string> = {
  responds: "takes it on",
  advances: "moves it forward",
  dissents: "takes a different view",
  origin: "where the claim comes from",
};

/**
 * The buttons, in the order they are drawn: the key sources first, since they
 * are the answer to *which of these matter most*, then the themes in the
 * model's order. Empty for anything but a `made` synthesis.
 */
export function threadsOf(synthesis: DebateSynthesis | null): Thread[] {
  if (synthesis?.kind !== "made") return [];
  const threads: Thread[] = [];
  if (synthesis.key.length > 0) {
    threads.push({
      id: KEY_THREAD,
      kind: "key",
      label: "Key sources",
      gist: null,
      rowIds: new Set(synthesis.key.map((k) => k.rowId)),
    });
  }
  for (const theme of synthesis.themes) {
    threads.push({
      id: theme.id,
      kind: "theme",
      label: theme.label,
      gist: theme.gist,
      rowIds: new Set(theme.rowIds),
    });
  }
  return threads;
}

/**
 * **The threads one sub-mode offers**: those with at least one row among
 * `stored`, that sub-mode's rows **before** any bar. Asked of the stored rows
 * and not the visible ones, so a thread the bar has emptied is still here to be
 * drawn disabled.
 */
export function threadsWithin(threads: readonly Thread[], stored: readonly { id: string }[]): Thread[] {
  return threads.filter((t) => stored.some((r) => t.rowIds.has(r.id)));
}

/**
 * The thread the address names, or `null` — including for an id this debate
 * does not have (a link from before a re-run), which reads as *no filter*
 * rather than as an empty list. Handed a sub-mode's own threads
 * (`threadsWithin`), it answers `null` for one with no stored row there too.
 */
export function selectedThread(threads: readonly Thread[], param: string | null): Thread | null {
  if (param === null) return null;
  return threads.find((t) => t.id === param) ?? null;
}

/** The rows in `thread`, in their own order; every row when there is none. */
export function inThread<R extends { id: string }>(rows: readonly R[], thread: Thread | null): R[] {
  return thread === null ? [...rows] : rows.filter((r) => thread.rowIds.has(r.id));
}

/** How many of a thread's rows the bars left on screen — its button's count. */
export function shownInThread(thread: Thread, visible: readonly { id: string }[]): number {
  return visible.filter((r) => thread.rowIds.has(r.id)).length;
}

/** Each key row's reason, by row id, for the line at the top of the row. */
export function keyByRow(synthesis: DebateSynthesis | null): ReadonlyMap<string, DebateKeySource> {
  if (synthesis?.kind !== "made") return new Map();
  return new Map(synthesis.key.map((k) => [k.rowId, k]));
}
