# A per-article job queue that appends, and modes that start themselves

**Status:** planned 2026-09-02, reviewed by GPT Sol the same day and recut in response.
**Stage 1 is built**, in two passes on 2026-09-02 — 1A the store layer (the four indexes, the
`reserves_name`/`url_key` columns, the draining migration, the predecessor rule in `claim`, and
`EnqueueOutcome`), 1B everything above it (slug allocation's discriminated return, `enqueue`'s four
repairs, the ownership check, and the deletion of the 409 and every surface that rendered it).
**Stage 2 is built**, 2026-09-02. Worktree `article-job-queue`, branch `worktree-article-job-queue`. What the
review changed is in [§ What the review changed](#what-the-review-changed); the four blockers are
answered in § 1d, § 1f, § 1g and § 2b. The **code** built from stage 2 then went back for its own
review, which came back NO-SHIP —
[260902e-stage2-code-review-sol.md](260902e-stage2-code-review-sol.md) — and all three findings are
answered at the head of § Stage 2 and in § 2b and § 2e: a
retained press that let Back start a paid job, a failed GET the reader could not get out of, and two
paid paths held by no test.

**Two things stage 1 decided that the plan left open**, both recorded here rather than only in the
code:

- **A slug *nobody* has is allowed through the ownership check** (§ 1f). The check refuses a slug
  that exists and belongs to somebody else; it does not refuse a name with no article under it. Such
  a job is not a cross-owner blocker — every minted slug ends in a random short id, so no other
  reader can ever come to want that name — and it blocks only itself. Refusing it would have been a
  second, unrelated rule about what a slug may name, and would have refused every fixture that
  queues a job against a slug it has not built yet.
- **`urlKey` on the ticket comes from `request.url`, not from the URL `enqueue` reads off
  `meta.json`** (§ 1b), for the reason `workKey` gives: it has to be a property of the *request*.
  `jobs_active_source` is partial on `reserves_name` anyway, so a non-reserving row's `url_key` is
  never read.

> I got `Spideryarn is already busy with this article. Wait for that to finish, or stop it and ask
> again.` when I tried to run Ideas while Glossary was already running. Can we always and by default
> append to existing per-article queue, so that we can run as much as we like, and it simply takes
> longer?
>
> Also, I thought we had said that for Ideas, Glossary, Quotes etc that if I open a mode and it
> hasn't been run yet, that it should automatically start running (rather than requiring me to
> manually click "Find quotes" etc).
>
> — Greg, 2026-09-02

