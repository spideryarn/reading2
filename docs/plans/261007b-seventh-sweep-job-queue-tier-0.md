# Seventh sweep: the job queue's tier 0

Status as of 2026-10-07: built in five commits, reviewed by GPT Sol, whose fixes are a sixth and
whose one open finding (C1, a forced step bought twice) is fixed in a seventh. Not pushed: a
second, narrow GPT review of the C1 change comes first. [§ Review status](#review-status) has what
was run and what was decided.

**The five commits are titled `261007a`**, which is what this file was called until `dev` was
merged in and another plan turned out to hold that letter. It is `261007b`; the commits are these.

## Goal

The [seventh sweep](261006m-seventh-codebase-sweep-depth-umbrella.md) had two models read the
import queue line by line and then review each other. This plan builds the cluster of findings that
are live defects in [`src/jobs.ts`](../../src/jobs.ts), plus the false comments around them. Five
items, in this order, each its own commit:

1. **PQ1.** A read or a write that fails outside `runStep`'s `try` abandons a live claim: the row
   stays `running` for up to 760 s, its own next advance answers `busy`, and every other job on the
   article waits behind it.
2. **PQO1, the deadline row only.** A step that returns its product after our own deadline fired is
   ended `error` with the finished work thrown away, where a step that obeys the deadline is put
   down with its draft.
3. **PQ2.** While another claim is being decided, an advance for a job that does not exist answers
   200 with no job in it, where it answers 404 a moment later.
4. **PQO2.** A job's title is held in memory and set by `extract` alone, so a mid-step hand-back
   loses it and a `["fetch", "metadata"]` job never has one. The card shows the slug.
5. **PQ4 + PQO4.** Comments in the queue files that describe the filesystem store or the
   one-step-per-request queue, both deleted.

## References

- [ingest-queue.md](../project/ingest-queue.md): the queue's own doc.
  [§ A claimant that runs out of time](../project/ingest-queue.md#a-claimant-that-runs-out-of-time-puts-the-job-down-and-keeps-its-draft)
  is the pause items 1 and 2 reuse.
- [`src/jobs.ts`](../../src/jobs.ts) § `runStep`, `walkClaim`, `transitionAfter`, `advanceJobWith`.
- [`src/store/jobs.ts`](../../src/store/jobs.ts) and [`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts):
  the store contract and its one implementation.
- [`tests/jobs-walk.test.ts`](../../tests/jobs-walk.test.ts) § *the exits of a claim*: every case
  this plan adds. It is already in the private-Postgres lane, so the cases get a real database
  without an edit to the lane manifest.
- The evidence, not on `dev` when this was written: the four investigation docs
  `261006d-seventh-sweep-depth-pipeline-and-import-queue-{sol,opus}.md` and
  `261006d-seventh-sweep-depth-pipeline-review-{opus-on-sol,sol-on-opus}.md`.
- [silent-success.md](../reusable/silent-success.md): why each test here was watched red first and
  each fix mutated back afterwards.

## Decisions

- **The orchestrating agent set the scope, not Greg.** In scope: the five items. Out: what Stop
  does when the last step finishes anyway (below), PQ3, PQO3, PQO5, any schema change, any
  reader-facing wording.
- **Where a review corrected a finding, the review wins**, and where the two reviews disagreed the
  narrower fix was taken.
- **Retreat rule.** A fix that adds a refusal on a path an ordinary request can reach has to test
  the mechanism its "this cannot happen to a live job" argument rests on. Item 3 is the one that
  adds a refusal, and its test asserts a live job is still told to wait.

### The simpler options passed over

- **Item 1: fix only the freshness read**, which is what the first investigation proposed. Passed
  over because the Opus review counted four exits of the same shape and one fix closes one.
- **Item 1: end the job when a progress write fails**, through a fourth storage-failure door. That
  is what the Opus review sketched as a follow-up. Passed over twice: it needs a new sentence on
  the reader's card, which is out of scope, and it throws away paid work because a progress bar
  could not be written. The write is made tolerant in one place instead.
- **Item 2: keep the product and release the claim.** Passed over because `assets` returns a
  manifest in which every image it did not fetch is stamped `failed: "network"` and current; today
  that product is always discarded, and keeping it would publish it.
- **Item 4: read the title from the article at the start of each claim.** Passed over because it is
  a new awaited read on every claim, which is one more exit of item 1's shape, where the `jobs`
  row already has a `title` column that the progress write can fill.

## Left open, for Greg

**Stop pressed during the last step of an import, when the step finishes anyway.** Today the reader
gets the article if their Stop was answered by a different server from the one doing the work
(job `done`, published), and loses it if it was the same one (job `cancelled`, draft failed). Both
are one rule too many. Nothing here changes either: two characterisation tests pin today's
behaviour, labelled as an open question, so that it cannot change by accident.

## Stages

### PQ1: a failed read or progress write abandons the claim

- [x] Red, against real Postgres, in `tests/jobs-walk.test.ts`.
- [x] Fix, in `src/jobs.ts`.
- [x] `ingest-queue.md` says what happens.

**Evidence:** R against Postgres for all four exits (the reviews had the freshness read as R and
the three progress writes as C, proved from the code only; each now has a case that was red).
**Files:** `src/jobs.ts` (`runStep`, `walkClaim`), `tests/jobs-walk.test.ts`,
`docs/project/ingest-queue.md`.

**Done when** a freshness read that fails once ends the job `error` with its draft failed and its
pointer cleared, and a progress write that fails for any reason but a moved claim does not stop
the walk.

**Red.** Five cases, each leaving the request as a throw:

```
× ends the job, rather than abandoning the claim, when the freshness read fails
    Error: transient freshness read   ❯ stepIsDone ❯ runStep src/jobs.ts:1203 ❯ walkClaim
× carries on when progress write 1 fails, as the first step starts
× carries on when progress write 3 fails, as the second step starts
    Error: the database blinked   ❯ note ❯ runStep src/jobs.ts:1240 ❯ walkClaim
× carries on when progress write 2 fails, after a kept step
    Error: the database blinked   ❯ note ❯ walkClaim src/jobs.ts:3026
× carries on when the progress write for a skipped step fails
    Error: the database blinked   ❯ note ❯ runStep src/jobs.ts:1224 ❯ walkClaim
```

The abandoned rows showed themselves a second way. Each held one of the machine's six slots, so
the cases after them in the file were told `busy` and failed on `queued`, with nothing in the
failure naming the cause.

**The count.** `grep -n "await note()" src/jobs.ts` gives three (a skip, a step starting, a kept
step), and `await stepIsDone(` in `runStep`'s `if` is the fourth. Four found, four closed:

- The freshness read is caught where it is made and rethrown inside the `try`, as the power read
  and the structure read beside it already were. The job ends `error`, retryable, through the
  ordinary step failure.
- `walkClaim`'s `note` catches its own failure, logs the error's class at `warn`, and answers
  `undefined`. `StaleAttemptError` still propagates. One edit closes all three calls and any added
  later.

**How each exit settles now.**

| Exit | Before | Now |
|---|---|---|
| freshness read (`stepIsDone`) fails | throw; row `running`, lease live | job `error`, retryable; draft failed, pointer cleared; no step runs |
| progress write for a skipped step fails | the same | `warn` logged; the walk goes on to the next step |
| progress write as a step starts fails | the same | `warn` logged; the step runs, and its `beginStep` is the next write |
| progress write after a kept step fails | the same | `warn` logged; the walk goes on; a Stop from another server is read one step later |
| any of the three says the claim moved | `busy`, nothing run | unchanged, and pinned by a case |

**Left, and why.** Four more awaits in the walk can throw past the outer `catch`:
`store.pauseForDeadline`, and the three `endJob` calls that record a cancel or a failure. They are a
different class: each *is* the write that settles the job, so when it fails there is no further
write to fall back on. `walkClaim` already says so about its recovery ("a job we could not record
the ending for is not a job to report as ended"), and the lease is what covers it.

**What the investigation got wrong.** The first investigation named one exit; there were four. The
Opus review's fix for the other three was a new door and a new sentence; a tolerant write needed
neither.

### PQO1, the deadline row: a step that returns after our deadline is put down, not ended

- [x] Red, against real Postgres.
- [x] Fix, in `src/jobs.ts` § `transitionAfter`.
- [x] Today's two Stop endings pinned, labelled as an open question.
- [x] `ingest-queue.md` says what happens.

**Evidence:** R against Postgres (the Opus review reproduced it; rebuilt here as a case).
**Files:** `src/jobs.ts` (`transitionAfter`, and two comments in `runStep`),
`tests/jobs-walk.test.ts`, `docs/project/ingest-queue.md`.

**Done when** a single-step job whose step sleeps past the deadline and returns its product goes
back to `queued` with `requeues` 1, its step `pending` and its draft still a draft, and the next
claim runs the step again and publishes.

**Red.** With a 100 ms deadline and a step that sleeps 400 ms and ignores its signal:

```
× puts the job down with its draft, not ends it, when a step returns after our own deadline
    AssertionError: there is still work to do: expected true to be false
```

**What landed.** `transitionAfter` throws the abort's reason when the abort was our deadline. That
lands in `runStep`'s existing catch before the commit, so the product is **not committed**; the
step is recorded as the deadline stopped it, and the walk's existing branch calls
`pauseForDeadline`. All four of its answers apply unchanged: requeued with the draft, a Stop that
wins, a stale claim, and a spent budget that ends `INTERRUPTED` as before. Work committed by
earlier steps stays in the draft.

The product is discarded, not kept, as both reviews and the orchestrator's correction say:
`assets` would otherwise publish a manifest of unfetched images stamped current.

**Stop is unchanged.** The two characterisation cases passed before the fix and after it.

**What the investigation got wrong.** "`assets` is the last step of every import" (it is not the
last step of a minimal one, as the Sol review says). Nothing else.

### PQ2: a missing job is a 404 while the queue's lock is held too

- [x] Red, against real Postgres, with the lock held on a second connection.
- [x] Fix, in `src/jobs.ts` § `advanceJobWith`, `case "busy"`.
- [x] `ingest-queue.md` § The routes says so.

**Evidence:** R against Postgres at the coordinator (`advanceJobWith` answers a job-less object;
after the fix, `null`). The route's half is C: `src/routes.ts` already answers 404 for `null`
(`if (!advanced) throw httpError(404, "No such job")`), and no line of it changed. The Opus review
reproduced the 200 through the route itself.
**Files:** `src/jobs.ts`, `tests/jobs-walk.test.ts`, `docs/project/ingest-queue.md`.

**Done when** an advance for an id that was never inserted answers `null` both while a second
connection holds `queue_state` `for update` and after it lets go.

**Red.**

```
× answers null for a job that does not exist while another claim is being decided
    AssertionError: null is what the route turns into 404:
    expected { job: undefined, ran: null, busy: true, done: false } to be null
```

**What landed.** The read in the `busy` branch is checked instead of cast: no row, `null`. Both
reviews agree on this fix and on not classifying inside the store's transaction, which Postgres
has already aborted by then.

**The retreat rule.** This adds a 404 on a path every advance takes. The argument that no live job
can meet it rests on `store.get(id, owner)` finding any row that owner can advance. The same case
tests that: with the lock held, an advance for a job that exists still answers
`{busy: true, done: false}` carrying the job. `get` hides a dismissed job, and so does `claim`
(`gone`), so the two answers agree there too. The refusal is kept.

**What the investigation got wrong.** The first investigation said the browser "fails"; the Opus
review is right that the driver catches the throw and asks again, so the cost was one wasted
request and no visible effect.

### PQO2: the title reaches the row when it is read, and `metadata` supplies one too

- [x] Red, against real Postgres: two cases.
- [x] Fix: `src/jobs.ts`, and one optional argument on `noteProgress`.
- [x] `ingest-queue.md` § What the card says.

**Evidence:** R against Postgres for both cases (the reviews had them C, and the Sol review R on
an in-memory store).
**Files:** `src/jobs.ts`, `src/store/jobs.ts`, `src/store/pg-jobs.ts`, `tests/jobs-walk.test.ts`,
`docs/project/ingest-queue.md`. **No migration**: `jobs.title` already exists.

**Done when** a job that runs `extract` and then hands back mid-step answers with its title, keeps
it on the row and still has it when it finishes; and a job whose only title-bearing step is
`metadata` finishes with a title.

**Red.**

```
× keeps the title across a mid-step hand-back
    AssertionError: the hand-back answers from the row: expected undefined to be 'extract ran'
× gives a job whose only title comes from the metadata step a title
    AssertionError: expected undefined to be 'A paper's title'
```

**What landed.** `noteProgress` takes an optional title and writes it with the steps; without one
the row keeps what it has. `walkClaim`'s `note` passes `job.title`. `runStep` lifts the title from
`metadata` as well as `extract`. Both reviews proposed this.

**Not taken from the Sol review:** reading `product.parts.meta.title` instead of `product.detail`.
Both steps return `detail: meta.title` literally, `extract` has always been lifted from `detail`,
and reading `parts` needs a cast through `ArtifactParts`. One rule for both steps.

**Left.** A claimant that dies after `extract` commits and before the next progress write leaves
no title on the row, and the requeued claim skips `extract`. Closing it means writing the title
inside the step's commit, which is a change to `session.commit`'s `keep` transition; not built.

**What the investigation got wrong.** The Opus doc's heading says three of the four ways a claim
is put down lose the title; the Sol review is right that it is two (pause and lapse).

### PQ4 + PQO4: the comments that describe a queue and a store that are gone

- [x] Each comment checked against the code and corrected. Comments only.

**Evidence:** C, by reading each against the code it sits beside.
**Files:** `src/jobs.ts` (30 edits), `src/store/jobs.ts` (6), `src/store/pg-jobs.ts` (7),
`src/pipeline.ts` (11), `tests/jobs-lease-budget.test.ts` (1).

**Done when** no comment in those files says, in the present tense, that there is a filesystem
store, a second adapter, a scratch directory, or one step per request; and the two "≤" lease
numbers say what they are.

**That it is comments only** was checked, not assumed: each file at `HEAD` and in the working tree
was compiled with `esbuild --minify`, which drops every comment, and the two outputs compared.
Identical for all five.

**How the comments were found.** Every row of the two investigations' tables, then a grep of the
four files for a fixed list of terms (`filesystem`, `jobs-fs`, `sweepStopped`, `scratch`,
`both adapters`, `two adapters`, `either store`, `both stores`, `_jobs`, `STORE`, `one step per`,
`exactly one`, `per HTTP request`, `runJob`, `three-condition`, `all three of`, `on disk`,
`not built`, `≤`), reading each hit. That is a sweep by term, not a line-by-line read of 13,500
lines, so a false comment that uses none of those words is not found by it.

**A comment that records history stayed**, as the brief says: anything dated, or in the past
tense about the store that went on 2026-09-05. Where a comment was false only in its tense, the
tense and the date were what changed.

**The two lease numbers.** `fetch ≤110s` and `assets ≤185s` in `LEASE_MS`'s arithmetic are no
longer written as bounds, and the note beside them, and beside each row of `STEP_BUDGET_MS`, says
what each is: 110 s is one `fetchDocument`, and since 261006i the step can make several; 185 s is
`collectAssets`'s cap, and for a PDF the step goes on to `recoverPdfFigures` with a second 180 s
cap. **No number was changed.**

**Reported, not changed: `STEP_BUDGET_MS.assets` looks too small.** It is 185 s and the step's
real ceiling for a PDF is about 360 s, so the walk can start `assets` with less deadline left than
it may need. Since the PQO1 fix above that is a pause and a re-run, not a lost job; but each
re-run spends one of the job's three windows, and a second 180 s collection. Raising the number is
a behaviour change with its own cost (a PDF import hands back before `assets` more often) and
wants a measurement of what `recoverPdfFigures` really takes. `STEP_BUDGET_MS.fetch` (150 s) is
in the same position against a paper source with several candidates, with less at stake.

**Left, and why.**

- `src/pipeline.ts` § `UNCONVERTED_STEPS` and `StepProduct` still describe "the filesystem
  session" in the present tense. That is true of code that exists: `fsStoreSession`
  (`src/store/session.ts`) is still there, reached by one test. Deleting it is PQO3, another
  cluster's, and those comments go with it.
- `src/store/jobs.ts` § `DraftGoneError`, "The filesystem session has no such fence": the same.
- `src/jobs.ts` § `claimSession` says "every one of the thirteen steps"; there are 23 now. It is a
  sentence about 2026-09-01 and not about the store or the one-step queue, so it was left.
- Artefact nicknames such as `blocks.json` and `meta.json` throughout `src/pipeline.ts`. They
  name an artefact by what its file used to be called, and correcting several dozen is a rename
  of a vocabulary, not a false statement about the queue.

**What the investigation got wrong.** The Opus doc counts fourteen comments "in the queue files";
the Sol review is right that it is fourteen groups across four files. Its `pump` row is right but
its `AdvanceParts` row understates it: three paragraphs there described choosing a store. And
neither doc lists the false sentences this found in the same files: `LEASE_MS`'s "it only
re-runs on a cold instance" family (`STEP_BUDGET_MS`'s header, twice), `stillForced`'s and
`runStep`'s `runJob`, the import cycle that named a deleted `fs.ts`, and eight in
`src/pipeline.ts` beyond the one about `assets`.

## Mutations

Each fix was put back to what it was, `tests/jobs-walk.test.ts` run (29 cases), and the fix
restored. Every mutation reddened the cases written for it and no others.

| Mutation, in `src/jobs.ts` | Red |
|---|---|
| the freshness read's failure is rethrown where it happens | 1: *ends the job … when the freshness read fails* |
| `note` rethrows every failure | 4: *progress write 1*, *2*, *3*, and *the progress write for a skipped step* |
| `note` swallows a `StaleAttemptError` too | 1: *still stands down … when a progress write says the claim has moved* |
| the deadline branch returns `interruptedEnding` again | 1: *puts the job down with its draft …* |
| the `busy` branch casts its read to `Job` again | 1: *answers null for a job that does not exist …* |
| `note` passes no title | 1: *keeps the title across a mid-step hand-back* |
| the title is lifted from `extract` only | 1: *gives a job whose only title comes from the metadata step a title* |

The two Stop characterisation cases were green before any change and stayed green throughout,
which is what they are for.

## What is left

- **Greg's:** the Stop question above.
- **Reported:** `STEP_BUDGET_MS.assets` and `.fetch` against their steps' real ceilings.
- **Not closed in PQ1:** a failure of the write that settles the job (`pauseForDeadline`, or
  `settleJob` after a cancel or a failure) still leaves the row to the lease. Closing it needs a
  fourth storage-failure door and a sentence for the reader's card.
- **Not closed in PQO2:** a claimant that dies between `extract`'s commit and the next progress
  write. It is one field away since C1: a `keep` now writes the job's steps inside the commit
  (`keepStepIn`), and the title could ride the same statement. Not built, because C1 was kept to
  the receipt.
- **Another cluster's:** PQ3, PQO3, PQO5.
- A second, narrow GPT review of the C1 change, which the orchestrating agent runs before pushing.

## Review status

**GPT Sol's verdict, 2026-10-07: do not ship yet.** Its
[report](261007b-seventh-sweep-job-queue-tier-0-code-review-sol.md) is beside this file, with the
[prompt](261007b-seventh-sweep-job-queue-tier-0-code-review-prompt.md) it answered. The review had
write access and no database, so it fixed four findings, wrote Postgres cases it could not run,
and left the fifth open. Everything below the table was done afterwards, against Postgres, by the
agent that picked the stage up. The scope and the size limit on C1 were the orchestrating agent's.

| | Finding | Sol | Now |
|---|---|---|---|
| C1 | P0. A completed forced step can run again and be paid for twice | open; regression written, unrun | **fixed**, below |
| C2 | P1. A progress write that succeeds and answers `cancelling` was ignored | fixed | run; red without the fix |
| C3 | P1. A blank title erased a stored one | fixed | run; one test repaired; red without the fix |
| C4 | P2. The deadline case could pass after committing the late product | test strengthened | run; red against a build that commits and then pauses |
| C5 | P3. False claims in the comments the stage rewrote | fixed | read; comments only |

The [postmortem](../postmortems/261007b-a-progress-write-can-carry-a-stop-and-a-blank-title-can-erase-a-heading.md)
names the three classes.

### What Sol's unrun cases did against Postgres

`tests/jobs-walk.test.ts` as Sol left it: 35 cases, 34 passed, 1 failed. The failure was the C1
regression, red for the reason it was written (`extract` ran twice). Every other case passed as
written, and one of them should not have been trusted:

- **`noteProgress preserves a stored title when given ""`** (and `"   "`, and `undefined`) **could
  not fail.** Its three `expect`s sat inside the step's body. A failed `expect` there is a throw
  that `runStep` records as the step's failure, so the job ended `error` carrying the title the
  claimant still held in memory, and the single assertion outside the body passed. With the
  store's guard taken out (`title !== undefined` again) all three cases stayed green. The case now
  reads the store's answer and the row inside the step and asserts both outside it, with the job's
  status; without the guard the two blank cases go red and `undefined` stays green, as it should.

Each fix was put back to what it was, the suites run, and the fix restored:

| Taken out | Red |
|---|---|
| C2, the starting write's `cancelling` check | *honours the next starting write's Stop …* (Postgres: `extract` ran) and its offline twin |
| C2, the skipped step's `cancelling` check | *honours a skipped tail's Stop …* (Postgres: `done`, not `cancelled`) and its offline twin |
| C3, the coordinator's blank guard | offline: *keeps an existing title when extract / metadata returns an empty detail* |
| C3, the store's blank guard | Postgres: the two blank cases, after the repair above; none before it |
| C4: the late product committed, then the pause | *puts the job down with its draft …*, on "the late product must not enter the commit at all" |

C4's other half is reasoned, not run: that the case as the builder first wrote it stays green
under that same wrong build. Sol argued it from the fake freshness; it was not re-checked.

### C1: the receipt for a forced step is written by the step's commit

**The defect.** `force` is a request, spent when the step's *stored* status is `done`
(`stillForced`). A commit that kept the claim wrote nothing to the `jobs` row, so `done` reached
it only through the progress write afterwards. Lose that write and the row says `running` and
`force: true`; a requeue makes it `pending`; the next claim runs the step and pays again.

**Two roads, both reproduced against Postgres, both red before the fix.**

- *Sol's.* Forced `extract` commits; the progress write after it fails, and so does the one as
  `blocks` starts; `blocks` asks for another window; the pause requeues. The second claim ran
  `extract` again. This road needs tolerant progress writes, so it is this stage's.
- *The older one.* The lease lapses between the commit and the progress write, and the sweep
  requeues. The case makes the failing write expire the lease. Run with `note` put back to
  rethrowing every failure, which is what it did before the stage, `extract` ran twice
  (`['extract', 'extract', 'blocks']`); with today's `note`, the same. So the defect predates the
  stage, as Sol said. That is **R on this tree with the one function reverted**, not a run of the
  commit before the stage. A claimant killed between the commit and the write leaves the same row
  and needs no failed write at all; it has been reachable since the kept claim (`ceec42fc8`,
  2026-08-30).

**The fix.** `keep` carries the job's steps, and the Postgres session writes them in the
transaction that writes the product:

- `src/store/session.ts`: `{ kind: "keep" }` becomes `{ kind: "keep"; jobId; attempt; steps }`.
- `src/store/pg-jobs.ts`: `keepStepIn`, beside `releaseStepIn` and `finishIn`. One fenced
  `update … set steps`. Not the status, the lease, `cancelling` or the title.
- `src/store/pg-session.ts`: `settleIn`'s `keep` branch calls it.
- `src/jobs.ts`: `transitionAfter` hands over `job.steps`, in which the step is already `done`.

About twenty lines that are not comments or tests. No column, no migration, no new method on a
store contract. It takes no new lock: `finishStepRun`, one statement earlier in the same
transaction, already holds the job row `for update`, which is what the old comment's objection
("would take the job lock on every step of a walk for no gain") had missed. `fsStoreSession`,
which one test reaches and which has no transaction, ignores the steps.

**Evidence.** Both Postgres cases assert the receipt (the stored step is `done` and still
`force: true`) and then the consequence (`extract` ran once). Both were red first. Mutations:

| Mutation | Red |
|---|---|
| the session's `keep` branch does not call `keepStepIn` | both Postgres cases, on the receipt |
| `transitionAfter` hands over steps in which the forced step is not `done` | both Postgres cases, and the offline case |
| before the fix existed, with the receipt assertion commented out | the lapsed-claim case, on `extract` twice, so the consequence is seen red and not only the line above it |

The offline case was Sol's characterisation of the defect (`extract` twice). Its fake session now
does what the real one does with a `keep`, and it asserts once.

**The simpler option passed over: a receipt read on resume.** Leave the commit alone and have the
next claim ask whether a `revision_step_runs` row in this job's draft says the step finished.
The row exists, but it is keyed on revision and step and stamped with the *claim's* token, not the
job's, and a draft's rows are copied from the revision it was forked from; telling "finished under
this job" from "copied in" needs a comparison nothing makes today, and a new read on the session,
which every fake session in the tests would have to answer. The write is smaller and says the
fact where it becomes true.

### Tolerant continuation stays

Sol's judgement was that a progress write is not a harmless display write, because it carried
cancellation and the force receipt. Both halves are answered differently now:

- **Cancellation** is read off the next write that succeeds (C2). Repeated failures can still
  delay a Stop across several steps; the step list and the claim's deadline bound it.
- **The force receipt** is no longer on that write at all.

So a failed progress write costs the card an update and the walk one look at Stop, and cannot add
a road to a second paid run: a step is run again only if its stored status says it was not
finished, or its artefacts do, and the commit now writes both together.

**The option not taken** is the Opus review's sketch: a failed progress write ends the job as a
retryable `error`, through the ending and the sentence the failed freshness read uses. It would
have closed Sol's road to C1 and left the older one. It was not taken because it *adds* a paid
repeat where there was none: Retry
gives a forced job all its force back (`forceForRetry`), so a database blink between two steps of
a refresh would end the job, and pressing Retry would run the finished forced steps again. It also
throws away an ordinary import's claim for the sake of a progress bar, which is why the builder
passed it over the first time.

### Gates, 2026-10-07

- `npm run typecheck`: 4 projects, all 3339 source files covered, no errors.
- `tests/jobs-walk.test.ts` 36 passed; `tests/jobs-tier0-offline.test.ts` 14 passed.
- Every test file that names `advanceJob`, `runStep`, `transitionAfter`, a session, `noteProgress`,
  `pauseForDeadline` or `settleExpired`, plus the `jobs`, `second-job`, `step-failure`,
  `store-session`, `pg-session`, `claim-session` and `job-` suites: 66 files in four runs, 1334
  tests, 1334 passed.
- `tests/doc-links.test.ts` passed.
- Biome on the nine touched files: one error and one warning, both in code this stage did not
  write (an untyped `let locked` in `src/store/pg-jobs.ts`; an optional chain in
  `src/pipeline.ts`), and six complexity notices. Five are the ones Sol counted; the sixth is
  `settleIn` in `src/store/pg-session.ts`, a file Sol's run did not include. C1 added statements
  to an existing branch there and no branch, so it is taken to predate this; that was not measured.
- Not run: the full `npm test`.
