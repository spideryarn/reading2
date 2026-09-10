# Review: Stage 1 of the launch protocol — records, store, admission owner, reconciliation

Repo: this worktree (`.claude/worktrees/launch-protocol`), branch `worktree-launch-protocol`.
TypeScript + ESM, `tsx`, vitest.

## The candidate

Committed: commit 25bd82bf (one commit).
    git show --stat 25bd82bf
changed paths: tools/overseer/launch-protocol.ts, tools/overseer/launch-store.ts,
tools/overseer/launch-admission.ts, tools/overseer/launch-artefacts.ts,
tests/overseer-launch-protocol.test.ts, tests/overseer-launch-store.test.ts,
tests/overseer-launch-admission.test.ts, tests/overseer-launch-artefacts.test.ts, and two docs
(the plan's Stage 1 status, which lists the builder's twelve departures, and the Stage 3 brief).

Note: another implementer is building Stage 2 in this worktree while you read, so files outside the
manifest (`scripts/`, `tools/overseer/launchers.ts`, and `launch-artefacts.ts`'s writers) may be
mid-edit. Review commit 25bd82bf's bytes (`git show 25bd82bf:<path>` if a working file looks odd).

Start with: `tools/overseer/launch-protocol.ts`, then `launch-store.ts`, `launch-admission.ts`,
`launch-artefacts.ts`, and the tests. This is where to begin, not the limit — the manifest is.

## What it is meant to do

The plan is `docs/plans/260910f-launch-protocol-one-crash-protocol-for-scheduling-and-recovery.md`;
its "Review dispositions — Sol, plan round 1" section is your own previous review and overrides
D1–D11. This stage is the durable core only: no real launcher (Stage 2), no daemon wiring or inbox
(Stage 3). The invariant: **after a crash at any point, a restarted process never invokes the
launcher a second time for an occurrence whose first invocation may have had an external effect,
never holds two reservations for one occurrence, and never releases a reservation without
evidence (a valid `exit.json`, `other-boot`, or proof of failure before launch) or an attributed
disposition.** And: a journal that cannot be replayed whole and legally refuses new launches.

## What you can and cannot run, and what you may change

**Findings only this round: the tree is read-only for you.** /tmp and the node_modules caches are
writable, so run the focused suites yourself: `npx vitest run tests/overseer-launch-protocol.test.ts`
(and the other `tests/overseer-launch-*.test.ts`). No network. My own run of those suites and the
typecheck is at `docs/plans/260910f-launch-protocol-stage1-results.txt` (vitest exit 0, 128 tests;
typecheck exit 0).

**Write your findings FIRST, as you go, to `/tmp/260910f-launch-protocol-stage1-review-sol-findings.md`**,
then give the whole review as your final answer.

## Attack it

Independently, before my questions. Break the invariant above: find a crash point, an interleaving,
a record sequence the replay accepts but should not, or an evidence combination where
reconciliation releases, relaunches or moves a record it must not. Check that the fault-injection
harness actually injects at the points it names (a harness that crashes after the point it claims
proves the easy row). Check each F-disposition of your plan review that applies here — F1, F2, F4,
F5, F7, F8, F9, F11 and suspicion 3 — is implemented, not only commented.

For each finding: an ID (continue from F14; F1–F13 were the plan round), severity (P0–P3 as in
your plan review), established or reasoned, (a) the input or mutation I can run, (b) the smallest
change that closes it. Refuse only on an established P0 or P1.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

1. The builder wrote the code before the tests and compensated with seven deliberate mutations.
   Which rule has a test that could not have gone red — a harness crash point that fires after the
   step it names, or an assertion that holds at zero (your own F12 class)?
2. The owner's `lookup`/`release` gained a third arm, `unavailable`, overriding your F8 wording, on
   the argument that a fail-closed owner can say `none` only by lying. Is every consumer of that arm
   conservative — no path where `unavailable` is treated as `none` and licenses a release or a
   second `reserve`?
3. `drive()` continues from a `reserved` record by calling `reserve` again; reconciliation instead
   turns a `reserved` into `failed-before-launch` and releases. Can those two ever run against the
   same record such that a slot is released while the drive that holds it invokes the launcher?
4. `launching` stores an absolute artefact path, and the fold checks only its tail. Does anything
   read a path from the journal and trust it — could a hand-edited or old-root journal make
   reconciliation read another occurrence's `exit.json`, or one outside the store?

Do not change any file in the repo.
