The plan needs rework. I found no P0, but several established P1 failures, including two direct duplicate-delivery sequences.

### F1 — P1, established: fail-open destroys durable idempotency

(a) The journal’s fail-open rule permits this sequence:

1. A keyed direct message’s `accepted` or `attempted` append fails.
2. The message is sent.
3. The response is lost or the dashboard crashes.
4. On restart there is no durable reservation.
5. The same `requestId` and body are accepted again and the keystrokes are repeated.

That contradicts both the roadmap’s duplicate-request requirement and the candidate’s Stage 2 done-sentence. The crash table’s “request was not acknowledged” does not make an effect that already ran safe. See [the fail-open rule](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md:142) and [its acknowledged attempted-write ambiguity](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md:296).

(b) Replace the fail-open paragraph with:

> **A keyed action fails closed at both write-ahead boundaries.** When `requestId` is present, `accepted` is the durable admission record: if it does not land, return `503 receipt-unavailable` and perform no effect. After acceptance, `attempted` must land before any queued send, direct keystroke, broadcast recipient or enacted-plan step; if it does not, perform no effect. Requests without `requestId` may retain the legacy fail-open behaviour, but their response states that restart-safe replay is unavailable. Therefore `accepted` without `attempted` is proven not attempted for a keyed request.

### F2 — P1, established: an acknowledged cancellation can be undone

(a) The only write failure that stops an operation is `markAttempted`. Therefore `cancel` or `clear` can remove a durably accepted item from memory while `withdrawn` fails to append. After a 200 and restart, the journal still says `accepted`, restores the item, and later sends something the person successfully cancelled. Current queue mutations remove first at [queue.ts:795](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/tools/fleet/queue.ts:795) and [queue.ts:804](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/tools/fleet/queue.ts:804).

(b) Replace the Stage 1 transition bullet with:

> The queue receives an injected synchronous receipt sink. Enqueue, cancel and clear are write-ahead mutations: their durable record must land before queue memory changes or a success response is returned. `clear` writes one record naming every affected receipt so the mutation is all-or-nothing. If `withdrawn` cannot be written, cancel/clear return `503 receipt-unavailable` and leave the queue unchanged. Settle-after-attempt may remain conservative on write failure because the durable `attempted` record prevents restoration.

### F3 — P1, established: the 5,000 cap invalidates the expiry proof

(a) If 5,001 terminal requests occur within an hour, “at most 5,000” must discard one before seven days. Its ID is still within the one-hour initial-acceptance window, so an immediate duplicate misses lookup and is treated as new. The `7 days − 1 hour` arithmetic only works if no receipt is removed early. The contradictory rules are adjacent at [plan lines 191–200](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md:191).

(b) Replace the capacity section with:

> Retain every unexpired `requestId`, fingerprint and replayable receipt. The 5,000 limit is an admission cap, never an eviction rule: at capacity, refuse a new keyed action until an existing key expires. Lookup a retained ID before applying mint-time freshness, so it remains replayable throughout retention. For an unknown ID, accept it initially only when its mint time is within ±1 hour; reject any ID old enough that it could already have expired. No unexpired key is ever forgotten.

### F4 — P1, established: retention is not actually enforced

(a) Compaction only after 1 MiB means a low-volume journal can retain terminal receipts—and queued message text—forever. Logical filtering does not remove the sensitive bytes from `receipts.jsonl`. This contradicts both seven-day retention and “material only while non-terminal” at [plan line 162](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md:162).

(b) Replace the compaction sentence with:

> Compact at open, immediately after a receipt becomes terminal so its material is physically removed, whenever the journal exceeds 1 MiB, and when terminal retention expires. Retention refers to bytes in the journal, not merely records omitted from the read API. Compaction never removes an unexpired idempotency key.

### F5 — P1, established: the fingerprint does not bind the body

(a) The roadmap says same ID plus different body is rejected. The plan deliberately excludes `panePid` and `declaredStatus`, even though both affect validation and whether an effect occurs. It also names only the preview ID for a box run, omitting the submitted preview material. Thus a changed body can return an unrelated old receipt instead of `409`, precisely the failure R5 prohibits at [260908j lines 670–674](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/docs/plans/260908j-delivery-receipts-and-honest-outcomes-for-the-fleet-dashboard.md:670).

The old spec’s current server instance cannot be carried over literally: hashing the new server instance would make cross-restart replay impossible.

