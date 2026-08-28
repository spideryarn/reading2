# Is the client half of chat the right shape? — a design consultation

You are being asked a **design question, not a code review**. Nothing is broken that we know of.
Read-only. Take your time.

## The question

`src/web/useChat.ts` is 1682 lines and holds **twelve `useRef`s**, almost every one of which exists
because React's render model could not reach some piece of state at the moment something needed to
read it. Its sibling `src/web/useComments.ts` does a comparable job in 600 lines with two.

Over the last three days this one file has had roughly a dozen distinct concurrency bugs found and
fixed **one at a time**, each by adding another ref, another guard, or another narrowing. They are
listed below. Every fix is, individually, correct and well argued. The worry is that the sequence
itself is the finding: a shape in which each new feature buys a new race, and the race is only found
when a reviewer or a reader stumbles into it.

**So: is there a rearchitecture — of this file, of the client/server contract underneath it, or of
the pattern it shares with its siblings — that would make this class of bug structurally impossible
rather than repeatedly fixed?**

And if the honest answer is "no, this is essentially irreducible complexity and the current shape is
close to as good as it gets", say that plainly. That is a genuinely acceptable answer and we would
rather hear it than adopt a rearchitecture for its own sake. If it is the answer, say what the
*cheapest* things are that would still lower the rate of these bugs (a test harness, an invariant, a
lint rule, a doc).

## What to read

- `src/web/useChat.ts` — the subject. Read the whole thing; the docstrings carry the history.
- `src/web/ChatPanel.tsx` (1976 lines) — the view, including `ThreadList` and the composer.
- `src/web/App.tsx` — `ConversationBand` (line 1781) owns the hook and the `?thread=` query param.
- `src/web/useComments.ts`, `src/web/useSearch.ts` — the siblings that share the pattern, and the
  comparison that makes the size difference interesting.
- `src/web/lib/sse.ts` — the shared stream plumbing.
- `src/chat.ts`, `src/routes.ts` (the `/api/chat` routes), `src/store/contracts.ts` — the server half
  and the guards it already enforces (`expectedTailId`, the 409s, `Live.attempt`).
- `docs/plans/chat-mode.md` — the whole feature's plan and history.
- `tests/chat-*.test.ts*`, `tests/use-chat-recovery.test.ts`, `tests/conversation-band-send-new.test.tsx`,
  `tests/chat-arrival-race.test.ts` — what is currently pinned, and how.
- `docs/project/vision.md` (esp. § Principles), `docs/project/architecture.md`,
  `docs/project/reading-view-overview.md`, `docs/project/comments.md` (§ streaming).

## The twelve, roughly in the order they were found

Each of these was a real, reader-visible wrong state, and each was fixed on its own terms.

1. A whole-list `setThreads(fresh)` after a 409 put a snapshot taken before an unrelated send over
   that send's optimistic rows; every later stream frame then patched a row that was gone. Fixed by
   narrowing the per-thread refresh to one thread (2026-08-26).
2. An exported `streaming` boolean was set false by whichever of several overlapping sends finished
   first, while another was still arriving. Removed; the composer reads the *message* it waits on.
3. `owned` had to become a **counted map** rather than a `Set`, because two streams can write one row
   and the first to finish announced that nobody was writing.
4. `watched` had to carry a **token per watch** rather than a bare id, so a second watch of a row
   could not read the first's entry as its own.
5. A stop landing before the `begin` frame stopped nothing while the button said it had. Fixed by
   `stopWanted`, a wish recorded before the request leaves.
6. Stop-then-delete as two requests was a destructive race (a question arriving in the gap was
   deleted). Fixed by one `cancel` request server-side, and by `cancelWanted` being a separate set
   from `stopWanted` so only one of them ever fires.
7. Deleting a thread mid-answer let the next stream frame put it back, one message short. Fixed by
   the `gone` tombstone set, consulted in two places.
