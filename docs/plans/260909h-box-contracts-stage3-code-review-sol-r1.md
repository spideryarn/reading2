Implemented the review fixes. I do not refuse the candidate: all established P1s below are now closed.

Yes, your hardcoding diagnosis was right. The server’s kill-policy ID mapping is authorization; the client’s material classification is transport. The latter should derive from the catalogue effect.

### Findings

- **F8 — P1, established:** a late confirm response erased a newer preview.
  - (a) Click Confirm A and action B synchronously, resolve B’s preview, then A’s confirmation. B’s valid panel disappeared and A’s result replaced it.
  - (b) Capture and recheck the confirm generation after `await`.
  - Fixed red-first.

- **F9 — P1, established:** contradictory `result` and receipt values still produced Confirm.
  - (a) Return `%somebody-else` in `result.recipients` while the receipt binds `%1`; Confirm previously appeared.
  - (b) Parse the result/receipt join all-or-nothing, including recipient order, identities, pauses, totals, and kill candidate PIDs.
  - Fixed red-first.

- **F10 — P1, established:** parsed material remained a mutable caller-owned alias.
  - (a) Preview a five-minute broadcast, mutate the object returned by `response.json()` to 99 minutes, then confirm; the request previously submitted 99.
  - (b) Snapshot successful box answers through JSON serialization before parsing. This also neutralizes getters, prototypes, aliasing, and non-JSON values while preserving JSON-value semantics.
  - Fixed red-first.

- **F11 — P1, established:** polling could rewrite the omitted-row explanation after preview.
  - (a) Preview with one unaddressable row among two, then rerender with three addressable rows. The reviewed “1 of 2” sentence disappeared.
  - (b) Store the preview-time counts alongside the generation, action, and outcome.
  - Fixed red-first.

- **F12 — P1, established:** addressable broadcast exclusions were hidden outside collapsed diagnostics.
  - (a) A receipt containing one five-minute recipient and one working recipient with `minutes: null` rendered only the first before Confirm.
  - (b) Render an explicit excluded-recipient count, identities, and server reasons.
  - Fixed red-first.

- **F13 — P2, established:** the two hardcoded action-ID classifications recreated the dead-button failure class.
  - (a) An unknown-ID action with `effect: "broadcast"` posted no recipients and could not obtain Confirm.
  - (b) `boxPreview` now accepts `{ id, effect }`; request inputs, expected operation, and material kind derive from `effect`.
  - Fixed red-first.

I found no further actionable defect around double-confirm, three preview presses, unmounting, or expiry. The server should remain authoritative for expiry: comparing `expiresAt` to an unsynchronised browser clock could hide a still-valid receipt, while the server can refuse it accurately.

The original negative tests were generally properly isolated. The broadcast fixture was weaker than claimed because its `result.recipients` was empty while its receipt contained a recipient; that inconsistency is now corrected and explicitly tested.

Validation:

- Focused suite: **8 files, 761 tests passed**
- Typecheck: clean
- `git diff --check`: clean
- Scoped lint still reports the existing `ActionButtons.tsx` diagnostics
- No commit made

Files changed:

- [actions-client.ts](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tools/fleet/web/src/actions-client.ts)
- [ActionButtons.tsx](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tools/fleet/web/src/ActionButtons.tsx)
- [fleet-box-confirm.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tests/fleet-box-confirm.test.tsx)
- [fleet-actions-route.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tests/fleet-actions-route.test.ts)
- [fleet-web.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tests/fleet-web.test.tsx)
- [stage3-report.md](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/docs/plans/260909h-box-contracts-stage3-report.md)

The pre-existing untracked review-prompt file was not touched.