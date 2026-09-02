# A per-article job queue that appends, and modes that start themselves

**Status:** planned 2026-09-02, reviewed by GPT Sol the same day and recut in response — not yet
built. Worktree `article-job-queue`, branch `worktree-article-job-queue`. What the review changed is
in [§ What the review changed](#what-the-review-changed); the four blockers are answered in § 1d,
§ 1f, § 1g and § 2b.

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

### 1a. One index becomes three

Today [`src/db/schema.ts`](../../src/db/schema.ts) § `jobs_active_slug` — unique on
`(owner_id, slug)` `where status in ('queued','running')` — does three jobs at once: reserve the
name, de-duplicate the request, and serialise the article. Each gets its own home, and **the scope
of each is a separate decision**:

| Index | On | Where | For |
|---|---|---|---|
| `jobs_one_running_per_slug` | `(slug)` | `status = 'running'` | the article mutex |
| `jobs_reserved_slug` | `(slug)` | `status in ('queued','running') and reserves_name` | name reservation |
| `jobs_active_work` | `(owner_id, slug, work_key)` | `status in ('queued','running') and not cancelling` | de-duplication |

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

A job may claim only when **no older active row exists for the same slug**, ordered by
`(created_at, id)`. Refused as
`{kind: "busy", why: "another job on this article is ahead of it"}`.

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

**It also closes something older and worse, which is why it is in stage 1 and not deferred.** Under
the *filesystem* store — no owner segment in `data/<slug>/`, and `urlForSlug` reading `meta.json`
off the path rather than through `ownedArticle` — there is no equivalent refusal, and B's job runs:
it takes A's URL onto its own record and reads and overwrites A's artefacts. That is a genuine
cross-owner read and write, gated only by which store an installation is running, and it exists
today with nothing in this plan required to reach it. There is no test for it. There will be one.
[security-map.md](../project/security-map.md) says the untrusted parties do not include another
reader; this is a place where the code has been taking that for granted rather than enforcing it.

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

## Stage 2 — a mode starts itself when you click it

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
- it retires when the GET settles as `ready`, `none` **or** `error` — not only on `none`, or an
  errored GET leaves a live token to fire against the next thing that mounts;
- clicking Ideas then Quotes quickly must not let the second overwrite and lose the first's intent.

**And one thing to decide rather than discover**: whether a started attempt keeps going after its
panel unmounts. It should — the job is server-side and the reader can come back to it — but the
alternative produces the previous review's *"clicked, but never started"* race, so it is written
down here rather than left to whichever `useEffect` cleanup happens to run.

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

### 2f. A real browser, in a subagent

Tests going green is not evidence a reader can see it —
[browser-testing.md](../project/browser-testing.md). Click each of the five on a fresh article and
watch the artefact arrive.

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
2. **The cross-owner filesystem gap is a security fix riding along in stage 1** (§ 1f). It is small
   and it is in the right place, but it is not what was asked for. Say if it should be its own
   piece of work instead.
