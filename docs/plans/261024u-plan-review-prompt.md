Review the plan docs/plans/261024u-chat-links-the-earlier-conversation-it-mentions.md (read-only review; do not edit files).

Context: Spideryarn repo. Read CLAUDE.md, docs/project/security-map.md, docs/project/chat-tools.md (§ The reader's notes, § The other conversations come with every question), docs/project/url-state.md (§ thread, § One conversation id, two ways of drawing it). Code to read: src/web/citations.ts (splitCitations, crossArticles), src/web/Cited.tsx (Ctx, citations()), src/web/CrossArticleRef.tsx, src/web/ChatPanel.tsx (Conversation, Turn, Answer, ThreadList row press), src/web/ChatDialog.tsx (Conversation call), src/web/modes/conversation/ConversationModes.tsx (threads/listed, onThread, onOpenLearn, the destination effect), src/web/thread-source.ts, src/reader-notes.ts (eligible, otherConversationsSection), src/converse.ts (SYSTEM prompt BUILD ON bullet, unknownCitedIds, citedBlockIds, the log line around 4000), src/routes.ts (chatOthers), src/citable.ts, src/web/Link.tsx, src/web/router.ts (navigate, useAddress).

Questions:
1. Is the security story sound: can a model's output make a chip that goes anywhere other than one of the reader's own conversations on this article? Any id-collision or kind case missed?
2. Does navigating by address (push) rather than the band's onThread callback break anything in Chat's band (heldOnList, drafts, pending live, guide handling, learn rows) or in the floating ChatDialog (target derived from ?thread=; kind always chat)? Should it be replace?
3. Is the client/server agreement (citable.ts, tests/chat-markdown-render.test.tsx "client and server agree") affected by a new segment kind?
4. Anything simpler? Anything missing from checks?
Give findings numbered F1.., each with severity and a concrete fix. Be concise.
