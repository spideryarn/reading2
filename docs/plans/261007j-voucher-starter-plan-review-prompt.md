# Review: plan to add an optional starter article, by private link, to gift voucher emails

Repo: /var/tmp/spideryarn-worktrees/voucher-starter-article (a worktree of spideryarn, branch worktree-voucher-starter-article off `dev`). TypeScript + ESM, Node server in `src/routes.ts`, Drizzle/Postgres in `src/store/`, React client in `src/web/`. Read-only review: there is nothing to fix but prose.

## The candidate

Live pre-commit, one untracked file: `docs/plans/261007j-gift-voucher-starter-article-by-private-link.md`. Read it first. Then the code it touches, to check its claims: `src/store/pg-vouchers.ts`, `src/store/pg-voucher-emails.ts`, `src/admin-vouchers.ts`, the voucher routes in `src/routes.ts` (search `ADMIN_VOUCHERS_PATH`) and the share-link routes (`SHARE_LINK_PATTERN`), `src/store/pg-share-link.ts`, `src/web/AdminVouchersPage.tsx`, `src/web/useAdminVouchers.ts`, `src/web/useJobs.ts` (`add`), `src/web/jobEngine.ts`, `src/web/useShelf.ts`, `src/web/add-share-link.ts`, `docs/project/security-map.md` (section "a second way in, which is a key"), `tests/share-link-token-stays-home.test.ts`. Context: the earlier plan `docs/plans/261007f-gift-voucher-recipient-name-and-a-starter-article-written-up.md` § Q-starter (option A, which Greg chose). These files are where to start; they do not limit scope.

## The constraints the plan must meet (from Greg and the Overseer)

- Chain existing pieces (the import, the private link from 261005e, the voucher email); add nothing parallel.
- The voucher row keeps which article, never the key.
- The key may newly travel to exactly two places: the kept voucher email row, and Resend (and the recipient's inbox). Nowhere else.
- Hold off if it needs a new background mechanism, a new way for the key to travel, or more than ~2 days.

## What I want

An independent pass first: is the plan correct against the code, does it meet the constraints, does it leak the key anywhere it does not name, are the stages and red-first tests right, and is there a simpler version that gets the same thing. In particular: is the statement "No new background mechanism: the server never waits for an import" accurate given how jobs are driven (the browser advances them)?

Severity: P0 data loss / exploitable security / incorrect charging / service unusable; P1 user-visible wrong behaviour or authoritative contract violated; P2 design risk, no wrong behaviour today; P3 prose. Refuse only on an established P0/P1. Give each finding an ID F1, F2, … and a concrete change to the plan.

## My own suspicions (worth less; spend most of the run elsewhere)

- Resolving `ownedSlug` inside an admin route: is `currentOwnerId()` the administrator there, or does the admin namespace run with some other owner context?
- Readdress resolving the starter afresh as whoever is PATCHing: with a single admin this is fine; is "dropped, and the answer says so" the right behaviour?
- Whether anything reads `billing_voucher_emails.body_text/body_html` back out to the admin page or a log.
- The verdict in one line at the top: build / build with changes / do not build.
