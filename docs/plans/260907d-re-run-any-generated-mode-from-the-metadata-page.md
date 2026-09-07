# Re-run any generated mode, from the Metadata page

**Status as of 2026-09-07: planned, not built.** Evidence: `SOON` in
[`src/web/Metadata.tsx`](../../src/web/Metadata.tsx) still carries the dimmed `rerun` row, and
nothing in `src/web/` posts `{ slug, steps: [step], force: [step] }` from that page.

## The goal, and the sentence it comes from

Greg, 2026-09-06, asked whether to backfill the library after a prompt change. He declined the
backfill and asked for this instead:

> Leave it, new articles only. Although i think there should be a way to re-run any of the generated
> modes (either within the UI for the mode, or perhaps in the Metadata section) - I realise this is a
> new piece of work, but it's important, so perhaps fan this out as its own thing

So: **a way to ask for a mode to be generated again**, on an article that already has one.

## The product simplification that is the whole point of this plan

The Metadata page has carried this as a dimmed *"Not built yet"* row since 2026-09-03 — `SOON`, key
`rerun`, [`src/web/Metadata.tsx:301`](../../src/web/Metadata.tsx). Its own note says why it was
never built:

> The queue already accepts the request. What is missing is the sentence above it — nothing here can
> honestly tell you a stage is stale until the artefacts record what they were built from.

That is a true account of a **different** feature: the blocker was always *staleness detection*, and
what Greg asked for is a way to **re-run** — in the same breath as declining the library backfill
that staleness detection would have served. A button that says *regenerate this* and makes **no
claim** about whether you need to is honest, useful, and needs no artefact provenance at all.

**So this plan builds the re-run and does not build staleness detection.** See § Deferred: the
staleness half, which keeps the reasoning rather than deleting it.

### That `learned` sentence is out of date, and the plan turns on knowing it

It was written on 2026-09-03 and the store has moved under it. **`StageState.done` already means
*present and current*, not *present*** — `src/types.ts:1988`:

> `StageState.done` means *ran, and would not be re-run today*; this means *the column is not null*.
> They disagree exactly when an artefact is stale.

`articleMetadata` ([`src/store/pg.ts:2522`](../../src/store/pg.ts)) reads `revision_step_runs` and
then applies a **per-step `isCurrent`** — `hierarchyCurrency` for `hierarchy` (the same function
`reasonsNotToPublish` uses, joined 2026-09-07), a stamp comparison for `labels`, and the artefact's
own `sourceHash` for `tweets`, `glossary` and `arc`. Carry-forward is explicitly handled: a draft
copies the previous revision's glossary **and its step-run row**, and without the `isCurrent` check
*"the reader was shown a green tick over a glossary describing text that has since changed"*
(`src/store/pg.ts:2474`).

Two consequences, and both are decisions rather than trivia:

- **The plan does not need to build anything to know whether a stage is current.** It already has
  one boolean per stage, computed by the same code the publication gate uses.
- **The page renders that boolean as a two-state pill, `ran` / `not run`**
  ([`src/web/Metadata.tsx:2260`](../../src/web/Metadata.tsx)) — which means a *stale* glossary
  currently reads as **"not run"** on a page whose reader can see the glossary in the panel next
  door. That is a pre-existing honesty gap, it is **not** created by this feature, and fixing it
  needs a new field on `StageState` (the boolean cannot tell *absent* from *stale*). **Named and
  deferred** — see § Deferred. What this plan does about it is choose the button's own wording off
  `done` so the two never contradict each other: *Run it again* where the row says `ran`, *Run it*
  where it says `not run`.

## The list of steps that get a button, and why each is in or out

`isStepName` ([`src/pipeline.ts:3964`](../../src/pipeline.ts)) accepts any of the sixteen names in
`STEP_ORDER` ([`src/step-order.ts:44`](../../src/step-order.ts)), so the API is not the constraint.
The constraint is which buttons can be pressed without surprising the reader.

**The offered set is `FORCE_ONLY_WHEN_NAMED`** ([`src/pipeline.ts:394`](../../src/pipeline.ts)) —
`arc`, `tweets`, `glossary`, `quotes`, `ideas`, `timeline`, `quiz`, `sketch`, `illustrated`,
`debate` — **plus `hierarchy`**, which is its own case below.

That is not a coincidence to be re-derived here, and it is a stronger rule than "everything after
`arc`" even though today the two sets are identical. Membership of that set means exactly the two
properties this feature needs:

