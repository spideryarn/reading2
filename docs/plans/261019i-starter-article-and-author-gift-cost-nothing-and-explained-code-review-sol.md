Verdict: **LAND AFTER FIXES** — all findings below are fixed in the worktree.

1. Fixed: [AdminVouchersPage.tsx](/var/tmp/spideryarn-worktrees/fbnp36qf-starter-and-author-gift/src/web/AdminVouchersPage.tsx:1118) promised transfer whenever a starter was private and had no notes. Transfer can also refuse shared, busy, minimal, stale, or failed moves. The copy now accurately says the app attempts a safe transfer and otherwise leaves the existing copy and link unchanged.

2. Fixed: [AdminVouchersPage.tsx](/var/tmp/spideryarn-worktrees/fbnp36qf-starter-and-author-gift/src/web/AdminVouchersPage.tsx:1126) and [AdminAuthorGifts.tsx](/var/tmp/spideryarn-worktrees/fbnp36qf-starter-and-author-gift/src/web/AdminAuthorGifts.tsx:904) blurred drafts and vouchers. They now plainly say an author gift is a shortcut that creates an ordinary voucher only after Send succeeds.

3. Fixed: [billing.md](/var/tmp/spideryarn-worktrees/fbnp36qf-starter-and-author-gift/docs/project/billing.md:1126) said the starter always becomes the recipient’s and described every retained starter as using a private link. It now reflects transfer refusals and both public/private gift links. [admin.md](/var/tmp/spideryarn-worktrees/fbnp36qf-starter-and-author-gift/docs/project/admin.md:841) accurately records the clarified relationship.

The test is sound: [claim-starter-article.test.ts](/var/tmp/spideryarn-worktrees/fbnp36qf-starter-and-author-gift/tests/claim-starter-article.test.ts:241) detects recipient charging and ledger-row reassignment; the refusal assertion covers claim-time charging. Cleanup removes the new ingest rows and billing accounts at [line 170](/var/tmp/spideryarn-worktrees/fbnp36qf-starter-and-author-gift/tests/claim-starter-article.test.ts:170).

Checks:

- UI/doc suites: 123 passed.
- Direct typecheck: green; all 3,845 source files covered.
- Focused lint: no errors, only two pre-existing complexity advisories.
- `git diff --check`: green.
- The Postgres test could not rerun inside this sandbox; the supplied 136-pass run and two demonstrated red mutations provide the evidence for it.