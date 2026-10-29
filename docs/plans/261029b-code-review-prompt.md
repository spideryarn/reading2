You are reviewing code in this repository. Read AGENTS.md / CLAUDE.md for house rules (never run git
commands that discard work; do not commit).

The plan: docs/plans/261029b-citations-in-a-comma-separated-list-are-all-read.md (your own plan
review is docs/plans/261029b-plan-review-sol.md; the plan says what was taken from it).

The change: /tmp/claude-1000/-home-greg-code-spideryarn2/26a154a6-3d57-4414-833b-32bcc170c3ae/scratchpad/code.diff
— src/citation-author-year.ts (`NEXT_IN_LIST`, the `read` helper and the continuation loop in
`authorYearCites`), tests/citation-author-year.test.ts, tests/bibliography-fill-from-text.test.ts,
docs/project/bibliography.md.

Review the CODE for correctness: the refactor into `read` must behave exactly as before for every
existing case (compare the old body in the diff carefully: `\p{Lt}`, the narrative bracket end, the
year split, `found.has`); the continuation loop's offsets (`nextStart`, the length passed, `end`),
termination, the sticky regexp's `lastIndex` with the `u` flag, interaction with matches the global
PARENTHETICAL pass finds later at the same start (an item after `; ` that the loop also reached),
order of the returned hits, and ENTRY_LINE's `found.size` check. Look for any input where the loop
produces a hit with wrong start/end (a quote that is not the item's exact characters), loops
forever, or is slow on a long run of `, Name 2020` items.

You may FIX what you find inside these files (and add tests); run
`npx vitest run tests/citation-author-year.test.ts tests/bibliography-fill-from-text.test.ts tests/bibliography.test.ts`
and `npm run typecheck`. Report anything wider for me to decide. End with a numbered list of
findings (severity, evidence, what you changed or suggest) and a one-line verdict.
