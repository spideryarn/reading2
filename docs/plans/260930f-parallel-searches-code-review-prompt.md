You are reviewing BUILT CODE in the Spideryarn repo (worktree; you may edit files in it).

Context: docs/plans/260930f-parallel-searches.md (the plan, including how your own plan review's
findings were handled — read that section and check each response is correct, especially the
claim about nuqs's functional updater and React discrete-event flushing). Greg's request: "In the
search mode, I want to be able to kick off multiple searches in parallel."

The diff under review: docs/plans/260930f-parallel-searches-code-review.diff (commit 8a0e82af
against 67aca87c). Files: src/web/SearchPanel.tsx, src/web/modes/search/SearchMode.tsx,
tests/search-parallel-finds.test.tsx. Docs: docs/project/search.md § "Asking the next question
before the last one answers".

Check in particular:
1. The `running` set and `ready`: any path where Find is still refused while a *different*
   question could be asked, or where an identical question still gets sent (retry via ↺, the
   `retry` in useSearch.ts re-sending a failed run while another run has the same criterion
   pending, words/meaning switch, a `pending` run left over from a GET that the sweep has not
   buried yet — the server's `sweepPending` grace window — would that wedge Find for that
   question for up to 90s? Is that acceptable or should `running` only consider runs this tab
   started?).
2. The `setActive` updater change and its onDelete use — any behaviour change vs before (e.g.
   the legacy `?run=` seeding via resolveRuns(old, run1)).
3. Whether the tests would actually have gone red before the change, and anything they miss.
4. Whether the docs and comments claim anything the code does not do.

Fix what you find inside these files (keep the house style: comments explain why, match
surrounding density), run `npx vitest run tests/search-parallel-finds.test.tsx
tests/opening-read-gates-writes.test.tsx tests/use-search.test.ts` and `npm run typecheck` if you
can (a local Postgres may be required by vitest setup; if it refuses, say so). Report anything
wider for the author to decide. Write your findings as a numbered list with severity (P0/P1/P2),
file:line evidence, and what you changed, with a one-line verdict at the top.