**This plan builds nothing new.** Both halves were designed, reviewed and left unbuilt in August,
and both reviews came back NO-SHIP. This is the recut, with the reviews' findings folded in — see
[§ What this is a recut of](#what-this-is-a-recut-of).

## Greg's decisions, taken before any of it was written

Asked and answered on 2026-09-02, so the rest can run without him:

1. **Two jobs on one article run one after another.** The global cap of three concurrent jobs still
   applies *across* articles; within an article it is a line.
2. **Asking twice for the same thing collapses onto the job already doing it**, so a double-click on
   *Find quotes* still costs one model call. Only *different* work appends.
3. **The interface gains no queue positions.** A waiting job shows as waiting, in the card it
   already has.
4. **Only clicking a mode in the bar auto-runs it.** A pasted or bookmarked `?mode=quotes` link, and
   Back/Forward through modes visited earlier, show the empty state and its button. This is GPT
   Sol's blocker 1 on the August plan, and Greg took its side.
5. **Build it all**, stage by stage, each ending green, reviewed, committed and pushed.

## What this is a recut of

| Plan | What it covers | Where it got to |
|---|---|---|
| [260830ar-several-articles-at-once.md](260830ar-several-articles-at-once.md) | Stage 1, several articles at once — **shipped**. Stage 2, a queue behind each article — **this plan's stage 1**. | Sol: *"STOP — do not build this plan as written"*, five findings against stage 2 |
| [260831ai-…-running-one-by-clicking-it.md](260831ai-which-modes-are-ready-in-the-bottom-bar-and-running-one-by-clicking-it.md) | the readiness dot **and** auto-run. Only auto-run is **this plan's stage 2**. | Stage 0 shipped (arrow keys off the mode radiogroups). Sol: *"The plan is not ready to build… four blockers"* |
| [260830aq-late-steps-read-the-store.md](260830aq-late-steps-read-the-store.md) | the named prerequisite for the queue | **Built, and its status line says otherwise** — § below |

### The prerequisite is done, and three files still say it is not

260830ar stage 2 *"must not ship before late steps read the published store"*: a job queued behind
an ingest claims on some Vercel instance whose `/tmp/spideryarn/<owner>/<jobId>/` is empty by
construction, and dies on `ENOENT` reading `blocks.json`. That was real — three production failures
in eleven minutes on 2026-08-30 — and it is fixed:

- `claimSession` ([`src/jobs.ts`](../../src/jobs.ts)) is two lines now, and under
  `SPIDERYARN_STORE=postgres` returns `openPgStoreSession({slug, job})` — the article's draft
  revision, read through `readsPgArtifacts`, not a job-scoped directory. `publish-session.ts`, the
  decorator that wrapped a filesystem session, was deleted in `c42c940`.
- Every late step's `run` takes the article through `readArticle(ctx.slug, store)` rather than
  opening a path under `ctx.dir` ([`src/pipeline.ts`](../../src/pipeline.ts)).
- `tests/late-step-on-a-cold-instance.test.ts` was flipped from asserting the defect back to
  `.resolves` in `cc2b67d`, and passes. `tests/claim-session-postgres.test.ts` § *"runs a late
  single step that reads the article from the store, not from its empty root"* is the end-to-end
  case: it ingests under one job id, queues `["arc"]` under a **second**, and proves the step reads
  the article.

**Three stale lines to fix in stage 1, because the next agent will believe them**:
260830aq's `**Status:** plan, unbuilt`; [ingest-queue.md](../project/ingest-queue.md)'s *"That is the
hydration problem, and it is the next piece"*; and
[`src/store/artifacts.ts`](../../src/store/artifacts.ts)'s *"which exists but which nothing in
production imports yet"* — `pg-session.ts` imports it and production runs it.

## Stage 1 — the queue appends

**Done looks like:** `POST /api/jobs {slug, steps:["ideas"]}` during a glossary run answers 202 with
a *different* job id; the two run in the order they were asked for; nothing 409s; `npm test`,
`npm run typecheck` and `npm run check` clean.

### 1a. One index becomes four, and a fifth to read them in order

Today [`src/db/schema.ts`](../../src/db/schema.ts) § `jobs_active_slug` — unique on
`(owner_id, slug)` `where status in ('queued','running')` — does three jobs at once: reserve the
name, de-duplicate the request, and serialise the article. Each gets its own home, and **the scope
of each is a separate decision**:

| Index | On | Where | For |
|---|---|---|---|
| `jobs_one_running_per_slug` | `(slug)` | `status = 'running'` | the article mutex |
| `jobs_reserved_slug` | `(slug)` | `status in ('queued','running') and reserves_name` | name reservation |
| `jobs_active_work` | `(owner_id, slug, work_key)` | `status in ('queued','running') and not cancelling` | de-duplication |
| `jobs_active_source` | `(owner_id, url_key)` | `status in ('queued','running') and reserves_name` | one address, one article — § 1d |
| `jobs_slug_order` | `(slug, created_at, id)` | `status in ('queued','running')` | the predecessor query — not unique |

Plus a check constraint, `jobs_cancelling_is_running`. A queued row carrying `cancelling` cannot be
produced by the cancellation API, and if one existed nothing could clear it: it sits outside
`jobs_active_work`, so no request de-duplicates onto it, while still blocking its article's line as
a predecessor for ever. Decided while building, not planned.

**The first two are global on `slug`, not `(owner_id, slug)`.** `articles.slug` is globally unique
— *"because it is the URL contract (`/read/<slug>`)"*, [`src/db/schema.ts`](../../src/db/schema.ts)
— so two owners can build toward one slug, and today only the dropped `jobs_only_one_running` kept
them from doing it at once. Sol: *"The running mutex — and probably name reservation — must be
global on `slug`… `jobs_active_work` should remain owner-scoped."* De-duplication is a fact about
one person's request; the article is not.

**`jobs_active_work` excludes `cancelling` rows**, also Sol's: a request that de-duplicates onto a
job the reader has just stopped would otherwise vanish into a job that is about to end. The mutex
and the reservation keep holding until that job is terminal, which is right — its claimant is still
inside it.

**`jobs_active_work` is the index the schema comment says was dropped as "strictly subsumed".** It
was, while `jobs_active_slug` covered `queued`. Relaxing that is exactly what un-subsumes it, and
that comment must be rewritten rather than left to contradict the schema.

### 1b. `reserves_name`, and it is narrower than "arrived with a URL"

A new boolean column, true iff the request is **claiming a new name** rather than naming an existing
article. No existing column can stand in for it: `enqueue` fills `url` from `meta.json` for a
late-step job, so `{slug, steps:["ideas"]}` on a shelved article carries a URL exactly as a paste
does.

Sol corrected the August definition — *"'request carried a URL/upload' is too broad… a re-ingest of
an already-owned URL is targeting an existing article, not claiming a new name"* — and `enqueue`
already knows the difference without being asked. `freeSlug` returns either the slug something
already holds for this URL (**adopted** — not a new name) or `slugWithShortId(slug)` (**minted** — a
new name). So `reserves_name` is *the slug was minted*, which is one boolean already in hand at the
one place it is decided. **An upload always mints** — it calls `slugWithShortId` directly, there
being no address that could make two uploads one article — so an upload always reserves.

**Slug allocation returns `{slug, kind: "minted" | "adopted"}`**, not a bare string. Sol asked for
the discriminated form and it is the right shape for a reason worth stating: the fact is known at
the moment of allocation and nowhere else, and every attempt to recover it later — from `url`, from
`upload`, from the shape of the slug string — is the guess § 1b exists to avoid. A type that carries
it makes losing it a compile error.

On the filesystem side it rides beside `workKey` as a sibling key in the stored document, keeping it
off the public `Job` type for the same reason `workKey` is off it.

### 1c. Which conflict fired: re-read and decide, never the constraint name

The August plan branched on the constraint name. Sol showed it is unsound: two identical URL ingests
violate `jobs_active_work` **and** `jobs_reserved_slug` in one insert, Postgres promises nothing
about which it names, and read as the reservation the caller renames and pays twice.

So `enqueueOrGet` keeps `onConflictDoNothing()` and the caller **re-reads the active rows for that
slug** and asks two questions: *is one of these my work key* → hand it back; *is one of these
reserving this name* → allocate the next slug and retry. One query, no constraint names, indexes
back to being guarantees rather than a signalling channel. The existing
`{job, created, sameWork}` return needs no signature change.

### 1d. Two pastes of one URL at the same instant, which no index catches

The August plan said two identical URL ingests violate both the reservation and the work index at
once. **That stopped being true when slugs gained a random short id**, and the recut repeated it
before Sol caught it. Both requests call `slugAlreadyHolding`, both find nothing, and
[`freeSlug`](../../src/jobs.ts) mints `paper-a3f9k1` and `paper-x7d2m4`. Every proposed unique key
contains the slug, so **neither insert conflicts with anything**, and the reader gets two articles
for one address and pays twice.

**This is not a regression** — `jobs_active_slug` does not catch it today either, for the same
reason — and it is the one hole the reshuffle leaves exactly where it found it. It is also four
lines to close now that the migration is open, and it costs a real model run each time it fires:

`jobs_active_source`, unique on `(owner_id, url_key)` `where status in ('queued','running') and
reserves_name`. `url_key` is `urlKey(url)`, the normalisation
[`src/ingest.ts`](../../src/ingest.ts) already owns, persisted at insert. On that conflict the
caller re-reads and **adopts the holder's slug** rather than minting a second — which is what
`freeSlug` would have done had it been able to see the other request. Owner-scoped, because
*"if it was previously uploaded by a different user, then reuse the source object, but add a new
per-user article object"* (Greg, 2026-08-26). Uploads carry no source, so `url_key` is null for them
and the index ignores them — which is right: two uploads of one file are two documents.

**The test has to have a barrier in it.** Sol: *"A sequential double-click does not test the
simultaneous URL-mint race; use separate requests/connections with a barrier"* — both callers past
the lookup before either reaches the insert. A sequential test passes today, against the bug.

**The repair re-runs the allocation; it does not write the answer in by hand.** Corrected after
review of the built stage 1 (finding 3). *"Adopt the holder's slug"* is the right slug and the
wrong `reserves_name`: an adoption reserves nothing, so the loser lands **outside**
`jobs_active_source`, and it was being put there on the strength of a holder it had only been told
about. If that holder failed or was stopped between the refusal and the repair, a third request
would see no article and no active holder, mint and reserve a second slug, and the loser would
insert on the dead holder's — two active jobs, one owner, one URL, two slugs, both able to publish.
So `sourceTaken` asks [`freeSlug`](../../src/jobs.ts) again, exactly as `nameTaken` does: the holder
is in the store now, so the lookup adopts its slug — and if it has gone, mints and reserves a fresh
one. Revalidating before inserting is the whole of the fix.

**And the test for it has to go through `enqueue`.** The store-level case proves the *index* and
would stay green if the repair branch were deleted, which is what Sol found. The repair is
[`tests/one-article-for-one-address.test.ts`](../../tests/one-article-for-one-address.test.ts).

### 1e. The migration has to say what existing rows are

`reserves_name` and `url_key` have to mean something for rows that predate them, and guessing is
the failure mode this repo keeps writing up. **The answer is not to guess: drain.** Refuse to run
the migration while any job is `queued` or `running`, so every surviving row is terminal and
excluded by all four predicates — the column's value is then irrelevant rather than invented. On a
one-reader alpha with three concurrent slots, draining is a wait of minutes, and it is the only
option that cannot be silently wrong. A preflight also has to look for **active rows on one slug
belonging to two owners**, which the global mutex would refuse to index; there should be none, and
if there are, the migration says so rather than failing at `CREATE UNIQUE INDEX` with a duplicate-key
error naming two ids and no context.

The filesystem adapter's stored documents have no `reserves_name` sibling on old records. Same
answer: they are read at start-up by `sweepStopped`, and a record without the field is treated as
**not reserving**, which is the safe direction — it can never wrongly block a name.

### 1f. Serialisation at claim time, in a deterministic order

A job may claim only when **no older active row and no other *running* row exist for the same
slug**, ordered by `(created_at, id)`. Refused as
`{kind: "busy", why: "another job on this article is ahead of it"}`.

**The running half was added after review of the built stage 1** (finding 2), and it is not a
refinement of the older half. A row whose insert commits *after* a newer one has already claimed the
slug has no predecessor — nothing on the article is older than it — so an order-only rule waves it
through, and the `UPDATE` then collides with `jobs_one_running_per_slug`. That is a `23505` where
the contract says `busy`: a 500 on the reader's request, and a pump that logs a thrown exception and
exits. On the filesystem adapter, which has no index underneath, it was worse — two jobs running on
one `data/<slug>/` directory, both reported as claimed. The late commit is still deliberately not
FIFO; it simply waits its turn. `claimIn` carries a backstop for the same collision, mapping that
one constraint name to `busy`.

**Called deterministic order and not FIFO, because it is not FIFO and saying so would be a
claim the code cannot keep.** Sol: *"`(created_at, id)` is deterministic, but not necessarily
request order. Postgres is explicitly given the application's millisecond timestamp, and `id` is
random; two quick requests can tie and then run in random-id order."* And enqueue does not take the
claim lock, so a transaction that began first and commits later is invisible to the predecessor
query. Both are real, and neither is worth a monotonic ticket and a serialised enqueue: two requests
for one article inside one millisecond are a double-click, which § 1c collapses into one job before
the order can matter. **What the rule has to guarantee is that the set of predecessors is the same
for every claimant and never empties out of order** — which `(created_at, id)` does — not that it
matches the wall-clock order of two requests nobody can tell apart.

It goes inside `claim`'s existing transaction in
[`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts), under the `queue_state` singleton lock that
already serialises every claimant, so it is exact for the same reason the counted cap is exact. The
filesystem adapter gets the same predicate over its in-memory index.

**It needs an index of its own**, and today's `jobs` table has none that would serve it: the whole
table carries `jobs_draft_revision_unique` and `jobs_active_slug` and nothing else. The predecessor
query reads `slug`, `status` and orders on `(created_at, id)`, and the two new unique indexes are on
`slug` alone with `running`/`reserves_name` predicates — neither covers the queued scan. So a
non-unique `(slug, created_at, id) where status in ('queued','running')`. It is inside the singleton
lock, so a sequential scan there would serialise every claimant in the account behind it.

**Why FIFO and not merely "nothing running on this slug"**, which is what the August plan chose.
Sol: *"This creates contention, not a per-article queue. There is no FIFO rule… Claiming needs a
deterministic predecessor rule, for example no older active `(created_at, id)` row for the same
global slug."* Two concrete failures follow from the weaker rule. A claim covers a whole job but not
always — when the claimant's deadline runs out mid-job, `releaseStep` puts the row back to `queued`
and hands the claim back — so a second job can claim in that window and interleave its steps with
the first's. And a late step can beat a *queued* ingest and fail because the article does not exist
yet.

**The cost of FIFO, named rather than solved.** An abandoned `queued` row now blocks its own
article's line rather than merely holding a name. The August plan wanted to sweep those with a
`last_seen_at` column; Sol refused it — *"It changes 'durable until resumed or cancelled' into
'alive only while a browser keeps reaching the server.' That is a product-policy change, not repair
of an expired lease"*, and *"`advanceJobWith` calls `failExpired()` before claiming or touching the
requested job. The first request after an outage would sweep the very job it is trying to
resume."* So: **no sweep, and no column.** A stuck queued job is visible as a card with a Stop
button, it blocks one article and nothing else, and every owner tab drives it, so it only stays
queued when nobody is looking.

**A `cancelling` predecessor is not skipped, and the first draft of this section said it was.**
Sol found it, and it is worth writing out because the mistake is an easy one. Stop on a *queued* job
settles it terminal at once, so it leaves the line by itself and there is nothing to skip. Stop on a
*running* job leaves it `running` with `cancelling` set until its claimant releases or its lease
expires (`requestCancel`, [`src/store/jobs-fs.ts`](../../src/store/jobs-fs.ts):480) — and
`jobs_one_running_per_slug` still covers that row, exactly as § 1j requires for write safety. So
skipping it in the predecessor query buys the successor nothing: it would pass the FIFO check and
then take a unique violation, or have to classify that as `busy` anyway. **The successor unblocks
when the cancellation becomes terminal**, not when Stop is pressed, and the card should not imply
otherwise.

**The cross-owner hole this opens, and the check that closes it.** The predecessor query is global
on `slug`; job lists and Stop are owner-scoped. `POST /api/jobs` validates only `isSlug(slug)`
(`parseJobRequest`, [`src/routes.ts`](../../src/routes.ts):4025) and the handler goes straight to
`enqueue` — verified, there is no ownership check anywhere on that route. So owner B can queue
slug-named work against owner A's article and walk away, and A's next job sits behind a predecessor
A cannot list, drive or stop.

**And it deadlocks rather than draining, which is the part that makes it a blocker.** On Postgres
B's job does fail closed — `lockOrCreateArticle` filters on `ownedSlug`, finds nothing, cannot
insert against the globally unique slug, and throws `PublishRefused`: *"the slug … already belongs
to another reader"* ([`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts):468). But it
fails **at claim**, and nobody claims it: B has gone, and A cannot drive a job that is not A's. So
the row that would remove itself in milliseconds sits at the head of A's line for ever.

