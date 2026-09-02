# A lost claim that was never lost, and a publication that was never buried

**2026-09-02.** A browser pass on the dev box (Playwright, system Chrome, `SPIDERYARN_STORE=postgres`,
`:5273`) found two things that looked like two bugs in the job/revision layer:

- **A.** An `ideas` job's model call succeeded — 50.5s, three ideas, real money — and the server
  logged `lost the claim mid-step — read`. The row stayed `running` for **12m40s**, the article was
  a 404, the `glossary` job queued behind it could not start, and **Stop was accepted with a 200 and
  did nothing** until `settleExpired` swept the lease.
- **B.** `quotes` published and the reader could see "4 quotes". `timeline` then ran, drafted from an
  *older* revision, published, and the quotes were gone. No error anywhere.

They are one incident with one trigger, and only one of them is a defect in our code.

**A was fixed the same day** — *The fix, as built* below says what
landed and the one thing the recommendation had not seen. Everything before that section is written
as it was at the time of the incident, deliberately: the reasoning is the point.

- **A is real.** `NotTheLiveAttempt` says two different things and `src/jobs.ts` believes only one of
  them, so a claimant walks away from a job it still holds and nothing can end it before the lease.
- **B is not.** The publication guard did exactly what it is for. The article's pointer had already
  been moved to a foreign lineage — by a **second writer on the same local database** — before the
  `timeline` job even opened its draft.

The trigger for both was that second writer. What A adds is that our recovery from it is a wedge.

## The evidence

The dev server's own log survived the incident, and the `jobs` and `ai_calls` rows are still in the
local database. Times are the log's.

```
17:30:24.330  draft revision begun    revisionId ecab922d basedOn 3a372116 blocksCopied 23 job spya-ta4ae7
17:31:14.879  ideas read: 3 ideas     ms 50510                                    (the paid call, outcome ok)
17:31:14.907  lost the claim mid-step — read                                      job spya-ta4ae7
   …twelve minutes of `POST /api/jobs/spya-ta4ae7/advance 200` and `GET /api/jobs 200`…
17:43:04.458  settled 1 job(s) whose claimant stopped answering  [{spya-ta4ae7, cancelled}]
17:43:04.484  draft revision begun    basedOn null blocksCopied 0  job spya-dzf8cx   (the glossary job)
17:43:04.548  glossary: No blocks or tree for "read" — run the hierarchy step first.
```

The `jobs` row says the recovery was the lease and nothing else: `started_at 17:30:24.292`,
`finished_at 17:43:04.454` — 760.16 seconds, which is `LEASE_MS` (760,000 ms, `src/jobs.ts`) to the
millisecond. `ai_calls` confirms the money: `spya-ta4ae7`, step `ideas`, `duration_ms 50477`,
`outcome ok`.

And the second writer, in the same log:

```
17:43:55.891  draft revision begun    7c206db5 basedOn 0c071d17   job spya-bc87s2   (quotes)
17:44:00.108  revision published      7c206db5 previous 0c071d17
17:44:42.023  draft revision begun    a84042f0 basedOn fc1c672e   job spya-k26rbt   (timeline)
17:44:49.996  revision published      a84042f0 previous fc1c672e
```

**`fc1c672e` was never published by this server.** Nor was `3f987555`, which the 17:43:28 `arc` job
drafted from, nor `237486c5`, which the 17:45:33 one did. Three revisions became current in three
minutes without this process publishing them, and `publishRevisionIn` is the only writer of
`articles.current_revision_id` in the whole of `src/` — every other reference to that column is a
`join`. So another process was publishing to the same article.

The 17:43:04 line is the sharpest of them: `basedOn null, blocksCopied 0` for an article that had
been on the shelf since 30 August means the article had **no revisions at all** at that instant, and
that is why `glossary` then failed with "No blocks or tree" and why the reader was looking at a 404.
Nothing in `src/` or `scripts/` can produce that state — no code path nulls the pointer or deletes a
revision — but [`tests/helpers/forget-revisions.ts`](../../tests/helpers/forget-revisions.ts) does
exactly it, and the fixture loader
([`tests/helpers/load-article.ts`](../../tests/helpers/load-article.ts)) republishes straight
afterwards. `read` is not one of this repo's fixture slugs, so it came from a peer's checkout, a
worktree, or a hand-run script. Whoever it was is not the point; that it could happen at all is.

## A — the real defect: one error, two meanings, one recovery

### The chain

1. The claim opens its draft: `openPgStoreSession` → `openOrBeginJobDraft` mints `ecab922d` and
   points `jobs.draft_revision_id` at it.