1. **The step can tell for itself whether it is current** — it has a `stamp`, so an *unforced* run
   is a no-op rather than a lie, and a *forced* run is the only way to spend money on it. That is
   the condition `cascadeForce`'s own docstring states for taking a step out of the cascade
   ([`src/jobs.ts:748`](../../src/jobs.ts)).
2. **Forcing it forces nothing else.** `cascadeForce` sweeps in everything downstream *except*
   members of this set, and it only names steps already in the job — so
   `{ steps: [step], force: [step] }` forces exactly one step. One press, one model call, no
   cascade. `src/web/useStepJob.ts` § `force` already relies on this and says so.

Deriving the list from the exported constant rather than writing a second list beside it also means
a step added to that set gets a button on the next compile, which is the outcome we want: a new mode
is a thing somebody asks for, and a thing somebody asks for is a thing they may want again.

### `hierarchy` — in, deliberately, with its own sentence

Not in `FORCE_ONLY_WHEN_NAMED`, and included anyway. On 2026-09-05 an article whose stored tree had
one particular shape could not publish **anything at all** — no glossary, no quotes, no mode — and
every attempt completed and paid for its model call before being refused.
[The postmortem](../postmortems/260905f-a-tightened-tree-rule-wedged-every-article-that-already-broke-it.md)
§ *The workaround, which needed no deploy*:

> **Re-run the `hierarchy` step on the affected article.** … This was true throughout the incident
> and nobody knew it, because the refusal text never reached the reader or Sentry.

**This feature is that workaround, made findable.** Leaving it out would be leaving out the one row
with a production incident behind it.

