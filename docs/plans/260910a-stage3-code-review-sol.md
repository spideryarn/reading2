REFUSE `154e084f` as committed. Two established P1s remain in the append/rotation protocol; fixing them requires choosing a different concurrency design rather than a narrow patch.

## Findings

- **F36 — P1, open: a partial append corrupts the journal and can erase the next successful refusal.** [`appendFileSync`](</home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/admission-journal.ts:93>) is not transactional. With a real 1,024-byte `RLIMIT_FSIZE`, the kernel appended 124 bytes and then rejected the remainder. `recordRefusal` correctly returned `false`, but left half a JSON object. A later call returned `true`; its JSON joined the fragment and the reader lost both records as one unparseable line. `PIPE_BUF` applies to pipes/FIFOs, not regular files. `O_APPEND` does not provide all-or-nothing failure semantics.

- **F37 — P1, open: rotation can permanently lose an append that returned `true`.** I paused a real writer after it opened `refusals.jsonl` but before it wrote, performed two actual [`renameSync`](</home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/admission-journal.ts:178>) rotations, then released it. The writer exited through the `true` arm, but wrote to an inode already unlinked by the second rotation; the reader never saw the entry. One isolated rotation preserves the old inode, but the two-generation protocol does not make that guarantee across consecutive rotations.

- **F38 — P2, open: the request-path read is not bounded.** Writers never enforce 64 KiB. [`readRefusals`](</home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/admission-journal.ts:186>) renames an arbitrarily large live file and then reads the entire previous file. A temporary journal of 100,000 valid entries was 16.6 MB and took **225.73 ms** synchronously to read. The natural production write rate is low, but sustained memory pressure, a retry loop, or a long period without an admission request makes both disk growth and dashboard blocking unbounded.

- **F39 — P2, fixed:** serializable but invalid inputs—`Infinity`, negative bytes, or a blank host—previously returned `true` and produced lines rejected by the same module’s reader. The writer now validates its serialized entry with its own parser before appending.

- **F40 — P2, fixed:** an all-unparseable journal previously rendered “nothing was recorded.” It now says “No readable refusal entries were found” and reports the parse count.

- **F41 — P2, fixed:** the panel’s limitations omitted retention loss. It now states that only the live and previous files are kept and older entries are discarded.

The open P1s need either serialized access with recovery semantics or a per-record atomic-file design. A lock conflicts with “may never block”; preserving append-only JSONL cannot provide all-or-nothing behavior after partial regular-file writes.

## The four claims

1. **Accurate**, for catchable exceptions occurring inside `recordRefusal`. Throwing getters, a throwing clock, and `BigInt` serialization all returned `false` without propagating. Process-fatal conditions such as OOM are outside that claim.

2. **Inaccurate.** A normal ext4 stress run preserved 4,000/4,000 concurrent entries, but F36 disproves the absolute parseability guarantee and F37 disproves the rotation guarantee.

3. **Accurate after the repair.** Empty, absent, unreadable, and all-unparseable states no longer imply that no refusal occurred.

4. **Accurate.** Both writers pass stored values. In `vitest.config.ts`, hoisting preserved the exact original order: nominal workers → memory snapshot → reserve → decision. No additional work moved between those operations. The readiness writer also journals the exact values supplied to `decideTick`, although its hoist moved `nominalWorkers()` from before the readings to after them; that does not introduce a later memory or reserve sample.

The source labels remain distinguishable under “Recorded admission refusals”; I do not consider `test run` versus `readiness precheck` a defect.

## Verification

- Allowed focused suites: **96 passed**
- Typecheck: **all 1,914 files covered; all projects passed**
- Targeted lint: no errors; one pre-existing JSX-semicolon warning
- `git diff --check`: passed
- All attacks used temporary directories; `~/.fleet-admission/` and `:8787` were untouched
- No commit created

Files changed:

- [admission-journal.ts](</home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/admission-journal.ts>)
- [tests/admission-journal.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tests/admission-journal.test.ts>)
- [AdmissionSection.tsx](</home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/web/src/AdmissionSection.tsx>)
- [tests/fleet-admission-panel.test.tsx](</home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tests/fleet-admission-panel.test.tsx>)