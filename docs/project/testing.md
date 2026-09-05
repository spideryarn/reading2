# Testing

> Start with deterministic TypeScript tests.
>
> — Greg, 2026-08-24

```bash
npm test           # once
npm run test:watch # while working
```

Run [`npm run typecheck`](typechecking.md) alongside it before committing. The two catch different
things and neither is a substitute for the other — vitest never looks at the types, and `tsc` never
runs the code.

## The runner: Vitest

Chosen 2026-08-24 against [third-party-library-selection.md](../reusable/third-party-library-selection.md).
Vitest 4 is the default for a Vite + TypeScript + ESM project in 2026 — huge amount of
docs and discussion (so plenty of pretraining data for the coding models that work this repo), a
Jest-shaped API that everyone and every model already knows, and it reads our TypeScript and ESM
with no transform config at all. Jest 30 was the only real alternative and would have meant an ESM
story we'd have to maintain, for no gain. There was no close call here worth agonising over; if
that changes, write down why.

Config is in [`vitest.config.ts`](../../vitest.config.ts), deliberately **separate** from
`vite.config.ts` — that file mounts the `/api` dev middleware and the React plugin, and a node-side
unit test should not drag either in.

Tests live in [`tests/`](../../tests), not beside the source, so the node-side `tsconfig.json` keeps
them out of the stages it checks. They are not unchecked, though: they have a project of their own,
[`tests/tsconfig.json`](../../tests/tsconfig.json), because vitest strips their types without
looking at them — see [typechecking.md](typechecking.md).

## Three lanes, and which one your test is in

`npm test` runs **three disjoint vitest projects**. You do not choose; the lane is a property of the
file, and it comes from `TEST_LANES` in
[`tests/store-migration-registry.ts`](../../tests/store-migration-registry.ts) — one manifest,
consumed by `vitest.config.ts` rather than copied into it.

| lane | who is in it | where it runs |
|---|---|---|
| `private-postgres` | every test file that reaches a database or the Storage bucket, bar the four below — most of them by opening a Postgres connection of their own, a handful (`LANES_BEYOND_THE_SCAN`) through application code or over HTTP | a database minted for **this run alone**, migrated, seeded, and dropped at the end. The bucket is **not** minted — see below |
| `shared-services` | four files bound to the stack's own `postgres`: GoTrue over HTTP for `auth-user-seeding`, `seed-admin-signin` and `admin-store`, and `db-test-create` by contract, since its job is to clone that database | the stack's own `postgres`, exactly as before |
| `unit` | everything else | nowhere. `DATABASE_URL` **and** `SUPABASE_URL` are poisoned to refused ports, so neither Postgres nor Storage is reachable |

```bash
npm test                                             # all three
npx vitest run --project private-postgres            # one lane
npx vitest run --project unit tests/arc.test.ts      # one file, in its lane
npx vitest run tests/store-comments.test.ts          # the lane is picked for you
```

**Why:** `claim` takes one global singleton row with `NOWAIT` and refuses the instant anybody else
holds it, and on this box ten worktrees each run a dev server. Two runs of an unchanged tree failed
6 and 31 files, in **disjoint** sets. The measurements, the root cause and the isolation boundary
proved rather than argued are in
[260903e](../plans/260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md); the
build is § T of
[260903f](../plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md).

**Adding a test that touches Postgres** means adding it to `TEST_LANES` — the guard in
`tests/store-migration-registry.test.ts` re-derives the universe by scanning every test file and goes
red until you do. Nearly always `private-postgres`.

That scan is **syntactic**: it looks for `pgReady(`, `new Pool(`/`new Client(` and the connecting
helpers, so it cannot see a test that reaches a database through application code — an aliased
constructor, a dynamic import, a transitive `getDb()` — and it does not look for Storage at all.
Those turn up the other way round, and then get a lane plus a declared entry in
`LANES_BEYOND_THE_SCAN` saying how each was found. There are six, all of them Storage: they talk to
the bucket over HTTP and never touch Postgres, so no `DATABASE_URL` poison could have caught them.
GPT Sol found four by reading the map against `src/store/blobs.ts`; poisoning `SUPABASE_URL` found
the other two on its first full run — including one that names no store at all and reaches the
bucket through the pipeline's own acquire step, which nothing but running it could have caught. Six
is a working door; a page of them would mean the scan needs a better predicate.

`tests/health.test.ts` was the fifth and is not one any more: it reached Postgres through the health
handler's own `getDb()` until it was given a real `pgReady(` gate, which the scan sees — so the
exemption went stale the moment the fix landed, and the guard said so before anybody had to.

### A private database is not a bare clone

It is a schema-only clone of `postgres` plus every migration, and then
[`seed-local-accounts.ts`](../../tests/helpers/seed-local-accounts.ts) puts back the `auth.users`
rows a local database is *expected* to have — the development owner, the eval owner, the local
administrator, and whatever `SPIDERYARN_OWNER_ID` names. Without them, 47 of 54 failures measured on
2026-09-03 were one foreign key: roughly fifty suites write rows owned by `currentOwnerId()` without
ever naming it. It also fills in a placeholder Stripe price on each active billing tier, which
`scripts/stripe-setup.ts` writes on a real database and a migration never can.

The cost, stated rather than discovered: **no suite can use the private lane to prove "this works
with no accounts at all"**. Nothing needs that today; something that does should mint its own
database with [`scripts/db-test-create.ts`](../../scripts/db-test-create.ts).

**Residue within one run is not isolated either.** One database serves the whole invocation, so a row
an earlier file leaves behind is visible to a later one. Per-run isolation removes dev servers, peers
and the leavings of killed runs — not the run's own.

### Storage is **not** isolated

The private lane clones the SQL. **The bucket does not move, and this stage does not move it:**
`blobStore` talks to the Storage service over HTTP and that service is bound to `postgres`, so two
runs share one bucket and `storage.objects` in a clone is permanently empty. Say it plainly — the
private lane gives you an isolated *database* and a *shared* bucket, and nothing here is per-run
about the second half.

Mostly acceptable, because every key this repo writes is content-addressed: two runs writing the
same bytes write the same object. What is **not** safe is a test that asserts on what the bucket
contains, on it being empty, or that removes and re-plants a key — and
[`tests/raw-source-store.test.ts`](../../tests/raw-source-store.test.ts) does exactly the last of
those, repeatedly, with deliberately corrupt bytes at one deterministic canonical name. Two
concurrent runs of it can destroy each other's oracle.

Six files reach Storage: `raw-source-store`, `upload-acquire`, `uploads-api`,
`an-upload-is-queued-only-once-its-bytes-arrive`, `job-failure` and
`acquire-extract-blocks-end-to-end`. They are all in `private-postgres` — the only lane that both
leaves `SUPABASE_URL` alone and runs serially — so they cannot collide **inside one run**. Two
separate `npm test` invocations still share the bucket. `LANES_BEYOND_THE_SCAN` in
`tests/store-migration-registry.ts` carries the per-file reason.

They were in the `unit` lane until 2026-09-04, reaching the real shared bucket while that lane's
documentation said it had no database; the poison covered `DATABASE_URL` and Storage is chosen from
`SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY`. GPT Sol found four of them reviewing T-D and the
new poison found two more the first time it ran, which is the argument for a semantic backstop in
one sentence.

### The lease, and the database left behind by a killed run

The run holds one dedicated connection to its own database for the whole run — a lease — so
"somebody is inside it" is continuously true rather than sampled, and another run's scavenger
(plain `DROP DATABASE`, never `WITH (FORCE)`) is refused by Postgres itself. A run that is killed
leaves its database behind; the next run's scavenger takes it once it is six hours old with nobody
inside. To see what is lying around, or to clear one by hand:

```bash
npx tsx scripts/db-test-create.ts --scavenge --dry-run
npx tsx scripts/db-test-create.ts --drop spideryarn_test_<stamp>_<uuid>
```

### The ordering trap, which is why each lane asserts where it landed

`.env.local` beats the shell, so `DATABASE_URL=… npx vitest` **cannot** redirect a test run: the
value is already in `process.env` when [`src/env.ts`](../../src/env.ts) takes its snapshot, so it
reads as inherited and `.env.local` wins. The redirect has to happen after that module has loaded —
which a plain `import` at the top of a setup file guarantees. Measured three ways on 2026-09-04;
`tests/setup/unit-no-database.ts` has the table.

Get it backwards and **nothing says so**: `src/env.ts`'s shadowing warning is suppressed when
`NODE_ENV === "test"`, which vitest sets. So each lane's setup file asserts the outcome rather than
trusting the assignment — `current_database()` over `process.env.DATABASE_URL` in
[`private-db.ts`](../../tests/setup/private-db.ts), the same against `postgres` in
[`shared-db.ts`](../../tests/setup/shared-db.ts), and a failed connection attempt in
[`tests/unit-lane-has-no-database.test.ts`](../../tests/unit-lane-has-no-database.test.ts).

**`postgres` is a name, not an identity**, so the shared lane checks a second thing: that
`DATABASE_URL` and `SUPABASE_URL` name the same stack, through `projectMismatch`
([`src/store/blobs.ts`](../../src/store/blobs.ts)), which locally comes down to the port. Every
Supabase stack has a database called `postgres` and Greg runs two on this box, so without it
`DATABASE_URL` could point at the *other* stack's `postgres` while `SUPABASE_URL` pointed at this
one's GoTrue and the control would agree. Measured 2026-09-04: pointed at the other stack, the
`current_database()` check reported `postgres` and was satisfied.

