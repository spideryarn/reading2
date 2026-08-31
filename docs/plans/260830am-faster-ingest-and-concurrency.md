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

And inside `toc`, [hierarchy.md](../project/hierarchy.md) measured the split:

```
  structure call   163.1s   ████████████████████████████████  88%
  label batch x3    23.1s   ####                              12%  (concurrent)
```

**So one model call is 60–90% of the time a reader spends staring at a progress panel.** Everything
else on this page is a rounding error beside it, and that single fact sets the order of the stages.

**That is an HTML article, and the qualifier matters.** For a PDF, `extract` is a model reading the
pages, and the session that owns PDF ingest measured it on production the same afternoon: **98s for a
9-page PDF (3 calls, $0.021) and 272s for a 14-page one (6 calls, $0.047)**, against about one second
for HTML. So a PDF reader still waits out the whole transcription before anything can be published,
and the "in at ~20 seconds" figure below is **true for HTML and false for PDFs**. Getting a PDF
reader in early is a different piece of work — a publication boundary inside `extract`, page by page —
and it is not in these stages. Quoting the 20s unqualified would have been the kind of number the
next person builds on.

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

Each is named here and **not restated** — read the value at the file, per
[CLAUDE.md § One source of truth](../../CLAUDE.md). What matters is that every one of them was
measured or chosen with exactly one job running.

| Constant | Where | What N does to it |
|---|---|---|
| `STEP_BUDGET_MS.toc`, marked "MEASURED" | [`src/jobs.ts`](../../src/jobs.ts) § `STEP_BUDGET_MS` | Under contention the step takes longer than it was measured taking, the pre-flight check says it fits, and **the claim's own deadline fires mid-step** — the exact failure the table exists to prevent, arriving by a route the table cannot see |
| `GATE`, the asset-fetch limiter | [`src/collect-assets.ts`](../../src/collect-assets.ts) | Process-wide, so N `assets` steps share one small pool of permits while each believes it has its own budget. Its own comment says why: *"job concurrency has been 1 and that was the entire story"* |
| `CONCURRENCY`, the label fan-out | [`src/labels.ts`](../../src/labels.ts) | Multiplies by N, with no global throttle and **no spend cap anywhere in the repo** |
| `poolMax()` | [`src/db/client.ts`](../../src/db/client.ts) | Deliberately small because Supabase's pooler limit is shared across instances, so exhaustion surfaces as *other* instances being refused connections |

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

**The first draft of this plan said the revision system already does the atomic replacement, so
"publish provisionally and replace atomically" was mostly *publishing twice*. GPT Sol's review
opened with "STOP. Do not build this plan as written", and it was right.** The transaction is
atomic, but publication, job state, step freshness, navigation and reader stability each need
protocol that does not exist. The five things that make it more than publishing twice are in
§ *What the review changed* below, and the stages are cut around them.

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

**The consequence, stated more carefully than the first draft stated it.** The 320 seconds stops
being *time-to-first-prose* and becomes *time-to-stable-reader*. That is a large improvement and it
is not the same as the number ceasing to matter — Sol's finding 9, and it is a fair correction of an
over-claim. What the reader waits for afterwards is real: gists at every level above the leaf, nav
labels on the leaf rows, and a navigation that is about to be redefined under them.

So waves and NDJSON do drop down the list, on the depth-and-cost argument rather than on "nobody is
watching". `effort: "medium"` and a **fixed-heading gist pass** — keep the author's carving, spend one
cheap call on gists alone — stay live options and should be *measured* before being demoted. The
second is the more interesting: it satisfies the ordinary gist invariant with no exemption at all and
never moves the geometry, at the price of not opening in 20 seconds.

---

## What the review changed

GPT Sol reviewed this plan on 2026-08-30 before anything was built
([the review](260830am-faster-ingest-and-concurrency-review-sol.md)). It opened *"STOP. Do not build this
plan as written"* and raised six P0s. **Every one I checked in the code was correct**, including the
one that decides the shape of the whole thing. They are recorded here rather than quietly fixed,
because four of them are things the next person would also assume.

**1. The reader would not have got in at 20 seconds.** `AddPage` navigates to the article only when
the *job* reaches `done` — `if (job?.status !== "done") return;`
([`src/web/AddPage.tsx:176`](../../src/web/AddPage.tsx)) — and `useStepJob` announces a whole job
finishing, not a step. A provisional publication leaves the job `running`, so the primary "paste a
URL and wait" flow would have waited the full ~350 seconds and the article would only have been
findable by going to the shelf by hand. **The publication is not the feature; the signal is.** This
is why the old stages 2 and 3 are now one deliverable.

**2. There is no way to publish a tree without claiming the `toc` step ran.** `reasonsNotToPublish`
looks up a `toc` step-run and checks its input hash against the blocks
([`src/store/pg-revisions.ts:1142`](../../src/store/pg-revisions.ts)), while the `toc` step considers
itself done from the *presence* of its three outputs with no freshness check. So not recording the
preview as a `toc` makes publication refuse.

