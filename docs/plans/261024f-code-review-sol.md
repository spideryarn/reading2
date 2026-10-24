Implemented fixes for all substantive findings.

### Findings

1. **High — stale or failed preview could still be sent.**  
   After editing message A to B, A remained visible while B’s preview loaded; Send could successfully queue B despite A being the reviewed email. Send also worked while preview was loading or failed. Fixed by versioning preview results, hiding stale responses, refreshing on confirmation, gating Send until the fresh preview is visible, and adding retry.

2. **Medium — preview could resolve the wrong starter article.**  
   If the saved slug moved to another article, preview could name that replacement while Send—correctly pinned to the original article ID—refused. Preview now uses an article-ID-pinned, named-column query and refuses absent/unpublished starters as Send does. It never reads the private key.

3. **Medium — guidance save/claim race.**  
   A lookup could read guidance A, then guidance B could save, then the lookup could claim and run with A despite starting after the save. Guidance selection and lookup claiming are now one SQL statement.

4. **Low — documentation overstated preview exactness and gift permanence.**  
   Corrected “word for word,” documented mutable audience/title inputs and confirmation refresh, and replaced “one per article, for good.”

5. **Low — delete test did not prove spend survives.**  
   The test now creates a real ledger row and verifies it remains after the gift and lookup are deleted.

No correctness defect was found in Delete racing Restore, Send freeze, `beginLookup`, or `finishLookup`; all serialize on the gift row. The admin namespace gate and server-side separation of suggested messages also held.

Validation:

- Equivalent full typecheck passed: all 3,935 source files covered.
- Unit subset passed: 670 tests.
- Private-key boundary suite passed: 9 tests.
- Scoped lint: only existing complexity advisories.
- `git diff --check`: passed.
- The literal `npm run typecheck` was blocked before compilation by the sandbox’s `tsx` IPC restriction.
- The exact combined Vitest command was blocked before running tests because this sandbox cannot reach local Postgres/Docker. Consequently, the database-backed `author-gifts` and `author-lookup-start` suites still need running by the author.

Files changed:

- [docs/project/admin.md](/var/tmp/spideryarn-worktrees/fbnt6hee-author-gift-drafts/docs/project/admin.md)
- [docs/project/marketing-author-gifts.md](/var/tmp/spideryarn-worktrees/fbnt6hee-author-gift-drafts/docs/project/marketing-author-gifts.md)
- [src/author-lookup-start.ts](/var/tmp/spideryarn-worktrees/fbnt6hee-author-gift-drafts/src/author-lookup-start.ts)
- [src/routes.ts](/var/tmp/spideryarn-worktrees/fbnt6hee-author-gift-drafts/src/routes.ts)
- [src/store/pg-author-gifts.ts](/var/tmp/spideryarn-worktrees/fbnt6hee-author-gift-drafts/src/store/pg-author-gifts.ts)
- [src/web/AdminAuthorGifts.tsx](/var/tmp/spideryarn-worktrees/fbnt6hee-author-gift-drafts/src/web/AdminAuthorGifts.tsx)
- [tests/admin-author-gifts.test.tsx](/var/tmp/spideryarn-worktrees/fbnt6hee-author-gift-drafts/tests/admin-author-gifts.test.tsx)
- [tests/author-gifts.test.ts](/var/tmp/spideryarn-worktrees/fbnt6hee-author-gift-drafts/tests/author-gifts.test.ts)

The pre-existing untracked `docs/plans/261024f-code-review-sol.md` was not changed.