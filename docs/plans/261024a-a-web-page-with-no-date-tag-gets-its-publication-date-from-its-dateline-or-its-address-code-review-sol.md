Verdict: **approve with changes**.

Findings fixed:

- **P1 — Date-like titles and figure captions became publication dates.** The reader scanned the `<h1>` record itself and lacked structural provenance for captions. Evidence: [page-date.ts](/var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/src/page-date.ts:86), [publication-date.test.ts](/var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/tests/publication-date.test.ts:208). I now skip the heading and exclude captions, lists, tables, and later headings. Element provenance is held outside `OpeningRecord`, preserving its public/serialized shape exactly.

- **P2 — The future-date ceiling admitted tomorrow too early.** Adding 24 hours to UTC could accept a date that was not yet current anywhere. Evidence: [page-date.ts](/var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/src/page-date.ts:69). I changed the ceiling to the calendar day in UTC+14 and made an invalid clock refuse deterministically.

- **P2 — Address parsing was both too broad and too narrow.** `2024-03-14th-anniversary` matched, while percent-encoded date segments did not. Evidence: [page-date.ts](/var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/src/page-date.ts:116), [page-date.test.ts](/var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/tests/page-date.test.ts:81). I decode each segment, require a whole date or `YYYY-MM-DD-slug`, and added terminal `/YYYY/MM/DD` coverage.

- **P3 — The freshness claim omitted Sources › Not cited.** Timeline remains the only paid generated pipeline mode invalidated, but Related Work includes the year in its OpenAlex search fingerprint and reports `queryChanged`. Evidence: [related-work.ts](/var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/src/related-work.ts:309). I corrected the plan; this causes no automatic or paid-model rerun.

Wider finding, not fixed:

- **P2 — A stored address-derived day can block a later registry backfill.** Once `withAddressDay` writes `publishedAt`, its provenance is lost. `backfill-registry-facts` only fills dates when both stored date fields are null, so a later, better registry day cannot replace it. Evidence: [article-registry-pipeline.test.ts](/var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/tests/article-registry-pipeline.test.ts:123), [backfill-registry-facts.ts](/var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/src/backfill-registry-facts.ts:263). Re-extraction or the metadata step can still replace it. A general fix needs provenance or an explicit overwrite policy, wider than this change.

Other conclusions:

- `openingBounds` preserves `readOpening`’s previous scope/start logic; the new provenance does not alter record bytes or model input.
- `keptPaperMetadata`, Read this, metadata reruns, and ordinary re-extraction do not lose, duplicate, or prematurely apply the address candidate.
- The 1990 floor and anchored case-insensitive month forms are appropriately conservative.

Checks:

- Requested suite: **95 passed, 1 expected failure**.
- Mutation check: disabling the five new safeguards produced five named failures.
- Typecheck: passed all four projects via `node --import tsx scripts/typecheck.ts`; `npm run typecheck` itself hit the sandbox’s tsx IPC `EPERM`.
- Scoped lint: no errors.
- `git diff --check`: passed.
- Full `npm test`: could not run because local Postgres/Docker was unavailable.