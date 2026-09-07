# Re-run any generated mode, from the Metadata page

**Status as of 2026-09-07: built through Stage 2, not yet browser-driven or landed.** Evidence:
`RerunSection` in [`src/web/Metadata.tsx`](../../src/web/Metadata.tsx) and
[`src/rerun-steps.ts`](../../src/rerun-steps.ts) exist, and `npm run check` is green over 14,810
tests. Still open: Stage 3 — a real browser, the `SOON` row's removal, the evergreen docs, and the
push to `dev`. The `SOON` `rerun` row is deliberately still there until then.

The plan went through GPT Sol before anything was built — refused as written, seven of eight
findings accepted, and the accepted ones cost `hierarchy` and `illustrated` their places (§
Findings).

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
path, and the alternative — one click when `done` is false — would put the branch in the one place a
mistake costs money.

**And `busy` does not do what this plan first said it does.** ⟨Found in the build, 2026-09-07.⟩ The
claim, borrowed from `Rewrite`'s own docstring, was that it stops the plain button reappearing
mid-flight. It does not: `useStepJob.start` calls `setStarting(true)` **before** its `await`, so
`JobProgress` draws its starting row from the first render after the click either way — and the
first version of the test for it stayed green with `busy` deleted, which is the tell. What `busy`
actually buys is that the confirm **sentence** stays on screen for the whole round trip and its own
button is disabled against a second press. The test asserts that instead, and goes red.

### What the button and the confirm actually say

The confirm sentence has one job the thread's does not: `Rewrite` can say *"and this one is not out
of date"* because it is standing beside a thread the reader is looking at. Ours stands beside nine
rows, so it says the two things true of all of them — what it costs, and what it cannot break.

**Four exact variants, and this section said *two* until 2026-09-07.** ⟨Sol, F6 on the plan; F9 on
the built code.⟩

> **Default:** Another model call. The result changes only if the run succeeds.
>
> **Glossary:** Another model call. New terms are added only if the run succeeds.
>
> **Sketch:** Another model call. The result changes only if the run succeeds. It is the slowest one
> here — about two minutes — and it costs about $0.20.
>
> **Debate:** Two model calls, not one: it searches the open web, and it is the dearest thing on
> this page — $0.20–0.40 for a completed run on a short article, and more on a long one. The result
> changes only if the run succeeds.

**The gap F9 walked through was this section's own count, and it is worth saying plainly rather than
just changing the number.** *"Two exact variants"* listed the default and the glossary, with the
sketch's two numbers held over to a subsection below — and thereby claimed, without ever writing it
down, that *"Another model call"* was true of the remaining seven. It was wrong about the **number**
for `debate`, which makes **two separately metered calls**
(`src/debate.ts` § *Two groups, two passes, one atomic step*; pass B runs only if pass A succeeded,
so a failure costs one rather than two), and silent about the price. **The price it then gained was
also wrong, and for a reason worth more than the number** — see § Round three, F12: *up to ~$0.27*
came from § The spend ceiling of
[260905f](260905f-debate-mode-stage-0-spike-results.md), which § Stage 3½ § 1 of that same document
corrects twenty-seven lines further down. It is a **range**: $0.20–0.40 for a completed run on a
short article, rising with length. `src/step-order.ts` calls the step *"the second dearest thing in
the app"*.

**And § The list, four sections up, already said the first half** — *"`debate` makes two separately
metered calls"* is there, as the reason the *one press, one model call* claim had to go. One
section of this document knew and the section writing the reader's sentence did not look at it. A
confirmation that understates what it is buying is worse than none, because the reader has been told
something.

**The debate figure is inline in `Metadata.tsx`, not a constant beside `SKETCH_PRICE`.** That leaf
exists because three surfaces render the sketch's price to a **reader** and must not disagree; this
number reaches a reader in exactly one place, and the ~$0.27 that appears a dozen times across
`src/` is prose inside comments that no constant could have collected. Renaming `sketch-cost.ts` and
sweeping its importers would have bought the appearance of one home rather than one.