2. The step runs for 50 seconds. In that window the peer deletes the article's revisions.
   `jobs.draft_revision_id` is
   `references(articleRevisions.id, { onDelete: "set null" })` ([`src/db/schema.ts`](../../src/db/schema.ts)),
   so the pointer is pulled out of the job row **silently**, by the database, with nobody in our code
   involved.
3. The step's artefacts are written inside `commit`, which fences on
   [`requireLiveJobOwnsDraft`](../../src/store/pg-revisions.ts):

   ```ts
   .where(and(liveAttempt(job.id, job.attemptId), eq(jobs.draftRevisionId, revisionId)))
   …
   if (!live) throw new NotTheLiveAttempt(job.id);
   ```

   Zero rows. `pgStoreSession`'s `asStaleClaim` turns that into `StaleAttemptError`
   ([`src/store/pg-session.ts`](../../src/store/pg-session.ts)), and the walk's outer catch in
   [`src/jobs.ts`](../../src/jobs.ts) reads it as one thing:

   ```ts
   /* **The claim went somewhere else while we were inside a step.** Not a step
      failure and not ours to record: the row says somebody else owns this job,
      so any write we made would be refused anyway. */
   if (err instanceof StaleAttemptError) return await lostTheClaim(job, owner, jlog, "mid-step");
   ```

4. It did not go somewhere else. The row is still `running`, `attempt_id` is still this claimant's,
   and the lease still has twelve minutes on it. `lostTheClaim` writes nothing, logs one line with no
   reason in it, and returns `busy`.

### The root cause, in one sentence

**That `where` clause has two conditions and the error has one name**, so *"another claimant has the
job"* and *"my draft is no longer the one my job points at"* arrive as the same exception — and the
recovery that is right for the first is a wedge for the second.

### Why nothing else can clear it

Every other route is closed by the same fact, that the row still looks perfectly claimed:

