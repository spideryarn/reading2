Finished — the refusal journal now publishes one parser-valid file atomically per refusal. No commit was made, and neither writer call site changed.

Changed files:

- [admission-journal.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/admission-journal.ts:24) — atomic temp-file publication, lexical names, collision/inode verification, stale-temp cleanup, and 256-record pruning.
- [tests/admission-journal.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tests/admission-journal.test.ts:119) — failure, concurrency, cleanup, ordering, collision, and retention tests.
- [AdmissionSection.tsx](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/web/src/AdmissionSection.tsx:128) — replaced obsolete rotation wording with bounded-record retention wording.
- [fleet-admission-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tests/fleet-admission-panel.test.tsx:231) — pins that wording.

Red evidence against the old implementation:

| Test | Old failure |
|---|---|
| Partial `RLIMIT_FSIZE` write | Next writer returned `true`, but the reader returned zero entries and `unparseableLines: 1`. |
| Writer paused across two prunes | Writer returned `true`; its refusal was absent. |
| Stale temp cleanup | Temporary file was ignored but never removed. |
| Count pruning/interleaved write | Prune returned `false`; the old byte-rotation API provided no newest-N behavior. |
| Same-millisecond, different-pid writes | Expected two final files; old implementation had none because it used one JSONL file. |
| Retention cap | Expected 256 entries; old reader returned all 281. |
| Per-record corruption | Expected two unparseable records; old reader ignored those files and reported zero. |

The existing 4×40 separate-process concurrency test remained green.

Two extra tests caught defects in the first redesign itself:

- Forced identical name components initially let the second call return `true` and overwrite the first.
- Stale cleanup plus pathname reuse initially let writer A return `true` for writer B’s inode.

Both are fixed by holding the exclusive temp descriptor through publication and verifying the final file’s device/inode before returning success. Sol’s follow-up review confirmed F43 closed.

Verification:

- Focused suites: **103 passed**
- Typecheck: **all 1,914 covered files passed**
- Scoped lint: exit 0; one pre-existing JSX-semicolon warning
- `git diff --check`: passed
- Capped read measurement: **7.23 ms** initial prune/read; **4.98 ms median**, **7.95 ms p95** over 25 subsequent reads of 256 records

Plain limitation: the unqualified statement “returns true implies readable forever” is still impossible. A later—or overlapping—retention prune may intentionally remove an eligible record; backwards clock movement can make a fresh record sort old; external filesystem changes can remove it; and no `fsync` means power-loss durability is not guaranteed. Under normal operation without those events, `true` now means this call’s exact parser-valid inode was atomically published, never a fragment or another writer’s record.

The 256 cap bounds JSON reads and post-prune retention, but the initial directory listing, sort, and deletion pass remain proportional to however many files accumulated since the previous read.