What forcing it actually does, said in the confirm copy rather than discovered: `cascadeForce` only
names steps in the job, so `{ steps: ["hierarchy"], force: ["hierarchy"] }` re-cuts the tree and
runs nothing else. The paragraph labels' `structureHash` and the stamps on `arc`, `glossary` and the
rest then no longer match, so those re-run *the next time anything asks for them* — no charge now,
and nothing stranded. That is the documented behaviour
([ingest-queue.md § A step can now say whether its artefact is current](../project/ingest-queue.md#a-step-can-now-say-whether-its-artefact-is-current-not-just-present)),
not something this feature invents.

### The five that are out, each for a different reason

- **`blocks` — out, because a lone button could only fail.** `unrunnableStepPlan`
  ([`src/jobs.ts:813`](../../src/jobs.ts)) refuses `{ steps: ["blocks"] }` with a 400: the tree is
  checked against the blocks it was built from, so an article that ran `blocks` alone cannot publish
  anything. A control whose only outcome is a refusal is worse than no control, because pressing it
  is how you find out — the rule this page already states twice for the pencil and for Archive
  (`Metadata.tsx` § `hasShelfRow`).
- **`fetch` and `extract` — out, because this door already exists elsewhere and means something
  bigger.** *Refresh from source* on the shelf row
  ([`src/web/ShelfEntry.tsx:568`](../../src/web/ShelfEntry.tsx)) posts
  `{ slug, force: ["fetch"] }` already. Re-fetching replaces the reader's article **text**, which is
  a different action from regenerating a mode on top of it, and a second door to it on a page whose
  other rows are all about regeneration would read as the same kind of thing. Named as out of scope
  rather than forgotten.
- **`labels` — out of the first version.** It costs a model call and it is a real thing to want
  again, but it is not a mode a reader goes to; it is the paragraph labels in the spine. It is
  deliberately not in `FORCE_ONLY_WHEN_NAMED` because re-cutting the tree *should* invalidate it
  (`src/pipeline.ts` § the `labels` note), so a forced `hierarchy` already does the useful thing.
  Revisit if anyone asks.
- **`assets` — out.** No model call, and the row nobody has ever wanted again. Costs nothing to add
  later if a hot-linked image ever needs re-hosting.

**The simpler option passed over:** a button on *every* row, one rule and no list. Rejected on
`blocks` alone — that button can only 400 — and on `fetch`/`extract` meaning something the rest of
the rows do not.

## Where the control goes

Greg offered two homes and chose neither: *"either within the UI for the mode, or perhaps in the
Metadata section"*.

**The Metadata page, and only the Metadata page.** The rows are already there — one per stage, with
when it last wrote — the dimmed placeholder is already there, and it is **one place rather than
eleven**. The reading view's band is a space whose whole design is about not accumulating
affordances ([reading-view-overview.md](../project/reading-view-overview.md),
[new-mode.md](../project/new-mode.md)); adding a control to each of eleven panels is eleven new
affordances bought for one feature.

**And the in-mode half is already built for six of the eleven, which is the second half of the
argument.** A forced re-run beside a *current* artefact is already offered by Ideas
(`IdeasPanel.tsx:317`), Quotes (`QuotesPanel.tsx:1019`), Timeline (`TimelinePanel.tsx:529`), Debate
(`DebatePanel.tsx:804`), Quiz (`QuizPanel.tsx:503`) and the thread (`Tweets.tsx` § `Rewrite`).
Glossary has *Find more*, which appends.

So what the Metadata page adds is **the four rows with no door at all**:

| row | why it has no in-mode control today |
|---|---|
| `sketch` | refused on cost, in a comment — see § `sketch` and `illustrated` below |
| `illustrated` | no regenerate path; `Empty` is the only thing that renders a run button |
| `arc` | automatic and unforced only; `useArc` does not even return `outdated` |
| `hierarchy` | no reader-facing control anywhere, and the 2026-09-05 workaround |

`useSketch.regenerate` and `useIllustrated.regenerate` **exist, are documented, and have no caller
anywhere in `src/web/`**. That is worth knowing rather than acting on: this plan does not wire them
up, because the Metadata row is the door we were asked for and a second one in the picture's way is
the thing `SketchView` argued against.

**Judgment recorded for the in-mode half: no new in-mode controls in this plan.** Six modes already
have one; the other five get the Metadata row. If Greg wants a per-mode control later, two of the
five already have the verb sitting unused.

## What it costs, and what the reader is told before pressing

**A re-run costs the reader nothing in slots, and costs us a model call.** The two are separate
ledgers and the distinction is already documented:

- `POST /api/jobs` takes a slot **only for a request carrying a `url`**
  ([`src/routes.ts:8282`](../../src/routes.ts)): *"A URL is a new ingest and spends a slot; a bare
  slug is a re-run and is free."* Our request is `{ slug, steps, force }`, so it never reaches
  `withIngestSlot` and never touches quota.
- [billing.md](../project/billing.md): *"A slot is **one successful new ingest** … Re-running a
  pipeline step on an article you already have is free."*
- The model spend goes on `ai_calls`, a separate ledger.

So there is no quota refusal to render, and **the only cost is ours** — which is exactly why the
button needs more care than a free one would.

**Greg declined a per-reader spend cap on 2026-09-06**
([ai-gateway.md § What stops a reader spending our money](../project/ai-gateway.md#what-stops-a-reader-spending-our-money-and-what-does-not)):

> We already have a global monthly spend cap at the OpenRouter level, so we don't need to build one
> for now.

and that cap is **global**, so the failure mode a runaway converts into is *every reader loses every
paid feature until the month turns*. Nothing rate-limits job creation
(`src/routes.ts` § `POST /api/jobs`; the only gate is worker concurrency, and extra jobs queue
rather than being refused). **A one-click repeatable paid button on a page of eleven of them is
therefore the wrong shape**, and the app already has the right one.

### Two clicks, not one — the `Tweets.tsx` pattern, reused

[`src/web/Tweets.tsx:678`](../../src/web/Tweets.tsx) § `Rewrite` solved exactly this problem and
recorded the reasoning:

> The plan left it out for a stated reason … *"it is a model call one click away, and nothing else in
> the app spends money that easily"* … So: two clicks, not one … The confirm step is the whole answer
> to the objection — it is not a dialog, it does not block anything, and it says what the click costs
> before you have spent it.

We reuse the **pattern** — an inline confirm row, a `busy` state that survives the round trip, no
dialog and nothing blocked — not a copy of the component: `Rewrite` is welded to the thread page's
layout.

**Confirm on every row, including rows the pill says have not run.** The uniform rule is one code
path, and the friction is negligible on a page whose stage rows are already behind a shut heading.
The alternative — one click when `done` is false — would put the branch in the one place a mistake
costs money.

### What the button and the confirm actually say

The confirm sentence has one job the thread's does not: `Rewrite` can say *"and this one is not out
of date"* because it is standing beside a thread the reader is looking at. Ours stands beside
eleven rows, so it says the two things that are true of all of them — what it costs, and what it
cannot break:

> Another model call. What is here now is replaced only if the new one succeeds.

The second clause is the draft-then-publish guarantee (§ What must not happen), said where it is
worth something rather than left in the database docs.

**Two rows need their own words.**

- **`glossary` — the button says *Find more terms*, not *Run it again*, because that is what it
  does.** Forcing this step **appends** a batch of terms rather than replacing the list
  ([`src/glossary.ts`](../../src/glossary.ts) § `generateGlossary`, and `src/pipeline.ts` §
  `FORCE_ONLY_WHEN_NAMED` names it as the reason glossary is in that set). A row labelled *Run it
  again* that silently lengthens the reader's glossary is the exact silent success this repo keeps
  writing up. The panel's own always-present button already says *Find more*; this row says the
  same thing in the same words. **We do not invent a replace-the-glossary path** — the *Start
  again* DELETE-then-run button was deliberately removed
  ([`src/web/GlossaryPanel.tsx:1833`](../../src/web/GlossaryPanel.tsx)) and reinstating it is not
  what was asked for.
- **`hierarchy`** adds a clause about what re-cutting the tree does downstream — see its section
  above.

### `sketch` and `illustrated` are on the list, over a stated objection

[`src/web/SketchView.tsx:1050`](../../src/web/SketchView.tsx) refuses a redraw beside a picture, in
terms:

> Not `JobProgress`: that row carries a Stop button and, with no job, the Draw button — and offering
> a $0.20 redraw beside a picture that is already there is a product decision this is not.

**That decision is about a control *beside the picture*, and it survives** — nothing in this plan
touches `SketchView`. The objection it makes is to *one click, in the reader's way, next to the
thing it would replace*. A row on the technical-details section of the Metadata page, behind a shut
heading, behind a confirm, is none of those; and *"there is no way to get a different sketch"* is
precisely the gap Greg's sentence is about. Recorded here so that the next reader of that comment
finds the distinction rather than a contradiction.

## What must not happen: a failed re-run leaving the article worse

**The safety property holds, and here is the code that makes it hold.** A step writes into a draft
revision; the draft replaces the live artefact only on success.

- `failRevision` ([`src/store/pg-revisions.ts:2072`](../../src/store/pg-revisions.ts)) — *"Give up
  on a draft, leaving the reader on the revision they already had. It never touches
  `articles.current_revision_id`, and that is the whole point of the draft."*
- `failRevisionIn` (`:2120`) **refuses outright** to fail the revision the article is currently
  serving, and only sets `status: "failed"` `where status = 'draft'`.
- The settlement state machine is `src/store/pg-session.ts:19` — case 3, *stage failure or
  cancellation*: no product, no write, mark the step `error`, fail the draft, clear the pointer.

**And a single-step re-run is atomic, which is the part that matters here.** The draft is **per job,
not per step** (`src/store/pg-revisions.ts:825`), so a multi-step job where A succeeds and B fails
publishes nothing at all. `useStepJob.start` posts `steps: [step]` — one step — so the outcome is
binary: either the new artefact is published, or the reader keeps exactly what they had. (The one
existing two-step reader-initiated job is `useIllustrated.drawThenPaint`, `precededBy: ["sketch"]`,
and it is not something this plan adds a button for.)

**It is still tested before it is believed**, in the first build stage, watched red first — not
because the mechanism is doubted but because this is the guarantee the feature sells, and *"a check
you have never seen fail is not evidence"*
([silent-success.md](../reusable/silent-success.md)).

There is one known way this can still go wrong and it is not ours to fix here: a publication is
refused for the **whole** artefact set, so a step that does not touch the tree can be refused for
the tree's sake — the 2026-09-05 outage. `260907a` has since given `PublishRefused` a
`RefusalKind`, so a permanent refusal is `[jb-publish-refused]` and the card withholds a Retry the
reader cannot use. **What that buys this feature is the honest failure path point 3 of the brief
asks for**: a re-run that cannot work says so and does not invite a second paid attempt. The
preflight that would stop the money being spent before the gate is consulted is still not built and
is named as deferred in `260907a`.

## Concurrency

Nothing new is needed and nothing new should be invented.

- `useStepJob` finds the job in the **polled queue** rather than remembering the click, so a run
  started in another tab shows here as progress
  ([`src/web/useStepJob.ts:364`](../../src/web/useStepJob.ts)).
- `enqueue` hands back the job already in flight for an identical request, so pressing twice cannot
  start two.
- `starting` covers the gap between the POST and the first poll that sees the job, which is the
  state whose absence re-armed the button under a press that had already landed.
- A draft may only replace the revision it was copied from — `based_on_revision_id`, checked inside
  `publishRevisionIn` ([database.md § the moved base](../project/database.md), code at
  `src/store/pg-revisions.ts:1799`). So a long re-run racing another publication is **refused**
  rather than silently merged, and since 260907a that refusal is `[jb-publish-moved]`, kind
  `retry` — the one publication refusal for which *try again* is honest.
- A second, *different* job on one article queues rather than being refused
  ([ingest-queue.md § There is no 409](../project/ingest-queue.md#there-is-no-409-and-a-second-job-on-one-article-simply-waits)),
  so a re-run while an ingest is in flight waits its turn and says *Waiting to continue.*

The one thing to get right is that each row must own its own `useStepJob`, which means **a component
per row** rather than a loop of hooks inside `TechnicalDetails` — `provenance` is `null` before the
fetch lands, so a loop would change the hook count between renders. `useJobs` is a
`useSyncExternalStore` subscription over one shared engine
([`src/web/useJobs.ts`](../../src/web/useJobs.ts)), so eleven subscriptions cost eleven store
subscriptions and **not** eleven polls.

## References

Ordered by how much you need them.

- [ingest-queue.md](../project/ingest-queue.md) — the queue, `force`, freshness, and why a re-run of
  a middle stage generally wants the ones after it.
- [`src/web/useStepJob.ts`](../../src/web/useStepJob.ts) — the client's existing way of running one
  step and watching it. Nine callers; this adds a tenth surface.
- [`src/web/JobProgress.tsx`](../../src/web/JobProgress.tsx) — the button-that-becomes-a-band, with
  Retry, Stop, stall warning and failure sentences already right.
- [`src/web/Metadata.tsx`](../../src/web/Metadata.tsx) § `TechnicalDetails`, § `StageRow`, § `SOON`.
- [`src/pipeline.ts`](../../src/pipeline.ts) § `FORCE_ONLY_WHEN_NAMED`, § `isStepName`;
  [`src/jobs.ts`](../../src/jobs.ts) § `cascadeForce`, § `unrunnableStepPlan`.
- [`src/web/Tweets.tsx`](../../src/web/Tweets.tsx) § `Rewrite` — the two-click confirm this copies.
- [billing.md](../project/billing.md), [ai-gateway.md](../project/ai-gateway.md) — what a slot is,
  and what does not stop a reader spending our money.
- [postmortem 260905f](../postmortems/260905f-a-tightened-tree-rule-wedged-every-article-that-already-broke-it.md)
  — why `hierarchy` is on the list.
- [`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts) — draft, then publish.

## Stages

### Stage 1 — the plan, reviewed

- [x] Write this doc.
- [ ] GPT Sol on the plan, before anything is built.
- [ ] Fold the findings in; commit the doc.

### Stage 2 — a re-run button on every eligible stage row

The whole feature, on the Metadata page, for the ten `FORCE_ONLY_WHEN_NAMED` steps and `hierarchy`.

- [ ] **Tests first, each watched red before it is made green.**
  - [ ] `tests/metadata-rerun-button.test.tsx`, in the shape of
        `tests/metadata-export-button.test.tsx` (mount `Metadata`, not the section, so the gating
        and the slug are tested rather than the props):
    - a re-run control appears on an eligible row and **not** on
      `fetch` / `extract` / `blocks` / `assets` / `labels`;
    - the first press **asks** and posts nothing;
    - the second press posts exactly `{ slug, steps: [step], force: [step] }` — one step, one
      forced name;
    - the confirm row survives the round trip (`busy`), so a press cannot look ignored;
    - the glossary row says *Find more terms*, and no row says *Run it again* where the pill says
      `not run`.
  - [ ] A unit assertion that the offered set is **derived from `FORCE_ONLY_WHEN_NAMED`** (plus
        `hierarchy`), so a step added to that set gets a button rather than a second list going
        stale — and that it contains no step `unrunnableStepPlan` would refuse alone.
  - [ ] **The failure-safety test.** A single-step re-run that fails leaves the previously published
        artefact readable, and `articles.current_revision_id` unmoved. Against the **real store** —
        `tests/store-publish-guards.test.ts` is the neighbourhood — not a mock, which would prove
        the mock. Postgres suites are flaky under contention on this box: re-run alone before
        believing a red.
- [ ] Build it: a per-row component owning its own `useStepJob(slug, step, …)` — **a component, not
      a loop of hooks**, because `provenance` is null before the fetch lands and a loop would change
      the hook count between renders. `JobProgress` for the running / failed / stalled / retry
      states; a confirm row in `Rewrite`'s shape for the ask.
- [ ] Copy, added to [copy.md](../project/copy.md): the button, the confirm, and the failure
      sentence. No claim about staleness in any of it.
- [ ] `npm test`, `npm run typecheck` (grep for `✗`, the tail is always `✓`), `npm run lint` on the
      touched files, `npm run check`.
- [ ] GPT Sol on the built code — weighted higher than the plan review, per AGENTS.md. Commit.

### Stage 3 — drive a real browser, and the docs

- [ ] Playwright against system Chrome, in a Sonnet subagent
      ([browser-control.md](../project/browser-control.md) then
      [browser-testing.md](../project/browser-testing.md)) — press the button on a real article and
      watch a mode actually regenerate. Absolute scratchpad paths for screenshots; the agent kills
      its own dev-server PID.
- [ ] Remove the `rerun` row from `SOON` and **move its reasoning into this doc and into
      `Metadata.tsx`'s own docstring** — the insight about staleness must not go with the row.
- [ ] Docs: a section in [ingest-queue.md](../project/ingest-queue.md) or
      [reading-view-overview.md](../project/reading-view-overview.md) (decide which owns it; one
      owner only, `tests/doc-links.test.ts` enforces it), and a line under the entry point.
- [ ] Final `npm test` / `npm run typecheck` / `npm run check`. GPT Sol. Commit and
      `git push origin HEAD:dev`.

## Deferred, named rather than inherited

### A third pill state: *absent* is not *stale*

`StageState.done` is one boolean carrying two facts, and the page renders it as `ran` / `not run`.
A stale glossary is therefore drawn as **"not run"** beside a glossary the reader can open. The fix
is a second field — presence, alongside currency — on `StageState` and in `articleMetadata`, and
then a third pill.

**Not in this plan**, because it is a change to a shared type and a store contract in service of a
row's wording, and Greg asked for a button. It is cheap and it is worth doing: **the plan's own
button-wording rule (*Run it again* / *Run it*, off `done`) inherits the same conflation**, so a
stale row will offer *Run it*. That is not wrong — running it is what you want — but it is thinner
than it could be.

### Saying *out of date* on a stage row

Nine artefacts already carry `outdated` (`src/store/pg.ts:2984` and eight beside it — a string
comparison of the stored `version` against the step's `PROMPT_VERSION`), and six panels already draw
a banner from it. **None of that reaches `ArticleMetadata`**, so the Metadata page cannot say it.
Plumbing it through is a small, real feature and it is the one that would turn this button from an
offer into an answer.

Note what is genuinely still missing, so that whoever picks it up does not start from the wrong end:
`tweets` has no `outdated` at all (its `PROMPT_VERSION` is module-private,
`src/store/pg.ts:2504`), and `hierarchy` has none of the kind the modes have
([hierarchy.md](../project/hierarchy.md)).

**This is the piece that kept the `SOON` row unbuilt for three days, and it is not what was asked
for. If you find yourself designing a content-hash provenance scheme for the tree, stop.**

### A library-wide backfill

Explicitly declined by Greg on 2026-09-06 in the sentence that commissioned this work: *"Leave it,
new articles only."* Staleness detection is what would make it safe to offer; the demand for it is
currently zero.

### Also explicitly not in scope

- **Scheduling.** There is no scheduler — [cron-scheduler.md](../project/cron-scheduler.md).
- **A diff of before and after.**
- **A preflight that consults the publication gate before the money is spent.** Named and deferred
  in [260907a](260907a-publish-refusal-reason-kinds-permanent-vs-transient.md) § Deferred; it needs
  the step's planned write set, or it would block the very `hierarchy` step that repairs a bad tree.
- **A replace-the-glossary path.** *Start again* was deliberately removed; see § What the button and
  the confirm actually say.
- **Wiring up `useSketch.regenerate` / `useIllustrated.regenerate`**, which exist with no callers.
