# Review: a plan for four small independent fixes in the reading app

Repo: this worktree (`.claude/worktrees/q-queue-four-small-bugs`), branch
`worktree-q-queue-four-small-bugs`, TypeScript + ESM, React client under `src/web/`.

## The candidate

Live pre-commit: base `fb8a529bc`; untracked:
`docs/plans/261004l-four-small-queued-fixes-fetch-failure-sentences-composer-focus-stale-remember-param-marginalia-head-at-the-top.md`
(the plan) and this prompt. No code has been written yet.

Start with the plan, then the code it names: `src/fetch.ts` (`FetchFailureCode`, `FetchFailure`,
`classifyStatus`), `src/pipeline.ts` § `overTheSizeLimit` and the fetch step's `.catch`,
`src/messages.ts` (`FETCH_TOO_BIG`, `CODE_KINDS`, `canRetry`, `kindOfMessage`),
`src/job-failure.ts`; `src/web/ChatDialog.tsx` (`swapping`, `caretWasInside`) and
`src/web/ChatPanel.tsx` (`focusNonce`); `src/web/reader/Reader.tsx` § `onMode`, `marginColumn`,
`showCrumbs`; `src/web/sub-modes.ts`; `src/web/params.ts` § `rememberParam`;
`src/web/last-view.ts`; `src/web/marginalia/notes.ts` § `headPath`, `arcAt`;
`docs/project/url-state.md`, `docs/project/copy.md`. That is where to begin, not the limit.

## What it is meant to do

Four items, A to D, each stated in the plan with what is wrong today, the change, and the test
that goes red first. They are independent.

## What you can and cannot run, and what you may change

The tree is read-only. /tmp and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and you have no network, not even loopback.

## Attack it

Independently, before you read my suspicions below. For each of A to D: is the plan's account of
today's behaviour accurate against the code, is the proposed change the smallest one that is right
for the long term, and does the red-first test actually fail today for the stated reason?

For each finding give an ID (F1, F2, …), a severity (P0 data loss / security / charging; P1
user-visible wrong behaviour or an authoritative contract violated; P2 design or maintainability
risk; P3 prose), whether it is established or reasoned, (a) the concrete scenario or contract that
shows it, and (b) exact replacement wording or the smallest change. Refuse only on an established
P0 or P1, and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- A: is each row of the kind table right? In particular `dns`, `empty`, `http-error` and
  `certificate`. Is there a second route by which a `FetchFailure` reaches a job card that the one
  `.catch` misses (a retry of the fetch step, `acquireUpload`, `npm run ingest`)? Does a cancelled
  fetch (`timeout`, "Fetch cancelled.") reach this mapping, and should it?
- B: I have not reproduced the focus loss; the plan tells the builder to. Is the rule as stated
  safe against the cases where focus must *not* move?
- C: I recommend keeping the parameter and documenting it. Is there a case where a stale sub-mode
  parameter under another mode does harm today (Chat and Remember share `?thread=`; `last-view.ts`;
  the metadata page's links)?
- D: is "above the first part" the right boundary, and should `arcAt` follow the same block?

Do not change any file.
