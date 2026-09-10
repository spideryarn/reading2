The committed candidate did not satisfy every guarantee. The working tree now does within Stage 1a’s scope; all established P0/P1 findings below were fixed and reproduced red-first.

### Findings and fixes

- **F22 — P1, established: fail-open policy was inverted.**
  - (a) An unkeyed `accept()` failed when the receipt append or material write failed; `returned` also remained at `attempted` after a failed settlement write.
  - (b) Unkeyed receipts and later transitions now remain in memory with `durable: false`. Keyed accepts still refuse. Settlements fail open in memory, while `attempted` and `withdrawn` remain fail-closed where durable evidence requires them.

- **F23 — P1, established: a locked-out dashboard falsely reported a durable attempt.**
  - (a) A second opener folded a durably accepted receipt, failed its append because it lacked `writer.lock`, but returned `{landed: true}` and advanced memory to `attempted`.
  - (b) Attempts for durably accepted receipts now advance only when the append lands. Read-only dashboards return `{landed: false}` and leave the receipt at `accepted`.

- **F24 — P1, established: failed recovery writes could expose blocked work for restoration.**
  - (a) With an unreadable attempted line and an injected failure writing `recovery-blocked`, `restorable()` returned the item.
  - (b) Recovery now suppresses affected receipts independently of whether the conclusion append succeeds, and reports the unlanded conclusion through `wouldConclude`.

- **F25 — P1, established: valid but illegal disk transitions could hide an attempt.**
  - (a) `accepted → keys-submitted` without a readable intervening `attempted` was counted and skipped, leaving the item restorable.
  - (b) Illegal action evidence now recovery-blocks every attributable non-terminal receipt. Orphan evidence remains separately reported.

- **F26 — P1, established: receipt-store failure disabled a healthy hold ledger.**
  - (a) Making `material/` unopenable caused `openSharedQuarantine()` to discard the successfully opened hold ledger and release the shared lock.
  - (b) The hold ledger now stays durable under the shared claim while receipts fall back to the explicitly non-durable memory journal.

- **F27 — P1, established: sensitive temporary files were not private from creation.**
  - (a) With umask zero and a forced rename failure, the material temporary file remained mode `0666`; residue was not marked deletion-pending, and `durable()` still returned true.
  - (b) Material uses a dedicated atomic writer that creates and `fchmod`s the temporary file to `0600` before writing. Failures immediately clean final and temporary siblings or record `materialDeletionPending`; domain failures make `durable()` false.

- **F28 — P1, established: one request ID could identify two retained receipts.**
  - (a) Two valid `accepted` records with the same `requestId` both remained restorable, while lookup silently selected the latter.
  - (b) New duplicate accepts refuse, and duplicate retained claims recovery-block every claimant.

- **F29 — P1, established: the unkeyed terminal cap was not enforced when crossed.**
  - (a) Three terminal receipts remained present with a configured cap of two until an unrelated compaction.
  - (b) Crossing the cap now triggers compaction immediately. `UNKEYED_TERMINAL_CAP` is also separate from `KEYED_RECEIPT_CAP`.

- **F30 — P1, established: closing a handed-in journal left it reporting durable.**
  - (a) After `receipts.close()`, `durable()` remained true because shared-lock journals did not update their status.
  - (b) Closing now marks that journal read-only without releasing the composition-owned lock; the sibling hold ledger remains writable.

- **F31 — P0, established: an unsafe retained receipt suffix hung the server.**
  - (a) A valid retained ID ending in `r9007199254740992` moved the sequence beyond safe integer precision. The mint loop stopped advancing; the reproducer timed out after five seconds.
  - (b) Only safe integer suffixes influence the current-run sequence. The retained unsafe ID stays reserved, while minting continues at `r1`.

Your suspicion about a failed `returned` write was correct about restart safety, but it also violated the plan’s fail-open settlement contract and unnecessarily wedged the receipt for the rest of the run. It now advances in memory while remaining conservatively unknown after a restart.

The composition remaining in `quarantine.ts` creates no semantic obstacle for Stage 1b. The move must carry the singleton state, shared-lock ownership, installation helpers, and receipt-failure fallback together.

### Guarantee assessment

After these fixes:

1. Recovery does not restore evidence that may conceal an attempt, including when its conservative conclusion cannot be written.
2. Keyed retention is seven days without early eviction; receipt, queue, and request-ID collisions fail closed.
3. Material and temporary files begin at `0600`; terminal cleanup either removes them or explicitly reports deletion pending.
4. The extracted hold ledger preserves prior behavior, including lock loss, close, compaction, and second openers.
5. A lock loser cannot append, compact, repair, or delete shared disk state.

Stage 1b wiring remains intentionally absent.

### Checks

Required targeted command:

```text
Test Files  5 passed (5)
     Tests  142 passed (142)
  Duration  2.89s
```

`tests/fleet-hold-wiring.test.ts` does not exist in this worktree, so Vitest ran the other five named files. The broader seven-file regression run passed:

```text
Test Files  7 passed (7)
     Tests  151 passed (151)
  Duration  2.87s
```

Typecheck tail:

```text
✓ src/web/tsconfig.json  (344 files)
✓ tests/tsconfig.json  (1852 files)
✓ tools/fleet/web/tsconfig.json  (81 files)
✓ tsconfig.json  (583 files)
✓ all 1932 source files are covered by some project
```

Biome lint exited 0 with informational diagnostics only; `git diff --check` exited 0. Full `npm test` could not start its database-backed lanes because local Postgres/Docker was unavailable (`connect EPERM 127.0.0.1:54362`); the scoped suites require no database and passed.

Changed files:

- [tools/fleet/receipt-journal.ts](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/tools/fleet/receipt-journal.ts)
- [tools/fleet/quarantine.ts](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/tools/fleet/quarantine.ts)
- [tools/fleet/journal-file.ts](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/tools/fleet/journal-file.ts)
- [tools/fleet/hold-ledger.ts](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/tools/fleet/hold-ledger.ts)
- [tests/fleet-receipt-journal.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/tests/fleet-receipt-journal.test.ts)
- [tests/fleet-action-stores.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts/tests/fleet-action-stores.test.ts)

No commit or index/history change was made.

land with the fixes above