*"The result changes only if the run succeeds"* rather than *"what is here now is replaced"*,
because **replace** is false for the glossary and the confirm is the sentence that has to be true
for every row it appears under. The clause is the draft-then-publish guarantee (§ What must not
happen), said where it is worth something rather than left in the database docs. **All four carry
that clause**, three of them word for word and the glossary's with its own subject, because what
changes there is which terms are on the list rather than the list itself.

**The same sentence covers a Retry, and the Yes button's words are what differ** — *Yes, try again*
against *Yes, run it*. `JobProgress`'s Retry tooltip says *"skipping the stages that already
worked"*, which is true of an ingest and vacuous here: our job has one step, so a retry of it **is**
a re-run and forces the same step, at the same price. ⟨Sol, F10 — § Findings.⟩

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

### ✅ Stage 2 — its own section on the Metadata page, for the nine

- ✅ **Tests first, each watched red before it is made green.**
  - ✅ `tests/metadata-rerun-section.test.tsx` (named for the section, not the button),
        in the shape of
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
  - ✅ A unit assertion pinning `METADATA_RERUN_STEPS`: every member is in
        `FORCE_ONLY_WHEN_NAMED` (so no press cascades), none is a step `unrunnableStepPlan` would
        refuse alone, and the list is **explicit** rather than derived — a new mode step gets a
        button only when somebody has answered the three questions in § The list.
  - ✅ The list lives in a **browser-safe leaf**, not `src/pipeline.ts`:
        `tests/client-imports.test.ts` forbids the client reaching a server module, and
        `src/step-order.ts` exists because this was tried for `STEP_ORDER` and reverted. ⟨Sol, F1⟩
  - ✅ **The failure-safety test** — `tests/rerun-failure-keeps-the-old-artefact.test.ts`, three
        cases, against the real store in the `private-postgres` lane. It publishes a revision
        holding one set of quotes, opens a draft, writes a *different* set into it, fails the draft,
        and reads back through **`loadQuotes` — the reader's own path**, not the column.
    - 📔 Each of the three was watched red first, by sabotaging `failRevisionIn` and putting the
      edit back: making it move `current_revision_id` turns two of them red (*expected 'lost' to be
      'kept'*, and *promise resolved instead of rejecting*), and turning its `UPDATE … status
      'failed'` into a `DELETE` turns the third red while the other two **stay green** — which is
      exactly why the third one is kept. Losing the evidence of what failed is invisible from
      outside.
    - 📔 The reader-path choice earned itself immediately: an assertion on the draft's own column
      would have passed under the first sabotage, because the column really did hold the new value
      — the fault was the *pointer*, and only a read through `loadQuotes` can see it.
- ✅ **Move the metadata GET onto [`useOrderedRead`](../../src/web/useOrderedRead.ts), and hand
      every row the same stable `refresh`** — never `reload`. ⟨Sol, F7, and I had reached the same
      answer independently.⟩ Without it nothing on the page changes when a run lands: `ranAt`,
      `done` and the generator strings stay as they were, and the reader is left to guess whether
      the press did anything. With nine rows able to fire `onFinished`, the ordering this module
      exists for matters more here than in any single mode — a completion read must **trail** an
      outstanding GET, never join it, or the pre-job artefact overwrites the new one for good.
  - ✅ A race test: an older metadata GET resolving *after* the completion refresh must not win,
        and `ranAt` / `done` must update without navigation.
- ✅ Build it: a per-row component owning its own `useStepJob(slug, step, …)` — **a component, not
      a loop of hooks**, because `provenance` is null before the fetch lands and a loop would change
      the hook count between renders. `JobProgress` for the running / failed / stalled / retry
      states; a confirm row in `Rewrite`'s shape for the ask.
