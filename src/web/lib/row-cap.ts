/**
 * **Show the first N rows, and say how many there are altogether.**
 *
 * Greg, 2026-09-06: *"the table should by default only show the top 50? or so
 * Articles, with a button at the bottom to show all."*
 *
 * One function rather than two expressions at the call site, and that is the
 * whole reason it exists. The slice and the reveal button have to agree — a list
 * capped with no button is a reader stuck at fifty, and a button over an uncapped
 * list is a control that does nothing — and as two separate conditions in JSX
 * they agree only as long as nobody edits one of them. Here the caller gets both
 * answers from one call, so they cannot drift.
 *
 * It lives in `lib/` rather than in `Library.tsx` because it is about lists
 * rather than about the shelf: the cards view and `/admin`'s table have the same
 * problem, and neither would want to copy the arithmetic. It is deliberately
 * **not** in `DataTable.tsx` — see
 * docs/plans/260906g-the-shelf-table-is-ugly-because-the-reading-view-s-css-leaks-into-it.md
 * § Stage 3 on why the cap is the caller's policy and not the table's.
 */

/**
 * What to draw, and whether to offer the rest.
 *
 * `revealTotal` is a **number or null**, not a boolean beside a count, so
 * "there is more to show" and "how much there is" cannot be separated: the
 * button is drawn exactly when this is a number, and the number is the only
 * thing it can say.
 */
export type CappedRows<T> = {
  /** The rows to render now. */
  shown: T[];
  /** The full count, when some are hidden; `null` when everything is on screen. */
  revealTotal: number | null;
};

export function capRows<T>(rows: T[], cap: number, expanded: boolean): CappedRows<T> {
  /* A cap of 0 or less means "no cap", rather than an empty list — a caller
     passing a misconfigured number should get a usable page, not a blank one.
     `expanded` short-circuits before the slice so the common case does no work. */
  if (expanded || cap <= 0 || rows.length <= cap) return { shown: rows, revealTotal: null };
  return { shown: rows.slice(0, cap), revealTotal: rows.length };
}
