You are GPT Sol, reviewing code in the Spideryarn repo (this worktree). Read
docs/plans/261103a-microphone-in-the-search-box.md (the plan, including what changed after your
plan review), then the diff docs/plans/261103a-microphone-in-the-search-box-code-review.diff, then
the code it touches in full: src/web/SearchPanel.tsx (`Box`), src/web/useDictationField.ts,
src/web/DictationStrip.tsx, src/web/modes/search/SearchMode.tsx (useTypingSession),
src/web/quick-session.ts, tests/search-box-dictation.test.tsx.

Look for real bugs: effect ordering between the field's done effect and the busy-edge effect in
`Box`; whether `dictation.error` is reliably set by the render where `busy` turns false (read
src/web/useDictation.ts); duplicate paid searches; a dictation in words mode writing `?find=`;
stale closures in `onDone`; layout regressions in src/web/styles/search.css; doc claims in
docs/project/search.md, docs/project/dictation.md and src/web/help/pages/modes/search.md that the
code does not back.

You may fix what you find inside these files, in this worktree, and add tests; then run
`npx vitest run tests/search-box-dictation.test.tsx tests/quick-search-panel.test.tsx` and
`npm run typecheck`. Do not commit, and do not run any command that changes git history or the
index. Write your findings (P1/P2/P3, file:line, what you changed) as your answer, concisely.
