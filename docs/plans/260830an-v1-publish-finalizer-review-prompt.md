# Review: the job finalizer that publishes a finished ingest

You are reviewing **built code**, not a plan. Repo: `/Users/greg/Dropbox/dev/experim/spideryarn2`.
Read the files in the repo directly; the scoped listing below is a convenience, not the source of
truth.

## What this is

Stage 4 of [docs/plans/260830d-v1-imports-on-vercel.md](260830d-v1-imports-on-vercel.md), re-cut after your own
NO-SHIP in [260830a-v1-imports-review-sol.md](260830a-v1-imports-review-sol.md). Your critical 1 said the publish
step could not be a pipeline step and should be *"a job finalizer after the last real step … a small
vertical slice of D1b"*. Your critical 2 said publication and terminal job settlement must be one
transaction. This is that.

The problem it fixes, measured: `grep -c publishRevision src/jobs.ts` answered **0**. A job ran every
step, wrote its files, went `done`, and `articles.current_revision_id` never moved. The reader's
shelf stayed empty after an ingest whose every step was green.

## What was built

- **`src/store/publish-session.ts`** — a decorator round the `StoreSession` seam. On a `done`
  ending it opens the job's draft, copies the filesystem artefacts into it, publishes it, and
  finishes the job. The copy, the publication and `finishIn` are one transaction.
- **`src/store/copy-artefacts.ts`** — `copyArtefacts`, promoted verbatim out of
  `tests/helpers/artefacts.ts` because it is now on the production ingest path.
  `tests/helpers/load-article.ts` still drives the same function.
- **`src/jobs.ts`** — `claimSession`, which wraps the filesystem session only when
  `STORE === "postgres"`. One hunk; everything else in that file belongs to other sessions.
- Two test files, and the mutation readings are below.

Constraints it was built under, which you should treat as given rather than re-litigate:

- **No stage may be converted.** All ten are on `LEGACY_UNCONVERTED_STEPS` and write their own files
  inside `run()`. That is D3–D5 and is parked.
- **`src/store/pg-session.ts` cannot be used.** It asks `checkProduct` with an empty unconverted set,
  so it refuses by name any step returning no `parts`. It is the end state and becomes the publish
  path when the stages are converted.
- **The filesystem store's behaviour must be unchanged**, because that is what local development runs.

## The design decision I most want challenged

The finalizer **wraps the session** rather than sitting in `walkClaim`, which is where the brief
originally put it. The argument: a `done` ending reaches the store through two doors — `commit`,
when the last step ran and `transitionAfter` hands it an `end` transition; and `settleJob`, when
every step skipped and the walk never calls `commit` at all. A finalizer in the coordinator after
`endJob` sees only the second, and for the first it would arrive after the job row already said
`done` — which is your critical 2 back again.

On the `commit` path the wrapper calls `inner.commit(…, { kind: "keep" })` — taking the ending off
the transition — so the filesystem session writes the artefacts, checks the postcondition and
finishes the step, and the job's finish is left for the publication's transaction.

**Is that right? What does it break that I have not seen?** In particular:

1. Is there a `done` ending that reaches the store by a third door I have missed?
2. `inner.commit` with a `keep` writes the artefacts *outside* the publication's transaction. That is
   deliberate — the stages already wrote files, so there is nothing transactional to gain — but say
   plainly what the failure modes are between the artefact write and the publication.
3. The draft is opened **lazily**, inside `publishAndFinish`, so a job that never reaches `done` has
   no draft. `openOrBeginJobDraft` runs its own transaction, so the draft is committed before the
   publication's transaction opens. If that transaction rolls back, a compensating `failRevision`
   clears the pointer — best-effort, skipped when the claim itself was lost. Is that reasoning sound,
   and is the skip correct?
4. The article lock is taken first, inside the transaction, before anything touches the job row, and
   the draft's `articleId` is checked against the row now under the slug. Is the lock ordering right
   against `openOrBeginJobDraft`, `publishRevisionIn`, `failRevisionIn` and `failExpired`?
5. `guardDbStore` scrubs any error without a numeric `status`, so the empty-copy refusal is thrown as
   `PublishRefused` (409) to survive to the reader's job card. Is that the right class for it?

## The tests, and the mutation that reddened each

Watched on 2026-08-30; each mutation was applied, run, and taken out again.

| Case | Mutation | Reading |
|---|---|---|
| a finished job publishes the article a reader can open, and ends `done` | `publishes()` returns `false` | all four cases fail |
| refuses a copy that moved nothing rather than republishing the old article | delete the `copied.length === 0` branch | `promise resolved instead of rejecting` — it republishes the old article and reports success |
| keeps publication and the job's finish in one transaction | move `finishIn` out of the publication's transaction | `currentRevisionOf` is the new revision while the job is still `running` |
| publishes nothing when the job fails | `publishes()` drops its `status === "done"` clause | `currentRevisionOf` moved: the failed job published |
| (filesystem file) none of this runs with the default store | delete `if (STORE !== "postgres") return inner;` from `claimSession` | two of three fail: `DATABASE_URL is not set` thrown from `publishingSession` |

**One of these was green for the wrong reason and the mutation is what found it.** The atomicity case
first injected its failure by giving the ending a status the `jobs_status` check constraint rejects —
which made `publishes()` answer false, sent the whole call to the inner stub, and passed on the throw
from *there*, with no publication ever attempted. It now injects a NUL byte inside the ending's
`steps`, which Postgres refuses (22P05) at `finishIn`'s `UPDATE` — the last statement, after the
publication, inside the same transaction. **Look for more of that shape**: assertions that pass
without exercising the thing they name.

The filesystem case proves its claim by deleting `DATABASE_URL`, so it needs no database and cannot
skip. It checks the control is armed (`getDb()` throws) before relying on it.

## Gate readings

- `npm run typecheck`: clean apart from `tests/jobs-walk.test.ts` (another session's in-flight file).
- `tests/jobs-publish-finalizer.test.ts` 5/5, `tests/jobs-publish-finalizer-files.test.ts` 3/3,
  `tests/artefact-copy.test.ts` 19/19, `tests/jobs.test.ts` 66/66,
  `tests/store-session.test.ts` 18/18, `tests/store-pg-session.test.ts` 16/16,
  `tests/jobs-walk.test.ts` 7/7, `tests/store-guarded.test.ts` 14/14.
- `npm run check`: cycles clean, build clean.

## What I already know is still missing, so do not spend the review on it

- Stage 2b, the global slug reservation, is not built.
- `GET /api/source/:slug` still reads `/tmp` through `fsLocations` (`src/routes.ts:250`).
- `assets` has a 300s budget and the plan's own worst case for a job is ~640s.
- `maxDuration: 800` has not been read off a live deployment.
- The plan's sentence *"v1 publishes first ingests only, guarded"* is no longer accurate for this
  path: there is no first-ingest guard, so a second `done` job over an existing article republishes
  it. I believe that is safe — `publishRevisionIn` only moves a pointer and `beginDraftIn` carries
  the previous revision forward, unlike `importArticle` which deleted reader state wholesale — but
  **say so if I am wrong**, because it is the one thing here that could lose a reader's data.

## What I want back

A verdict (SHIP / SHIP WITH CHANGES / NO-SHIP), then findings ordered by severity, each naming the
file and line and the concrete failure it produces. Prefer one deterministic trace over three
suspicions. Where a test is green for a reason other than the one it claims, say which and how you
know.

## The code

The listing is at `/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/cb1f6352-212a-4617-954a-5ead31cb1813/scratchpad/scoped-diff.txt`. Read the repo for anything it references.
