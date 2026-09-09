# Review prompt: the type scale, `StatCard`, and the Usage limits rewrite

A code review of built and tested work, at the end of a stage. **Weight this higher than the
plan-stage review you did earlier**: a plan review cannot find a component that renders one honest
absence under another's name, and that is exactly the class of defect this stage produced twice.

## The candidate

Repository: `/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system`, branch
`worktree-dashboard-design-system`. Review the working tree at its current `HEAD` plus uncommitted
changes — run `git status` and `git diff HEAD` to see both. The stage spans these commits and the
uncommitted follow-up:

- `e7d6f9d9` — the type scale in `tailwind.css`, `StatCard` in `ui.tsx`, `tests/fleet-stat-card.test.tsx`
- `d3961d1d` — the Usage rewrite in `UsagePanel.tsx`, plus test updates
- uncommitted — folding the cache entries that never carried a number into a disclosure

Scoped diff to read:

```
git diff e5178536 -- tools/fleet/web/src/ui.tsx tools/fleet/web/src/tailwind.css \
  tools/fleet/web/src/UsagePanel.tsx tests/fleet-stat-card.test.tsx \
  tests/fleet-usage-card.test.tsx tests/fleet-tooltip-copy.test.ts
```

Also read, as context rather than as candidate: `docs/reusable/design-a-screen.md`,
`docs/plans/260909c-dashboard-design-system-research-a-reusable-ui-ux-prompt-then-apply-it-usage-limits-first.md`,
`tools/fleet/wire.ts` §§ `UsageWindowCard`, `UsageSummary`, `UsageIncident`, and your own earlier
reviews `260909c-dashboard-design-system-plan-review-sol-r1.md` and
`260909c-dashboard-design-system-screens-review-sol-r1.md`.

**Do not change any file.** You have no network; you can run tests that need nothing outside the
tree. `npx vitest run tests/fleet-stat-card.test.tsx tests/fleet-usage-card.test.tsx
tests/fleet-tooltip-copy.test.ts` works and takes seconds — please actually run it.

## Raw results I am handing you rather than asserting

```
npx vitest run tests/fleet-*.test.ts tests/fleet-*.test.tsx
  Test Files  70 passed (70)
  Tests  2446 passed (2446)

node --import tsx scripts/typecheck.ts   → exit 0
npm run build:fleet                      → built, and tw:text-answer compiles to font-size:22px
```

Mutation results, because a test that was never red proves nothing. Each mutation was applied,
the suite run, and the tree restored:

| Mutation | Killed |
|---|---|
| The three `AbsentState` words collapsed to one em-dash | 5 tests |
| An absence takes the caller's tone instead of its own | 2 tests |
| The `stale` age dropped from the evidence line | 1 test |
| A window whose reset has passed draws its percentage anyway | 1 test (`fleet-usage-card`) |

## What this stage did

1. **A five-step type scale** in `tailwind.css` (`answer` 22 / `lead` 15 / `body` 13 / `note` 12 /
   `label` 11). Sizes only; weight and colour deliberately not welded to the step. Motivation: 356
   of 368 sizing utilities in the client were in the 10–13px band.
2. **`StatCard`** in `ui.tsx`, generalising `HealthPanel`'s stat tile — the only place on the
   dashboard where the number the reader came for is the biggest thing in its box. Its `StatValue`
   union is `value` | `stale` | `absent` with `AbsentState` of `unknown` | `withheld` |
   `unavailable`, on your S2-01 (*"do not use a bare em dash: without the explanatory state word, it
   conflates unknown, absent, and failed"*).
3. **`UsagePanel` rewritten** from seventeen equally-primary paragraphs into: verdict → when work can
   resume → cached headroom as stat cards → why (the producer's reasons, still on the page) →
   evidence (account, reading age, coverage) → provenance in a closed `<details>`.

## Two defects I found by looking at the rendered page after the suite was green

Both are fixed; I describe them because they bound what your review should assume the tests cover.

- A window whose `kind` is `unknown` was mapped to the `unavailable` state. Both are honest
  absences, so nothing went red — but the tab drew three red alarm cards over what is merely a gap.
  Now `withheld`.
- For an `expired` window the card prefixed the producer's `why` with a sentence saying what `why`
  already said. Eleven lines in one grid cell.

## The questions I want answered

1. **Does any path still let a void or unattributable number reach the screen?** Trace every arm of
   `UsageSummary.cache` and `UsageWindowCard` through `windowStat` and the grid. The
   `100 - utilizationPercent` derivation is new — is `left` always meaningful, and can it be
   negative, `NaN`, or over 100 from any input the wire permits?
2. **Is the `unknown` / `withheld` / `unavailable` assignment right at every call site?** I got one
   wrong already. In particular: cache `unknown` → `unavailable`, cache `unattributed` → `withheld`,
   window `unknown` → `withheld`, window `expired` → `unknown`, a `value` whose reset has passed →
   `unknown`, and `DueBackCard`'s unreadable instant → `unavailable`. Argue with any of those.
3. **Is folding the never-usable cache entries into a `<details>` a demotion of an honest absence?**
   The count is on the face and the entries are one tap behind. I think it is the same partition
   `Incidents` already makes; you may think it is the redesign quietly hiding a caveat, which is the
   thing this whole plan is pointed at. This is the finding I most want challenged.
4. **What did the rewrite lose?** Diff the old render against the new one and name anything that was
   on screen before and is now only in a tooltip, only in a `<details>`, or gone. I know of one — the
   three-zone wall-clock instants for everything except the reset — and I want the list I do not know.
5. **Are the tests still testing?** I changed four assertions rather than fixing the code. Each is
   argued in a comment; say whether any of them weakened the guarantee rather than restating it. The
   `li`-count change is the one I am least sure of.
6. **The type scale.** Five steps, no sixth, nothing below 11px. Is `lead` at 15px too close to
   `body` at 13px to read as a step (~15%, against the ~25% rule the doc states)? If so, say what
   you would do instead, given `body` is 15px and the page is dense.

## Severity scale

`P0` misleading, unsafe, or loses a safety property · `P1` materially wrong · `P2` worth fixing ·
`P3` taste. An ID on every finding, the file and line, and the evidence you used. Say where you
think it is fine.

## My suspicions, last

- I suspect (3) is defensible but that the *summary wording* is doing too much work — "carried no
  usable number" is my sentence, not the producer's, and this file's own rule is that re-writing a
  measurement's own words is how a second interpretation gets in.
- I suspect `windowStat`'s tone thresholds (`left <= 10` alarm, `<= 25` needs) are invented numbers
  with nothing behind them, and that inventing a threshold is worse than having none.
- I am unsure whether `Cached headroom` as a heading over cards that include a `Withheld` entry is
  accurate, since a withheld entry is not headroom.
