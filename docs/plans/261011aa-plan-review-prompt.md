You are reviewing a plan before it is built, in the repo at the current directory (Spideryarn, an
AI-assisted reading app). Read-only: do not edit anything.

The plan: docs/plans/261011aa-guide-and-chat-run-in-article-searches-in-place-and-link-the-article-readily.md

Read CLAUDE.md's pointers as needed, and especially:
- docs/project/chat-tools.md § Command buttons, § The guide
- docs/project/search.md (quick search, saving, several searches at once, the URL)
- docs/project/security-map.md (row for chat-commands.ts / command-proposal.ts — a defence we must not edit)
- src/web/CommandChip.tsx, src/web/Cited.tsx, src/web/GuideNextSteps.tsx, src/web/command-runners.ts
  (quickSearchPress, chatExecutor), src/web/useSearch.ts (how Search mode posts and reads the stream;
  the duplicate guard, the delete tombstone, `madeFor`), src/routes.ts § search (POST /api/search/:slug,
  the lock), src/web/search-hits.ts (findLiteral), src/converse.ts (GUIDE_SYSTEM, COMMAND_CHIPS),
  src/live.ts (SPOKEN_GUIDE, show_passage).

Questions:
1. Is the design right for what Greg asked (quoted in the plan)? Is there a simpler route that
   gives him the same thing?
2. Correctness traps: running a search from outside Search mode while Search mode's useSearch may
   also be mounted later (or in the dialog case, concurrently); the server's per-article lock or
   duplicate handling; the id the server returns in `begin` differing from the one sent; streamed
   hits vs the final `done`; a card that unmounts mid-stream (chat re-renders, the answer list
   re-mounts); the "reuse a saved run with the same words" read — staleness, case/whitespace
   matching, quick vs meaning kind, and whether drawing a stored result without a press breaks
   the "model never causes a run" rule.
3. Security: does anything here widen what a model-written token can do, or need a change in the
   defence files? The reader still presses.
4. The prompt changes: anything that will backfire (e.g. the model now writing button tokens in
   Live, or block ids spoken aloud)?
5. Anything missing from tests.

Write findings as a numbered list, each with severity (high/medium/low), the file/line evidence,
and a concrete fix. End with a one-line verdict: "build as planned", "build with these changes",
or "rethink".
