# Threshold sliders hide what is below them, and say how many

Greg, 2026-09-03:

> In Glossary / Prioritised mode, we have a threshold slider. Right now, if I set the threshold
> high, it shows the highest-priority first, and then all the rest just below. I think it would be
> clearer if it only showed the stuff above threshold (with an indication below perhaps that "N
> hidden because they're below the X threshold" (or something along those lines).
>
> And there are other modes with thresholds - they should work the same way.

## What the three sliders do today

There are exactly three `<input type="range">` thresholds in `src/web`. Nothing else has one —
Ideas, Timeline, Claims, Criteria, Diagram, Summary and Quiz have no reader-facing bar, and
`A_CHRONOLOGY` in [`src/web/TimelinePanel.tsx`](../../src/web/TimelinePanel.tsx) is a fixed count
that only changes a sentence.

| Mode | Param | Priority | Default | Below the bar today |
|---|---|---|---|---|
| Glossary | `?gate=` | `difficulty × centrality` | `PRIORITY_GATE = 0.30` | second group, *"the rest"* |
| Quotes | `?bar=` | `max(importance, striking)` | `PROMOTE_BAR = 0.80` | second group, *"the rest"* |
| Search | `?conf=` | `confidence` 0–100 | `PRIORITY_CONF = 50` | **hidden**, list and prose marks both |

So Search already does what Greg is asking for, and the job is to make the other two match it. That
is a reversal of a decision that is written down, and it is worth naming rather than quietly
undoing. [`src/web/search-hits.ts`](../../src/web/search-hits.ts) § *prioritised* argues:

> **The glossary groups; this hides.** A prioritised glossary shows every term and puts the ones
> that clear the bar at the top, because a glossary is a reference list and a term you cannot find
> is a term you have lost. A search is the opposite errand …

Greg has looked at the built thing and said grouping is not clearer. That comment gets rewritten to
say what the three modes now share, and *why the reference-list argument did not survive contact*:
the bar is on screen with its number, the foot line says how many it is holding back, and dragging
it left is one gesture. A term is not lost when the control that hid it is the control in your hand.

### The simpler option passed over

**Leave Search alone and only change Glossary and Quotes.** Rejected: Greg asked for all the
threshold modes to work the same way, and Search is currently the only one that does not print
*how many* it has hidden. Bringing it in costs one foot line.

**A collapsible "N hidden — show" disclosure**, so the hidden terms are one click away rather than
one drag. Put to Greg; he selected neither option and noted *"maybe indicate that changing the
threshold will show them?"*, which is the plain-note version with the way back spelled out. Building
the disclosure as well would be a second mechanism for a job the slider already does. Simplest
version first — a plain foot line that names the count, the threshold and the gesture.

## Greg's second decision: the missing scores

Asked whether an entry with no scores should be hidden with the rest or always shown, Greg replied:

> Why don't they have difficulty/centrality scores? Is that a bug? Can we tweak things to make sure
> we always do have those values? In the interim, always show them. Use engineering-manager stages
> to address these.

> — Greg, 2026-09-03

So there are two jobs, and the diagnosis is the first stage rather than a footnote. The interim rule
is **absent is not low** — the rule Search already follows for a null confidence, for the reason
written at `clears()` in [`src/web/search-hits.ts`](../../src/web/search-hits.ts): showing it is the
lossless direction. After this change all three modes hold the same rule, which is the argument for
extracting it once rather than writing it a third time.

## Stages

### Stage 1 — Why are there unscored entries, and can we stop there being any

**Diagnosed 2026-09-03. No unscored entry was found in any data we could inspect**, and the
optionality is defensive rather than a description of anything we hold. Note the hedge and keep it:
**production was not reachable from this box**, so this is *none found in the inspected data*, not
*none exist*, and there is *no known* backfill rather than provably none.

- **Every entry and quote we can measure has both scores.** 69/69 glossary entries and 5/5 quotes in
  the local database; 34/34 entries and 5/5 quotes in the committed artefacts.
- **There is no legacy era.** `difficulty?`/`centrality?` arrived in `bf5a91e3`, the commit that
  created the glossary; `striking` in `e5fefee2`, the commit that created quotes. They have been
  optional since the day they existed and were never once required.
- **There is no column to migrate.** Both artefacts are stored whole as JSONB
  ([`src/db/schema.ts`](../../src/db/schema.ts)), so the database enforces nothing about them and no
  migration could. The only way to fill a missing score is to re-run the stage. **No backfill
  implication, and nothing to back-fill.**
- **The two are optional for different reasons.** The glossary prompt
  ([`src/glossary.ts`](../../src/glossary.ts)) *requires* both, so a missing one means the model
  disobeyed. The quotes prompt ([`src/quotes.ts`](../../src/quotes.ts)) explicitly permits omitting
  them, and `priorityOf`'s `max` over whichever arrived was designed around that: a quote scored on
  one axis can be under-promoted and never over-promoted, which is the direction an honest default
  has to fail in.
- **Partial scores are real and tested.** `score()` runs per field, so `difficulty` can survive while
  `centrality` is rejected; there is a third route through dedupe, which does
  `winner.difficulty ?? loser.difficulty` and can combine two half-scored duplicates into one entry
  whose numbers came from different judgments.

**So the answer to Greg's question is not one answer but two**, and flattening them to *"it is not a
bug"* would lose the half that matters: a **missing quote score is by design**, and a **missing
glossary score is the model disobeying a prompt that requires it** — undetected rather than
intended. **And there is a real hole next to both.**
A score that fails `score()` is dropped silently: `QuoteDrops` has six counters and none of them is
for a rejected score, and the glossary has no drop accounting at all. If the model started returning
`"high"` instead of `0.8`, the panel would quietly stop offering *prioritised* order and nothing
anywhere would say so — [silent-success.md](../reusable/silent-success.md) exactly.

**So this stage is: count the missing scores.** It is the change that would tell us whether the
bigger fixes are ever needed, which is why it comes instead of them rather than alongside. Two
details, both from Sol's review of this stage:

- **Omitted and invalid must be counted separately.** A counter that only fires inside `score()`
  would never see a field the model simply left out — which is precisely the contract violation Greg
  asked about, since the glossary prompt requires both. So: one count for *absent*, one for *present
  but rejected*.
- **Where they go:** onto the existing `QuoteDrops` for quotes and a matching new shape for the
  glossary, logged at the end of the stage through [`src/log.ts`](../../src/log.ts) and **not shown
  to the reader**. A reader cannot act on it and it is not about their article; it is about whether
  the model is still obeying us. That makes this bigger than the fifteen lines first estimated.

**Deliberately not doing**, and each one is written down here so it is a decision rather than an
omission:

- *Making the four fields required in [`src/types.ts`](../../src/types.ts).* Large, touches every
  read site, and buys a compile-time guarantee the model can still violate at runtime.
- *Dropping glossary entries that lack a score.* Trades a scored list for a shorter one, against the
  stage's own salvage principle — thirty good entries must not be lost because one came back with
  `centrality: "high"`.
- *Changing the quotes prompt to require both scores.* One line plus a `PROMPT_VERSION` bump, but it
  overrides a documented choice in [quotes.md](../project/quotes.md) § *Two scores, combined with
  `max`* for no observed benefit. **A product call — flagged to Greg, not taken here.**

**One doc bug to fix in stage 3:** [glossary.md](../project/glossary.md) says *"Old glossaries with
no scores see no change whatsoever"*, describing a population the git history says never existed.

**Done looks like:** the counters landed with a test that was red first, `npm test` green.

### Stage 2 — Hide below the bar in Glossary and Quotes

The behaviour change. GPT Sol reviewed this stage before it was built and found three blockers; what
follows is the plan after them, and § *What Sol caught* below says what changed and why.

**One shared rule, returning one outcome.** `priorityOf` / `countAbove` / `keepAbove` / *survives the
bar* exist three times today ([`GlossaryPanel.tsx`](../../src/web/GlossaryPanel.tsx),
[`QuotesPanel.tsx`](../../src/web/QuotesPanel.tsx),
[`search-hits.ts`](../../src/web/search-hits.ts)). After this change all three implement the *same*
rule — hide below the bar, absent survives — so it goes in one small module,
`src/web/threshold.ts`, and each caller passes its own score accessor:

```ts
export interface ThresholdResult<T> {
  visible: T[];
  hiddenCount: number;
  unscoredCount: number;
}
export function survivesThreshold(score: number | null | undefined, threshold: number): boolean;
export function applyThreshold<T>(
  items: readonly T[],
  threshold: number,
  scoreOf: (item: T) => number | null | undefined,
): ThresholdResult<T>;
```

`survivesThreshold` is `score == null || score >= threshold`. **It returns the outcome rather than
offering a family of counting helpers**, which is the whole point: the visible list, the `N of M`
count, the hidden count, the empty branch and the foot line must all come from one pass, or they
drift apart — and a count that disagrees with the list under it is this feature's worst failure.

What stays local: the track (data-derived max, index-into-stops, fixed 0–100), the unit, and the
copy. Those genuinely differ and unifying them would be the over-abstraction.

**Prioritised becomes one unheaded list.** `groupEntries` / `groupQuotes` stop returning two groups.
*"worth knowing first"* over a list that is entirely what survived the bar is a heading with no
contrast to draw, and `splitsOnPriority` — *does the bar divide this list* — stops being a question
anything asks. Both go, with `gateNote` / `barNote`.

**One foot line, wherever the threshold control is:**

```
18 terms are hidden by this threshold. Drag the slider left to show them.
Nothing is hidden by this threshold.
All 18 terms are hidden by this threshold. Drag the slider left to show them.
```

Present whenever the slider is — *including* the filtered-empty branch — and absent wherever the
slider is absent: an empty artefact, a list too short to prioritise, an all-unscored fallback, words
Search, a search that genuinely found nothing. A line that is sometimes absent for a *different*
reason teaches the reader nothing. Singular nouns handled.

**Not "clears".** An unscored item survives without clearing anything, so the verb would be a small
lie in exactly the place this feature has to be honest. Not "the rest" either — that group is gone.
Same treatment for the slider's own `aria-valuetext`, which says *promoting N* today and must say
*showing N*: unscored items are shown without being promoted.

**These strings do not go in [`src/messages.ts`](../../src/messages.ts)** — an earlier draft of this
plan said they did. [copy.md](../project/copy.md) defines that module around model-call failures and
their four `kind`s, and a threshold note is not a failure. They stay beside the panels, where
`gateNote` and `confNote` already live.

**Unscored survivors say so, quietly.** A row with no `ScoreBars` in an unheaded prioritised list
otherwise reads as though it cleared the threshold. A `title` on the row — *"Not scored for
prioritising — shown regardless of the threshold"* — and nothing visible, because the diagnosis in
stage 1 says this case does not arise in any data we hold, and a visible badge would be furniture
for a state nobody has. It reveals no composite score, so the rule that only raw model scores are
shown still holds.

**`canPrioritise` and `barStops` are recomputed from what is visible, not from the old split**, and
this is the finding that would have cost a stage. The rules change under the new semantics:

- Quote priorities `[0.20, 0.62, unscored]` give stops `[0, 0.20, 0.62]`, but under *absent
  survives* both `0` and `0.20` show all three — the first slider step becomes a no-op, against the
  existing comment's claim that every stop changes the division.
- `[0.90, unscored]` currently makes `canPrioritise` true, because the unscored quote formed *"the
  rest"*. Once it always survives, **no reachable bar position hides anything**, and the mode would
  offer an order that visibly does nothing — the exact thing `effectiveSort`'s rule exists to stop.
  Glossary has the same case with one scored term plus an unscored one.

So the new rule is **at least two distinct scored priorities**: with one, every position of the bar
either shows everything or shows everything, and there is nothing to offer. A test must assert that
every *adjacent* pair of Quotes stops produces a different visible set — today's test only asserts
that *some* stop splits, which does not prove what the comment claims.

**A hidden item cannot stay selected**, the rule Search already holds at
[`App.tsx`](../../src/web/App.tsx) (*"'open' is a thing the reader can see, and a hidden one is a
claim about the page that the page is not making"*). Glossary and Quotes resolve `?term=` / `?quote=`
against the whole artefact, independently of what is rendered, so without this a raised bar removes
the row while the term stays emphasised in the prose and the quote stays marked in prose and rail —
and lowering the bar later silently reopens a selection the reader watched disappear. Two
distinctions to keep straight:

- **Only the selected emphasis is cleared.** The passive dotted underline under every glossary term
  is drawn from the full glossary in every mode and is not the selection. It stays.
- **"In the glossary" from a prose hover card is a deliberate request to reveal a term**, and it
  currently writes `?term=` without touching `?gate=` ([`App.tsx`](../../src/web/App.tsx)), so
  pressing it on a below-bar term would open the band on nothing. It must lower the gate to that
  term's own priority first. Lowering rather than dropping to `document` order keeps the reader in
  the order they chose, and the slider moves visibly, so nothing is done behind their back.

**What must survive the change**, both hard-won and both easy to break here:

- `effectiveSort` / `effectiveRank` must keep *not* falling back out of prioritised merely because
  the current bar hides nothing. Falling back takes the slider off screen mid-drag and strands the
  reader. That is a different question from `canPrioritise` above, which is about the whole list.
- The all-hidden case keeps the sort bar **and the slider** on screen, because they are the only way
  back. `SearchPanel.tsx`'s `srch-empty` branch is the precedent. Note that Quotes cannot reach
  all-hidden by dragging — its top stop is a real quote's score, which therefore always survives — so
  the browser pass must not expect an empty list at the top of every mode.
- Search applies its threshold in exactly one place, `App.tsx`, so the rows in the list and the marks
  in the prose can never be a different set. `keepAbove` becomes a thin wrapper over `applyThreshold`
  and **no second filter may appear in `SearchPanel`**.

**A copy sweep, not just a docs pass.** *"top group"*, *"promoting"*, *"divider"* and *"the rest"*
survive in tooltips, ARIA text, rank-button titles, comments and CSS class names as well as in the
project docs. Grep for each.

**Done looks like:** `npm test` and `npm run typecheck` green, tests for the new rule written red
first, `npm run check` clean.

#### What Sol caught

Three blockers, all accepted, all verified here before acting rather than taken on trust:

1. **Hidden selections would have stayed live in the prose** — verified: `openTermInGlossary` at
   [`App.tsx`](../../src/web/App.tsx) sets `?term=` and the mode and touches nothing else.
2. **`countAbove` contradicts *absent survives*** — verified by inspection: both panels' counters
   skip an entry whose `priorityOf` is `undefined`, so a list could render two unscored rows over the
   words `0 of 10` and *"No term clears this bar"*.
3. **`barStops` / `canPrioritise` change meaning**, worked through above.

Rejected nothing. The one thing taken further than Sol suggested: it proposed a *restrained label or
tooltip* for unscored survivors, and this plan takes the tooltip only, on stage 1's evidence that the
case does not occur in real data.

### Stage 3 — See it, and write it down

Browser testing in a Sonnet subagent against a real article in all three modes: drag each bar to the
floor, to the top, and to somewhere in the middle, and check the foot line, the counts, the empty
state and the way back. Screenshots at 1280 and 390.

Docs in the same stage: [glossary.md](../project/glossary.md) (the ASCII panel still draws two
groups, and § *The threshold, and whose it is* still describes grouping),
[quotes.md](../project/quotes.md), [search.md](../project/search.md), and the *"the glossary groups;
this hides"* comment in `search-hits.ts`.

**One doc bug found on the way in, fold it in here:** [url-state.md](../project/url-state.md) line
43 says an absent `?bar=` reads as `0.70`. It is `PROMOTE_BAR = 0.80`
([`QuotesPanel.tsx`](../../src/web/QuotesPanel.tsx)), which `quotes.md` gets right.

**Done looks like:** screenshots seen, docs true, GPT Sol's review of the code answered, committed
and pushed to `dev`.

## Log

- **2026-09-03** — plan written; plan out to GPT Sol.
- **2026-09-03** — stage 1 diagnosis landed and is written up above. Not a bug; no unscored entries
  exist in any data we can measure; no backfill possible or needed. The stage shrinks to a counter
  for silently-rejected scores. One consequence for stage 2 worth noting: Greg's *"in the interim,
  always show them"* rule is close to a no-op on real data, so it costs nothing to hold and there is
  no risk of it producing a list of unscored terms with the scored ones hidden behind the bar.