So **enqueue requires the caller to own the article a slug-named request targets.** A URL or upload
mint is the exception, and reservation governs it.

**It is a queue bug and not a security one, and the first draft of this section said otherwise.**
Under the *filesystem* store there is no equivalent refusal — no owner segment in `data/<slug>/`,
and `urlForSlug` reads `meta.json` off the path rather than through `ownedArticle` — so B's job runs
and reads and overwrites A's files. But **the filesystem store has no second reader by
construction**: *"it has no owner column, so it has no second reader, and a store with no second
reader cannot express 'somebody who is not the owner'"*
([database.md](../project/database.md)), and `src/store/index.ts` refuses to boot on it in
production ([auth.md](../project/auth.md)). There is no B. So this is a store that models one
reader, not a hole in one that models two, and the check below is worth having for the queue rather
than for the walls.

`urlForSlug`'s own docstring ([`src/pipeline.ts`](../../src/pipeline.ts):1104) already points at
*"the cross-owner case this deliberately does not fix"*, which is this one, seen from the slug side
and correctly left alone.

### 1g. The 409, and everything that renders it, goes

`enqueue` stops throwing `JobConflict` for slug-named work — which is every mode button in the
reading view — because there is no longer anything to refuse. That makes `JobConflict` and
`ARTICLE_IS_BUSY` unreachable, and with them:

