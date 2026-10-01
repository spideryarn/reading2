# The Earlier tab marks every report, shipped or not

[SPIDERYARN-READING2-7D](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-7D), report
`spya-mzxq7c`, 2026-09-30 23:01 UTC, `kind=suggestion`, from Greg (admin — `feedback-reporter.ts` exit 0),
on `dongetal25-spya-vfmvmm`, build `fe57a1ea`.

> In Feedback / Earlier / All, add the indicator for whether each suggestion has shipped or not.
>
> — Greg, 2026-09-30

Builds on [260930e](260930e-earlier-tab-filters-by-done-from-the-notes.md), which added the
`shipped` flag to each row, the All · Shipped · Not shipped filter, and a **Shipped** word in the
meta line of a shipped row. Build `fe57a1ea` contains 260930e (`65c8984b` is its ancestor), so
Greg was looking at that feature.

## What is missing

In All, a shipped row says `1 Oct 2026 · Suggestion · Shipped`, and a not-shipped row says
`1 Oct 2026 · Suggestion` — nothing. An absence is not an indicator: the reader cannot tell "not
shipped" from "this row has no status", and scanning the list for the not-shipped ones means
looking for a missing word.

## The change

In **All**, every row's meta line ends in one of two words:

```
1 Oct 2026 · Suggestion · Shipped        (accent colour, semibold, as now)
30 Sep 2026 · Problem · Not shipped      (--ink-soft, normal weight)
```

- **Not shipped** gets its own class, `fb-earlier-unshipped`, and a `title`: *"This isn't marked
  as shipped in the version of Spideryarn you're using."* Epistemic, not a claim about the world:
  `shipped: false` means only "no note marks it shipped", which covers declined, awaiting, on `dev`
  but not deployed, a split report with a half still open, and a note missing its header — in
  which last two cases a change may already be live.
- Quiet on purpose, so the shipped ones still stand out — but in `--ink-soft`, not the meta line's
  `--ink-faint`, which is about 4.44:1 on the dark panel, just under AA for text that carries
  meaning.
- **Only in All.** `EarlierList` already receives `show`, so this costs one condition. In the Not
  shipped filter every row would say it; in Shipped it never applies.

No server, wire-shape, or store change: `shipped: boolean` is already on every row.

### The simpler option passed over

Leave not-shipped rows bare and make Shipped louder (a badge). Rejected: Greg asked for the
indicator on *each* report, and a louder Shipped still leaves the other state as an absence.

### Changed by the plan review

[GPT Sol](261001c-earlier-tab-marks-not-shipped-too-plan-review-sol.md) — REVISE, all three taken:
the first title ("No change for this is in the version…") asserted more than the flag knows;
`--ink-faint` fell just short on contrast; and "every filter" was justified by a prop that already
exists, so it is All only.

## Tests

In `tests/feedback-dialog.test.tsx`, beside "marks a shipped report, and only that one":

- "in All, says Not shipped on every row that has not shipped" — red before the change, green
  after;
- "does not repeat Not shipped on every row of the Not shipped filter" — green before (there was no
  marker), so it was checked by mutating the condition to `true`: red, then put back.

## Not a defence

A client-only label on the reader's own rows. No auth, RLS, gate or admin change.