- ❌ ~~Copy, added to [copy.md](../project/copy.md)~~ — **not done, and it should not be.** That
      doc's scope is model-call failure messages, and it says of everything else, in terms:
      *"empty states, button labels, the panel headings — is still written wherever it is used…
      That is a gap rather than a decision."* This feature adds no new failure sentence
      (`JobProgress` reuses the existing ones), so nothing here belongs there by that file's own
      rule. The copy lives beside the component, in named constants with the reasoning on each.
- ✅ `npm test`, `npm run typecheck` (grep for `✗`, the tail is always `✓`), `npm run lint` on the
      touched files, `npm run check`.
- ✅ GPT Sol on the built code — weighted higher than the plan review, per AGENTS.md. Commit.
- ✅ **Refused, three P1s, all three accepted and fixed** — § Round two, on the built code. Three
      more tests in `tests/metadata-rerun-section.test.tsx`, each watched red by putting the defect
      back and then taken out again:
  - the debate row's confirm is **not** the generic sentence, and names two calls and the price —
    red with the `debate` branch of the ternary removed;
  - a Retry after a retryable failure **asks**, posts nothing, and only then reaches
    `POST /api/jobs/:id/retry` — red with the unwrapped `failed` handed back to `JobProgress`, which
    is exactly the shape F10 reported;
  - the nine run buttons and the confirm's Yes/Cancel have distinct accessible names that begin with
    their visible text — red twice, once with `about` withheld from `JobProgress` and once with the
    two `aria-label`s taken off the confirm.

- 📔 **What the build found that the plan had wrong or had not said:**
  - `busy` does not stop the plain button reappearing — § What the button and the confirm actually
    say, corrected above. The first test written for it stayed green with `busy` deleted.
  - **`SKETCH_PRICE` / `SKETCH_WAIT` became a leaf of their own**
    ([`src/web/sketch-cost.ts`](../../src/web/sketch-cost.ts)). Importing them from `SketchView.tsx`
    would have put the whole Sketch panel — its hook, its scene validator, its painter — into the
    graph of a page that draws no diagram. `IllustratedView` reads them from there too now, so
    there is still one copy of each number.
  - **The purpose box had to change, and it was a real regression rather than tidying.** Its seeding
    effect ran on every `provenance` change, which was harmless while the page read once — and
    stopped being so the moment a finished run started firing a refresh, because it would drop the
    stored sentence over a reader's half-typed draft. Keyed on the slug through a ref now, so a
    reader who has deliberately *cleared* the box does not get it filled back in either.
  - **The section is deliberately NOT gated on `hasShelfRow`**, unlike Export and Archive. Those are
    withheld because their only outcome without a row is a 404; a run is `POST /api/jobs`, whose
    refusal comes back as reader-facing copy that `JobProgress` already draws beside the row. So the
    rows draw while the metadata request is out, with `done: undefined` reading as *not that we know
    of*. That is also what makes the ordering race testable through the page at all.
  - **`debate` had never been run through `useStepJob` by any surface**, so `useStepJob`'s "the two
    lists are the same nine names" note was going stale. It now points at the pinning test rather
    than restating a count.

### Stage 3 — drive a real browser, and the docs