(b) Replace the fingerprint section with:

> Fingerprint the canonical, validated request after removing only `requestId`. Include every parsed field that can change validation, execution or outcome: the complete target including `panePid`, `declaredStatus`, speaker, mode, confirm, exact payload hash, the full question material/options/keys/consequences, ordered broadcast recipients, the complete preview claim and submitted material, and enacted-session fields. Current server/tmux observations that were not in the request are receipt evidence, not fingerprint input. A genuine retry resubmits the immutable original envelope; a request rebuilt from refreshed observations is a new intention and receives a new `requestId`.

### F6 — P1, reasoned: skipping unreadable lines can cause replay

(a) The extracted store is specified to copy the hold ledger’s “count and skip” parsing behaviour. In the hold ledger, unreadable lines are omitted from the fold at [hold-ledger.ts:485](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/tools/fleet/hold-ledger.ts:485). If a receipt’s `attempted` line is unreadable but its earlier `accepted` and `material` lines remain readable, recovery restores and sends an action that may already have been sent. Counting the missing evidence does not make that safe.

(b) Add:

> **Unreadable receipt lines fail recovery closed.** If an unreadable non-torn line still yields a trustworthy `receiptId`, that receipt becomes `outcome-unknown` and is never restored. If it cannot be attributed, no persisted queued work is automatically restored or sent; the journal reports `recovery-blocked` until an operator reconciles it. Compaction must not erase unreadable evidence. Crash tests include an unreadable complete `attempted` line in the middle of the file, not only a torn last line.

### F7 — P1, established: queued catalogue actions have no pinned material

(a) Current queued spoken actions contain the complete `SpokenAction`, and delivery uses its stored text at [drain.ts:329](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/tools/fleet/drain.ts:329). The plan stores material only for free-text messages and fingerprints a catalogue action only by ID. After a deploy changes an action’s wording, recovery can only re-resolve that ID and deliver words different from those accepted.

(b) Replace the sensitive-material exception with:

> A `material` record pins the exact sendable payload for every queued item. Free text stores the raw text and speaker; a spoken catalogue action stores an immutable action snapshot or exact rendered keystroke text and its hash. Recovery never re-resolves an accepted action ID against the current catalogue. Compaction removes all pinned material when the receipt becomes terminal.

### F8 — P1, established: reconciliation includes states no route can produce

(a) `released-as-sent` and `released-as-not-sent` have no producer. The current hold route accepts only `operator-confirmed` and `abandoned-unknown`; importantly, `operator-confirmed` records merely that somebody inspected the terminal, not what they found. Its contract explicitly preserves that distinction at [quarantine.ts:286](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/tools/fleet/quarantine.ts:286).

(b) Replace the reconciliation arm with:

> `outcome-unknown → reconciled { operator-inspected | abandoned-unknown }`. These are attributed dispositions, not transport evidence, and the underlying outcome remains unknown. If the product later needs `operator-reported-sent` or `operator-reported-not-sent`, first add an explicit choice to the request body and label it as the operator’s report, never as proven delivery.

### F9 — P1, established: the required actor is absent

(a) The roadmap explicitly requires a durable actor at [roadmap line 1381](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:1381). The candidate records speaker and server run, but speaker is message authorship, not necessarily the caller, and no actor field or provenance is defined for acceptance or reconciliation.

(b) Add to the record schema:

> Every `accepted` and `reconciled` record carries `actor: { kind: "authenticated" | "system" | "client-claimed" | "unknown"; id: string | null }`. `speaker` remains separate. Never promote an unauthenticated body field or network address into an authenticated actor. Operator reconciliation stores its actor and time.

### F10 — P1, reasoned: receipt recovery can lose the quarantine barrier

(a) The receipt append can succeed while the hold-ledger attempt append fails. If the send then becomes partial/unknown and the process crashes, recovery creates an unknown receipt but no hold. A different queued or direct message can subsequently be sent into an input box that may contain half the first message. The plan acknowledges this dependency only conditionally at [plan line 171](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md:171).

(b) Replace that sentence with:

> Thread `receiptId` through `SendAttemptEvidence` and `HoldEvidence`. At startup, merge unresolved keystroke attempts from both journals: evidence from either one installs one quarantine hold for the session before routes or drains exist. A receipt-derived hold survives subsequent restarts until its receipt is reconciled. Recovery deduplicates the two sources by `receiptId`.

