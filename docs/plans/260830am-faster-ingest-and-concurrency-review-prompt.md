# Review this plan before we build it

You are reviewing a **plan**, not code. Nothing below has been built yet. The repo is Spideryarn, an
AI-assisted reading app: a pipeline of stages turns a URL into an article with a deeply-nested table
of contents, and a React reading view renders it.

Be adversarial and specific. I want findings I can act on, ranked. Tell me what is wrong, what is
missing, and what will bite in a way the plan does not anticipate. If a stage boundary is in the
wrong place, say where it should be. If the order is wrong, say so. Do not be agreeable.

## The three things I most want challenged

1. **Stage 2 publishes twice.** Is publishing a provisional revision after `blocks`, then a second
   real revision at the end of the job, actually safe given the machinery described below? What
   breaks that the plan has not noticed? Consider especially: a job that dies between the two
   publications, the "refuse a copy that moved nothing" guard, revision carry-forward, and anything
   that treats "the article is published" as meaning "the article is finished".
2. **The gist exemption.** `checkTree` requires every internal node to have a gist. A deterministic
   heading tree has none. The plan exempts the gist rule, keyed on a `provisional` flag. Is that the
   right cut? What else could satisfy the rule instead, and is the exemption containable?
3. **The ordering claim.** The plan argues that once the reader is in at ~20s, the 320s ToC call
   stops being a latency problem, so progressive waves / NDJSON / lower reasoning effort all drop
   down the list. Is that right, or is it convenient? What does it get wrong about the reader's
   actual experience of an article whose tree is about to change under them?

## Background facts you need, all verified in the code

- A default ingest is `fetch + extract + blocks + toc + assets`. Measured: fetch ~10s, extract ~5s,
  blocks ~5s, **toc 320.4s**, assets 7.1s. Inside `toc`, the structure model call is 163s (88%) and
  the nav-label batch is 23s (12%, three concurrent calls).
- `tree.json` is the reading view's skeleton, not just the ToC mode's data. Seven places refuse an
  article with no tree: `loadArticle` and `articleDir` (`src/api.ts`, both fall through to a
  hand-authored `example/` fixture — a live bug, serving the wrong article), `describeDir`, pg
  `loadArticle` and pg library (`src/store/pg.ts`), `public-reader.ts`, and `reasonsNotToPublish`
  (`src/store/pg-revisions.ts:1115`) which runs the full `checkTree` before publishing. `Article.tree`
  is `Tree`, not `Tree | undefined`.
- `checkTree` (`src/tree-invariants.ts`): leaves span exactly one block; every block index must be
  covered by a leaf; internal nodes must have a title **and a gist**. Its header states the
  asymmetry deliberately: a valid tree is never rejected by the stronger check, so **the dangerous
  outcome is acceptance**.
- `src/heading-tree.ts` exists (landed 2026-08-30). It builds a tree from the author's headings,
  deterministically, no model call. It has **no gists and can never acquire them**. Nothing calls it
  for a reader yet.
- Publication: `publishingSession` (`src/store/publish-session.ts`) wraps the job session and, **only
  on a `done` ending**, copies the files the stages wrote into a fresh draft and publishes it in one
  transaction. A job that failed, was cancelled or was interrupted publishes nothing and the reader
  stays on the revision they had. It already carries a guard that **refuses a copy that moved
  nothing**, because carry-forward means a draft opened from a published revision already holds that
  revision's blocks, tree and step runs — so publishing after copying zero steps would republish the
  *old* article and report the job done. Lock order is article → job, everywhere.
- Nothing refetches the article in an open reader (`src/web/App.tsx:405`). `useStepJob`
  (`src/web/useStepJob.ts`) is a shared hook that five surfaces use to reload one artefact when a
  step job finishes; `useArc` is the closest precedent. `useArc` also **auto-starts an arc job** when
  an owner opens an article that has none (`src/web/useArc.ts:133`).
- Scroll position is a **block id**, never a node id or pixel offset (`src/web/position.ts`); node
  ids are regenerated on every tree rebuild and nothing persists them. But `sectionDepth` is
  `max(1, leafDepth - 1)`, so tree depth decides what counts as a section.
- `labels.json` records `structureHash(tree)`. Internal nodes get titles from the structure pass;
  leaf `navLabel`s come from the label pass and are used by `src/web/outline.ts` and by the spine's
  band cards via `titleOrNav`.
