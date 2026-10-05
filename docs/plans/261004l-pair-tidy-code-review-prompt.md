# Code review: tidy a quick/thorough pair left behind

You may edit files. Fix what you find inside this change; report anything wider for me to decide.
Do not commit, and do not run git commands that change the tree or the index.

## What it is

Read `docs/plans/261004l-quick-search-starts-a-thorough-search-in-the-background-and-swaps-it-in.md`,
above all § "Follow-up: a pair left behind is tidied when the list is next loaded". Your own design
review of the first version is `docs/plans/261004l-pair-tidy-design-review-sol.md`; it said do not
build, and the design was changed for T1 and T2: the pair is now recorded in `localStorage` when
the thorough search is launched, and only a recorded pair is tidied. T3 (cross-tab) is accepted and
written down in the plan; T4 is handled only by `navigator.onLine`. Say if you think either
acceptance is wrong, but judge them against the stated constraints: never delete a quick row the
reader edited or ticked differently, never touch a row still running, prefer the simplest design
that is safe.

## This is the second run

The first run of this review was killed by the box running out of memory. It left no answer, but
it had added tests. What I did with them, which you should check rather than trust:

- A failed opening read forgot the records: fixed (`SearchBand` passes `loaded && loadError === null`).
- A tick on a thorough row that is still running: `tidyPair` now forgets before it keeps.
- A reader's gesture on the thorough row (tick, untick, press) forgets the record: `onToggle` and
  `onSolo` in `SearchBand`. I did **not** take "choose quick alone" or "toggle all" as cancelling:
  pressing the quick row is how a reader looks at it, not a choice against the thorough one. Those
  two cases were replaced by one that says a gesture on the quick row keeps the record.
- A storage read or write that fails during `forget` or `rename` now clears every record.
- The test of two tabs interleaving a read-modify-write of the one storage key was removed and the
  race is not fixed. Say if you think that is wrong, and what the smallest fix is.

The box is short of memory. Wrap every vitest or typecheck run as
`flock /var/tmp/spideryarn-heavy.lock <command>`, run only the two test files named below, and
expect to wait for the lock.

## The change

The uncommitted diff in this worktree against `HEAD` (`git diff HEAD`, plus the new files):

- `src/web/modes/search/stored-pairs.ts` (new): the `localStorage` records.
- `src/web/modes/search/auto-thorough.ts`: `tidyPair`, the once-per-load effect in
  `useAutoThorough`, and the points where a record is written, renamed and forgotten.
- `src/web/modes/search/SearchMode.tsx`: `loaded` passed in, `ticked` on the wiring.
- `tests/auto-thorough.test.ts`, `tests/search-auto-thorough.test.tsx`: the new cases.
- `docs/project/search.md`, the plan.

## What to check

1. Can the tidy delete a quick row it should not? Walk every way a record can outlive the facts it
   recorded: a rename (`follow` in `src/web/useSearch.ts`) of either row, a retry, a revision queued
   before `begin`, a delete while pending, the hook's unmount, an article switch inside one mount
   (`tidyNext`), StrictMode, storage that throws halfway.
2. Is every place a pair stops being tidiable covered by a `storedPairs.forget`? Is there a path
   where a record is forgotten too early, so a real left-behind pair is never tidied?
3. The once-per-load effect reads `runs` as they stand when `loaded` flips. Is that the opening
   GET's list in every case? Can a bar handoff or a typing session's first ask land in the same
   commit and change what it sees in a way that matters?
4. `wiring.swap` was written for a pair this tab launched. Is anything in it wrong for a pair met at
   load: `typing.rowGone`, `recolour` before `begin`, `remove` not being quiet, `setActive` while
   `?runs=` is still being restored?
5. The tests: is each "leaves both rows" case beside a control that shows the harness would have
   tidied? Is any assertion satisfied by the wrong thing?

Run `npx vitest run tests/auto-thorough.test.ts tests/search-auto-thorough.test.tsx` and
`npm run typecheck`. If vitest refuses to start for lack of memory, say so; that is not a pass.

## Answer

Findings numbered R1…, each with a severity (P0–P3), the evidence (file and line), and whether you
fixed it. Then a list of every file you changed. End with one line: land as is / land after the
fixes I made / do not land.
