# Stage 1b task: Sol's Stage 1 findings, and the per-class hold condition

Worktree `/home/greg/code/spideryarn2/.claude/worktrees/launch-protocol`. Plan
`docs/plans/260910f-launch-protocol-one-crash-protocol-for-scheduling-and-recovery.md` — read its
"Review dispositions" section, the Stage 1 status, and the two "Agreed with …" paragraphs under it
(the seams with `scheduled-dispatch` and `gradual-recovery`). Stage 2 has just landed in this
worktree too: read `tools/overseer/launchers.ts` and the current `launch-protocol.ts` (it now has a
run spec and a `tmux-headless` launcher kind) before editing — do not undo any of it.

## The findings

Sol's review of Stage 1: `docs/plans/260910f-launch-protocol-stage1-review-sol-b.md`, full record
`docs/plans/260910f-launch-protocol-stage1-review-sol-b-findings.md`. Its four reproductions are in
`logs/lp-repros/` (gitignored — read them for the exact failing input, then write proper regression
tests in the real suites; do not copy them into `tests/` verbatim). Each has been checked against
the code and is real.

- **F16 (P1)** — reconciliation reads evidence from the absolute `artefactDir` stored in the
  journal, checked only for being absolute and ending `/o/<id>/a<n>`, so a journal from another root
  (or a hand edit) makes it read another store's `exit.json` and release this slot. Fix: derive the
  directory from the open store's `attemptDir(id, attempt)` everywhere it is read; keep the journalled
  path only as a record, and make a mismatch between it and the derived path `history-lost` on replay
  (or drop the field from the record, if nothing else needs it — say which).
- **F17 (P1)** — once the launch record says `released`, reconciliation never asks the owner again,
  so an owner journal repaired (or restored) to show that key reserved leaves a ghost reservation
  that blocks the class for ever and that `dispose` refuses. Fix: for terminal or disposed records,
  check the owner's truth even after `released`, and idempotently release a resurrected key under
  the existing durable licence (no new journal kind unless the fold genuinely needs one; say which).
- **F18 (P2)** — the fold accepts `waiting-admission` twice with the same reason, which D3 forbids
  and `drive()` never writes. Fix: reject it in the transition rules; add it to the F11 cases.
- **F19 (P1)** — `evidenceDecision`'s `other-boot` arm returns `hold` when the separate `boot()` read
  failed, although the identity reading already carries both boot ids. Fix: use the identity
  reading's own recorded/current boot ids in that arm.
- **Weak test row** (the F14/F15 fixer's note): the store suite's "a history reset after the first
  line" row uses `acknowledgement: "x"`, which fails to parse on its own, so it is not isolating the
  rule it is named for. Make it a well-formed reset line that fails only because of its position.

## `endedAt` on the terminal arms (asked by `scheduled-dispatch`)

The fold's `completed` and `failed-before-launch` states each carry `endedAt`: the `at` of the event
that entered that state, never moved by `released` or anything after it (`updatedAt` keeps meaning
"the last line about this occurrence"). Test: complete an occurrence, release it later, and assert
`endedAt` is the completion's instant and differs from `updatedAt`; the same for a
`failed-before-launch` followed by `released`.

## The per-class hold condition (plan: "(Q2) Admission classes get a typed hold condition")

In `launch-admission.ts` and `launch-protocol.ts`: the admission class becomes a closed set of two,
each with a typed policy — `claude-session`: capacity 1, **held until exit evidence** (today's
behaviour); `recovery-resume`: capacity 1, **released on `observed-running` evidence**. Reconciliation
releases a `recovery-resume` reservation when it records (or finds) `observed-running`, under a
licence that says so; `outcome-unknown` holds in both classes. A class switch must be exhaustive
(`never`). Tests: a `recovery-resume` occurrence releases at observed-running and its slot is then
free for a second resume; a `claude-session` one does not; a crash between recording
`observed-running` and the owner's release still releases on the next reconcile (F7's pattern).

## How to work

Red first for every item — write the test, see it fail for the stated reason, then fix. Small
targeted edits; re-read each region immediately before editing. Files: `tools/overseer/launch-*.ts`,
`tools/overseer/launchers.ts` only if a type change forces it, and `tests/overseer-launch-*.test.ts`,
`tests/overseer-launchers.test.ts`. Plain single Bash commands with literal paths (the session is
worktree-isolated); a temp dir per test; fresh uuids; focused suites only (`npx vitest run
tests/overseer-launch-protocol.test.ts tests/overseer-launch-store.test.ts
tests/overseer-launch-admission.test.ts tests/overseer-launch-artefacts.test.ts
tests/overseer-launchers.test.ts tests/fixture-ids.test.ts`), `npm run typecheck` judged by exit
code. Do not commit; no state-changing git.

## Report back

For each item: the test, the red failure message, the fix, green. Final vitest and typecheck exit
codes. Any finding you judged wrong on closer reading, with the evidence.
