# Review: Questions panel, answering, registrations, and live staleness

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/questions-mode`, branch `worktree-questions-mode`.
TypeScript, React, jsdom, Vite.

## The candidate

Live pre-commit candidate at base `b297fa43209a21e1429f7cdd5b82332ccaaac1d4`.

Scoped tracked paths:

- `tools/fleet/web/src/App.tsx`
- `tools/fleet/web/src/Dock.tsx`
- `tools/fleet/web/src/mode.ts`
- `tools/fleet/web/src/tailwind.css`

Untracked candidate paths:

- `tools/fleet/web/src/QuestionsPanel.tsx`
- `tests/fleet-questions-panel.test.tsx`

The modified existing plan
`docs/plans/260909e-questions-mode-everything-that-needs-greg-s-input-answerable-in-place.md`
belongs to another live session and is not part of this candidate. Do not review, edit, or revert it.

Start with `QuestionsPanel.tsx`, `App.tsx`, and the new test. This is where to begin, not the limit
of the scoped manifest above.

## What it is meant to do

Implement Stage 2 only from
`docs/plans/260909e-questions-mode-everything-that-needs-greg-s-input-answerable-in-place.md`:

- render the three `QuestionsView` completeness arms without turning an unobserved or partial empty
  list into “Nothing needs you”;
- exhaustively draw all gap and item arms;
- resolve dialog display and answers through the current row, sending its `rawQuestion` through the
  existing `SteerApi`, snapshotting the receipt target before the await, and resetting local state
  when the item/execution identity changes;
- allow in-place writes only for addressable conversation dialogs while the server positively says
  answering is enabled; prose is read-only and only navigates to Sessions;
- register the mode in all six places and derive coarse-pointer dock shares from `MODES.length`;
- recompute `questionsAtTime(feed.state, now)` on every App render so a complete view ages out while
  the page remains open.

Out of scope: Stage 3, queue pointers, browser work, screenshots, project docs, and server-side
Question composition.

The true guarantee around a send is the existing `SteerReceipt` vocabulary: success is a report of
what was typed and checked immediately beforehand, not a post-send acknowledgement. Partial and
unknown delivery must remove the invitation to tap again until a new execution/card identity arrives.

## What you can and cannot run

The tree is read-only; `/tmp` and package caches are writable. You can run:

```sh
npx vitest run tests/fleet-questions-panel.test.tsx
```

That suite passed 12/12 here. Together with the two Stage 1 suites, 52/52 passed. `npm run
build:fleet` also succeeded. Do not run the full test suite or the project typecheck. No test here
needs a database, loopback, or network.

## Attack it

Independently verify every binding rule above, especially whether a malformed retained dialog item
can expose a permission button, whether card state survives a run replacement, whether the receipt
is compared with the tapped row rather than a later row, whether a prose card can write by any DOM
path, and whether any empty arm overclaims completeness.

For each finding give:

- an ID (`F1`, `F2`, …), severity, and established or reasoned;
- the exact input or mutation under which the candidate fails its claim;
- the smallest change that closes it.

Severity: P0 is data loss/security/charging/broad outage; P1 is user-visible wrong behaviour or an
authoritative contract violation; P2 is design/maintainability risk without wrong behaviour today;
P3 is prose/comment only. Refuse only on an established P0 or P1.

## My own suspicions — read last

These are already my doubts, so spend most of the run elsewhere:

- `QuestionsPanel` uses a keyboard-accessible `div role="button"` for prose navigation because the
  explicit regression test forbids any enabled HTML button inside a prose card. Check that this is
  the least misleading accessible shape under that contract.
- The item key includes the union arm as well as its row/item id and execution token. Check whether
  that resets too much or too little across addressability changes.
- The test file combines the three empty arms in one test. Check that one arm cannot disappear while
  the assertions still pass against another.

Do not change any file.
