# Timeline — when the piece *says* these things happened

The eleventh mode in the band between the spine and the prose, beside
[ideas.md](ideas.md). Greg asked for it on 2026-08-31:

> Create a "Timeline" mode (which can deal with ambiguity about dates, resorting to ordering, and
> indicating the uncertainty)

**The clause after the bracket is the whole feature.** A mode that only handled clean dates would be
a `<dl>`. Everything below is about what to do when the piece does not give you one.

The design, the reasoning, the review that stopped the first version and the two spike runs that
measured the second are in [260831i-timeline-mode.md](../plans/260831i-timeline-mode.md). This file is what is
built, and where it lives.

## It is not "when did this happen"

The honest framing, and it is GPT Sol's rather than the plan's first one: not *when did all this
happen*, but ***when does the piece say these things happened***. Every row is the article's claim
about time, kept at the strength the article made it — which is what makes this an
evidence-navigation tool rather than the article's plot with the prose removed.

That distinction is not decoration. [vision.md § Anti-goals](vision.md#anti-goals) rules out handing
the reader a summary they can substitute for reading, and **a timeline is the most summary-shaped
thing here yet**. Three things answer it, and all three are built in rather than asserted:

1. **A row is a pointer, not a retelling.** A date and a handle of under ten words. If a reader can
   follow the story from the panel alone, the labels are too long.
2. **Chronological order is not the article's order**, and that is the point — the panel shows the
   sequence straightened out, which is a different artefact from the piece the way a map is
   different from a walk.
3. **The uncertainty is the content.** The thing this panel says that no summary says is *we do not
   actually know when this happened, and here is how sure the article is*.

## Nothing is dated unless the article dates it

The rule the mode lives or dies by, and **it is structural rather than checked**.

The model is never asked for a date. It is asked for the article's own temporal words, and a
deterministic parser in [`src/timeline-time.ts`](../../src/timeline-time.ts) reads a date out of the
**block's own characters**. There is nothing to validate because there is nothing to distrust.

The first design did ask for a date, plus the words it came from, and checked the words were in the
block. That check failed in both directions — it rejected a correct date because of an editorial
`[F]rom` bracket, and it accepted a wrong one because `findQuote` is substring matching and `July 1`
is found inside `July 11`. Four of the test article's blocks hold two dates each.

**And the claim has to be re-proved for every field that reaches the reader.** It was true of `when`
and false of the artefact: `phrase` was the model's string and `label` was unread prose, so a
fabricated *"the summer of twenty nineteen"* or *"4 July: the package manager crashes"* would have
been displayed verbatim. Both are now sliced out of the block and run through the parser.
[260831i-timeline-mode.md § The claim was true of `when`](../plans/260831i-timeline-mode.md#the-claim-was-true-of-when-and-false-of-the-artefact).

## The four dating states, which are the whole panel

`dating` is a discriminated union, not `when: When | null` plus flags, so the impossible states
cannot be spelled. **Four members, four different rows**, and this is not defensive completeness:
ten of the twenty-six rows on the test article carry no date at all.

| `dating.kind` | the date column says |
|---|---|
| `dated` | the interval in words — `26 May`, `at or before 12 May`, `13 Jul – 19 Jul` |
| `words` | **the article's own phrase, quoted** — *"another month later"*. We compute nothing |
| `untimed` | `—`, plus a spoken sentence, because an em dash is silence to a screen reader |
| `rejected` | a short label that differs by `reason` |

**`words` and `untimed` are the pair most easily collapsed, and collapsing them is the one mistake
that throws away something the article said.** A piece that wrote "another month later" has dated
the event as far as it ever will; a blank there claims it said nothing.

**`rejected` is the third outcome**, and the review's point holds: a rejected date must not render
identically to a genuine absence, or "fails visibly" is only true inside a counter. Its `reason`
matters — `noYearFrame` means *the piece gave a day and a month and we had no publication date to
take the year from*, which is a fact about us, where `phraseNotInOccurrence` is a fact about the
extraction. The three sentences are in [`src/messages.ts`](../../src/messages.ts) §
`DATE_REJECTED_SHORT` / `DATE_REJECTED_WHY`.

**It cannot occur on an article that has a publication date**, and it is the *only* dated state on a
frameless one — which is every article ingested before 2026-08-31, since the date only arrives on
re-extraction. So it is simultaneously the hardest state to see and the commonest one on the shelf,
and `src/web/preview-timeline.tsx` fabricates it deliberately.

## The order is the model's reading, and the dates move nothing

Greg, 2026-08-31: *"don't sort by date at all — use the model's reading."*

`sort by (modality partition, order)`, and that is the whole function. An event known only to be "by
4 July" may have happened on the 1st, and sorting it to the 4th would assert otherwise; the proper
fix is a topological sort over a partial order, and the cheap fix is not to sort by date.

The dates are still compared, as a **counter rather than a sort key**: where two events' intervals
*prove* an order and the model put them the other way round, `orderConflicts` goes up. It changes
nothing on screen and is the only signal that the model has misread the chronology. The test article
recounts the same three months three times, once per civilisation, so a high count there may be the
mode working — and on a plainly linear article it is the mode failing. Zero on both real runs.

## v1 writes the words, and that is the accessible version

Greg deferred the drawn notation — *"it's fine to defer the fancy UI stuff till later"* — so there
are **no marks, no legend and no glyphs**. The date column says `at or before 12 May`.

Which is not merely the cheap version. The deferred notation needed every glyph `aria-hidden`, a
complete spoken sentence per row, and the marks drawn as SVG rather than Unicode so they did not
depend on the reader's installed fonts. Plain words need none of that, because they already *are*
the sentence. The marks, a time-to-scale axis, painting the spine and following the reader down the
page are all kept in
[260831i-timeline-mode.md § Appendix](../plans/260831i-timeline-mode.md#appendix-the-visual-design-deferred).

Two smaller decisions in the panel worth knowing before changing them:

- **The year is said once above the list, not on every row** — on the test article seventeen of
  eighteen dates carry a year we supplied, so a per-row note would be a wall and the column would
  spend its width repeating "2026". A list that spans more than one year puts the year back on every
  row, because there it is the content.
- **Below three events the panel withdraws the claim** and says the piece is not really telling a
  story in time. The rows still show. Two dates presented *as a timeline* is the panel overclaiming,
  and the reader cannot tell from the rows alone. `A_CHRONOLOGY` in
  [`src/web/TimelinePanel.tsx`](../../src/web/TimelinePanel.tsx).

## Most articles have nothing to say here

This is the mode that will most often come back empty, and it must say so plainly rather than pad. A
piece with no chronology gets one sentence and **no retry button** — running it again would find the
same nothing and cost another model call. The button stays in the bar on every article, because a
reader finding out that a piece has no chronology is a real answer.

## Freshness, and the one fingerprint that is not shared

The stamp is blocks **and** tree **and the publication date** — `datedArticleFingerprint` in
[`src/source-hash.ts`](../../src/source-hash.ts), not the `articleFingerprint` every other stage
uses. Nineteen of the test article's twenty-four temporal expressions are year-less, so the
publication date is the reference frame for almost every row: a publisher re-dating a post changes
this artefact and not one word of any other.

**Widening the shared `MetaFingerprint` instead would have been expensive and silent.** It feeds
`arc`, `tweets`, `glossary`, `summary` and `quotes` directly and two more through
`MetaFingerprintWithUrl`, and the date arrives *by re-extraction* — so the first article
re-extracted would mark five paid artefacts stale over bytes no model ever saw. Not one of their
prompts prints a publication date.

The reader profile is deliberately **not** in the stamp. Who is reading changes what an *idea* is;
it does not change when something happened.

## Where the code is

| | |
|---|---|
| [`src/timeline-time.ts`](../../src/timeline-time.ts) | the parser and the interval arithmetic. No model call, no I/O. **No `Date` objects anywhere** — ISO strings end to end, or a timezone moves a calendar day |
| [`src/timeline.ts`](../../src/timeline.ts) | the stage: the prompt, the call, the validation, the counters |
| [`src/web/TimelinePanel.tsx`](../../src/web/TimelinePanel.tsx) | the panel, and the pure functions that turn an interval into words |
| [`src/web/useTimeline.ts`](../../src/web/useTimeline.ts) | the read, the staleness, and the one verb |
| `TimelineBand` in [`src/web/App.tsx`](../../src/web/App.tsx) | `?event=`, and the resolved passages it pushes up to the prose |
| `STEPS.timeline` in [`src/pipeline.ts`](../../src/pipeline.ts) | the stage as the pipeline runs it — its `stamp`, and the counters it logs |
| `loadTimeline` in [`src/api.ts`](../../src/api.ts) and [`src/store/pg.ts`](../../src/store/pg.ts) | `GET /api/timeline/:slug`, once per store |

Ids are inherited on **the cited block set plus the date**, never on the label. That is measured
rather than argued: a regeneration kept 26 of 27 ids and only 7 of 26 labels, so label-keyed
inheritance would have orphaned nineteen `?event=` links in one re-run.

## The artefact lives in the database

Greg, 2026-08-31, against the recommendation at the time — which was to skip the store plumbing for
v1 on the grounds that no pipeline artefact survived a round trip yet:

> We definitely want the data for this to live in the database rather than files.

It is the right call for anything meant to last, and it is the reason there is nothing here to do
twice. `article_revisions.timeline` is one `jsonb` column beside `ideas`, `quotes` and `sketch`,
holding the **whole** artefact so that `sourceHash` travels with the events it judges.

Two things about it are worth knowing before touching them.

**`article_revisions.published_at` is `text`, not `timestamp`.** It is stage 2's column and it is
here because of this mode: without it `Meta.publishedAt` cannot survive a round trip, and the
timeline reads every year-less date against nothing. Postgres normalises a `timestamp with time
zone` to UTC, and 8pm on 31 December in New York comes back as 1 January — the calendar day is the
entire content of the field, so the publisher's own string is stored verbatim and never re-parsed.

**The `revision_step_runs_step` CHECK is hand-written.** `drizzle-kit generate` diffs
[`src/db/schema.ts`](../../src/db/schema.ts) and knows nothing about a check expression, so it has
left the new step out three times — `'summary'`, `'assets'`, `'sketch'` — and the failure is a job
dying with a `23514` a long way from the cause. `tests/db-step-constraint.test.ts` reads the
migrations statically and goes red the moment a step joins `STEP_ORDER`, which is what makes there
not be a fourth. `drizzle/0035_timeline.sql` is the shape to copy.

**Writing a migration is free; applying one is Greg's call, locally as well as remotely** —
[AGENTS.md](../../AGENTS.md).

## It starts itself when you press the mode

Since 2026-09-02, pressing **Timeline** in the bottom bar on an article that has never had one starts
the job — no second button. Only a *press* does: a pasted `?mode=timeline` link, a Back step and a
link in from the metadata page all show the empty state and its button, and spend nothing. A press is
recorded as data by the bar itself ([`src/web/activation.ts`](../../src/web/activation.ts)), because
a mount is not a click.

The loop that made Greg choose a button in the first place —
[glossary.md § That decision was reversed](glossary.md#that-decision-was-reversed-on-2026-09-02-and-the-loop-is-still-closed-structurally)
— is closed structurally: one automatic attempt per `(slug, step)` per tab session, claimed before
the request goes out. Hence the two verbs on the hook: `ensure` is unforced and is what **both** the
automatic run and the empty state's button call, because `work_key` is computed from the request and
two keys are two paid jobs; `regenerate` is forced and is *Read it again*, offered beside a timeline
that is already there. [`src/web/useAutoRun.ts`](../../src/web/useAutoRun.ts).

The reader profile is not in this stage's stamp at all (§ Freshness), so this is the one of the five
with no profile tickbox to replace and nothing extra to say about an automatic run.

## A shared link carries it, since 2026-09-04

[`src/web/visitor.ts`](../../src/web/visitor.ts) gives `timeline` an **`artefact`** policy, so a
visitor of a public article reads the timeline the owner built, and is told *nobody has built one*
when there is none. It was `owners-only` until then — stated deliberately rather than left to the
fail-closed fall-through it had until 2026-09-02, so that *private because somebody decided* stayed
distinguishable from *private because somebody forgot*. Greg, 2026-08-31:

> it would be nice to have the option for this to be Public-readable, but that could be a follow-up.
> Ideally we'd come up with a general, reusable/applicable design for new features such that it's
> fairly easy for them all to be made Public-readable.

**This is that follow-up, and it did not need the general design.** What made timeline different was
not the cost — reading `article_revisions.timeline` never cost anything, and only *generating* one
spends — but that the payload carried no flag, so a visitor could only be told *this belongs to
whoever added the article*, never which of the two it was. Adding the flag is the same nine-step
path the glossary, the ideas and the quotes already take, and
[260904c](../plans/260904c-more-modes-on-a-shared-link.md) walks it.

The question that section used to end on still stands and is still worth asking — **"why is a mode's
public face not derived from one declaration?"** — but it is now a tidying job rather than a blocker,
because the five places are five *compile errors*: `PublicArtefacts`, `shareableArtefacts` and
`POLICY` are total records, so a mode added next month stops the build until somebody decides.

**A signed-out reader still gets no button for it**, and that is the experimental switch rather than
this policy: Timeline is behind experimental features and a signed-out reader is `experimental:
false` by decision. They reach it by a shared `?mode=timeline` URL and from the visitor's metadata
page, which lists it. Greg accepted that on 2026-09-04 rather than inherit it.
[experimental-features.md](experimental-features.md).

## See also

- [260831i-timeline-mode.md](../plans/260831i-timeline-mode.md) — the plan: the review that stopped the first
  design, the two spike runs, and everything deferred.
- [ideas.md](ideas.md) — the sibling this is modelled on, and the source of the validate-every-id
  discipline.
- [block-ids.md](block-ids.md) — the contract every occurrence here rests on.
- [silent-success.md](../reusable/silent-success.md) — the failure this mode is most exposed to: a
  run that produces confident dates and reports nothing wrong.