- Concurrency 1 is a partial unique index `jobs_only_one_running ON jobs ((true)) WHERE status =
  'running'` — global across owners and serverless instances. It is a **mutex, not a scheduler**:
  nothing picks work up, a queued job only moves because a browser `drive()` loop or a local `pump()`
  keeps asking about that job id, and `pump()` returns immediately on Vercel. Constants measured with
  one job running: `STEP_BUDGET_MS.toc = 320_400`, asset-fetch `Gate(2)` process-wide, label fan-out
  `CONCURRENCY = 4`, `poolMax() = 5`. There is no spend cap anywhere in the repo.
- Storage: every read and all reader state is Postgres. All ten pipeline steps still write files and
  are on `LEGACY_UNCONVERTED_STEPS`; `publishingSession` copies them in at the end. `artifacts-pg.ts`
  (61 KB) and `pg-session.ts` are written, reviewed and **unreachable** — every call to `write` is in
  a test.
- Prior measurement, from an eval that cost $4: the shipped ToC recipe run four times over three
  documents. On a well-headed article (a constitution, 36 headings) it produced 7 parts both times,
  100% L1 self-agreement, and a free deterministic heading tree matches it at L1. On an unheaded
  article it produced 8, 7, 8 and 3 parts from byte-identical input. **So there is no measured case
  in which waiting for the structure call buys a better top-level carving.**
- A production ingest failed today on a 244-block article: *"Nav labels: this call asked for 58
  labels and got 57, missing 4. Nothing has been written."* Twice, with identical numbers after a
  retry at double the reasoning allowance. Note the arithmetic does not close.

## The plan

# Faster ingest, several at once, and the last of the filesystem

**Status: plan, unreviewed.** Written 2026-08-30, before any of it is built.

## The job

Greg, 2026-08-30:

> We want to be able to ingest multiple articles at the same time, to completely finish the move
> from files to database 100%, and to finish working on things so that the ingest finishes faster,
> perhaps moving the ToC-generation into a post-ingestion-queue step that happens when we open the
> doc, and/or for the ToC-generation to happen progressively or in parallel or with
> medium-thinking-level to reduce latency.

Three asks. He chose the order: **latency first**, then concurrency, then the last of the database
move.

## What the numbers say the job actually is

A default ingest is `fetch + extract + blocks + toc + assets`. The measured breakdown
([`src/jobs.ts` § `STEP_BUDGET_MS`](../../src/jobs.ts)):

```
  fetch     ~10s  (guess)   ██
  extract    ~5s  (guess)   █
  blocks     ~5s  (guess)   █
  toc      320.4s  MEASURED ████████████████████████████████████████████████████████████████
  assets     7.1s  measured █
                            ────────────────────────────────────────────────────────────────
  total    ~350s worst case; ~250s on a more typical article
```

And inside `toc`, [table-of-contents.md](../project/table-of-contents.md) measured the split:

```
  structure call   163.1s   ████████████████████████████████  88%
  label batch x3    23.1s   ####                              12%  (concurrent)
```

**So one model call is 60–90% of the time a reader spends staring at a progress panel.** Everything
else on this page is a rounding error beside it, and that single fact sets the order of the stages.

## What is already decided, and by whom

Four questions were put to Greg on 2026-08-30 and answered:

1. **Order** — latency first.
2. **"Safe to open"** — *"I'm not that fussed about image-privacy or if we announce to the
   publisher's CDN."* This overrides the image-suppression requirement that
   [260830a-opening-an-article-before-the-toc.md § 5](../research/260830a-opening-an-article-before-the-toc.md)
   treated as a hard prerequisite, and it removes a large piece of work: **a reader may open on
   blocks + a tree, with images loading live.** The `assets` step keeps running and keeps being
   worth running; it simply stops being a gate. Recorded in
   [security-map.md](../project/security-map.md) as a decision, not left implicit here.
3. **Concurrency** — *"N configurable, let's set the default to 2."*
4. **Spend** — *"spend what the work needs, but try to keep under $20 rather than much more, e.g.
   use cheaper models like DeepSeek v4 or GPT Luna for initial experiments."*

## The research this rests on

Two documents, both already reviewed by GPT Sol, and this plan does not re-argue them:

