Code review of a built change in the Spideryarn repo (this worktree). You may fix what you find inside this change's scope (src/web/AddArticle.tsx, src/web/Library.tsx, tests/shelf-search-offers-a-pasted-link.test.tsx, src/web/help/pages/shelf.md, docs/project/library.md, the plan doc). Report anything wider for me to decide rather than fixing it. Do not commit, do not run git commands that change the tree or index, and do not touch other files.

Plan: docs/plans/261011l-shelf-add-box-and-search-box-look-like-different-things.md (its § Plan review lists what the plan review asked for and what was taken).
Plan review: docs/plans/261011l-shelf-add-vs-search-plan-review-sol.md
Diff: docs/plans/261011l-shelf-add-vs-search-code-review.diff (also `git diff origin/dev...HEAD`).

Check especially:
1. `linkToAdd` in Library.tsx: correctness vs slugFromUrl (src/ingest.ts) and addHref (src/web/router.ts); is offering via navigate(addHref(link)) the same act as the Add button (AddArticle.tsx `submit`), and does the AddPage (src/web/AddPage.tsx) validate before posting so a false positive cannot spend an allowance?
2. The SearchBox wrapper width `tw:w-[min(24rem,calc(100%_-_2rem))]` with `tw:ml-auto`: does this Tailwind v4 arbitrary value compile (the tw: prefix config is in the CSS; check how other arbitrary values with calc are written in the repo)? Behaviour at 320/390/768/1280.
3. AddArticle.tsx: the new relative wrapper around the URL input — flex wrapping as before (min-w-48 flex-1 moved onto the wrapper), focus ring not clipped, `id="add-url"` still on the input, label htmlFor, the icon decorative. `max-w-2xl` on the section — anything inside (job list, upload status; BatchPanel is outside) that now breaks.
4. The new test: does it actually exercise the behaviour (would it fail if the offer were removed, or if Enter navigated)? Any flakiness from timers?
5. Copy and comments: accurate, match the surrounding style; any stale comment elsewhere that this change makes false (e.g. comments describing the search box as full width, or the add box's label as small/grey, or the old placeholder text in docs/tests/help-images).

Run: npx vitest run tests/shelf-search-offers-a-pasted-link.test.tsx tests/shelf-search-clear.test.tsx tests/shelf-search-focus.test.tsx and npm run typecheck after any fix.

Write findings most severe first with file:line, say for each whether you fixed it, and end with a one-line verdict: SHIP, SHIP AFTER MY FIXES, or DO NOT SHIP.
