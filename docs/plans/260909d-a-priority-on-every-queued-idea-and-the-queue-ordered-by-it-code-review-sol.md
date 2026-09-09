## P0

None. Priority does not enter `isDispatchable`, `whyNotDispatchable`, `queueDepth`, the dispatch fold arm, or the route’s `ready`. It changes `waitingAhead`/`itemWait` only through the intentionally reordered `view.items`.

## P1

### P1-1 — `appendEvents` can persist an invalid in-memory priority

**Failure:** Given a valid queued item, call `appendEvents` with a constructed `prioritized` event:

- `priority: NaN` or `Infinity` is serialized as `null`; the append returns success and silently clears the priority.
- `priority: 9` is written verbatim; the append still returns success, but the resulting line is unreadable and holds the whole queue.

I reproduced all three. This is exactly the entrance the test comment says can receive `NaN` and `Infinity`, but the test only calls `isPriority`; `appendEvents` never calls it.

**Where:** [idea-queue.ts](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/tools/overseer/idea-queue.ts:849), [idea-queue.ts](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/tools/overseer/idea-queue.ts:1522), and the incomplete test at [overseer-idea-queue.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/tests/overseer-idea-queue.test.ts:1372).

**Instead:** validate each in-memory event at the persistence boundary before folding or serializing it. Refactor the object validator behind `parseEvent` so it can validate an `unknown` object directly; serialized round-tripping alone is insufficient because `NaN` becomes valid `null`. Assert rejection and byte-identical files for `NaN`, both infinities, and out-of-range finite values.

### P1-2 — a refused append can still modify or poison the record

Two concrete failures:

1. On a never-used root, append a `prioritized` event naming an unknown item. The call returns `would-break`, but it has already created `queue.created`. There is no queue file, so the next read reports a lost queue rather than `never-written`.
2. Given a valid record followed by a torn final line, append an invalid event. The torn bytes are truncated, then candidate validation refuses the append. The failure result contains no repair information, so the record changed irreversibly while the caller was told only that its write was refused.

I reproduced both; the second changed the file while returning `would-break`.

**Where:** repair happens at [idea-queue.ts](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/tools/overseer/idea-queue.ts:1478), while the marker is written before candidate validation at [idea-queue.ts](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/tools/overseer/idea-queue.ts:1501).

**Instead:** move marker creation after candidate validation but immediately before the first record. Preflight against the complete-line prefix without first truncating it, or make repair a separately reported outcome carried on every success and failure result. Add tests for invalid first append and torn-line-plus-refusal.

### P1-3 — the reviewed priority file is not pinned

**Failure:** Dry-run a file assigning `A=.9, B=.1`; keep the queue unchanged; edit the same file to `A=.1, B=.9`; execute the printed apply command. It succeeds and applies the reversed ordering. I reproduced this end to end.

`--expect-version` pins only the queue. The comment claiming dry run and apply “cannot drift, because they are the same function” is false: they invoke that function on different file contents.

**Where:** the file is independently re-read at [overseer-queue.ts](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/scripts/overseer-queue.ts:520), while the printed token contains only the queue version at [overseer-queue.ts](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/scripts/overseer-queue.ts:539).

**Instead:** print a digest of the exact reviewed file bytes or normalized wishes, require it on apply, and refuse if it changed. The explicit resolved `--root` is correct: it pins the reviewed queue and protects against environment changes.

## P2

### P2-1 — misplaced `priority` is rejected on only two event kinds

**Failure:** `edited { text, priority }` is rejected, but `moved { placement, priority }`, `authorized { revision, priority }`, or `prioritized { priority, needsGreg: false }` parses successfully and silently ignores the misplaced field. A buggy writer can still believe both operations happened.

**Where:** event-specific parsing at [idea-queue.ts](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/tools/overseer/idea-queue.ts:1152).

**Instead:** define allowed keys per event kind and reject every unexpected event-specific key. The live record currently contains no extra keys, and specifically no `priority` on `added` or `edited`, so strict validation would not retroactively invalidate it.

### P2-2 — schema-1 payloads without the new field are accepted and rendered incorrectly

**Failure:** Remove `priority` from a row in an otherwise valid schema-1 response. `readPayload` accepts it. The collapsed row renders no marker, and the opened facts render `"undefined"` instead of “unstated.” I reproduced the acceptance.

**Where:** the shallow validator at [queue-client.ts](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/tools/fleet/web/src/queue-client.ts:65) and rendering at [QueuePanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/tools/fleet/web/src/QueuePanel.tsx:339).

**Instead:** validate/normalize every row, treating an absent priority as `null` if schema 1 is intentionally backward-compatible; otherwise bump the wire schema.

### P2-3 — the promised ordering provenance is not visible on the dashboard row

`priorityBy` and `priorityAt` exist in the folded item and CLI `show`, but the route carries only `priority`. The comment saying these fields make the act “visible on the row” is therefore false.

**Where:** claim at [idea-queue.ts](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/tools/overseer/idea-queue.ts:413); omission at [routes-idea-queue.ts](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/tools/fleet/routes-idea-queue.ts:140).

**Instead:** either carry and render both provenance fields, or narrow the claim to CLI inspection.

### P2-4 — three test gaps remain

- The panel-order test uses `indexOf(first) < indexOf(second)`. If the first row disappears, `-1 < secondIndex` passes. Mutation that should red: omit the first server row. Assert both indices are non-negative before comparing, or inspect the ordered row buttons. [Test](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/tests/fleet-queue-panel.test.tsx:332)
- The `NaN`/`Infinity` test checks the predicate rather than persistence. Mutation that should red: let `appendEvents` accept an invalid in-memory priority—as it currently does. [Test](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/tests/overseer-idea-queue.test.ts:1372)
- Automated `set-priorities` tests exercise helpers, not the CLI apply path. Deleting the CLI’s `--expect-version` enforcement or its `priorityApplyRefusals` call leaves these tests green. Add subprocess tests asserting non-zero exit and byte-identical records. [Tests](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/tests/overseer-idea-queue.test.ts:1465)

The repaired unstated-marker test is now sound.

## Confirmed points

- The new baseline/candidate comparison is sound for normal replay: the candidate folds the exact existing-event prefix, so existing fold problems are a prefix and later events cannot remove them. Parse failures are excluded from both sides. Nothing in that comparison still uses `current.problems`.
- Multiple unreadable complete lines and an empty uninitialized file behave safely. Torn-line handling has the reporting/side-effect defect above, not a problem-count defect.
- The cross-band guard does not invalidate the live history: the live log has no `moved` or `prioritized` events. More generally, old valid histories had every item implicitly `null` when moves replayed; later priority events do not retroactively recheck earlier moves.
- Refusing `priority` on `added` and `edited` affects no live line. The compatibility argument therefore holds for the sole production record.
- Allowing unnamed items is defensible for a deliberate subset operation, but weak for the stated one-off “band everything” migration. An explicit `--allow-unnamed` would cheaply distinguish intention from omission.

**Verdict: do not ship it until the three P1s are fixed.**