# Review: four small independent fixes, built from a plan you reviewed

Repo: this worktree (`.claude/worktrees/q-queue-four-small-bugs`), branch
`worktree-q-queue-four-small-bugs`, TypeScript + ESM, React client under `src/web/`.

## The candidate

Committed: `804de1a92` (B), `0a5e2748d` (A), `805e394c4` (C and D), in that order, on base
`fb8a529bc`.

    git diff fb8a529bc..805e394c4
    git diff --stat fb8a529bc..805e394c4     # the complete manifest of changed paths

Start with: `src/messages.ts` § `fetchFailed` and `src/pipeline.ts` § `fetchStepFailure` (A);
`src/web/ChatDialog.tsx` § "The caret follows the composer" (B); `src/web/sub-modes.ts` §
`returnToSubMode`, `src/web/reader/Reader.tsx` § the Dock's `onMode`, `src/web/Dock.tsx` §
`modeLinkHref` (C); `src/web/marginalia/notes.ts` § `headBlock` and its caller in Reader.tsx §
`marginColumn` (D). That is where to begin, not the limit: the manifest is.

## What it is meant to do

The plan is
`docs/plans/261004l-four-small-queued-fixes-fetch-failure-sentences-composer-focus-stale-remember-param-marginalia-head-at-the-top.md`,
with your plan-review findings F1 to F6 and their dispositions at the bottom. In one line each:

- A: every `FetchFailureCode` reaches the ingest job card as its own sentence and kind; Retry is
  offered only for kind `retry`; `http-error` is decided by status; no sentence or diagnostic
  carries the address, the host or the fetcher's message.
- B: in the block chat, a commit that removes a composer holding focus gives focus to the composer
  that replaces it, in the floating panel and the Marginalia card, and never moves focus that was
  elsewhere.
- C: a sub-mode parameter outlives its mode on purpose (documented, pinned); returning to Remember
  with `remember=quiz` retained writes `mode` and `thread=null` in one pushed entry, from the
  reading view and from the metadata page.
- D: above the first part, Marginalia's head speaks for the first part's first block; nothing else
  falls back.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside these four items, each finding red-first with the
test that reproduces it, and leave everything wider as a finding for me to decide. Do not commit.
List every file you changed at the end. Do not attribute any sentence to Greg that is not already
attributed to him in the tree.

You have no network, not even loopback, so anything needing Postgres or a local service will skip.
The new test files need none: `tests/fetch-failure-sentences.test.ts`,
`tests/chat-dialog-keeps-the-caret-across-a-switch.test.tsx`,
`tests/sub-mode-param-outlives-its-mode.test.tsx`, and the additions in
`tests/marginalia-notes.test.ts`, `tests/headings-crumbs-wiring.test.tsx`,
`tests/messages.test.ts`, `tests/one-size-limit.test.ts`. I ran each green, and
`npm run typecheck` is green at `805e394c4`.

## Attack it

Independently, before you read my suspicions below. For each item: does the code do what the line
above says, on every route a reader can reach; and is each statement in the new comments and docs
accurate against the code?

For each finding give an ID (number from F7, since F1 to F6 are the plan review's), a severity
(P0 data loss / security / charging; P1 user-visible wrong behaviour or an authoritative contract
violated; P2 design or maintainability risk; P3 prose), whether it is established or reasoned,
(a) the input or mutation that shows it, and (b) the smallest change that closes it. Refuse only
on an established P0 or P1, and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- A: the fetch step no longer throws a `FetchFailure` instance. Does anything downstream of the
  step (jobs.ts, retry logic, monitoring, the CLI `npm run ingest`) branch on `instanceof
  FetchFailure`, `.code`, `.retryable` or `.status` of what the step threw? Is dropping the Node
  errno from the diagnostic a real loss for debugging, and is adding it back safe? Are the new
  sentences consistent with copy.md's rules?
- B: the layout effect has no dependency list and reads `document.activeElement` during render.
  Can the "owed" focus be paid much later to a composer the reader did not expect (the debt
  outliving the switch)? Does it fight `focusNonce` or the close-control focus on a cold
  `?thread=`?
- C: `tests/command-bar-sub-modes.test.tsx` has a `ReaderNavHarness` that hand-copies the old
  `onMode`; is that copy now a lie worth fixing? Is `subNav.remember` the right read at press time
  (nuqs state can lead the address)?
- D: `headBlock` when `at` is a block inside the apparatus/supplement, and on a tree whose first
  part is the supplement.
