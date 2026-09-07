# Re-run any generated mode, from the Metadata page

**Status as of 2026-09-07: planned and reviewed, not built.** Evidence: `SOON` in
[`src/web/Metadata.tsx`](../../src/web/Metadata.tsx) still carries the dimmed `rerun` row, and
nothing in `src/web/` posts `{ slug, steps: [step], force: [step] }` from that page. The plan has
been through GPT Sol once — refused as written, seven of eight findings accepted, and the accepted
ones cost `hierarchy` and `illustrated` their places. § Findings.

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

**The offered set is a list of its own** — `METADATA_RERUN_STEPS`, in a browser-safe leaf beside
[`src/step-order.ts`](../../src/step-order.ts) — and its first version holds **nine**:

> `arc`, `tweets`, `glossary`, `quotes`, `ideas`, `timeline`, `quiz`, `sketch`, `debate`

**It is not `FORCE_ONLY_WHEN_NAMED`, and the first draft of this plan said it was.** ⟨Sol, F1⟩
That constant governs one thing — whether the positional force cascade may speak for a step — and
this control needs three answers it does not give: how many metered calls a press buys, whether the
step has a prerequisite it will refuse without, and whether a "successful" run is safe to publish
**over** a good artefact. Deriving the UI from it would have swept every future member in
automatically on those three unexamined.

There is a second, harder reason: **the client may not import `src/pipeline.ts` at all.**
`tests/client-imports.test.ts` enforces that nothing under `src/web/` reaches a server module, and
`src/step-order.ts` exists because exactly this was tried and reverted for `STEP_ORDER`
(`src/step-order.ts` § the header). So the list has to be a leaf whatever else is decided.

What membership still buys, and what it does not:

1. **Forcing one of these forces nothing else.** `cascadeForce` sweeps in everything downstream
   *except* members of `FORCE_ONLY_WHEN_NAMED`, and only names steps already in the job — so
   `{ steps: [step], force: [step] }` forces exactly that step. **Every name on our list is also in
   that set**, and a test asserts it. That is the property we borrow.
2. **It does not mean one model call, and the first draft of this plan claimed it did.** Two things
   defeat that claim and they are independent:
   - **A step is not a call.** `src/jobs.ts:1002` says so, and `debate` makes two separately metered
     calls (`src/debate.ts:35`).
   - **A step is not run at most once.** The queue promises one call per *lease window* and caps a
     job at three windows — `REQUEUE_BUDGET`, [`src/jobs.ts:306`](../../src/jobs.ts),
     [ingest-queue.md](../project/ingest-queue.md). A claimant that dies between the paid answer
     returning and its transaction committing gets the step bought again.

   So the invariant this plan holds itself to is: **one press forces exactly one step and cascades
   into nothing; that step costs one model call per lease window it runs in, bounded at three by the
   queue.** Never "one press, one model call". ⟨Sol F1/F2, arbitrated by Fable: *"The plan asserted
   a contract the system does not have."*⟩

### Three that are out and were in the first draft

**`hierarchy` — out.** ⟨Sol, F5, and I verified both halves⟩ It was in, on the strength of the
2026-09-05 postmortem naming a forced `hierarchy` as the only workaround for a wedged article. Two
facts defeat it at this commit:

- **A forced hierarchy publishes a tree with no navigation labels.** `src/hierarchy.ts:2631` writes
  an empty `PendingLabelsFile`, and the merge is against that empty map — the source says it flatly:
  *"this tree carries NO navigation labels at all… the obvious guess is wrong and the stage-2 brief
  made it."* Publication then deletes the carried `labels` receipt
  (`src/store/artifacts-pg.ts:1448`).
- **Nothing brings them back.** The free successor job that
  [260906a](260906a-labels-leave-the-blocking-hierarchy-step.md) describes is **not built** — I
  grepped: no caller anywhere enqueues `steps: ["labels"]`. And this plan excludes `labels` from the
  offered set. So a reader who pressed it would strip their paragraph labels with no door back.

A third fact makes it worse rather than better: force does not bypass hierarchy's checkpoints
(`src/hierarchy.ts:2853`), so the press may replay a checkpoint and buy nothing — a re-run that
looks like it worked and changed nothing, which is the failure this repo names most often.

**The workaround is still worth making findable**, and it is now a piece of work with its own
prerequisites rather than a row on a list. Named in § Deferred.

**`illustrated` — out.** ⟨Sol, F3 and F4⟩ Two independent defeats:

- **It refuses without a usable Sketch** (`src/pipeline.ts:3716`) and does not pull the prerequisite
  in, so on an article with no Sketch — most of them — the control could only fail. That is the
  rule this page already applies twice.