**And an assignment does not cross `spawn`.** A child inherits the poisoned value before it loads
`src/env.ts`, so the poison becomes part of the *child's* snapshot and `.env.local` puts the real URL
back — silently, for the same `NODE_ENV=test` reason. Several unit tests spawn `tsx` children. The
fix is a variable rather than an assignment: `SPIDERYARN_ENV_PINNED` (`PINNED` in
[`src/env.ts`](../../src/env.ts)) is a comma-separated list of names `.env.local` may not write, and
being in the environment it *is* inherited. The unit lane sets it to `DATABASE_URL,SUPABASE_URL`.
Nothing outside the test lanes sets it, and in production there is no `.env.local` for it to
restrain.

It is also the only way to point a run at another database from the command line:
`SPIDERYARN_ENV_PINNED=DATABASE_URL DATABASE_URL=… npx vitest …` works where `DATABASE_URL=… npx
vitest` does not.

### With Docker off, `npm test` is red — and was before the lanes existed

Worth writing down because two documents claimed otherwise. Files that go through `pgReady` skip
loudly; a dozen private-lane files do not, because their fixtures reach the database outside any
gate. Measured 2026-09-04 with `DATABASE_URL` pointed at a dead port: **12 files failing** under the
three-lane config, and **9 of the same 10 sampled** under the single-project config from before the
lanes, for identical reasons. The lanes did not cause it. `tests/health.test.ts` was the one file
the lanes could have been blamed for, and it now has a gate.

Only "the stack is not running" turns into a skip, and it has to say so itself: the factory raises
`StackUnreachable` from the three places that can mean nothing else, and
[`private-db-global.ts`](../../tests/setup/private-db-global.ts) skips on that class alone. Until
2026-09-04 it skipped on *any* error, so a failed dump, a failed restore, a cluster mismatch or a
failed migration all printed "no private database" and skipped ninety suites.

### `TEST DATABASE CONTENDED`

If a job suite fails with that banner, the run is **not a product verdict**: something outside the
suite held the queue singleton. It should be rare now — that is what the private lane is for — and it
still fires for the four `shared-services` files and for anything running against `postgres` by hand.
No retry, ever: a retried contended run is a green that conceals a real queue regression.
[`tests/helpers/expect-claimed.ts`](../../tests/helpers/expect-claimed.ts) names the four reasons.

When a `shared-services` test fails, the lane now prints **who else was inside `postgres`** at that
moment — pid, application name, user, state, connect and last-statement times, wait event, and never
the SQL, which carries article prose.
[`tests/setup/shared-db.ts`](../../tests/setup/shared-db.ts) does it from an `onTestFailed` hook.
Read it as a place to look and nothing more: a peer that wrote the row and committed is already gone
by the time the assertion fails, and an idle stranger did nothing at all. Sessions the app named
itself are listed separately from ones it could not — `spideryarn <worktree>:<pid>` is
[`src/db/client.ts`](../../src/db/client.ts) § `applicationName`, so a blank name in that report is
now somebody who is not us.

### `POLLUTED`

A different verdict again, and it can only come from the `private-postgres` lane, at teardown:

```
  [private lane] ================================ POLLUTED ================================
  [private lane] spideryarn_test_… was minted for this run alone, and it was not this run's alone.
```

The run's own database is minted for it, leased for its whole life and dropped afterwards, so a
**stranger** inside it is a verdict rather than noise — and unlike `CONTENDED` it **fails the run**:
`process.exitCode = 1`, because a `throw` from a global teardown is only *logged* by vitest and exits
0 ([`tests/setup/private-db-global.ts`](../../tests/setup/private-db-global.ts) has the measurement).

Two things can raise it, and the second is the stronger: the sessions enumerated just before the
lease closes, and an ordinary non-forced `DROP DATABASE` that Postgres then refuses — which settles
the check-to-drop race atomically rather than by sampling twice. For that second one to mean
anything, this run's own leftover backends are **terminated by pid first**; otherwise one of ours
guarantees the refusal and a stranger who came and went contributes nothing distinguishable. Either
way the sessions are classified before anything is decided, and the database is dropped afterwards —
`WITH (FORCE)` wherever the ordinary drop did not land — so no verdict ever also leaks one.

A fourth banner, `TEARDOWN FAILED`, is a **different claim**: the sample, the lease close, the drop,
the re-read or the forced cleanup did not work, so the check that would have told us never ran. It
also fails the run, and it deliberately does not say anybody was inside.

**Who counts as a stranger.** Everything except this run's own workers, which name themselves
`spideryarn-test-private-<vitest pid>` — [`tests/setup/private-db.ts`](../../tests/setup/private-db.ts)
puts that in `PGAPPNAME` before the file it precedes imports anything, and
[`src/db/client.ts`](../../src/db/client.ts) § `applicationName` honours it. The pid makes that tag
collision-resistant between cooperative concurrent runs and nothing more: `application_name` is
chosen by the client, so it is not an adversarial boundary and cannot be one while every worktree
here shares the same local superuser credential. Anything else got the
minted name from somewhere: vitest prints it, and it is in `pg_database` and `pg_stat_activity` for
anyone on this box, so the uuid buys accident-resistance rather than access control. The report names
the sessions and `application_name` is the thread to pull. Never work around it by re-running.

### The last file's pool is not pollution, and how we learned that

Teardown also prints a plain line — no failure — when the only leftovers are this run's own:

```
  [private lane] 2 of this run's own tagged connection(s) remained at teardown and were closed. …
```

That is expected, and the reason is worth knowing because **two contradictory measurements were both
correct**. One said the minted database has zero non-lease sessions at teardown (3, 15 and 99 files);
the other said 7 of 8 private-lane files leave one or two of their own `getDb()` connections behind
and trip the check. The unstated condition that reconciles them: **vitest tears down `globalSetup`
before it closes its worker pool**, so an unclosed pool outlives the run only if its file happened to
run *last* — vitest recycles the worker as soon as the next file starts. Two known leakers together
leave 2 sessions, not 4; either of them followed by a file that calls `closeDb()` leaves 0. The
full-lane runs ended on a closer; the single-file runs did not.

So the leak is real, bounded to one file's worth, and never a stranger. 71 of the lane's ~101 files
call `closeDb()` and about 29 do not; `tests/health.test.ts` and `tests/billing-tiers.test.ts` were
given an `afterAll(closeDb)` because the check caught them, and the rest were deliberately left
alone. A number that is real and unrepeatable because nobody wrote down the condition is exactly the
shape [silent-success.md](../reusable/silent-success.md) is about.

## What we test, and what we don't

Everything here is **deterministic**: no LLM calls, no clock, no unseeded randomness. `mintId`
takes its random source as an argument precisely so a test can pin it. A model call is refused
outright — [`tests/setup/no-provider-calls.ts`](../../tests/setup/no-provider-calls.ts) wraps
`fetch` and fails the request before it is sent.

"No network" used to be part of that sentence and it was never true: the `shared-services` files
talk to GoTrue over HTTP, the four Storage files talk to the bucket, and the whole
`private-postgres` lane talks to Postgres. What is true is that nothing here reaches the public
internet, and the `unit` lane reaches nothing at all.