> **Half of this was recorded as verified when only half had been checked, and the correction is
> mine to own.** The plan asserted that recording the preview as a successful `toc` *"makes the real
> 320-second ToC skip entirely"*. **That is not true today.** `stepIsDone`
> ([`src/pipeline.ts:681`](../../src/pipeline.ts)) asks `store.has`, and the session's store is the
> **filesystem** — `claimSession` builds `fsStoreSession({ artifacts: pipelineStore })` and
> `pipelineStore` is `fsArtifacts` ([`src/jobs.ts:57`](../../src/jobs.ts)). A Postgres run row cannot
> make a stage skip while the stages read files.
>
> It becomes true under `pgArtifacts`, where `has` means outputs *plus* a done run row — which is
> **stage 5**. So the rule stays absolute, and the reason changes from "this would break now" to
> "this is a mine laid for the stage that finishes the database move". Stated correctly it is a
> better argument, because a hazard that only appears once another plan lands is exactly the kind
> nobody re-derives.
>
> The mistake is the one this repo now has a page about
> ([written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md)): I verified the
> publication half, wrote both halves down, and the sentence read as checked because the paragraph
> around it was. `copyArtefacts` closes the third door: it demands **all** of a step's declared
products or none ([`src/store/copy-artefacts.ts:93`](../../src/store/copy-artefacts.ts)), so
"just write the tree" fails, and `labels.json` — which the plan never mentioned — is one of them.
**A distinct preview step and publication gate is required. The preview must never impersonate a
completed `toc`.**

**3. A failure between the two publications leaves an unfinished article published for ever.**
The finalizer couples publication and terminal job settlement in one transaction on purpose
([`src/store/publish-session.ts:219`](../../src/store/publish-session.ts)); an early publication
breaks that. Cancellation, lease expiry, a ToC failure or an asset failure all leave the provisional
revision live while the job says `error`. That needs product answers, not code: is a provisional
article a success or a failed ingest, what does the shelf say, what does Retry upgrade, may a public
visitor see it. **And the sharpest one: a re-ingest must not replace a finished revision with an
inferior preview.** Preview publication is therefore restricted to first ingests.

**4. The "moved something" guard does not protect the second publication.** `copyArtefacts` copies
every extant step, so `copied.length > 0` passes because `fetch` or `assets` moved while the tree
stayed provisional — and carry-forward preserves the provisional tree. My proposed fix, "prove it
moved the tree", was also too weak: `structureHash` can match when the final carving agrees with the
author's headings and adds only gists and labels, which is *the common case*. The final transition
must prove the live revision is provisional, the candidate is not, this attempt completed the real
`toc`, its hash matches these blocks, and the tree's **content** differs — and the ordinary
publication path should reject a provisional tree outright.

**5. `assets` was still gating the real tree** — in my own diagram, three paragraphs after the plan
said assets stops being a gate. If `toc` succeeds at 320 seconds and `assets` then fails, the reader
is stuck on the preview and the expensive result is never published. **Publish the real tree
immediately after `toc`; assets publishes separately or moves to a follow-up job.**

**6. The scroll anchor does not survive "by construction", which is what I wrote.** The URL→page
effect depends on `at` alone ([`src/web/App.tsx:936`](../../src/web/App.tsx)), so a tree change with
an unchanged `at` triggers no re-scroll; then the page→URL spy measures the reflowed layout and may
overwrite `at` with whatever now sits at the old pixel position. The anchor being a block id makes it
*resolvable*, not *restored*. Snapshot the visible block, swap, restore, and suspend the spy until
restoration finishes — and reset the node-id state that is not persisted but is live in the
component: open summary branches, focused outline rows, armed spine cards.

Two more worth carrying:

- **The paid-work gating list was too short.** I named `arc` and `similar`. Arc, ideas, glossary,
  summary, labels, tweets and sketch all read the tree. **`summary` is the dangerous one**: it is
  generated against tree nodes but calls itself current on `sourceHash !== hashBlocks(blocks)`
  (`src/summarise.ts:786`) — blocks only. A summary bought against the
  preview stays falsely current **for ever**, because nothing about the tree is in its key. Verified.
  The refusal goes **server-side at the job boundary**, for every tree-consuming step; UI gating is
  bypassable.
- **`provisional` is a JSON field, not an authority.** `checkTree` exempts any tree carrying it, and
  an import, a fixture, a stale writer or a model could set it. Sol's strongest version is worth
  taking: **the preview publisher recomputes `buildHeadingTree` from the stored blocks and requires
  the candidate to equal it.** The builder is deterministic and costs milliseconds, so the flag stops
  being trusted at exactly the boundary where trusting it would be expensive.

### A finding from production that changes what stage 2 is worth

**2026-08-30, late.** While this plan was being built, the PDF session hit a ToC failure on a
9-page arXiv paper (`arxiv-1503`, 78 blocks) that matters here:

```
step failed: toc — arxiv-1503, ms 123399, aiCalls 1, aiCost $0.1617
Error: The children of the node at root do not tile it: child 7 leaves a gap of 3 block(s).
```

One call, completed, and the tree it returned is structurally invalid. Three things follow.

**1. It falsifies a claim this morning's work rested on.** The research doc says of tiling failures:
*"Every tiling failure anyone has observed … is off by one block. That is decisively the
repair-sized world."* Four observations, all off by one, **all on HTML articles with headings**. R2
was sized to exactly that — [`src/toc.ts:604`](../../src/hierarchy.ts) is `Math.abs(lo - cursor) === 1`,
and the comment is explicit that the bound is a judgement: *"Two blocks out is not a slip, it is a
different reading of the article, and it still throws."* This gap is **three**. So it is outside the
repair by design, and the conclusion that followed — *R2 and R3 recover every structure failure we
have measured*, which is **the stated reason the fallback tree was judged not worth building** — no
longer holds.

**2. It lands exactly where § 7b predicted.** A PDF's text is a model transcription with no heading
structure, so it sits in the headingless half where the recipe was measured disagreeing with itself
(8, 7, 8 and 3 parts from identical input). Every prior tiling observation came from the well-headed
half. **PDF ingest reached production for the first time that same day**, so the ToC stage began
being handed a kind of article it had never been exercised against, and failed in a new way
immediately.

**3. And it exposes an honest limit in stage 2.** A PDF has no headings, so `buildHeadingTree`
returns `flat: true`, so the "not flat" rule below refuses it a preview. **Stage 2 as designed does
nothing for the articles this failure is about — which are also the slowest to ingest**, at 98s and
272s of `extract`. The 20-second figure must not be allowed to imply otherwise.

