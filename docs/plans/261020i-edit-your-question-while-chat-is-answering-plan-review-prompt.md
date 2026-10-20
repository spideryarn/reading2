# Plan review: edit your question while Chat is still answering

You are reviewing a plan, read-only. Do not change any file. Write your findings as your final answer.

Read docs/plans/261020i-edit-your-question-while-chat-is-answering.md (untracked file in this worktree), then
check its claims against the code: src/web/ChatPanel.tsx (`ChatTranscript`, `Turn`, `EditQuestion`, the
`canEdit` / `busy` wiring), src/web/useChat.ts (`edit`, `stop`), src/web/chat/reduce.ts (intent/stop
handling, `startTurn`, how a stopped turn settles), src/web/chat/effects.ts (`stopAnswer`),
src/routes.ts (`settleThread`, the retry/edit branch of the chat POST), and
tests/learn-edit-asks-again.test.tsx.

Questions:
1. Is the sequencing (stop, wait until `busy` is false, then the existing edit) sound? Name any state in
   which `busy` goes false but the edit should NOT go, or the edit goes against the wrong tail
   (`expectedTailId`), or `busy` never goes false although the stop succeeded.
2. Is the claim right that sending the edit immediately would put two turn operations in one
   conversation in the reducer, and is that genuinely riskier — or does the reducer already handle it,
   making the simpler option fine?
3. Anything about stopping an answer whose `begin` frame has not arrived yet (the stop waits on a name)?
4. Anything the plan misses: focus, the recovery path ("connection lost"), Live, other conversation
   kinds sharing the transcript, the help page.

Severity scale: P0 (data loss / broken), P1 (wrong behaviour a reader will hit), P2 (worth fixing),
P3 (nit). Give each finding an ID (F1, F2…), the file:line evidence, and a suggested fix.
