I found seven issues and fixed all of them. No two-reader isolation bug was found.

- **F11 — P1 — established, fixed.** An encoded reading path such as `https://www.spideryarn.com/%72ead/article` bypassed the refusal. The new test failed red because the predicate inspected the raw pathname. [src/own-reading-page.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/own-reading-page.ts:27) now decodes only equivalent, unreserved characters; encoded separators remain significant.

- **F12 — P1 — established, fixed.** `https://www.spideryarn.com:8443/read/article` was wrongly refused because `hostname` omits the port. The red test confirmed this. The predicate now requires no non-default port, with controls for explicit `:443` and `:80`. [tests/own-reading-page.test.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/tests/own-reading-page.test.ts:59)

- **F13 — P1 — established, fixed.** The “AI is separate” test wrote marker values directly through the checkpoint stores and read those same values back, while both real pipeline runs received an identical fake model answer. It could therefore pass if publication cross-wired the model products. The fake now returns the job’s slug in its answer, and each published tree must contain its own slug-specific result. [tests/two-readers-one-article-pg.test.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/tests/two-readers-one-article-pg.test.ts:73)

- **F14 — P3 — established, fixed.** `library.md` claimed the two new files ran every listed case and that every case was mutation-checked. The plan explicitly says otherwise, while the pasted-link and Citations cases live in separate files. The documentation now states the exact coverage and mutations. [library.md](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/docs/project/library.md:1398)

- **F15 — P3 — established, fixed.** The simultaneous-mint probability was wrong. The ID space is `23 × 32⁵ = 771,751,936`, so one particular simultaneous pair collides about once in 772 million, not once in 100 million. The 8-in-100-million existing-library figure and roughly 33,000-article birthday point are correct. [ingest-queue.md](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/docs/project/ingest-queue.md:890)

- **F16 — P3 — established, fixed.** The refusal sentence’s “will be refused the same way” wording was circular. It now explains that the link opens Spideryarn’s copy rather than the original article, while retaining the registry-required statement that repeating the same link will not help. [messages.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/messages.ts:2574)

- **F17 — P3 — established, fixed.** Two comments were stale: `freeSlug` minting tests were described as store-free despite their new default Postgres lookup, and fixed UUID literals were described as randomly minted. Both comments now describe the code accurately.

The remaining areas check out:

- `mintSlug` has no off-by-one: it mints at most three IDs and deliberately asks about the first two. Every `slugWithShortId` call under `src/` now goes through it, and the query runs before queue transactions or locks.
- The unique-constraint catch immediately rethrows, so every transaction callback unwinds and rolls back; no caller continues in the aborted transaction. The supplied real-Postgres result validates the driver’s constraint-name shape.
- The refusal precedes upload, minimal, *Read this*, and ordinary slot paths. No other route accepts a pasted address for enqueueing.
- The blob replacements substitute external storage only; publication, ownership, billing, sharing, deletion and routing remain production implementations.
- The open draft-refusal gap is accurately described: three 760-second windows equal 38 minutes. Keeping its broader coordinator fix out of this stage is reasonable, especially with the corrected approximately 1-in-772-million pair probability.

Checks completed:

- Service-free Vitest: 3 files, 76 tests passed.
- Typecheck: all four projects and 3,374 covered source files passed.
- Biome lint on changed TypeScript files passed.
- `git diff --check` passed.
- Postgres tests were not rerun, as requested.
- No commit made.

Files changed:

- `docs/plans/261007f-two-readers-import-the-same-article-checked-end-to-end-and-the-edge-cases.md`
- `docs/project/ingest-queue.md`
- `docs/project/library.md`
- `src/messages.ts`
- `src/own-reading-page.ts`
- `tests/jobs.test.ts`
- `tests/own-reading-page.test.ts`
- `tests/two-readers-one-article-billing-pg.test.ts`
- `tests/two-readers-one-article-pg.test.ts`

VERDICT: ship