# Open the article before Structure, and swap the real tree in live

Status: **planned and reviewed; being built.** § Review record says what the review changed, and where it differs the review record wins. Parent: [plans.md](../project/plans.md). Picks up option A of
[the investigation](../investigations/261004e-open-the-article-before-structure-and-assets-where-the-import-s-time-goes-and-what-deferring-costs.md),
which was stopped on 2026-10-04, after Greg answered the question it ended on:

> it would be lovely if Structure mode could load after the page is already visible without
> requiring a page reload, but if that's complex, I can live with the page auto-reloading when
> Structure gets generated
>
> — Greg, 2026-10-05

## What this is, in one paragraph

A pasted web page waits about 31 s before it opens, and 25 of those are one model call that builds
the structure (the nested table of contents with a gist per section). The reader needs none of it to
start reading. So a **first import** publishes with a stand-in tree cut from the article's own
headings, which costs nothing, and the reading view opens after about 6 s. A second job then builds
the real structure, and the open page swaps the tree in without a reload. Until it lands the
Structure band shows the headings and says the rest is being built; the modes that read the
structure wait for it.

## The two routes, priced

**Route 1, live:** when the structure job ends, the page fetches the article again and replaces
**only the tree** (and the two small fields that go with it) in the article it already holds. The
prose, its images and everything the reader has open are untouched.

**Route 2, reload:** when the structure job ends, the page calls `location.reload()`.

| | Route 1 (tree-only swap) | Route 2 (auto reload) |
|---|---|---|
| New client code | one hook, about 80 lines; one line where the article is handed to the reader | the same hook's detection half, then the reload |
| Reader's place | not moved | back to the top of their section (`?at=` names a section's first block) |
| A chat or search streaming at that moment | carries on | cut off |
| A typed draft (comment, annotate) | kept | lost unless `safeToReload` learns about comment drafts, open dialogs and streams, which it does not cover today (`src/web/safe-to-reload.ts`) |
| Loop risk | none: the swap happens only if the fetched tree is real | needs a once-guard, or it reloads for ever when the tree is still the stand-in |
| What can go wrong | a component holding a tree node id across the swap (census below: three bits of hover and focus state, nothing saved) | modes that start on arrival start again |

Neither is small once done properly (GPT Sol, F11: the swap also needs a fresh jobs list, a fence on
overlapping reads, a check that the fetched tree was cut from the blocks on screen, and three
resets of held node ids). The reload needs its own guards and still loses the reader's stream and
draft. They are about the same size, and Greg prefers the live one. **Build route 1.** It is much smaller than the *re-read without blanking* that
stopped [261004l](261004l-figures-arrive-after-a-paper-opens-and-an-open-article-re-reads-itself.md),
because it never touches the blocks or the images: four of that review's findings (F2 a re-read
that loses a picture, F3 the lightbox's blob URL, F4 two re-reads racing, and most of F1) were about
replacing those. `Reader` already survives being handed a new `article` object, on every load with
images (`src/web/article/access.ts`, the second draw).

If the fetched article's blocks are not the ones on screen (not expected: `structure` does not
change them), the hook does nothing and the band says *Reload to see the structure*. No automatic
reload is built.

## What was passed over

- **Making `Article.tree` nullable.** 45 or more files, and a crash when one is missed. The stand-in
  tree keeps every reader of the tree working.
- **A new pipeline step** (`outline`) for the stand-in tree. Every exhaustive list of steps would
  need a row. The `structure` step already knows how to write a headings tree: it is its own
  fallback when the model's answer cannot be used (`buildBoundedHeadingTree`).
- **Letting `blocks` write the tree and dropping `structure` from the import's step list.** Refused
  in three places that exist for good reasons (`unrunnableStepPlan`, `checkProduct`, and the rule
  that a tree is written with a labels manifest), plus a new arm in the publication gate.
- **Deferring on every import.** A Refresh, Rebuild, Start again or *Read this* already has an
  article on screen while it runs, so nobody is waiting on a blank page, and deferring there is what
  produced most of the earlier attempts' findings (the old tree and its finished run are carried
  into the draft; the second job skips; the real tree never comes back). **Only an article that has
  never been published defers.**
- **Deferring `assets` too.** On a web page it is 0.8 s, and until it runs every image is fetched
  from the publisher, which is what the step exists to stop. On a PDF it is the 49 s of figure
  recovery, which is 261004l, stopped. It stays where it is.
