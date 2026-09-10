# Review: work evidence reaches the Overseer history card without overstating freshness

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/work-evidence`, branch
`worktree-work-evidence`. TypeScript/ESM, strict with `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`.

## The candidate

Live pre-commit: base `6319b7a8f5ffc8eeff7126d77f58dd0e1a91ef51`; scoped paths:

- `tools/fleet/wire.ts`
- `tools/fleet/overseer-status.ts`
- `tools/fleet/web/src/types.ts`
- `tools/fleet/web/src/OverseerPanel.tsx`
- `tests/fleet-overseer-status.test.ts`
- `tests/fleet-overseer-panel.test.tsx`
- `tests/fleet-web.test.tsx`
- `tests/fleet-work-evidence-e2e.test.tsx`

Untracked: `tests/fleet-work-evidence-e2e.test.tsx` and this review prompt. The answer file
`docs/plans/260909h-stage3-code-review-sol.md` will also be created by the review command.
This candidate is not durable; the user explicitly instructed that this stage must not be committed.

Start with `tools/fleet/overseer-status.ts`, `tools/fleet/web/src/types.ts`, and
`tools/fleet/web/src/OverseerPanel.tsx`. This is where to begin, not the limit of what is in scope —
the manifest above is.

Read the full plan first:
`docs/plans/260909h-wire-the-work-classifier-into-the-overseer-daemon.md`, especially “Round 1:
GPT Sol on the plan” and Stage 3.

## What it is meant to do

Project the daemon's one process-table scan onto its exact checkpoint inventory and then onto the
Overseer history card. A scan joins only when `sourceCollectedAt === lastGoodSnapshotAt`. Missing,
failed, mismatched, future-clock, or malformed work becomes one work-unavailable sentence without
losing the register. Idle rows are retained only for recognised child work; ordering stays by
pane-status age and `total` remains the whole register.

At the browser boundary, all instants are shifted onto the browser clock, but `ranForMs` is a frozen
duration and is never shifted or recomputed. A fresh scan says “running 18m”; a stale one says “was
running 18m when checked 1h ago”. `cannot-tell`, `none`, and null remain distinct. Evidence lives in
an `Explain` tooltip, including command, pid, depth, inspected count, scan clock, and the ordering
caveat. The second line must wrap at phone width.

The work reading deliberately does not reach `SessionsPanel` or `SessionDetail`. Do not touch
`tools/fleet/routes-*.ts`, `tools/fleet/collect.ts`, `tools/fleet/web/src/SessionsPanel.tsx`,
`tools/fleet/web/src/SessionDetail.tsx`, or usage/accounts paths.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside Stage 3 under review — narrowly, each finding
red-first with the test that reproduces it — and leave anything wider as a finding for me to decide.
Do not commit. List every file you changed at the end. Do not edit the plan, this prompt, or other
documentation.

You have no network or loopback access. You may run one focused file, preferably:

`npx vitest run tests/fleet-work-evidence-e2e.test.tsx`

The integrated focused run already completed with this raw result:

```text
 RUN  v4.1.11 /home/greg/code/spideryarn2/.claude/worktrees/work-evidence

 Test Files  5 passed (5)
      Tests  502 passed (502)
   Start at  23:23:11
   Duration  29.78s (transform 5.23s, setup 567ms, import 6.87s, tests 26.50s, environment 3.16s)
```

`npm run typecheck` cannot open tsx's IPC socket in this sandbox (`listen EPERM`). Its four
underlying `tsc --noEmit -p ...` projects all exited 0 with no output. `git diff --check` exited 0.

## Attack it

Independently, before reading my questions below, try to break the monitoring claim: the page must
never report an absence it did not measure or let an old scan grow into a current claim. Check the
whole edge from stored checkpoint shape through server projection, browser parsing, and rendering,
including malformed and unknown values.

For each finding give:

- an ID (`F1`, `F2`, …), severity, and whether it is established or reasoned;
- (a) the input or mutation that shows the candidate fails its own claim;
- (b) the smallest change that closes it.

Severity is by consequence:

- P0: data loss, exploitable security, incorrect charging, or service broadly unusable.
- P1: user-visible wrong behaviour, or an authoritative contract violated.
- P2: design or maintainability risk with no wrong behaviour today.
- P3: non-behavioural prose or comment defect.

Refuse only on an established P0 or P1, and name what established it. A finding with no concrete
failure input goes last.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- Does every malformed nested work field degrade the work while leaving all valid session history
  visible, with per-row work suppressed once the scan is unavailable?
- Is freshness based only on the one scan age and the card's existing deadline, with no path that
  turns `startedAt` into a growing elapsed duration?
- Does the tooltip copy obey the repository's artefact-not-gesture rule without restating its two
  explanatory paragraphs?

