Reviewed and fixed four in-stage issues. No P0/P1 findings.

## Findings

- **CR-01 — P2 — FIXED:** `chat_mentions` was absent from article-transfer classification. Transfers would omit it from previews/counts and rely accidentally on message cascading. Added it to reader-state deletion/counting at [pg-article-transfer.ts:150](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/src/store/pg-article-transfer.ts:150) and seeded it in [article-transfer.test.ts:183](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/tests/article-transfer.test.ts:183). The existing exhaustive table-map guard is at [article-transfer.test.ts:561](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/tests/article-transfer.test.ts:561). Postgres test not runnable in this sandbox.

- **CR-02 — P2 — FIXED:** the three-per-question cap existed only in the route; `chatStore.begin` enforced only the thread cap under its lock. Added the per-question guard inside the locked transaction at [pg-chat.ts:457](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/src/store/pg-chat.ts:457), sharing the route’s refusal text. Added the rollback assertion at [chat-mentions-route.test.ts:449](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/tests/chat-mentions-route.test.ts:449). Postgres test not runnable here.

- **CR-03 — P2 — FIXED:** the paid cache probe falsely failed when bp2 was already warm, because it always demanded a bp2 write on turn two. It now accepts either a cold bp2 write or a full-prefix bp2 read, while still requiring turn three to read both articles: [chat-mention-caching.ts:50](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/evals/chat-mention-caching.ts:50). The failing-then-passing pure guards are at [chat-mentions-prompt.test.ts:139](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/tests/chat-mentions-prompt.test.ts:139).

- **CR-04 — P2 — FIXED:** the cache eval loaded `.env.local` inside `main`, after `withLedger` had already resolved the owner, so paid calls could be attributed to the development fallback owner. Environment loading now precedes the ledger at [chat-mention-caching.ts:153](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/evals/chat-mention-caching.ts:153). The paid eval itself was not run.

- **CR-05 — P2 — REPORTING, wider stage 3:** deleting a mentioned article deliberately preserves its title snapshot, but the current privacy copy says deletion erases everything and that surviving rows contain no article text: [PrivacyPage.tsx:721](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/src/web/PrivacyPage.tsx:721), [privacy.md:394](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/docs/project/privacy.md:394). This is already assigned to the plan’s docs stage, so I did not edit those rule docs during stage 1. I did correct the stale code comment describing deletion survivors at [pg-shelf.ts:489](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/src/store/pg-shelf.ts:489).

Ownership, fencing, cache placement, retry/edit refusals, draft-preserving 400s, citation ambiguity accounting, export/rollback coverage, article deletion, and default database grants otherwise check out. Another owner’s current slug/title/IDs/text cannot pass the resolver; only the stored title captured while the article belonged to the reader survives. No account-deletion table enumerator needed updating.

The applicable prior plan-review findings are honoured: F1 server collision accounting, F3–F6, F8, and F10. F7 is client-stage work; F9’s upload row remains omitted.

Checks:

- 77 pure tests passed.
- Full typecheck passed for all 3,744 covered source files using the direct runner; the npm wrapper hit the sandbox’s `tsx` IPC restriction.
- Scoped lint had no errors, only the existing `routes.ts` complexity advisories.
- `git diff --check` passed.
- The supplied stage artifact records 66 DB-backed tests passing at `f64a446cc`; the two new Postgres guards could not be run here.
- No commit made.

APPROVE WITH FIXES APPLIED