- **The CLI and the tests.** `npm run ingest` and every test that imports through the queue keep
  today's behaviour: the new path is asked for by the two browser routes only.

## What it saves

Web page: opens after `fetch + extract + blocks + assets`, about 5.4 s of 30.6 measured. PDF: 47 s
of about 300 (the structure call); the rest is `extract` and figure recovery, untouched.

## Everything that assumes a real tree, and what happens to each

From two greps of the whole tree, server and client, 2026-10-05. This list is what stopped the
earlier attempts, so each row has an answer.

**A fact that changes the design:** `provisional: "headings"` is already published today, as a
*final* tree, when `structure` falls back. So that value cannot mean *the real one is coming*. A
second value does: `provisional: "awaiting-structure"`.

| What | Where | Answer |
|---|---|---|
| Publication needs a tree and a finished `structure` run for these blocks | `reasonsNotToPublish`, `src/store/pg-revisions.ts` | Unchanged. The stand-in is written **by the `structure` step**, so the run row and hash are real. |
| `checkTree`'s gist rule | `src/tree-invariants.ts` | Already exempts any `provisional` tree. |
| A tree must be written with a labels manifest; a pending one buys the `labels` job at publication | `src/store/artifacts-pg.ts`, `publishRevisionIn` | The manifest is written as now. **The publication does not queue `labels` when the tree is awaiting.** The second publication does, as today. |
| The main-mode jobs are queued at an import's first publication | `publishRevisionIn` § `firstFullPublicationOfAnImport` | Not at an awaiting publication. Queued instead by **the publication that replaces an awaiting tree with a real one**, read off the previous revision's tree. |
| `structure` counts as done when its artefacts exist, so a second job would skip | `stepIsDone`, `src/pipeline.ts` | `structure` gains an `isDone` that answers no while the stored tree is awaiting. Mutation-tested: this is the silent one. |
| A re-import carries the old tree and run | `beginDraftIn` | Never defers (above). The step checks `store.hasEarlierBlocks` itself as well as trusting the request. |
| Steps whose prompt or stamp reads the tree: `labels`, `arc`, `tweets`, `glossary`, `quotes`, `ideas`, `timeline`, `quiz`, `faq`, `sketch`, `skim`, `crossrefs`, `debate`, `citations` (and by position `relations`, `simple`, `illustrated`) | `src/pipeline.ts` § `STEPS` | They queue behind the structure job anyway, since it is exclusive and older (`blockedByAnother`). If it **failed**, the runner refuses any step after `structure` except `assets` while the tree is awaiting, with a sentence that says to build the structure first. One rule, by position, not a list to maintain. |
| `useArc` posts an `arc` job on every owned open | `src/web/useArc.ts` | Does not post while the tree is awaiting. |
| Reset regenerations, *Read this* (`upgradedFromMinimal`) | `publishRevisionIn` | Never awaiting: neither is a first import. |
| The charge for the import | `settleIn`, `src/store/pg-session.ts` | Unchanged: at the first publication, when the article is readable. The structure job is a successor and reserves nothing. |
| Flat or under-four-block trees, which break the labels planner and the client's section depth | `buildBoundedHeadingTree` | The bounded builder is the one used, and it never returns a flat tree. Under four body blocks it throws; then the step calls the model in the import as today (a tiny article is quick). |
| Request-path readers: live conversation, export, feedback, term lookup, link summaries, `/api/similar` | various | All work on a headings tree (the fallback already ships). Two caches keyed on the tree (`similar`, link summaries) are bought again after the swap if used in those seconds. Accepted. |
| Shelf card: part count, gist | `src/library-scalars.ts` | Part count from the headings; the gist falls back to the excerpt, as it already does. |
| Metadata page shows Structure as run | `src/store/pg.ts` | True of the stand-in for those seconds. Accepted. |
| Client tree readers: Structure, Outline, spine, breadcrumb, keys, marginalia heads, Skim's where-card, Diagram, quiz tallies, masthead | `src/web/tree.ts` and its callers | All rebuild from `article` when it changes identity (`Reader.tsx`). None reads `provisional` today. |
| Node ids held across the swap | `OutlinePanel` focus, `DiagramPanel` hover and roving | Transient. Nothing in the URL, localStorage or the server holds a node id. The browser check looks at an open Structure and an open Diagram through the swap. |
| A structure job that ends while the article is still loading is never announced (261004l F1) | `src/web/useJobs.ts` | The hook is a **level** check, not an edge: *the tree I hold is awaiting and no structure job for this slug is queued or running*. True in that window too, and for a stale prefetched payload. |
| The add page opens the article when its job is `done` | `src/web/AddPage.tsx` | No change needed; it fires earlier. |
| A visitor to a shared article | `/api/public` | Sees the headings, and the real tree on their next load. Known limit, as with labels. |
| Every tab closed before the structure job runs | "the browser is the worker" | It waits, as `labels` does, and runs when the owner next opens any page. Known limit. |
| CLI | `scripts/stage.ts` | Does not ask for the new path. |