### F11 — P1, reasoned: “per press” does not solve a lost response

(a) The motivating case is “the response was lost, so the person presses again.” But Stage 4 says mint an ID “per press”; literally implemented, the second tap gets a new ID and sends again. “Reuse” needs an explicit client state transition and an immutable request envelope.

(b) Replace the client bullet with:

> Each client constructs and retains an immutable `{requestId, body}` envelope before sending. A network failure or missing definitive response leaves that envelope pending and offers an explicit retry/check action that resubmits the same ID and identical body; it never silently retries keystrokes. Only a deliberate new action after a definitive response mints a new ID. Test a lost response followed by the user’s retry, including a dashboard restart between them.

### F12 — P1, established: Stage 1 can hide the receipt that explains a loss

(a) Stage 1 can conclude `lost-at-restart` or `outcome-unknown` and remove the item from the restored queue, but the receipt GET route and UI do not arrive until Stage 4. The item therefore disappears from the only surface the user has, despite the plan calling the loss “visible.” That makes the first landing fail its standalone usefulness claim.

(b) Add to Stage 1:

> Stage 1 also exposes a minimal read-only receipt endpoint and includes recovered `not-sent`/`outcome-unknown` counts and links in the queue catalogue. The richer `ReceiptView` and UI remain Stage 4, but no Stage 1 recovery conclusion exists only in a file or server log.

### F13 — P2, established: restored queue IDs unnecessarily break existing gestures

(a) Reminting the item ID means a phone displaying the pre-restart item cannot cancel or revive the very item that survived; it receives `other-instance`, after which the restored item may drain. This is honest—not silent success—but weaker than necessary. The hold route already demonstrates the safer rule: an old-run ID is accepted when the restored object actually exists.

(b) Replace the new-ID paragraph with:

> Restore a queued item under its original run-qualified item ID and retain its `receiptId`. Routes reject a foreign-run ID only when no currently restored item has that exact ID, matching the hold-release rule. New items still use the current run’s prefix, so no ID is reused. Add a restart test in which an old page successfully cancels the restored item before the next drain.

### F14 — P2, established: the generation-null case is safe but incomplete

(a) Refusing to send a restored item whose generation was null is appropriately conservative. The defect is that invalidation leaves its receipt permanently non-terminal even though the queue has decided it can never deliver it. This can retain material indefinitely and inflate the non-terminal cap. It also makes the early-start window unnecessarily common.

(b) Replace the generation bullet with:

> Persist the latest observed tmux generation as journal metadata and use it for enqueues made before this run’s first drain when available. If a restored item still has no trustworthy generation, do not send it; conclude it as `not-sent` with reason `tmux-generation-unproven` and expose that receipt. A differing generation is concluded similarly. Neither remains a non-terminal receipt indefinitely.

### Staging, size, and ownership

There is no materially smaller design that satisfies the full acceptance sentence: durable queue material, write-ahead attempt evidence, durable idempotency, uncertainty, enacted-plan progress, and a read surface are all necessary.

The four-stage shape is reasonable after F12. Stage 1 must include durable cancellation and a minimal way to read recovery outcomes; otherwise it is not safely useful alone. Stage 2 should say “steer and enqueue routes,” with box/broadcast added in Stage 3. “Every write route” is currently underspecified for `revive`, `cancel`, `clear`, `abandon`, and hold release: either give those commands their own command-receipt state machine or remove that claim and let them mutate the target action’s receipt.

Extracting the physical JSONL core from `hold-ledger.ts` is the right choice; a sibling copy would duplicate the difficult lock/repair/atomic-rewrite machinery. Keep the extracted core limited to bytes, locking, repair and checkpoint replacement. Parsing, transition policy, fail-open/closed decisions, retention and folds belong in the two domain stores.

Opening receipts inside `openSharedQuarantine()` is the wrong composition boundary. It braids enacted actions and idempotency into a function named for session holds, and two independent lock files permit concurrent starts to split ownership. Use an explicit `openFleetActionStores()` in `server.ts`, acquire one dashboard-writer ownership claim, open both stores, then inject the returned journal/book into routes and queue. A memory-only journal should be an explicit test dependency, not a production default that silently appears when startup wiring is missed.

I did not run tests; these findings follow from the committed plan, its authoritative contracts, and the current transition/write ordering. No files were changed.

rework