- **Nobody can take it.** `claim` only moves a row out of `queued`
  ([`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts)), so every advance answers `busy`.
- **Nothing else on the article can run.** `blockedByAnother` refuses a job while an older active row
  exists on its slug — stage 1 of
  [260902e](../plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md),
  commits `540927f` and `750672c`. The `glossary` job waited the full twelve minutes and then failed
  on an article that had been reset underneath it.
- **Stop cannot reach it.** `requestCancel` ends a job outright when it is `queued` or its lease has
  lapsed, and otherwise *asks the claimant* by setting `cancelling`. The lease was live and there was
  no claimant to ask. That is the 200 with no effect.
- **So the lease is the only recovery**, and it is 760 seconds because it is sized against Vercel's
  `maxDuration`, not against how long a wedge should last. It is doing its job. It is just the wrong
  instrument: a lease is for a claimant that *died*, and this one returned an answer to the browser.

### The commits

The walk-away is from `c109658` (2026-08-27, *"Take the queue out of one process's memory"*), where
`StaleAttemptError` meant exactly one thing. The second meaning was added to the same error by
`414f3f9` (2026-08-27, *"…close three holes in the fence"*), which put `draft_revision_id` into the
fence — a good change that made the fence stronger and the error ambiguous, and did not revisit the
caller that interprets it. It became reachable in production at the flip, `c42c940` (2026-09-01,
*"The pipeline publishes through Postgres"*), because before that a claim ran on the filesystem
session and had no such fence. `5618365` (2026-09-01) is where the current mid-step catch is written.

The blast radius is `540927f`'s: until stage 1, a wedged job blocked only itself.

### The fix, as built — 2026-09-02

The recommendation below survived contact with the code, with one thing it had not seen. Built:

- **`requireLiveJobOwnsDraft` reads the row on `liveAttempt` alone and compares the pointer itself.**
  The read half is now [`liveJobDraft`](../../src/store/pg-revisions.ts), still locked `for update`;
  a mismatch raises **`JobDraftGone`** (`status: 409`, so it passes `guardDbStore` through door 1
  rather than joining that file's class allowlist). `NotTheLiveAttempt` keeps its one meaning.
- **[`src/store/pg-session.ts`](../../src/store/pg-session.ts) names it across the seam.**
  `asStaleClaim` translates `JobDraftGone` to a new **`DraftGoneError`**
  ([`src/store/jobs.ts`](../../src/store/jobs.ts)), beside `StaleAttemptError` and deliberately not
  under it.
- **[`src/jobs.ts`](../../src/jobs.ts) routes it to `endAsStorageFailure`**, which grows a third
  door, `lost-draft`, with its own sentence for the card (`DRAFT_WENT_AWAY` — *"This run finished its
  work, but the draft it was writing into was removed before it could be saved"*, which the other two
  sentences could not truthfully say). The two ternaries that chose the line and the sentence became
  a total `Record` keyed by door, so a fourth door cannot silently inherit the third one's words.
  `runStep` lets `DraftGoneError` past for the same reason it lets `StaleAttemptError` past.
- **`lostTheClaim` logs `errorType`** — the class name only, by the rule in
  [`src/store/db-errors.ts`](../../src/store/db-errors.ts).
- **`forgetRevisions` refuses a slug with a `queued` or `running` job on it**
  ([`tests/helpers/forget-revisions.ts`](../../tests/helpers/forget-revisions.ts)), owner-scoped like
  its deletes, naming the job and saying what to do. `ACTIVE` is exported from
  [`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts) rather than copied.
- **Not `LEASE_MS`.**

**What the recommendation had not seen: the recovery goes through the same fence.**
`endAsStorageFailure` ends the job through `session.settleJob`, whose failing branch calls
`finishStepRun` to mark the step that started and never finished — and `finishStepRun` takes
`requireLiveJobOwnsDraft`, which would raise `JobDraftGone` a second time and take the recovery down
with it. So `settleIn` asks `liveJobDraft` first and skips the step-run tidy when the draft is no
longer the job's: that step run lives in a revision this job does not point at, and usually in one
the database has already deleted (`revision_step_runs` cascades). `failRevisionIn` still runs and
still clears the pointer — its own fence is `liveAttempt` alone, and the claim is live throughout.

**The reproduction, both ways round.** Case 1 of
[`tests/a-claim-that-lost-its-draft.test.ts`](../../tests/a-claim-that-lost-its-draft.test.ts) was
pinned to the defect, and against the fix it went red at exactly the assertion its header named:

```
AssertionError: today the claimant reports a lost claim: expected false to be true
 ❯ tests/a-claim-that-lost-its-draft.test.ts:365  expect(advanced?.busy, …).toBe(true);
```

It now asserts the three things that header asked for — `done: true`, `status: "error"`, a `retry`
failure kind; a terminal row with no attempt and no lease; and Stop finding nothing to stop — plus
two the header did not: the draft is left `failed` rather than immortal, and **a job queued behind
this one on the same slug runs**, which is what the reader actually lost to `blockedByAnother`.
`tests/store-step-fence.test.ts` had two cases asserting `NotTheLiveAttempt` for precisely the split
half; they now assert `JobDraftGone`, which is the per-clause coverage this postmortem asks for
below.

### The fix that is right for the long term

**Split the error, do not probe for the answer.** `requireLiveJobOwnsDraft` can tell the two apart in
the query it already runs — read the row on `liveAttempt` alone, then compare `draft_revision_id`
itself — and raise a distinct error when the attempt *is* live and the draft is not. Then `src/jobs.ts`
never has to guess:

- attempt no longer live → today's `lostTheClaim`, which is correct: somebody else owns the row.
- attempt live, draft gone → **this claim is broken, not lost.** End it the way the two other doors
  onto the same event already end it: `endAsStorageFailure` (`src/jobs.ts`) fails the draft, clears
  the pointer and ends the job `error` with a retryable `failureKind`, in one fenced transaction. The
  reader gets a card with a Retry button in one second instead of a frozen article for twelve
  minutes, and the article's line moves on.

The cheap version, if that is too much for one sitting: in the outer catch, ask the store one fenced
question before walking away — `store.noteProgress(job, attempt, job.steps)` throws
`StaleAttemptError` **iff** the fence has really moved, and succeeding proves the row is still ours.
It is one round trip on a path that only runs when something has already gone wrong. It is worse than
splitting the error, because it re-asks a question the failing statement had already answered.

Two smaller things worth doing whichever way it goes:

- **`lostTheClaim` should log why.** It writes `jobId` and a slug and drops the exception entirely, so
  the incident's own log could not distinguish the four things the fence tests. One `errorType` field
  would have shortened this postmortem by an hour.
- **Make the peer's mistake loud.** `forgetRevisions` (and any future "start this article again")
  should refuse a slug with an active job row, which is one query. Deleting a revision out from under
  a live claimant is not something the FK's `on delete set null` should be allowed to do quietly.

Not `LEASE_MS`. Shortening it to make this recover faster would trade a real guarantee — a claimant
inside a long step is allowed to finish — for a symptom.

### What would have caught the class

Not review: three reviews read this fence and the comment above it, and the comment is *right* about
the case it describes. What catches it is the rule that a fence with more than one clause needs a
test **per clause**. `liveAttempt` failing was exercised everywhere; `draft_revision_id` failing on a
live attempt was exercised nowhere, so nobody had ever seen what the recovery does with it.

The general shape, and it is the same one
[260901f](260901f-a-for-update-that-locks-nothing.md) ends on: when one exception is raised from a
condition with an `AND` in it, the handler is written for whichever half the author had in mind. Give
each half its own name, or write a test that produces the other one.

The reproduction is
[`tests/a-claim-that-lost-its-draft.test.ts`](../../tests/a-claim-that-lost-its-draft.test.ts), case
1, and it needs no concurrency at all: the step's own body nulls `jobs.draft_revision_id`, which is
precisely what the foreign key does when a peer deletes the draft. It was **pinned to the defect**
until the fix landed the same day — see *The fix, as built* above — and asserts the fix now.

## B — the publication that was never buried

The guard is present and it fired on nothing, because there was nothing to fire on.
[`publishRevisionIn`](../../src/store/pg-revisions.ts) reads both sides inside the transaction that
moves the pointer, under the article lock it takes first:

```ts
if (draft.basedOnRevisionId !== article.currentRevisionId) {
  throw new PublishRefused(slug, [ … "something else published while this draft was being written…" ]);
}
```

The `timeline` job's draft recorded `basedOn fc1c672e` **at the moment it was minted** — 17:44:42, 42
seconds *after* the quotes revision was published and orphaned. By then the article was already
serving `fc1c672e`, so the draft's base and the article's pointer agreed, and the publication was
correct by every rule we have. The quotes were lost between 17:44:00 and 17:44:42, by the writer that
put `fc1c672e` there, and the `timeline` job simply carried on from the article as it found it.

Two consequences worth stating plainly, because the report's reading was the natural one:

- **"drafted from an older revision" is what a foreign lineage looks like from inside.** Our lineage
  check compares a draft against the pointer; it has no way to ask whether the pointer's *own* history
  descends from what this article was serving a minute ago, and giving it one would mean refusing to
  publish onto any article a script had touched. This is not a hole to close.
- **The carry policy is not the hole either.** `quotes` is `carry` in `REVISION_CARRY_POLICY`, along
  with every other artefact column, and `tests/store-revision-policy.test.ts` fails on a column
  nobody has classified.

Case 2 of the new test is the control: `quotes` publishes, `timeline` runs on the same article and
publishes, and the second revision's `based_on_revision_id` is the first's publication with the quotes
artefact carried into it. It passes. **The reported failure will not reproduce serially, and that is
the finding** — what the browser run had that the test does not is a second process publishing to the
same slug.

`tests/pg-session-exact-base.test.ts` already covers the race this looked like, in five cases,
including the standalone-`publishRevision` one. Nothing about B is missing.

## The part that is about the box, not the code

Both symptoms needed a peer writing to the same local Postgres as the browser pass, on the same
article. It cost an hour of diagnosis and $0.05 of ideas, and it will happen again: we share one
database and one dev server between a dozen agents, on purpose.

What is cheap and worth doing:

- **A browser pass takes its own article.** Add one, use it, and do not test on `read`, `constitution`
  or anything else a fixture loader or `db:seed-dev` knows the name of. Worth a line in
  [browser-testing.md](../project/browser-testing.md).
- **A destructive helper checks for a live job before it deletes**, as above.
- **When something in the job layer looks impossible, read the dev server's log before the code.**
  Three unexplained `previous:` values in three minutes said "another writer" in about a minute, and
  no amount of reading `publishRevisionIn` would ever have said it.

## Files

- [`src/jobs.ts`](../../src/jobs.ts) — `lostTheClaim`, the walk's outer catch, `endAsStorageFailure`
  (the recovery that already exists, on two of the three doors)
- [`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts) — `requireLiveJobOwnsDraft`, the
  fence with two clauses; `publishRevisionIn`, the guard that was right
- [`src/store/pg-session.ts`](../../src/store/pg-session.ts) — `asStaleClaim`, where the two
  vocabularies meet
- [`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts) — `claim`, `blockedByAnother`, `requestCancel`
- [`src/db/schema.ts`](../../src/db/schema.ts) — `jobs.draft_revision_id`, `on delete set null`
- [`tests/a-claim-that-lost-its-draft.test.ts`](../../tests/a-claim-that-lost-its-draft.test.ts) — the
  pinned reproduction of A, and the control that says B is not ours
- [`tests/helpers/forget-revisions.ts`](../../tests/helpers/forget-revisions.ts) — the shape of the
  second writer
