You are reviewing a plan, read-only, in the repository at the current working directory (a TypeScript + React reading app called Spideryarn).

Plan: docs/plans/260930f-gutter-questions-listed-in-the-comments-drawer.md

Read it, then check it against the code. The files that matter:

- src/web/Dock.tsx — the Comments drawer (`Questions` component, `CommentsChip`, the `drawer` prop types near line 439-470, the drawer render near line 1660-1760)
- src/web/reader/Reader.tsx — `openCommentFromDrawer`, `openChatThread`, `overlay`, `chatSummaries`, and the `drawer={...}` prop near line 2710
- src/web/comment-jump.ts — `jumpToComment`
- src/web/comment-nav.ts — `orderComments`, `passageOf`
- src/web/useChatAnchors.ts — `anchored`, `helpThreadFor`, the `loaded` flag
- src/types.ts — `ThreadSummary`, `ChatAnchor`, `Comment`
- docs/project/comments.md § Opening a question is a jump; docs/project/url-state.md

Questions to answer:

1. Is the diagnosis right — the "?" question is stored and only hidden, not lost? Anything that could actually lose it (e.g. closing the dialog with X during "Starting…" cancels/deletes the thread)? Check ChatDialog.tsx close-vs-cancel for help targets.
2. Does calling `jumpToComment(chatRows, id, openChatThread, jumpTo)` really give one history entry and open the floating dialog, in every mode the drawer can be opened from? What happens in Chat mode or Remember mode, where `overlay` is suppressed?
3. Ordering, loading, count, visitor gating: any hole in the rules as written?
4. Is there a simpler design that meets the report, or a reason this one is worse than it looks?
5. Anything the plan claims about the code that is false.

Write your findings, numbered, most severe first, each with file:line evidence and a concrete suggested change. End with a one-line verdict: "build as planned", "build with changes", or "rethink". Do not edit any files.
