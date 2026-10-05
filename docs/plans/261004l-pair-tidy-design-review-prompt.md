# Design review: tidy a quick/thorough pair left behind

Read-only. Do not edit any file.

Read `docs/plans/261004l-quick-search-starts-a-thorough-search-in-the-background-and-swaps-it-in.md`
in full, above all § "What the earlier review said replace-on-success needs", § "Questions for Greg"
(Q-reload) and the new § "Follow-up: a pair left behind is tidied when the list is next loaded",
which is the design under review. Then read the code it would touch:

- `src/web/modes/search/auto-thorough.ts` (the in-tab swap's decisions and hook)
- `src/web/modes/search/SearchMode.tsx` § `SearchBand` (`wiring.swap`, `useSearchMode`, the typing
  session)
- `src/web/useSearch.ts` (the opening GET, `remove`, `recolour`, `deleted`, `chosen`)
- `src/store/pg-searches.ts` § `remove`, `sweepPending`, and `src/searches.ts` § `withRun`
- your own earlier plan review, `docs/plans/261004l-auto-thorough-plan-review-sol.md`, finding F8

The constraints given: never delete a quick row the reader edited or ticked differently, never touch
a row still running, prefer the simplest design that is safe, and say how the cross-tab case (F8) is
handled.

Questions:

1. Is the pairing rule (both done, same trimmed words, thorough made after quick, thorough not
   ticked) safe? Name any way it deletes a quick row the reader would want kept, or swaps in a
   thorough answer that is the wrong one. Check what `createdAt` a revised quick row carries and
   whether "made after" still means what the design assumes.
2. Is running once at the opening load, through the existing `wiring.swap`, sound against the
   code as it is: the order of effects in `SearchBand`, StrictMode, a bar handoff that starts a
   typing session at the same moment, `?runs=` being restored late, the opening read's deadline?
3. Is accepting the cross-tab window right, or is there a cheap check that closes it without the
   stored link and replace endpoint the plan avoided?
4. Anything simpler that does the same job.

Answer with findings numbered T1…, each with a severity (P0–P3), the evidence (file and line), and
what you would change. End with one line: build as designed / build with the changes named / do not
build.