- `structuredDetail`'s `blocking` branch in [`src/routes.ts`](../../src/routes.ts);
- `blockingJob` in `useJobs.ts`, `blocking` in `useStepJob.ts`, and the blocker `<Band>` and
  `WORKING_ON_THIS_ARTICLE` in `JobProgress.tsx`;
- `tests/blocking-job-409.test.ts` and `tests/blocking-job-band.test.tsx`.

Deleted rather than left, because dead machinery for a refusal that cannot happen is the next
agent's wrong turn. `Too many articles already called "x"` is a different sentence and stays.

**No reason field on `Advanced`, and that is a decision.** The August plan wanted `ClaimRefusal.why`
carried to the client so a card could say *waiting behind your own other article*. Greg chose "just
show them as waiting", a queued card already says so, and a field nothing renders is weight. The
reason is **logged** at the claim instead, which is where the question "why did this sit for four
minutes" actually gets asked.

### 1h. Everything else that assumes one active job per slug

From a sweep of the tree, 2026-09-02. Each of these picks one row where several will exist, and none
of them says which one it means.

**The `.limit(1)` at the heart of de-duplication.** `tryEnqueue` reads the conflicting row with
`.limit(1)` and no `order by` ([`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts):160-169), and
compares `sameWork` against **that one row**. So once a slug can hold several active jobs, a request
that duplicates the *second* of them is told `sameWork: false` and is reallocated or refused, and
the reader pays twice for work already in flight. [`src/store/jobs-fs.ts`](../../src/store/jobs-fs.ts):329
has the same defect through `.find(...)`. § 1c is the fix, and this is why it is not optional
tidying.

- `activeForSlug` — **deleted, not replaced.** The contract
  ([`src/store/jobs.ts`](../../src/store/jobs.ts):277) can only ever answer with one job, and both
  implementations pick arbitrarily: Postgres `.limit(1)` with no ordering, the filesystem in Map
  insertion order. Sol checked and it has **no production callers left** — only the two adapters and
  four lines of `tests/store-jobs-parity.test.ts`. Verified. Inventing a second ambiguous singular
  lookup to replace an unused one would be adding the problem back; the two callers that need
  something take purpose-specific lookups instead.
- `jobForSlug` ([`src/routes.ts`](../../src/routes.ts):4275), the upload repeat-claim recovery, does
  `all.find(j => j.slug === slug)` over **every status**, so reloading `/add/upload/<id>` can be
  handed an unrelated later mode job on the same article. It should match `job.upload.id ===
  uploadId`, which is the thing it actually means, and must still find a *terminal* ingest after a
  reload.

  **And searching every status is not enough on its own**, which review of the built stage 1 found
  (finding 5): finished jobs are trimmed to fifty per reader, and modes are jobs now, so fifty is a
  fortnight of ordinary use. After that the upload is still `claimed`, the article is still on the
  shelf, and the reload was answered *"That upload is already being turned into an article."* So the
  recovery falls back to the **upload record**, which has named the slug since `enqueue` returned and
  is never trimmed by count — `POST /api/jobs {uploadId}` answers `200 {article}` instead of `202
  {job}`, and `AddPage` goes straight there. The alternative considered and rejected was sparing an
  upload's job from retention: it only covers ingests that never completed, where the case a reader
  actually comes back to is a *successful* import, whose job is trimmed like any other success.
- `inFlightSlugForUrlKey` ([`src/jobs.ts`](../../src/jobs.ts):2322) returns the first match. Picking
  a deterministic row is not enough on its own — it is one half of the simultaneous-mint race, and
  § 1d is the other.
- `useStepJob`'s `job` memo ([`src/web/useStepJob.ts`](../../src/web/useStepJob.ts):202) filters by
  slug and step and then takes `.find(active)` over a **newest-first** list. A forced and an
  unforced glossary both write `glossary`, so the panel binds to whichever sorts first and silently
  drops the other's progress and failure. It takes **the running match if there is one, otherwise
  the oldest queued match** — which is the one that will run next, and so the one the panel is about
  to be about.

### 1i. The one that will go quiet rather than red

[`tests/helpers/running-slot.ts`](../../tests/helpers/running-slot.ts):93 catches
`violatesConstraint(err, "jobs_active_slug")` **by name** and retries, which is how half a dozen
suites take turns on a shared fixture slug. Loosen the predicate and the contending insert
*succeeds* instead of throwing, so nothing waits and nothing errors — two suites each believe they
own the fixture slug's only job and stomp each other's `article_revisions`. It is the exact shape of
[silent-success.md](../reusable/silent-success.md), and it is load-bearing for
`store-job-draft`, `store-pg-session`, `claim-session-postgres`, `blocks-baseline` and
`store-artefacts-pg`. `tests/running-slot.test.ts` cannot catch it: it synthesises the Postgres error
with a mock, so it passes whether or not the real constraint still fires.

**So the helper is rewritten first, before the schema changes**, to wait on whatever the new
invariant is, and its own test stops mocking the error it is about.

`tests/db-schema.test.ts` § *"one article cannot have two jobs in flight"* goes red rather than quiet
— it asserts the constraint by name — and becomes its opposite.

### 1j. What serialising is actually protecting

Worth writing down, because it is the reason the answer to Greg is a line and not parallelism.
[`src/store/artifacts-fs.ts`](../../src/store/artifacts-fs.ts):561-644 keys every artefact write, the
`beginStep`/`finishStep` attempt marker and `interrupted()` on `(slug, step)` in one shared
`data/<slug>/` directory, with no job scoping — and `chooseDataRoot`'s local branch
([`src/store/data-root.ts`](../../src/store/data-root.ts):160) returns the repository root, so on a
laptop there is no per-job scratch to save it. Two jobs running at once on one article would
overwrite each other's markers and artefacts outright. That is corruption, not ambiguity, and the
order rule in § 1f is what keeps it unreachable.

**One thing has improved since the August plan and its quote should not be repeated.** That plan
said publication *"records `basedOn` and nothing ever checks it"*. `publishRevisionIn`
([`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts):1445) now does compare it and fails
closed with `PublishRefused`. So on Postgres a same-slug race would waste work loudly rather than
lose a glossary silently. The filesystem store has no such guard, which is where § 1j's hazard lives.

