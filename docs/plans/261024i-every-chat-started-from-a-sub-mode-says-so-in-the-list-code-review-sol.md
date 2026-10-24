F1 — P2, narrow-row overflow. The non-wrapping place, count, and absolute date could exceed the available width at 390px, especially with “Bibliography.” Fixed by allowing the timestamp—the least important field—to shrink with an ellipsis while retaining its full value in the row tooltip. Added a regression test. Evidence: [mode-band.css](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/web/styles/mode-band.css:616), [chat-list-sources.test.tsx](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/tests/chat-list-sources.test.tsx:259). The actual 390×844 capture also looks correct: [261024i-shot-2-narrow.png](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/docs/plans/261024i-shot-2-narrow.png).

F2 — P2, tests could miss broken behavior. The row test could pass if the place appeared outside the meta line, while partial `originBack` assertions could miss an incorrect extra `view` on Glossary or Ideas. Fixed with an exact markup path and full object equality for every origin. Evidence: [chat-list-sources.test.tsx](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/tests/chat-list-sources.test.tsx:240), [thread-source.test.ts](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/tests/thread-source.test.ts:201).

F3 — P3, stale documentation. Several mode/help pages still described the icon as the row’s only origin marker, and Reception still said Back returned to “Sources’ Reception.” Fixed those references and regenerated the help corpus. Evidence: [sources.md](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/docs/project/sources.md:361), [reception.md](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/docs/project/reception.md:367), [chat.md](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/web/help/pages/modes/chat.md:45).

No correctness finding against the implementation:

- `originPlace` exhaustively maps all five origins, and `placeLabel` uses the canonical chip wording.
- `originBack` retains the prior labels, quotes, modes, and text; `view` is present only for Sources origins.
- Repository consumer inspection and typechecking found no `ThreadSource` or `OriginBackWords` breakage.
- Learn, passage, and plain-chat rows behave as requested.
- Accessibility is sound: the visible place belongs in the row button’s accessible name, while the icon’s label identifies its separate details control. Hiding either would lose useful context.

Verification:

- Requested Vitest command: 3 files, 75 tests passed.
- `npm run typecheck`: blocked before compilation because the sandbox denies `tsx`’s IPC socket (`EPERM`).
- Equivalent `node --import tsx scripts/typecheck.ts`: passed all projects and all 3,939 covered files.
- `git diff --check HEAD`: passed.
- No commit made.

Verdict: **approve with fixes made**.