# Review, round 2 (findings only): Stage 2 of the recovery inventory

Repo: /home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory (a linked worktree of
spideryarn/reading2), branch `worktree-recovery-inventory`. TypeScript, ESM, `tsx`; tests are
vitest.

**The tree is read-only for you. Do not change any file.** Round 1 of this review was writable. It
ran out of time part-way through, and left fixes but no verdict. This round must produce a verdict:
spend your time on finding, not on fixing. For each finding, give the fix as a code block or exact
wording, and I will have it applied.

## The candidate

Two commits, reviewed together:

1. The stage itself: the commit whose message begins "Recovery inventory stage 2:"
   (`git log -1 --grep='Recovery inventory stage 2:' --format=%H`).
2. Round 1's fixes, **unreviewed code written by someone else**: the commit whose message begins
   "Recovery inventory stage 2, Sol round 1" (`git log -1 --grep='Sol round 1' --format=%H`).

Review `git diff <stage-commit>^1 <round-1-commit> -- tools scripts tests`, and use
`git show --stat` on each commit for the complete list of paths. Start with
`tools/overseer/recovery-view.ts`, `tools/overseer/recovery-inbox.ts`, the view-pass, inbox and
disposition parts of `tools/overseer/daemon.ts`, and `deriveDispositions` and retention in
`tools/overseer/recovery.ts`. That is where to begin, not the limit of scope.

## What it is meant to do

The same contract as round 1's prompt, `docs/plans/260910e-recovery-inventory-stage2-review-prompt.md`
§ "What it is meant to do" and § "Attack it" (the three invariants). Read that prompt. The plan is
`docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md`: §2, §4, §5,
Findings, and Stage 2's status. The status lists round 1's six fixes as F15–F20; they are unreviewed.

## What you can run

`npx vitest run tests/<one>.test.ts`, and `node --import tsx scripts/typecheck.ts`. You have no
network. My results on the candidate: `npm run typecheck` exits 0; `npx vitest run
tests/overseer-recovery-view.test.ts tests/overseer-daemon-recovery.test.ts
tests/overseer-recovery.test.ts` gives `Test Files 3 passed (3)`, `Tests 95 passed (95)`.

## What to return

A one-line verdict at the top: accept / accept with fixes / refuse. Then findings, numbered from F21
(F1–F20 are taken). Each one gets:

- a severity: P0 is data loss, security, or broadly unusable; P1 is wrong behaviour, or an
  authoritative contract violated; P2 is a design risk; P3 is prose;
- whether it is established or reasoned;
- (a) the input or mutation that shows it;
- (b) the smallest fix.

Refuse only on an established P0 or P1. Also say, for each of F15–F20, whether the fix is sound in
one line. **Keep the whole answer under 2,000 words, and write it before you run out of time: a
partial list with a verdict beats a complete list that never arrives.**

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

1. F18's claim into `processing/`. Can a request be applied, then left in `processing/`, and applied
   again? `appliedRequests` should refuse it, but check whether retention can drop the applied id
   first.
2. F17's gate (`replay.kind === "not-run"` blocks the drain). Can the replay stay `not-run` for ever
   in a way nobody sees, silently holding every dismissal?
3. The trust rule is fed by `take()`'s arms. Is there a way to reach the accept path's
   `trustInventory({ kind: "trusted" })` with an inventory `diff()` never compared, such as the
   F11 boot-change held path?