### 1k. Tests, red first

Unskip the two that are already written and waiting:
`tests/jobs.test.ts` § *"queues rather than renames when a late step lands on a busy article"* and
`tests/store-jobs-parity.test.ts` § *"queues a second job for one article rather than refusing it,
and will not run both"*.

New, and everything below runs against **both** adapters. Four of these are rewrites of tests the
first draft of this plan proposed and Sol showed would have gone green over a broken feature; each
is marked with what it replaces, because *that* is the reusable lesson.

1. A second, different job on one article enqueues, with a different id, and answers 202.
2. It does not claim while the first is active, and the first's artefacts are intact when the second
   finishes. **The second half is the one that matters** — a `busy` that is really a lost
   publication passes the first half.
3. Three jobs on one slug claim in the order they were asked for, **with the claims attempted in
   reverse order** and with `created_at` values set explicitly far enough apart that they cannot
   tie. *(Replaces "reverse order" alone: with application-supplied millisecond timestamps, three
   quick inserts can tie and then order on a random id, so the test would be asserting whatever the
   ids happened to do.)*
4. **Stop lands on a running predecessor**: claim A, Stop A, B is still refused, A releases and
   settles, B claims. *(Replaces "a `cancelling` predecessor does not block its successor", which
   asserted the opposite of what § 1f now says, and did it against a `queued`+`cancelling` row —
   a state the cancellation API cannot actually produce, so the test would have been green over a
   broken running path.)*
5. Owner B cannot queue slug-named work against owner A's article at all — the enqueue authorisation
   in § 1f — and no cross-owner row can therefore block A's line. *(Replaces "two owners cannot run
   the same slug at once", which tests the mutex and misses the invisible queued blocker entirely.)*
6. A double-click makes one job; a request identical to a `cancelling` job makes a second.
7. **Two simultaneous pastes of one URL make one article**, with a barrier holding both callers past
   the lookup before either inserts. *(Replaces "two uploads called `paper.pdf` get two slugs",
   which passes today, and would pass if `reserves_name` were never persisted at all, because the
   random short id separates them regardless.)* Plus: a forced identical minted slug collides and is
   refused; `reserves_name` survives a filesystem reload; two reservers of one slug in different
   accounts collide.
8. A re-ingest of an already-owned URL does **not** reserve, and queues behind that article's own
   work rather than minting a second article.
9. The cap still holds: N+1 concurrent claims across different articles, the last one `busy`.
10. A queued job behind a re-extraction reads the **new** revision: run `blocks`/`hierarchy` as A,
    queue `ideas` as B, and assert B's stored fingerprint names A's new revision rather than merely
    that an artefact exists.

**Three existing parity tests invert and must be rewritten, not deleted**, and
`tests/db-schema.test.ts` § *"one article cannot have two jobs in flight"* becomes its opposite.
The waiters in § 1i are the dangerous ones. `tests/running-slot.test.ts` in particular **synthesises
the Postgres error with a mock**, so it stays green whether or not the live constraint still fires:
its replacement needs a case that contends against a real database.

### 1l. Docs

