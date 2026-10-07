# Usage Limits tab: a Codex 24-hour graph beside Claude's

Queue item **qi-29w4xfgm**, left from qi-3sr3jht6 (Greg's 2026-09-09 Usage Limits request). Greg,
2026-09-09, quoted in [261006l](261006l-usage-limits-tab-tooltips-for-the-last-unexplained-labels.md):

> Create separate sections with clear headings for Claude vs Codex, each laid out similar (e.g. each
> with their own X% used, graph, etc).

Everything in that request has landed except the graph for Codex: the 24-hour chart at the bottom of
the Usage Limits tab plots Claude windows only. Every history line already carries the Codex
observation made in the same pass (`UsageHistoryLine.codex`, persisted since
[260909d Stage 3](260909d-read-the-codex-subscription-usage-limits-and-show-them-beside-claude-s.md)),
and `usage-history-client.ts` already parses it into each sample. So this is chart work only.

**Not in scope:** a graph per *account*. Each record holds one Codex observation, of the login the
daemon reads; per-account history needs the record format changed —
[260910c § Stage 4](260910c-usage-limits-page-one-section-per-claude-and-codex-account-subscription.md)
and [usage-per-account.md § Not built](../project/usage-per-account.md#not-built-per-account-history).

## What the live data looks like

`~/.overseer/usage.jsonl` on the box, 2026-10-07, ~7,700 lines: every Codex observation but one is a
`value` with an `accountId`; one `unknown` (a failed fetch); 247 legacy lines with no `codex` key.
Buckets seen: `codex` (the general one, a 7-day window), `codex_bengalfox` (5-hour and 7-day) and
`base_model_inference` (7-day). Bucket order within a record varies between records.

## The design

### Series layer (`usage-history-series.ts`, pure, tested)

`plotUsageHistory` gains a `codex` field beside `accounts`:

```
codex: {
  series: CodexSeries[];      // one per (accountId, limitId, windowMinutes)
  unknownWindows: { label, why }[];   // named, never drawn, never zero
  notObserved: { atMs, why }[] | count  // records whose Codex arm was unknown/absent
}
CodexSeries = { accountId, limitId, limitName, general: boolean, windowMinutes, points, breaks, runs }
```

The rules, each one a test, each mirroring a rule the Claude series or the live card already keeps:

1. **The window is named by its duration, not its slot.** `primary`/`secondary` are positions
   ([usage-history.md § The Codex subscription reading](../project/usage-history.md#the-codex-subscription-reading)).
   Key = `(accountId, limitId, windowMinutes)`.
2. **Every record-level cut applies to Codex lines too**: an unsupported record, an unreadable hole,
   the clock going backwards, a recorder gap, an omitted record. These are about the record, and the
   Codex reading rides in the record. So the record loop stays one loop, and Codex series sit in the
   same `live` set as the Claude ones.
3. **A failed Claude pass does not cut a Codex line.** `collector-failed` is about the Claude
   collector; the line still carries its own Codex observation, which is drawn.
4. **An `unknown` Codex observation, or a legacy line with none, cuts every Codex line** — absence
   is a break, never a zero.
5. **An `unknown` window is a named row** (`<bucket> · <duration or slot>` — the provider's why),
   never drawn.
6. **A record carrying two value windows with the same bucket and duration draws neither** and cuts
   that line — the live card's rule (`carried duplicate … windows, so neither was chosen`).
7. **A `null` accountId forms no series**, as an unattributed Claude cache forms none: a line keyed
   on "unknown account" would join across a login swap.
8. **x is the record's source instant**, the same instant the Claude points and every cut use.
   The Codex `readAt` is the fetch instant, seconds from it (the two are concurrent by construction,
   `usage-history-wiring.ts`); putting points on a second clock would let a Codex point sit on the far
   side of a cut computed on the first.

`general` is `limitId === "codex"`, the same test as `isGeneralBucket` in
`AccountUsageSections.tsx`; it moves to one exported helper both import, rather than a second copy.

### Renderer (`UsageHistory.tsx`)

The drawing of one chart (axis labels, gridlines, the gap / regression / before-history washes, the
lines, the legend) becomes one `SeriesChart` component, and the section draws it twice under two
headings:

```
The last 24 hours
  Claude                                    ← existing caption, chart, legend
  [chart]
  Rejections seen …  (Claude only — transcript 429s)
  unknown Claude windows
  Codex                                     ← "the Codex login the daemon reads"
  [chart: general bucket's windows]
  ▸ N model-specific limits                 ← <details>, closed by default, one chart inside
  unknown Codex windows
  recorder-overdue / clock-regression notes (shared, once)
```

Stacked rather than side by side: the chart is a full-width time axis, and two half-width ones lose
most of the resolution on a phone. "Beside" in the queue item's title means "as well as".

The model-specific limits are collapsed by default because that is how the live sections above treat
them (Greg asked for the less important stuff to be hidden). Legend labels: `7 days`, `5 hours`,
and for a model-specific line `<limitName ?? limitId> · 7 days`; with more than one Codex account in
range, the account id fragment, as the Claude legend does.

When the window held records but no Codex point at all, the Codex half says so in a line rather than
drawing an empty chart.

**The simpler option passed over:** plot the Codex general window as one more line on the existing
Claude chart. Rejected: Greg asked for separate sections, each with its own graph, and one chart
with two providers' lines needs a provider in every legend entry to be readable.

## Stages

One stage: series layer + tests (red first), renderer, the doc line in
[usage-history.md](../project/usage-history.md), Sol code review, browser check at desktop, iPad and
phone widths.

## Done looks like

- `tests/fleet-usage-history-series.test.ts` has a test per rule above, each seen red.
- The Usage Limits tab shows a Codex chart under its own heading, with model-specific limits
  collapsed, at all three widths.
- `npm test`, `npm run typecheck` green.

## What landed (2026-10-07)

Built as planned, with GPT Sol's plan review
([261007n-codex-graph-plan-review-sol.md](261007n-codex-graph-plan-review-sol.md)) folded in:

- **Rule 6 was wrong as written** (Sol P1): the live card refuses duplicate *slots* and duplicate
  *bucket ids*, not only duplicate durations. All three now draw nothing and are named rows. And a
  ninth rule from the same card: the general bucket is withheld while a spend control is reached or
  unknown, or an individual spend limit is reported.
- Continuity tests for rules 4, 5 and 7, and account A → B → A (Sol P2).
- Rule 8 kept; its rationale now says pass time versus reply time rather than "seconds apart", and
  the caption says points are plotted at the pass time (Sol P2).
- Per-group empty state: model-specific points without a general one say so rather than drawing an
  empty chart (Sol P2).
- Legend and colours sorted by identity (bucket, duration, account), colour by duration, a dashed
  line for a second account; strokes use `non-scaling-stroke` (Sol P2).

`isGeneralCodexBucket` and `codexWindowLabel` moved to `tools/fleet/web/src/codex-buckets.ts`, used
by the live card, the per-account sections and the chart. Tests:
`tests/fleet-usage-history-codex-series.test.ts` — the new-rule tests were seen red by disabling each
rule, and the render tests by unmounting the Codex half.
