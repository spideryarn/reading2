# Plan review: 261017e, bring a web page into Chat (and the guide's page-reading)

You are reviewing a plan, read-only, in the repo at the current directory (Spideryarn; read CLAUDE.md
first for the house rules). The plan is docs/plans/261017e-bring-a-web-page-into-chat.md.

Context: Greg (the product owner) answered question docs/user-feedback/questions/q-madusw.md with
"1A and 2A". Stage 1 (1A) will be built by an unattended agent; stage 2 (2A, adding read_web_page to
the guide's tools) is a defence edit and is only planned and asked of Greg.

Please check the plan against the real code, especially:
- src/web/MentionPicker.tsx (useMentionPicker), src/web/mentions.ts, the Composer and WebSources in
  src/web/ChatPanel.tsx, src/web/chat-draft.ts (the draft store of the "Bringing in" row);
- src/web/ProseHoverCard.tsx (WithAddToShelf, describeAdd) and src/web/useJobs.ts / jobEngine.ts,
  which the button copies;
- POST /api/jobs in src/routes.ts (repeat, publicCopy, ownCopy, openEarly) and when a URL import's
  job reaches "done" relative to the revision admitMentions (src/chat-mentions.ts) needs;
- src/chat-tools.ts (toolsFor, GUIDE_TYPED_TOOLS, readWebPage, SEARCH_WEB_PER_TURN) and
  src/converse.ts (GUIDE_SYSTEM) for stage 2.

Questions I most want answered:
1. Is waiting for job status "done" right, given openEarly (a second structure job)? Will
   admitMentions accept the article at that moment? Is the job's slug reliable for the mention?
2. Is the "composer registers add() with the panel via a ref" seam sound, given the Composer's
   draft persistence (onDraftMentions) and mentionWaiting? Any simpler seam?
3. Is ownCopy:true always correct? Any case it charges a slot wrongly (e.g. the reader's own copy
   exists under a different URL key; an upload; an admin)?
4. Anything in 1A that edits a listed defence in docs/project/security-map.md (it should not)?
5. For stage 2: are the risks and the per-turn cap right; anything missing before asking Greg?
6. Anything simpler that gets most of the value.

Write findings as a numbered list, each with severity (P0 blocker / P1 / P2 / nit), the file:line
evidence, and the fix. End with a one-line verdict.
