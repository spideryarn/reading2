You are reviewing a plan before it is built, in the repo at the current directory (Spideryarn, TypeScript). Read-only.

Plan: docs/plans/261020w-export-your-own-words-and-a-chat-as-markdown.md (untracked, read it from disk).
Context to read: docs/project/export.md; src/store/export-bundle.ts (augmentationFiles, FILE_NOTES, readme); src/store/article-rows.ts (ArticleRows, readArticleRows); src/routes.ts (sendExport around line 1012 and the /api/export route around 11605); src/web/export-download.ts; src/web/ChatPanel.tsx (the ModeSurface head around 670-765, CopyAnswer around 3030); src/web/useCopy.ts; src/recall-hint.ts (answerAsSeen); src/store/pg-chat.ts (toMessage, threadsFor); src/reader-notes.ts (settledExchanges, kindWords); src/types.ts (ChatThread, ChatMessage, ThreadKind); src/urls.ts (articleUrl); docs/project/security-map.md.

Questions:
1. Is the shape right — a shared renderer, a Copy button per conversation, and one your-words.md (route + inside the zip + Metadata button)? Is there a simpler version that gets most of the value? Is anything here a second way of doing something the codebase already does?
2. Correctness traps: ownership/scoping of the new route, route pattern ordering vs the existing /api/export/:slug pattern, front matter validity, Recall hint leakage, which comment rows are the reader's (comments has status/answer/threadId columns — are some rows not reader-authored, or bookmark-only?), quiz_attempts fields, chat thread kinds to include/exclude, message statuses, ordering of comments by block ordinal.
3. Does anything here touch a defence in docs/project/security-map.md?
4. Anything the plan should defer or add.

Severity scale: P0 (would ship broken or unsafe), P1 (real bug or wrong design), P2 (worth changing), P3 (nit). Give each finding an ID (F1, F2…), severity, file/line evidence, and a concrete fix. Write your findings to the output file.