[ingest-queue.md](../project/ingest-queue.md) (the per-article rule, and the stale hydration
paragraph), the schema comments, [`src/store/jobs.ts`](../../src/store/jobs.ts)'s contract,
`job-state.ts`'s deleted constants, 260830aq's and 260830ar's status lines,
`src/store/artifacts.ts`'s stale claim about `artifacts-pg.ts`, and — Sol found a fourth —
`tests/late-step-on-a-cold-instance.test.ts`:149, which still says production does not provide this
store.

Around seventy places name `jobs_active_slug`. Most are incidental history in `docs/plans/` and stay
as they are; the load-bearing prose claims that become false are in `src/db/schema.ts`,
`src/store/jobs.ts`, `src/store/pg-jobs.ts`, `src/store/jobs-fs.ts`, `src/store/artifacts.ts`,
`src/jobs.ts`, `src/routes.ts`, `docs/project/ingest-queue.md`, `docs/project/testing.md`,
`docs/project/supabase-local.md`, `scripts/db-reown.ts` and `scripts/migration-reconciliations.ts`.

## Stage 2 — a mode starts itself when you click it — **BUILT**

Built 2026-09-02. What arrived, and the three places the plan met the code and had to give:

| what | where |
| --- | --- |
| the activation token (§ 2b) | [`src/web/activation.ts`](../../src/web/activation.ts) |
| the one-attempt guard (§ 2a) | `beginAutoAttempt` in [`src/web/jobEngine.ts`](../../src/web/jobEngine.ts) |
| the rule itself, once, for all five | [`src/web/useAutoRun.ts`](../../src/web/useAutoRun.ts) |
| `starting`, and the first-poll reconciliation (§ 2c) | [`src/web/useStepJob.ts`](../../src/web/useStepJob.ts) |
| `ensure` / `regenerate` | `useIdeas`, `useQuotes`, `useTimeline`, `useSketch` — `useGlossary.find` was already unforced |
| minting, and only here | `DockModes`' `onClick` and the Sketch chip's `onClick` |
| *Using your profile* (§ 2d) | `automatic` on `UseProfile`, [`WrittenForYou.tsx`](../../src/web/WrittenForYou.tsx) |
| the tests (§ 2e) | `tests/modes-that-start-themselves.test.tsx`, `tests/first-poll-completion.test.tsx`, and new cases in `step-job-force` and `public-network-trace` |

**A press belongs to the band that was on screen, and dies with it.** § 2b asked for this to be
decided rather than discovered. It was decided the *other* way when stage 2 was built — a token
whose panel unmounted before its GET settled was kept, so that Ideas → Quotes in under a second ran
both — and the second review found what that buys:

> Click Ideas while its GET is held. Click Quotes; Ideas unmounts. Quotes starts. Arrive back at
> Ideas **without clicking**. Ideas starts, from the token the first press left behind. … The later
> Back step is still what causes the paid request.
>
> — GPT Sol, 2026-09-02, [the stage 2 review](260902e-stage2-code-review-sol.md), finding 1

That breaks decision 4 above, which is Greg's and is not negotiable: **only clicking a mode in the
bar auto-runs it.** The three bounds the old note offered — one attempt per `(slug, step)`, the
session epoch, the tab's life — cap what it can cost and none of them ties the spending to the
navigation that authorised it.

So the token gained a fifth field, `owner`: the first mount of that panel to see it claims it, and
no other mount can ever spend it. A later arrival finds a press owned by a mount that is gone,
retires it, and spends nothing. **Ownership is claimed rather than released on unmount**, because
`<StrictMode>` runs setup / cleanup / setup and a retiring cleanup would retire the press on mount
— the feature would never fire in development. The cost, chosen: a press whose GET is still in
flight when the reader navigates away is dropped, so rapid Ideas → Quotes runs only Quotes. That is
a failure to spend, which is the safe direction. `activation.ts` § A press belongs to the band that
was on screen; `modes-that-start-themselves.test.tsx` § drops a press whose band left the screen.

**A failed read is not an answer, and pressing again is the way out.** Sol's second finding: after
the artefact GET failed, the press was retired and `useAutoRun` exited, and pressing the same Dock
mode again minted a fresh nonce, called the same setter, remounted nothing, and was consumed against
the still-`"error"` status. Ideas, Quotes and Timeline draw no button in their error state, so the
reader was stuck — which contradicts the nonce's stated purpose. Now `error` keeps the press and
asks the panel to **read again**, once per press; if the second read comes back empty the run
starts. `owner` is what makes keeping it safe. `useAutoRun.ts` § A failed read is not an answer.

**The session epoch is checked at consumption, not at mint.** The reader can sign out between the
press and the GET settling, and `jobEngine.epoch()` is the only thing that knows. The token is
dropped either way.

**`automatic` is narrowed in the five hooks rather than in the five panels** — `auto && (job !== null
|| starting)` — so that the sentence stops being true of the screen the moment the run lands or
fails, and five panels cannot each get the narrowing slightly differently.

**Two stale claims were corrected while passing through**, both about the CLIs, both named in
§ What we are not doing: `useStepJob` said a `npm run glossary` run "shows up here as progress" and
`JobProgress` said the same. Those command lines write no job record, so nothing about them reaches
the queue. Nothing claims otherwise now.

**§ 2f, the browser pass, is done** — 2026-09-02, Playwright against system Chrome on the box, signed
in, `SPIDERYARN_STORE=postgres`. All six checks passed: one click on Ideas started a job with no
second click; **clicking Glossary while Ideas was still running gave a second job reading "Waiting to
continue." with a Stop button**, which is Greg's original complaint answered end to end; a pasted
`?mode=quotes` URL fired nothing and offered its button, which then worked; three Back presses fired
nothing for any of the five; and a second click on a mode whose artefact existed spent nothing.

The test evidence beside it is `public-network-trace.test.tsx` § *starts the job when the owner
presses a mode nobody has run*, which drives the real `App`, bar and hooks and watches one
`POST /api/jobs` come out, with its negative twin a line below. Stronger than the plan expected from
a test — and the browser pass is what found the two things it could not: a job that loses its draft
pointer wedges the article's whole line for the length of the lease, and a peer's fixture reset can
null an article's revision pointer under a running job.
[260902f-a-lost-claim-that-was-never-lost-and-a-publication-that-was-never-buried.md](../postmortems/260902f-a-lost-claim-that-was-never-lost-and-a-publication-that-was-never-buried.md).