- **A partial success replaces a good picture.** The step deliberately catches per-plate provider
  and storage failures and returns the partial artefact *successfully*
  (`src/illustrated.ts:1016`, `src/pipeline.ts:3779`, `:3834`). Draft-then-publish is atomic, but
  atomicity does not help when the *success condition itself* is too weak: a good four-plate
  illustration can be replaced by a "successful" run of four failed plates. Partial publication is
  right for a **first** generation and wrong for a **replacement**, and that distinction does not
  exist in the step today.

`sketch` stays: it has no prerequisite, and it replaces wholesale.

**`labels` — out**, and now for a second reason as well as the first. It is not a mode a reader
goes to. And with `hierarchy` out there is nothing on this page that invalidates it, so there is
nothing for it to repair.

### The four that were always out

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
- **`assets` — out.** No model call, and the row nobody has ever wanted again. Costs nothing to add
  later if a hot-linked image ever needs re-hosting.

**The simpler option passed over:** a button on *every* row, one rule and no list. Rejected on
`blocks` alone — that button can only 400 — and on `fetch`/`extract` meaning something the rest of
the rows do not. The second simpler option, deriving the list from `FORCE_ONLY_WHEN_NAMED`, is
rejected above and was in the first draft.

**So this is honestly a partial first version, not yet "any generated mode".** ⟨Sol, F1⟩ Nine of
the eleven, with `hierarchy` and `illustrated` named as work of their own rather than quietly
dropped. Full coverage and a safe replacement cannot both be had from the stage implementations as
they stand, and pretending otherwise is how the postmortem in the references happened.

## Where the control goes

Greg offered two homes and chose neither: *"either within the UI for the mode, or perhaps in the
Metadata section"*.

**The Metadata page, and only the Metadata page.** The rows are already there — one per stage, with
when it last wrote — the dimmed placeholder is already there, and it is **one place rather than
nine**. The reading view's band is a space whose whole design is about not accumulating
affordances ([reading-view-overview.md](../project/reading-view-overview.md),
[new-mode.md](../project/new-mode.md)); adding a control to each of nine panels is nine new
affordances bought for one feature.

**And the in-mode half is already built for six of the nine, which is the second half of the
argument.** A forced re-run beside a *current* artefact is already offered by Ideas
(`IdeasPanel.tsx:317`), Quotes (`QuotesPanel.tsx:1019`), Timeline (`TimelinePanel.tsx:529`), Debate
(`DebatePanel.tsx:804`), Quiz (`QuizPanel.tsx:503`) and the thread (`Tweets.tsx` § `Rewrite`).
Glossary has *Find more*, which appends.

So what the Metadata page adds is **the two rows with no door at all** — `sketch` (refused on cost,
in a comment; § below) and `arc` (automatic and unforced only; `useArc` does not even return
`outdated`) — **and one place that holds all nine**, which is the part Greg asked for.

`useSketch.regenerate` and `useIllustrated.regenerate` **exist, are documented, and have no caller
anywhere in `src/web/`**. Worth knowing rather than acting on: this plan does not wire them up.

**Judgment recorded for the in-mode half: no new in-mode controls in this plan.**

### Its own section, not the stage rows — and this is a change from the first draft

`Section` (`Metadata.tsx:2087`) mounts shut, and `TechnicalDetails` passes `collapsible`. So the
stage rows sit behind **two** disclosures: a shut *Technical details* section, then the *What we did
to it* subheading.

**The `SOON` `rerun` placeholder has been in exactly that spot since 2026-09-03, and Greg asked for
this feature on 2026-09-06 without mentioning it.** That is evidence he never saw it. A control he
cannot find is not the thing he called important, and building the real button into the same hole
would be repeating the experiment.

So: **a section of its own, open, above the machinery.** Not a duplicate list — the two answer
different questions and only one of them is a menu:

| | |
|---|---|
| *What we did to it*, inside Technical details | a **record**: all sixteen stages, when each last wrote, no controls. Unchanged. |
| *Generate it again*, its own section | a **menu**: the nine you can ask for, each with its confirm and its progress. |

It is also **less code**, which is the tell that it is the right seam: no eligibility branch inside
`StageRow`, and no interleaving of rows that have a button with rows that cannot.

Placement: after *Your reading*, before *Export*. The page's stated order is what the article is,
then where it goes, then the reader's own work on it, then the machinery — and asking for something
to be generated again is the reader's own work.

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
rather than being refused). **A one-click repeatable paid button on a page of nine of them is
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
of date"* because it is standing beside a thread the reader is looking at. Ours stands beside nine
rows, so it says the two things true of all of them — what it costs, and what it cannot break.

