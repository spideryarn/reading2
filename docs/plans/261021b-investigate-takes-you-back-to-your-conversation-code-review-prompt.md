You are reviewing built code in the Spideryarn repo (this working directory), and you may fix what you find.

The plan: docs/plans/261021b-investigate-takes-you-back-to-your-conversation.md (your plan review and how each finding was taken are in it, and in docs/plans/261021b-investigate-takes-you-back-to-your-conversation-plan-review-sol.md).

The change is the uncommitted diff in this worktree: run `git diff HEAD -- src tests docs/project src/web/help` to see it. Files: src/web/InvestigatePanel.tsx (`useReopenNewest`, `occupied`, `loaded`, Your questions moved above Suggested), src/web/reader/Reader.tsx (`investigateChats` gains `loaded` and `occupied`; `openOrigin`'s `reception` arm keeps `?thread=`), tests/reception-lens-in-chat.test.tsx (the "coming back to Investigate" block), tests/reception-lens.test.tsx, tests/rewrite-hold.test.tsx, docs/project/sources.md, src/web/help/pages/modes/sources.md.

Evidence so far: the new tests were red before the change (three arrival tests; the ordering test red with the old order; the passage-draft test red with `chatDraft` taken out of `occupied`), and all pass now. `npm run typecheck` is clean. A browser pass on the box at 1440 and 390 passed: cold arrival opens the newest Investigate chat with its transcript, close stays closed, chip away/back reopens, the way back from Chat keeps the same chat, no chat POST, no console errors.

Look especially for:
- any path where the arrival replaces something the reader had open, fires for a non-owner, or fires late (e.g. `loaded` flipping after a press that is already navigating to Chat, or `occupied` flipping false→true→false);
- whether `occupied` should include anything else that shares the place beside the mode (the comment dialog `openComment`, an annotation in progress `annotating`, the help dialog, ChatDialog's other targets) — read Reader.tsx around `overlay` and where ChatDialog/CommentDialog are mounted;
- the memo dependency change in Reader (does adding `thread`, `chatDraft`, `note` make the Sources band re-render more than it should, and does it matter?);
- test flakiness (timing via `until`/`settle`), and anything the tests do not prove.

Fix what is clearly right inside this change, keeping to the surrounding style; run `npx vitest run tests/reception-lens-in-chat.test.tsx tests/reception-lens.test.tsx tests/rewrite-hold.test.tsx` and `npm run typecheck` after any fix. Do not commit. Report wider issues rather than fixing them.

Write a numbered list of findings (severity blocker/should-fix/nit, file:line, what you changed or recommend), then a one-line verdict.
