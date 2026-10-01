Verdict: **build with changes**. The outbox-style design is now sound in shape, and five of the original eight findings are closed. Three need sharper implementation contracts, and there are two new P1 races. No P0 issue found.

1. **P1 — F1 is only partly closed: the attempt predicate is correct, but the lease timestamp is not updated.**

   Evidence: [plan:55](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:55>), [plan:61](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:61>), [plan:65](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:65>).

   `attempts = <mine>` does stop completion from attempt 1 overwriting attempt 2. That part is genuinely closed.

   But the shown reserve statement does not set `updated_at = now()`. If a queued row is already ten minutes old, contender A reserves it while leaving the old timestamp; contender B can then satisfy the stale-`sending` predicate immediately and reserve it too. Both can call Resend.

   Concrete change: reserve must atomically set `status = 'sending'`, increment `attempts`, and set an explicit `attempt_started_at = now()`—preferably a dedicated column rather than overloading `updated_at`. Completion must match both `id` and returned attempt, and update `updated_at`. Test two retries against an already-old row.

2. **P2 — F2 is closed for the current one-admin authorization model, provided replay comparison is exact.**

   Evidence: [plan:72](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:72>), [routes.ts:7200](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/routes.ts:7200>), [routes.ts:9853](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/routes.ts:9853>), [routes.ts:9883](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/routes.ts:9883>).

   A caller can deliberately choose an existing UUID, but only the fixed administrator reaches this route. A non-admin gets 403 before route dispatch, even if they know their voucher ID from `noticeKey`. The 200/409 distinction therefore reveals existence or payload equality only to somebody who can already list all vouchers.

   Concrete change: parse `id` strictly as a UUID; compare the stored normalized `email`, `articles`, `note`, and `created_by`; queue the gift delivery only when the voucher insert actually succeeds. Return 200 only for that exact original, otherwise 409. Retain the known-ID non-admin 403 test.

3. **P2 — F3 is closed for Retry, but address-change replay needs one explicit predicate.**

   Evidence: [plan:64](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:64>), [plan:72](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:72>), [pg-vouchers.ts:407](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/store/pg-vouchers.ts:407>).

   Excluding `sent` closes sequential and concurrent Retry double-clicks. A changed address being a new delivery is also the right model.

   Concrete change: queue that new delivery only when the normalized stored address actually changes, not merely when the PATCH body contains `email`. Test replaying the same PATCH sequentially and concurrently.

4. **P3 — F4 is closed.**

   Evidence: [plan:21](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:21>), [admin-accounts.ts:447](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/store/admin-accounts.ts:447>).

   An unavailable creator address now produces no email and a retryable safe failure. No further design change is needed.

5. **P2 — F5 is partly closed; queuing transactionally changes the claim failure boundary.**

   Evidence: [plan:48](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:48>), [plan:50](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:50>), [pg-vouchers.ts:141](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/store/pg-vouchers.ts:141>), [routes.ts:9660](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/routes.ts:9660>).

   Reserve and completion failures no longer damage a committed claim, which closes the original hole. But a delivery-row insertion failure inside the transaction necessarily rolls back the claim itself. Thus “email cannot fail the event” is false for email bookkeeping, though the HTTP usage response still succeeds and a later visit retries the claim.

   The insert also slightly lengthens the period for which claimed voucher rows remain locked and adds FK/unique-index locking. That is reasonable because there is no network call inside the transaction.

   Concrete change: state the actual contract: “claim plus outbox insertion commit together; if either database write fails, neither commits, usage is still served, and the next visit retries.” Test queue-insertion failure separately from reserve/completion failure. Preserve lock order as voucher then delivery; no delivery operation should later lock a delivery and then its voucher.

6. **P3 — F6 is closed.**

   Evidence: [plan:85](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:85>), [email.md:103](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/project/email.md:103>), [after-response.ts:45](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/after-response.ts:45>).

   All provider work is after the response. No further change is needed.

7. **P3 — F7 is closed.**

   Evidence: [plan:18](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:18>), [plan:98](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:98>).

   The note is omitted from both emails and pinned by tests.