- ✅ Playwright against system Chrome, in a Sonnet subagent, on
      `the-mythology-of-conscious-ai-spya-rn5m0q` at 1280 and 390. **All eight checks passed**, one
      real `arc` model call spent.
  - ✅ The section is where the plan put it — between *Your reading* and *Export*, and in the
    margin's contents list — with no disclosure to open. Nine rows, right labels: *Run it again* on
    `arc`, *Find more terms* on `glossary`, *Run it* on the seven that have not run.
  - ✅ The first press asks and starts nothing; Cancel puts the button back. The glossary and
    sketch rows say their own sentences, the sketch one carrying both numbers.
  - ✅ **The one that mattered: the page re-read itself without a reload.** After the run, in the
    same DOM snapshot, *Stored as* changed revision (`207e645b…` → `f2fbf12a…`), the Technical
    details heading went to *last wrote 1 second ago*, and the `arc` row's stamp went from *ran 2
    days ago* to *ran 1 second ago*. That is `useOrderedRead` and the shared `refresh` doing the
    job F7 was raised about, proved from outside rather than argued.
  - ✅ Zero console errors and zero React warnings across sign-in, every click and the live run.
  - ✅ 390px: no horizontal overflow (`scrollWidth === clientWidth === 390`). The longest confirm —
    the sketch row's — stacks rather than cramping: name, then the sentence on its own lines, then
    the two buttons right-aligned beneath. Checked against the screenshot myself, not only the
    agent's word.
  - 📔 Cosmetic only: the button keeps a brief highlight ring just after a run finishes.
- ✅ Removed the `rerun` row — and `SOON` with it, because that was its only member. The
      convention itself stays in `Dock.tsx`, which is where this copy came from, so the next dimmed
      row on this page is three lines from there rather than a thing to reinvent.
  - ✅ **Its reasoning kept, in the place it stood**, as a comment where the constant was: what
    the row knew, and which half of it has since gone stale.
  - ✅ **And the page's own docstring corrected, which was the part worth doing.** § *What it
    deliberately does not say* claimed the honest thing was to name which stages had run *"until
    `tree.json` and `arc.json` carry a hash of the blocks they consumed"*. They do — `done` has
    meant *ran, and would not be re-run today* since the Postgres move. The store can answer; the
    **page** cannot say, because one boolean carries two facts and renders as a two-state pill.
    The rule it was protecting is untouched, and the paragraph now says which half moved.
    - 📔 This is the *"one wrong sentence became three"* shape the repo keeps writing up: the
      claim was true when written, the store moved under it, and the placeholder it justified went
      on justifying itself for three days.
- ✅ Docs: a section in [ingest-queue.md](../project/ingest-queue.md) § *A reader can ask for nine
      of them again, from the Metadata page*. **That doc rather than
      [reading-view-overview.md](../project/reading-view-overview.md)**, because it already owns
      `force`, `FORCE_ONLY_WHEN_NAMED`, freshness and re-running a step — this is a fact about the
      queue that a page happens to expose. **No new doc**, so no entry-point line is owed and
      nothing had to be asked of Greg.
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

**Round two sharpened the size of it, without changing the owner.** Sol's F9 points out that for
`debate` the exposure is *two* calls per lease window and therefore up to **six** for one press. The
overrule stands on the same two grounds — it is reachable today from `DebatePanel.tsx:804` with no
new code, and the budget is queue-wide — but the number in the deferred item below is worth having
right.

### Round two, on the built code

GPT Sol against `81e4205d` —
[the review in full](260907d-re-run-any-generated-mode-code-review-sol.md). Verdict: **refuse**,
three findings, all three P1 established, all three checked against the source and **all three
accepted**. This is the review AGENTS.md says to weight higher than the plan-stage one, and it
earned it: none of the three was findable from the plan. F10 is a button the plan never mentions,
because `JobProgress` draws it and the plan reasoned about the button it drew itself.

