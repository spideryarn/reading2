# Plan review: 261011n — author-gift link, article ownership transfer, /admin/articles

You are reviewing a PLAN, read-only. Repo root is the current directory (a worktree of Spideryarn, TypeScript + Postgres/drizzle).

**Candidate (live, uncommitted):** `docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md` (untracked file). Base: current HEAD.

Read it, then check its claims against the code. Start with, but do not limit yourself to:
- `src/db/schema.ts` (articles at ~172; every table with `article_id`; billing_vouchers ~6981; author_gifts ~7178), `drizzle/*.sql` for FKs/triggers
- `src/store/pg-vouchers.ts` (`claimVouchersFor`), `src/store/voucher-starter.ts`, `src/store/pg-author-gifts.ts`, `src/store/pg-share-link.ts`
- `src/store/owned-slug.ts`, `src/store/pg.ts` (`articleIdForOwned`), `src/store/pg-billing.ts` (usageSql, upgradeCredit, supersedeMinimal), `src/store/pg-jobs.ts` (TERMINAL)
- `src/web/article/access.ts` (owner first, link second), `src/web/AdminAuthorGifts.tsx`, `src/web/AdminVouchersPage.tsx`, `src/mcp/tools.ts` (draft_author_gift, list_author_gifts)
- `src/routes.ts` (the /api/admin gate), `docs/project/admin.md`, `docs/project/security-map.md` § Where the defences physically live, `docs/project/billing.md` § Gift vouchers

Context: the requester is the site's administrator (Greg). Constraints on this run: no defence listed in security-map.md may be edited; no migration unless clearly necessary (name it if so); simplest version first; "Use your judgement and just pick whatever is going to be good for the user but avoids too much complexity."

## What to attack (independent pass first)

Is the design correct, safe and as simple as it can be? In particular any way a transfer could: leak one reader's private data to another; leave rows unreachable or break a constraint/trigger; break billing (allowance, High-powered, minimal → full upgrade, refunds); break an in-flight job; let a non-admin cause a transfer (the claim path is reader-triggered); let the claim path move an article the voucher creator did not intend; race (concurrent claim, concurrent admin transfer, concurrent edits); or leave the author-gift / voucher admin pages wrong afterwards. Is the classification map + schema-reading test sound? Is anything in the "moves / deleted / history" split wrong for a specific table? Is the reading-view claim trigger (POST /api/vouchers/claim from the link view) the right place, and does it touch a defence? Is there a simpler design that gets most of the value?

## Severity scale

P0 data loss/leak or security hole; P1 wrong behaviour a user will hit; P2 should fix, not blocking; P3 nit. Give every finding an ID (F1, F2…), severity, the evidence (file:line), and the change you'd make to the plan.

End with a verdict line: `VERDICT: APPROVE` / `APPROVE WITH CHANGES` / `REJECT`.

## My own suspicions (already mine, worth less — spend most of the run elsewhere)

- Whether deleting the old owner's comments/chats on the sign-in path, unattended, is acceptable vs refusing.
- Whether the "no other non-revoked voucher names the same article" guard is enough.
- Whether `processing = 'minimal'` is the right test for the ingest_events supersede problem.
