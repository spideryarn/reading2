The revised plan still needs rework. No P0; three established P1s prevent proceeding: F15, F16, and F18.

### F15 — P1, established: the two journals cannot durably agree on releasing a hold

(a) The revised F10 fix rebuilds holds from unreconciled receipts while leaving `send-coordinator.ts` unchanged ([plan](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/docs/plans/260910d-d-durable-action-receipts-for-the-fleet-dashboard.md:220)). Hold-ledger records have no `receiptId`; they fold only by session. This creates an unavoidable crash window:

1. Receipt A is `outcome-unknown`, with a corresponding hold.
2. The operator releases it.
3. If `reconciled` is appended first and the process crashes before the hold ledger is resolved, the ledger rehydrates the hold.
4. If the hold ledger is resolved first and the process crashes before `reconciled`, receipt recovery rebuilds the hold.
5. The acknowledged release has therefore been undone in either ordering.

The same resurrection happens after `noteGeneration`: the hold ledger records `superseded`, but the receipt remains unreconciled and rebuilds the hold at the next dashboard restart. Current release and generation resolution are independent session-level writes ([quarantine.ts](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/tools/fleet/quarantine.ts:469), [quarantine.ts](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/tools/fleet/quarantine.ts:555)). Reconciliation of every unknown receipt for the session is also too broad: an older receipt from a superseded tmux generation may not belong to the hold the operator inspected.

(b) Replace the F10 restoration bullet with:

> **The two journals are correlated by `receiptId`.** Thread `receiptId` through `SendAttemptEvidence`, `HoldEvidence`, hold views, and every hold-ledger attempt, held and resolved record. `openFleetActionStores()` folds both journals before rehydrating either domain and derives one barrier state per receipt: unresolved evidence in either journal installs a hold; a definitive or reconciled receipt suppresses matching stale hold-ledger evidence; and a durable hold-ledger resolution repairs a missing matching receipt outcome where that resolution itself proves the outcome. Hold release and lease abandonment append their receipt disposition before changing live state; recovery completes the corresponding release. A tmux-generation supersession records a system barrier disposition on the affected receipt IDs, without changing their historical delivery outcome. Release reconciles only the receipt IDs attached to that hold, never every unknown receipt for the session. Crash tests stop between every receipt-journal and hold-ledger write in release, abandonment, definitive completion and generation supersession.

### F16 — P1, established: replay still depends on the current build’s catalogue and validation state

(a) The plan computes the fingerprint after parsing and performs replay lookup “after the body is parsed” ([plan](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md:79)). Today, parsing resolves `actionId` through the current catalogue and stores an enriched `Action`; a removed action is rejected during parsing ([routes-actions.ts](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/tools/fleet/routes-actions.ts:688)). Box requests do the same ([routes-actions.ts](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/tools/fleet/routes-actions.ts:828)).

Concrete sequence:

1. A keyed catalogue action is accepted and its response is lost.
2. A deploy changes or removes that catalogue entry.
3. The identical retained envelope is retried.
4. Parsing either rejects it as `no-such-action` or hashes the new resolved `Action`, producing `request-id-conflict`.
5. The promised stored receipt is not returned for the same ID and body.

The same ordering problem applies to an enacted request whose preview has expired or disappeared: known-request replay must not depend on whether that preview would be valid for a new action now.

(b) Replace the fingerprint/lookup ordering with:

> Construct a stable `WireIntent` from the validated client-supplied fields, removing only `requestId`; do not include catalogue objects, recomputed fields, current preview entries, server observations or other build-derived values. Parse enough to validate the JSON shape and `requestId`, compute that fingerprint, and look up a retained key before catalogue resolution, preview freshness, rate limiting or other current-execution validation. A known key with the same fingerprint returns its stored receipt even if the action was removed or its preview has since expired. A known key with a different fingerprint returns `409`. Only an unknown key proceeds to current catalogue and execution validation. A present malformed `requestId` is rejected and is never downgraded to an unkeyed request.

### F17 — P1, reasoned: the material-file alternative does not yet make physical retention true

(a) “Unlinked when terminal” is insufficiently defined because `outcome-unknown` permits a later `reconciled` transition. A natural implementation may therefore treat it as non-terminal and retain message text indefinitely, even though the action can never be retried. This also conflicts with the final “receipts are kept for 7 days” sentence because unreconciled receipts are explicitly never evicted.

There is also a concrete atomic-write residue: the existing `writeAtomically` writes message contents to a temporary sibling before renaming it. A kill between that write and rename leaves the temporary file, with no `accepted` receipt. The plan’s `<receiptId>.json` cleanup does not explicitly cover these temporary siblings. A crash after the terminal append but before unlink similarly leaves the final material file until cleanup, and an unlink failure is not assigned a status or retry ([material design](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md:188)).

(b) Replace the material lifecycle and retention wording with:

