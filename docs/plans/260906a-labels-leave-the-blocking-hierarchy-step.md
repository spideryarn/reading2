# The labels leave the blocking step

**Status: stage 1 landed and reviewed; the stamp question settled ([below](#two-steps-one-stamp)); stage 2 building.** Written 2026-09-06, out of
[260904d](260904d-deepen-fat-sections.md) § *Question 5*, where a measured run found that the thing
blowing the ingest deadline was not the feature that plan was building.

## The ask

Greg, 2026-09-06:

> Do we need the labels? What do we use them for? Can we generate them lazily? I'm willing to make
> product changes if it will dramatically simplify things.

and then, having heard the answer:

> Get input from GPT Sol re how best to make the labels lazy-loaded, then proceed autonomously.

So the decision is taken: **the nav labels stop being generated inside the blocking ingest
`hierarchy` step.** This plan is about *how*, not *whether*.

## The number this exists for

The `hierarchy` step has a **740 s effective claim deadline** (`LEASE_MS = 760_000` minus
`DEADLINE_MARGIN_MS = 20_000`, [`src/jobs.ts`](../../src/jobs.ts)), and
`DEFAULT_JOB_CONCURRENCY = 3`.

Three passes over Moby-Dick (2,569 blocks), 2026-09-05, from `byAiJob` in
`evals/results/deepen-5b-2026-09-05-e5aq8o9s/run.json` against the step durations in
[260904d § What stage 5b actually measured](260904d-deepen-fat-sections.md#stage-5b-results):

| job | `hierarchy` step | cascade: calls / $ / wall / concurrency | labels: calls / $ / wall / concurrency | labels % of wall | labels % of $ |
|---|---|---|---|---|---|
| `spya-wcb7kq` | 574.5 s | 9 / $1.691 / 112.3 s / 2.15× | 26 / $1.794 / 456.8 s / 2.07× | **79.5%** | 51.5% |
| `spya-avuffm` | 516.2 s | 8 / $0.736 / 40.6 s / 4.45× | 26 / $1.800 / 468.4 s / 2.07× | **90.7%** | 71.0% |
| `spya-fm4y2w` | **overran 740 s** | 9 / $0.821 / 53.2 s / 4.10× | 30 / $2.135 / 682.4 s / 1.79× | **≥92%** | 72.2% |

"Concurrency" is `summedDurationMs / wallClockMs`; `CONCURRENCY = 4` in
[`src/labels.ts`](../../src/labels.ts), starting at 1 and widened after the first batch returns.

**Labels dominate the step's wall clock.** On the third pass the label pass alone (682 s) would have
blown the deadline with the cascade contributing nothing. The deepening cascade — the feature 260904d
was built to add — made it worse only *indirectly*, by re-cutting the batch plan from 26 to 30.

⟨An earlier note in this session said the cascade ran at ~10× concurrency against labels' 2.3×. That
was wrong; the table above is recomputed from `run.json` and the cascade runs at 2.15–4.45×. The
labels-dominate-the-clock conclusion is unchanged and is if anything stronger, because the cascade
has less headroom than it appeared to.⟩

### And inside that, one call is the whole pass <a id="the-straggler"></a>

Measured 2026-09-06 from `spideryarn.ai_calls`, and it is consistent across all three passes:

| pass | label calls | the longest call | its input | the pass | the longest call's share |
|---|---|---|---|---|---|
| `spya-wcb7kq` | 26 | **373 s** | 173,582 tok | 457 s | **82%** |
| `spya-avuffm` | 26 | **390 s** | 173,589 tok | 468 s | **83%** |
| `spya-fm4y2w` | 30 | **602 s** | 173,583 tok | 682 s | **88%** |

The median label call is **21 s** and the next largest input is **30,889** tokens. Everything else
finishes inside 70 s, in parallel.

**The queue is not the problem, and this was measured rather than argued.** Replaying the recorded
per-call durations — first call alone for the cache warm-up, the rest at width *w* — reproduces the
actual wall clock exactly at width 4 (456 s vs 457, 468 vs 468, 682 vs 682), which says
`CONCURRENCY = 4` is being achieved. Widening it barely helps, because the pass is bounded by one
call rather than by queue width:

```
  width  1 -> 1221s      width  6 -> 654s
  width  2 ->  741s      width  8 -> 643s
  width  4 ->  682s      width 12 -> 637s     (job spya-fm4y2w)
```

**The cause is one node.** Walking the stored tree for `evaldeepen-e5aq8o9s-book-spya-yynkqz` (2,714
nodes), the lowest-level sections by child count are:

```
    973 children   n0831  "The Sermon's Lesson Restated"
    191 children   n2010  "Whale Skeleton and Fossil History"
     94 children   n2355  "Log, Life-Buoy, and the Rachel"
      6 sets in total exceed MAX_BATCH = 60
```

A sibling set is indivisible by design — *"Generate siblings together"*, the rule
[`labels.ts`](../../src/labels.ts):45 calls the one that decides whether this works — so `n0831`
becomes a single call asking for **973 labels** with ~173,000 input tokens, which is within 15% of
the model's context ceiling. The structure call had put **38% of Moby-Dick under one heading**.

**Lazy labelling does not remove this call; it moves it.** The 600 s and the ~$1.30 are still spent,
and the request still sits near the context ceiling. Greg chose that deliberately on 2026-09-06, over
the alternative of capping oversized sibling sets first — so the cap is **not** in this plan and the
sibling rule is untouched. What the cap would have bought, and what it would have cost, is in
[§ Alternatives](#alternatives-considered) so the next reader can weigh it rather than rediscover it.

Two things follow that are *not* this plan's business but should not be lost:

- **This is the case [260904d](260904d-deepen-fat-sections.md) exists to fix.** A fat section that
  gets subdivided stops being a 973-child sibling set. The cascade ran on pass 3 and did not reach
  `n0831` — worth knowing which bound stopped it.
- **973 sibling labels cannot be read as a set by any surface we have.** Outline mode draws at most
  8 (`PARAGRAPH_CAP`), the spine at most 5 (`MAX_CHILDREN`). Only the scrolled `Paragraphs` column
  shows them all, and never side by side.

## What a nav label is, so the trade is legible

`navLabel` is **a pointer to prose, never a substitute for it** — the distinction
[granularity-zoom.md](../project/granularity-zoom.md) draws against `gist`, which *is* substitutable
prose. A label's whole job, from [hierarchy.md](../project/hierarchy.md):

> A row's only job is to distinguish itself from its siblings.

It is navigation chrome. **It has no downstream server-side consumer** — not chat, search, glossary,
ideas, notes or diagrams. Surveyed 2026-09-06, it reaches a reader through exactly four surfaces:

| surface | on by default? | how many at once | what happens with no label |
|---|---|---|---|
| spine hover card ([`Spine.tsx`](../../src/web/Spine.tsx):912) | **yes**, but hover-only | ≤ 5 (`MAX_CHILDREN`) | falls to `title`, then `""`; empty rows are filtered out, so the row **disappears** |
| outline mode rung 5 ([`outline.ts`](../../src/web/outline.ts):118) | opt-in mode, current section only | ≤ 8 (`PARAGRAPH_CAP`) | `rowText` returns `null`, **row not drawn** |
| `Paragraphs` column ([`TableView.tsx`](../../src/web/TableView.tsx):985) | opt-in, never auto-fit | whole article in the DOM | `{navLabel ?? title}` → **a visible blank cell** |
| outline mode's leaf column | ~~it *is* the view~~ **unreachable** | — | — |

Default mode is `plain` ([`src/modes.ts`](../../src/modes.ts):179) and draws none of it. Across the
eight articles in `data/`, 853 of 888 depth-3 nodes carry a label (~96%).

**The fourth row of that table was wrong and is struck through above.** The table's own outline mode
— `showText` false, the leaf column as the whole view — cannot be reached: nothing sets that flag any
more, and `?text=0` is rewritten at boot to `?mode=outline`, which is the *band*
([`OutlinePanel.tsx`](../../src/web/OutlinePanel.tsx)) and a different feature.
[browser-testing.md](../project/browser-testing.md) already said so; this survey did not check it, and
stage 1 built a whole arm of the client against a state no reader can be in before a browser found
out. So the `Paragraphs` column reaches a reader by exactly two routes — the pill, and a `?cols=`
naming the leaf depth — and both are opt-in.

**The one visible regression risk is the blank cell**, and [`tree.ts`](../../src/web/tree.ts):161
already documents the hazard — "a run of forty blank leaf cells".

## Why this is safer than the plan that tried it before

[260831ah](260831ah-toc-on-request-and-the-tree-that-costs-nothing.md) proposed deferring the
**whole** `hierarchy`/`toc` step and publishing a free heading tree meanwhile. GPT Sol stopped it
with ten P0s and three P1s, and it is still marked *"STOPPED, being recut"*.

Almost all of those P0s were about the **tree** being absent or provisional: `checkProduct` rejecting
an undeclared product, publication refusing a revision without a real tree, the client not branching
on `tree.provisional`, geometry built from the tree unconditionally even in Plain mode, and a scroll
anchor that cannot survive a tree replacement.

**Deferring only the labels does not create any of those states.** The tree still lands inside the
blocking step, still publishes, still builds geometry, is never provisional. What is deferred is a
field that is *already legal to be absent* — [`tree-invariants.ts`](../../src/tree-invariants.ts):239
warns rather than fails, publish guards
([`pg-revisions.ts`](../../src/store/pg-revisions.ts):1376) count only `problems`, and
[hierarchy.md](../project/hierarchy.md) already says an unlabelled leaf is "tiled by the tree,
rendered verbatim in the reading view, addressable by its id — and invisible in Hierarchy. Nothing is
lost; nothing is duplicated."

Which of 260831ah's findings still bite the narrower change is the first question in the review.

## What stands in the way, found before the review

Five things, each verified against the code.

1. **The freshness stamp for the whole `hierarchy` step is read off `labels.json`.**
   [`artifacts.ts`](../../src/store/artifacts.ts) § `STAMP_SOURCE` has `hierarchy: "labels"`, because
   `tree.json` carries only `version` and `generator` while `labels.json` records `sourceHash` — "the
   only output of stage 4 that can answer *is this still about the current article*". Decoupling
   labels means moving that stamp, and that touches **every published article**.
2. **`mergeLabels` replaces rather than overlays** ([`labels.ts`](../../src/labels.ts):1360, argued at
   :1345). Handed a partial map it wipes every label not in it. Deliberate — mixing this run's labels
   with last week's is the trap it was written against — but it means a deferred or partial run
   cannot simply call it.
3. **Three hard gates live inside stage 4** and would fire on a deferred run:
   `assertEveryBlockLabelled`, `assertInsideCoverageFloor` (`COVERAGE_FLOOR = 0.95`) and
   `checkCoverage` ([`hierarchy.ts`](../../src/hierarchy.ts):636). They have to go somewhere.
4. **`planBatches` assumes the whole tree.** It walks from `tree.rootId`, sorts globally, and ends in
   `assertCoversEveryBlock`. Worse, `renderOutline` puts the **whole article's outline** into every
   batch's prompt *and* into `batchFingerprint`, so a per-section call would show the model less
   context and could never match a whole-tree run's checkpoints in either direction.
5. **Absence is overloaded.** The same missing field would mean "deliberately unlabelled — a
   pull-quote, a caption, a supplement" *and* "not written yet". [`hierarchy.ts`](../../src/hierarchy.ts):2090
   already names this: deferring the labels "needs a state that says 'still arriving' rather than an
   absence that says nothing."

## What we already have that this should reuse

- **`arc` left `DEFAULT_INGEST_STEPS` on 2026-08-29** ([260829f](260829f-defer-arc-and-rename-hierarchy.md)).
  That is the precedent for a step leaving the blocking list, and it is the one that made `useArc`
  possible.
- **[`useStepJob.ts`](../../src/web/useStepJob.ts) has nine callers.** `useArc` is the only one that
  fires on first open rather than on a button, and its docstring (:1–56) is the template: seeded from
  the article payload so the ordinary path costs no request; a **narrow read endpoint** rather than
  refetching `/api/article/:slug`; and mounted in `OwnedReader` so a visitor issues no POST.
- **`generateLabels` already takes a `CheckpointStore` and an `AbortSignal`**, resumes per batch on
  `batchFingerprint`, and reports "N of M sections labelled".
- **[`heading-tree.ts`](../../src/heading-tree.ts):157 already sets `navLabel` on heading leaves from
  the author's own text** — free, no model call. `parseLabels` overwrites heading labels from
  `block.text` today rather than trusting the model, so this is not a new idea, only an unused one.

## The shape being reviewed

Three candidates, and the review is asked to pick one:

- **(A) A separate automatic `labels` step**, out of `DEFAULT_INGEST_STEPS`, run right after
  `hierarchy` under its own claim and lease. The article is readable the moment the tree lands; the
  labels arrive a minute later without anyone asking. No UI trigger, no interactive paid-work state
  machine.
- **(B) True on-demand** — nothing until a reader opens outline mode or the `Paragraphs` column.
- **(C) Hybrid** — automatic for the opening batches, on demand beyond.

**(A) was the working assumption, and the review corrected it to A′** — a successor *job*, because a
step cannot publish before its job ends ([§ What the review changed](#review)). The reasoning below
is what ruled out (B) and (C), and it survives that correction intact.

GPT Sol, on the prior round, was explicit: *"Do not start with
per-group UI-triggered lazy generation"*, because (B) buys duplicate-demand suppression, per-reader
billing policy, retries, partial storage and ~30 s of first-use latency for a saving that only
materialises if most readers never open those surfaces — which nobody has measured. Sol also
established the mechanical objection: `planBatches` packs several sibling sets per request, so
"one sibling group per demand" turns ~30 calls into hundreds, and the honest version of (B) is
"demand selects a preplanned batch", which is most of (A)'s machinery plus a state machine.

## What the review changed <a id="review"></a>

[GPT Sol](../reusable/codex-cli-as-subagent.md), 2026-09-06, at `high`, on the shape rather than on a
diff. Thirteen findings, no unavoidable P0 in the recommended design. **The verdict changed the
shape**, and the two load-bearing findings were checked against the code before being written down
here; both hold.

### It cannot be a later step of the same job — F1

A revision is published on **terminal job success**, not when a step returns.
[`pg-session.ts`](../../src/store/pg-session.ts) says so in its own words: *"**Terminal success.**
Write, validate, finish the step, **publish**, finish the job."* So `labels` as a sixth step in the
ingest job would go on blocking publication exactly as it does today, and candidate (A) as written
does not work.

**The shape is A′: a successor job.** The ingest job finishes and publishes normally, and that same
completion transaction enqueues a free, slug-scoped `{steps: ["labels"]}` job.

### "Automatic background" is the owner's browser — F2

**There is no server worker in production.**
[`jobEngine.ts`](../../src/web/jobEngine.ts): *"On Vercel there is no worker: `pump` in
[`src/jobs.ts`](../../src/jobs.ts) opens with `if (process.env.VERCEL) return`, and the browser is
what calls `POST /api/jobs/:id/advance` once per step."* Recurring polls also stop while the tab is
hidden.

So a successor job runs only while an owner has a tab open. **This is a new failure mode, and it is
worth stating plainly rather than discovering later:** today, if the ingest finishes, the labels are
there. After this change the article publishes a minute earlier, so an owner can close the tab
believing the job is done — and the labels then wait until their next visit.

It is not a reason to stop. The engine already polls every second *"while any job is active, wherever
the reader is"*, so an owner who stays on the site gets them; a missing label is already a legal
state; and the alternative is the deadline overrun we have. But the reader-facing state has to say
*pending* rather than render blanks — which is F8, and is why stage 1 exists.

### The rest, in one line each

| ID | | |
|---|---|---|
| F3 | P1 | Moving the stamp to `tree` without a backfill makes existing revisions unstamped or falsely stale. **Satisfied by not moving it** — see below. |
| F4 | P1 | Existing articles have no `labels` step receipt, so the new scheduler would think every one of them unfinished and **regenerate labels at real cost**. |
| F5 | P1 | A carried labels receipt can suppress the new run against a freshly generated bare tree. Freshness must cover source hash, structure hash, label config **and** that the tree actually holds the map. |
| F6 | P1 | `failed` cannot live on the candidate tree or in job history — failed drafts are not published and terminal jobs are not permanent. It needs durable revision-scoped storage. |
| F7 | P1 | Acceptance stays all-or-nothing. Weakening the three gates could publish a 40%-complete set or destroy existing labels through the replacement merge. |
| F8 | P1 | The client change is bigger than the blank cell: while pending, the **whole paragraph-label layer** must be withheld, or Outline and Paragraphs report accidental absence as article structure. |
| **F9** | **P0** | **The successor must not reserve or consume a second ingestion slot.** A free slug-scoped rerun with no `ingest_event_id`. This is the hard guard. |
| F10 | P1 | Enqueue must be atomic with publication, or a crash leaves a revision saying `pending` with no job to make it ready. |
| F11–13 | P2 | (B)/(C) need a partial-result protocol; a `useArc`-style refresh is unnecessary for a reload-only v1; concurrency, extractive labels and model choice stay out of this piece of work. |

And of [260831ah](260831ah-toc-on-request-and-the-tree-that-costs-nothing.md)'s thirteen findings,
**eight do not bite** the narrower change — including every one about a provisional or absent tree.
The three that do: **3** (a carried receipt suppressing the real run) strongly, **2/11** (the new
step must declare both products, and `ready` must never be trusted ahead of validation), and **9** as
an operational lesson — labels needs its own claim and its own resumable deadline, and enlarging the
original lease is not the fix.

### Where we did not take Sol's route, and the measurement that decided it <a id="stamp-route"></a>

Sol's Q3 answer was to add `sourceHash` to the stored `Tree`, flip
`STAMP_SOURCE.hierarchy` to `"tree"`, and backfill. **Measured against the dev database on
2026-09-06, that flip is far more expensive than it looks, and we are not doing it.**

`stampForStep` ([`artifacts-pg.ts`](../../src/store/artifacts-pg.ts):838) **throws `StampDisagrees`
rather than returning `null`** where the run row and the artefact both record a field and disagree —
deliberately, *"because every caller reads a null stamp as re-run this step, which quietly resolves
the clash in favour of the artefact"* (GPT Sol's own ruling, 2026-08-28). And the two disagree today:
the `hierarchy` run row carries `prompt_version` from the **labels** file while the tree carries
`toc/N`.

```
  row prompt_version   tree.version   revisions   of which current
  labels/1             toc/2               32            13
  labels/1             toc/4                3             1
  (null)               toc/2..5            60            24
```

**14 of 38 live articles** would raise a 409 rather than merely re-run. A backfill of
`labels->>'sourceHash'` into the tree cannot fix that column — it is a second, separate repair over
32 published revisions — and 2 of the 95 tree-bearing revisions have no `sourceHash` to copy at all.

**So the stamp does not move.** `hierarchy` instead writes a fully-stamped `LabelsFile` whose
`labels` map is empty, and `STAMP_SOURCE.hierarchy = "labels"` goes on working untouched — **zero
rows migrated, and no change to `stampFor`, `assertStampAgrees`, `has`, the publish guard, the
carry-forward policy or `articleMetadata`.** Three things make it legal rather than a fudge:

- `SHAPE.labels` is `{ field: "labels", ok: isObject }` ([`artifacts.ts`](../../src/store/artifacts.ts):292),
  and `isObject({})` is true — the check exists to reject `[]`, not `{}`.
- `LabelsFile` **already has a vocabulary for this**: `batches: null` means *"no evidence a run
  happened"*, as against `batches: []` for *"generated by zero calls"* — argued out at
  [`labels.ts`](../../src/labels.ts):455. So the artefact reads, in its own established terms, as a
  manifest whose payload has not arrived. Not a lie; a manifest without its labels.
- Nothing reads the labels *content* outside stage 4. [`pg.ts`](../../src/store/pg.ts):706 files the
  labels column under *"Read by nobody through here"*; the only other readers serialise it for export.

What it concedes is one comment: `STAMP_SOURCE`'s docstring calls `labels.json` *"the only output of
stage 4 that can answer is this still about the current article"*, which stays true of a file that no
longer carries labels — but the sentence should say *manifest*.

**And it introduces one hazard, guarded rather than hoped away.** Two steps would now write the
`labels` column, so a deferred run writing a *different* `sourceHash` would make
`STAMP_SOURCE.hierarchy` answer about the labels run rather than the hierarchy run — hierarchy
reporting itself fresh against blocks it never saw. The labels step therefore refuses to write unless
`hashBlocks(current blocks)` equals the hierarchy run's own `input_hash`, and asks for a re-ingest
instead. Under Sol's route this hazard would not exist, and that is its one genuine advantage; it is
not worth 14 live 409s.

## Stages

Sol's Q7 answer, with its stamp pre-stage deleted for the reason above.

- **Stage 1 — the "still arriving" state.** One revision-scoped enum,
  `NavLabelStatus = "pending" | "ready" | "failed"`, in durable revision-scoped storage rather than on
  the tree — F6: a failure has to outlive the failed draft. `navLabel?: string` on nodes is
  unchanged; what changes is how absence is *read*. The DTO carries the enum only, never a provider
  error. Outline and the `Paragraphs` column become status-aware, so the layer is withheld while
  pending rather than drawn blank (F8). Everything still writes `ready`, so **no behaviour change and
  it ships alone**.
- **Stage 2 — the split.** `labels` becomes its own step with its own `STEP_BUDGET_MS`, its own
  claim and its own resumable deadline. `generateHierarchy` stops calling `generateLabels` and writes
  the **unstamped**-and-empty manifest — see [what the pending manifest carries](#two-steps-one-stamp),
  which is where this bullet was wrong: it omits `version` and `generator` on purpose, so there is no
  stamp on it at all. **And it keeps no free heading labels**, which is the other thing this bullet
  got wrong: `buildHeadingTree` ([`heading-tree.ts`](../../src/heading-tree.ts):157) does mint one per
  heading and has no caller outside `evals/`; `generateHierarchy` uses `buildTree` in
  [`hierarchy.ts`](../../src/hierarchy.ts), which labels nothing it is not handed. A
  structure-only tree carries **no** navigation labels — see `tests/hierarchy-leaves-the-labels.test.ts`.
  `checkCoverage` moves out of
  `generateHierarchy` into the new runner, after the candidate merged tree and before any `ready`
  write; `assertEveryBlockLabelled` and `assertInsideCoverageFloor` stay inside `generateLabels` and
  defer for free with it. Publication atomically enqueues the free successor job (F10), with **no
  `ingest_event_id` and no second slot** (F9). Legacy articles get `labels` receipts so the scheduler
  does not re-buy every one of them (F4). **`mergeLabels` keeps replacement semantics** — it
  correctly removes stale labels after a structure change, and A′ never legitimately hands it a
  partial map (F7).
- **Stage 3 — measure it.** A deterministic test that the ingest job publishes while a deliberately
  delayed label executor is still running, and that partial output never replaces the tree. Step
  timings showing `hierarchy` no longer carries the label wall time. Then, if Greg approves the
  spend, one paid book rerun.

Checkpoint rows survive the split unchanged — `batchFingerprint` contains no step or job identity —
**provided the checkpoint namespace stays `hierarchy-labels`.** Renaming it would invalidate every
stored row and buy the next run nothing. My own guess said the same; the difference is that this one
names the condition under which it stops being true.

## What stage 1 landed <a id="stage1"></a>

Built 2026-09-06. **No behaviour change**: everything writes `ready`, which is what every existing
revision already is.

- **The column.** `article_revisions.nav_label_status`, `text not null default 'ready'` with a CHECK,
  in [`drizzle/20260906070017_nav_label_status.sql`](../../drizzle/20260906070017_nav_label_status.sql).
  Applied to the local database; **222 existing rows all read `ready`**, which is true of them — the
  `hierarchy` step could not finish without producing the labels. Nothing was backfilled and no null
  exists to be read as a fourth state. `revision_step_runs_step` is untouched: this adds no step.
- **The type.** `NavLabelStatus` in [`src/types.ts`](../../src/types.ts), beside a note on
  `TreeNode.navLabel` saying what an absence there does and does not mean.
- **The write, and it is the seam stage 2 edits rather than invents.** `writeArtefacts`
  ([`artifacts-pg.ts`](../../src/store/artifacts-pg.ts)) sets the status in the same `UPDATE` as the
  artefacts whenever a step writes `labels` — keyed on the **artefact**, not on the step's name,
  which is the half stage 2 changes. Atomic with the artefact, so a revision cannot publish saying
  `ready` over labels that did not land.
- **`carry` in `REVISION_CARRY_POLICY`**, beside `tree` and `labels`.
- **Both DTOs**, each with the enum and nothing else — no reason, no provider message.
- **The client**, in [`src/web/nav-labels.ts`](../../src/web/nav-labels.ts): one rule, `=== "ready"`
  so an unrecognised value withholds rather than draws. The `Paragraphs` pill is *replaced by* the
  sentence rather than disabled with it in a tooltip (a touch reader cannot open one); Outline's rung
  5 is simply not climbed, because nobody asked for it.

### The bug a browser found, and the jsdom test that did not

The withheld leaf cell was drawn whenever the status was not `ready`, with no test that the leaf
column was one of the table's columns — and by default it is not. `<colgroup>` allocates one `<col>`
per column plus one for the prose, so the extra `<td>` took the **prose** column's width: `td.text`
came out 0px wide and off the right edge of the window, and **every article's body was invisible** in
the default reading view. Nothing threw, nothing logged, and the jsdom suite was green — it asserted
what the cell contained and never that the row still fitted the table.

Fixed by a `columns.includes(leafDepth)` guard in `withheldLeafCell`, with a case that counts `<td>`s
against `<col>`s ([`tests/paragraph-labels-withheld.test.tsx`](../../tests/paragraph-labels-withheld.test.tsx)),
watched red on the unguarded code. The lesson for stage 2 is the one in
[silent-success.md](../reusable/silent-success.md): a renderer test that only inspects the element it
added cannot see the element it displaced.

### What the stage 1 review found <a id="stage1-review"></a>

GPT Sol, 2026-09-06, at `high`, on the live pre-commit tree, closed against commit `bea197dc`.
**No P0 and no P1 — it would not refuse the stage.** Two P2s, both real when checked and both fixed:

- **F1 — the drift test did not pin what it claimed.** `NavLabelStatus` and `NAV_LABEL_STATUSES`
  were *independent* declarations, and `readonly NavLabelStatus[]` proves only that every value
  listed belongs to the union — never that the list exhausts it. A fourth member added to the union
  and forgotten in the list would have compiled, and the drift test built on that list would then
  have compared the migration against an incomplete set and passed. Worse, the test read only
  `drizzle/` and never the **second** hand-kept CHECK literal in
  [`schema.ts`](../../src/db/schema.ts) — whose own comment already claimed the test compared the
  two. Fixed by deriving the union from an `as const` list, so the two cannot disagree, and by a case
  that reads the `schema.ts` literal as text. Watched red by adding a fourth value to that literal.
- **F2 — a withheld column that was already open could not be closed.** `toggle` in
  [`App.tsx`](../../src/web/App.tsx) is the only caller of `setCols`, so replacing the `Paragraphs`
  pill with the notice removed the only way to *close* the leaf column as well as the only way to
  open it. The column can already be open without the pill — a `?cols=` naming the leaf depth,
  shared or bookmarked — and that reader was left with a wide column of one repeated sentence and
  nothing to shut it with, **for ever if the status is `failed`**. Unreachable through stage 1's
  writes, which is why it is a P2; user-visible the moment stage 2 writes `pending`.

  Fixed by `paragraphPill(status, leafOn)` in [`nav-labels.ts`](../../src/web/nav-labels.ts): the
  notice stands in only while the column is **shut**, which is the case it was written for; once the
  column is open the pill returns, because the column is already carrying the sentence. Extracting it
  from the ternary is what makes it testable at all — Sol's own note was that the existing test
  renders `TableView` directly and so *"cannot catch this integration issue"*.

**Two answers worth keeping.** First, the review is right that *"no behaviour change"* was broader
than the truth: both article JSON responses gain a field, and the reader's export gains
`navLabelStatus: "ready"` through the whole-row `content/revision.json`. Nothing **rendered** changes.

Second, it correctly refused my evidence for the migration: the query I sent reported *statuses*, not
label contents, so it could not establish that all 225 rows actually hold completed labels. I had
measured that separately and after sending the prompt, so it is recorded here instead — grouped by
status and by whether `labels` is null:

```
  published   labels present   ready    94    (39 current)
  draft       labels present   ready     2
  draft       no labels        ready     5
  failed      labels present   ready     4
  failed      no labels        ready   120
```

**Every published revision has its labels**, and reachable false-`ready` — published or current, with
no labels — is **0**. The 125 rows where `ready` is untrue are all failed or draft and none is
current, so the no-backfill decision is measured rather than argued.

**And it independently confirmed the stage 2 trap** I had found in the write seam: artefact presence
cannot remain the discriminator, because both the stamped-empty manifest and the completed one
contain `parts.labels`. Stage 2 needs an explicit producer-to-status decision, *"otherwise any mapped
future writer of `labels` implicitly claims `ready`, exposing incomplete labels as article
structure."*

### Both suite failures were the box, not the change

The full suite came back `2 failed / 737 passed`. Run alone, `tests/step-failure-seam.test.ts` passes
and `tests/admin-store.test.ts` passes (3/3) — the latter had failed on a **20 s timeout** rather
than an assertion, at load average 61.5 on 16 cores. Neither touches this change.
The standing rule held again: on this box, re-run each failure alone before
believing a red batch — [testing.md](../project/testing.md).

## What this deliberately does not fix

Moving the label pass out of the blocking step **moves the cost rather than removing it**: 450–680 s
of wall clock and $1.79–$2.14 per book pass are still bought. Three separate questions, none of them
in this plan's scope unless the review says otherwise:

- **~~The effective-concurrency gap~~** — **settled, and it was not a gap.** The 2.07× figure is
  entirely the one straggler; the replay in [§ one call is the whole pass](#the-straggler) shows
  width 4 achieved exactly. Sol's caution — that an effective figure of 2.07 does not by itself prove
  width 4 is unused, since a serial first call, duration variance and a slow tail can produce it —
  was right, and this is what checking it found.
- **The 973-child sibling set**, which survives this plan intact and is still 82–88% of the label
  pass wherever it lands.
- **Mechanical/extractive labels**, which was Sol's own first recommendation and is the option that
  would delete this machinery rather than move it. Its blocker is that it is unmeasured: in a
  read-only count over four labelled fixtures an unmodified first sentence met the 6–20-word contract
  for only 43–59% of paragraphs. The eval already emits the materials for a blinded sibling test
  (`npm run eval:hierarchy -- … --shuffle`, [`evals/hierarchy-labels.ts`](../../evals/hierarchy-labels.ts):409).
- **A cheaper model for labels.**

## Alternatives considered

- **Raise `CONCURRENCY`.** One line. **Rejected on measurement, not on argument** — the replay in
  [§ one call is the whole pass](#the-straggler) shows width 4 is already achieved and width 12 saves
  under 7%, because the pass is bounded by a single 602-second call. This is the one alternative that
  is now closed rather than deferred.
- **Cap oversized sibling sets, and stop there.** Split a set past `MAX_BATCH` into chunks for the
  *label call only*, leaving the tree alone. Measured to be the largest single lever available: it
  removes 82–88% of the label pass's wall clock and takes the `hierarchy` step from 574 s to roughly
  200 s, which is the deadline overrun gone for one change in `planBatches`. **Greg chose lazy over
  this on 2026-09-06**, having been shown the numbers above. The reason to keep it written down is
  that it is cheap and still available: what it costs is that two paragraphs in the same section
  could get labels written by different calls, which contradicts
  [`labels.ts`](../../src/labels.ts):45 as currently stated — though at 973 siblings no surface we
  have compares the whole set, so the guarantee is already unobservable there. Anyone reviving it
  should rewrite the rule to state its bound rather than break it quietly.
- **Replace model labels with extractive ones.** GPT Sol's preferred answer to the prior question,
  and genuinely the option that removes the most machinery — model calls, concurrency tuning,
  prompt-cache warm-up, shortfall repair, displacement detection, checkpoints, coverage budgets and
  the label/tree freshness coupling all go. Not chosen **because Greg asked for lazy**, and because
  it is unproven; kept alive as the thing the blinded eval could still unlock.
- **Leave it and raise the deadline.** Rejected: `DEFAULT_JOB_CONCURRENCY = 3` means a step that is
  marginal alone is not marginal under load, and the lease exists to stop a wedged job holding a
  claim for ever.

## What stage 2a landed <a id="stage2a"></a>

Built 2026-09-06. **The step exists and nothing enqueues it yet** — that was the stopping point, on
purpose: the tree is green and deployable, and the only visible change is that a freshly ingested
article shows *"Paragraph labels are still arriving"* until somebody runs
`{ steps: ["labels"] }`. Publication-time enqueueing is stage 2b.

- **`LabelsFile` is a discriminated union** — `PendingLabelsFile` (`batches: null`, no `version`, no
  `generator`) and `CompletedLabelsFile` (both required, a real `batches`), in
  [`src/labels.ts`](../../src/labels.ts). The two omitted fields are `?: never`, so the compiler
  refuses the wrong literal; `tests/labels-file-union.test.ts` is the type-level check and
  `npm run typecheck` is what reddens it.
- **`hierarchy` buys no labels.** `generateHierarchy` builds the pending manifest instead of calling
  `generateLabels`; `checkCoverage` moved to the new step; `assertTreeSound` stayed.
- **The store learned the rule**, in `writeArtefacts`
  ([`artifacts-pg.ts`](../../src/store/artifacts-pg.ts)) and keyed on the artefact: a pending
  manifest sets `pending` **and deletes this revision's `labels` receipt**; a real one sets `ready`;
  a `tree` with no manifest beside it is refused.
- **The `labels` step**, after `hierarchy` in `STEP_ORDER`, out of `DEFAULT_INGEST_STEPS` and out of
  `FORCE_ONLY_WHEN_NAMED`, `produces: ["labels", "tree"]`, a `stamp()` and no `isDone`. The
  checkpoint namespace stayed `hierarchy-labels`. `npm run labels -- <slug>` is back.
- **`beginStepRun` clears `prompt_version` and `model`** as well as `input_hash`. Nothing migrated.

### Two things the stage brief had wrong, found by building it <a id="stage2a-corrections"></a>

**The free heading labels do not exist on this path.** The brief said `mergeLabels(structure, {})`
"keeps the author's own heading labels, minted for free at `heading-tree.ts:157`", and the stage
bullet above said the same. `buildHeadingTree` really does mint one per heading — and **it has no
caller outside `evals/`**. `generateHierarchy` uses `buildTree` in
[`hierarchy.ts`](../../src/hierarchy.ts), which sets `navLabel` from the map it is handed and from
nothing else, and `mergeLabels` *deletes* the key wherever the map has none. So a structure-only tree
carries **no** navigation labels at all, and the reader's withheld state covers every paragraph
rather than the ones between headings. `tests/hierarchy-leaves-the-labels.test.ts` states it both
ways, including what `buildHeadingTree` would have produced, so the next person to make this guess
finds the answer rather than the guess.

The merge call stayed anyway, because the invariant worth keeping is
`tree === mergeLabels(structure, labels.labels)` in **both** writers of that column.

**The receipt deletion's real arm is a re-ingest that re-extracts.** The first version of
`tests/labels-receipt-invalidation.test.ts` re-cut the tree over the *same* blocks, and removing the
deletion reddened one case out of seven. `stepIsDone` answered `false` anyway — but for the union's
reason rather than the deletion's: a pending manifest carries no `version` and no `generator`, so the
assembled stamp is missing two of the three fields the step declares and `sameStamp` refuses it. The
deletion's own arm is the *throw*: with a carried row stamped against the old blocks and a fresh
manifest carrying the new hash, `stampForStep` raises `StampDisagrees` rather than answering. Two
block sets later, the mutation reddens three cases and the last of them is that throw.

### What the stage 2a review found <a id="stage2a-review"></a>

GPT Sol, 2026-09-06, at `high`, closed against commit `94b9c32b`. **No P0 and no P1 — it would have
shipped the stage as it stood.** Three P2s, all real when checked and all fixed on 2026-09-07.

- **F2 — the claimed invariant was stronger than the enforced one.** `writeArtefacts` refuses a
  `tree` written with no manifest beside it, and § [Fable's arbitration](#fable-invalidation) says
  that is what makes the next writer of the tree *say what it did to the labels*. But when a manifest
  **was** present the store asked only `batches === null`. It never asked whether a **completed**
  manifest was about the tree it arrived with — so a re-cut tree handed over beside an old
  `CompletedLabelsFile` kept the receipt, set `ready`, and went on reading current, because
  `STEPS.labels.stamp` compares blocks, prompt and model and never structure.

  Closed in [`artifacts-pg.ts`](../../src/store/artifacts-pg.ts), with the other pre-write checks:
  a completed manifest's `structureHash` must equal `structureHash(parts.tree)`.
  Watched red before the guard existed —

  ```
  × a completed manifest about a different tree > is refused, naming what disagreed…
    → promise resolved "undefined" instead of rejecting
  × a completed manifest about a different tree > leaves nothing behind…
    → promise resolved "undefined" instead of rejecting
  ```

  **The review's claim that both writers already agree is true, and was checked rather than
  trusted.** It reduces to one property — `mergeLabels` touches `navLabel` and `structureHash` does
  not hash it — which is now pinned in
  [`tests/labels-batching.test.ts`](../../tests/labels-batching.test.ts) on both of `structureHash`'s
  canonical forms, watched red by adding `navLabel` to the hashed row. `hierarchy`'s half is pinned
  end to end in [`tests/hierarchy-write-guard.test.ts`](../../tests/hierarchy-write-guard.test.ts);
  the `labels` step's half was already pinned, in `generateLabels`'s manifest case.

  **Two corrections the code made to the brief.** First, the check has to be *"where the manifest
  carries a hash"* rather than unconditional: `data/constitution/labels.json` in the committed corpus
  has **no** `sourceHash`, `structureHash` or `structureVersion` at all — it predates all three, and
  it is kept precisely because the publish guard refuses it (§ LEGACY_SLUG in
  [`tests/store-parity.test.ts`](../../tests/store-parity.test.ts)). An unconditional compare would
  have made a fixture the design already handles into a copy that cannot happen. Absent-is-not-a-clash
  is also exactly what `assertStampAgrees` does ten lines above, so the rule is the file's own rather
  than a concession. Second, the check is on `CompletedLabelsFile` alone: a pending manifest deletes
  the receipt, so a stale hash on one has nothing to falsify.

- **F1 — `copyArtefacts` could not copy a legitimately pending article.** The fixture reader lists
  `tree.json` and `labels.json` under **both** `hierarchy` and `labels`, so a pending manifest
  arrived twice: once correctly as `hierarchy`, and once as `labels`, where `writeArtefacts` refuses
  it outright. Because `beginStep`, `write` and `finishStep` are three store calls, the refusal
  landed after the run row was open. Reproduced exactly that way:

  ```
  × copying an article whose labels are still pending > copies the tree once, as hierarchy…
    → Error: labels for "…": the labels step wrote a PENDING manifest (batches: null).
      That would delete the very run row this write is holding.
  × copying an article whose labels are still pending > leaves no half-open labels receipt behind
    → the same throw
  ```

  **Fixed in [`copy-artefacts.ts`](../../src/store/copy-artefacts.ts) rather than in the fixture
  helper**, which was the other option offered. Taking `labels` out of the helper's layout would have
  hidden the state from the copier instead of teaching the copier to carry it: the pending manifest is
  a real article state this stage introduced, any future source can hold it, and the helper's layout
  is honest about what is on disk. So the copier skips the `labels` step when the manifest it would
  copy says the labels have not been bought — keyed on the manifest, the same way the store's rule is.
  The pending manifest still travels, as part of `hierarchy`, where it sets `pending` and deletes the
  destination's receipt.

- **F3 — the registration values were right and only their presence was checked.** A total
  `Record<StepName, …>` asks for a row and never asks what the row says. Four things pinned, each
  where its evidence lives, and each watched red by mutating the value it is about:

  | pinned | where | mutation that reddened it |
  | --- | --- | --- |
  | `STEP_BUDGET_MS.labels` | [`jobs-lease-budget`](../../tests/jobs-lease-budget.test.ts) | `700_000` → `600_000` |
  | `STEP_TIMING.labels` | [`job-state`](../../tests/job-state.test.ts) | the row deleted |
  | `STEP_STORAGE.labels` | [`labels-step-registration`](../../tests/labels-step-registration.test.ts) | the columns renamed |
  | `isCurrent("labels")` | [`store-carry-forward`](../../tests/store-carry-forward.test.ts) | the arm made `return true` |

  Two of the four are the shape rather than one more hand-kept list. `job-state`'s threshold case
  **claimed** to pin every threshold and named two of the four in `STEP_TIMING` plus the fallback, so
  `labels` and `illustrated` could have moved by any amount under a heading saying they could not; it
  is now a `Record<StepName, number>` the compiler asks to be total, checked either side of each
  number. `STEP_STORAGE` is read for **every** step that produces `tree`, derived from `produces`, so
  the deepening wave is inside the claim without editing the file. The two numbers are pinned as
  relationships to their evidence rather than as literals — `STEP_BUDGET_MS.labels` must exceed the
  worst measured pass (682 s) and stay under the claimant's 740 s deadline — so re-tuning is free and
  breaking the pair is not. `isCurrent`'s arm is driven through `articleMetadata` on a real published
  revision, one field of the stamp moved at a time, with the *current* row asserted first so the three
  `false`s cannot be a check that never says yes.

**And one correction to a comment, which the review was right about.** `CompletedLabelsFile.batches`
in [`labels.ts`](../../src/labels.ts) said `example/labels.json` was safe because *"nothing loads
it"*. That is not literally true: five suites copy `example/` and `memoryArtefactsFrom`
([`tests/helpers/memory-artefacts.ts`](../../tests/helpers/memory-artefacts.ts), through
`fixtureArtefacts`) parses the file and plants it as a `LabelsFile` — the artefact shape check is
deliberately shallow, so a `batches: null` carrying a `version` and a `generator` goes through
unremarked. The narrowing the note warns about therefore happens **today**, and is harmless only
because not one of those suites asks the manifest anything but its stamp. The sentence now says no
`src/` reader opens the directory and names the helper that does, since the point of the note is that
the next person can trust it.

## Groundwork for stage 2, established before any code <a id="stage2-groundwork"></a>

Researched 2026-09-06, against the code rather than from memory. Read this before starting stage 2;
several of these reverse an assumption the stages above were written on.

**Merge `origin/dev` before you start, and again before each commit.** Greg, 2026-09-06: *"pull the
latest changes to avoid a big merge conflict at the end"*. Stage 2 touches the step registry, the job
layer and the publication path — all of them shared — so a week-old base is where the expensive
conflict comes from. Fetch and merge; never rebase.

### The P0 is satisfied by omission, not by a guard

**The discriminator is one ternary**, [`routes.ts`](../../src/routes.ts):7927 — `request.url === undefined`
takes the free arm (`queue({})`), anything else goes through `withIngestSlot`. Nothing downstream
re-derives it; the only durable fact is `jobs.ingest_event_id`, and for a slug-scoped rerun it is
null because `EnqueueRequest.ingestEventId` is simply absent. `settleReservation`'s first line is
`if (!ingestEventId) return;`, so a free job settles nothing on every ending.

So **you have to work to charge**, and there are exactly two ways to do it by accident: route the
successor through a body carrying a `url`, or copy the parent's `ingestEventId` onto it. The second
is refused by `jobs_ingest_event_unique` — but it surfaces as *"Too many articles already called X"*
after twenty allocation passes, which is safe and completely unintelligible. **Write the test that
names it.**

Note `Job.url` cannot be asked the billing question: `enqueue` fills it from `urlForSlug(slug)`
([`jobs.ts`](../../src/jobs.ts):3043), so a free rerun's row carries a URL too. That normalisation is
why the wall lives in the route rather than in `enqueue`
([`admission.ts`](../../src/billing/admission.ts):8).

### Enqueueing inside the publication transaction does not exist yet

`tryEnqueue` ([`pg-jobs.ts`](../../src/store/pg-jobs.ts):219) opens `const db = getDb()` and inserts on
the **pool**. It is the only thing in the codebase that inserts a `jobs` row, and the file's
`type Executor = Db | Tx` doctrine (:97) is drawn deliberately around *transitions* — `settleIn` can
pass its transaction to `finishIn` and `releaseStepIn`, and `enqueueOrGet` is pointedly not on that
list. The recorded reason is that `enqueueOrGet` takes a **second pooled connection** and
`DATABASE_POOL_MAX` is 5 — an argument against calling it while holding the billing lock, **not**
against inserting on an executor you already hold.

**There is no precedent for a job spawning a job.** Two production callers of `enqueue` (the routes
and `retryJob`), no post-publication hook of any kind. Stage 2 invents this pattern, so there is no
existing test and no written failure mode to copy.

What it needs is a narrow `enqueueSuccessorIn(tx, …)` of roughly thirty lines rather than threading
`tx` through `enqueue`'s 320. The successor's shape is the simplest one `enqueue` supports:
`reservesName: false`, `urlKey` null, no `ingestEventId`, no `retryOf`. `drive()`/`pump` stays
**outside** the transaction and is a no-op on Vercel anyway. Lock order is already article-then-job
and this adds none.

### "One job per slug" is gone, and the successor is never refused

The index that would have blocked this was **deleted on 2026-09-02** and split three ways
([`schema.ts`](../../src/db/schema.ts):2085), precisely so a second request for one article queues
rather than 409s. The successor is inserted `queued`, so it collides with none of the four surviving
indexes; the only conflict it can hit is `jobs_active_work`, which resolves to `sameWork` — the
dedupe we want. And because the parent's `finishIn` runs in the same transaction as the insert, a
claimant arriving after commit sees no predecessor.

**One thing in our favour that the stages above did not know:** `STEP_BUDGET_MS` is consulted only
for the *next* step after one has finished ([`jobs.ts`](../../src/jobs.ts):2411). The first runnable
step of any claim runs ungated, so a one-step `labels` job **always gets the full 740 s deadline**
whatever number goes in the table. The measured worst case is 682 s. It fits — only just, and only
because it starts its own claim.

### The hand-kept registrations, which are where this will drift

Compiler-enforced and therefore safe: `StepName`, `STEP_ORDER`, `STEPS`, `STEP_BUDGET_MS`,
`STORAGE`, `STEP_STORAGE`, `STAMP_SOURCE`, `STAGE_ICONS`. `labels` is **already** an `ArtifactKind`
and already a `Task`, so no `SHAPE` row, no DTO change, no export line.

The ones nothing checks:

- **The `revision_step_runs_step` CHECK** — a migration plus a hand-copied literal at
  [`schema.ts`](../../src/db/schema.ts):2294. **It has drifted three times.** Its comment currently
  says *"`labels` is deliberately NOT here"*; that sentence becomes false and must be replaced.
- **`FORCE_ONLY_WHEN_NAMED`** ([`pipeline.ts`](../../src/pipeline.ts):366) — a bare `ReadonlySet`.
  Omitting `labels` leaves it in the positional cascade, so forcing `hierarchy` sweeps it in. Decide
  it, with a comment, either way.
- **`DEFAULT_INGEST_STEPS`** — `labels` must not be added, and nothing checks that.
- **`isCurrent`'s switch** ([`pg.ts`](../../src/store/pg.ts):2488) — falling through to `default: true`
  makes the step report itself current for ever, on the one page whose job is to say otherwise. It
  has already happened to `ideas` and to `sketch`.
- **`STEP_TIMING`** ([`job-state.ts`](../../src/job-state.ts):417) — falls back to 180 s, so a 680 s
  labels run raises a false alarm every time.

### What `arc` actually cost, since it is the rehearsal

From [260829f](260829f-defer-arc-and-rename-hierarchy.md). Two lessons, and the second is the one
that bites us:

1. **The freshness check came first, while the step was still in the defaults**, and the removal from
   `DEFAULT_INGEST_STEPS` happened only afterwards, in one commit with `FORCE_ONLY_WHEN_NAMED`. The
   order was forced by review. *"Its position **is** the signal, and this change removes its
   position."*
2. **Every existing artefact went stale the day it shipped** — *"the visitor problem arriving for the
   whole existing library at once."* That is F4/F5 in this plan, and `arc` walked straight into it.

Also: **a test's name was the old specification.** `tests/jobs.test.ts` § *"keeps `arc` in the
cascade, because it cannot check itself"* had to be rewritten, and four other assertions in the same
file silently expected the positional sweep. Grep `tests/jobs.test.ts` for `labels` before starting.

### Who actually runs the successor, since nothing on the server does <a id="who-drives"></a>

Measured 2026-09-06 by reading the client, because Sol's F3 called a permanent `pending` a normal-use
defect and the answer decides whether it is one.

**The queue is driven by a module singleton, not by a mounted component**, and it drives **every**
queued job the signed-in owner has — no slug filter, no "did this tab create it" filter:

```ts
/* src/web/jobEngine.ts:486 */
for (const job of jobs) {
  if (job.status === "queued" || job.status === "running") void drive(job.id);
}
```

`jobEngine.start(readerId)` is called from `App()` itself, above every early return
([`App.tsx`](../../src/web/App.tsx):350 → [`useJobs.ts`](../../src/web/useJobs.ts):185), and `start`
polls immediately. So **any signed-in page in any tab is a driver** — the shelf, `/profile`, the
landing page, not only the article. That was the point of lifting it out of `useJobs` on 2026-09-01:
*"whether an import kept moving depended on whether the page you happened to open mounted one of
those three."* Subscribers pick the **cadence** only; they never grant permission.

So the three cases:

- **The owner watches the ingest finish and closes the tab.** Driven, in that same tab, usually
  within a second — the busy cadence is 1 s, so the next `GET /api/jobs` after publication already
  carries the successor. The ingest card itself does not follow it (`AddPage` binds to the id it
  created), which is right: the successor is not what the reader is watching.
- **The owner never returns to the article, but opens Spideryarn anywhere.** Driven on that page
  load, from the first poll.
- **The owner never signs in again, anywhere.** **Queued for ever.** `settleExpired` is gated on
  `status = 'running'` ([`pg-jobs.ts`](../../src/store/pg-jobs.ts):1052), `trimFinished` deletes only
  terminal rows, `vercel.json` has no `crons` key, and `pump` returns early under `VERCEL`. Nothing
  reaps a queued row and nothing else will run it: a stranger's advance is a 404
  ([`jobs.ts`](../../src/jobs.ts):1975 scopes by `currentOwnerId`), and a signed-out reader gets no
  engine at all.

**The one shape worth naming for Greg** is the last case crossed with `/read/public`: an article
whose owner abandoned it, shared publicly, shows *"Paragraph labels are still arriving"* to strangers
indefinitely, and no stranger can make it stop. Narrow, and stage 1 already made the state honest
rather than blank. Not a blocker; a thing to decide once somebody hits it.

**A second job for the same article does not race it.** `blockedByAnother`
([`pg-jobs.ts`](../../src/store/pg-jobs.ts):400) makes claims per-slug FIFO on `(created_at, id)`, so
a lazy `arc` job queued behind the successor simply answers `busy` until the labels finish — and
`useStepJob`'s own memo picks running-first-then-oldest with the same tie-break, so the reading
view's spinner sits over the successor too.

### The question that had to be settled first, and its answer <a id="two-steps-one-stamp"></a>

**Settled 2026-09-06, before any stage 2 code.** The question was whether two steps could read their
stamp off the same artefact — this plan keeps `STAMP_SOURCE.hierarchy = "labels"`
([§ the stamp route](#stamp-route)) *and* adds a `labels` step that also writes the `labels` column,
against `assertStampAgrees`, `recordStamp` and `stampForStep`'s `StampDisagrees` throw.

**They can, and the reason was already in the code.** `hasArtefacts`
([`artifacts-pg.ts`](../../src/store/artifacts-pg.ts):684) asks the **asking step's own** run row
before it looks at any artefact:

```ts
const run = await runRowFor(ref, exec, step);
if (run?.status !== "done") return false;
```

`stepIsDone` ([`pipeline.ts`](../../src/pipeline.ts):966) is `interrupted → has(produces) →
stamp/isDone`, so a step with no `done` row of its own cannot be skipped by an artefact somebody else
wrote. Doneness is keyed on the receipt, not on the file.

**And the pattern already exists.** `STORAGE` ([`artifacts-pg.ts`](../../src/store/artifacts-pg.ts):200)
maps **both** `blocks/blocks` and `hierarchy/blocks` to the same rows — *"The same rows as
`blocks`/`blocks` above, not a second copy."* Two steps have shared one site all along; nobody had
connected it to this question. [`tests/shared-site-run-row-gate.test.ts`](../../tests/shared-site-run-row-gate.test.ts)
now pins it on that existing pair, watched red by neutering the run-row line (3 of its 5 cases fail,
every one on an assertion rather than a timeout).

#### The P0 the answer uncovered, which two reviewers found independently

**Receipts are inherited, so "there is no `labels` run row" is false on re-ingest.** `beginDraftIn`
([`pg-revisions.ts`](../../src/store/pg-revisions.ts):853) copies **every** `revision_step_runs` row
forward into a new draft, in the same transaction as the columns and the block rows. So a second
ingest of an article that already has labels starts with a `labels = done` receipt, and then
`hierarchy` overwrites the labels column underneath it. Two ways that ends badly:

- the blocks changed, so the carried row's `input_hash` and the fresh manifest's `sourceHash`
  disagree, and `stampForStep` **throws** — inside `stepIsDone`, before `runStep`'s catch, so it
  escapes as a 409 and leaves the claim to recovery;
- or they happen to agree and the labels step **skips**, leaving the empty manifest for ever.

The fix is one statement in the transaction that creates the inconsistency: **when `hierarchy` writes
the pending manifest it deletes that revision's `labels` receipt**, atomically with the artefacts and
the `pending` status. It is the honest thing to write down — the labels are not done in this revision
— and it is what makes everything else fall out, because with no receipt `has` is false and
`stepIsDone` returns before it ever reads a stamp.

**It is also the structure-currency check**, which is why this plan carries no composite fingerprint.
A re-cut tree can only come from `hierarchy` running, and `hierarchy` always writes a pending manifest
and always invalidates. `StepStamp` has four fixed fields with no room for `structureHash`, and it
does not need one.

#### What the pending manifest carries

`sourceHash`, `structureHash`, `structureVersion`, `slug`, `labels: {}`, `batches: null` — and
**not** `version` or `generator`, which stay required on a completed file. Sol's option (c), and the
honest one: no labels prompt and no model produced that payload. Recording the labels provenance
anyway (option (a)) invents it and can make a carried receipt look current; recording the tree's
`toc/N` in a field whose established meaning is the labels prompt (option (b)) re-introduces the
exact clash that kept the stamp where it is, and `structureVersion` already holds the tree version.

Omitting them costs nothing live: `hierarchy` has no `PipelineStep.stamp`, `isCurrent("hierarchy")`
([`pg.ts`](../../src/store/pg.ts):2519) reads the run row's `input_hash` directly, and the remaining
consumer of the hierarchy stamp is `copyArtefacts`, which has no production caller.

#### Where Sol's remedy was not taken

Sol's F2 (P1) asked for `STAMP_SOURCE` to become a per-step **extractor** — each step declaring which
fields it reads and under what meaning, rather than just which artefact. The diagnosis is accepted:
after the split, `stampForStep("hierarchy")` really does report `promptVersion: "labels/2"`, which is
a different pass's provenance. The remedy is not, because the receipt invalidation above already
closes both holes it was aimed at, and a fifth registration point is the opposite of fewer moving
parts. ⟨Put to Fable as a declined P1 before landing — see below.⟩

What *is* taken from it: **`beginStepRun` clears `prompt_version` and `model` when it reopens a
row.** It already resets `input_hash` to a sentinel and leaves those two, so a stale value from an
older code version sticks for the life of the row — which is why 3 live revisions carry `labels/1`
on the row against `labels/2` in the artefact. A running row has no completed provenance yet. Those
3 self-heal on their next `hierarchy` run; nothing is migrated.

#### Fable's arbitration, and the one thing it moved <a id="fable-invalidation"></a>

Put to Fable 2026-09-06 as a declined P1, per
[engineering-manager.md](../reusable/engineering-manager.md). **Verdict: B, with one relocation** —
and the relocation is better than what I had.

**Key the invalidation on the artefact, not on the step's name.** I had the `hierarchy` step deleting
the receipt. But `writeArtefacts` already has exactly this seam, and its own comment already states
the principle — *"`parts.labels` rather than `step === "hierarchy"`, so the rule follows the
artefact"* ([`artifacts-pg.ts`](../../src/store/artifacts-pg.ts):1340). So the rule becomes:

- `parts.labels` with **`batches === null`** → `nav_label_status = 'pending'` **and** delete this
  revision's `labels` receipt.
- `parts.labels` with a real `batches` → `'ready'`.
- **`parts.tree` present and `parts.labels` absent → throw.** A tree written with no manifest beside
  it is refused, so any future writer of the tree has to say what it did to the labels.

**The reason is a writer we already know is coming.** The deepening wave
([260904d](260904d-deepen-fat-sections.md), this same branch) is the obvious next thing to leave the
blocking step the way the labels are leaving now — and it re-cuts the tree *without* running
`hierarchy`. Under my version it would have had to remember a convention living inside one step's
`run`. Under this one the store refuses it. That is the difference between a rule and a habit.

Fable verified the structure-currency claim against the paths rather than the step registry, and it
holds **today**: one code path writes the `tree` column (`writeArtefacts`, via
`STORAGE.tree = {at:"column"}`), one step produces `tree`, the deepen wave has no entry point outside
`generateHierarchy`, and `beginDraftIn` moves `tree`, `labels`, `navLabelStatus` and every run row in
one transaction so a copy is never a re-cut. It also closed a race I had not asked about:
`publishRevisionIn` ([`pg-revisions.ts`](../../src/store/pg-revisions.ts):1758) refuses a draft whose
base is no longer current, so a slow labels job cannot publish an old tree over a newer one.

**Three more things it asked for, all taken:**

- **`LabelsFile` becomes a discriminated union.** The pending shape omits `version` and `generator`,
  so it is two types pretending to be one bag of optionals — and this repo's rule is to let the
  compiler refuse the wrong state.
- **No `isDone` for `labels`.** It would be a second check of the fact the receipt already carries.
  Keep a `stamp()` of `{inputHash: hashBlocks, promptVersion, model}` — which catches a prompt bump
  *without* a `hierarchy` run — and one sentence saying that structure currency is the receipt
  deletion, not this stamp.
- **The F4 backfill is a second writer of `labels` run rows**, so it must copy `prompt_version` and
  `model` off the manifest or leave them null. Otherwise the first successor job for a legacy article
  throws `StampDisagrees` inside `stepIsDone`, before `runStep`'s catch — the same 409 as the carried
  receipt.

**And one cost, named rather than discovered.** Every `hierarchy` run buys a successor labels job,
including one that resumes an identical tree from checkpoint. Cheap, because the batch checkpoints
hit and a resumed batch costs nothing — but it is one job per publication, and it is the price of
simplest-first here.

Two smaller undecideds: whether the successor should carry a `profile` (the route resolves it from
the reader today, and a server-enqueued job has no route), and whether `enqueueSuccessorIn` belongs
in `pg-jobs.ts` or as a bespoke insert in `pg-session.ts`.
