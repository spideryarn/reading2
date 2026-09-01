# ToC on request, and the tree that costs nothing

**Status: reviewed, STOPPED, being recut. Do not build the stages below as they stand.** Written
2026-08-31; [GPT Sol's review](260831ah-toc-on-request-and-the-tree-that-costs-nothing-review-sol.md)
came back *"STOP. Do not build the stages as written"* with ten P0s and three P1s. **The premise
survived and the protocol did not** — see § *What the review changed*, which is the part to read
first, and which contradicts several sentences below that have deliberately been left standing so the
correction has something to point at.

## The job

Greg, 2026-08-30, the ask this and [260831b](260831b-finish-the-database-move.md) both came from:

> We want to be able to ingest multiple articles at the same time, to completely finish the move
> from files to database 100%, and to finish working on things so that the ingest finishes faster,
> perhaps moving the ToC-generation into a post-ingestion-queue step that happens when we open the
> doc, and/or for the ToC-generation to happen progressively or in parallel or with
> medium-thinking-level to reduce latency.

He ordered it **latency first**. Concurrency went to [260830ar](260830ar-several-articles-at-once.md)
and the database move to [260831b](260831b-finish-the-database-move.md). This plan is the latency
half, and a year of evenings has not moved the number it is about.

## The number

Measured, from [260830am](260830am-faster-ingest-and-concurrency.md) and
[`src/jobs.ts`](../../src/jobs.ts) § `STEP_BUDGET_MS`:

```
  fetch     ~10s  (guess)   ██
  extract    ~5s  (guess)   █
  blocks     ~5s  (guess)   █
  toc      320.4s  MEASURED ████████████████████████████████████████████████████████████████
  assets     7.1s  measured █
```

Inside `toc`, the structure call is **163.1s — 88%** of it. One model call is most of the time a
reader spends watching a progress panel, and it buys a thing the default reading mode does not draw.

## What changed since the last plan, and why this one is different

[260830am](260830am-faster-ingest-and-concurrency.md) proposed publishing a free heading tree, letting
the reader in at ~20s, and **then running the real ToC in the background and swapping it under them.**
GPT Sol reviewed it and opened with *"STOP. Do not build this plan as written"* — six P0s, most of
them about the swap: the crash window between the two publications, the paid-work gate, `summary`'s
blocks-only freshness key going permanently stale against a preview tree, and a scroll anchor that
does not survive a tree replacement "by construction". Stage 1 landed. **Stages 2 and 3, the part a
reader can see, were never built.**

**Then Plain mode shipped** ([plain-mode-and-the-way-out.md](plain-mode-and-the-way-out.md),
2026-08-31) and [`src/modes.ts`](../../src/modes.ts) became `DEFAULT_MODE = "plain"` — *"the article
and nothing else — no band, and no gist columns either."* Every reader now lands somewhere that draws
none of what the 320 seconds bought.

That is the whole argument for this plan. **If nobody is looking at the tree when the article opens,
do not buy one when the article opens.** The background swap was complicated because it raced the
reader; there is no race if the call does not start until the reader asks.

## The shape of the answer

1. **`toc` leaves `DEFAULT_INGEST_STEPS`** ([`src/pipeline.ts`](../../src/pipeline.ts):217), the way
   `arc` already left it in [260829f](260829f-defer-arc-and-rename-hierarchy.md).
2. **The `blocks` step publishes a tree built from the author's own headings** —
   [`src/heading-tree.ts`](../../src/heading-tree.ts), which exists, is tested, and is wired to
   nothing. It costs no model call and carries `provisional: "headings"`
   ([`src/types.ts`](../../src/types.ts):212).
3. **A tree-less article becomes a real state**, not a failure — the contract change below.
4. **Opening Hierarchy, or any mode that needs gists, starts the `toc` job** and shows an honest
   building state until it lands. When it lands, the tree is replaced whole and the mode fills in.

Ingest becomes `fetch + extract + blocks + assets` — **~27 seconds against ~350.**

### Why the fallback is nearly free, which is the fact that makes this cheap

`toc` today produces `["tree", "labels", "blocks"]` ([`src/pipeline.ts`](../../src/pipeline.ts):1663)
and the seven article-reading stages read *its* blocks, not the `blocks` step's
([`src/article-input.ts`](../../src/article-input.ts) § `tryReadArticle`). That looks like a blocker
and is not.

**Both artefacts are produced by the same function, from the same array.** The `blocks` step returns
`blocksArtefact(run.blocks)` ([`src/pipeline.ts`](../../src/pipeline.ts):1644); `toc` reads that
artefact at :1710 and returns `blocksArtefact(blocks)` over it
([`src/toc.ts`](../../src/hierarchy.ts):1469). `blocksArtefact`
([`src/blocks.ts`](../../src/blocks.ts):1230) is sanitise-plus-stamp, and its comment at
[`src/pipeline.ts`](../../src/pipeline.ts):1637 says so outright — *"Every writer of this artefact
goes through it — stage 3 here, stage 4 in src/toc.ts, the Postgres export."* **So `toc`'s copy is
the `blocks` step's copy, sanitised a second time. Ids are minted in stage 3 and `toc` does not touch
them.** An article with no `toc` run is not a contentless article, and not an unsanitised one: it is
the same prose, carrying the same stamp, missing only the tree.

The one gap left in that argument is whether `sanitizeStoredBlocks` is **idempotent** — `toc` cleans
blocks that stage 3 already cleaned, and today nobody depends on the second pass being a no-op. Under
this plan the reading view may serve either copy, so it becomes load-bearing that they are equal.

**This must be proven before anything is built on it**, because it is the single assumption the plan
rests on: a test that `blocksArtefact` applied twice equals `blocksArtefact` applied once, over a
corpus with the awkward cases in it, and that the blocks `toc` returns match the ones it was given in
content and id order. If that is ever false, the fallback silently serves different prose from the one
the ids were minted against — the [block-ids.md](../project/block-ids.md) contract, broken quietly.
See § *Verification*.

### What the reader sees when they ask for a mode that needs a tree

Greg, 2026-08-31, offered two answers and asked for the cheaper:

> And if the user clicks to the Hierarchy mode (or any other mode that depends on it having run)?
> 1 Mark those modes as disabled with explanatory tooltip? 2 Or better still, allow the user to enter
> those modes, show what we have so far, and keep updating as new hierarchy emerges. While 2 sounds
> ideal, it sounds much more complex, so I'm fine with 1 for now, or some other simpler v1.

**We propose the "other simpler v1", and it is nearer to 2 than to 1 because the machinery already
exists.** [`src/web/useArc.ts`](../../src/web/useArc.ts):135-148 is the precedent, built for exactly
this shape: when the artefact is `absent`, start the step's job once per slug, and let
`useStepJob(slug, "arc", load)` refetch when it finishes. Pointed at `toc` this gives: the reader
enters Hierarchy, the job starts, the mode says what it is doing, and the tree appears when it is
ready. **No mode is disabled and no tooltip has to apologise.**

What we are *not* building is the streaming half of Greg's option 2 — a tree that fills in level by
level as the model emits it. The structure call returns all levels in one response, so "what we have
so far" would mean re-architecting generation (§ *Progressive generation*), not just the view. The
reader gets a heading tree immediately and the real tree when it lands; between those two there is
nothing truthful to show that is not already on screen.

**The one thing that must be honest** is which tree you are looking at. `provisional: "headings"` is
already the load-bearing marker ([`src/heading-tree.ts`](../../src/heading-tree.ts):87), and the rule
[260830ak](260830ak-toc-repairs-and-heading-tree.md) set stands: no gists above the leaf, no nav
labels on leaf rows, because a heading tree has neither and inventing them is the failure this whole
area keeps having.

## The contract that has to loosen, and why it is first

[`src/article-input.ts`](../../src/article-input.ts):41 says:

> The blocks and the tree are not optional: a stage with neither has nothing to be about.

`readArticle` throws `run the toc step first`. That sentence is correct today and wrong under this
plan: a tree-less article is now the *ordinary* state of a freshly ingested piece. `tree` becomes
`Tree | null`, and each of the seven stages says what it does without one — most of them refuse
politely and wait to be asked again, which is what `tryReadArticle` returning `null` already means at
a `stamp` call site.

**This is stage 1 and it goes first on purpose.** It is the one file this plan and
[260831b](260831b-finish-the-database-move.md) both have to have, and 260831b calls it *"the shortest
statement of what this migration is about"*. Landing it while those files are clean, before 260831b's
stage 2.5 begins, is the agreed sequencing — see § *Harmonising with the database move*.

## Stages

**Stage 1 — the contract.** `Article.tree` becomes nullable; the seven stages and the public payload
learn the state. Prove the blocks-copy claim above. No behaviour change: `toc` still runs in the
default ingest, so nothing a reader can see moves. **Deployable and invisible**, which is the property
260830am's review said stage 2 lacked.

**Stage 2 — the free tree.** `blocks` publishes a `provisional: "headings"` tree. `toc` leaves
`DEFAULT_INGEST_STEPS` and joins `FORCE_ONLY_WHEN_NAMED`. The real `toc` still replaces the tree whole
when it runs, and the publication path proves which of the two it is holding rather than inferring it
from absent gists — [`src/tree-invariants.ts`](../../src/tree-invariants.ts):267 already warns that
reading "provisional" off missing gists is the trap.

**Stage 3 — the reader asks.** `AddPage` stops gating on whole-job-done
([`src/web/AddPage.tsx`](../../src/web/AddPage.tsx):176). Hierarchy and the gist-consuming modes start
the `toc` job on entry via the `useArc` shape. Checked in a real browser in a subagent, because a
green suite is not evidence a reader can see it.

**Stage 4 — the paid-work gate.** Server-side refusal of tree-consuming steps against a provisional
tree, and `summary`'s blocks-only freshness key taught about the tree or refused. This is P0 #5 from
the 260830am review and it does not stop being true here; it is smaller, because a provisional tree is
now a durable state with a marker rather than a brief window between two publications.

## What the review changed

[GPT Sol](260831ah-toc-on-request-and-the-tree-that-costs-nothing-review-sol.md), 2026-08-31, at
`high`. **STOP**, ten P0s, three P1s. Each was checked against the code before being written down here;
the two that most change the plan were verified independently and both hold.

**The premise survived, and it was tested harder than we tested it.** Sol confirmed `toc` changes no
block text, id, order, role or treatment, traced `sanitize.ts`:147 to show the second clean can only
rewrite `block.html`, and then **re-applied `blocksArtefact` to all 21 current `output/*.blocks.json`
and found none changed.** That is the idempotence question answered empirically rather than argued.
Its one correction: `hashBlocks` ignores HTML ([`src/source-hash.ts`](../../src/source-hash.ts):112),
so the source-hash assertion this plan proposed **cannot prove byte identity** and stage 1 needs a
separate exact-idempotence pin.

**The good news first, because it makes the plan smaller.**

- **Stage 3's `AddPage` change is unnecessary — do not make it.** Once `toc` leaves the default steps,
  `job.status === "done"` *already* fires at ~27 seconds. The plan proposed replacing a gate that will
  start doing the right thing on its own, and doing so opens a navigation race with no atomic
  "readable revision published" signal behind it. **Finding 6, and it deletes work.**
- Of 260830am's six earlier P0s, the crash window between two publications is genuinely dissolved,
  because a provisional article is now a successful state rather than a half-finished one.

**What actually blocks it**, in the order it has to be fixed:

1. **`assets` breaks the moment `toc` leaves the default list.** It reads `(toc, blocks)` for both its
   input hash ([`src/pipeline.ts`](../../src/pipeline.ts):868) and its run (:1861). Postgres maps
   `(blocks, blocks)` and `(toc, blocks)` onto the same rows so this hides there — but
   [`artifacts-fs.ts`](../../src/store/artifacts-fs.ts):133 keeps them distinct, and **this plan
   deliberately lands before the flip**, so it breaks the ordinary ingest on day one. Both must move
   to the canonical block-stage artefact. Finding 1.
2. **"`blocks` publishes a tree" is not a protocol.** `checkProduct`
   ([`src/store/session.ts`](../../src/store/session.ts):357) rejects a product the step does not
   declare, and Postgres publication refuses any revision without a completed real `toc`
   ([`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts):1175). A provisional publisher has to
   exist explicitly, prove the candidate equals `buildHeadingTree` of the stored blocks, and **not**
   manufacture a completed `toc`. Findings 2 and 11.
3. **A carried `toc` receipt can suppress the real ToC for ever.** `toc` has no freshness stamp,
   `stepIsDone` trusts completed outputs, and a new draft copies completed step-run rows from the
   published revision (`pg-revisions.ts`:668). So a provisional tree written over a draft carrying an
   old `toc` receipt makes the later unforced job *skip*. This is 260830am's finding 2 wearing a new
   costume, exactly as this plan predicted, and it is worse here because the provisional state is
   durable. Finding 3.
4. **The paid-work gate is two stages too late.** `useArc` auto-starts on every owner article
   ([`src/web/useArc.ts`](../../src/web/useArc.ts):126) **including in Plain mode**, so publishing a
   provisional tree immediately buys an arc against it — defeating the whole spend premise. Worse, one
   job per slug means that arc can 409 the reader's own ToC request
   ([`src/jobs.ts`](../../src/jobs.ts):1639). **The gate must precede provisional publication, not
   follow it.** Finding 5, and it moves stage 4 to the front.
5. **Re-ingest is internally contradictory as specified.** Refresh forces from `fetch` with the default
   list; with `toc` absent, publishing means downgrading a real tree, keeping it means it describes
   the wrong blocks, and refusing means the 350 seconds are back. Needs a stated policy — most likely
   retain the published revision until a ToC finishes. Finding 4.
6. **PDFs cannot keep today's behaviour**, because steps are fixed at enqueue from a static list
   before extraction knows whether there are headings (`jobs.ts`:1544). The anti-goal below is
   therefore **not implementable as written**: either accept the durable flat tree
   ([`src/heading-tree.ts`](../../src/heading-tree.ts):280 already builds one) or add conditional step
   injection. Finding 8.
7. **`useArc` cannot be copied wholesale for the swap.** `useStepJob` can fire a callback, but
   `useArticleAccess` ([`src/web/App.tsx`](../../src/web/App.tsx):426) has no reload seam and refetches
   only on slug or identity change — so a finished ToC can leave the reader on the old tree
   indefinitely. And the scroll hazard is real: `useReadingPosition` (:946) can overwrite `at` with
   whatever block lands on the old pixel. Finding 7. **The `useArc` shape is right for *triggering* and
   insufficient for *replacing*, and this plan conflated the two.**

**Stage 1 was scoped wrong, and this is the correction that matters most for
[260831b](260831b-finish-the-database-move.md).** Do **not** make the public `Article.tree` nullable.
The reader builds geometry from it unconditionally even in Plain mode (`App.tsx`:1132), and both
database readers refuse a tree-less revision deliberately (`pg.ts`:1786,
[`public-reader.ts`](../../src/store/public-reader.ts):438). Since every published article is meant to
carry a provisional tree atomically, a tree-less state should stay **internal to drafts** and be
modelled at the stage-input seam only. Broad nullability *"either does nothing, because publication
continues refusing it, or introduces a client-crashing state"*. Finding 10.

**Two corrections of fact.** The seven article-reading stages are `arc`, `tweets`, `glossary`,
`ideas`, `quotes`, `timeline` and `sketch` — **`summary` is not one of them**, having left in stage 5e
of [260831s](260831s-gist-only-summaries.md); Summary reads tree gists instead, so the freshness worry
this plan inherited from 260830am is aimed at a stage that no longer exists. The paid tree-consumer it
*did* miss is **`POST /api/similar`** ([`src/routes.ts`](../../src/routes.ts):4344), which must join
the gate. Finding 13.

**And the visitor hole is worse than "a less good tree".** The client does not branch on
`tree.provisional` at all, despite [`src/public/dto.ts`](../../src/public/dto.ts):257 claiming it does:
Hierarchy renders every gistless internal node as a leaf
([`src/web/TableView.tsx`](../../src/web/TableView.tsx):854) and Summary says *"No summary for this
section"* ([`src/web/SummaryPanel.tsx`](../../src/web/SummaryPanel.tsx):437) — while visitor policy
declares all three modes available ([`src/web/visitor.ts`](../../src/web/visitor.ts):188). **A visitor
cannot start a job, so these are permanently misleading modes, not degraded ones.** That converts the
risk below from "may grate" into a decision Greg has to take before stage 3. Finding 12.

### What this means for the shape of the work

The idea is intact and the sequencing is not. The order the review implies is: **the paid-work gate
first**, then the provisional publication protocol with its own step and its own proof, then the
`assets` input fix, and only then the reader half — of which the `AddPage` change is deleted outright
and the swap is a bigger piece than "copy `useArc`". Stage 1 shrinks to the stage-input seam plus an
exact-idempotence test. **None of this is written up as revised stages yet**, and it should not be
built until it is.

## The simpler option passed over

**Leave `toc` in the ingest and only make it faster** — `medium` is already the effort
([`src/toc.ts`](../../src/hierarchy.ts):100, forced down twice after truncation bugs), so the remaining
levers are prompt size and the structure/label split, which
[260826h](260826h-toc-scaling.md) already took. The split moved the constitution from 421s to ~370s
and put the **cost up ~26%**. There is no version of this that gets 320 seconds to 20, and the reader
is waiting for something the default mode does not draw. Rejected on the arithmetic.

**Progressive generation** — Alternative D of [260826h](260826h-toc-scaling.md): outline first, then
parallel subtree calls. Deferred there with a rule we should keep: *"Past [125k words] it stops being
optional and becomes the design. The trigger is a real text, not a milestone."* No article has hit it.
It is also strictly harder than this plan and does not remove the wait, only shortens it. **If this
plan lands, progressive generation stops being about latency at all** — it becomes about the ceiling,
which is the honest reason to build it later.

## Harmonising with the database move

Two branches of one ask, sharing four files. The note is in
[260831b](260831b-finish-the-database-move.md) § before *Why now*.

| File | Them | Us |
|---|---|---|
| `src/article-input.ts` | the seam all seven stages share | `tree` becomes nullable — **stage 1, first** |
| `src/pipeline.ts` | `STEPS`, `LEGACY_UNCONVERTED_STEPS` | `DEFAULT_INGEST_STEPS`, the `toc` registration |
| `src/jobs.ts` | `claimSession` — the line the flip changes | on-demand `toc` job start |
| `src/toc.ts` / `src/labels.ts` | converted to return `parts` in stage 2b | unchanged by this plan, deliberately |

**`src/jobs.ts` is one agent at a time** — their rule, and it binds us equally.

**~~One thing 260831b should get for free.~~ Wrong, and corrected in their plan.** This said `LEASE_MS`
could shrink from 760s because the claim would now cover ~27 seconds of work. **An on-demand `toc` is
still a job on the same claim machinery with the same 320.4s budget**, so a lease sized for a
27-second ingest would self-abort the one call the reader is waiting for. Sol's finding 9. The
sentence is kept struck through rather than deleted because it was written into
[260831b](260831b-finish-the-database-move.md) before the review, and a deleted mistake is one a
reader of that plan cannot check against.

## Anti-goals

- **Not** a streaming, level-by-level tree in the view. Named above; it is a generation change.
- **Not** touching `src/toc.ts`'s generation, repairs or coverage floor. This plan changes *when* the
  step runs, not what it does. Every finding of [260830ak](260830ak-toc-repairs-and-heading-tree.md)
  stands untouched.
- **Not** the flat-tree fallback for headingless articles (PDFs get no headings, so no free tree).
  They keep today's behaviour — `toc` in their ingest — until somebody decides otherwise. Greg's call,
  left open in 260830ak and still open.

## Risks

- **The blocks-copy assumption.** Named above, tested in stage 1, and the only silent-corruption path
  here. If it is false the plan does not shrink, it stops.
- **Block-id re-minting on a resumed job.** 260830am flagged `previousBlocksFrom` reading a job-scoped
  `/tmp` baseline as a live hazard. It is *less* dangerous here — no preview publication to comment
  against — but it is the same contract, and 260831b's flip is what actually closes it. Check its
  status before stage 3, do not re-derive it.
- **A visitor cannot start a job.** Deferring `arc` already left signed-out visitors a permanent
  fallback ([`src/pipeline.ts`](../../src/pipeline.ts):210-216, pinned by `tests/visitor-gaps.test.ts`).
  Deferring `toc` makes that same hole wider: a visitor to a never-opened article sees a heading tree
  for ever. **Greg accepted the arc version as "the smallest scope" and flagged it as something that
  may grate. This makes it grate more, and it is a decision to take deliberately, not to inherit.**

## Verification

- The blocks-copy and idempotence tests above, run as mutations: change one block's text in `toc`'s
  returned copy, and separately make `sanitizeStoredBlocks` non-idempotent, and watch each go red.
  [silent-success.md](../reusable/silent-success.md).
- An ingest that publishes a readable article with no `toc` run, proven from the database.
- A test that the real `toc`, when it runs, still replaces the tree whole — **it must not be skipped
  because a provisional tree is present.** This is 260830am's finding 2 in a new costume and it is the
  one that would silently ship a heading tree as the final answer.
- A test that a re-ingest never downgrades a finished article's real tree to a provisional one.
- End to end in a real browser, in a subagent: paste a URL, land in Plain in ~30s, open Hierarchy,
  watch it build and fill in without losing your place.

## Two stale lines found while writing this

[hierarchy.md](../project/hierarchy.md):451-452 says effort *"went back to `high`"*
and `COVERAGE_FLOOR` *"went from 0.95 to 1"*. Neither is true: [`src/toc.ts`](../../src/hierarchy.ts):100 is
`medium` and [`src/labels.ts`](../../src/labels.ts):1871 is `0.95`. Both were correct when written and
were overtaken by `fb82dc8` and by stage 1 of 260830am. Fix them with stage 1 of this plan, in the
same commit as anything else that touches that doc.