- [260830a-opening-an-article-before-the-toc.md](../research/260830a-opening-an-article-before-the-toc.md) — the
  full option space, the measurements, and the recommendation (option **B**: publish a free heading
  tree at once and replace it atomically when the model's arrives). Its § 7b is the load-bearing
  finding: **there is no case in which waiting for the structure call buys a better top-level
  carving** — where headings exist the model mostly reproduces them, and where they do not the model
  does not agree with itself between runs.
- [260830ak-toc-repairs-and-heading-tree.md](260830ak-toc-repairs-and-heading-tree.md) — R2, R3 and B1 landed on
  2026-08-30. [`src/heading-tree.ts`](../../src/heading-tree.ts) exists and builds a tree from the
  author's headings. **Nothing yet produces one for a reader**, which is precisely where this plan
  picks up.

## What the audits found, and what it changes

Two audits were run before this plan was written, one on the queue and one on the storage move.
Neither conclusion was what the entry-point docs would have led you to expect, and both change a
stage.

### Concurrency is a mutex, not a scheduler

Concurrency 1 does not live in a constructor. It is a **partial unique index on a constant**:

```sql
CREATE UNIQUE INDEX jobs_only_one_running ON spideryarn.jobs ((true)) WHERE status = 'running';
```

[`drizzle/0000_initial_schema.sql:159`](../../drizzle/0000_initial_schema.sql), declared at
[`src/db/schema.ts:1148`](../../src/db/schema.ts). At most one row in the whole table, across owners
and across serverless instances, may be `running`; the loser's `UPDATE` raises `23505` and
[`src/store/pg-jobs.ts:246`](../../src/store/pg-jobs.ts) turns that into `busy`.

**The trap is that the index serialises but does not start anything.** Nothing in this system picks
work up. A queued job only ever moves because a browser `drive()` loop
([`src/web/useJobs.ts:153`](../../src/web/useJobs.ts)) or the local `pump()`
([`src/jobs.ts:809`](../../src/jobs.ts), which returns immediately on Vercel) keeps asking about
**that job id**. So raising N buys nothing for a job whose tab is closed, and "make the number
configurable" is the smaller half of the change.

### Everything that assumes serial execution is a *number*, not a lock

The audit found no correctness hazard that survives the guards already in place — job-scoped `/tmp`
([`src/store/data-root.ts`](../../src/store/data-root.ts)), `jobs_active_slug` (one in-flight job per
article), and the `id + attempt_id + status` fence. What it found instead is a set of constants each
measured with only one job running:

| Constant | Where | What N does to it |
|---|---|---|
| `STEP_BUDGET_MS.toc = 320_400` "MEASURED 2026-08-30" | [`src/jobs.ts:222`](../../src/jobs.ts) | Under contention a 320s step takes longer, the pre-flight check at `:1256` says it fits, and **the claim's own deadline fires mid-step** — the exact failure the table exists to prevent, arriving by a route the table cannot see |
| `GATE = new Gate(2)` for asset fetches | [`src/collect-assets.ts:226`](../../src/collect-assets.ts) | Process-wide, so N `assets` steps serialise on 2 permits while each believes it has a 185s budget |
| `CONCURRENCY = 4` in the label fan-out | [`src/labels.ts:180`](../../src/labels.ts) | 4N concurrent model calls, with no global throttle and **no spend cap anywhere in the repo** |
| `poolMax() = 5` | [`src/db/client.ts:65`](../../src/db/client.ts) | Deliberately small because Supabase's pooler limit is shared across instances |

**So the concurrency stage is mostly about these four numbers and a scheduler**, and only
incidentally about the index. That is the opposite of how it looks from the outside, and it is why
it is not the first stage.

### The database move is 100% on reads and 0% on pipeline writes

Every read and all reader state is already Postgres. Comments, chat, jobs, uploads, the AI ledger,
the reader profile, saved searches, shelf state — all live. The schema is complete: every artefact
has a column in `article_revisions`.

**What is not converted is who writes them.** All ten pipeline steps are on
`LEGACY_UNCONVERTED_STEPS` ([`src/pipeline.ts:405`](../../src/pipeline.ts)) and write their own files;
a decorator, `publishingSession`
([`src/store/publish-session.ts`](../../src/store/publish-session.ts), landed 2026-08-30), copies
those files into a revision and publishes at the end of the job.
[database.md](../project/database.md) calls this *"a carry-across, not the end state: an ingest still
needs a writable disk for the length of the job."*

That work is already planned, in order, in
[260827aa-delete-the-importer.md](260827aa-delete-the-importer.md): D0, D1a and D1b are done, **D2 onward is parked**.
So the third ask is not a design problem, it is a scheduling one, and this plan resumes that
sequence rather than restating it.

Three findings from that audit are worth carrying here because they bear on the stages below:

- **`src/store/artifacts-pg.ts` (61 KB) and `src/store/pg-session.ts` are written, reviewed and
  unreachable.** `260827aa-delete-the-importer.md:2118`: *"every call to `write` in this repo is in a test.
  The write half of the seam has never run in anger."* A file listing looks finished and is not.
- **`htmlCarriesItsIds` inverts silently under Postgres** — on disk `extractedHtml` and `stampedHtml`
  are one file, in Postgres two columns, so the id-loss guard reads its own previous output and
  returns `true`. This is a [block-ids.md](../project/block-ids.md) hazard and must close before any
  later stage moves.
- **[architecture.md § Storage](../project/architecture.md) still describes the filesystem as the
  storage model** and is, per the audit, the most out-of-date doc in the set. Fixing it belongs in
  the stage that finishes the move, not after it.

## The shape of the answer

The framing in Greg's ask — *"moving the ToC-generation into a post-ingestion-queue step that
happens when we open the doc"* — is the right instinct, and the research doc explains why it cannot
be done literally. `tree.json` is not the Hierarchy mode's data; it is the reading view's skeleton.
Seven places refuse an article that has no tree, `Article.tree` is `Tree` and not `Tree | undefined`,
and what is left after removing the columns, the spine, the `?at=` tracker and the keyboard nav is a
plain page of text — a different product for four minutes, followed by the whole layout reflowing
under the reader.

**So the way through is the opposite: never let the tree be absent.** Give the article a free tree
the moment the blocks exist, let the reader in, and replace it when the model's arrives. Every gate
and every client branch keeps its invariant, and the ToC call becomes background work.

The discovery that makes this cheap: **the revision system already does the atomic replacement.**
`publishRevision` publishes a whole revision in one transaction, and the reader is always on the
live one. "Publish provisionally and replace atomically" is therefore mostly *publishing twice*,
not new infrastructure.

```
  today       fetch ─ extract ─ blocks ─────────── toc (320s) ─ assets ─┬─ PUBLISH
                                                                        │
                                            reader waits ~350s ─────────┘

  after       fetch ─ extract ─ blocks ─┬─ PUBLISH (provisional heading tree)
                                        │        └─ reader is in at ~20s
                                        └─ toc (320s) ─ assets ─┬─ PUBLISH (real tree)
                                                                │
                                                  tree swaps under the open reader
```

**The consequence worth naming: once the reader is in at 20s, the ToC's 320s stops being a latency
problem at all.** Waves, NDJSON, and `effort: "medium"` were all competing to shave that number;
after this they compete to shave a number nobody is watching. They drop from the top of the list to
a cost question, which is a much weaker claim on the time. That is the single biggest thing this
plan decides, and it is the reason the stages are ordered the way they are.

---

# The stages

Five, in order. Each ends with the suite green and the tree safe to commit and deploy. Greg asked
for three now and more after a pause; stages 1–3 are the three.

## Stage 1 — Two live bugs on the path we are about to lean on

Both are on the ToC path, both are already costing real readers, and both are independent of every
design decision below. Doing them first means the rest is built on ground that is not moving.

**1a. `loadArticle` serves the wrong article.** `candidateDirs` returns `[data/<slug>, example]`
unconditionally, so an article with no tree — which, after stage 2, is a state that lasts seconds
rather than never happening — falls through to the hand-authored fixture and **serves somebody
else's prose under the reader's slug**. `articleDir` ([`src/api.ts:620`](../../src/api.ts)) does the
same for the metadata page. This is the fallback that once hid a path traversal, and `src/api.ts`
carries a standing alarm about it. Remove the fixture fallback for non-fixture slugs; a visible
"still building" is strictly better than the wrong article.

**1b. The nav-label pass throws away work it has already paid for.** A real ingest of
[Wolfram, *Towards a Theory of Bugs*](https://writings.stephenwolfram.com/2026/07/towards-a-theory-of-bugs-the-ruliology-of-the-unexpected/)
(244 blocks) died on 2026-08-30 with:

> The nav labels for one section failed twice. First attempt: *Nav labels: this call asked for 58
> labels and got 57, missing 4. Nothing has been written.* After a retry with double the reasoning
> allowance: identical message, same numbers.

Two things are wrong here and they are separable. The arithmetic does not close — 58 asked, 57
returned, 4 missing means roughly three returned labels were for ids nobody asked about — and the
retry reproducing the numbers exactly says the failure is structural rather than a flaky model. But
the shape of it is the R2/R3 argument again, one level along: **a call that delivered 54 of 58
labels is discarded entirely, twice, and the article gets no table of contents at all.** A root
cause is being established in a subagent as this plan is written; the fix is expected to be
partial-accept with the missing leaves marked, in the same spirit as the repairs that landed this
morning, plus whatever the root cause turns out to demand.

*Done looks like:* a failing test that reproduces the 58/57/4 counting before the fix; that article
ingests to completion; no non-fixture slug can ever be served `example/`; postmortem written.

## Stage 2 — Publish after `blocks`, with a provisional tree

The reader gets in at ~20 seconds instead of ~350.

- **Produce the tree.** [`src/heading-tree.ts`](../../src/heading-tree.ts) already exists and builds
  one from the author's headings, deterministically, for nothing. It landed as B1 this morning and
  nothing yet calls it for a reader.
- **Mark it.** `provisional` on the tree — a tree-level flag, and the load-bearing one.
  `HEADING_TREE_VERSION` and `HEADING_TREE_GENERATOR` are for a human reading the JSON; nothing
  branches on them.
- **The gist rule is the one real obstacle.** `checkTree`
  ([`src/tree-invariants.ts`](../../src/tree-invariants.ts)) requires every internal node to carry a
  gist — *"nothing to render at its level"* — and a deterministic tree has nowhere free to get one.
  `reasonsNotToPublish` ([`src/store/pg-revisions.ts:1115`](../../src/store/pg-revisions.ts)) runs
  the full check before publishing, so this is not avoidable. **The exemption is keyed on
  `provisional` and on nothing else**, and it exempts the gist rule alone: coverage, tiling and the
  one-block-leaf rule stay exactly as strict. That asymmetry matters — the header of
  `tree-invariants.ts` says a valid tree is never rejected by the stronger check, so the dangerous
  outcome is acceptance, and this must not become a door.
- **Publish twice.** `publishingSession` publishes on a `done` ending only. Add a publication after
  `blocks` that emits blocks and the provisional tree together, atomically — the research is
  explicit that a placeholder needs its own publication boundary emitting both, because it is the
  ToC step that currently copies blocks into the reader's path.
- **What the reader sees:** heading-derived bands, real titles from the author's own headings, and no
  gists. Images load live — Greg's ruling, § *What is already decided*.

*Done looks like:* an ingest where the article is openable and readable before the ToC step starts;
`checkTree` still rejects every invalid tree it rejected before, with a test per rule; a provisional
tree cannot be published by any path that is not this one.

## Stage 3 — The real tree replaces the provisional one under an open reader

Stage 2 without this means a reader who opens early must reload to get the good tree. This is the
piece the research calls *"the single largest piece of unbudgeted work on the page"* — though the
audit above softens that, because the revision system supplies the atomicity and
[`useStepJob`](../../src/web/useStepJob.ts) supplies the "refetch when a step finishes" pattern that
five surfaces already use.

- **Refetch on completion.** `useStepJob(slug, "toc", load)` is the shape; `useArc` is the closest
  precedent. Today nothing refetches the article
  ([`src/web/App.tsx:405`](../../src/web/App.tsx)).
- **Hold the reader's place.** Scroll position is a **block id**, never a node id or a pixel offset,
  and [`src/web/position.ts`](../../src/web/position.ts) states the hazard plainly — node ids are
  regenerated on every rebuild. So the anchor survives the swap by construction. What does move is
  `sectionDepth`, which is `max(1, leafDepth - 1)`: a heading tree is usually shallower than the
  model's, so on the swap the reader's `?at=` block may stop being a section boundary and snap to the
  nearest one. **A decision, not a surprise** — and it needs a browser check, not a unit test.
- **Gate the paid work a tree triggers.** `useArc` auto-starts an arc job when an owner opens an
  article without one ([`src/web/useArc.ts:133`](../../src/web/useArc.ts)) — against a provisional
  tree that fires immediately and **spends a model call on the placeholder**. `similar` buys
  embeddings on a mode toggle and keys its cache on `structureHash`. Both must refuse while
  `provisional` is set. This is the item most likely to be forgotten and the only one that costs
  money when it is.
- **"Labels arriving."** `labels.json` records `structureHash(tree)`, so a tree swap needs a matching
  label swap or an explicit still-arriving state. Internal nodes have real titles, so the *bands* are
  fine; it is the leaf rows inside an expanded band that go blank.

*Done looks like:* open an article mid-ingest in a real browser, watch the tree upgrade under you
without a reload and without losing your place; no arc or embedding call is made against a
provisional tree; Claude-in-Chrome evidence, not a green suite.

---

## Stage 4 — N concurrent ingests, default 2

Greg: *"N configurable, let's set the default to 2."*

The index is the small half. The work is: replace `jobs_only_one_running` with a claim that counts
running rows under the `queue_state` lock (`SELECT … FOR UPDATE SKIP LOCKED` gives per-worker
concurrency, **not** a global N — [ingest-queue.md](../project/ingest-queue.md) is explicit); mirror
it in [`src/store/jobs-fs.ts:235`](../../src/store/jobs-fs.ts); make something pick up jobs nobody is
driving, or accept that N only helps tabs that stay open and say so; and revisit the four constants
in the table above, `STEP_BUDGET_MS` first, because its failure mode is a mid-step kill that costs a
paid call. `tests/helpers/running-slot.ts` and several suites wait on the global slot and change
premise here.

## Stage 5 — The last of the filesystem

Resume [260827aa-delete-the-importer.md](260827aa-delete-the-importer.md) at **D2**, in its own order: checkpoints,
then the six late stages, then `toc`, then `fetch`/`extract`/`blocks` and the source route, then the
runner switch (`src/jobs.ts:57`, `fsArtifacts` → `pgArtifacts`), then the demolition. Close
`htmlCarriesItsIds` before any stage moves. Fix
[architecture.md § Storage](../project/architecture.md) in the same stage.

This is more than one sitting and will be re-cut into stages of its own when it is reached; the
value of writing it here is that stages 1–4 must not make it harder, and stage 2's second
publication boundary is the one place where they could.

---

## Anti-goals

- **Not building waves, NDJSON or an effort screen.** Each was competing to shave the 320s ToC; after
  stage 2 nobody is watching that number. § 7b's measurement is the reason to be relaxed about it —
  where headings exist the model mostly reproduces them, and where they do not it does not agree with
  itself between runs, so there is no case in which waiting buys a better carving. `effort: "medium"`
  stays worth measuring as a *cost* question, cheaply, and not in these stages.
- **Not weakening `checkTree`** beyond the one gist exemption, keyed on `provisional`.
- **Not touching stage 3 (blocks).** The research names two higher-value items there — sentence
  fragments promoted to blocks, and 1990s footnote markup read as argument — and both **move block
  ids**, which is [the one contract](../../CLAUDE.md) everything else depends on. Not ours, and they
  need Greg.
- **Not adding image suppression.** Greg ruled it out; the `assets` step keeps running and stops
  being a gate.

## Risks

| Risk | Why it is real | What we do |
|---|---|---|
| The gist exemption becomes a door | `checkTree`'s own header says the dangerous outcome is *acceptance*, not rejection | Keyed on `provisional` alone, exempting the gist rule alone; a test per surviving rule; a test that a provisional tree cannot be published by any other path |
| Publishing twice republishes the old article | `publishingSession` already guards *"refuse a copy that moved nothing"* because carry-forward means a draft opened from a published revision already holds the previous blocks and tree | Make the second publish prove it moved the tree; extend the existing guard rather than adding a second one |
| The tree swap moves the reader | `sectionDepth` derives from tree depth, so a shallower tree re-cuts what counts as a section | Browser check, and a stated decision about where the reader lands |
| A provisional tree leaks into paid work | `useArc` auto-starts on open; `similar` keys on `structureHash` | Stage 3, and it is called out as the item that costs money if forgotten |
| The suite's green is not evidence | Most of a day's bugs here are something reporting success while doing nothing | Every stage names a check that has been *seen to fail*; stage 3's evidence is a browser, not the suite |

## Verification

`npm test`, `npm run typecheck` and `npm run check` at the end of every stage, plus `npm run lint` on
the files touched. A GPT Sol review of this plan before stage 1, and of the code at the end of every
stage — the second weighted higher. Claude-in-Chrome for stages 2 and 3, in a subagent.

**A note on the suite's baseline:** it is not clean, and the failures are peers' —
`tests/fixture-ids.test.ts` uuid collisions, a stale `wordCount` scalar for `scaling-hypothesis`,
typecheck errors in `evals/toc-structure/floor-combined.mts` and `src/store/pg.ts`. Record the
baseline before stage 1 and compare against it, rather than against green.