8. **P2 — F8 is closed if tasks are registered only after the transaction succeeds.**

   Evidence: [plan:77](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:77>), [after-response.ts:50](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/after-response.ts:50>), [after-response.ts:55](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/after-response.ts:55>).

   Independent tasks are settled independently, so one failed voucher does not stop another.

   Concrete change: have the transaction return committed delivery IDs, then call `afterResponse` once per ID outside the transaction. Do not register tasks from inside the transaction callback: `withAfterResponseTasks` drains even through its `finally`, so a later rollback could otherwise leave a task targeting a row that never committed.

9. **P1 — The delivery row does not preserve the immutable Resend request.**

   Evidence: [plan:36](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:36>), [plan:42](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:42>), [pg-vouchers.ts:407](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/store/pg-vouchers.ts:407>), [admin-accounts.ts:447](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/store/admin-accounts.ts:447>).

   The proposed row stores neither recipient nor message inputs. Voucher address and article count can change; the creator’s account address can change; claim-message data can therefore render differently on retry. Multiple address changes before workers run could also make two distinct gift deliveries both read the latest address and send duplicate mail there.

   Concrete change: freeze each provider request. For gift delivery, persist the event’s recipient and rendered message—or all immutable inputs—inside the creating/address-change transaction. For a claim notice, persist the immutable claim facts transactionally; on the first successful creator lookup, atomically freeze the recipient and rendered request before calling Resend. Once any provider call has been attempted, that request must never change.

10. **P1 — The address-change/claim race currently has nondeterministic product behaviour.**

    Evidence: [plan:25](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:25>), [plan:67](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:67>), [pg-vouchers.ts:147](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/store/pg-vouchers.ts:147>), [pg-vouchers.ts:397](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/store/pg-vouchers.ts:397>).

    Existing voucher locking correctly orders the address change against the claim: if the claim wins, changing the address is refused; if the address change wins, it commits first. But after that commit, whether its email sends depends on whether the after-response reservation beats the subsequent claim. If the claim wins that second race, the live “must still be unclaimed” predicate refuses the queued delivery, contradicting “changing an unclaimed voucher’s address sends.”

    It also leaves the row `queued` but non-retryable, displayed indefinitely as “waiting to send.”

    Concrete change: use event-time semantics. If an address-change transaction commits, its immutable delivery remains eligible even if the voucher is claimed afterward. Remove the live `unclaimed` test from gift reservation. If revocation is intended to cancel queued mail, define that separately and transition affected rows to a terminal `skipped` state in the revocation transaction; do not leave them permanently queued.

11. **P2 — The Resend key itself is valid, but the plan states only half of Resend’s contract.**

    Evidence: [plan:38](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:38>), [plan:57](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/docs/plans/261001p-voucher-emails-to-recipient-and-creator.md:57>), [email.ts:129](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/email.ts:129>), [email.ts:139](</home/greg/code/spideryarn2/.claude/worktrees/fb-vp4mdn-voucher-emails/src/email.ts:139>).

    `voucher-email/<uuid>` is about 50 characters, comfortably inside the 1–256-character limit, and `Idempotency-Key` is the correct HTTP header. The 24-hour retention statement is also correct.

    Resend returns the original result only when both key and request payload match. The same key with a different payload returns `409 invalid_idempotent_request`; simultaneous same-key requests can return `409 concurrent_idempotent_requests`, which is safe to retry later. [Resend’s official documentation](https://resend.com/docs/dashboard/emails/idempotency-keys).

    Concrete change: add the immutable-request rule from finding 9, test same-key/same-body replay, and test that a same-key/different-body response is treated as an invariant breach rather than an ordinary provider failure. `sendEmail` may safely retain an allowlisted Resend error name while continuing to discard the rest of the response body.

The simplest version with the same guarantees is still this delivery table, browser-minted voucher UUID, and transactional outbox. I would simplify its state machinery to:

- immutable provider request per delivery;
- `attempts` plus a dedicated `attempt_started_at`;
- completion conditional on the returned attempt;
- event-time eligibility, avoiding a live voucher join during reservation;
- delivery IDs returned from the transaction and scheduled afterward.

That removes the ambiguous address race and makes Resend idempotency mechanical rather than dependent on mutable voucher/account state. No files were edited.