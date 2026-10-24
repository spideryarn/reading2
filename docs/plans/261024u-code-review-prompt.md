Code review of the work for plan docs/plans/261024u-chat-links-the-earlier-conversation-it-mentions.md
(read it first, and your own plan review beside it: docs/plans/261024u-plan-review-sol.md, whose
F1–F4 the build answers).

The change is the uncommitted working tree of this worktree against HEAD: `git diff HEAD` plus the
new files `src/web/ThreadRef.tsx`, `src/web/thread-links.ts`, `tests/chat-thread-links.test.ts`,
`tests/chat-thread-link-band.test.tsx`. Read CLAUDE.md and docs/project/security-map.md for the house
rules.

House workflow: you may FIX what you find inside this change (edit files in this worktree), keeping
fixes small and in the surrounding style. Do not commit, do not push, do not touch .env files or
the database. Report anything wider than this change for me to decide instead of fixing it.

Look especially at:
1. Security: can model output produce a chip whose href leaves the reader's own conversations on
   this article? (citations.ts `splitCitations`, thread-links.ts, ThreadRef.tsx, the `everyThread`
   plumbing in ChatPanel.tsx and ChatDialog.tsx.)
2. Navigation correctness in both presentations: Chat's band (ConversationModes.tsx reconciles
   `?thread=`) and the floating ChatDialog / margin card (Reader.tsx passes `target` from
   `?thread=`). Is a pushed navigation with `scroll: false` right in each? Guide and Learn targets?
3. The server counters in converse.ts (`threadCitations`, `unknownIds`, `citedBlocks`,
   `citedAmbiguous`, `citedConversations`) against what the client draws; `citationRuns` in
   citable.ts.
4. The prompt line added to Chat's SYSTEM (BUILD ON THEIR EARLIER CONVERSATIONS) — clear, and does
   it risk the model citing conversation ids where block ids belong?
5. Tests: do they prove the behaviour, and would they fail if it broke?

Gates to run after any fix: `npx vitest run tests/chat-thread-links.test.ts
tests/chat-thread-link-band.test.tsx tests/chat-markdown-render.test.tsx tests/chat.test.ts
tests/chat-mention-citations.test.ts tests/chat-web-links.test.ts` and `npm run typecheck`.

Answer with findings numbered C1.., each with severity, what you changed (file:line) or why you left
it, and a final line VERDICT: ready | not ready.