**Two exact variants, and the second is not optional.** ⟨Sol, F6: changing only the glossary
button's label leaves the *confirmation* lying.⟩

> **Default:** Another model call. The result changes only if the run succeeds.
>
> **Glossary:** Another model call. New terms are added only if the run succeeds.

*"The result changes only if the run succeeds"* rather than *"what is here now is replaced"*,
because **replace** is false for the glossary and the confirm is the sentence that has to be true
for every row it appears under. The clause is the draft-then-publish guarantee (§ What must not
happen), said where it is worth something rather than left in the database docs.

**The glossary's button says *Find more terms*, not *Run it again*.** Forcing this step **appends** a
batch of terms rather than replacing the list
([`src/glossary.ts`](../../src/glossary.ts) § `generateGlossary`; `src/pipeline.ts:385` names it as
the reason glossary is in `FORCE_ONLY_WHEN_NAMED` at all). A row labelled *Run it again* that
silently lengthens the reader's glossary is the exact silent success this repo keeps writing up. The
panel's own always-present button already says *Find more*; this row says the same thing in the same
words. **We do not invent a replace-the-glossary path** — the *Start again* DELETE-then-run button
was deliberately removed ([`src/web/GlossaryPanel.tsx:1833`](../../src/web/GlossaryPanel.tsx)).

Glossary is the only append in the set — checked, and Sol found no other.

### `sketch` is on the list, over a stated objection

[`src/web/SketchView.tsx:1050`](../../src/web/SketchView.tsx) refuses a redraw beside a picture, in
terms:

> Not `JobProgress`: that row carries a Stop button and, with no job, the Draw button — and offering
> a $0.20 redraw beside a picture that is already there is a product decision this is not.

**That decision is about a control *beside the picture*, and it survives** — nothing in this plan
touches `SketchView`. The objection it makes is to *one click, in the reader's way, next to the
thing it would replace*. A row on the Metadata page, behind a confirm, is none of those; and *"there
is no way to get a different sketch"* is precisely the gap Greg's sentence is about. Recorded here
so that the next reader of that comment finds the distinction rather than a contradiction.

The `$0.20` and the two-minute wait belong in the confirm for that row specifically — `SKETCH_PRICE`
and `SKETCH_WAIT` are already constants in `SketchView.tsx`, and this is the one row where the
default sentence's *"another model call"* understates the press by an order of magnitude.

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

**The 2026-09-05 shape — an unrelated step refused for the carried tree's sake — is closed, and the
first draft of this plan described it as live.** ⟨Sol, F8⟩ `reasonsNotToPublish` now judges the
publication on the inputs the draft *changed*: `checkTree` problems on blocks and a tree carried
forward unchanged are collected as `carriedTreeProblems` and **logged rather than refused**
([`src/store/pg-revisions.ts:1605`](../../src/store/pg-revisions.ts), whose docstring is the
postmortem in miniature). A publication that builds or alters a tree is still judged in full — which
is why `hierarchy` remains the repair path for a bad stored tree, and why it is a piece of work of
its own rather than a row here.

What is left, and it is smaller: `260907a` gave `PublishRefused` a `RefusalKind`, so a permanent
refusal is `[jb-publish-refused]`, kind `bug`, and the card withholds a Retry the reader cannot use.
**That is the honest failure path point 3 of the brief asks for.** The preflight that would stop the
money being spent *before* the gate is consulted is still not built, and is named as deferred in
`260907a`.

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

**One press can still buy the step up to three times, and that is the queue's property rather than
this page's.** ⟨Sol F2, overruled after arbitration — see § Findings overruled.⟩ `settleExpired`
grants a lapsed job a fresh lease window without requiring progress, up to `REQUEUE_BUDGET`
([`src/jobs.ts:306`](../../src/jobs.ts)), and a mode step banks no checkpoint — so a claimant dying
between the paid answer and the commit means the answer is bought again. **The exposure is not
introduced here**: the same POST from `QuotesPanel.tsx:1019` reaches the same row today. Nothing the
client sends changes it — requeue is decided from the row's lease and `requeues` counter alone, and
`workKeyFor` dedup only collapses concurrent identical requests. Named so the next reviewer does not
rediscover it.

The one thing to get right is that each row must own its own `useStepJob`, which means **a component
per row** rather than a loop of hooks inside `TechnicalDetails` — `provenance` is `null` before the
fetch lands, so a loop would change the hook count between renders. `useJobs` is a
`useSyncExternalStore` subscription over one shared engine
([`src/web/useJobs.ts`](../../src/web/useJobs.ts)), so nine subscriptions cost nine store
subscriptions and **not** nine polls.

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
  — why `hierarchy` was on the list, and § Deferred for why it is not.
