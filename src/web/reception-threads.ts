/**
 * **Reception's threads: the themes the sources share, and the key sources** —
 * plan 260930j (SPIDERYARN-READING2-6M). Pure, so the panel draws what these
 * return and a test can check it without a DOM.
 *
 * **What a thread is depends on the sub-mode, since plan 261020n**
 * (spya-dk4tfq). Greg found the box of filter buttons over Reception's list
 * "bewildering": it looked like a table of contents and gathered nothing.
 *
 *  - **In Reception a thread is a section**: a collapsed `<details>` holding
 *    its own rows, inside the AI's frame (ReceptionAndClaimsPanel.tsx §
 *    `ReceptionSections`). It filters nothing — *Every page* under it holds
 *    every row — and `?receptionthread=` opens that section and scrolls to it.
 *  - **In Claims it is still a filter**: one button above the list, and
 *    pressing it narrows the list to its rows; `?receptionthread=` holds which
 *    one (url-state.md: nothing the reader can change lives in `useState`).
 *    The key sources are a thread too, `key`, so the box has one kind of
 *    button and the list one kind of filter.
 *
 * **In Claims the filter runs after the relevance bar**, as a second
 * narrowing. So a thread's count is the rows *on screen* in it, and a thread
 * the bar has emptied is drawn disabled rather than offered as a button that
 * empties the list.
 *
 * **Scoped to the sub-mode on screen**, since 2026-10-03 (plan 261003o, step
 * 6). Reception and Claims each draw one search's rows, and one synthesis spans
 * both. So a thread is offered in a sub-mode only when it has a **stored** row
 * there (`threadsWithin`), and one the address names that has none there
 * narrows nothing, opens nothing and is not drawn as selected — Greg's
 * `receptionthread=key` link, whose key sources were all on one claim, must not
 * empty Reception. *No stored row here* and *rows here hidden by the bar* are
 * different facts and stay different: the second keeps its disabled button and
 * its sentence.
 */
import type { ReceptionKeySource, ReceptionSynthesis } from "../types.js";
/* The constant lives in params.ts, the eager file, so that file need not
   import this one (tests/eager-client-graph.test.ts). */
import { KEY_THREAD } from "./params.js";

export { KEY_THREAD };

export interface Thread {
  /** What `?receptionthread=` holds. */
  id: string;
  kind: "key" | "theme";
  label: string;
  /** The theme's one sentence; `null` for the key sources, whose reasons are on their rows. */
  gist: string | null;
  rowIds: ReadonlySet<string>;
}

/**
 * The threads, in the order Reception's sections and Claims' buttons draw
 * them: the key sources first, since they answer *which of these matter most*,
 * then the themes in the model's order. Empty for anything but a `made`
 * synthesis.
 */
export function threadsOf(synthesis: ReceptionSynthesis | null): Thread[] {
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
export function keyByRow(synthesis: ReceptionSynthesis | null): ReadonlyMap<string, ReceptionKeySource> {
  if (synthesis?.kind !== "made") return new Map();
  return new Map(synthesis.key.map((k) => [k.rowId, k]));
}
