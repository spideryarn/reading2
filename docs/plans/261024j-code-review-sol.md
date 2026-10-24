1. **High — [src/author-lookup.ts:414](/var/tmp/spideryarn-worktrees/fbw5yavh-author-email-search/src/author-lookup.ts:414):** The model could replace the article’s known author with a colleague, causing that colleague’s seen address to auto-fill. Author checks now prefer article metadata; sourced and unsourced replacement cases have regression tests.

2. **High — [src/author-page.ts:230](/var/tmp/spideryarn-worktrees/fbw5yavh-author-email-search/src/author-page.ts:230):** Initials alone, such as `as@…` for Ann Smith, counted as naming the author despite R1 requiring initials plus surname. The check now requires that full form.

3. **Medium — [src/author-page.ts:47](/var/tmp/spideryarn-worktrees/fbw5yavh-author-email-search/src/author-page.ts:47):** Flattening the whole document let unrelated blocks form false addresses. Scanning now preserves block boundaries while still joining the three table cells in Greg’s example.

4. **Medium — [src/author-page.ts:83](/var/tmp/spideryarn-worktrees/fbw5yavh-author-email-search/src/author-page.ts:83):** Encoded `mailto:` addresses were missed, while malformed escapes such as `%ZZ@example.org` became candidates. Valid addresses are now decoded; malformed escapes are discarded.

5. **Medium — [src/author-page.ts:96](/var/tmp/spideryarn-worktrees/fbw5yavh-author-email-search/src/author-page.ts:96):** The six-address limit was applied only after collecting every match. Mailto collection and each scan now stop at the cap.

6. **Medium — [src/author-candidates.ts:64](/var/tmp/spideryarn-worktrees/fbw5yavh-author-email-search/src/author-candidates.ts:64):** `last.first` could promote guesses despite not belonging to R3’s fixed pattern set. It was removed and tested as a long shot.

7. **Low — [src/author-candidates.ts:215](/var/tmp/spideryarn-worktrees/fbw5yavh-author-email-search/src/author-candidates.ts:215):** Shaped legacy suggestions joined the list only in the browser, so stored notes and MCP candidates disagreed. They now enter the server-side candidate assembly as deduplicated long shots.

8. **Medium — [src/store/pg-author-gifts.ts:585](/var/tmp/spideryarn-worktrees/fbw5yavh-author-email-search/src/store/pg-author-gifts.ts:585), [src/db/schema.ts:7843](/var/tmp/spideryarn-worktrees/fbw5yavh-author-email-search/src/db/schema.ts:7843):** Persistence accepted impossible confidence/provenance combinations. The sanitizer and migration now enforce confidence by kind, pattern evidence, and required source provenance.

9. **Low — [tests/admin-author-gifts.test.tsx:760](/var/tmp/spideryarn-worktrees/fbw5yavh-author-email-search/tests/admin-author-gifts.test.tsx:760):** The Send-race guard lacked regression coverage. A test now proves choosing a candidate closes the existing confirmation and issues only the PATCH.

Validation: 238 scoped unit tests passed; full typecheck passed across 3,943 source files; lint had no errors; Drizzle’s migration-chain check passed. Database-backed suites could not connect because the sandbox denied local Postgres/Docker access. No commit was made.

Verdict: **Approve with fixes; the remaining limitation is only unexecuted database-backed tests in this sandbox.**