**Done looks like:** clicking Quotes on an article that has never had quotes runs it, with no second
click; a pasted `?mode=quotes` link does not; clicking it again after a failure does not; the button
still works; a visitor issues no POST.

The five that are backed by a paid step: **Glossary, Ideas, Quotes, Timeline**, and **Sketch** inside
Diagram. Summary is free — it reads the gist already on the tree. Search, Chat, Referee and Remember
store nothing.

### 2a. This reverses a recorded decision, and the reason for it is still true

[glossary.md](../project/glossary.md):

> Greg's call, 2026-08-25, choosing a button over generating on every ingest and over generating on
> first view: **a button, on demand**. The third option — generate automatically when the mode is
> opened — is the one the original version took, and its effect re-fired on every failure:
> generating, failing, generating again, for as long as the tab stayed open. A button removes that
> bug structurally rather than by remembering to set a flag on every error path.

Greg has asked for the third option, so the loop has to be closed structurally too, not by
remembering to set a flag on every error path:

- **One attempt per `(slug, step)` per tab session**, held in the job engine — the session-scoped
  singleton, so it survives a panel unmounting, a mode toggled off and on, and a re-render. It is a
  **synchronous "begin an automatic attempt"** that inserts into the set and returns false if the
  pair is already there, so the mark lands before the `await` rather than after it and two effects
  in one tick cannot both pass. A failure cannot loop, because a loop needs a second attempt and
  there is not one.
- **The set is cleared in the engine's own session teardown**, so signing into a different account
  in the same tab does not inherit the first reader's attempts.
- **The button stays**, and is the only retry. A person pressing it is not a loop.
- A reload is one more attempt, deliberately: a reader who reloads after a failure is asking again.

### 2b. Mounting is not clicking

Sol's blocker 1, and Greg took its side: *"The claim that 'selection is always an explicit gesture'
is false. `useAutoRun` would fire from `status === "none"` after mount, with no evidence of how the
mode was reached."* A pasted `?mode=ideas` link, Back/Forward through pushed mode entries, a Dock
link from `/metadata`, and history entries that pre-date this feature all mount a panel with nobody
having clicked anything.

So: **a one-shot activation token**, set by the Dock on click/Enter/Space and by the Diagram chip
for Sketch, handed to the panel, and consumed once the panel's own GET has settled. Everything else
shows the empty state and its button.

**A boolean will not do it**, and Sol's second pass is where the shape comes from. The token is
`{nonce, sessionEpoch, slug, mode}`, and:

- it is minted **only** in the two real gesture handlers — `DockModes`' `onClick`
  ([`src/web/Dock.tsx`](../../src/web/Dock.tsx):955) and the Sketch chip's
  ([`src/web/DiagramPanel.tsx`](../../src/web/DiagramPanel.tsx):1373) — and never by the generic
  query-state setter, which is what Back/Forward moves;
- it matches exactly one owner, slug and mode, and a change of slug or session invalidates it, so a
  click that navigates to a *different* article cannot arm a panel there;
- clicking the **already-selected** mode still mints a fresh nonce, or a reader whose first click
  raced a failed GET can never try again without leaving the mode;
- it is **consumed atomically**, so React `<StrictMode>`'s double-invoked effect cannot spend it
  twice;
- it retires when the GET settles with an **answer** — `ready` or `none`. A GET that *failed* is not
  an answer: the press is kept and the panel reads again (§ above). The plan said `error` should
  retire it too, which was the right defence against the wrong thing — what a kept press could do
  was fire against the next thing that mounted, and `owner` stops that structurally;
- clicking Ideas then Quotes quickly must not let the second overwrite and lose the first's intent;
- **it can only ever be spent by the mount that was on screen when it was made** — `owner`, added
  after the second review. See § above.

**And one thing to decide rather than discover**: whether a started attempt keeps going after its
panel unmounts. A *started* job does — it is server-side and the reader can come back to it. An
**unspent press** does not, and that is the decision the second review reversed: it dies with the
mount that was on screen when it was made. See § A press belongs to the band that was on screen
above.

**Only for owners.** The five hooks and `DiagramPanel` mount under `OwnedReader` and never for a
visitor; that is the capability seam, and `tests/visitor-gaps.test.ts` and
`public-network-trace.test.tsx` gain cases for Quotes, Timeline and `?mode=diagram&diagram=sketch`.

### 2c. Three bugs in the way, each of which would make this look broken

- **A job that is already `done` on the first poll is never announced.** `useJobs` treats its first
  poll as a baseline and suppresses `onFinished`, so a job that finishes between the panel's GET and
  the first poll leaves the panel stuck at `"none"` for ever — and a reader then kicks off another.
  Sol's blocker 2. `useStepJob` must reconcile the id `start()` returned, including a `done` job seen
  on the first poll, and reload exactly once.
- **The hooks need two verbs, not one with a flag.** `ensure()` — unforced, for auto-run *and* for
  the empty-state button — and `regenerate()` — forced, for the button that sits beside an artefact
  that already exists. Today `useIdeas`, `useQuotes`, `useTimeline` and `useSketch` hard-code
  `force: true` even from their empty state ([`src/web/useIdeas.ts`](../../src/web/useIdeas.ts):144);
  `useGlossary` alone does not, and `useSketch` has no unforced entry point at all.

  **This is not tidying, it is the identity rule.** If auto-run is unforced and the visible
  empty-state button stays forced, then a reader who clicks during the auto-start window sends a
  request with a *different* `work_key` — so § 1c does not de-duplicate it, and stage 1 dutifully
  queues a second paid job. A `starting` state narrows that window; only one work key closes it.
- **There is no `starting` state**, so between the click and the job appearing in the poll the panel
  shows the empty state's button again. Sol's item 8.

### 2d. The profile, said rather than greyed out

Sol's item 7: *"auto-run silently removes the first-run profile choice."* An automatic call uses the
reader's profile — that is the right default, and there is nobody to ask — so the panel **says so**
("Using your profile") rather than showing a tickbox it has disabled.

