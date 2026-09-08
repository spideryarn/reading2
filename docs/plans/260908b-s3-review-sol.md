The final-line repair is correct, but I would not accept the stage yet: the lock is not actually exclusive, and recovery can construct plausible state from an incomplete log.

## Findings

- **S3-01 — P0 — [store.ts:685](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/store.ts:685): lock acquisition still has a two-writer race.**  
  Concrete sequence: A and B both read an absent/stale lock; A renames its record and reads it back successfully; A’s `append()` checks ownership and is suspended; B performs its delayed rename, reads itself back, opens the empty log, and appends its first snapshot; A resumes after its already-passed ownership check and appends the same transition. Both calls succeed and the history contains duplicate, plausible events. The read-back only catches contenders that renamed before the read; checking ownership before a write remains a TOCTOU check. Opening and torn-log repair also proceed without rechecking ownership, so a delayed loser can truncate while the eventual winner is appending. Acquisition needs an atomic exclusion primitive, rather than overwrite-plus-read-back.

- **S3-02 — P1 — [store.ts:845](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/store.ts:845): replay folds across holes and can manufacture a plausible register.**  
  Concrete sequence: with no checkpoint, the log contains `session-seen(A)`, an unreadable line that was `tmux-session-gone(A)`, then `session-seen(B)`. `parseEventLog` skips the bad line, and `openStore` announces `rebuilt` with A and B both live. Reporting `unreadableLines: 1` does not make the resulting register true. Conversely, a syntactically valid `"session-seen"` carrying the three shallow fields but no `row` passes `looksLikeEvent` and crashes in `entryOf`, violating disposability. This file is not a hostile-user security boundary, but it is a persistence/version/corruption boundary. A replay should be accepted only if every relevant line passes per-kind validation; otherwise use the good checkpoint or start cold.

- **S3-03 — P1 — [store.ts:712](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/store.ts:712): the register cannot satisfy the “last observed name” requirement.**  
  Concrete sequence: A is first seen as `old-name`; it is renamed to `new-name` while identity and status remain unchanged; `diff()` emits no event; `append([])` changes nothing; the next checkpoint and every full-log rebuild retain `old-name`. Reboot recovery therefore offers the name Greg deliberately replaced. The event vocabulary needs a rename/metadata-refresh event, because a fold cannot reconstruct facts that were never logged.

- **S3-04 — P1 — [store.ts:242](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/store.ts:242): a resumed/rebuilt store does not expose a baseline usable by the existing differ.**  
  Concrete sequence: A was working when checkpointed; the daemon restarts; its first new snapshot has A idle. The store exposes only `SessionRegister`, while `diff()` requires an `AdmissibleSnapshot`; the register lacks the full status and collection clock needed to construct one. Passing `null` produces a second `session-seen` instead of `working → idle`; implementing another comparer in S4 duplicates the generation, replacement, and wait logic. The `cold | rebuilt | resumed` distinction is conceptually right, but needs an explicit seam through which the compact restored baseline can drive the canonical differ.

- **S3-05 — P2 — [store.ts:758](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/store.ts:758): checkpoint/log agreement is API-shaped, not type-enforced.**  
  Concrete sequence: append a `session-seen` whose `row.meta.dir` is `/a`; `entryOf` retains the same mutable `meta` object; mutate the original row to `/b`; call `checkpoint()`. The event log says `/a`, while the valid checkpoint says `/b`. Likewise, `ReadonlyMap` prevents `set` but its mutable `RegisterEntry` values can be edited through `store.register.get(...)`. Defensive copying plus readonly entry fields is needed for the stated guarantee.

- **S3-06 — P2 — [store.ts:1023](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/store.ts:1023): the checkpoint cursor currently saves no startup work.**  
  Concrete sequence: after an unrotated log grows to 1 GB and the checkpoint cursor is at its end, restart with no tail to replay. `openStore` still allocates the whole 1 GB buffer and parses every event before reading the checkpoint; on this already OOM-prone box that can become a restart loop. `readEvents(fromByte)` similarly reads the whole file before slicing. This is the nearer cliff; `current.json` rewriting is not.

- **S3-07 — P2 — [store.ts:264](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/store.ts:264): a relative override defeats both the global location and lock.**  
  Concrete sequence: systemd starts with `OVERSEER_STORE_DIR=.overseer` from the primary checkout; a manual start uses the same environment from a worktree. Each resolves a different directory, acquires a different lock, and writes a separate plausible history. Require an absolute override, as `meta.dir` already does.

## Design-call verdicts

- Torn final-line recovery itself is sound: under a genuine single writer, complete newline-terminated events survive, the incomplete suffix is removed once, and later appends remain independently parseable.
- Refusing an unreadable lock and accepting PID-reuse false refusals are both the right directions. An atomic lock written temp-then-rename should not become unreadable from an ordinary OOM tear, so the manual-removal exception is appropriately narrow.
- The register is mechanically a fold of the accepted events, but the persisted history currently omits rename refreshes, and checkpoint-only clocks are intentionally lost on rebuild.
- `cold | rebuilt | resumed` is the right conceptual distinction; the missing integration with `diff()` prevents it from delivering that distinction safely yet.
- Shallow event validation avoids duplicating `ObservedRow` parsing, but accepting a partially understood durable log conflicts with the project’s “correct and unavailable” rule.
- JSONL, one file, no rotation, and the current checkpoint size remain proportionate. The unnecessary whole-log read is the first scaling issue to remove.

Focused verification: `npx vitest run tests/overseer-store.test.ts` passed, 35/35. No files were changed.