# GPT Sol plan review — 261009i

You are reviewing a plan in this repository, read-only. Read
`docs/plans/261009i-ask-in-chat-replaces-dig-deeper-and-a-chat-goes-back-to-its-item.md` and
`docs/project/chat-from-a-mode.md`, then check the plan against the code it names
(`src/web/GlossaryPanel.tsx` § Looked, `src/web/CitationsPanel.tsx` § WorkRow, `src/web/CitationInvestigation.tsx`,
`src/web/ProseHoverCard.tsx` § TermCard / CiteCard, `src/web/SkimPanel.tsx`, `src/web/CommentDialog.tsx`,
`src/web/reader/Reader.tsx` (handToChat, askGlossaryEntryInChat, citeActions, openTermInGlossary,
openFromStopCard, jumpTo), `src/web/ChatPanel.tsx`, `src/web/ConversationModes.tsx` (pendingOrigin),
`src/types.ts` § ThreadOrigin, `src/thread-origin.ts`, `src/routes.ts` § parseOrigin/parseItemOrigin,
`src/db/schema.ts` § chat_threads_origin_*, `src/web/IdeasPanel.tsx`).

Context: an admin (the product owner) asked for this, so whether to do it is settled. Review how.

Find:
1. Anything the plan gets wrong about the code (a surface missed, a dependency on the Dig deeper
   props it has not noticed, a test that will break silently rather than loudly).
2. Anything in stage 2 (`openOrigin`) that would not land on the item: a mode that ignores the
   parameter when it is already mounted, a gate/filter that hides the item, a phone layout where
   the band covers the prose so the "highlight the block" is invisible, history behaviour.
3. Stage 3 (Ideas origin + migration): any of the silent steps the checklist warns about, CHECK
   constraint shape, whether `Idea.id` is durable enough.
4. Whether anything here edits a defence listed in docs/project/security-map.md (prompt fencing of
   article text in the seed, origin validation in the route).
5. Simpler alternatives that achieve Greg's ask with fewer parts.

Write findings numbered F1…, each with severity (high/medium/low), the evidence (file:line), and
the fix you propose. End with a one-line verdict: "ready to build", "build after fixes", or
"rethink".