| File | What it pins |
|---|---|
| [`tests/ids.test.ts`](../../tests/ids.test.ts) | the id format and uniqueness — [block-ids.md](block-ids.md) |
| [`tests/blocks.test.ts`](../../tests/blocks.test.ts) | what counts as a block, and **id survival across re-extraction** |
| [`tests/sanitize.test.ts`](../../tests/sanitize.test.ts) | what a hostile article may not do to the reading view — every payload verified to survive Readability first, so none is hypothetical ([security.md](security.md)) |
| [`tests/sanitize-client.test.ts`](../../tests/sanitize-client.test.ts) | the browser sanitiser, and that **both bindings are one policy** — a shared corpus must come out byte-identical from server and client, because two passes that disagree are worse than one |
| [`tests/fetch.test.ts`](../../tests/fetch.test.ts) | stage 1 with no network: the lying `Content-Length`, the Shift_JIS page, the legacy encodings Node's own decoder still gets wrong, redirect loops, and every TLS failure that arrives as the same `TypeError` — [fetching.md](fetching.md) |
| [`tests/pdf.test.ts`](../../tests/pdf.test.ts) | pass 0 over three real PDFs committed under [`evals/pdf/`](../../evals/pdf/README.md): the page count, the scan test that has to ignore the digitising library's own cover sheet, the running headers, and the hyphen-mending that stops a *correct* transcription losing recall ([260826c-pdf-ingestion.md](../plans/260826c-pdf-ingestion.md)) |
| [`tests/pdf-score.test.ts`](../../tests/pdf-score.test.ts) | **the check that a transcribed PDF is the PDF** — sixteen deliberately broken transcriptions of a hand-written page pair, one per way a model gets a page wrong, plus two committed *tolerances*. The fixture is generated by [`evals/pdf/synthetic/build.mts`](../../evals/pdf/synthetic/build.mts) rather than hand-edited, because a hand-edit broke an unrelated case every time and the failing test named neither |
| [`tests/pdf-read.test.ts`](../../tests/pdf-read.test.ts) | everything in the PDF extractor that is arithmetic rather than a model: chunk planning, the instruction, records → HTML, and the whole stage with the model stubbed out — so "a page came back empty" and "a paragraph was silently dropped" fail here, free, instead of in production at the price of a transcription. Also the chunk cache, from both sides: a damaged entry must be a miss and a valid one must **not**, counted in model calls rather than asserted about the code ([260828e-pdf-chunk-cache-corrupt-entry.md](../postmortems/260828e-pdf-chunk-cache-corrupt-entry.md)) |
| [`tests/hierarchy-flatten.test.ts`](../../tests/hierarchy-flatten.test.ts) | tree → sidebar rows — [hierarchy.md](hierarchy.md) |
| [`tests/validate-tree.test.ts`](../../tests/validate-tree.test.ts) | the validator catches each **structural** way a tree can go wrong |
| [`tests/validate-tree-rows.test.ts`](../../tests/validate-tree-rows.test.ts) | which leaves may carry a row, and label length — the **editorial** half |
| [`tests/hierarchy-build.test.ts`](../../tests/hierarchy-build.test.ts) | `buildTree` — the model's proposal → the stored tree, and leaf growth |
| [`tests/token-budget.test.ts`](../../tests/token-budget.test.ts) | that a model call's `max_tokens` **grows with the article**, and that the estimate clears what a real tree cost — written after a typed-in number failed a 360-block article ([postmortem](../postmortems/260826a-toc-max-tokens.md)) |
| [`tests/labels-batching.test.ts`](../../tests/labels-batching.test.ts) | that cutting the article into label calls loses no block, duplicates none, and **never splits a sibling set** — plus the wire format that makes a dropped label a hard error instead of a shifted list ([260826h-toc-scaling.md](../plans/260826h-toc-scaling.md)) |
| [`tests/api.test.ts`](../../tests/api.test.ts) | which directory answers a slug — and that `example/` answers for **its own slug only** — [web-client.md](web-client.md) |
| [`tests/url-state.test.ts`](../../tests/url-state.test.ts) | what a link means, and the section arithmetic behind `?at=` — [url-state.md](url-state.md) |
| [`tests/layout.test.ts`](../../tests/layout.test.ts) | column fitting: the pixel widths [granularity-zoom.md](granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them) promises, and that a wider window never shows *less* of the article |
| [`tests/keynav.test.ts`](../../tests/keynav.test.ts) | where ← / → land, and that → then ← is reversible — [keyboard.md](keyboard.md) |
| [`tests/annotate.test.ts`](../../tests/annotate.test.ts) | drawing a comment's mark over prose, and re-finding a quote whose offset went stale — [comments.md](comments.md) |
| [`tests/selection.test.ts`](../../tests/selection.test.ts) | mouse selection → a storable anchor: the minimum length, and clamping to one block |
| [`tests/comments.test.ts`](../../tests/comments.test.ts) | comment storage, and that two comments made at once don't eat each other |
| [`tests/comment-nav.test.ts`](../../tests/comment-nav.test.ts) | comments in reading order and stepping between them — including that the order comes from the block **index**, never the id string |
| [`tests/jobs.test.ts`](../../tests/jobs.test.ts) | the ingest queue's decisions — step ordering, the restart sweep, and the request parsing that stands between a POST body and `path.join("data", slug)` ([ingest-queue.md](ingest-queue.md)). **Nothing here runs a job**: queuing one fetches somebody's website and spends money at two model endpoints |
| [`tests/ingest.test.ts`](../../tests/ingest.test.ts) | what an article gets called, and whether that name is safe to make a path out of |
| [`tests/glossary.test.ts`](../../tests/glossary.test.ts) | stage 5d's deterministic halves — the matching rule (including both directions in which `\b` is wrong about an accented letter), the **richness-scored dedup** that keeps the more specific phrase, the `javascript:` URL check, the occurrence pass, and `isStale` ([glossary.md](glossary.md)) |
| [`tests/tweets.test.ts`](../../tests/tweets.test.ts) | stage 5c's deterministic halves — counting a post's characters, the artefact shape, how many posts to ask for, and **freshness through the step's `stamp`** — the first step freshness check in the repo, written as `threadIsCurrent` and folded into `sameStamp` in D0 ([260825g-tweet-thread-page.md](../plans/260825g-tweet-thread-page.md)) |
| [`tests/chat.test.ts`](../../tests/chat.test.ts) | chat's checkable arithmetic — what a conversation gets called, which whole turns go back to the model, which cited block ids are real, and what a **retry** and an **edit** are allowed to do to a stored conversation ([260826a-chat-mode.md](../plans/260826a-chat-mode.md)) |
| [`tests/converse-stop.test.ts`](../../tests/converse-stop.test.ts) | that pressing **stop** ends in a `done` and never in a throw — through `converse` with a stubbed `fetch`, on all three ways the stream can end. It goes through `converse` rather than building the message row by hand because [a test that built the row by hand](../plans/260826a-chat-mode.md#the-second-review-and-what-it-found) passed while the code did the opposite |
| [`tests/chat-route.test.ts`](../../tests/chat-route.test.ts) | that the `begin` frame names **both** rows of a turn, and names them the way the file does — driven through the real route with `fetch` stubbed, on a send, a retry and an edit. At the *join* between client and server on purpose: [the bug it pins](../postmortems/260826c-half-swapped-message-ids.md) had a thoroughly tested function on each side of it and neither was wrong |
| [`tests/turn-order.test.ts`](../../tests/turn-order.test.ts) | the per-conversation lock, on its own: that it excludes, keeps its order, lets two conversations run at once, and lets a turn queued behind a failing one through. Not that the routes *use* it — the window it closes cannot be held open from outside the process, and the test that tried passed with the lock removed |
| [`tests/chat-live-turn.test.ts`](../../tests/chat-live-turn.test.ts) | what a second tab can do to an answer the first one is watching — a stale retry must not stop it on its way to a 409, and a stop must name the *attempt* it was pressed on rather than the row, which a retry reuses. Needs a genuinely live stream, so `fetch` returns a body that says one word and then hangs |
| [`tests/chat-client.test.ts`](../../tests/chat-client.test.ts) | the client's half of the same contract — `withServerIds`, which believes the server about what things are called, and `withoutEmpty`, which decides whether a conversation nobody spoke in ever existed |
| [`tests/client-imports.test.ts`](../../tests/client-imports.test.ts) | that nothing under `src/web/` can reach a server module — a rule with a bundle-size measurement behind it, not a preference |
| [`tests/article-prompt.test.ts`](../../tests/article-prompt.test.ts) | that the **cached prompt prefix is the same bytes** whatever is being asked — across two questions, two selections, two reading positions and a growing conversation — and that `←READER IS HERE` never gets back into the article body, which is what made explain uncacheable for its whole life. It cannot prove anything is *cached*; only [`evals/prompt-caching.ts`](../../evals/prompt-caching.ts) can ([prompt-caching.md](prompt-caching.md)) |
| [`tests/article-cache-group.test.ts`](../../tests/article-cache-group.test.ts) | **which stages share a cached article, and whether paying for one is worth it** — that arc and tweets are in a group and glossary is not (because `output_config.effort` is part of the cache key, which was measured, not assumed), and that an ordinary ingest marks no breakpoint at all, since nothing runs behind `arc` to read it. Both of those were wrong once and neither could throw |
| [`tests/doc-links.test.ts`](../../tests/doc-links.test.ts) | every reference to a doc resolves — **file and anchor**, in source comments as well as markdown |

The validator has two test files on purpose. Structural failures exit non-zero because a broken
partition draws a wrong article; editorial ones only warn, because failing a build over clumsy prose
teaches everyone to ignore the validator. Splitting them also lets the two be edited without
colliding.

Two of these — `annotate` and `selection` — run under **jsdom** rather than the node default,
declared per-file with
`// @vitest-environment jsdom` so [`vitest.config.ts`](../../vitest.config.ts) stays node-only. That
is not convenience: the offset space comments are anchored in is *defined* as what the browser's
parser produces, so a hand-rolled equivalent tested under node would pass against itself and
disagree with Chrome. See [comments.md § The offset space](comments.md#offset-space).

**Not tested, on purpose (for now):**

- **The model call itself.** Stage 4 generation is nondeterministic and costs money. The guard for
  that output is [`src/validate-tree.ts`](../../src/validate-tree.ts) run against real artefacts —
  see [granularity-zoom.md § The tree](granularity-zoom.md#the-tree). Note the split, though:
  `buildTree` in [`src/hierarchy.ts`](../../src/hierarchy.ts) is the *deterministic* half of stage 4 — it takes
  the model's parsed proposal and grows the leaf layer — and it is exported and tested precisely so
  that only the genuinely nondeterministic part is untested.
- **The React reading view.** No DOM tests yet. When they arrive: `environment: "jsdom"` and
  `@testing-library/react`, and start with [`src/web/tree.ts`](../../src/web/tree.ts) `buildGeometry`,
  which is pure and is where a rowSpan bug silently draws a wrong article.

  **The gap is bigger than "no DOM tests" sounds, and 2026-08-25 measured it.** Adopting Tailwind
  produced three bugs the whole suite was blind to: a generated `.outline` utility drawing a border
  round the table, unlayered CSS outranking every utility we meant to write, and `dark:` rules that
  applied or not depending on the *viewer's* OS setting
  ([web-client.md § Four guards](web-client.md#four-guards-all-in-tailwindcss)). Every one produced
  valid CSS that rendered. None of them could have gone red here, because nothing renders React and
  nothing computes a style — and the third could not have gone red in a DOM test either, since jsdom
  has no OS to ask.

  So this is the moment to reconsider `@testing-library/react`, and also the moment to be honest
  about its ceiling: it would have caught the class names, not the cascade. Anything that depends on
  the *resolved* value has to be checked in a real browser
  ([browser-testing.md](browser-testing.md#do-not-judge-colour-from-a-screenshot)).
- **Readability itself** ([content-extraction.md](content-extraction.md)). Needs a large fixture
  corpus. Worth doing when extraction bugs start costing time.

  **Fetching used to be on this list, and the reason it came off is worth copying.** It looked
  untestable for the same reason — "it needs the network" — and it wasn't: `fetchDocument` takes its
  fetch, clock, sleep, DNS lookup and jitter as arguments, so a redirect loop, a certificate with a
  missing intermediate and a body three times its declared size are all ordinary unit tests
  ([fetching.md](fetching.md)). What genuinely needs the network is finding out *what servers
  actually do*, and that is a research task whose output is fixtures, run once, not a test.

  The evidence that it was worth doing: running the finished module against real URLs still found a
  bug that 65 passing tests had missed — `dns.lookup` hangs its error code somewhere different from
  `fetch`, so every unresolvable domain was being reported as a generic connection failure.
  **Offline tests and one real run catch different things**, and neither replaces the other.

## Why the docs have a test

Unusual enough to justify. Doc rot bit three times in one session, and always the same way: **a
stale anchor resolves silently to the top of the page.** You click it, land somewhere plausible, and
never learn it stopped taking you where it said. Renaming a heading breaks every link into it, in
files you weren't editing, with no signal anywhere. Given how heavily this repo cross-links by
policy (AGENTS.md § How we write docs here), that is a standing tax, and one grep pays it.

[`tests/doc-links.test.ts`](../../tests/doc-links.test.ts) checks the **working tree**, not committed
state, and that choice is the whole design. Several agents edit this repo at once, so one renaming a
heading can turn another's link red mid-flight; the tempting fix is to read `git show HEAD:…` so
in-flight edits are invisible. That gets it backwards. The rule here is to run `npm test` before you
commit, so checking the working tree is what stops a broken link *landing* — checking committed state
could only tell you it already had. A red result is always a one-line fix and always a real one.

**It covers source comments, and that is the case it exists for.** All three stale anchors that
prompted it were in comments — `Spine.tsx`, `tree.ts`, `styles.css` — and not one was in a markdown
file, so the first version of this test went green on every bug it was written in response to. That
was caught by mutation-testing it rather than by trusting it green, which is the same move as
everything else in this section: *a test that only ever runs green is indistinguishable from a test
that matches nothing.*

**Known wrong, and deliberately not fixed: `slug()` disagrees with GitHub on repeated spaces.** It
collapses whitespace runs (`\s+` → one hyphen); GitHub's slugger replaces each space *individually*.
So a heading with an em-dash — `## Stage 4 — an invoice…` — loses the dash as punctuation and leaves
**two** spaces, and GitHub's real anchor is `stage-4--an-invoice…` while this gate demands
`stage-4-an-invoice…`. The gate therefore **passes links that are broken on GitHub and rejects the
ones that work**, which is the failure shape the paragraph above is about, in the checker itself.

Measured 2026-09-04: 1184 headings in `docs/` contain an em-dash, against 502 same-file anchor links
of which **3** are in the GitHub-correct form. So the repo has consistently written links to satisfy
this gate, and correcting `slug()` would redden hundreds of links across files many agents have open
at once. Left alone on cost, not on merit. **Write anchors the way the gate wants** — one hyphen —
and know they are wrong on github.com; the rendered docs are read locally and in editors far more
often. Fixing it properly is a whole-tree sweep and wants to be its own job.

Comments need their own rule, because they don't use markdown link syntax. A bare
`granularity-zoom.md#the-tree` is resolved against the **docs** directories, not against the source
file that mentions it — `granularity-zoom.md` written in `src/web/tree.ts` means
`docs/project/granularity-zoom.md`, not `src/web/granularity-zoom.md`.

The one allowlist is `styles/tokens.css`, which cites the *original* app's own docs under a `Source:`
line naming that repo's absolute path. Those are correctly dangling here and are listed explicitly
rather than inferred: a rule like "the directory doesn't exist, so it must be external" would also
swallow a typo in a directory name, which is exactly a break worth catching.

It knows two more things beyond slugifying headings, both learned the hard way:

- **Explicit `<a id="…">` tags count.** `architecture.md` and `open-questions.md` both use them, and
  their anchors bear no relation to the heading above. A checker that only slugifies headings reports
  those as stale, and they aren't.
- **Headings inside code fences are not headings.** A `# comment` line in a shell block would
  otherwise mint an anchor that doesn't exist.

The first assertion in the file checks that the link parser found any links at all — a regex that
silently matched nothing would make everything below it pass forever.

## Sweep a continuous input; don't sample it

Where a function takes a continuous input — a window width, a scroll offset — assert the **shape** of
its output over the whole range rather than its value at a few widths someone thought to name.

`fitView` is the case that earned this. It was checked by hand at 1600, 1400, 1000, 860 and 700, and
looked right at every one. It was wrong between them: the spine's labels appeared at a fixed 1100px
and the rail's own growth ate two gist columns, so 1099px showed three levels and 1100px showed one.
(The labelled rail was deleted on 2026-08-26 and the spine is now one fixed width, so that
particular cliff cannot come back. The sweep stays — it is what would catch the next width somebody
spends conditionally.)
Widening the window removed context. **Non-monotonicity is invisible to sampling by construction** —
every sampled point is individually plausible, and the defect lives only in the relationship between
them. A sweep from 320 to 2600 asserting "no width ever shows fewer columns than a narrower one"
found it immediately.

The property outlives the numbers, too. The pixel assertions in
[`tests/layout.test.ts`](../../tests/layout.test.ts) hold only until someone deliberately changes a
constant; "wider is never worse" holds through every future change to all of them.

Those pixel assertions are nonetheless **deliberately coupled** to the widths quoted in
[granularity-zoom.md](granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them), so
that changing a constant breaks the tests and forces the doc to be edited in the same breath. A doc
quoting numbers the code no longer produces is worse than a doc quoting none.

## The three things to know before adding a test

1. **`example/` is a fixture as well as a placeholder.** Several tests read
   [`example/blocks.json`](../../example/README.md) and `example/tree.json`. Changing them by hand
   can break tests — that's the point; it's the only guard the hand-authored fixture has.
2. **`src/validate-tree.ts` is a CLI**, with top-level `await` and `process.exit`. It's exercised as
   a subprocess, so its tests are slower (~1.5s) than everything else combined. If it ever grows a
   pure `validateTree(blocks, tree)` export, move those tests to it.
3. **Which artefact store to hand it, and never `createFsArtifactStore`.** Three answers, and the
   choice is *what the test is about* rather than what is cheapest to construct:
   - the test is about **an article existing in Postgres** — a route, a reader, a comment to hang
     somewhere: [`scratchArticleInPg`](../../tests/helpers/scratch-article.ts), or
     [`loadArticleIntoPg`](../../tests/helpers/load-article.ts) when the corpus slug itself is the
     subject. Both read the fixture tree through
     [`fixture-artefacts.ts`](../../tests/helpers/fixture-artefacts.ts) and write through the real
     `pgArtifactsIn`;
   - the test is **not about storage** and just needs somewhere for a stage to put its product:
     [`memoryArtefacts()`](../../tests/helpers/memory-artefacts.ts), or `memoryArtefactsFrom(root,
     slug)` to start from a fixture on disk. It applies the same shape rules as the real stores;
     it **copies on the way in and out**, so a value it handed you is not the one it holds, like
     both real stores and unlike a `Map`; and it deliberately does **not** put
     `extractedHtml` and `stampedHtml` at one address the way the filesystem does;
   - the test is about **a job**, and the article is only there so the job may name it:
     [`bareArticles`](../../tests/helpers/bare-article.ts), which inserts an `articles` row and
     nothing else. Five suites needed it the day `enqueue` started refusing a bare-slug request for
     an article the reader does not have (2026-09-05), and a bare row is enough because
     `articleExists` left-joins the published revision on purpose — an article whose ingest crashed
     still counts as existing;
   - the test really is about **the adapter** — that is stage G's cohort, and the answer is in
     [`store-migration-registry.ts`](../../tests/store-migration-registry.ts).

## Rendering a component, without a testing library

`tests/job-failure.test.ts` renders `JobProgress` with **`renderToStaticMarkup` from
`react-dom/server`**, asserting on the HTML string. It is the cheapest way to render a React
component here, and the shape is worth knowing before the next one:

- **No new dependency.** `react-dom` is already here; `@testing-library/react` is not, and adding it
  is a library decision that would need its own write-up
  ([../reusable/third-party-library-selection.md](../reusable/third-party-library-selection.md))
  rather than arriving as a side effect of one test.
- **It runs in the default `node` environment**, not jsdom. Server rendering needs no DOM, so this
  costs nothing — unlike `tests/annotate.test.ts` and `tests/search-hits.test.ts`, which really do
  need a parser and say so at the top of the file.
- **Type the props object as `ComponentProps<typeof Component>`.** An inferred object literal makes
  `status: "ready"` a literal type, and a spread that overrides it then fails to typecheck for a
  reason that has nothing to do with the test.

**What it cannot see is anything about CSS** — position, colour, whether the band is actually where
it should be. It renders one pass of markup, so it also cannot see anything that happens on a click.
That still needs a real browser ([browser-testing.md](browser-testing.md)), and calling this a
render test rather than a UI test is what keeps the difference visible.

Worth it here because the thing being checked is a **silence**: what a failed job says to the reader
is a sentence nothing else in the suite reads, and a card that offered a Retry for a failure retrying
cannot fix looks exactly like one that could.

## What an upload's tests are for

Four files, and each of them exists because of a specific way this could report success while being
broken. Worth reading as a group before adding to them
([ingest-queue.md § Uploading a PDF](ingest-queue.md#uploading-a-pdf) is the feature):

- [`tests/blobs.test.ts`](../../tests/blobs.test.ts) — the object store gives back the **exact
  bytes** it was given (a NUL, a lone `0xFF`, a stray continuation byte: every one survives a
  `Buffer` round trip and none survives a `toString()`/`from()` one), and `putIfAbsent` never
  overwrites. Refuse-over-the-cap rather than truncate, because a prefix of a PDF is a corrupt PDF
  that hashes to a real-looking number.
- [`tests/upload-records.test.ts`](../../tests/upload-records.test.ts) — **two simultaneous claims,
  exactly one winner**. That is the one that costs money if it is wrong.
- [`tests/uploads-api.test.ts`](../../tests/uploads-api.test.ts) — what a request may *name*. A test
  that only checked for a 400 would pass while refusing for entirely the wrong reason, so these
  assert the shape rather than the status where they can.
- [`tests/upload-acquire.test.ts`](../../tests/upload-acquire.test.ts) — the byte checks, and the
  checksum one is a **same-length** substitution on purpose: a length check would otherwise catch
  it and the test would pass while the hash comparison did nothing at all.

**The Supabase adapter is deliberately not unit-tested.** What it actually gets wrong is that
Storage answers HTTP 400 for *both* "missing" and "duplicate", with the real status buried in the
body as a string — and a mock would agree with whatever the code believed about that. It is checked
by running the real thing, which is the same reasoning as the model calls below.

## Evals are not tests, and live in their own folder

[`evals/`](../../evals) holds things that call a model. They cost money, take minutes, and give a
slightly different answer each time, so they are run **by hand** when a decision needs them and are
not part of `npm run test`. Their results are committed under `evals/results/`, which is the point:
the next change gets compared against a number rather than against somebody's memory of last week.

The first one, [`evals/hierarchy-labels.ts`](../../evals/hierarchy-labels.ts), exists because the label split
([260826h-toc-scaling.md](../plans/260826h-toc-scaling.md)) makes a claim no deterministic test can check — that
labels written in separate parallel calls are as good as ones written in a single pass. It measures
coverage, length, template repetition, vocabulary retention, and the seam test, over artefacts that
already exist, so the eval itself calls nothing and is cheap to re-run.

It earned its keep on the first run: vocabulary retention caught the batch prompt turning the
author's "technorati" into "technologists", which every other check was happy with.

Two habits it made explicit and worth carrying to the next eval:

- **A verdict line is read as a conclusion, so do not print one at all unless the numbers support
  one.** The first version announced "seams look worse" off eight pairs differing by half a
  percentage point. The second added a minimum sample below which it said "too few to tell", which
  looked like rigour and was not — a floor cannot rescue a statistic with no error bar, and printing
  a threshold implies one. The verdict is gone; the numbers are printed and the reader is told that
  is all they are.
- **Excluding something from a measure asserts a fact about it.** The eval stopped counting heading
  labels in its length and vocabulary numbers because a heading's label is *required* to be the
  heading copied exactly — and the model was not copying it exactly, on 9 of 36 labels. The exclusion
  hid the bug it was justified by. When you exclude a population because of a rule, check the rule.
- **Keep the incumbent.** The previous whole-pass trees were the only baseline available, and they
  only existed because they were on disk before the change ran. Snapshot before you overwrite.

`evals/` is typechecked by the root `tsconfig.json` — it runs the same way the pipeline stages do.
The typecheck guard ([typechecking.md](typechecking.md)) is what noticed it belonged to no project.

### An eval run in a worktree measures the fixture cut, not the corpus

`npm run worktree:setup` fills `data/` from `tests/fixtures/data-root/`, and those are **fixture
cuts**: `data/constitution` is 84 blocks in a worktree and 360 in the primary. So an eval run there
silently measures short articles while the write-up names long ones — which cost a session's
headline numbers on 2026-09-04, found by GPT Sol reading `run.json` rather than the write-up.

Every result row already carries `blocksSha256.matchesManifest`, and in a worktree it says `false`.
**Nobody reads it**, which is the whole problem: the eval is not wrong, it is honest and unheard.
Before quoting any eval number, check that field and the block count of what actually ran.

Do not fix it by copying the primary's corpus in. `cp -rn` skips existing files, so it appears to
work and changes nothing; copying the whole corpus brings articles the manifest does not describe.
Run evals in the primary, or make the cut deliberate and say so in the write-up.

## A known limit, pinned by a test

A block with neither text nor a `src` — in practice only `<hr>` — gets a **fresh id on every
re-extraction**, because ids are carried over by matching content and a rule has no content.
Nothing points at a rule today (it's `gistable: false`, so no Hierarchy row), but a tree leaf anchored to
one goes stale. `tests/blocks.test.ts` asserts the current behaviour so that fixing it is a
deliberate act rather than an accident. See [block-ids.md](block-ids.md).

## A test that spawns a process needs its own timeout

Vitest's default is 5 seconds. That is generous for a function call and meaningless for anything that
starts `tsx`, which has to compile the script and its imports before it does the thing you are
testing.

On 2026-08-28 all four cases in `tests/store-export-fails-closed.test.ts` went red at
`Test timed out in 5000ms`, each taking 11-19 seconds. Nothing was wrong with the code or the tests:
the machine had a load average of **108** and 56 vitest workers alive, because six sessions were
sharing one laptop. The same file passes with a realistic ceiling, and a mutation still reddens
exactly the cases it should — so the ceiling did not weaken anything.

The cost of that red was not the failure, it was the **wording**. "Timed out" reads like a hang, so
it gets investigated as one. Half an hour went on a number.

So: **if a test shells out, give it an explicit timeout and say in a comment why that number.** Sixty
seconds is the convention here (`tests/pdf-read.test.ts`, `tests/store-export-fails-closed.test.ts`).
Being generous costs nothing except when something really is stuck; being tight costs whoever is
unlucky.

Most of the child-process suites here do not do this yet — `tests/db-tls.test.ts` and
`tests/no-undeclared-spend.test.ts` among them, though both shell out to `openssl` and `git` rather
than to `tsx`, so they start in milliseconds and the exposure is smaller. They are fine on an idle
machine and are the first things to go red on a busy one, which is exactly when you are least able to
tell a real failure from a slow one.

**`tests/lockfile.test.ts` is not one of them, and used to be named here as though it were.** It has
had `SPAWN_TIMEOUT = 60_000` since `96c7661e` — added at 12:03 on 2026-08-28, five hours *before*
`3ed5741e` wrote the sentence above listing it as an offender, in the very commit whose subject is
*"Five seconds is not a timeout for a test that starts tsx, it is a load test"*. Corrected 2026-09-03.
The lesson is not about this file: a paragraph that names offenders is a list that goes stale
silently, because fixing one is never the same edit as un-naming it.

**And the paragraph's own prediction came true on 2026-09-03.** A `npm run check` run on a box
carrying eleven worktrees came back with seven failures. Six were 5-second timeouts in suites that
pass in isolation; the seventh was a real regression that a guard had caught. Telling them apart cost
a second full pass, and the expensive half was not the re-run — it was that the noise and the signal
were indistinguishable until it finished.
[260903d](../plans/260903d-improve-the-codebase-second-sweep.md) § T1.2.

## A green run here proves less than it looks like

`npm test` is green on Greg's laptop, and partly because of state that is not in git. Measured
2026-08-27 in a worktree of HEAD:

- **Clean checkout: 26 test files fail.** The client ones cannot even be *collected* without
  `VITE_SUPABASE_URL`, because `src/web/lib/supabase.ts` throws at module load. The pipeline and
  store ones `ENOENT` on `data/`, which is gitignored and holds accumulated fixtures.
- **With `.env.local` linked and `data/` copied in: 5–6 failures** — the genuine state of HEAD on a
  busy day.
- **About a dozen Postgres suites turn themselves into `describe.skip`** when `DATABASE_URL` is
  unreachable. A run with no local Supabase is green *having run none of them*.

So: check `npm run db:status` is up before trusting a green run, or the Postgres half never ran — or
run it under [`REQUIRE_POSTGRES=1`](#when-a-skip-is-not-acceptable-require_postgres1), which turns
that skip into a failure and is the answer when a green run is about to be used as evidence. And
when judging whether HEAD itself is broken, reproduce in a worktree with `node_modules` symlinked,
`.env.local` linked and `data/` **copied** (tests delete under it) — not in the shared working tree,
which always carries other agents' edits. "26 files fail" from a clean checkout is this, not a
broken commit.

### Run the suite in tmux, because a killed run and a passing run look the same

**A backgrounded `npm test` on the remote box is killed under load and reported as a success.**
Measured 2026-09-03 at load ~100: the run took SIGTERM, emitted nothing, and the harness announced
*"completed (exit code 0)"* — because that is the wrapper's status, not the suite's. A subagent hit
the same thing the same day by passing `--reporter=basic`, which vitest 4 does not have: the run
never started and was again reported as exit 0.

So run it in `tmux` and judge it by the suite's own `Test Files` line, never by an exit code that
reached you through something else:

```
tmux new-session -d -s gate "npm test -- --reporter=dot > LOG 2>&1; echo EXIT=\$? >> LOG"
```

"It never ran" and "it passed" are indistinguishable from outside, which is the family this whole
section belongs to — [silent-success.md](../reusable/silent-success.md).

### `.env.local` is loaded into tests

`vite.config.ts` calls `loadEnvLocal()` at config load and vitest uses that same config, so
**`.env.local` is in `process.env` while tests run**. Nothing in `tests/` mentions it, so a fixture
looks complete when it is not, and the failure only shows up somewhere without the file. On
2026-08-27 a control asserting "with a complete environment there are no warnings" passed while the
fixture never set `VITE_SUPABASE_URL` — `.env.local` was supplying it.

In any test that reads `process.env`, stub **every** name explicitly with `vi.stubEnv`, including
the ones you expect to be absent (stub those to `""`), and `vi.unstubAllEnvs()` in `afterEach`.
Never rely on a variable being unset.

**The one that bit hardest is `SPIDERYARN_OWNER_ID`**, because nothing in the failure mentions an
owner. `scripts/setup-local.ts` writes it into `.env.local`, so on any machine that has run the
local setup — the remote box since 2026-08-31 — `currentOwnerId()` outside a request is a seeded
admin user rather than `DEV_OWNER_ID`. A test that queues a fixture under the constant and then
calls owner-scoped code gets `store.claim` answering `gone`, or *"the fixture job is not in the
store"*: thirteen cases across `tests/jobs-walk.test.ts`, `tests/jobs.test.ts` and
`tests/retry-is-only-for-a-failed-job.test.ts` failed this way on 2026-09-01, all of them green on a
laptop that had never run the setup.

**Put the owner in scope rather than assuming it.** `runAsOwner(OWNER, body)` beats the environment
— that is what [`tests/owner-isolation.test.ts`](../../tests/owner-isolation.test.ts) pins — and
`tests/claim-session-files.test.ts` has advanced that way since it was written. Where a claim has to
be the fixture's *own*, ask `currentOwnerId()` instead of writing the constant. Pinning the variable
for the whole suite is the fix that looks obvious and is wrong: the corpus in the local database
belongs to the machine's owner, so it makes `store-parity`, `store-roundtrip` and
`store-shelf-reads` fail instead. Tried on 2026-09-01 and taken back out.

### A failed `beforeAll` reports its tests as *skipped*

A pg fixture whose `beforeAll` threw on a foreign-key violation printed:

```
 Test Files  1 failed (1)
      Tests  36 passed | 2 skipped (38)
```

The cause appears only in a `Failed Suites` block further up, so the habitual filter
`grep -E "×|Tests "` showed `36 passed | 2 skipped` and a structurally broken fixture read as green.
A suite that cannot set up has no results to report, so "skipped" means two unrelated things —
*deliberately excluded* and *its setup exploded* — and the summary line cannot tell them apart.

**Read `Test Files` as well as `Tests`.** `Test Files n failed` with fewer failed tests than failed
files means a suite died in setup. When a test you just wrote reports as skipped, look for a thrown
`beforeAll` before looking for a skip marker, and re-run without the grep.

### `localStorage` is undefined under jsdom

In a `// @vitest-environment jsdom` test, `document` and `window` exist and `location` is
`http://localhost:3000`, but **`typeof localStorage === "undefined"`**: Node's own global shadows
jsdom's and stays disabled without `--localstorage-file`. The `ExperimentalWarning` it prints is
easy to lose in vitest output.

Any code reading `localStorage` behind a `typeof` guard therefore takes the "no storage" branch and
does nothing, in silence. On 2026-08-27 that made the whole offline cache a no-op — every read and
write declined, nothing was ever saved, and the tests stayed green. In a test, `vi.stubGlobal` a
Map-backed fake rather than assuming jsdom provides one; in the app, don't let `localStorage` be the
only home for something the rest of a feature depends on (a Safari private window has it, and
*throws on write*).

## Nothing under `tests/` may call a paid provider

[`vitest.config.ts`](../../vitest.config.ts) loads
[`tests/setup/no-provider-calls.ts`](../../tests/setup/no-provider-calls.ts) into every test file.
It wraps `globalThis.fetch` and **refuses, before the request is sent**, anything addressed to a host
in `PROVIDER_HOSTS` ([`src/spend-declarations.ts`](../../src/spend-declarations.ts) — the same list
[`tests/no-undeclared-spend.test.ts`](../../tests/no-undeclared-spend.test.ts) reads, so there is one
copy). Everything else, a local Supabase included, goes through untouched; this is not an offline
switch.

It exists because two tests made real OpenRouter calls and stayed green —
[260901g-a-unit-test-that-bought-inference.md](../postmortems/260901g-a-unit-test-that-bought-inference.md).
The file that did it carried a header saying the key was absent under vitest. It is not, and it never
was: see [§ `.env.local` is loaded into tests](#envlocal-is-loaded-into-tests). **Any test that
reaches a model call reaches a real one.**

Four things follow:

- **Stubbing `fetch` yourself still works, and is still the better answer.** `vi.stubGlobal("fetch",
  spy)` replaces the guard for the length of the stub, and asserting on the spy makes *"no model was
  asked"* something you measured rather than an error you did not see. The guard is the backstop for
  the tests nobody thought to write one for.
- **Refusing is not enough, so refusals are recorded.** An `afterEach` fails any test during which a
  request was refused — even if the test, or the code it was driving, caught the error and carried
  on reporting *"the model returned nothing"*. That is the case the guard is really for, because it
  is the one that stays green.
- **The opt-out is a function call**: `allowRealProviderCalls("reason")`, from
  [`tests/setup/provider-guard.ts`](../../tests/setup/provider-guard.ts). It prints the reason, so a
  run that spends money says so in its own output. There is no environment variable, because one
  exported in a shell profile exempts every run on that machine and says nothing.
  `grep -rn allowRealProviderCalls tests/` is the audit; as of 2026-09-01 no test takes it.
- **A test that replaces `globalThis.fetch` gets it put back at the end of its own test.** The guard
  keeps the wrapper it installed and answers *"am I installed?"* by comparing identity, because the
  first version asked a boolean — and a boolean says *yes* for a wrapper somebody has assigned over.
  It **restores and does not fail**: by the time the check runs, whatever the test was going to send
  has been sent, so failing would be a guess rather than a measurement, and it would redden the many
  files that legitimately stub `fetch` for their whole length. What restoring buys is the tests that
  come *after* — before this, one test swapping the global left the rest of its file unguarded.

It is **a tripwire, not a boundary** — the same thing `no-undeclared-spend` says about itself. Four
things walk past it: `node:http` or `node:net` used directly; a subprocess; a stub that delegates to
`undici.fetch` or to a transport it captured itself; and a provider host that is not in
`PROVIDER_HOSTS`. Only the last is narrowed, and only partly — the guard's own test scans `src/`,
`evals/` and `scripts/` for absolute URLs whose *path* is one a provider charges for and insists the
host is refused. That catches a new provider written down as a literal. It cannot see one that
arrives as a dependency's default base URL: `api.anthropic.com` and `api.voyageai.com` are in the
register and appear in no source file at all.

A real boundary is a different job and nobody has costed it: denying non-local sockets *below*
`fetch` (an `undici` global dispatcher, or Node's network permission model), an allow-list for the
local Supabase and every fixture server so the suite still runs, and a separate audit of what
subprocesses do. The tripwire caught the case we actually had.
[`evals/`](#evals-are-not-tests-and-live-in-their-own-folder) is untouched: vitest's `include` is
`tests/**` only, and evals are supposed to spend money.

[`tests/no-provider-calls-guard.test.ts`](../../tests/no-provider-calls-guard.test.ts) is the
positive control — it watches the refusal happen, watches the backstop throw, watches the guard come
back after a test replaces the global, and goes red if `setupFiles` ever loses the line.

## Mocks and fixtures that manufacture green

A test about a race, an ordering or a count is usually testing its own mock. Four shapes, all hit in
one change (glossary read latency, 2026-08-27), each found only by removing the mechanism and
watching the test *not* go red:

1. **Replies that resolve instantly.** A loading flash is real but invisible inside one `act`. Hold
   every reply until the test releases it, and assert with nothing released.
2. **A mock that builds its body at reply time, not request time.** A real server reads the database
   when the request *arrives*; get this wrong and a request issued before a change is answered with
   the state after it, so "joined a stale request" and "ran a fresh one" are indistinguishable and
   both pass. Snapshot the body, then hold, then reply.
3. **Held replies released in issue order.** The newest lands last and wins by luck, with no
   ordering guard at all. Release **newest first** — that is the order that hurts.
4. **Fixtures that cannot tell the two states apart.** The same list returned for every slug makes a
   dropped reply and a landed one look identical. Make each fixture name itself.

The fixture rules that generalise, each of which passed a test against the bug it was written for:

- **Make the fixtures differ in the field the guard arbitrates.** A dedupe test whose two items are
  identical passes with the dedupe deleted.
- **A cap needs a fixture that exceeds it.** 62-character profiles hid an 80-character truncation
  from the tests, the mocks and a 550-call eval.
- **Spell the expectation out.** `toEqual(THE_CONSTANT.filter(…))` agrees with every value of that
  constant, including a wrong one.
- **Build every fake from one builder.** A hand-built flat error object passed against the exact bug
  it targeted, because it was not shaped like the real thing.
- **A control that cannot go red is evidence about the test, not the code** — see
  [silent-success.md](../reusable/silent-success.md).

Also: asserting a column constant or a projection object passes while the real query says
`.select()`. Assert the generated SQL — Drizzle's `QueryBuilder` from `drizzle-orm/pg-core` builds it
with no database and no connection.

### A source-scanning guard reads the comments too

A test that greps the tree for a bad pattern will match the **prose explaining why that pattern was
removed**, and this repo writes a lot of that prose. Both halves of
[`tests/linky-is-scoped.test.ts`](../../tests/linky-is-scoped.test.ts) did on the day it was written
(2026-09-04): the three files it had just cleaned each carry a comment quoting the offending markup
and naming the containers that style it, so re-introducing the bug left the guard green. Strip block
comments before scanning, and match a class as an *attribute* rather than as a word.

The same file offers the other half of the lesson. A guard whose sweep can come back empty — no
files matched the naming convention, no rules found in the stylesheet — passes vacuously for ever
after somebody renames something. **Assert the sweep found anything at all**, then assert what it
found.

And a related shape, from [`tests/preflight-substitute.test.ts`](../../tests/preflight-substitute.test.ts)
the same day: a checklist that records a property as *deliberately skipped in favour of something
else* has to name that something and check it is still there. Declining CSS's `font` shorthand for
two longhands, and then losing the longhands, left the checklist green over exactly the bug it was
built for — because the thing it compared against never mentions longhands.

## A suite that cannot run, and how to make it say so

A Postgres suite that finds the database behind the code should say so out loud. Getting that to
work took three attempts and two wrong conclusions, so the answer is written here rather than
rediscovered.

**Use `process.stderr.write`.** It bypasses vitest's console interception and prints under the
default reporter — the one `npm test` uses. `tests/blocks-baseline.test.ts` warns that way when
`spideryarn.revision_blocks` lacks a column `src/store/artifacts-pg.ts` selects, and names the
migration and the command to fix it.

**Everything else that looks like it should work does not.** All six were measured, by grepping a
default run for the message:

| mechanism | printed by the default reporter |
|---|---|
| `it.skip("reason in the name")` | no |
| `it.todo("reason in the name")` | no |
| `console.warn` at module level | no |
| `console.warn` inside a passing test | no |
| `ctx.annotate(msg, "warning")` | no |
| **`process.stderr.write`** | **yes** |

**The rule behind that table**, which is the part worth carrying: it is not that collection-time
output is swallowed. **Vitest 4.1.11's default reporter swallows intercepted `console` output from
anything that is not failing, wherever it happens.** The interception is the mechanism, not the
timing. That is why moving a warning into a test body does not help, and why putting the reason in a
test name does not either — the default reporter prints no passing test names at all.

**Failing instead of skipping is the wrong fix.** It reddens the suite for everyone without a local
Postgres, and a missing database is a fact about a laptop rather than a defect in the code. It is
the right fix for one run in particular, which is the next section.

**Most of the Postgres suites here still skip in silence**, because they warn with `console.warn` —
`tests/store-artefacts-pg.test.ts` is the pattern the others copied. So a `skipped` count today
usually comes with no reason at all. Until they move over: **if you see a skipped Postgres case,
re-run that file with `--reporter=verbose` before believing anything about it.** A silent skip is
[silent-success.md](../reusable/silent-success.md) in its quietest form — the count does change, so
something is visibly not happening, and only the *why* is missing.

### When a skip is not acceptable: `REQUIRE_POSTGRES=1`

A skip is right on a laptop and wrong on a machine whose working-ness is the thing being proved.
Forty-odd suites take themselves out when the database is missing, and they do it in the one part of
the summary nobody reads: a run can pass, or fail for something else entirely, with every one of
them absent. So *"the tests pass on the box"* says nothing about the half of the suite that touches
the database — [`scripts/deploy.ts`](../../scripts/deploy.ts) names the same hole as a deploy gate.

```bash
REQUIRE_POSTGRES=1 npm test
```

With that set, [`pgReady`](../../tests/helpers/pg-ready.ts) — and the five suites that hand-roll their
own probe, through `failIfPostgresRequired` — register **one failing test** instead of skipping,
naming what was missing and the command that fixes it: `npm run db:start` for a database that is not
answering, `npm run db:migrate` for one that is behind. The suite itself still skips, so the run says
`1 failed | N skipped` rather than thirty connection errors, and it exits non-zero. Unset, nothing
changes: same verdict, same warning, same silence when there is no `DATABASE_URL` at all.

**`npm run check` sets it** on its `test` gate, because that is the command whose green result gets
quoted ([static-analysis.md](static-analysis.md#the-gateadvisory-split)). So `npm run check` now needs
a database; `npm run check -- --offline` runs the same steps without the flag, and says in its summary
that the database suites were free to skip and that it is not the real gate.

Use it wherever else a green run is about to be quoted as evidence — CI, the remote box (stage 3 of
[260831x-remote-box-dev-environment.md](../plans/260831x-remote-box-dev-environment.md)), and any time you are about
to tell somebody the tests passed.

**Checking it does not work the obvious way.** `.env.local` beats the shell, deliberately and for
good reasons ([`src/env.ts`](../../src/env.ts) has them), so
`DATABASE_URL=postgresql://…@127.0.0.1:1/postgres npm test` quietly runs against the live database
and proves nothing — measured 2026-08-31, before it was believed. To exercise the unreachable branch
you need either a machine where the database really is down, or a vitest `setupFiles` that sets the
variable *after* `src/env.ts` has taken its snapshot of the environment. Three of those now exist —
§ *The ordering trap*, above — and
[`tests/setup/unit-no-database.ts`](../../tests/setup/unit-no-database.ts) is the shortest one to
copy.

## One database, many suites: the three shared resources

Vitest runs test *files* concurrently in separate forks, and there is **one local Postgres**. A peer's
`npm test` beside yours is another claimant again. Three things in that database are shared, and a
suite that ignores any of them fails in a way that looks like a product bug — which is the expensive
part, because the failure lands in whichever file lost the race rather than in the one that caused it.

**Much of what follows is now history rather than daily life**, and it is kept because the
measurements are the evidence for the design. Since 2026-09-04 the Postgres suites run in a
`private-postgres` lane — their own database, one run at a time (§ *Three lanes*) — so a peer's
`npm test`, a dev server mid-ingest and the unscoped expiry sweep are all outside it. What that lane
does **not** remove is the run's own residue, and the cooperation below is still what a new suite
should copy: the private database is per *run*, not per file.

| resource | what enforces it | how a suite cooperates |
|---|---|---|
| one job *running* per article, and its line | `jobs_one_running_per_slug` plus the predecessor rule in `claim`, and these suites share fixed fixture slugs | [`tests/helpers/run-lock.ts`](../../tests/helpers/run-lock.ts) and [`running-slot.ts`](../../tests/helpers/running-slot.ts) |
| how many jobs run at once, anywhere | a count taken inside the `queue_state` lock by `claim`, capped by `SPIDERYARN_JOB_CONCURRENCY` | **nothing, and it does not need to** — see below |
| the real articles in `data/` | nothing — it is a whole-suite window | [`tests/helpers/corpus-lock.ts`](../../tests/helpers/corpus-lock.ts) |

**There used to be a fourth, and it was the big one.** `jobs_only_one_running`, a unique index on the
constant `(true)`, allowed one `running` row in the whole table — global concurrency 1 — so *every*
job suite raced *every* other one. It was dropped on 2026-08-30 for the counted cap above
([ingest-queue.md](ingest-queue.md)). Most of the contention in the measurements below was that index;
what remains is per-article, plus whatever fixtures a suite shares with a copy of itself. The
cooperation did not change, because the leaks and the shared slugs did not.

**And the cap that replaced it is not a shared resource for these suites at all**, which is why its
row says nothing is needed. It is enforced inside `claim`, and a suite that wants a `running` row
almost always writes one with direct SQL — so the count never sees it and never refuses it. The
exception is [`tests/store-jobs-parity.test.ts`](../../tests/store-jobs-parity.test.ts), which does go
through `claim`, and it passes its own cap on every call rather than leaning on the default: a
suite-wide number would make the two cases that are *about* the cap pass for the same reason as the
forty that are not.

**Its own cap does not make it immune, and the three cases about the cap are not safe.** The count
is of every `running` row there is, so a real ingest on this laptop fills a slot in whatever number
the caller passed. Measured 2026-09-02, one dev-server ingest running: three or four of these cases
red per run — `refuses a claim that would put the machine over its cap`, `frees the running slot
once a claimant has stopped answering`, and neighbours — all of them `expected 'busy' to be
'claimed'`, all of them green in the same tree once the ingest finished. **Look for a `running` row
before believing a claim case.**

**And when there is no `running` row, the same sentence has a second cause: the queue lock, taken by
this file's own pumps.** `claim` opens by taking the `queue_state` singleton with `for update
nowait` ([`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts)), so a claim that arrives while *any*
other claim is mid-transaction is refused — `busy`, *"another claim is being decided"* — however free
the job and however empty the table. The other claimant is usually the suite itself: `enqueue`
starts a `pump`, a request handed an already-running job is given one too, and those loops go on
waking up on a 250ms→5s backoff several cases later. Measured 2026-09-04 in
[`tests/jobs.test.ts`](../../tests/jobs.test.ts) by logging every `claim` the file makes — in the run
that went red a leftover pump's claim began 19ms before the case's own and was still inside its
transaction; six job ids claimed inside 400ms. It reproduced 1 in 15 runs of the file **alone** on a
loaded box and never on a quiet one, which is exactly how a same-file race disguises itself as
interference from another file.

The remedy is not a lock and not a wait: it is to **ask again**, because that is the queue's
contract — *"whoever takes it runs; everybody else is told `busy` and asks again. The pump is not
privileged"* ([`src/jobs.ts`](../../src/jobs.ts) § `advanceJob`). A bounded retry costs a case
nothing it was proving: the failures these cases are written against — a sweep that never runs, a
claim predicate that lets a second runner in — answer `busy` *every* time, so they exhaust the
budget and still go red. `tests/jobs.test.ts` § *asking again, on `busy`* is the shape to copy.

**There is a fourth, and no fixture can hide from it: the expiry sweep is unscoped.**
`advanceJobWith` opens with `store.settleExpired()` — no owner, no slug, the whole table
([`src/jobs.ts`](../../src/jobs.ts)) — so one dev server mid-ingest settles *any* row that is
`running` with a lapsed lease, whoever wrote it. A suite whose case is about an expired lease is
therefore holding a fixture anybody may lawfully take away, and the failure arrives as `expected
null to be true`: the row is still there, and `attempt_id` and `lease_expires_at` are gone.
Reproduced on 2026-09-02 by running the sweep from a second connection while
[`tests/store-jobs-parity.test.ts`](../../tests/store-jobs-parity.test.ts) slept on its own expired
row, which is what it had been doing for two seconds. The cooperation is to **expire the lease as
late as possible** — do the waiting first, then write a lease already in the past — which makes the
window two statements rather than two seconds. Nothing closes it: a lapsed `running` row is exactly
what the sweep is for.

**The lock and the retry are both needed, and they cover different things.** `takeRunLock` is a
session advisory lock taken at module load and held to teardown, so it serialises whole *files* —
which is the only thing that helps when two copies of one file share fixed fixture slugs. But a lock
only excludes the holders that agree to take it, and a dev server mid-ingest never will; that is what
`insertWhenSlotFree`'s wait-on-the-constraint is for. Removing either brings back a different half of
the problem.

**Taking either key is only half of it — the release has to be unconditional.** Both helpers clean
up every failure inside themselves, and neither can govern what the caller does next. A suite that
takes the lock at module scope and *then* sweeps its rubble has no teardown hook registered yet, so a
statement that throws there leaves the key held until the vitest worker exits; a teardown that
deletes rows before releasing loses the release to the first failed delete. Both shapes go through
[`tests/helpers/lock-lifecycle.ts`](../../tests/helpers/lock-lifecycle.ts) —
`takeRunLockAndSetUp` and `cleanUpThenRelease` — which
[`tests/lock-lifecycle.test.ts`](../../tests/lock-lifecycle.test.ts) checks against `pg_locks` on
keys minted per run. A suite whose whole teardown *is* the release needs neither.

**Measured 2026-08-30.** Two concurrent `npx vitest run` processes over the seven job-slot files,
with the key neutralised so the lock excludes nobody: **23 to 50 failures per run** across four runs,
four to six of the seven files red, where every one of those files is green alone. With the lock
taken by all of them: **0 failures**, across four concurrent pairs and a wider nine-file set, and 162
passed / 162 passed on an independent second reading.

The spread is the point. The first version of this paragraph said "39 failures in each" — a
suspiciously equal pair, taken before a change to the teardown — and it was replaced after
re-measuring. Contention does not produce tidy numbers, so a tidy one is the reading to distrust.

**The failures do not say "contention".** They arrive as `expected 'busy' to be 'claimed'`, as
`duplicate key … articles_slug_unique`, and as `23503` foreign-key violations against a revision that
existed a moment ago — one copy's cleanup deleting the other's rows mid-flight. The other tell is the
clock: `insertWhenSlotFree`'s budget is 40 × 500ms, so a **~20,500ms** case is that budget running
out. Do not raise a timeout to make it go away.

Read the clock and the message as answering **different questions**: the clock says why the case was
slow, the assertion says what failed. On 2026-08-30 six cases failed at 20,468 / 20,438 / 20,589ms and
the duration was read as though it were the failure. It was not — the assertions were ordinary diffs
like `expected 'running' to be 'error'`, and the 20 seconds was the wait in front of them.

**A wedged row's second symptom points at the database.** The suite it blocks hangs — 316 seconds
on 2026-08-31, against 6 once the row was gone — and the *next* run then skips itself with
`DATABASE_URL is set but these tests are skipping: could not reach it: Connection terminated due to
connection timeout`. That reads as a sick database and is a knock-on from the hung run: Postgres was
fine throughout, answering in 15ms on 32 of 100 connections. **Clear the row before believing
anything about the database.**

**The claimant is usually not another suite — it is a wedged row.** That day's holder was a job left
`running` by an *aborted teardown*: `store-jobs-parity`'s `afterAll` deleted articles before jobs, the
foreign key refused, the first delete threw, and the rest of the teardown never ran. Waiting cannot
clear that, which is exactly what `insertWhenSlotFree`'s message says and why it says it. The fix was
to delete jobs first and key the teardown by slug rather than by minted ids. **A teardown that can
throw half-way through is a global-resource leak**, so order it so the last thing deleted is the thing
everything else references.

**Do not filter test output you may need later.** The only record of those six failures came through
`… | grep -E "FAIL|× |Tests |not to contain|to contain" | head -8`, which does not match
`AssertionError`, `expected` or `Received`. The timings survived and the assertion text did not, so
weeks later the transcript could still prove *how slow* the failures were and could no longer say
*what they claimed* — and two plausible explanations for them could not be told apart. Capture the run
to a file and grep the file.

**If you add a suite that starts a job**, take the lock: `pgReady` first, then `takeRunLock` only when
it reports reachable — a suite that is about to skip must not sit holding it. The one exception is a
suite long enough to dominate the queue; `tests/store-roundtrip.test.ts` runs 63 seconds and is left
out for exactly that reason, with the reasoning in the helper's header.

**To check the lock is really engaging, hold the key from outside and read the *phases*.** Take it in
a `psql` session for a fixed number of seconds and run one locked file beside it:

```
psql "$DATABASE_URL" -c "select pg_advisory_lock(918273645)" -c "select pg_sleep(25)" &
npx vitest run tests/store-job-draft.test.ts
```

Measured 2026-08-30 on a quiet machine, the same file at three hold lengths:

| key held for | import | tests |
|---|---|---|
| nobody holding it | 1.24s | 1.25s |
| 10 seconds | 7.41s | 1.28s |
| 30 seconds | **27.62s** | 2.66s |

Vary the hold rather than taking a single reading. Nothing else on the machine knows how long you
chose to hold the key, so nothing else can track it — which is what makes this survive a busy tree,
where a single before-and-after cannot tell a lock wait from a peer's test run.

**Read the slope, not the deltas.** A file does not start waiting the moment you start holding: the
lock is taken after transform and import begin, so each delta comes in short by a constant startup
offset, and read on its own each one looks like a loose match you might talk yourself out of. The
*difference between two deltas* cancels that offset exactly. Above: delta(10s) = 6.17s and
delta(30s) = 26.38s, both about 1.7s short of their effective holds — but **delta(30) − delta(10) =
20.21s against a predicted 20.00s**. That quantity is robust against the two things that could
otherwise fool you, the constant overhead and the background load, and it is the number to quote.

Run the trials **serially** — a locked file holds the key for its whole run, so a second trial
launched alongside queues behind the first and measures that instead — and start the hold before
launching vitest, or the wait is entered late and the delta is short by more than the offset.

**Nearly all of the delay lands in `import`.** That is the signature, and it is what separates a lock
wait from ordinary contention: `takeRunLock` is called at module load under a top-level `await`, which
vitest counts as import, whereas contention is *database* contention and shows up in the queries in
the test phase. Import moved by a factor of 22 across the table above; the test phase moved by about a
second, which is noise of the size this file's test phase varies by anyway — worth stating rather than
rounding to "flat", because a small movement in the test phase is exactly what a *second* claimant
would look like, and the honest reading is that this measurement cannot rule one out at that size.

The trap is the other half of the same fact: **vitest's `tests` figure can never show a module-load
lock wait.** Measure the experiment above with it and you get 1.25s against 1.28s and conclude the
lock does nothing — while measuring a phase the lock cannot touch. Two readings of one run that
disagreed this way, 2.5s and 43s, were both correct and neither was wrong to have been taken; one was
`tests`, the other wall clock including a 35-second import. Say which one you mean.

**A flake proved by re-running is not proved.** Reproduce it the way the numbers above were: two
concurrent runs of the same files, and count. A fix for a flaky failure needs the flake demonstrated
first, or you cannot tell serialisation from luck.

## Mint a fixture id randomly, not by counting

Every database-backed suite hard-codes its own uuids, inserts rows under them in `beforeAll` and
deletes them by id in `afterAll`. Files run in parallel against **one** local Postgres, so two files
holding the same id means one of them deletes the other's row mid-run and every remaining test in the
loser 404s — while passing when run alone. It is the same shared-resource problem as the section
above, minus the enforcement: no constraint, no lock, no error. The delete succeeds, the insert's
`onConflictDoNothing` succeeds, and the only symptom appears in somebody else's file.

**So generate them, don't count.** One line, and the ids are free by construction:

```bash
node -e 'for (let i = 0; i < 3; i++) console.log(crypto.randomUUID())'
```

Half the suite mints from the `00000000-0000-4000-8000-…` block, and that is exactly what makes
counting inside it dangerous: the next number that *looks* free usually is not, and there is no way to
tell a harmless clash from a destructive one by looking at the id. `tests/find-article.test.ts` took
`…c4`, `…f1` and `…f2` on 2026-08-31 and collected three collisions at once — with `source-store`,
`chat-anchor` and `publish-session-cleanup-log`. Only the `…f1` pair could actually destroy a row;
that is not a distinction worth relying on, and the file now uses random ids.

Leave the existing block-style ids alone. Rewriting them buys nothing and a shared *foreign key*
written longhand is a different problem with a different fix — import the constant, the way the suite now
does with `ADMIN_USER_ID_LOCAL` from [`src/admin.ts`](../../src/admin.ts).

[`tests/fixture-ids.test.ts`](../../tests/fixture-ids.test.ts) is what catches this, and its header is
worth reading once: it parses **every** uuid literal rather than the `const <NAME>_ID = "…"` shape,
because the first version matched only that shape and a GPT Sol review found a live collision written
as an object property that it could not see. It therefore flags harmless overlaps too — a shared owner
id, an article id against a revision id — deliberately, since it cannot know which table a literal is
destined for. The fix for a flag is a fresh random id, not an exemption. `NOT_A_ROW` is only for ids
**no** suite ever inserts, and it is keyed by uuid globally, so listing one there exempts every file
that uses it.