**Greg's two decisions, 2026-08-30, and they close this.**

> I think for now, we should allow gaps. It's not ideal, but it's not the end of the world, and
> better than things failing fatally. Perhaps in future, it should trigger a re-run of the LLM, where
> we feed in the previous output, with information about the gaps and ask it to adjust. But that's
> for later.
>
> — Greg, 2026-08-30

And, on what happens when the structure call fails outright: **fall back to a flat tree, flagged**,
so the article exists and is readable with Retry offered, rather than the ingest being lost.

**One interpretation was needed and it is recorded here rather than left implicit.** "Allow gaps"
has two possible mechanisms and they are not equivalent:

| | What it means | Consequence |
|---|---|---|
| **Literally** — leave paragraphs covered by no node | `checkTree`'s coverage rule fails, and those paragraphs become **unreachable in granularity zoom**: no node means no row at any level | The prose is on the page and nothing can address it |
| **Snap the gap shut, unbounded** | The orphaned paragraphs join the preceding sibling | A slightly wrong contents list instead of no article. Every invariant survives |

**Greg overruled this the same evening, having been told the consequence — and it is his call:**

> Above, I think I was arguing that maybe it's ok if there are some blocks that are uncovered, i.e.
> can't be reached directly from the Hierarchy representations. At least in the short-term — in the
> long-term we'll try and make all this stuff bulletproof.
>
> — Greg, 2026-08-30

So **uncovered blocks are acceptable for v1**, knowing they get no row at any level of the Hierarchy
views. Two conditions this plan holds onto, neither of them a hedge on his decision:

- **Counted and reported, never silent.** An uncovered block is invisible by construction, which is
  the [silent-success](../reusable/silent-success.md) shape exactly.
- **The prose must still render.** A block that loses its ToC row is the agreed trade. A block whose
  *text* disappears is not, and the difference has to be checked rather than assumed.

Both mechanisms are therefore on the table, and the snap is no longer the only route. So R2's `Math.abs(lo - cursor) === 1` bound comes off, and what replaces
it is not a bigger number but **a count that is reported**: `PartitionRepair` already carries `where`,
`kind` and `at`, and the pipeline log already prints the repair counts precisely so *"a repair nobody
is told about is the same shape as the bug it repaired"*
([`src/toc.ts:475`](../../src/hierarchy.ts)). The size of each repair joins them.

**The argument being overridden is worth preserving, because it is a good one.** The comment above
the bound says *"Two blocks out is not a slip, it is a different reading of the article"*, and that
is true — a three-paragraph snap may well attribute prose to a section the model did not intend.
Greg has weighed that against losing the article and chosen the article. The mitigation is the count,
and **the proper fix is his: hand the model back its own output with the gaps marked and ask it to
adjust.** That is a re-ask over a completed answer rather than a fresh draw, which is the one form of
retry this stage has not tried and the only one with a reason to behave differently.

**What it reopens, and this is Greg's to decide, not ours.** Two propositions were being treated as
one: *a flat tree as the thing you open on while a better one is coming* (bad — every paragraph
becomes a section, and Sol is right about it) and *a flat tree as the last resort when the structure
call has failed outright* (a poor read, but better than an article that does not exist). The research
doc rejected the fallback on the strength of the claim this specimen just broke. **It should be
re-asked, with this evidence.**

### One refinement of our own, from finding 9

Sol points out that a headingless preview is root-plus-leaves: **every paragraph becomes a section**,
there are no gists at any level, and the final upgrade redefines navigation completely. That is a bad
first reading experience, and `buildHeadingTree` already reports it — `flat: true` on its result.

So: **publish a preview only when the heading tree is not flat.** The measurement in the research
says 6 of 7 real documents have usable headings, so this keeps the win on the large majority and
gives the minority the behaviour they have today rather than a worse one. It is one condition, it
uses a value the builder already computes, and it removes the weakest case from the feature entirely.

---

# The stages

Recut after the review. Greg asked for three now and more after a pause; stages 1, 2 and 3 are the
three, and stages 2 and 3 together are the deliverable — **stage 2 does not claim the win on its
own**, which was the review's first finding.

## Stage 1 — Two live bugs on the path we are about to lean on

Both are on the ToC path, both are already costing real readers, and both are independent of every
design decision below. Sol endorsed keeping 1a as its own thing.

**1a — DONE, 2026-08-30.** `candidateDirs` now offers `example/` to the fixture's own slug and to
nothing else ([`src/api.ts`](../../src/api.ts)). One line of behaviour; the reach was the rest of it.
Twenty-four tests were relying on the fallback — three asserting the bug directly, twenty-one using
it as a free article — and each of those now seeds its own copy from `example/`, an idiom
`routes.test.ts` already used. Four sibling modules documented the old fallback in their own comments
and one, [`src/searches.ts`](../../src/searches.ts), *mirrored* it in code: it hashed `example/` for
every slug, so a slug the reader is now refused would still have had a fingerprint taken from prose
they were not being shown. Postgres was checked rather than assumed and was already correct.