## Stage 1: the server

1. **Types.** `Tree.provisional` becomes `"headings" | "awaiting-structure"` (`src/types.ts`, and the
   public type). `JobStep` gains `headingsFirst?: true`, kept in the job's own `steps` JSON, so there
   is **no migration**.
2. **Asking for it.** `EnqueueRequest.openEarly?: true`, sent by the add-by-URL route and the upload
   route (`src/routes.ts`) and by nothing else. `enqueue` marks the `structure` step
   `headingsFirst` only when the allocation **minted** the slug. `retryJob` carries the mark.
3. **The step.** `StepContext.headingsFirst` comes from the step. `STEPS.structure.run` passes
   `headingsOnly` to `generateStructure` when it is set **and** `!(await store.hasEarlierBlocks(slug))`.
   `generateStructure` then returns its existing `fromHeadings` result at once, with source
   `{ by: "headings", reason: "before-structure" }` and the tree marked `"awaiting-structure"`; under
   four body blocks it carries on to the model.
4. **Not done while awaiting.** `STEPS.structure.isDone`.
5. **The publication** (`publishRevisionIn`), with `awaiting = tree.provisional === "awaiting-structure"`:
   - `awaiting` → `enqueueSuccessorIn({ steps: ["structure"] })`, and neither `labels` nor the main modes;
   - the main modes also fire when `fenced`, not a reset, and the revision being replaced was awaiting
     while this one is not. One extra read of the previous revision's `tree->>'provisional'`.
   A later publication that still carries an awaiting tree (only `assets` can, see the gate) queues
   the structure job again; the work key de-duplicates a live one. That is the way back after a
   failure that nobody retried, and it is deliberate.
6. **The gate.** In the job walk (`src/jobs.ts`), before a step runs: a step after `structure` in
   `STEP_ORDER`, other than `assets`, fails as `blocked` when the draft's tree is awaiting.
7. **Log line**: `logPublication` says when it queued the structure job.

**The way back if this misbehaves in production:** the two routes stop sending `openEarly`. One line
each; everything else is inert without it.

## Stage 2: the open page

1. **`useLateStructure(slug, article)`** (new, `src/web/article/`), used where `ArticlePage` hands an
   owned article to the reader. If the tree is not awaiting it returns the article untouched.
   Otherwise, once the jobs list has been read and shows no queued or running job with a
   `structure` step for this slug, it fetches the article once. A real tree over the same block ids
   → it returns the held article with the fetched `tree`, `navLabelStatus` and `arc`. Still
   awaiting → `stalled`. It asks again each time a structure job for the slug comes and goes.
   The late tree is held beside the article, not written into it, so the images' second draw
   landing afterwards cannot put the stand-in back.
2. **The Structure band** says, above the headings: *The structure is still being built. These are
   the article's own headings.* When `stalled`: *The structure could not be built.* and a **Build it**
   button that posts `{ slug, steps: ["structure"] }` through `useStepJob`. Copy in `src/messages.ts`.
3. **`useArc`** waits.

## How this fits `read-while-importing`

That session is spiking draft prose on the **add page** during an import, read from the job's draft
blocks. The two agreed a boundary on 2026-10-05: the add page and what it shows are theirs; the
worker, the publication point and the reading view are this plan's. They cover **the same window**
(after `blocks`), so with this plan landed theirs has under a second to fill on a web page, and
still has a PDF's 49 s of figure recovery. Greg picks whether both are wanted. Their hand-over
signal is the job ending `done`, which this plan moves earlier and does not otherwise change.

## Tests, red first

- **Step**: with `headingsFirst` and no earlier blocks, no model call, tree is awaiting; with earlier
  blocks, the model is called; under four blocks, the model is called.
- **`isDone`**: an awaiting tree with a finished run is not done. Mutation: return true, see the
  successor skip.
