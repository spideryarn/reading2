# Review: 261007j stage 2 — /admin/vouchers picks a starter article, or links out to import one

Repo: /var/tmp/spideryarn-worktrees/voucher-starter-article (worktree of spideryarn, off `dev`). TypeScript + ESM; React client in `src/web/`.

## The candidate

Committed: `90d414d4c` (one commit). `git show --stat 90d414d4c` lists every path; `git diff 90d414d4c~1 90d414d4c`. Start with `src/web/AdminVouchersPage.tsx`, `src/web/useAdminVouchers.ts`, `tests/admin-vouchers-page.test.tsx`. That does not limit scope.

The plan: `docs/plans/261007j-gift-voucher-starter-article-by-private-link.md` (§ Why the form links out, § What Greg sees, Stage 2, and the Log's "Stage 2 built" entry, which lists five departures from the plan). The server contract it talks to is stage 1, `ae0a8f00e` and `1d1fb6418` (already reviewed by you: `docs/plans/261007j-voucher-starter-stage-1-code-review-sol.md`). Your plan review: `docs/plans/261007j-voucher-starter-plan-review-sol.md` — F4 and F5 are the client's.

These tests need no database; run them yourself: `npx vitest run tests/admin-vouchers-page.test.tsx tests/what-the-enter-key-promises.test.tsx tests/client-imports.test.ts`, and `npm run typecheck`.

## What to do

Write-capable reviewer-fixer. Independent pass first: does the form match the plan and the server's contract (refusal codes, `starter: "kept" | "dropped"`, `title: null` for a deleted article); can Create be pressed with a starter the server will refuse, or be held back wrongly; does the replay fingerprint include the starter; does the page ever request, hold or draw a private-link key; are the new-tab links right (`addHref`, the Access & sharing address, `rel`); does Enter in the import box ever submit the voucher; does it work at phone width (no horizontal scroll; read `docs/project/narrow-windows.md`); is the author's title drawn in the author's font (`docs/project/fonts.md`); would the tests fail if the behaviour broke.

Fix what is inside this stage, narrowly and red-first, and do not commit. Report anything wider. Do not edit server files. Do not invent quotes from Greg.

Severity: P0 data loss / exploitable security / incorrect charging / service unusable; P1 user-visible wrong behaviour or authoritative contract violated; P2 design risk, no wrong behaviour today; P3 prose. IDs continue: start at F9. For each: severity, evidence, fixed / reported.

## My own suspicions (worth less; spend most of the run elsewhere)

- After making a link in the other tab, Greg must press Refresh: nothing reloads the shelf on returning to the tab. Is a reload on focus/visibility the obvious small fix, or is Refresh enough?
- The sketch shows the shelf's title (which Greg may have renamed) while the email uses the article's own revision title. Visible mismatch worth fixing here, or a note?
- `useJobs("watches-queue", reload)` adds a poll while the page is open: is that the existing pattern used correctly?
- Verdict in one line at the top: land / land with the fixes made / do not land.
