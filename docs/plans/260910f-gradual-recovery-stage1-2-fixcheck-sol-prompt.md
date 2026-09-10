# Narrow check: the fixes for G11–G19 (read-only, 20 minutes)

This is **not a new review**. Discovery closed with your stage review
(`docs/plans/260910f-gradual-recovery-stage1-2-review-sol.md`, nine established P1s, G11–G19). Your
only job here: **for each of G11–G19, is the fix in the candidate sound, and does it close the
finding?** Do not look for new findings unless a fix itself introduced one. Read-only; do not change
any file. The sandbox cannot write to the tree, so put everything in your closing answer.

## The candidate

- The fix commit: **FIX-SHA** on `worktree-recovery-resume`. Its diff is exactly
  `git show FIX-SHA`, and `git show --name-only FIX-SHA` lists its paths.
- The code it fixes: `cfc963eb` and `1704334e` (Stages 1 and 2).
- The fixer's own account, finding by finding: the "Fix pass" paragraph in the plan's Stage 1–2
  section of `docs/plans/260910f-gradual-recovery-resume-selected-interrupted-work-one-at-a-time.md`.

**G12 deliberately takes a different fix from yours.** The matching transcript line must begin
*after the byte offset* recorded in `attempts/<id>.json` before invocation, rather than being tied
to the protocol's `launching.at`. Judge whether that closes G12 on its own terms, including the
case where the offset lies before the bounded tail window.

**G13 depends on a port operation**, `drive(candidateId)`, that the real launch protocol maps only
in Stage 3b. Judge the recovery side: do the gates and revalidation run before `drive`? Is it
synchronous? Can it be called for a terminal occurrence?

## Raw evidence (the manager's runs on the candidate)

```
npm run typecheck                      TYPECHECK_EXIT=0
npx vitest run <21 files: overseer-account-quota-gate, overseer-launch-gate,
  overseer-recovery-resume, overseer-daemon-recovery-resume, overseer-recovery-resume-orphans,
  overseer-daemon-recovery, overseer-recovery, overseer-recovery-view, fixture-ids,
  fleet-recovery-feed, fleet-recovery-route, fleet-recovery-panel, fleet-recovery-wiring,
  fleet-recovery-resume-route, fleet-recovery-resume-panel, fleet-attention,
  fleet-claude-argv, fleet-steer, fleet-execution-identity, overseer-observation,
  fleet-producer-stamp>
                                       VITEST_EXIT=0   Test Files 21 passed (21)   Tests 792 passed (792)
npm run build:fleet                    exit 0 (the fixer's run)
```

**FIX-SHA also carries Stage 3a**, because the two share `wire.ts`, `recovery-resume.ts` and the
resume tests, so neither builds alone. Stage 3a's own files are **out of scope here**:

- `tools/fleet/claude-argv.ts`, `execution-identity.ts`, `state.ts` and `web/src/types.ts`;
- `tools/overseer/observation.ts`, and the `observe()` line in `daemon.ts`;
- their tests: `fleet-claude-argv`, `fleet-steer`, `fleet-execution-identity`,
  `overseer-observation` and `fleet-producer-stamp`, plus `tests/fixtures/claude-argv/`;
- in `recovery-resume.ts`, the `producerCanVerifyResume` hook.

Stage 3a gets its own review with Stage 3b. Judge only the G11–G19 fixes.

You may run one vitest file yourself.

## Form

For each of G11–G19: **closed**, or **not closed**, with evidence (`file:line`), and if not closed,
what is missing. Any new defect a fix introduced gets an ID from **G20** on, with a severity
(P0/P1/P2/P3) and established or reasoned. End with one line: *all closed*, or the IDs still open.