- **Publication**, real Postgres, beside `publication-enqueues-the-labels-successor.test.ts`: an
  awaiting first publication queues exactly one `["structure"]` job and no `labels` or mode job; the
  structure job's publication queues `labels` and the modes; a plain import (no `openEarly`) is
  exactly as today.
- **Enqueue**: `openEarly` on an adopted slug marks nothing; a retry keeps the mark.
- **Gate**: `glossary` on an awaiting tree ends `blocked`; `assets` runs.
- **End to end through the queue** with the fake model: add with `openEarly` → published and
  awaiting → drive the successor → real tree, labels queued.
- **Client** (`*.test.tsx`): awaiting article, jobs list shows a running structure job → no fetch;
  the job goes → one fetch, the returned article has the new tree and the **same `blocks` array**;
  fetch returns awaiting → `stalled`; different block ids → untouched.

## Browser check (Sonnet subagent, Playwright, local stack)

At 1280 and 390: paste a web address, time paste-to-open, see the note in Structure, see the tree
arrive with no reload (a marker on `window` survives), scroll place unchanged, Diagram and Structure
open across the swap; then the modes start. Import a PDF and check the same. Stop the structure job
mid-run and see *Build it* work.

## Docs in the same stages

`ingest-queue.md` (the mark, the successor, the gate), `structure-step.md` (the second meaning of
`provisional`), `architecture.md` (one line under the pipeline), `structure.md` (the note and the
swap), `web-client.md` if the hook is shared code, 261004e (Greg's answer, and that A was built),
261004l's last section (the no-blank re-read was not needed for this).

## Review record

**GPT Sol on the plan** (base 03144f563, read-only, exit 0, answer written 17:30 on 2026-10-05):
[plan-review-sol](261005j-open-before-structure-plan-review-sol.md). Verdict *build with changes*,
ten findings. The server design held: the publication chain, the step JSON round-trip, the successor
really running, billing. Each finding was checked against the code it names; what changes:

| | Finding | What the build does |
|---|---|---|
| F1 | Diagram keeps hover and roving state across a tree change, and a held hover stops it following the reader | Diagram clears them when the tree is replaced; Outline resets its focused row the same way. Tested with a hover held across the swap. |
| F2 | "The jobs list has been read" can be an old list from before this article existed, so *could not be built* could be said while the job is running | The hook decides only on a list read **after** the awaiting article arrived (`jobEngine` § `afterFreshList`, with a poke), and keeps the engine polling while it waits. |
| F3 | Re-queuing `structure` at a later awaiting publication can join a holder bound to an older draft, which cannot publish | Not described as recovery any more. That holder ends, the level check then finds nothing running, and the band offers **Build it**. |
| F4 | Queue order is by creation time, so a mode stamped earlier than the successor meets the gate and ends `blocked`, which has no Retry | The promise is narrowed: modes *normally* wait. The gate's sentence says what to do: build the structure from the Structure band, then run this again. |
| F5 | Same block ids do not prove the same blocks (a concurrent Rebuild re-classifies) | The swap compares each block's id, kind, tag, level, text, `gistable`, role and treatment, in order; fetches directly, never from the prefetch; and ignores an answer for a slug or request that has been superseded. |
| F6 | *"These are the article's own headings"* is false where the builder cut windows | The line is *This is a temporary outline while the structure is being built.* |
| F7 | A new headings reason falls into the step's *"a section was too long to label"* detail (`src/pipeline.ts`) | An explicit arm, and the reason handled exhaustively. |
| F8 | Swapping `arc` in the payload does not move `useArc`'s own state | `arc` is not swapped. `useArc` does not post while the tree is awaiting, without spending its once-guard, and runs as it does on any open once the real tree is in. |
| F9 | Arrow-key navigation keeps the stand-in's depth | The aim is re-validated when the tree is replaced. |
| F10 | The Structure band is shared with visitors, who must not get a job subscription | **Build it** is an owner-only capability handed in; a visitor gets the line and nothing else. |

Also corrected: *only `assets` can publish an awaiting tree* was wrong; a standalone `fetch` or
`extract` can too. Re-queuing there is harmless. The gate runs inside the step's protected failure
path, so the job settles as `blocked`.

Not taken: hiding the outline on a headingless article until the real one arrives (F6's second
half). The tree does not record that it is all windows, and the line above the rows already says it
is temporary. Revisit if the browser check shows it reads badly.

Sol's answer to *is there a simpler design*: the add-page route (`read-while-importing`) is the
credible one, because it needs none of this protocol. Greg picks between them, or keeps both.