- [`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts) — draft, then publish.

## Stages

### ✅ Stage 1 — the plan, reviewed

- ✅ Write this doc.
- ✅ GPT Sol on the plan, before anything is built —
      [review](260907d-re-run-any-generated-mode-review-sol.md), against `bcb7bcd8`. **Refused as
      written**, eight findings, five of them established P1s. Seven accepted, one overruled after
      arbitration — § Findings, and what happened to each.
- ✅ Fold the findings in; commit the doc.
  - 📔 The review cost `hierarchy` and `illustrated` their places and turned a claimed contract
    (*one press, one model call*) into a false one. Both were mine to get wrong at the plan stage
    and cheap to fix there, which is the argument for the review being first rather than last.

### Stage 2 — its own section on the Metadata page, for the nine

- [ ] **Tests first, each watched red before it is made green.**
  - [ ] `tests/metadata-rerun-button.test.tsx`, in the shape of
        `tests/metadata-export-button.test.tsx` (mount `Metadata`, not the section, so the gating
        and the slug are tested rather than the props):
    - a control appears for each of the nine and for **no** other step — `fetch`, `extract`,
      `blocks`, `assets`, `labels`, `hierarchy`, `illustrated`;
    - the first press **asks** and posts nothing;
    - the second press posts exactly `{ slug, steps: [step], force: [step] }` — one step, one
      forced name;
    - the confirm row survives the round trip (`busy`), so a press cannot look ignored;
    - the glossary row says *Find more terms* and its confirm says *New terms are added*, not
      *the result changes*;
    - the sketch row's confirm carries `SKETCH_PRICE` and `SKETCH_WAIT`.
  - [ ] A unit assertion pinning `METADATA_RERUN_STEPS`: every member is in
        `FORCE_ONLY_WHEN_NAMED` (so no press cascades), none is a step `unrunnableStepPlan` would
        refuse alone, and the list is **explicit** rather than derived — a new mode step gets a
        button only when somebody has answered the three questions in § The list.
  - [ ] The list lives in a **browser-safe leaf**, not `src/pipeline.ts`:
        `tests/client-imports.test.ts` forbids the client reaching a server module, and
        `src/step-order.ts` exists because this was tried for `STEP_ORDER` and reverted. ⟨Sol, F1⟩
  - [ ] **The failure-safety test.** A single-step re-run that fails leaves the previously published
        artefact readable, and `articles.current_revision_id` unmoved. Against the **real store** —
        `tests/store-publish-guards.test.ts` is the neighbourhood — not a mock, which would prove
        the mock. Postgres suites are flaky under contention on this box: re-run alone before
        believing a red.
- [ ] **Move the metadata GET onto [`useOrderedRead`](../../src/web/useOrderedRead.ts), and hand
      every row the same stable `refresh`** — never `reload`. ⟨Sol, F7, and I had reached the same
      answer independently.⟩ Without it nothing on the page changes when a run lands: `ranAt`,
      `done` and the generator strings stay as they were, and the reader is left to guess whether
      the press did anything. With nine rows able to fire `onFinished`, the ordering this module
      exists for matters more here than in any single mode — a completion read must **trail** an
      outstanding GET, never join it, or the pre-job artefact overwrites the new one for good.
  - [ ] A race test: an older metadata GET resolving *after* the completion refresh must not win,
        and `ranAt` / `done` must update without navigation.
- [ ] Build it: a per-row component owning its own `useStepJob(slug, step, …)` — **a component, not
      a loop of hooks**, because `provenance` is null before the fetch lands and a loop would change
      the hook count between renders. `JobProgress` for the running / failed / stalled / retry
      states; a confirm row in `Rewrite`'s shape for the ask.
- [ ] Copy, added to [copy.md](../project/copy.md): the button, the two confirm variants, the sketch
      row's price line, and the failure sentence. No claim about staleness in any of it.
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

## Findings, and what happened to each

Round one, GPT Sol against `bcb7bcd8` —
[the review in full](260907d-re-run-any-generated-mode-review-sol.md). Verdict: **refuse as
written**. Each finding checked against the source myself rather than taken.

| ID | Severity | Disposition | What changed here |
|---|---|---|---|
| F1 | P1 established | **accepted** | The offered set is now an explicit `METADATA_RERUN_STEPS` in a browser-safe leaf, not `FORCE_ONLY_WHEN_NAMED`. The *one press, one model call* claim is gone. The client-import half is separately confirmed: `src/pipeline.ts` is not on `tests/client-imports.test.ts`'s allowlist. |
| F2 | P1 established | **overruled**, via Fable | Pre-existing and queue-wide; see below. |
| F3 | P1 established | **accepted** | `illustrated` out — it refuses without a usable Sketch and does not pull it in. |
| F4 | P1 established | **accepted** | `illustrated` out — a partial-plate run returns *successfully* and would replace a good picture. |
| F5 | P1 established | **accepted**, both halves verified | `hierarchy` out. `src/hierarchy.ts:2631` writes an empty pending manifest and the merged tree carries **no** nav labels — the source says so flatly. And nothing enqueues a `labels` job: I grepped, there is no caller. |
| F6 | P1 established | **accepted** | Two exact confirm variants; the glossary's says *new terms are added*, because *replaced* is false for it and a label change does not repair a confirmation. |
| F7 | P1 reasoned | **accepted** | The metadata GET moves onto `useOrderedRead`; one stable `refresh` to every row. |
| F8 | P3 established | **accepted** | The carried-tree refusal is fixed, not live: `carriedTreeProblems` are logged. My paragraph described a closed outage as current. |

### F2, overruled — one press can still be attempted three times

**The finding is factually right and it is not this feature's to fix.** `settleExpired` grants a
lapsed job a fresh lease window without requiring progress, up to `REQUEUE_BUDGET`
([`src/jobs.ts:306`](../../src/jobs.ts)); a mode step banks no checkpoint; so a claimant dying
between the paid answer and the commit means the answer is bought again, up to three times.

Overruled on two grounds, both checked by Fable against the source:

- **Not introduced here.** Seven surfaces already post the identical body through the identical
  route — `QuotesPanel.tsx:1019`, `IdeasPanel.tsx:317`, `TimelinePanel.tsx:529`,
  `DebatePanel.tsx:804`, `QuizPanel.tsx:503`, `Tweets.tsx` § `Rewrite`, `GlossaryPanel.tsx` § *Find
  more*. Sol's own scenario is reachable today with no new code.
- **Wrong owner.** `REQUEUE_BUDGET` is applied in the sweep and in `pauseForDeadline` for **every**
  job. A per-job "zero-requeue" flag would put a queue-wide policy inside one page's feature and
  leave those seven buttons exposed.

**A third ground I offered does not survive, and it is recorded because it was mine.** I argued the
fix would reinstate the bug the budget fixed — a deploy landing mid-ingest costing the reader their
job. Fable: true for ingest, where chunks are banked; for a single-call mode job nothing is banked,
so the cost would be one Retry click. The overrule stands on the two grounds above, not on that one.

**And Fable found something neither Sol nor I had.** The `REQUEUE_BUDGET` docstring justifies not
building the tighter rule by saying it *"would save… the `assets` outline call and little else"*.
That was already false when the panel buttons were written: every mode step is an un-checkpointed
paid call. The decision may still be right; **its stated reason is stale.** Deferred below, owned by
the queue.

## Deferred, named rather than inherited

### `hierarchy`, as the repair path it actually is

The 2026-09-05 workaround is still worth making findable, and F5 showed it is a piece of work rather
than a row: a forced hierarchy may replay its checkpoint and buy nothing
(`src/hierarchy.ts:2853`), it publishes an empty pending-label state, and the free Labels successor
that [260906a](260906a-labels-leave-the-blocking-hierarchy-step.md) describes **is not built** — so
today it would strip a reader's paragraph labels with no door back. Whoever picks this up needs the
successor first, then explicit checkpoint, cost and atomicity semantics for the press. The natural
shape is probably `{ steps: ["hierarchy", "labels"], force: ["hierarchy"] }` in one atomic draft,
but that is a design call, not a foregone one.

### `illustrated`, and replacement-specific success

Two things are needed and neither is small. A **server-owned `runnable` verdict** using the runner's
exact prerequisites — a usable Sketch, current against the article, compatible with the reader
profile — because `StageState.done` only compares the illustration with its Sketch
(`src/store/pg.ts:2772`) and cannot answer it. And **replacement semantics**: when a current
illustration exists, any plate-generation or plate-storage failure must fail the whole forced step
before publication. Partial-plate publication stays right for a *first* generation; that distinction
does not exist in the step today.

### A progress test on the requeue budget

`REQUEUE_BUDGET`'s docstring names the tighter rule — *"requeue only if a checkpoint landed"* — and
declines it on a justification that no longer holds (§ F2 above). **Owned by the queue, whenever
somebody next touches settlement**, not by this plan. Worth doing if a reader is ever charged three
times for one press and notices.

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