> Material liveness is separate from receipt transition liveness. Material is needed only while queued work may still be sent: `accepted` and `returned`. After a durable `attempted`, `withdrawn`, `not-sent`, `keys-submitted`, `outcome-unknown`, `completed` or `plan-stopped` record lands, the final material file and every recognised temporary sibling are deleted; later reconciliation never requires message text. Startup scans the material directory and removes final or temporary files not belonging to a receipt currently in `accepted` or `returned`. Failed deletion is reported by `status()`, retried at startup and compaction, and the receipt view says material deletion is pending rather than claiming the bytes are gone. Terminal keyed receipts are retained for 7 days; unresolved barrier metadata may remain longer, without message material.

### F18 — P1, established: the actor rule has no value for two accepted routes

(a) The plan says every HTTP actor is `{kind:"client-claimed", id:<speaker from the body>}` ([plan](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md:95)). But `/api/steer/answer` has no speaker field ([routes-steer.ts](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/tools/fleet/routes-steer.ts:701)), and a box `run` request also has no speaker ([routes-actions.ts](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/tools/fleet/routes-actions.ts:738)). The proposed `accepted` schema also makes `speaker` unconditional, so those records cannot be constructed truthfully as specified.

(b) Replace the actor section with:

> Every `accepted`, `withdrawn` and `reconciled` record carries an actor independently of message authorship. Where the body supplies a speaker, record `{kind:"client-claimed", id:speaker}` and retain `speaker` separately. Routes without a claimed identity record `{kind:"unattributed-http", id:null}` unless their request schema is deliberately extended with a claimed actor. Drain and recovery records use `{kind:"system", id:null}`. `speaker` is operation-specific and nullable; it is never invented for answer or enacted-box requests.

### F19 — P2, established: original IDs are safe only while run tokens do not collide

(a) With distinct run tokens, restoring an old item ID and permitting it only when that exact item exists is safe for cancel, revive, abandon and clear. The remaining exception is that `serverInstanceId` is only 32 random bits ([instance.ts](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/tools/fleet/instance.ts:32)). If a new run repeats an old token, its sequence restarts at one and can mint the same queue or receipt ID as a restored/retained record. An old page could then target new work, and a new receipt could fold into an old one. Thus “unique across restarts” and “no id is reused” are not accurate as written ([plan](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md:68), [plan](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md:209)).

(b) Replace those claims with:

> Run-qualified IDs are collision-resistant, not intrinsically unique. At startup, reserve every queue item and receipt ID present in retained records. Initialise each current-run sequence above every retained suffix carrying the current token, and skip any occupied ID when minting. Duplicate restored IDs referring to different receipts fail recovery closed. Consequently a repeated random run token still cannot reuse an ID visible in the retention window.

### F20 — P2, established: the unattributable-line rule is broader than its proof requires

(a) A malformed record without `receiptId` does not always mean it could have been an `attempted` record. For example, a complete JSON object recognisable as `kind:"generation"` but with an invalid generation value has no receipt ID by design. The proposed rule nevertheless marks every queued receipt unknown, removes every item and rebuilds holds. That is safe, and rebuilding holds is correct when the line genuinely could be an unattributable attempt, but it unnecessarily discards acknowledged work when the record kind proves otherwise ([plan](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md:226)).

(b) Replace the unreadable-line rule with:

> Parse the record envelope separately from its domain fields. An invalid record whose trustworthy envelope identifies it as `generation` blocks generation inference only; it cannot stand for an attempted action. An invalid action-transition record with a trustworthy `receiptId` blocks only that receipt. Only malformed bytes or an action-transition envelope that genuinely cannot be attributed to a receipt block every restorable queued receipt. Receipts blocked globally become `outcome-unknown` and rebuild holds because any one may conceal an attempt. An attributable line with no valid preceding `accepted` record is exposed as orphan recovery evidence rather than inventing an action target from invalid fields.

### F21 — P3, established: two sentences contradict the intended design

(a) The write-ahead section currently says that after `withdrawn` lands, restart restores and delivers the cancelled item—the exact behavior F2 was meant to eliminate ([plan](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md:181)). The plan also says all five gestures mutate the target receipt, while later saying `revive` is not journaled ([plan](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md:233), [plan](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md:355)).

(b) Use:

> `withdrawn` lands before cancel or clear changes queue memory. If it cannot land for a durably accepted item, return `503` and leave that item unchanged. Once it lands, remove the item and return success; recovery sees `withdrawn` and does not restore it.

And:

> Cancel, clear, abandon and hold release durably mutate the affected action receipts. Revive is intentionally memory-only: it changes the live queue clock, writes no receipt transition and reverts after restart.

The new named states otherwise have plausible producers: `not-durable` from a failed write-ahead attempt, `interrupted-before-attempt` from recovery of durable `accepted` without `attempted`, both tmux-generation conclusions from the first post-restore generation observation, `recovery-blocked` from unreadable evidence, and `generation` from `noteGeneration`. An explicitly omitted `requestId` remains the documented unkeyed case; there is no valid keyed-to-unkeyed fallback if F16’s parser rule is made explicit.

I did not run tests because nothing is implemented; the findings come from the committed plan and current route/store contracts. No files were changed.

rework