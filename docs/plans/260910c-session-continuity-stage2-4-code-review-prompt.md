# Review: Stages 2 and 4 of session continuity — unsent drafts, and the actions feed's manners and age

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/session-continuity`, branch
`worktree-session-continuity`. TypeScript + ESM; the dashboard's browser code is **React 19**
(19.2.8) under `tools/fleet/web/src/`; tests are vitest + jsdom. React 19 no longer warns about a
state update on an unmounted component, so count requests and timers rather than spying on
`console.error`.

**Why one review for two stages.** Both stages end in `SessionDetail.tsx` and
`tests/fleet-web.test.tsx`, and a write-capable reviewer per stage would have two reviewers editing
one file at once. So they are reviewed together, once both have landed. Each stage's guarantee is
stated separately below; judge each on its own.

## The candidate

Committed, in order:

**Stage 2 — drafts**
1. `08fa8e19bb7ef5317dad1ae44254c5e967f37a7b` — **2a**: `drafts.ts` and its one hook, wired into
   the Overseer message card and the broadcast box; `tests/fleet-drafts.test.tsx` and the two cards'
   own test files.
2. `0e3d92c01be484b422fba7e995b989a1cec9bb2a` — **2b**: the session composer in `SessionDetail.tsx`
   on the same hook; its Send and Queue under each execution reading; the `conflicting` restore;
   a Clear control; tests in `tests/fleet-web.test.tsx`. (The same commit carries two plan notes and
   one comment in `transport.ts`, which are not the candidate.)

**Stage 4 — the actions feed**
3. `cd785c23f7178703f0a0fefd300c43405ee10f69` — **4a**: `useActions.ts` (visible and online
   refresh, one pending refresh, a deadline racing each read with abort, generation discard,
   `lastGoodAt`), four lines of `actions-client.ts`, `tests/fleet-actions-freshness.test.tsx`.
4. `e942f57cbf8cff6856f94be2b7ece30757bf6d00` — **the shared reader**: the single-flight core
   `useActions.ts` and `FeedPanel.tsx` had each grown, extracted into `single-flight-reader.ts`
   with its own tests. A refactor: the four protected test files passed without an edit.
5. `cd35abacd7e12690466c19142ee77ad1d82f8c6b` — **4b**: the actions feed's age and error drawn beside the queue in
   `SessionDetail.tsx`.

       git show <each>

**Scope the diff to those commits.** The branch has merged `origin/dev` several times and carries
other stages' commits; a merge-base range would sweep them up.

**The only other agent in this worktree while you run is a read-only Playwright browser check.** It
edits no repository file and does not rebuild the fleet client — it serves a build I made from the
committed tree before you started. Nothing else is editing; a red you see is yours to explain.

**Three plans share the letter `260910c` today.** `docs/plans/260910c-stage2-code-review-prompt.md`
and `260910c-stage2-code-review-sol.md` belong to a *different* plan (responsive collection). Do not
read them as context and do not edit them.

**Since 2a and 4a were built, Stage 1 changed underneath them.** `useFleetState` now commits every
transport delivery with `flushSync` (Sol's F18, commit `bd528f2c`). If anything here relied on
batching, or was only safe because of it, that is in scope.

## What it is meant to do

Read `docs/plans/260910c-session-continuity-protect-drafts-and-keep-context-current.md` — Stage 2,
the section "Withhold, caveat or relabel — Fable's ruling" and its table, § What this guarantees,
Stage 4, Stage 4a's status and the note "One reader, not two".

**Stage 2's guarantee, at its true strength:**

> An unsent message survives the reload iOS forces when it reclaims a tab (sessionStorage only; it
> dies with the tab). It is stored under the **verified conversation id** it was typed for, restored
> only into an untouched box and only while that same conversation is verified in the pane now, and
> never shown in front of a different conversation. Text the person has typed is never silently
> destroyed: under a reading that cannot be placed it stays on screen and is not persisted. Nothing
> is stored but the person's own typing, capped at 8,192 characters; storage that refuses falls back
> to memory and says so in one line. The composer's Send and Queue are live with one caveat line
> under *cannot tell*, and disabled with `identityWriteGate`'s sentence under *can tell*; typing is
> enabled in every arm.

**Stage 4's guarantee, at its true strength:**

> `/api/actions` is read on a 10-second poll that skips a hidden tab, and also on becoming visible
> and on coming back online. At most one read is in flight; a refresh during one produces exactly
> one more. Each read is raced against an 8-second deadline that settles it whether or not the API
> honours abort, and a late answer is discarded. A failure never clears the last good feed, and the
> queue says how old that feed is once it is no longer fresh. The hook never requests `/api/state`,
> and confirming an action never re-reads the target's identity.

Deliberately **not** built, and not findings: localStorage (a retention decision for Greg);
server-side delivery checks (the server's `verifyTarget` already re-checks the live process's
`--session-id` at the moment it types — § Delivery in the plan). **Stage 3's feed reader is closed**
(two rounds, F50–F57): check only that the extraction did not change its behaviour, not its design.

## What you may change

**You may edit this worktree**, inside these two stages: fix what you establish, red-first, and
report anything wider. Do not commit. List every file you changed.

Gates as I ran them: `npx vitest run tests/fleet- passed 99 of 99 files on the tree merged with origin/dev at 03743ea3 (logs/tmux-jobs/sc-m4-tests-1026-1319380.log), and npm run typecheck exit 0 (logs/tmux-jobs/sc-m4-typecheck-1026-1319477.log)`

## Attack it

Independently, before my doubts. Is each guarantee above **accurate**?

**Stage 2**
- **A draft shown to, or stored under, the wrong conversation.** Every sequence: verified C → a
  relaunch of C (new token, same conversation) → a different conversation D; a reload during an
  unverifiable collection; `conflicting(C, D)` and back; the Overseer card staying mounted while the
  Overseer moves between rows and processes (it passes a `scope` from `useExecutionEpoch`).
- **Typed text silently destroyed.** The Stage 1 mount key remounts the detail pane on a real
  replacement — does the draft always come back from storage where it should, and is anything typed
  during an unverifiable gap ever lost without a word?
- **Storage.** Under jsdom, `vi.spyOn(Storage.prototype, …)` spies on Node's `Storage`, not the one
  behind `window.sessionStorage` — 2a found and fixed one vacuous test of exactly that shape. Check
  every storage test's spy actually fires.
- **The composer's gate.** Is the *cannot tell* / *can tell* classification exhaustive, and does
  `identityWriteGate` supply only the sentence and never the enable condition?

**Stage 4**
- **The extraction.** Did anything change for either caller? The two hooks' hidden-tab rules are
  deliberately different — the feed defers every entry point while hidden (F52), the actions hook
  lets a person's refresh read from a hidden tab. Mutate the shared core's pending-read and
  late-answer logic and confirm both suites fail. (The extraction's implementer reported one known
  shortfall: removing *only* the generation check turns the core's suite red but neither hook's —
  accepted, with the reasoning in the plan. Check the reasoning, not just the fact.)
- **The deadline and the poll.** A deadline shorter than the poll, a poll tick during a read, a
  refresh during a read, unmount during a read, and an API that never settles.
- **The drawn age.** Its threshold, tests that pass `actionsPollMs={0}`, and whether the queue's
  items stay drawn under an error.
- **The identity rule.** Does anything added here read `/api/state`, or re-read a row's identity as
  a side effect of confirming an action?

Findings **start at F25** (Stage 1 used F10–F24; Stage 3 used F50–F57). Each: ID, which stage,
severity, established or reasoned; (a) the input or mutation I can run; (b) the smallest change.

  P0  data loss, exploitable security, or the tool broadly unusable
  P1  user-visible wrong behaviour, or an authoritative contract violated
  P2  design or maintainability risk with no wrong behaviour today
  P3  non-behavioural prose or comment defect

Refuse only on an established P0 or P1, and name what established it.

## My own suspicions, worth less than yours

These are already mine; spend most of the run elsewhere.

- **`hold(claimed)` in the `conflicting` arm restores a draft into a box whose Send is disabled.**
  The words are the person's and meant to stay visible, but they were written for the claimed
  conversation while the pane now runs another. Is there any path — Queue, a keyboard shortcut, the
  dictation control's own submit — that sends them anyway?
- **The Overseer card's `scope` is a second `useExecutionEpoch` map**, independent of the Sessions
  panel's. With `flushSync` now committing every delivery, can the two disagree?
- **`setText` and `clear` are new functions on every render.** 2b reads them through a ref; check
  nothing re-runs per render.
- **Clear always removes the stored copy** — including a copy stored under the *other*
  conversation? It should not.
- **Two implementations of one rule.** 2b added `useSettledExecution` in `SessionDetail.tsx`, which
  holds an established refusal through an unknown reading and ends it on a verified one — the same
  rule as `lastConflict` in `RecentMessages.tsx` (Sol's F12). Can the two disagree about one row in
  one frame, so the transcript says "previous conversation" while the composer's Send is live, or
  the reverse? If so, one hook in `continuity.ts` both use is the fix, and that edit is wider than
  these stages — report it. It also compares readings with `JSON.stringify`, which includes the
  prose `why`; check that costs only a re-render and never a wrong answer.
- **A Send in flight across a same-conversation relaunch.** The implementer named this and left it:
  if the pane remounts (a new process, same verified conversation) while a Send is in flight, the
  old component's `clear()` runs against nothing, the stored draft survives, and the sent text comes
  back in the new box. Reachable? The smallest fix?
- **Two Stage 1 tests were changed by 2b**, not by their author: their replacement fixtures now
  carry an unverifiable conversation, because a verified same-conversation relaunch now correctly
  restores the draft. Confirm they still prove the pane remounts and the outcome cards clear — and
  note that nothing now tests a *verified* relaunch clearing the cards while restoring the draft.
