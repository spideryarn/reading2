# Review: 261007j stage 1 — a gift voucher can name a starter article; its email carries the private link

Repo: /var/tmp/spideryarn-worktrees/voucher-starter-article (worktree of spideryarn, off `dev`). TypeScript + ESM; Postgres via Drizzle in `src/store/`; routes in `src/routes.ts`.

## The candidate

Committed: `ae0a8f00e` (one commit). `git diff ae0a8f00e~1 ae0a8f00e`; `git show --stat ae0a8f00e` lists every path. Start with `src/store/voucher-starter.ts`, `src/store/pg-vouchers.ts`, `src/store/pg-voucher-emails.ts`, the voucher routes in `src/routes.ts`, `tests/voucher-starter.test.ts`. That does not limit scope.

The plan is `docs/plans/261007j-gift-voucher-starter-article-by-private-link.md` (§ The server, § What the recipient gets, § Where the key goes) and your own plan review is `docs/plans/261007j-voucher-starter-plan-review-sol.md` (F1–F5; F1–F3 are this stage's). Read the stage 1 entry in the plan's Log too.

Evidence: the DB-backed suites cannot run in your sandbox (no network, no Postgres). I ran them: `docs/plans/261007j-stage-1-db-suites-output.txt` (8 files, 236 tests, green). You may run anything that needs nothing outside the tree, e.g. `npx vitest run tests/share-link-token-stays-home.test.ts` and `npm run typecheck`.

## What to do

You are a write-capable reviewer-fixer. Independent pass first: correctness, the replay contract, the readdress path, whether the private-link key can reach anywhere other than the kept email row, Resend and the recipient (`billing_vouchers`, the list route, logs, Sentry, error messages, the claim notice), HTML/text escaping of the article title, byte-for-byte unchanged no-starter emails, and whether the tests would actually fail if the behaviour broke.

Fix what is inside this stage, narrowly and red-first (a test seen failing before the fix), and do not commit. Report — do not fix — anything wider. Do not touch the client form (stage 2 is the voucher page UI). Do not invent quotes from Greg in any doc.

Severity: P0 data loss / exploitable security / incorrect charging / service unusable; P1 user-visible wrong behaviour or authoritative contract violated; P2 design risk, no wrong behaviour today; P3 prose. IDs continue from the plan review: start at F6. For each: severity, evidence, and fixed / reported.

## My own suspicions (worth less; spend most of the run elsewhere)

- `updateVoucher` retries when the locked read disagrees with the unlocked pre-read — can that loop or send a stale starter?
- The list shows a title-less revision by slug while the email falls back to the first heading: is that inconsistency user-visible in a way that matters?
- The new CHECK `billing_vouchers_starter_has_slug` and `on delete set null`: after a delete the id is null and the slug stays — consistent with the CHECK's direction?
- Verdict in one line at the top: land / land with the fixes made / do not land.