### 2e. Tests, red first

Clicking a never-run mode posts exactly once; a second click in the same session posts nothing,
artefact or no artefact, failure or no failure; arriving by pasted URL or Back/Forward posts
nothing; a mode whose artefact exists posts nothing; the button still posts after an auto-attempt
failed; a visitor posts nothing.

Sol's corrections to the shapes, each of which is a way a green test would have proved nothing:

- **`<StrictMode>` for real.** Mount once inside an actual `<StrictMode>` rather than calling mount
  twice by hand — hand-mounting tests a different thing from the double-invoked effect.
- **Let the GET settle.** A "no POST on a pasted URL" assertion made before the artefact fetch
  resolves and its effects run is vacuous: it passes because nothing has happened yet.
- **First-poll reconciliation, end to end.** Start from an unseeded real engine, take the id the
  POST returned, make *that* job `done` in the first list, and assert exactly one artefact reload —
  without turning every historical completion into news.
- Plus: rapid mode switching, clicking the already-active mode, the slug changing mid-GET, a failed
  GET followed by navigation, and an auto-run overlapping a manual click.
- **Visitor cases go in `public-network-trace.test.tsx`** for all five targets, and include a
  signed-in non-owner, not only a signed-out reader.

Added after the second review, which found three of these missing (finding 3, and the two bugs
above):

- **arriving back at a band after an unmounted press posts nothing**, and a *press* on the way back
  posts exactly one — the pair that pins the `owner` rule from both sides;
- **press, fail the GET, press again** — the reader gets a second read, and a job when it comes back
  empty;
- **positive controls for Timeline and Sketch**, the two paid paths nothing held. Timeline goes in
  the focused suite, through the real bar. Sketch cannot: its gesture is the chip inside
  `DiagramPanel`, so its control is in `public-network-trace.test.tsx`, driving the real app, with
  the arriving twin beside it;
- **the store on its own** — two direct assertions on `consumeActivation` and `claimActivation`.
  Every page-level test has both synchronous gates behind it, so none of them can see atomic
  consumption alone. Sol was right that the StrictMode mutation note claimed more than it showed;
  all three mutations were run and written into the note (each gate alone: green; both deferred:
  red).

### 2f. A real browser, in a subagent

Tests going green is not evidence a reader can see it —
[browser-testing.md](../project/browser-testing.md). Click each of the five on a fresh article and
watch the artefact arrive.

**Done, and it earned its place.** Every one of the six checks passed, so it confirmed rather than
corrected the feature — and it still found the two faults underneath that nothing in the suite could
reach, both of which needed a real job spending real time against a real database to appear at all.
That is the argument for this section, made by the one run: the tests proved the rule and the browser
proved the machine.

## What we are not doing

- **No steps running in parallel on one article.** Greg chose the line, and lifting the mutex without
  first making publication compare-and-swap on the base revision converts a 409 into silent data
  loss — 260830ar § *Why within-an-article stays serial*.
- **No readiness dot in the bottom bar.** It is the other half of 260831ai and Greg did not ask for
  it now. Leaving it out also leaves out Sol's blocker 3 — the `built` payload's clash with
  `PublicArticle` — entirely.
- **No sweep for abandoned queued jobs**, and no `last_seen_at` — § 1f.
- **No reason field on `Advanced`** — § 1g.
- **The CLIs stay outside the queue.** Sol's blocker 4 is real — a panel that sees an artefact
  absent can enqueue a paid call beside a running `npm run glossary` — but several of those command
  lines were deleted on 2026-09-01 and the remainder are a developer's own foot. What changes here
  is that nothing will claim they are handled.

## The simpler option we passed over

Keep `jobs_active_slug`, and have `enqueue` **merge** the new steps into the article's existing
active job instead of making a second one. No schema change at all.

Rejected because a job's step list is its identity: `work_key` is computed from it, and `force`,
Retry, the card and the progress list all read it — so a request that mutated a *claimed* job's
steps would be racing the claimant walking them. Two jobs in a line is fewer moving parts than one
job whose contents change under the thing running it.

## What the review changed

GPT Sol, 2026-09-02, on the recut:
[the review](260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves-review-sol.md).
**NO-SHIP**, four blockers, all four checked here against the code and all four right. Its answers
to the four questions this plan opened with:

1. **FIFO with no sweep** — right to refuse the sweep, wrong as it stood, because the predecessor
   query is global and Stop is not. Answered by the enqueue ownership check in § 1f, which also
   closes a cross-owner read and write that predates this plan.
2. **`reserves_name` = the slug was minted** — *"Yes, including uploads"*, with the discriminated
   return in § 1b so the fact cannot be lost and re-inferred.
3. **Inputs at claim time** — *"The real late stages do see the predecessor's newly published
   revision. Their draft is opened after claim, and their stamps now cover the inputs they actually
   read."* And the question as asked was built on a stale fact: `summary` **is no longer a pipeline
   step** — the Summary band reads the tree that is already there. Test 1k.10 asks the question of
   `ideas` instead, and asks it of the stored fingerprint rather than of whether a file exists.
4. **Deleting the blocking path** — yes, *"once enqueue reliably returns the requested queued job"*,
   and after the invisible cross-owner blocker is closed. Both are conditions § 1g now depends on
   rather than assumes.

Three things it found that this plan had not, each folded in above: the cancelling predecessor
contradiction (§ 1f), the simultaneous-mint race that no index catches (§ 1d), and the activation
token being a protocol rather than a flag (§ 2b). Four of the proposed tests would have gone green
over a broken feature and are rewritten in § 1k with a note saying what they replace.

## Open questions, for Greg rather than for the review

1. **The migration drains.** § 1e refuses to run while any job is `queued` or `running`, because the
   alternative is guessing what `reserves_name` and `url_key` mean for rows that predate them. On a
   one-reader alpha that is a wait of minutes. Say if it should be something else.
2. **The enqueue ownership check rides along in stage 1** (§ 1f). It is small and it is in the right
   place, and it is what stops another reader's abandoned job wedging your article's line. Say if it
   should be its own piece of work instead. (It was written up first as a security fix; it is not
   one — § 1f says why.)
