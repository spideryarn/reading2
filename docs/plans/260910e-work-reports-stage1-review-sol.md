# Stage 1 code review, first run — RECOVERED, not written by the reviewer

**This run was killed at its 30-minute limit before it wrote an answer** (`run-codex` EXIT=1). What
follows is reconstructed by the orchestrator from the run's own narrative lines in its activity log
(`260910e-work-reports-stage1-review-sol.md.activity.log`, the lines after each `codex` marker) and from
the diff it left, committed as `6b1761e7`. Its wording is paraphrased; its severity labels were never
given, so none are invented here. **There is no verdict**: the run was in its final gates when it died.

## What it found and fixed, in its order

1. **Nested artefact objects silently dropped unknown fields**, so two byte-distinct hand-dropped
   submissions could canonicalise to the same submission and be taken for an honest duplicate — the
   hole in the replay argument. Fixed: exact keys in `artefact-ref.ts`. It judged the append→cleanup
   replay path otherwise sound: after the append the prepared bytes stay authoritative, and rebuilding
   from the inbox removes only daemon-stamped fields.
2. **Execution observer race**: "this pid is Claude" and the pid's start tick were read at different
   instants, so a reused pid could yield a token for a process that was never the observed Claude.
   Reproduced red; fixed by bracketing the command-line read with two matching `/proc/<pid>/stat` reads.
3. **The 5 s drain ceiling was checked only between files**, so one report could trigger all its git
   probes after the deadline. Now checked between probes. Named limit: the ceiling is cooperative — one
   in-progress git probe can overrun by its own timeout.
4. **A refusal record's timestamp was printed raw to the terminal.** Now it must be a canonical ISO
   instant or reads "an unrecorded time".
5. **Mutation check on `artefact-ref.ts`** (its test had never been seen red): the 20-item limit was
   changed to 21 to see whether the suite noticed, then restored.
6. **`report-processing/` replay followed symlinks and read unbounded**, a daemon-stall route. Now the
   same no-follow, nonblocking, descriptor-checked read as the inbox, 64 KiB ceiling.
7. **Hard links**: an external inode was accepted as a submission. More than one link is now skipped.
8. **A torn append was followed by another append in the same pass**, which could weld a good line onto
   the tear and lose an honest later report. Reproduced; the pass now stops on any transient failure, and
   the regression shows the next pass truncating the tear and recording both reports once.
9. **`report-refused/` was read through symlinks and FIFOs** by the CLI. Now bounded and no-follow.

## What it raised and did not fix

- **The whole inbox directory is listed every pass** to keep global oldest-first order; with hostile
  entries left in place this is unbounded work. It called this design-level.
- Its sandbox refuses `spawnSync("git")` from Node, so the real-git artefact-checker test could not pass
  there. (It passes outside the sandbox: the orchestrator's run of the six Stage 1 files, 170 passed,
  includes it.)

## What it did not reach

Question 6 of the brief (claims staying claims in the CLI output and the fold); `report-artefacts.ts`
beyond reading it; whether its own new stop-on-any-transient-failure rule lets one stuck item starve
every later submission; the daemon's `reports` condition in `notes.ts`. Those are the second run's scope.
