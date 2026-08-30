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
   [opening-an-article-before-the-toc.md § 5](../research/opening-an-article-before-the-toc.md)
   treated as a hard prerequisite, and it removes a large piece of work: **a reader may open on
   blocks + a tree, with images loading live.** The `assets` step keeps running and keeps being
   worth running; it simply stops being a gate. Recorded in
   [security-map.md](../project/security-map.md) as a decision, not left implicit here.
3. **Concurrency** — *"N configurable, let's set the default to 2."*
4. **Spend** — *"spend what the work needs, but try to keep under $20 rather than much more, e.g.
   use cheaper models like DeepSeek v4 or GPT Luna for initial experiments."*

## The research this rests on

Two documents, both already reviewed by GPT Sol, and this plan does not re-argue them:

- [opening-an-article-before-the-toc.md](../research/opening-an-article-before-the-toc.md) — the
  full option space, the measurements, and the recommendation (option **B**: publish a free heading
  tree at once and replace it atomically when the model's arrives). Its § 7b is the load-bearing
  finding: **there is no case in which waiting for the structure call buys a better top-level
  carving** — where headings exist the model mostly reproduces them, and where they do not the model
  does not agree with itself between runs.
- [toc-repairs-and-heading-tree.md](toc-repairs-and-heading-tree.md) — R2, R3 and B1 landed on
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
[delete-the-importer.md](delete-the-importer.md): D0, D1a and D1b are done, **D2 onward is parked**.
So the third ask is not a design problem, it is a scheduling one, and this plan resumes that
sequence rather than restating it.

Three findings from that audit are worth carrying here because they bear on the stages below:

- **`src/store/artifacts-pg.ts` (61 KB) and `src/store/pg-session.ts` are written, reviewed and
  unreachable.** `delete-the-importer.md:2118`: *"every call to `write` in this repo is in a test.
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
([the review](faster-ingest-and-concurrency-review-sol.md)). It opened *"STOP. Do not build this
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
itself done from the *presence* of its three outputs with no freshness check. So recording the
preview as a successful `toc` makes the real 320-second ToC skip entirely, and not recording it makes
publication refuse. `copyArtefacts` closes the third door: it demands **all** of a step's declared
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
  ([`src/summarise.ts:786`](../../src/summarise.ts)) — blocks only. A summary bought against the
  preview stays falsely current **for ever**, because nothing about the tree is in its key. Verified.
  The refusal goes **server-side at the job boundary**, for every tree-consuming step; UI gating is
  bypassable.
- **`provisional` is a JSON field, not an authority.** `checkTree` exempts any tree carrying it, and
  an import, a fixture, a stale writer or a model could set it. Sol's strongest version is worth
  taking: **the preview publisher recomputes `buildHeadingTree` from the stored blocks and requires
  the candidate to equal it.** The builder is deterministic and costs milliseconds, so the flag stops
  being trusted at exactly the boundary where trusting it would be expensive.

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

The arithmetic does not close: 58 asked, 57 returned and 4 missing means about three returned labels
were for ids nobody asked about. The identical retry says the failure is structural rather than a
flaky model. **The root cause is being established in a subagent and this stage does not start until
it lands** — Sol's recut says the same, and a partial-accept fix chosen before the cause is known
would be a guess. The likely shape is the R2/R3 argument one level along: a call that delivered 54 of
58 labels is discarded entirely and the article gets no table of contents at all.

*Done looks like:* a failing test reproducing the 58/57/4 counting, seen red before the fix; that
article ingests to completion; no non-fixture slug can be served `example/`, with a test; a
postmortem under `docs/postmortems/`.

## Stage 2 — A first-class preview publication (server side)

**Wait for the peer holding `publish-session.ts`.** As this plan was written, another session had
`docs/plans/v1-publish-finalizer-review-sol.md` open on that exact file with a **NO-SHIP** verdict
and two unfixed failure-boundary bugs — a publication failure that can log article content through
raw SQL bound parameters, and an all-skipped publication failure that leaves the job `running`.
Stage 2 adds a second publication to that finalizer. Starting before their fixes land would mean
building on a file that is about to move and merging two people's changes to the riskiest
transaction in the app. Stage 1 touches none of their files, which is the other reason it goes
first.


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
  failed", what Retry upgrades, and whether a public visitor may see a preview.

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

Resume [delete-the-importer.md](delete-the-importer.md) at **D2**, in its own order: checkpoints,
then the six late stages, then `toc`, then `fetch`/`extract`/`blocks` and the source route, then the
runner switch (`src/jobs.ts:57`, `fsArtifacts` → `pgArtifacts`), then the demolition. Close
`htmlCarriesItsIds` before any stage moves. Fix
[architecture.md § Storage](../project/architecture.md) in the same stage.

This is more than one sitting and will be re-cut into stages of its own when it is reached; the
value of writing it here is that stages 1–4 must not make it harder, and stage 2's preview
publication boundary is the one place where they could — it adds a second writer to the path D2–D5
are trying to move.

Two things from the audit belong to whoever picks this up: **`artifacts-pg.ts` and `pg-session.ts`
are written, reviewed and unreachable** — *"every call to `write` in this repo is in a test"* — so the
file listing looks finished and the write half has never run in anger; and **`htmlCarriesItsIds`
inverts silently under Postgres**, which is a [block-ids.md](../project/block-ids.md) hazard and must
close before any stage moves.

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
                                       docs/plans/title-normalisation-review7-prompt.md
tests/fixture-ids.test.ts              fixture rows claimed by two test files at once
tests/store-artefact-manifest.test.ts  article.html has no home in Postgres
tests/store-shelf-reads.test.ts        stored scalars vs the blocks and tree actually there
```

Two of these are worth noticing rather than filing as noise. `store-artefact-manifest` is
**stage 5's own failure arriving early** — it is the test that fails when an artefact has no Postgres
column, which is exactly the gap that plan closes. And `auth-callback` failed on one run and passed
on the other, so it is a flake in a tree several agents are editing; if it is still intermittent when
stage 1 ends, it needs its own look rather than being carried forward as "known".
