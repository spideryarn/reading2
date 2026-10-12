# Plan review: chat @-mention of the reader's own articles (and attachments)

You are reviewing a plan, read-only. Repo root is the current directory (a worktree at origin/dev plus untracked docs/plans/261012d-chat-at-mention-your-own-articles.md, the plan).

Read first:
- docs/plans/261012d-chat-at-mention-your-own-articles.md (the plan under review)
- docs/plans/261011v-chat-attachments.md and docs/plans/261011v-chat-attachments-plan-review-sol.md (the earlier plan and your earlier review; this plan claims to keep every fix)
- docs/user-feedback/questions/q-jzx20h.md (the question Greg just answered; his answer is quoted at the top of the plan)
- docs/project/chat-tools.md § Security, docs/project/security-map.md, docs/project/sql.md, docs/project/block-ids.md

Code to check the plan against: src/routes.ts (streamChat, ~3212-3850, how `visible` is validated), src/converse.ts (buildConverseMessages ~2283-2400, CLAIM_ORIGINS ~601, CITING_IDS ~751, citedBlockIds/unknownCitedIds ~2624), src/chat-tools.ts (search_library, read_library_passage ~1487-1590, ToolContext ~242), src/store/owned-slug.ts, src/store/pg.ts (listArticles ~2414, loadArticle ~2890), src/db/schema.ts (chat_threads ~4368, chat_messages ~4679), src/store/article-rows.ts, src/store/export.ts, src/web/ChatPanel.tsx (Composer ~3081-3534), src/web/citations.ts, src/web/Cited.tsx, src/web/BlockRef.tsx, src/web/TagEditor.tsx.

Constraints the author is under: an unattended agent may edit a security defence only as far as Greg's words plainly authorise. Greg authorised: @-mention of articles in *his own* shelf, including archived and public, brought into the chat context. He did NOT authorise reading other readers' articles. On attachments he said "keep things simple ... maybe it's local to that chat ... or better still attachments to an article ... if it's really complicated we should discuss."

Questions I most want answered:
1. Is the security story right? Specifically: whole-text inclusion of a mentioned article inside untrusted(); per-turn ownership re-check; the cross-article citation chip allowlist (href from server slug only); the claim "no new outbound channel"; archived articles newly readable by chat when named.
2. The second cache_control breakpoint placement (a second text part in the first user message). Does it preserve bp1 caching through OpenRouter to Anthropic, and is it right for non-Anthropic models chat may use (check src/converse.ts model selection)? Is there a simpler correct placement?
3. Storage: table chat_mentions with FKs vs a jsonb column on chat_messages. Is the composite FK to chat_messages feasible given chat_messages' key and how edit/retry/delete-a-question rewrite rows (check the chat store)? Will edit/delete-question cascade correctly?
4. The open question in §1: size for greying-out too-long articles — LibraryEntry field vs server-only refusal. Simplest correct?
5. Attachments: is a picker row "Upload a file…" that routes to the existing upload flow (file becomes an ordinary own article, then @-mentionable) in scope and safe for this unattended run, or should all attachment work be a follow-up question to Greg? Is there any simpler shape of "attachments to an article" that needs no defence edit?
6. Anything the plan gets wrong about the code — cite file:line.
7. Is anything over-built for a v1? Name what to cut.

Severity scale: P0 (would ship a security hole or data loss), P1 (wrong behaviour a reader would hit, or plan contradicts code), P2 (should fix, not blocking), P3 (nit). Give every finding an ID (F1, F2, …), severity, evidence with file:line, and a concrete fix. End with one line: SOUND, SOUND WITH FIXES, or UNSOUND.
