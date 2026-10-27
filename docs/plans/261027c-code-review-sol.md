## Findings

- **P2 — fixed:** [src/citation-index.ts:615](/var/tmp/spideryarn-worktrees/fbufn2xj-doi-confirm/src/citation-index.ts:615) deduplicated authors after the first-19-plus-last cut. Repeated names could hide later authors, lower the 4-in-5 denominator, and falsely confirm another work.
- **P3 — fixed:** [src/article-registry.ts:121](/var/tmp/spideryarn-worktrees/fbufn2xj-doi-confirm/src/article-registry.ts:121) treated `---` and longer runs like the specified `--`, creating an unnecessarily broad title normalization.
- **P3 — fixed:** [src/citation-index.ts:380](/var/tmp/spideryarn-worktrees/fbufn2xj-doi-confirm/src/citation-index.ts:380) materialized every sanitized name in very long author lists despite retaining only 20.
- **P2 — fixed:** [tests/citation-index.test.ts:1182](/var/tmp/spideryarn-worktrees/fbufn2xj-doi-confirm/tests/citation-index.test.ts:1182) did not directly pin all confirmation paths: fresh cache, just-written answer, stale fallback, topic answer, and Situate.
- **P3 — fixed:** [plan:60](/var/tmp/spideryarn-worktrees/fbufn2xj-doi-confirm/docs/plans/261027c-cited-by-confirms-a-doi-against-arxiv-own-record.md:60) still described the superseded two-author rule and classified registry outages as `unconfirmed`.

No P1 or wider-scope findings remain.

## What changed

- Deduplicate the article/registry identity before selecting first 19 plus last.
- Select target authors with bounded retained memory, covering null entries and 5,000-author lists.
- Normalize exactly whitespace-surrounded `--`; single and triple hyphens remain meaningful.
- Added direct import-path coverage for the footnote and dash normalizations.
- Added 4-in-5 tests against both list sizes and regression coverage for duplicate authors.
- Added tri-state coverage throughout `askWork`, `answerFor`, stale rows, topics, and `confirmedWorkOf`.
- Verified every newly introduced test case fails against clean pre-change `HEAD`: 13 failing cases.
- `once` is genuinely request-scoped. A rejected promise is cached only within that request; it aborts to `unavailable`, while the next public call creates a fresh memo.

No commit was made.

## Checks

- Required focused Vitest command: **passed**, 4 files / 226 tests.
- `node --import tsx scripts/typecheck.ts`: **passed**, all five projects and all 4,045 source files covered.
- Exact `npm run typecheck`: blocked before compilation by sandbox `EPERM` on the `tsx` Unix socket.
- Scoped Biome lint: **passed** with two existing informational diagnostics.
- `git diff --check`: **passed**.
- `npm test`: could not start because the shared local Postgres/Docker service is unavailable in this sandbox.