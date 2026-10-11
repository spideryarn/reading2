# Sources left of Referee in the bottom bar

Report spya-eyaf3n (SPIDERYARN-READING2-GT), Greg, 2026-10-10, from Sources on
`lawrence-kuhn-2024-a-landscape-of-consciousness`:

> Sources should be to the left of referee in the bottom bar.

Up: [reading-view-overview.md](../project/reading-view-overview.md) via
[mode.md](../project/mode.md) (`MODES_UI` is the bar's order).

## What changes

The critical run goes from `Referee | Sources` to `Sources | Referee`. Nothing else moves.

- **`MODES_UI`** in [`src/web/Dock.tsx`](../../src/web/Dock.tsx) — the one place the order is
  defined ([mode.md](../project/mode.md), the `MODES_UI` row). The two rows swap, and the comments
  that called Referee "first of the critical run" and Sources "last" swap with them.
- **Everything that reads it follows without an edit**: the command bar's list, the More menu,
  and the phone and touch bar, which are the same `Dock` measured by the fit ladder
  ([phone-and-touch.md](../project/phone-and-touch.md) § the bottom bar's fit — no second list).
  `MODES` in `src/modes.ts` is ordered, but it is not the bar's order — `/help` deliberately
  walks its own — and stays as it is. The Features page already shows Sources before Referee.
- **[`tests/dock-mode-order.test.ts`](../../tests/dock-mode-order.test.ts)** — `RUNS`, written by
  hand, gets the new order and Greg's sentence in its header. The run's line is drawn before its
  first member, so with the experimental switch on it now falls before Sources, not Referee. With
  the switch off, Referee (still experimental) is not offered; a reader in Referee by URL sees it
  drawn after Sources, and the line stays at Sources. The last case is rewritten to say so.
- **[`tests/dock-more.test.tsx`](../../tests/dock-more.test.tsx)** holds a second full-order
  assertion (the bar with the switch on), swapped to match. Found by GPT Sol's plan review.

Lines between runs, the More menu, which modes are experimental: unchanged.

## The simpler option passed over

None simpler exists; this is the minimum. The alternative considered was moving Referee out of the
critical run (e.g. to the end of the bar), which nobody asked for.

## Reviews

GPT Sol plan review: [261011a-…-plan-review-sol.md](261011a-sources-left-of-referee-in-the-bottom-bar-plan-review-sol.md).
GPT Sol code review: [261011a-…-code-review-sol.md](261011a-sources-left-of-referee-in-the-bottom-bar-code-review-sol.md).
