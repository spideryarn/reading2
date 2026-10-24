# Findings

## P1

- **F1 — Established, fixed:** predictable page prefixes were not globally collision-safe. Page 1 could preclaim `p2-target` or a later note ID, causing stage 3 to retarget page-2 links to page-1 prose. The fix reserves every prior anchor and deterministically suffixes collisions in [read-parts.ts](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/read-parts.ts:270). End-to-end `readParts → splitIntoBlocks` coverage now proves the link reaches the intended block.

- **F2 — Established, fixed:** failed continuation downloads did not debit the aggregate 30 MiB budget. An unsupported response or failed retry could consume bytes and leave the next URL the full allowance. Accounting now occurs while the response stream is read in [read-capped.ts](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/read-capped.ts:31), with retry-aware aggregation in [follow-pages.ts](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/follow-pages.ts:151). The red regression received `[1000,1000]`; it now receives `[1000,300]`.

- **F3 — Established, fixed:** hostile titles and URLs were unbounded in the model request. A roughly 2 MB page produced a 2,000,126-character user message. The model-facing representation is now bounded independently of the full internal fetch URL, with a final 100,000-character serialized limit in [multi-page.ts](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/multi-page.ts:35).

- **F4 — Established, not fixed:** feedback diagnostics attach only page 1 through [feedback-article.ts](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/feedback-article.ts:201). Reports about later pages therefore cannot be reproduced from Sentry alone. Fixing this needs a product-format decision—multiple attachments versus an archive/manifest—and an aggregate interpretation of the existing 10 MiB/20 MiB caps.

## P2

- **F5 — Reasoned from established ordering, not fixed:** source scanning reads page 1 and parts through two independent current-revision lookups in [source-scan.ts](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/source-scan.ts:110). A refresh between them can produce a composite that never existed. The clean fix is one store operation pinned to one revision.

- **F6 — Established, not fixed:** [db-corpus-readiness.ts](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/scripts/db-corpus-readiness.ts:198) checks only `article_revisions.raw_source_sha256`; missing continuation objects can coexist with a green readiness report. This needs its negative-control workflow extended to seed and detect a bad `article_revision_parts` reference.

- **F7 — Reasoned test gap, fixed:** extraction correctly failed when a part object was missing, but no test prevented a future catch-and-drop from silently shrinking the article. A missing-part regression now requires the whole extract step to return `SOURCE_DOCUMENT_GONE`.

- **F8 — Established test gap, fixed:** previous timeout/cancellation tests threw immediately and did not observe the supplied signal. Signal-aware tests now exercise an active judge timeout, continuation deadline, and job cancellation.

- **F9 — Reasoned, not fixed:** the candidate introduces an import cycle between [extract.ts](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/extract.ts:58) and [read-parts.ts](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/read-parts.ts:48). It works today and the tests pass, but lint detects it. Removing it cleanly requires moving the shared extraction primitives rather than a local patch.

## P3

- **F10 — Established, fixed:** fetch-stage storage metadata omitted `article_revision_parts`. [pg.ts](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/store/pg.ts:2087) now lists it.

The accepted plan-review decisions are otherwise honored: per-page immutable sources, page-1-only metadata, per-page scanning and Readability, no synthetic headings or deduplication, joined-text floor, exact production/eval judge input, origin-like redirect checks, revision/export copying, named metrics, and held-out evaluation.

# What I changed

- Stream-level and aggregate byte accounting:
  `src/read-capped.ts`, `src/fetch.ts`, `src/follow-pages.ts`
- Globally collision-safe anchor allocation:
  `src/read-parts.ts`
- Bounded judge input:
  `src/multi-page.ts`
- Storage metadata:
  `src/store/pg.ts`
- Regression coverage:
  `tests/fetch.test.ts`, `tests/follow-pages.test.ts`, `tests/multi-page.test.ts`, `tests/read-parts.test.ts`, `tests/multi-page-extract-step.test.ts`
- Root-cause records:
  three new `261024b–d` postmortems under `docs/postmortems/`

Other modified planning/project/eval documents and `docs/plans/261024p-code-review-sol.md` were pre-existing or concurrently edited; I left them untouched. No commit was made.

# Verification

- Requested unit subset: **5 files, 81 tests passed**
- Final focused timeout/request subset: **2 files, 30 tests passed**
- Broader affected unit subset including fetch internals: **6 files, 203 tests passed**
- Documentation links: **18 passed**
- Typecheck: **passed; all 3,954 TypeScript source files covered**
  - `npm run typecheck` itself hit the sandbox’s `tsx` IPC `EPERM`; running the same script with `node --import tsx` completed successfully.
- `git diff --check`: **passed**
- Requested PostgreSQL suites: **not run**. Private-lane setup was blocked by sandbox access to `127.0.0.1:54362` (`EPERM`), before any test executed.
- Scoped lint: the new warning was fixed; it still reports the candidate’s `extract.ts ↔ read-parts.ts` import cycle and pre-existing complexity notices.