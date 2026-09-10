Review verdict: refuse as written. I found three established P1s and one P2. Full findings are recorded in [the requested findings file](/tmp/260910f-launch-protocol-stage1-review-sol-b-findings.md).

### F16 — P1 — established

Reconciliation trusts the absolute `artefactDir` stored in the journal. Its only check is that the path is absolute and ends in `/o/<id>/a<n>`. It can therefore read another store’s matching correlation ID, accept its `exit.json`, mark this job completed, and release this job’s slot.

- Reproduction: [launch-protocol-path-repro.test.ts](/tmp/launch-protocol-path-repro.test.ts) showed the foreign path replaying as `whole`, being passed to the reader, and producing `completed`.
- Smallest fix: derive the directory from the currently opened store’s `attemptDir(id, attempt)`. If the absolute path remains journalled, a mismatch should make replay `history-lost`.

### F17 — P1 — established

Repairing the admission journal can resurrect a reservation whose launch record already says `released`. Reconciliation never checks owner state again once the launch-side reservation fact is `released`. With capacity one, that ghost reservation blocks every subsequent job, and `dispose` refuses the completed occurrence.

- Reproduction: [launch-released-owner-repro.test.ts](/tmp/launch-released-owner-repro.test.ts) supplied a completed/released launch fold and a repaired owner reporting the key reserved; reconciliation returned no decisions.
- Smallest fix: check terminal/disposed records against owner truth even after a recorded release, and idempotently release a resurrected key under the existing durable licence.

### F18 — P2 — established

Replay accepts `planned → waiting("full") → waiting("full")`, although D3 permits a waiting line only once per distinct reason. Live `drive()` suppresses this duplicate, but the fold does not enforce the same invariant.

- Reproduction: [launch-duplicate-wait-repro.test.ts](/tmp/launch-duplicate-wait-repro.test.ts) expected `history-lost`; replay returned `whole`.
- Smallest fix: reject a waiting transition whose previous state has the same reason; add it to the F11 cases.

### F19 — P1 — established

A conclusive `identity() → other-boot` result is discarded if an earlier, separate `boot()` call failed. This contradicts F4: the identity result already includes both boot IDs, but reconciliation returns `hold`.

- Reproduction: [launch-other-boot-precedence-repro.test.ts](/tmp/launch-other-boot-precedence-repro.test.ts) returned `hold` instead of `completed (rebooted)`.
- Smallest fix: use `identity.recorded` and `identity.current` directly in the `other-boot` arm.

The remaining D4 cases and F1/F2/F5/F7/F8/F9 behavior matched the plan. The existing crash tests assert exact nonzero invocation/effect counts after invocation, so I found no “at most one because zero happened” false pass.

Your questions:

1. Production callers treat `lookup`/`release` `unavailable` cautiously. Lookups hold, release failures are not recorded as success, and unavailable inventory prevents history resolution. F17 concerns the later state after the owner becomes available again.
2. `drive()` and reconciliation cannot normally interleave on a `reserved` record: both are synchronous in one event loop. Whichever starts first finishes before the other runs. A deliberately re-entrant owner implementation could break that assumption, but the current local owner is not re-entrant.

Checks:

- Four focused candidate suites: 123/123 passed.
- Four targeted reproductions: all four failed in the ways above.
- Repository files were not changed.