| ID | Severity | Disposition | What changed here |
|---|---|---|---|
| F9 | P1 established | **accepted**, and its number **superseded by F12** below | `RERUN_CONFIRM_DEBATE` — two model calls, the open web, up to about $0.27 (the wrong figure, from the wrong section; F12). § What the button and the confirm actually say now lists **four** variants and says plainly how the count came to be wrong. The figure is inline with a citation rather than a constant beside `SKETCH_PRICE`, for the reason given there. |
| F10 | P1 established | **accepted**, Sol's shape | `RerunRow` holds `pending: null \| "run" \| "retry"` in place of a boolean `asking`, and hands `JobProgress` a `failed` whose `retry` opens the confirm; the Yes button dispatches to `start({force:true})` or to the original retry. Same sentence for both — a one-step job's retry **is** a re-run and forces the same step — and different Yes words so the reader knows which press they are agreeing to. `JobProgress` keeps its straight-through Retry: nine other callers rely on it, and for a many-stage ingest that is right. |
| F11 | P1 established | **accepted** | Every actionable control in a row now carries a mode-specific `aria-label` **beginning with its visible text** — `Run it again — Debate` — so speech input still matches. Yes and Cancel are `RerunRow`'s own; Run and Retry take a new **optional** `about` prop on `JobProgress`, so the nine existing callers pass nothing and are unchanged. **Not** a row-level label or `role="group"`: the reported failure mode is button-list navigation, which does not pick either up, so that would have looked like a fix without being one. |

Three tests came with them, each watched red first by putting the defect back — § Stage 2. The one
worth naming is the accessible-name test: this file's own test header had **described** the missing
names and then used `data-rerun-step` to work around them, which is how the defect survived the
build. A test hook read as if it were something the reader gets is a shape worth recognising again.

### Round three, on the built code again

GPT Sol against the round-two commit —
[the review in full](260907d-re-run-any-generated-mode-code-review-round2-sol.md). Verdict:
**refuse**, three P1s and two P3s. All five checked against the source and **all five accepted**;
F15 and F16 were fixed by Greg while the other three were being built.

| ID | Severity | Disposition | What changed here |
|---|---|---|---|
| F12 | P1 established | **accepted** | `RERUN_CONFIRM_DEBATE` quotes the measured **range** — *$0.20–0.40 for a completed run on a short article, and more on a long one* — in place of *up to about $0.27*. Its docstring now cites § Stage 3½ § 1 and says out loud that the old ceiling was measured with probes carrying **no article**, so the next person to grep for a Debate price meets the correction rather than the number that was corrected. |
| F13 | P1 established | **accepted** | The confirm sentence carries `id="rerun-confirm-<step>"` — keyed on the step, because nine rows are on screen at once — and Yes points at it with `aria-describedby`. Focus moves to Yes when the confirm opens, so it no longer falls to `BODY` when the pressed button is unmounted. **Cancel is deliberately not described by it**: a description is read every time the control is reached, and repeating the price on the button that spends nothing is noise on the safe half of the pair. |
| F14 | P1 established | **accepted**, and widened | A pending confirm is invalidated when the state it stands over goes — a retry whose `retry` callback has disappeared, **and any pending confirm once an active `job` exists**. `RerunRow` derives what it draws (`asking`) rather than waiting for the effect that clears `pending`, so the render that would have shown the confirm over the live job never happens. |
| F15 | P3 established | **accepted** | Fixed by Greg: [ingest-queue.md](../project/ingest-queue.md) now says three special rows and six default ones. |
| F16 | P3 established | **accepted** | Fixed by Greg: the page's docstring now names `revision_step_runs.input_hash` via `hierarchyCurrency` for the tree and `Arc`'s own `sourceHash`, rather than a `tree.json` that does not exist. |

**F14 was widened past what Sol asked for, and the reason is the same one.** Sol's fix is *invalidate
a pending retry when its retry callback disappears, and let an active job take precedence*. A pending
**run** is the same shape: a job arriving from another tab means the thing the reader is being asked
whether to buy is already happening, and for as long as they take to answer, the confirm is drawn
*instead of* `JobProgress` — so they lose the progress, the Stop button and the stall warning over a
question that has been answered for them. It keys on `job`, never on `starting`: `starting` is the
gap between our own POST and the first poll, so keying on that would tear the confirm away between
the click on Yes and the answer, which is the state `busy` exists to hold on screen.

Three tests came with them, each watched red first:

