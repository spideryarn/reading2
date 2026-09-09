# Review: Stage 4 closes the Questions tab's reproduced review findings

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/questions-mode`, branch
`worktree-questions-mode`. TypeScript/ESM with a React browser client.

## The candidate

Live pre-commit candidate: base `7460e8eb2928c542e96f091b3faea373f550c46a`; scoped paths:

- `tools/fleet/questions.ts`
- `tools/fleet/wire.ts`
- `tools/fleet/web/src/types.ts`
- `tools/fleet/web/src/QuestionsPanel.tsx`
- `tests/fleet-questions-panel.test.tsx`
- `tests/fleet-questions-client.test.ts`
- `tests/fleet-questions.test.ts`

Untracked: `tools/fleet/question-freshness.ts`.

This is live, not durable. The user explicitly asked for no commit and will inspect the diff.
Start with `types.ts`, `QuestionsPanel.tsx`, and the three test files. That is where to begin, not a
limit on the manifest above.

## What it is meant to do

Close QM2-01 through QM2-06 in
`docs/plans/260909e-questions-mode-stage4-codex-task.md`, which is the complete binding brief.
The prior review being closed is
`docs/plans/260909e-questions-mode-stage2-review-sol-r2.md`.

The invariants to preserve are:

- browser option controls admit exactly the locally known subset the answer route can accept;
- the resolver and control gate share one exhaustive browser predicate;
- component answer state survives only the same row, execution, and `sameQuestion` field identity;
- a `complete` view independently covers every parsed conversation row and every parsed prose
  attention observation, while inbox dialog evidence remains deliberately ignored;
- prose cards only navigate and never call either write seam;
- the answer-hold notice exists only when a `dialog` item would otherwise carry buttons;
- server and browser freshness checks consume one browser-safe set of runtime constants, without
  merging their deliberately different staleness functions.

Do not broaden into the queue-pointer region or any excluded files named in the Stage 4 brief.

## What you can and cannot run

The tree is read-only; `/tmp` and node module caches are writable. You may run one self-contained
file: `npx vitest run tests/fleet-questions-client.test.ts`. There is no network, not even loopback.
The orchestrator ran the required scoped command successfully:

`npx vitest run tests/fleet-questions-panel.test.tsx tests/fleet-questions.test.ts tests/fleet-questions-client.test.ts`

Result: 3 files passed, 78 tests passed, exit 0.

## Attack it

Independently, before the questions below, try to make the code violate the seven invariants above.
Pay particular attention to a normal producer payload being falsely downgraded, a malformed retained
dialog still exposing a button, and a question-field change that does not remount local state.

For each finding give:

- an ID (`F1`, `F2`, ...), severity, and established or reasoned;
- (a) the input or mutation that shows the current code fails its claim;
- (b) the smallest change that closes it, as a code block or exact replacement.

Severity: P0 data loss/security/charging/broad unusability; P1 user-visible wrong behaviour or an
authoritative contract violation; P2 maintainability/design risk without wrong behaviour today; P3
prose/comment only. Refuse only on an established P0 or P1, naming what established it. Put findings
with no runnable (a) last.

## Previous findings

The binding brief names QM2-01 through QM2-06 and their exact required fixes/tests. Treat every fix
as unreviewed code written by someone else. Check every ID once, but spend most of the review on
interactions between them and on anything the brief did not anticipate.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything independently found:

- Does `isLocallyAnswerableDialog` genuinely keep the resolver and panel aligned, including missing
  addresses and non-steerable statuses, without making legitimate `dialog-unaddressable` rows gaps?
- Does inverse coverage mirror membership only—separate dialog row ids and prose item ids—without
  re-composing target details, duplicates, order, or inbox dialog evidence?
- Does `dialogQuestionKey` mirror the safety comparison closely enough, including option order/key
  and read-material fingerprint, while avoiding unrelated raw fields?
- Does the shared-constant test catch drift in either direction on both server and browser?

Do not change any file.
