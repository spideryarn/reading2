# Plan 260910f Stage 1 — F11/F12 narrow check

Candidate checked: `2eccd2a6` (parent `f03d5571`).

## F11 — holds

The instance-private `minted` set is populated only after the reservation is persisted, `settle()` refuses an id absent from that set before touching the ledger, and the id is deleted only after settlement is successfully persisted (`tools/overseer/model-budget.ts:538,561,574,602-606`). Therefore another `modelBudget({root})` instance cannot release the owner's worst-case charge, while a crashed owner leaves it in the ledger.

Evidence:

- `npx vitest run tests/overseer-model-budget.test.ts`: 27/27 passed, including the two-instance last-slot regression at lines 326-345.
- The original `/tmp/repro-budget-owner.ts` now prints `stolen:false`, `secondGranted:false`, and leaves one reservation on disk at $1.49 settled + $0.01 in flight.
- An additional direct probe found: ordinary owner settlement returns `true`, leaves zero reservations and one settled call; after manually re-inserting the old public ledger row, settlement through the same budget returns `false`. This establishes that the private id was removed after successful settlement, rather than merely being masked by the missing ledger row.

No regression found: normal single-instance settlement still succeeds; non-owner settlement is refused; failed/non-owner settlement leaves the reservation charged; successful settlement forgets the private id.

## F12 — holds

The pass now records a tail in `judgedNow` only after a cacheable successful verdict, and counts every attempted `toCall` tail absent from that set as unjudged (`tools/overseer/attention-pass.ts:245,257-270,300-304`). The stale verdict remains in `verdicts` unless replaced by success, so a stale question card is retained while its session is counted unjudged.

Evidence:

- `npx vitest run tests/overseer-attention-pass.test.ts`: 39/39 passed, including stale question/no-question refusal and successful-refresh regressions at lines 789-846.
- The original `/tmp/repro-unavailable-stale.ts` now returns `{kind:"unknown"}` for a stale `no-question` whose refresh is `unavailable`, with the reason stating that one session could not be judged; it no longer emits a calm empty list.
- Additional outcome matrix:
  - stale `no-question` + `unavailable` -> `unknown`;
  - stale `no-question` + `stopped` -> `limited`, zero items, `sessionsUnreadable:1`;
  - stale question + `unavailable` -> `list`, one retained item, `sessionsUnreadable:1`;
  - stale question + `stopped` -> `limited`, one retained item, `sessionsUnreadable:1`;
  - stale question + successful re-read -> `list`, one item, `sessionsUnreadable:0`.

No regression found: a successful stale re-read is not counted unjudged; failed/refused re-reads retain any stale card; empty refused results cannot claim zero items with zero unjudged sessions.

## New findings

None (no F13+).
