# Review, round 2: the fix for the P1 that made a deleted article come back

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently`, branch
`worktree-delete-article-permanently`. TypeScript + ESM, Postgres via Drizzle (schema `spideryarn`).
This is a **second-round code review**, narrowly scoped to the fixes for findings you established in
round one.

## The candidate

```
git show a239fd83
```

changed paths:

```
git diff --name-only a239fd83^..a239fd83
```

Start with `src/store/pg-shelf.ts` (`deleteTerminalJobs` and `destroy`) and `src/jobs.ts`
(`SlugAllocation`, `freeSlug`, `slugForRetry`, `insistsOnTheArticle`). That is where to begin, not
the limit of scope — the manifest above is.

**Out of scope, and under separate review right now:** Stage D (the web control,
`src/web/Metadata.tsx`) and Stage B's P2s (`drizzle/20260907200800_*`). Do not spend the run there.

## Round one, and what changed

Your round-one review is
`docs/plans/260906h-delete-an-article-permanently-stage-c-review-sol.md`. It refused, on F20.

| ID | Finding, verbatim | Disposition | What changed |
|----|-------------------|-------------|--------------|
| F20 | *"a retained terminal job can resurrect the article after deletion"* — P1, established | **fixed, but NOT by your proposed change** | `destroy()` now deletes the article's terminal jobs in the same transaction, after the live-job refusal (`deleteTerminalJobs`, `src/store/pg-shelf.ts`). The retry surface is removed at source instead of classified at enqueue. |
| F21 | *"fresh URL adoption has the same uncovered race"* — P1, reasoned | fixed, by your proposed change | `SlugAllocation` now carries provenance — `minted`, `adopted from:"shelf"`, `adopted from:"queue"` — and `requiresArticle` is `insistsOnTheArticle(allocation)`, i.e. `from === "shelf"`. The lookup used to collapse shelf and queue into one answer, which is what made the fact unrecoverable later. |
| F22 | *"the retained delete test does not guard most of the cascade"* — P2, established | fixed | `articleForeignKeys()` in `tests/store-shelf-pg.test.ts` walks the drizzle schema for all 14 FKs pointing at `articles` (ten cascade, four set null) and the fixture seeds a row in each. |

**Your F20 fix was rejected deliberately, and this is the part to attack first.** You proposed
`requiresArticle: request.retryOf !== undefined || (!request.url && !request.upload)`. We believe
that breaks an ordinary sequence: paste a URL, press Stop while it is still `queued`, press Retry.
The `articles` row is created only when the worker opens its draft (`openOrBeginJobDraft` →
`lockOrCreateArticle`, from `src/store/pg-session.ts`), never at enqueue, so a job cancelled while
queued has no article; and `jobWorthRetrying` (`src/job-failure.ts`) returns true because
`failureKind` is undefined, so Retry is offered. Under your fix that retry 404s. There is now a test
standing on that sequence. **If we have this wrong, say so — it is the load-bearing claim.**

## The safety argument you should try hardest to break

Deleting an **active** job leaks a quota slot for ever — that is your own F3 from the plan review,
and it is why `destroy` still refuses rather than deletes when a job is `queued` or `running`.

The claim licensing the new code is that a **terminal** job can never hold an unsettled reservation:
every transition into a terminal status settles the slot in the same transaction — `settlingIfTerminal`
(wrapping `releaseStep` and `finish`), `requestCancel`'s `cancelled` branch, `settleExpired`'s sweep,
and `settleIn`'s publish — and `pgJobStore.forget` / `trimFinished` have deleted terminal rows on
exactly that reasoning since long before this feature, so if it were false the queue would already be
leaking slots continuously.

**Find the fifth transition, or the path where a job reaches a terminal status with its reservation
unsettled.** A crash between two transactions, a lease expiry, a partial failure, an admin path, a
row updated by hand. If one exists, `deleteTerminalJobs` strands a quota slot permanently and this is
a P0.

## What it is meant to do

Permanent deletion of one article, by its owner, from that article's metadata page. Invariants:

1. **A reader can only ever destroy their own article.** Authorisation is a SQL `where` clause
   (`ownedSlug`), not a route check; a non-owner gets 404, never 403.
2. **Nothing may destroy or corrupt a different reader's data.**
3. **Deleting must not change what the owner is charged**, in either direction.
4. **A delete that reports success must have happened — and must stay happened.** That last clause is
   what F20 violated.

Deliberately surviving a delete, for now: `uploads.slug` and `feedback.slug`, so `/add/upload/<id>`
becomes a dead link afterwards. We believe it cannot resurrect anything, because an upload always
mints a fresh slug. The stored bytes also survive — that is Stage E, not built.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and build a
throwaway harness under `/tmp`. **You have no network, not even loopback**, so the Postgres-backed
suites will fail rather than tell you anything — do not spend the run on them. I have run them:
`tests/article-delete-pg.test.ts` + `tests/store-shelf-pg.test.ts` 46/46,
`tests/owner-isolation.test.ts` + `tests/billing-half-units.test.ts` 86/86,
`tests/authenticated-api-route-contract.test.ts` + `tests/jobs.test.ts` +
`tests/store-slug-guard.test.ts` 396/396, `npm run typecheck` clean.

## Attack it

Independently, before you read my questions below.

**The invariant to break is the fourth: find a sequence in which a deleted article comes back, or in
which a delete reports success without happening.** Then the third: find an ordering in which the
money comes out wrong — including the new one, a stranded reservation.

For each finding give an ID, a severity, and whether it is **established** or **reasoned**; (a) the
input or mutation that shows it fails its own claim; (b) the smallest change that closes it.
A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an **established** P0 or P1, and name what established it.

**IDs are stable across the whole chain. F1–F22 are issued, and a concurrent review of Stage D is
numbering from F23.** Number anything new from **F40** upward, so the two rounds cannot collide.

**Discovery is closing.** This is round two of Stage C, so per our house rule the general search
ends here; what still gets a hearing after this is a narrowly scoped check of a fix for an
established P0 or P1. Weight accordingly: an established P0 on the new code matters far more than a
new P2 elsewhere.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- `deleteTerminalJobs` is owner-scoped and slug-scoped, because `jobs.slug` carries no foreign key
  and no owner filter of its own. I think that is sufficient, but the absence of an FK means nothing
  in the database enforces the pairing.
- Deleting the job rows destroys the reader's only record of what happened to that article, and
  `ingest_events` keeps the charge but not the story. I decided that is right, because the article is
  going anyway. Say if a reader-visible surface reads those rows after a delete and now shows a gap.
- The new provenance type makes `freeSlug`'s injected lookup return a pair rather than a slug. That
  is a wider seam than the bug needed, and I am not certain every caller now passes the right half.

Do not change any file.