- the debate row's confirm names the range and **not** `$0.27` — red against the shipped sentence;
- focus lands on Yes and Yes's `aria-describedby` **resolves** to text naming the cost — red twice,
  once with the attribute removed (*"Yes is not described by anything"*) and once with it left in
  place but pointing at an id nothing has, which is what asserting the resolved description rather
  than the attribute is for;
- three interleavings under an open confirm — a job arriving under a *run* confirm, a job arriving
  under a *retry* confirm, and the failure clearing with no job at all — each red with the confirm
  still drawn over the live job and the silent-no-op Yes still reachable.

- 📔 **The lesson under F12 is not the price.** The number was taken from the **first hit** in a
  document that corrects itself: § The spend ceiling says *up to ~$0.27*, and § Stage 3½ § 1 —
  **twenty-seven lines further down, in the same file** — says that figure was measured with probes
  carrying no article, that a completed live run cost $0.3527, that per-pass cost varied 2.4×, and
  that it should be quoted as a range. The citation was real, the reading stopped early, and the
  test written for it pinned the same wrong number, so the two agreed with each other about
  something neither had checked. **A cited figure is only as good as the last section of the cited
  document**, and a spike-results doc is exactly the shape that supersedes itself: the early sections
  are probes and the later ones are the real runs.

- 📔 **`SKETCH_PRICE` was checked for the same defect and is not it.** F12's shape — a figure taken
  from a section its own document later corrects — is worth asking of every measured number on this
  page, and the sketch's was asked. *About $0.20* is still the best-supported figure: the three
  ledger-read measurements in `evals/results/cost-per-article-2026-09-03.md` (the same model and the
  same `high` effort as production today) are $0.1443, $0.1671 and $0.2994, mean **$0.2036**.
  **Left alone**, because it is rendered on three surfaces and is right. Two smaller things are now
  known and are not this plan's to change: it is a **mean rather than a bound** — a long article is
  $0.30, so a Debate-style *up to* would say $0.30 — and the *121–194 s* range that `sketch-cost.ts`,
  `src/jobs.ts`, `src/step-order.ts`, `src/mode-catalog.ts` and
  [diagram.md](../project/diagram.md) all repeat is falsified by a 220.5 s draw in that same eval,
  which leaves the 240 s budget 8% of headroom rather than the "rounded up hard" its comment claims.

- 📔 **What is still open after F13**, named rather than fixed: when a confirm is torn away by a job
  arriving from another tab, focus falls to `BODY` again. Moving it in response to a background
  event is its own anti-pattern, so this is left alone deliberately — but it is the same class as
  F13 and worth knowing about.

## Deferred, named rather than inherited
### Two cost figures outside this feature that measurement has overtaken

**Found while fixing F12, not fixed, and both are Greg's call because they change copy on surfaces
this work does not own.**

- **`SKETCH_PRICE` is a mean presented as a figure.** Three ledger-read draws on 2026-09-03, same
  model and effort as production (`evals/results/cost-per-article-2026-09-03.md:36`): $0.1443,
  $0.1671, **$0.2994** — mean $0.2036. The copy says *"about $0.20"*, which is 50% under the top of
  that sample. Debate's row, one line above it on the same page, now says *"$0.20–0.40 … and more on
  a long one"*, so the two rows hold themselves to different standards. Changing it means changing
  what the Sketch panel and Illustrated say to readers, which is why it is here rather than done.
- **The `121–194 s` range is falsified.** The same eval has a **220.5 s** draw. The range is
  repeated in `src/web/sketch-cost.ts`, `src/jobs.ts:657`, `src/step-order.ts:109`,
  `src/mode-catalog.ts:306` and `docs/project/diagram.md:1602`, and against the 240 s budget it
  leaves **8%** of headroom rather than the *"rounded up hard"* its own comment claims. That one is
  not only copy.

Neither is introduced here. Both are named because this feature now renders the first of them to a
reader on a fourth surface, and shipping a disclosure we have just been told is low is the exact
mistake F12 was.


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
