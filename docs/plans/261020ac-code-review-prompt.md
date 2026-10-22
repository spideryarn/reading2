You are reviewing built code before it is pushed, in the worktree you are running in. You may fix what you find inside this change (sandbox workspace-write); report anything wider for the author to decide. Do not commit, do not run git commands that change state, and do not run paid evals.

The change: plan docs/plans/261020ac-chat-told-how-much-of-the-article-you-have-read.md (read its "Status, and what the plan review changed" first — it supersedes the rest), its plan review docs/plans/261020ac-plan-review-sol.md (your own, F1–F7), and the investigation docs/investigations/261020g-chat-reading-so-far-measured.md.

See the diff with `git diff HEAD` plus the untracked files from `git status --short` (src/reading-so-far.ts, tests/reading-so-far.test.ts, tests/chat-reading-route.test.ts, evals/chat-principles/tally.ts, the docs). The evals/chat-principles/results/ files are the evidence; check the investigation's numbers against them (verdicts-*.txt with key-*.txt, the summaries in the *.json files) and against evals/chat-principles/tally.ts.

Look especially for:
- whether "read" really agrees with the quiz's (src/web/read-filter.ts, src/web/reading-time.ts, Reader.tsx's bodyWords), and the boundaries of `shareWords`;
- every path that builds a chat turn in src/routes.ts (send, retry, edit, help, spoken/live-turn routes if any reach `converse`) and whether each gets the line exactly when it should; whether `thread.kind` is the right gate; error handling in `chatReadingSoFar`;
- the cache prefix staying byte-identical; the help-turn word rule (tests/help-prompt.test.ts);
- the type move of `ReadingTimeStatus` (src/web/useReadingTime.ts re-export) and the server importing src/web/ modules;
- whether the privacy page and docs/project/privacy.md are now true, word for word, of what the code sends;
- whether the investigation claims more than its evidence shows.

Run `npm run typecheck` and `npx vitest run tests/reading-so-far.test.ts tests/chat-reading-route.test.ts tests/chat-principles.test.ts tests/help-prompt.test.ts tests/privacy-page.test.ts tests/doc-links.test.ts` after any fix. Write numbered findings F1.. (severity, file:line evidence, what you changed or the fix you propose), then a list of the files you edited, then a verdict: push / push after the listed fixes / do not push.
