# Code review round 2 (read-only, narrow): 261011n — the round-1 fixes

Repo root is the current directory. Read-only: do not edit.

Round 1 (`docs/plans/261011n-code-review-sol.md`) found and fixed C1–C6 itself, committed as `c3a802a22`. Those fixes are now unreviewed code. **Scope is only those fixes**: `git show c3a802a22 -- src tests`. Discovery is closed otherwise; do not re-review the rest of the change unless a fix makes it worse.

Check, for each of C1–C6, that the fix is correct and complete:

- C1/C2/C3 (`resetRevisionReaderState` in `src/store/pg-article-transfer.ts`): are there other `article_revisions` (or other moving-table: `block_identities`, `revision_blocks`, `revision_phrase_runs`, `checkpoints`, `upload_source_guesses`) fields that carry the old reader's own words or secrets and are missed? Check `src/db/schema.ts` for each. Is `publicSourceUrl` (`src/urls.ts`) the right filter? Does nulling `requested_url`/`final_url` or replacing `raw_filename` break any CHECK constraint, a later re-extraction, the upload's storage lookup, or the source-file download for the new owner? Does nulling `illustrated` break the Illustrated mode's reading of a revision?
- The claim refusal for an illustration note: reported as `own-words` — fine?
- C4 (`src/web/AdminArticlesPage.tsx`) and C5/C6 (`src/web/article/useClaimSharedArticle.ts`, `ArticlePage.tsx`): correct, no loops, no request per render, cleans up on reader change?

You can run jsdom/unit suites, e.g. `npx vitest run tests/use-claim-shared-article.test.tsx tests/admin-articles-page.test.tsx`. Database suites I ran after the fixes: `tests/article-transfer.test.ts`, `tests/claim-starter-article.test.ts`, `tests/billing-vouchers.test.ts`, `tests/author-gifts.test.ts` — 108 passed across 6 files, private-postgres lane, not skipped.

Severity P0–P3, IDs R1, R2…, evidence file:line, the change you'd make. End with `VERDICT: LAND` / `LAND AFTER FIXES` / `DO NOT LAND`.
