# Code review 3: narrow check of C2-F1 and C2-F2 (GPT Sol)

Up: [261020b](261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md). GPT Sol
(gpt-5.6-sol, effort high, `--sandbox review`), 2026-10-20, on `77cdb5c28`; prompt in
[the prompt file](261020b-longer-documents-up-to-400-pages-code-review-3-prompt.md). Item 3 was a
case Claude suspected and asked it to confirm or refute. Verbatim.

## Findings

**C3-F1 — P0: released long-import reservations still permit a permanent one-slot High-powered charge.**

The suspected sequence is real:

1. Releasing a failed/stopped reservation sets only `released_at`; only successful settlement attaches `article_id` ([pg-billing.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-billing.ts:2142)).
2. `activeImportPrice` ignores released reservations ([pg-billing.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-billing.ts:1549)).
3. `chargedSlotsOf` sees only successful ingests, and `articleSlots` falls back to one ([pg-billing.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-billing.ts:1967)).
4. `ownedSlug` checks only slug and owner, not publication, so it finds the draft article row ([owned-slug.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/owned-slug.ts:45)). The route refuses only `processing = minimal`, not an unpublished full draft ([routes.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/routes.ts:11541)).
5. The PUT therefore inserts a one-slot High-powered row and sets `high_power_since` ([pg-billing.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-billing.ts:1710)).
6. Retry copies the released reservation’s five-slot weight into its fresh reservation ([admission.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/billing/admission.ts:442)), keeps the slug ([jobs.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/jobs.ts:5169)), and every retry step that actually runs reads `high_power_since` ([jobs.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/jobs.ts:2697)). Since Fetch already succeeded, it will normally be skipped; all remaining work runs High-powered.

Smallest complete fix: refuse/pending a first High-powered charge when all three are true:

- no charged ingest exists;
- no unsettled ingest exists;
- `articles.current_revision_id` is null.

That matches the client’s new rule: a dead unpublished import waits for Retry. Once Retry creates its five-slot reservation, the existing active-import path charges five. It avoids treating diagnostic slugs as identity or depending on failed drafts surviving their six-hour sweep.

If pre-arming High-powered before Retry is required, then derive the price from the current revision’s `raw_pages`; Stage 1 writes it before a later failure ([artifacts-pg.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/artifacts-pg.ts:1198)). That is broader than the server-side pending guard.

**C3-F2 — P1: completion can strand a 409 request that was already in flight.**

The scheduled-retry case is fixed, and repeat paste works. However:

- Completion sets `settled = true` and `jobAlive = false`, but cannot resend while a request is in flight ([add-high-power.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/web/add-high-power.ts:95)).
- If that earlier request then returns 409, the rejection handler retries only when `jobAlive` is true. It instead sets `retryOnNextAlive` and changes the state to `refused` ([add-high-power.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/web/add-high-power.ts:208)).
- A completed import will never become alive again, so the requested switch is never resent.

The tests cover a scheduled 409 timer dying, repeat completion, and a successful request already in flight, but not an in-flight 409 arriving after completion ([add-high-power.test.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/tests/add-high-power.test.ts:95), [add-high-power.test.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/tests/add-high-power.test.ts:334)).

The small fix is to record whether each request was sent before settlement. If a 404/409 returns after settlement changed from false to true, resend once; a 404/409 from that post-completion request remains final.

## Requested checks

1. **C2-F1 is closed.** Jobs are locked after the article, in id order, then reservations. No new cycle was found. The bulk expiry path locks multiple running jobs, but reservation-bearing import jobs are exclusive per slug; only compatible sharing-mode jobs may overlap, and those carry no ingest reservation. Delete takes billing and article locks first, so it serialises with this path.

2. **C2-F2’s reported extra-PUT-after-death defect is closed.** Repeat paste and an ordinary waiting completion still send correctly. It is not fully approvable because of C3-F2’s in-flight-response case.

3. **The released-reservation case is confirmed**, including draft lookup, five-slot Retry admission, and High-powered execution.

The 24 focused client tests passed. The database-focused test could not run because this sandbox could not reach local Postgres.

**Verdict: do not approve.** C3-F1 is a P0 billing bypass; C3-F2 also needs closing. No files changed.