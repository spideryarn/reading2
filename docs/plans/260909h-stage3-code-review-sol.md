# Stage 3 code review — work evidence projection and browser

**Reviewer:** GPT-5.6 Sol, high effort, 2026-09-09.  
**Candidate:** live pre-commit tree at base `6319b7a8f5ffc8eeff7126d77f58dd0e1a91ef51`; the
user required that the stage remain uncommitted.  
**Verdict:** accepted after fixes; round 2 accepted the fixes with no further edits.

The repository wrapper could not start its nested Codex process in this sandbox: the in-process
app-server client hit a read-only filesystem before the model ran. The same model and brief were
therefore dispatched through the available agent runner. The failed wrapper left no candidate edit.

## Findings

- **F1 — P1, established, fixed.** A one-hour-old `none` or `cannot-tell` scan still rendered in
  the present tense. Stale readings now say that nothing *was* recognised, or that the scan *could
  not* tell, and include the single scan age. Fresh wording is unchanged.
- **F2 — P1, established, fixed.** A pane start later than `scannedAt` crossed both parsing
  boundaries as valid measured work. The server and browser now reject pane or job starts after the
  scan and depth-zero positive child jobs, degrading only work. Equality, `inspected: 0`, and null
  job starts remain valid.

Round 2 checked the two fixes as unreviewed code and closed both. No further findings.

## Evidence after the fixes

- Five focused suites: 505/505 passed.
- Real-daemon end-to-end test: 1/1 passed.
- All four direct `tsc --noEmit -p …` projects exited 0.
- `npm run build:fleet` and `git diff --check` exited 0.

