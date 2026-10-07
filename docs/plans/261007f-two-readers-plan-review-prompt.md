# Review: a plan to prove, with tests, that two readers importing one article each get their own copy

Repo: this worktree (`/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers`), branch
`worktree-fbrvbmss-same-article-two-importers`, off `dev`. TypeScript, ESM, Postgres (drizzle),
vitest. Read `AGENTS.md` first for orientation.

## The candidate

Live pre-commit: base `HEAD`; untracked:
`docs/plans/261007f-two-readers-import-the-same-article-checked-end-to-end-and-the-edge-cases.md`
(the plan) and this prompt. No code has been written.

Start with the plan, then the code it makes claims about: `src/ingest.ts` (slug minting),
`src/jobs.ts` (`enqueue`, allocation), `src/store/find-article.ts`, `src/store/pg-revisions.ts`
(`lockOrCreateArticle`), `src/store/pg-visibility.ts`, `src/store/public-slug.ts`,
`src/store/public-library.ts`, `src/store/pg-shelf.ts` (delete), `src/cited-in-spideryarn.ts`,
`src/db/schema.ts`, `tests/owner-isolation.test.ts`. That is where to begin, not the limit.

## What it is meant to do

An administrator (Greg) asked: when two different accounts import the same article, each should
have their own copy with their own AI processing; one may be public and the other private; both
may be public. He asked us to make sure that works, to consider related edge cases, and to bring
any cleaner design to him rather than build it.

The plan claims the code already behaves this way, proposes one end-to-end Postgres test file to
pin it, three comment corrections, one probe, a doc section, and three questions for Greg.

## What you can and cannot run, and what you may change

The tree is read-only. You have no network, not even loopback, so nothing that needs Postgres will
run. You can read everything and run a script that needs no service.

## Attack it

Independently, before reading my suspicions.

1. **Is § What the code does today accurate?** Check each bullet against the source. A statement
   there that is false is the most valuable thing you can find, because the tests will be written
   to it.
2. **What edge case of "two accounts, one article" is missing from the table E1 to E12?** Think
   about: in-flight imports by both at once (slug reservation, `jobs_reserved_slug`,
   `jobs_active_source`), retries, rebuild/reset, refresh, bulk (minimal) imports and "Read this"
   upgrades, uploads claimed by hash, share tokens, the offline copy and browser storage when one
   browser signs in as A then B, billing (does one reader's import ever charge or refund the
   other; the half-price public slot), cost ledger attribution, the admin view, export, image
   delivery (`src/asset-delivery.ts`), link previews, the citation registry, shelf topics,
   post-import mode generation, email. Name a concrete scenario and the file and line.
3. **Is stage 1's test list the right one, and can each case actually be driven without a model
   call or network?** Say which existing test helpers to reuse and which case as written would
   pass vacuously.
4. **Are the three questions for Greg honest and answerable**, and is any recommended option
   wrong? Is there a cleaner design the plan fails to put to him?
5. **Stage 2's E8 fallback** adds a refusal on a reader's path. Is the placement (the route, not
   `normaliseUrl`) right, and is it a defence edit under
   `docs/project/security-map.md § Where the defences physically live`?

For each finding give an ID (F1, F2, …), a severity, whether it is established or reasoned, (a) the
concrete scenario or the source line that contradicts the plan, and (b) the exact replacement
wording or the smallest change.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1. End with one line: `VERDICT: build` or `VERDICT: revise`.

## My own suspicions, read last

- That "nothing is cached across owners" has an exception I did not find.
- That E10 (a `short_id` collision) deserves a fix rather than a paragraph.
- That Q2's option A is obviously right and should simply be built.

Do not change any file.
