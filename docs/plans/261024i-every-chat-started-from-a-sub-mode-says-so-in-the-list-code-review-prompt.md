Code review of stage 1 of docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md (read the plan, including the section on your own plan review; stage 2 is deliberately deferred).

The change is uncommitted in this worktree: `git diff HEAD` (src/web/thread-source.ts, src/web/ChatPanel.tsx, src/web/styles/mode-band.css, src/web/help/pages/modes/chat.md and the regenerated src/help-corpus.generated.json, docs/project/chat-tools.md, docs/project/chat-from-a-mode.md, tests/chat-list-sources.test.tsx, tests/thread-source.test.ts, tests/thread-origin-way-back.test.ts).

What it does: Chat's list row for a chat with an origin now shows, in its meta line, the place it came from in the words of the chip (Investigate, Claims, Bibliography, Glossary, Ideas), via a new `originPlace(origin)` that `threadSource` and `originBack` both read. Learn rows don't repeat their title; passages and plain chats show nothing.

Check: correctness of `originPlace`/`placeLabel` and the rewritten `originBack` (behaviour must be unchanged for every origin, including `view` present only for Sources); that every consumer of `ThreadSource`/`OriginBackWords` still type-checks and behaves the same (grep the repo); the row markup and CSS at a 390px width (the meta line is a non-wrapping flex row: does a long place word plus count plus time overflow?); accessibility (does the new word duplicate the icon button's aria-label noisily?); tests that would pass even if the feature were broken; stale comments or docs that still say the icon alone names the place.

You may fix what you find inside this stage (code, tests, docs) — keep edits minimal and say what you changed. Run `npm run typecheck` and the touched test files (`npx vitest run tests/thread-source.test.ts tests/chat-list-sources.test.tsx tests/thread-origin-way-back.test.ts`). Do not commit, and do not run git commands that discard work.

Report numbered findings (F1…) with severity, evidence (file:line), and whether you fixed it. End with a verdict: approve / approve with fixes made / revise.
