Implemented Stage 2 without committing.

Changed files:

- [admission-client.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/web/src/admission-client.ts) — typed late-bound API seam, defensive parser, browser-owned `no-answer` arm, and timestamp range checks.
- [AdmissionSection.tsx](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/web/src/AdmissionSection.tsx) — renders all outcomes, raw refusal output, labels, disclaimer, and stated absences without bars or fabricated zeroes.
- [HealthPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/web/src/HealthPanel.tsx) — optional defaulted API and one mount line.
- [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/web/src/App.tsx) — injected/defaulted API prop.
- [fleet-admission-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tests/fleet-admission-panel.test.tsx) — 15 tests covering the requested behavior.

Red-first failures:

- Seam request count was `0`, expected `1`.
- Each of the five outcome sentences was absent.
- The invariant and `--maxWorkers` disclaimer were absent.
- Review/browser cases lacked the “no cost model” statement.
- The browser-owned failure sentence was absent.
- All three absent-number cases had no admission section.
- Both parser tests returned the deliberate `not-implemented` arm instead of `no-answer`.
- The initial pre-placeholder run also failed because the new client module did not yet exist.

Verification:

- Required focused suites: 442 tests passed.
- Final admission rerun: 15 tests passed.
- Typecheck logic: all four projects passed; all 1,912 TypeScript files covered.
- The literal `npm run typecheck` exited before TypeScript ran because this sandbox forbids the `tsx` IPC socket. Running the same script via `node --import tsx` passed.
- New-file lint passed. Full touched-file lint still reports the pre-existing array-index key warning/error in `HealthPanel.tsx`.
- GPT Sol review was attempted but could not initialize because its runner tried to write outside the sandbox.

Placement: immediately after `<HealthHistory>` and before the raw-data disclosure. This leaves the history card’s record → charts → verdict strip/time axis → legend sequence uninterrupted.