8. `half-swapped-message-ids` (see `docs/postmortems/`).
9. `loaded` could not distinguish "asked and failed" from "asked and empty", so a failed load fell
   into "Nothing asked yet." Fixed by `loadFailed` (2026-08-27).
10. Under StrictMode, load #1 failing *after* load #2 succeeded set `loadFailed` true over a list
    that was on screen and correct — the slug ref could not see it, because both were the same slug.
    Fixed by a per-run `live` flag (2026-08-27).
11. The arrival load's `setThreads(fresh)` wiped whatever the reader did during the fetch's own
    duration: a conversation started, a question sent (whose later frames then landed nowhere), a
    conversation deleted coming back. Fixed by `mergedArrival` (prev-wins, deletions-win) plus a
    `load` generation counter (2026-08-27/28).
12. And the same staleness guard, added to every success path, was **missing from the `catch`**, so a
    superseded load failing could put an error over a correct list — the identical shape as (10), in
    the same file, one day later (2026-08-28).

Note the pattern in (10) and (12) especially: the *same bug class*, in the same file, found twice by
review rather than by anything structural.

## Constraints — please respect these, they are not negotiable-by-argument

- **Prefer boring**, and no framework churn while the ideas are still moving
  (`docs/project/vision.md § Principles`). Two exceptions have ever been made, both weighed
  explicitly: Postgres, and shadcn + Tailwind v4. A new state-management dependency (Redux, Zustand,
  XState, TanStack Query, Jotai, Valtio…) would be a **third exception** and needs to be argued as
  one — what it buys, what it costs, what happens when it is the wrong choice in six months. Do not
  assume it is off the table; do assume the bar is high and "everyone uses it" is not an argument.
- **Incrementally reachable.** A big-bang rewrite of a 1682-line hook that the product depends on is
  not viable. Any recommendation must come with an ordering in which each step is independently
  shippable, independently testable, and leaves the app working.
- **The existing tests must survive**, or the recommendation must say exactly which ones become
  meaningless and why that is right.
- **This is a shared working tree with several agents in it.** Enormous cross-file refactors are
  expensive here beyond their own cost.
- One developer plus AI agents. Optimising for *the code teaching its next reader the invariant* is
  worth a lot; optimising for raw line count is worth little.

## What we would find most useful

1. **A diagnosis.** What, precisely, is the shared root cause of the twelve? Name the missing
   concept, if there is one. Our own hypothesis — test it, do not defer to it — is that there is no
   single answer to "who owns this row right now, the client or the server?", so each feature invents
   its own answer, and each answer is a new ref.
2. **The recommendation**, concretely enough to build: what the shape becomes, what the types are,
   which of the twelve refs survive it and which stop existing. If it is a reducer over an explicit
   state machine, show the states and the transitions. If it is a change to the *server* contract
   (a list version, a `deletedAt`, per-thread etags, sequence numbers on stream frames), say which
   and why that is better than fixing it on the client.
3. **A staged path**, cheapest-first, with the first step being something worth doing on its own
   even if we never do the rest.
4. **What you would explicitly NOT do**, and why. Ideas we have considered and are unsure about:
   a `useSyncExternalStore` store outside React; a reducer with all state in one object; splitting
   `useChat` into `useThreadList` + `useTurn`; making the stream frames carry sequence numbers;
   moving reconciliation entirely server-side; leaving it alone.
5. **Related areas worth pulling in, or worth leaving alone.** `ChatPanel.tsx` at 1976 lines,
   `useComments`/`useSearch`'s duplicated streaming and tombstone logic, `useChatAnchors`, and the
   one known-uncovered hole: an arrival response can still resurrect a conversation deleted in
   **another tab**, because the tombstone set is per-tab. Is that the tip of the real problem?
6. **A cost estimate** in rough terms, and a recommendation on whether it is worth paying *now*
   versus when the next feature lands on this file.

Please be concrete and specific. Point at line numbers. Where you propose a type or a transition,
write it out. Where you think the existing code is right and should not change, say so — knowing
which parts are load-bearing is as useful as knowing which are wrong.