**The test that matters compares block ids against `example/blocks.json`** — it proves *whose prose
came back*, not merely that a status code changed, because a 404 alone would pass for the wrong
reason. It was seen red first, 4 of 5, with the control ("still opens the fixture under its own
slug") green.

One thing to carry into stage 2: `describeDir` needs no change, but it returns `{skipped: slug}` for
a tree-less directory, so **a mid-ingest article is absent from the shelf rather than listed and
unopenable**. After stage 2 that window is every ingest, and it may want a "still building" row
instead.

**1a. `loadArticle` serves the wrong article.** `candidateDirs` returns `[data/<slug>, example]`
unconditionally, so an article with no tree falls through to the hand-authored fixture and **serves
somebody else's prose under the reader's slug**. `articleDir`
([`src/api.ts:620`](../../src/api.ts)) does the same for the metadata page. This is the fallback that
once hid a path traversal, and `src/api.ts` carries a standing alarm about it.

It is not hygiene. After stage 2, *"blocks exist and the tree does not"* goes from impossible to a
state that occurs for a few seconds of every ingest — so **stage 1a is a prerequisite for stage 2**,
not a tidy-up next to it.

**1b. The nav-label pass throws away work it has already paid for.** A real ingest of
[Wolfram, *Towards a Theory of Bugs*](https://writings.stephenwolfram.com/2026/07/towards-a-theory-of-bugs-the-ruliology-of-the-unexpected/)
(244 blocks) died on 2026-08-30 with *"this call asked for 58 labels and got 57, missing 4. Nothing
has been written"* — twice, with identical numbers after a retry at double the reasoning allowance.

**The root cause, found 2026-08-30, and the first thing it did was correct this plan.** The plan
said the arithmetic did not close and guessed that three returned labels were for ids nobody asked
about. That was wrong, and the code rules it out: **`missing` is a list of ordinals, not a count.**

```
src/labels.ts:840   `, missing ${missing.slice(0, 5).join(", ")}`
```

So "missing 4" means *the label for paragraph number 4 was absent* — **one** label out of 58, not
four. `asked` is `batch.blocks.length`, `got` is `seen.size`, and the numbers were self-consistent
all along. The three hypotheses in the investigation brief were each ruled out by a code path that
would have thrown a different error: a duplicate ordinal throws *"paragraph N was labelled twice"*
before reaching this message, and an out-of-range one appends *", and N were not asked for"*, which
the production string does not contain. **The message cost real investigation time by looking like an
inconsistency, and fixing its wording is the cheapest item in this stage.**

**Underneath it is a real failure, and it is stage 3's, not the label pass's.** Stages 1–3 were
re-run on the live URL for nothing — they make no model calls — and reproduced production exactly:
167.8 KB, 244 blocks, 244 minted, 0 reused. Of those 244 blocks, **80 are Wolfram Language code cells
that stage 3 strips to empty non-gistable `<p>`s**, leaving 15 bare lead-in fragments pointing at
nothing:

```
  S#50  <p> "Sometimes it's less obvious, but it still seems fairly clear that nothing can escape…"
   -    <p> ""                                   ← stripped code cell
  S#51  <p> "But what about in a case like this:"
   -    <p> ""                                   ← stripped code cell
  S#52  <p> "It looks awfully similar to the cases we saw above…"
```

One fragment's entire text is the word **"or"**. The label prompt demands 6–20 words that are *"a
CLAIM or a MOVE, not a topic label"* and forbids introducing any fact not in the paragraph
([`src/labels.ts:415`](../../src/labels.ts)). For those blocks those instructions are **jointly
unsatisfiable — the fact was in the image that got stripped — so skipping is the compliant move**,
and no retry can change it. That is why doubling the reasoning allowance produced byte-identical
numbers: completions are never cached, `batchFingerprint` excludes `max_tokens` so the retry sent the
same bytes, and the drop is a property of one line of the prompt rather than of sampling. It is the
**third recorded instance** of this shape; `src/labels.ts:60` documents 41-of-42, twice.

**Two gates must move together or a repair does nothing.** `parseLabels` throws per batch
([`src/labels.ts:837`](../../src/labels.ts)), and downstream `COVERAGE_FLOOR = 1`
([`src/toc.ts:254`](../../src/hierarchy.ts)) plus `assertEveryBlockLabelled` demand 100%. `COVERAGE_FLOOR`
was *tightened* from 0.95 to 1 on the argument that *"there is no longer a path by which a block is
legitimately unlabelled."* **This failure is that path, and it exists** — so the fix restores the old
floor with a new justification rather than inventing one.

The fix is three pieces of rising risk: **fix the message** (it is a list, say so); **retry only the
shortfall** rather than re-buying the whole batch, since a second full draw has now failed to help
three times on record; and **partial-accept with a bounded budget** — `droppedBudget` in
[`src/labels.ts`](../../src/labels.ts), read the formula there — with the dropped count surfaced in
`LabelRun`. (An earlier draft of this plan restated that budget and got the arithmetic wrong, which
is the argument for naming it rather than copying it.) The client already tolerates a bare leaf — `rowText`
([`src/web/outline.ts:120`](../../src/web/outline.ts)) falls through to null and skips the row — so
the visible cost is one blank row for a paragraph whose text is "or".

**The risk, named plainly:** partial-accept re-opens the hole the 100% floor was closed to shut, and
an unlabelled leaf renders as nothing rather than as an error, which is a
[silent-success](../reusable/silent-success.md) shape. The mitigation is that the drop is **counted
and reported**, which the old 0.95 floor never was — the "the eval had to be told" lesson from the
R2/R3 build, applied before rather than after.

**And the upstream fix is item F**, which is not ours: stage 3 promoting sentence fragments to
blocks. This article is a second independent witness for it — 15 fragments and 80 code cells reduced
to empty paragraphs — and that belongs in the research doc's F entry whatever we do here.

*Done looks like:* a failing test reproducing the 58/57/4 counting, seen red before the fix; that
article ingests to completion; no non-fixture slug can be served `example/`, with a test; a
postmortem under `docs/postmortems/`.

### Stage 1 — DONE, 2026-08-30

**1a** removed the fixture fallback (committed earlier, `af1d2d5`). **1b** landed three changes that
are one argument: *stop discarding work already paid for.*

| | What it does |
|---|---|
| The message | `missing` renders as ordinals — `missing paragraph 4`, and a truncated list says how many there were in all. The `extra` half too, since *"and 99 were not asked for"* reads as a count |
| Shortfall re-ask | On a short batch, re-ask **for the missing ordinals only**, keeping the prompt prefix byte-identical so the cache still hits. The saving is the answer, not the question |
| Bounded partial accept | After both attempts, keep a batch whose gap is inside `droppedBudget`, and record the dropped block ids in `labels.json`, `LabelRun`, `TocRun`, both CLIs and the pipeline log — **at zero as well as above it** |
| `COVERAGE_FLOOR` | 1 → 0.95, with all three versions of its argument written down, and named as the **article-level backstop, not the bound** |
| Tiling | The one-block bound is gone from **both** places it lived. `PartitionRepair.size` reaches `TocRun.repairedBlocks` and `largestRepair` |

**Five things that were better than the brief**, all found by going to look:

1. **`detectShift` runs after the parse, so a short answer skipped it entirely.** Partial-accept
   would have made that the *one* path where a short answer survives — and the one with no shift
   check on it. It resolved with nineteen labels each describing the following paragraph. Nothing
   red. **This was a hole the repair would have opened, not a bug that has been shipping**, and the
   distinction belongs in the postmortem: no reader's article has been affected.
2. **The tail had its own copy of the bound** (`cursor === parent[1]`). Fixing only the loop would
   have produced a rule that mends a gap of forty mid-article and refuses a gap of two at the end.
3. **`largestRepair`, not just a count.** Six one-block snaps and one six-block snap sum the same,
   and only one of them means "go and look".
4. **The eval had to be told, again.** `evals/toc-structure/run.ts` recorded repair *counts* and no
   size, so an arm putting a boundary one paragraph out and an arm handing a section forty of its
   neighbour's blocks both scored `ok`. Same failure as the labels eval, the same evening, a
   different file — **a repair inside the thing under measurement silently redefines the
   measurement**, and it will keep happening until that is a checklist item.
5. **Three tests asserted refusals that are now repairs.** Rewritten to assert the invariant they
   were actually protecting — every block gets exactly one leaf, none gets two — which is a stronger
   claim than "it threw" and survives the next change to how it is achieved.

*Verification:* 206 tests pass across the six files touched; typecheck clean in all of them. Every
current typecheck error is another session's in-flight work (`DiagramPanel.tsx`, the `jobs*`
five-argument change, `pdf-chunk-concurrency`).

### The review of the code, which stopped it — and the deletion that caused it

**GPT Sol reviewed `0062f74` and opened with "STOP".** Nine findings, one of them a silent-corruption
path, and **it exists because of a decision this plan praised.**
[The review](260830as-stage1-code-review-sol.md).

**The P0.** `repairShortfall` merges both calls and runs `detectShift` — correctly. But `detectShift`
threw an error carrying no `shortfall`, so the outer catch handed it to `acceptGap`, which
**discarded the merged labels and re-tested the smaller first set**. `MIN_SHIFT_EVIDENCE` is 12: a
merged set of 12 detects, a partial set of 11 abstains. The run then published eleven labels each
describing the following paragraph, and reported one clean drop.

The reproduction is the clearest statement of what would have shipped: thirteen blocks each carrying
one distinctive word, every label naming the *next* block's word, and `generateLabels` **resolving**
with `spya-000000` labelled *"…concerning harpsichord…"* — block 1's word. Green suite, no error, a
table of contents confidently wrong about every row it has.

**Why it was there.** A `LabelsShifted` guard had been written and then deleted the same hour,
because no fixture could redden it — the argument being that the two label sets *"differ by at most
the budget, which cannot move a majority vote"*. Sol broke that in one reading: **it does not need to
move a vote, it needs to cross the evidence threshold**, and one label is exactly enough. The guard
is reinstated as a subtype, and its comment now says the removal rested on a wrong argument.

> **The transferable lesson, and it cost the most of anything today.** "Still compiles, still green"
> has **three** readings, not two: decoration, a shadowing clause, and *a case nobody has thought of
> yet*. A compiler settles the first two and can say nothing about the third — and neither can a
> fixture written from the same mental model that wrote the code. For a **runtime** guard, *"I could
> not make it fire"* is far weaker evidence than *"it cannot fire"*. Before deleting one, write the
> unreachability argument as one sentence: that sentence is the falsifiable thing. **If it names a
> threshold, a count or a majority, treat it as unproven** — those are exactly the shapes where a
> case sits just past the edge of the fixture you happened to write.

Three of us — the author, the orchestrator, and a plan-stage review — agreed with that deletion. A
different model family broke it in one pass. That is the argument for the cross-family review being a
gate and not a courtesy, and it is why the code review is weighted above the plan review.

**The other eight**, all fixed: partial acceptance did not actually require *two* shortfalls (and a
test codified that bug); the shift guard was **necessarily inert** on batches of 12 or fewer;
`npm run labels` bypassed the coverage floor `generateToc` enforces; `calls` counted batches while
the cache diagnostic read it as requests; `repairedBlocks` tripled a cascaded repair; the evidence
promised for revisiting `MAX_REPAIRED_BOUNDARIES` was uncollectable **exactly when the bound fires**;
the label eval trusted the producer's count rather than its ids; and a heading whose label is
deterministically known could still spend the drop budget.

### The batch floor, and why the obvious fix was the wrong one

Finding 3 looked like a choice between two bad outcomes: **refuse**, and a short tail batch with one
unlabellable fragment loses the whole article — the fatal shape Greg ruled against, and a *likely*
one; or **accept and report "unchecked"**, which publishes labels that were never shift-checked, and
a shifted label is worse than a dropped one. A dropped label is a blank row; a shifted one is a
confident sentence about the wrong paragraph. Saying we could not check does not make them less
wrong.

**Neither. The root cause is that a batch could be smaller than the evidence its own guard needs.**
So `MIN_BATCH` is **computed**, not typed —

```ts
const MIN_BATCH = smallest n where n - droppedBudget(n) >= MIN_SHIFT_EVIDENCE
```

— and a short tail merges into its predecessor. The batch floor and the guard's threshold are one
constraint; two constants beside each other are two things that drift.

**Measured over every article on the machine before it landed**, rather than argued:

```
14 articles     31 batches, 4 under the floor   →   28 batches, 1 under the floor
                11 of 14 unchanged byte-for-byte
```

Cheap insurance, not a rewrite of batching. The cost is named rather than hidden: a merged batch may
exceed `MAX_BATCH` — 60 becomes 71 at worst — which is acceptable because **the cap already gives way
to the sibling rule at any size**, and this second exception is bounded at `MIN_BATCH - 1`.

The one residue — an article too short to have a neighbour to merge with — costs nothing, and the
argument was checked independently rather than accepted: one dropped label is under a 95% floor for
every article size from 8 to 19 blocks, crossing over only at 20. So anything at or above the
13-block floor yields a checkable batch and anything below is refused by coverage anyway. **The two
refusals do not stack into a case that would otherwise have shipped.**

### Two ways an article can still be lost, both left open deliberately

Neither is a bug. Both are one small change to close, and both should be closed on evidence rather
than on the next specimen — which is how the bound they replace came to be fitted in the first place.

1. **Two independent slipped boundaries in one answer** still throws
   (`MAX_REPAIRED_BOUNDARIES`). It was one of two bounds and is now the only one, and it is fitted
   to the same four HTML-with-headings observations. **A headingless article with two slips loses
   its whole ToC** — the fatal outcome Greg ruled against, arriving by the other door.
2. **A child its neighbour has entirely swallowed** still throws. Snapping it would leave a node
   covering no blocks; the alternative is to *drop* the node, which changes the tree's **shape**
   rather than its boundaries — a larger claim than a snap, and not one to make silently.

### One loose end, left deliberately

`showingFixture` in [`src/web/Metadata.tsx:409`](../../src/web/Metadata.tsx) is now **dead** — it
asks whether this page is showing `example/`'s files under somebody else's slug, and after 1a that
cannot happen. It is threaded through a dozen sites (a chip, Delete, the rename pencil, the
visibility switch) in a file other sessions were editing the same day, so pulling it out is a
refactor rather than a deletion and it is not worth doing under them.

What *was* done is the cheap half: the comment above it now says it is dead and why. The paragraph
there argued for a hazard that no longer exists, and **a comment arguing for a state the code cannot
reach is how the next person learns something untrue** — which is the failure mode, not the dead
`const`.

## Stage 2 — A first-class preview publication (server side)

**~~Wait for the peer holding `publish-session.ts`.~~ Unblocked, 2026-08-30 evening.** Both NO-SHIP
criticals are fixed at HEAD: the failure path now logs a fixed sentence and an error *class name*
rather than a driver message carrying bound parameters, and `settleJob` ends the job through the
inner session before rethrowing, so an all-skipped publication failure no longer leaves the job
`running`. The line reference this plan gave for the publication/settlement coupling is stale; it now
lives in `publishAndFinish`.


Everything the server needs, with nothing in the reading view yet. **This stage is safe to deploy and
delivers no visible change** — the preview becomes reachable only in stage 3. Saying that plainly is
the point: the review's first finding was a stage that looked like a feature and was not.

- **A dedicated preview step and publication gate.** Not a synthetic `toc` run, for the three
  reasons in finding 2. The preview publisher **recomputes `buildHeadingTree` from the stored blocks
  and requires the candidate to equal it**, so `tree.provisional` is not trusted as authority at the
  one boundary where trusting it is expensive.
- **Only when it is worth it:** first ingest only (never replacing a finished revision), and only
  when the heading tree is not `flat`.
- **An atomic "readable revision published" signal on the job**, in the same transaction as the
  publication. This is what stage 3 navigates on.
- **The ordinary publication path rejects a provisional tree**, and the final transition proves the
  five things in finding 4 rather than `copied.length > 0`.
- **Publish the real tree immediately after `toc`.** Decouple `assets` so a failed image fetch cannot
  strand a paid tree.
- **Server-side refusal of every tree-consuming step while the live tree is provisional** — arc,
  ideas, glossary, summary, labels, tweets, sketch — at the job boundary. And `summary`'s
  blocks-only freshness key must not be allowed to call a preview-bought summary current for ever:
  either it learns about the tree, or it is refused, and refusing is the smaller change.
- **Failure semantics, decided and written down:** what the shelf shows for "readable, upgrade
  failed", what Retry upgrades, and whether a public visitor may see a preview. Greg's answers:
  **keep the preview and flag it on the shelf** (Retry re-runs the upgrade); **first ingests only**,
  so a finished article is never downgraded; **owners only**, so a public visitor waits for the real
  tree.
- **The flat-tree fallback**, which belongs here because it is the same machinery pointed at a
  different moment. When the structure call fails outright — not a preview, a *failure* — publish the
  flat tree so the article exists, flagged as having no real contents list, with Retry offered. It
  shares the deterministic builder, the `provisional` marker and the "readable but unfinished" shelf
  state with the preview, so building it separately would mean building all three twice.

  **It is what rescues PDFs**, which get no preview because they are headingless, and which are both
  the slowest to ingest and the ones now failing. Without it, the article that most needs help is the
  one this plan does nothing for.

*Done looks like:* an ingest that publishes a readable preview revision and then replaces it, proven
by the database rather than by the UI; the real `toc` still runs and is not skipped; a test that the
ordinary publication path refuses a provisional tree; a test that a re-ingest never downgrades a
finished article.

## Stage 3 — The reader gets in early, and the tree upgrades under them

The half a person can see, and where the win is actually claimed.

- **Navigate on the readable signal**, not on `job.status === "done"`
  ([`src/web/AddPage.tsx:176`](../../src/web/AddPage.tsx)).
- **Refetch when `toc` finishes.** `useStepJob(slug, "toc", load)` is the shape and `useArc` the
  closest precedent; today nothing refetches the article at all
  ([`src/web/App.tsx:405`](../../src/web/App.tsx)).
- **Hold the reader's place properly** — snapshot the visible block, swap, restore, suspend the
  scroll spy until restoration completes, and reset the live node-id state (open summary branches,
  focused outline rows, armed spine cards). Finding 6; *not* "by construction".
- **Render the provisional state honestly.** No gists above the leaf and no nav labels on leaf rows,
  in two views. Internal nodes have the author's own headings as titles, so the bands are fine.
- **The client half of the paid-work gate** — `useArc` auto-starts a job on open
  ([`src/web/useArc.ts:133`](../../src/web/useArc.ts)) — behind the server refusal, not instead of it.
- **`sectionDepth` moves on the swap**, because it derives from tree depth and a heading tree is
  usually shallower. A decision to be made and stated, not a surprise to be discovered.

*Done looks like:* paste a URL, land in the article in ~20 seconds, read, and watch the tree upgrade
without a reload and without losing your place — **checked in a real browser via Claude-in-Chrome, in
a subagent**, because a green suite is not evidence that a reader can see it. No arc, summary or
embedding call made against a preview.

---

## Stages 4 and 5 — handed to other sessions, 2026-08-30 evening

**Both of the other two asks left this plan the same evening, and that is the right outcome rather
than a loss of scope.** Two sessions had reached each of them independently, from a live bug rather
than from a plan, and each arrived with more than this plan had: a red reproduction and a review in
flight.

| Was | Now owned by | Why theirs |
|---|---|---|
| **Stage 4** — N concurrent ingests | [260830ar-several-articles-at-once.md](260830ar-several-articles-at-once.md) | Greg hit `That article already has a job running` while asking for Tweets on an article he was reading, and handed it to the session in front of him. Their framing is better than this plan's: *"if you think it'll involve a lot of work to allow parallelism within an article, then just keep appending to the per-article queue"* — a per-article queue behind a global N, which this plan had not separated |
| **Stage 5** — the last of the filesystem | [260830aq-late-steps-read-the-store.md](260830aq-late-steps-read-the-store.md) | Three production failures today: a single-step job on an already-published article dies with ENOENT reading `blocks.json` from a job-scoped `/tmp`. Same root cause this plan's audit found — `src/jobs.ts` imports `fsArtifacts` directly, so the pipeline's reads never join the store selection — but they have the repro |

**What this plan keeps** is stages 1–3: the ToC off the critical path. That was Greg's stated first
priority and it is the part nobody else is holding.

**One thing must not be lost in the handover.** Stage 5's owner is fixing the *read* half of
`fsArtifacts`, and the same defect has a second consumer with a much worse consequence:
`previousBlocksFrom` ([`src/blocks.ts`](../../src/blocks.ts)) reads its **block-id baseline** through
that same filesystem store. That is the hazard in the section below, and a fix scoped to the six late
stages will leave it open. Told to them directly; recorded here because a handover that lives only in
a chat message is a handover that did not happen.

---

## The hazard that could stop stage 2, and may be a live bug

**Found while designing stage 2, 2026-08-30. Not yet confirmed reachable; being established.**

`blocks` carries block ids forward by matching text against the previous run's `blocks.json`. It
reads that baseline through `previousBlocksFrom` ([`src/blocks.ts`](../../src/blocks.ts)), which goes
via `session.reads` — the **filesystem** store. If that root holds no earlier `blocks.json`,
`previousBlocksFrom` returns nothing, `assertIdsCarried` takes its first-ingest branch and asserts
nothing, and stage 3 **mints a fresh set of ids for prose that already has them**.

On Vercel, [`src/store/data-root.ts`](../../src/store/data-root.ts) scopes that root **by job id** —
deliberately, so one job never finds another's files. Its own header accepts the price: *"a retry
gets a new job id and repays for the work already done."* Repaying for the work is not the whole
price. **A retry also gets an empty root**, and an empty root is indistinguishable from a first
ingest.

**Why this is the one contract.** Every feature addresses text by block id —
[block-ids.md](../project/block-ids.md). Comments, highlights, notes and the reader's saved position
are all block ids. Re-minting them leaves those rows valid in `block_identities` and pointing at
nothing in the revision.

**Why stage 2 cannot be built over it.** Today the blast radius is limited by a rule that happens to
protect us: *a job that fails publishes nothing*, so a re-minting retry mostly affects articles
nobody has read. **A preview publication removes exactly that protection** — the reader is in the
article, and may have commented, while the upgrade runs. And **the flat-tree fallback sharpens it
further**, because that feature's whole purpose is an article whose next action is Retry.

**What is being established, before anything is built:** which sequences re-mint (same job, resumed
claim, retry, re-ingest); what the reader actually loses and whether it is only comments; how big
"read the baseline from Postgres" is, given `beginDraftIn` already copies published blocks into a
draft for this exact reason; and whether there is a cheap containment short of the full fix.

**The decision rule for this plan: no written risk acceptance on block ids.** If the fix needs stage
5, stage 2 gets narrowed — preview only where re-minting cannot reach the reader — rather than
shipped over a contract violation. Ship a smaller feature, not a broken invariant.

**And one thing already noticed and passed over.** The progress panel on the failing Wolfram ingest
read *"244 blocks, 244 new ids (0 kept)"*. That line is the id-carrying outcome, printed in the UI,
on every ingest. It reads as unremarkable for a first ingest and is the whole story for anything
else — so **the instrument for this bug already exists and is already on screen**, which is worth
more than any test written later.

---

## Anti-goals

- **Not building waves or NDJSON.** Waves multiply a measured per-call failure rate across ~39 calls
  and pay a ~6,300-token reasoning floor on each, so they buy latency and sell cost; NDJSON needs a
  browser delivery path that does not exist and addresses only the 12% label half. Both drop on
  depth and cost, **not** on "nobody is watching" — that phrasing was an over-claim and Sol was right
  to reject it.
- **Not skipping the measurement, though.** `effort: "medium"` and the fixed-heading gist pass stay
  open, get measured cheaply — DeepSeek v4 or GPT Luna first, per Greg's ruling on spend — and are
  not built in these stages.
- **Not weakening `checkTree`** beyond the gist exemption that already exists, and the preview
  publisher does not trust the flag anyway: it recomputes the heading tree and compares.
- **Not touching stage 3 (blocks).** The research names two higher-value items there — sentence
  fragments promoted to blocks, and 1990s footnote markup read as argument — and both **move block
  ids**, which is [the one contract](../../CLAUDE.md) everything else depends on. Not ours, and they
  need Greg.
- **Not adding image suppression.** Greg ruled it out; the `assets` step keeps running and stops
  being a gate.

## Risks

| Risk | Why it is real | What we do |
|---|---|---|
| **A preview stays published for ever** | The finalizer couples publication and job settlement in one transaction; an early publication breaks that, and a ToC failure, cancellation or lease expiry then leaves a preview live while the job says `error` | Decided failure semantics in stage 2, written down rather than discovered; first ingests only, so a finished article can never be downgraded |
| **The preview impersonates a completed `toc`** | Publication demands a `toc` step-run, and the `toc` step is "done" from file presence with no freshness check — so a synthetic run makes the real 320s call skip | A distinct preview step and gate; a test that the real `toc` still runs after a preview publication. This is the failure that would silently ship a heading tree as the final answer |
| **The gist exemption becomes a door** | `checkTree`'s own header says the dangerous outcome is *acceptance*; `provisional` is a JSON field an import, a fixture or a stale writer could set | The publisher recomputes `buildHeadingTree` from the stored blocks and requires equality — the flag is never the authority. Ordinary publication rejects provisional trees outright |
| **A summary bought against the preview is current for ever** | `summarise.ts:786` keys freshness on `hashBlocks` alone while generating against tree nodes — nothing about the tree is in the key, so it can never notice the upgrade | Server-side refusal at the job boundary for every tree-consuming step, verified in the code rather than assumed from the step list |
| **The second publish republishes the old article** | `copied.length > 0` passes because `fetch` or `assets` moved; carry-forward keeps the provisional tree. And `structureHash` matching is *the common case*, so "prove the tree moved" is too weak | The final transition proves five things (finding 4), and each has its own test |
| **The tree swap moves the reader** | The URL→page effect depends on `at` alone, and the scroll spy then overwrites `at` from the reflowed layout | Snapshot, swap, restore, suspend the spy. Browser check, not a unit test |
| **The suite's green is not evidence** | Most of a day's bugs here are something reporting success while doing nothing | Every stage names a check that has been *seen to fail*; stage 3's evidence is a browser |

## Verification

`npm test`, `npm run typecheck` and `npm run check` at the end of every stage, plus `npm run lint` on
the files touched. A GPT Sol review of this plan before stage 1, and of the code at the end of every
stage — the second weighted higher. Claude-in-Chrome for stages 2 and 3, in a subagent.

**The suite's baseline, recorded 2026-08-30 16:51 before any of this was built.** It is not
clean, none of the failures are this work's, and the comparison at the end of every stage is against
*this list*, not against green:

```
Test Files  6 failed | 344 passed (350)
Tests       5 failed | 6372 passed (6377)

tests/auth-callback.test.ts            (file-level; intermittent — passed on one of two runs)
tests/chat-tools.test.ts               URL with real query parameters
tests/doc-links.test.ts                4 broken links, all in a peer's
                                       docs/plans/260830x-title-normalisation-review7-prompt.md
tests/fixture-ids.test.ts              fixture rows claimed by two test files at once
tests/store-artefact-manifest.test.ts  article.html has no home in Postgres
tests/store-shelf-reads.test.ts        stored scalars vs the blocks and tree actually there
```

**Corrected an hour later, and the correction is the useful part.** The list above was recorded as
"none of the failures are this work's". One of them was. `store-artefact-manifest`'s *"`article.html`
sits beside an article and has no home in Postgres"* fires because of
`data/wolfram-bugs/article.html`, written at 16:46 by **my own investigation subagent** re-running
stages 1–3 to reproduce the label bug — five minutes before the baseline run at 16:51 that then
recorded it as somebody else's. A baseline taken after your own agents have been working is not a
baseline, and the tell was available the whole time: the test names the file, and one `stat` says who
wrote it and when.

The manifest test is right on its own terms — `article.html` genuinely has no Postgres column, which
is **stage 5's failure arriving early** — but the reason it fires *today* is a directory this work
created. Re-baseline after removing it.

The rest of the picture, over three full runs, is that this suite has a **moving** failure set rather
than a growing one: `auth-callback`, `doc-links`, `fixture-ids`, `run-lock` and `store-parity` each
appeared in one run and not the next, **and every one of them passes when run alone**. Several suites
share one local database while several agents drive it, which is the documented hazard. So the rule
for the stages below is: *a failure is not yours until it survives being run in isolation* — and that
check costs seconds, where reasoning about it from the failure text costs an hour and is usually
wrong.
