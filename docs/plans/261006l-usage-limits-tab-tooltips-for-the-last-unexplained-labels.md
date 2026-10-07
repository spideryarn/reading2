# Usage Limits tab: two missing tips and a stale percentage explanation

Up: [plans.md](../project/plans.md)

Queue item `qi-3sr3jht6`, in Greg's words, 2026-09-09:

> Can you make the usage/remaining clearer (e.g. with a progress bar filling up or similar) how much
> is left of the limits - actually I think it is better to always & only say X% used (and leave it to
> the user that 100-X% is remaining). Create separate sections with clear headings for Claude vs
> Codex, each laid out similar (e.g. each with their own X% used, graph, etc). Hide the less important
> stuff in a default-collapsed section (e.g. I have no idea what NIMBUS_QUILL is!?) and/or make them
> smaller and/or provide tooltips.

The item was queued on 2026-09-09 and picked up on 2026-10-06. The first job was to find out how much
of it had already been built, because
[260910c](260910c-usage-limits-page-one-section-per-claude-and-codex-account-subscription.md) rebuilt
this tab the day after it was queued and cites the item by id.

## What had already landed

Checked two ways on 2026-10-06: by reading the code, and by a browser pass over the live tab at
desktop, iPad and phone widths.

| Asked for | State | Where |
|---|---|---|
| *X% used*, and only that | **Landed.** Every current window percentage reads `N% used`, without a complementary percentage remaining. Chart ticks are bare percentages; counts and reset times are other figures. | `windowStat` and `CodexWindowStat` in `UsagePanel.tsx` |
| A progress bar | **Landed**, on current numeric Claude and Codex windows alike. | the same two functions |
| Separate, headed Claude and Codex sections | **Landed.** `Claude subscriptions`, then `Codex subscriptions`, one block per account under each. | `AccountUsageSections.tsx` |
| The cryptic windows collapsed by default | **Landed in the per-account sections.** Claude's codename windows and Codex's model-specific limits are each in a closed `<details>`. The deep fallback card still draws these expanded when suppression is not earned. | `AccountUsageSections.tsx` |
| Tooltips | **Mostly landed.** Claude window cards, current numeric Codex window cards, the `ambient` chip, the identified account line and the scan line had one. Unknown or expired Codex window cards have no tip. This change covers the role chip and model-specific heading — below. | |
| A graph for each of Claude and Codex | **Not built.** Codex observations are already persisted; plotting them needs chart work, not a record-format change — below. | |

## What this plan does

Two labels on the tab had nothing behind them:

- **The role chip** — `orchestrator` or `pool`, on every account heading.
- **A model-specific limit's heading** — `Model-specific limit — GPT-Reserve`, the provider's own
  name, bare.

Each gets an `Explain` tip. The wording comes from what the code and
[260909g](260909g-several-claude-subscriptions-on-the-box-and-a-fleet-that-spreads-across-them.md)
already say those things are. The role tips distinguish Claude's automatic routing from other
launches and scope the one-orchestrator restriction to the registry. The Codex tip describes a
separate reported reading without claiming independent accounting or coverage of exactly one model.
The bucket heading has an explicit accessible name so the tip's hidden prose belongs to the button,
without becoming part of the heading announced during heading navigation.

A small omission from the original ask was also found during review: `usageWindowTip` still said
how much remains above a used percentage. It now describes the percentage as used, without repeating a number that may have expired.

**The simpler option passed over:** do nothing and close the item as already done. Rejected because
"and/or provide tooltips" still had two small gaps, each closed by a tip, and the existing Claude
window tip described the percentage backwards.

**Done looks like:** three tests in `tests/fleet-account-usage-sections.test.tsx`, seen red first, that
read the explanations from their own buttons and check the bucket heading's accessible name;
`npm test` and `npm run typecheck` green; a browser check at three widths.

## What this plan deliberately does not do

- **A graph per provider.** The chart at the bottom of the tab is one chart, of the one account the
  daemon's usage pass observed on each pass, and it plots Claude windows only (several Claude
  account ids can appear after a login swap). `UsageHistoryLine.codex` already stores Codex bucket
  observations, and `usage-history-client.ts` preserves them in the samples: adding a Codex graph
  for that observed login needs a series adapter and renderer, not a persisted-format change.
  Recording **every account** for per-account graphs is the larger
  [260910c § Stage 4](260910c-usage-limits-page-one-section-per-claude-and-codex-account-subscription.md):
  that needs plural persisted records, and
  [usage-per-account.md § Not built](../project/usage-per-account.md#not-built-per-account-history)
  explains why alternating one-account records would not work. Both graph tasks stay outside this
  tooltip change; the per-provider one is a narrower follow-up than Stage 4.
- **Rename "headroom".** The labels `General headroom`, `Cached headroom` and `Headroom` are still on
  the tab. They head cards whose figure is `N% used`, so a label about what is left sits over a number
  about what is spent. The current window percentages follow the requested format. Renaming those
  headings is a separate wording change; this tooltip review does not establish a string or
  assertion count.
- **A tooltip on `Full resets available`.** Nothing in the repo says what a Codex reset credit does
  beyond its name, and a tip would have to invent it.
- **Make the two halves lay out identically.** Claude's two windows sit side by side; Codex's sit
  under a bucket heading, because Codex has buckets and Claude does not. They are close, not the same.

## Found on the way, and not this plan's to fix

On 2026-10-06 every reading on the live tab was **1 day 20 hours old**, the 24-hour chart had nothing
to plot, and the page said nothing had been recorded for 2,667 minutes longer than expected. This
establishes no fresh published readings since about 2026-10-05 01:00 UTC, not that the daemon stopped
running: collection or persistence could also have failed. Diagnose the usage pass
separately before deciding whether it needs restarting.

Because the readings are stale, the deep card under the sections draws Codex a second time. That is
the earned-suppression rule working as designed
([usage-per-account.md § Hiding a reading has to be earned](../project/usage-per-account.md#hiding-a-reading-has-to-be-earned-per-account-and-per-window)),
and suppression is earned only by a fresh section of the same account covering every fallback
window, not freshness alone.

## What landed, 2026-10-06

One stage. The two tips and the corrected Claude window tip, with four assertions seen red first.

**GPT Sol's code review: ship**, after its own fixes. It narrowed both tips to what the code can
show (the first drafts overstated pool routing and said a model-specific limit covers one model,
which nothing here establishes), gave the bucket heading a short accessible name, fixed a fixture
that did not typecheck, corrected three claims in this plan, and found the one part of the wider ask
still wrong on the page: the Claude window tip said *how much of this window remains* above a figure
that says *used*.

**The browser check found what no test could.** Wrapping the model-specific heading in the tip's
`<button>` dropped its uppercase, because a button does not inherit `text-transform`; it drew as
`Model-specific limit — gpt-reserve` beside `GENERAL HEADROOM`. Fixed with the class on the button,
and rechecked at 1440, 820 and 390 wide: the heading matches its sibling, both tips open and sit on
screen, no horizontal scroll, no console errors.

Not verified in a browser: the `Pool account` tip, because the box has no pool account in its live
reading (the unit test covers its text); and on the second pass a tap on the role chip at phone width
showed no tip, where the first pass had opened it by tap on both chips — most likely that script's
own dismissing tap, and not chased.
