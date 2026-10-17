# Code review: 261017e stage 1, "Bring into this chat"

You are reviewing, with write access, the code for stage 1 of the plan
docs/plans/261017e-bring-a-web-page-into-chat.md in this repo (Spideryarn; read CLAUDE.md for the
house rules). Your plan review is docs/plans/261017e-plan-review-sol.md; the plan's § Reviews says
how each finding was taken.

The diff is docs/plans/261017e-code-review.diff (commit 0d10b7ea2 on top of 8052f3b78). Files:
src/web/bring-in.ts, src/web/BringIntoChat.tsx, src/web/MentionPicker.tsx (useMentionPicker.add),
src/web/mentions.ts (withMentionAtEnd), src/web/ChatPanel.tsx (Composer, Conversation, Turn,
WebSources), src/web/styles/mode-band.css, tests/bring-in.test.ts, tests/bring-into-chat.test.tsx.

Evidence so far: npm run typecheck green; the two new test files plus the existing chat-mention,
chat-panel and doc-links suites green (120 tests). Mutation checks: removing ownCopy, registering
the hand-over for the guide's box, reading the cap from the render-time row, and removing the
reader-change generation guards each turned a test red.

Please look for correctness bugs above all:
- the ref seam between Conversation and Composer (registration every render, cleared on unmount;
  two composers? ChatDialog's composer? the list's new-conversation composer);
- useMentionPicker.add and its interaction with pick/remove/edit, restoredMentions and the draft
  store (onDraftMentions), mentionWaiting;
- BringIntoChat's state machine (pressed / handed / the module map / the job snapshot), what it
  does across remounts, reader change, a job that errors or is cancelled, the open article;
- anything a reader would see wrongly at 390px wide, or with a screen reader;
- whether the import can be charged twice (double press, two buttons for one URL).

Fix what you find inside these files, keep the house style (comment density, naming), run
`npx vitest run tests/bring-in.test.ts tests/bring-into-chat.test.tsx tests/chat-mention-picker.test.tsx`
and `npm run typecheck` after your fixes, and do not commit. Then write your report: each finding
with severity (P0/P1/P2/nit), file:line, what you changed or why you did not, and a one-line
verdict at the end.
