# Code review: 261011o, Marginalia off the first open, and notes of its own

You are reviewing built code in the Spideryarn repo, worktree
/var/tmp/spideryarn-worktrees/fb-marginalia-default-and-notes (read CLAUDE.md for house rules). The
plan, with your own plan review's findings and how each was taken, is
docs/plans/261011o-marginalia-off-the-first-open-and-notes-of-its-own.md; your plan review is
docs/plans/261011o-plan-review-sol.md. The measurement is in the plan's § Measurement, from
evals/margin-notes/run.ts with results in evals/results/margin-notes/.

The diff to review: commits 301854787 (stage 1, the first-open default) and 9e4b0c99e (stage 2,
the notes). `git diff 301854787^ HEAD -- src tests evals` gives both; the stage-2 code diff is also
saved at docs/plans/261011o-code-review.diff.

**You may fix what you find**, inside this work: edit the files, keep changes minimal and in the
code's own style, and run `npx vitest run <the suites you touched>` and `npm run typecheck`. Do not
commit. Do not run any paid model call or eval. Do not touch .env.local, infra/, or any database.
Anything wider than this work, or a product choice, report rather than fix.

Look especially for:
1. `toNotes` (src/relations.ts): any way a wrong note survives (wrong join, quote matched in the
   wrong passage, an id outside the body), or a good one is dropped; rule order vs the cap.
2. The schema (notes first, nullable `to`/`toQuote`) against validateAnthropicJsonSchema and what the
   Messages structured-output API accepts (`type: ["string","null"]` — is that supported there, or
   should it be `anyOf`? Check how other schemas in src/ express a nullable string).
3. `answerTokens` vs `budgetFor("relations", …)` and `finishedText`'s truncation check.
4. useRelations: the returned `notes`/`relations` keep their identity across renders (the feed
   effect in OwnerMarginFeed must not loop); stale hides both; outdated keeps both on screen.
5. notes.ts placement and MarginaliaColumn's AsideNote: anything that breaks the column's layout
   pass (useMarginLayout), keyboard/touch access, the BlockRef jump inside the margin, voice/font.
6. Stage 1: anything else that still assumes the first open shows Marginalia (grep tests and docs).
7. Docs that are now false (docs/project/marginalia.md, cross-references.md, url-state.md, help
   pages under docs/ or src/help*), and anything that names "Relation words" as the Metadata row.

Write your findings to the output file as a numbered list with severity (P0–P3), file:line, what
you changed for each (or why you did not), and end with a one-line verdict: SHIP, SHIP WITH THE
FIXES MADE, or DO NOT SHIP.
