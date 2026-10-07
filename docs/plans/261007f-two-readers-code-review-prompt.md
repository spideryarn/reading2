# Review: tests that two readers importing one article each get their own copy, plus two small fixes

Repo: this worktree (`/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers`), branch
`worktree-fbrvbmss-same-article-two-importers`, off `dev`. TypeScript, ESM, Postgres (drizzle),
vitest. `AGENTS.md` orients a stranger.

## The candidate

Committed: commit `978c93e36` (its parent `7f959cd4b` is the plan).

    git diff 7f959cd4b..978c93e36
    git diff --stat 7f959cd4b..978c93e36     # the complete manifest

Start with: `src/jobs.ts` (`mintSlug`, and its three callers), `src/store/short-id-is-taken.ts`,
`src/store/pg-revisions.ts` (`lockOrCreateArticle`), `src/own-reading-page.ts`, `src/routes.ts`
(the `POST /api/jobs` handler), `src/messages.ts` (`OWN_READING_PAGE`), then the two new test files
`tests/two-readers-one-article-pg.test.ts` and `tests/two-readers-one-article-billing-pg.test.ts`.
That is where to begin, not the limit; the manifest is.

The plan, with its Progress section and the conclusions drawn, is
`docs/plans/261007f-two-readers-import-the-same-article-checked-end-to-end-and-the-edge-cases.md`.
**Read it as a reviewer of the conclusions, not only of the code.** Your plan review is
`docs/plans/261007f-two-readers-plan-review-sol.md` (F1 to F10); number new findings from F11.

## What it is meant to do

1. Prove, with tests that can fail, that two accounts importing the same article each get their
   own article, AI output, sharing setting, charge and private link, and that one deleting,
   unsharing or revoking leaves the other intact.
2. Stop a newly minted slug's random short id equalling one an article already holds (`mintSlug`
   asks first). The simultaneous-mint window is knowingly left open; your F1 asked for it closed
   and was overruled after an Opus arbitration, for the reasons in the plan's stage 2.
3. Refuse a pasted Spideryarn `/read/…` address at `POST /api/jobs` before a slot is reserved, as a
   product rule that edits no listed defence (`normaliseUrl`, the sanitiser).
4. Correct three stale comments; add `library.md § Two readers, one article`.

Out of scope: any change to the public shelf, Citations ordering, or ending a job when its draft
open is refused (written up in the plan as a gap left open).

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside this stage, narrowly, each finding red-first with
the test that reproduces it, and leave anything wider as a finding for me to decide. Do not commit.
List every file you changed at the end.

You have no network, not even loopback, so the Postgres-backed files will not run for you. I ran
them; the raw result for the twelve touched files was `Test Files 12 passed (12)`,
`Tests 257 passed (257)`, and `npm run typecheck` passes all four projects. You can run
service-free files: `npx vitest run tests/own-reading-page.test.ts tests/messages.test.ts`, and the
unit cases of `tests/short-id-collision.test.ts` if they do not need the database.

## Attack it

Independently, before reading my suspicions.

- **The tests as evidence.** For each case in the two new files: could it pass with the product
  broken? Is anything asserted against the test's own mock rather than the product? The blob-store
  mocks replace `blobStore()`, `storeRawSource`, `postgresBlobStore` and `uploadGrants`; does that
  leave the thing under test still real? Are the "two copies of the same article" really the same
  address / bytes where the case claims it?
- **`mintSlug`.** Off-by-one in the tries; a caller that still mints without it (grep
  `slugWithShortId(` and `mintId(` across `src/`); any path where the extra query runs inside a
  transaction or lock it should not; whether the new default lookup changes behaviour for existing
  tests that mint.
- **The refusal in `lockOrCreateArticle`.** `.catch` on a drizzle query inside a transaction: is the
  transaction state handled correctly by every caller after this throws? Does matching by
  constraint name hold for the driver's error shape?
- **`isOwnReadingPage`.** Any spelling of our reading page it misses that `normaliseUrl` lets
  through (case, port, userinfo, encoded path, `//`), and any legitimate address it wrongly
  refuses. Is the check placed before every reservation path in that handler, including the
  upload and minimal branches? Does any other route enqueue from a pasted address?
- **The docs.** Is every sentence of `docs/project/library.md § Two readers, one article` and the
  new subsection in `docs/project/ingest-queue.md` true of the code? The numbers (8 in 100 million,
  33,000 articles, 38 minutes) included.

For each finding give an ID (F11, F12, …), a severity, whether it is established or reasoned,
(a) the input, mutation or source line that shows it, and (b) the smallest change that closes it.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1. End with one line: `VERDICT: ship` or `VERDICT: fix first`.

## My own suspicions, read last

- The sentence I would least like to be wrong about: "No bug was found in the two-readers
  behaviour itself." Every case passed on first run; the mutation table is what makes that a
  finding rather than an absence. Is the table enough?
- That the open gap (a refusal at draft open ends no job, so the reader waits about 38 minutes)
  should have been fixed here rather than queued.
- That the refusal sentence for a pasted Spideryarn link reads oddly ("will be refused the same
  way") because it was bent to fit the message registry's rule.
