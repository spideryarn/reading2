You are reviewing code before it is pushed, in the Spideryarn repo (this working tree). You may edit
files to fix what you find, inside the scope of this change; report anything wider for me to decide.

The plan, with your own plan review folded in (S1–S8) and the measurement results:
docs/plans/261011w-does-the-cited-work-say-that-at-the-citing-sentence.md

The change: docs/plans/261011w-does-the-cited-work-say-that-code-review.diff (the tracked diff, then
the three new files in full: src/read-cited-work.ts, tests/read-cited-work.test.ts,
evals/read-cited-work.ts). Read the real files in the tree, not only the diff.

What it does: a chat tool `read_cited_work` (chat and explore kinds only) that reads a cited paper's
PDF through src/paper-evidence.ts's `readPaperEvidence`, aimed at a claim; and a *Does it say that?*
button on the citation hover card in the prose that starts a fresh chat anchored on the citing
paragraph.

Check especially:
1. Did each of your plan findings S1–S8 land as the plan now says? (anchor shape `{ blockId }`;
   `investigateContext` + `matchedPageOf` only, never a row's article/web url; title-only matching;
   stale/no-list/failed distinct; deadline + signal including the un-abortable registry wait; fence;
   offered only to chat/explore; button only when `here` is in `citedAt`.)
2. Silent success: any path where the tool reports a read it did not do, or the provenance line
   overstates what was sent (e.g. `sentWords >= words` → "all of it"), or a failure reads as an
   answer. Does the outer `Promise.race` leak a listener or an unhandled rejection?
3. Does adding a tool to `CHAT_TOOLS_WITH_NOTES` break anything that assumes that list's shape
   (prompt caching, Explore, Live's `LIVE_SERVER_TOOLS`, the `describeCall` labels shown in a
   transcript)? Is the tool name/label safe to store on a message?
4. Is `matchWork`'s containment rule right (exact title wins; a run of words otherwise)? A title of
   one common word?
5. The card: touch (a text button, one tap), two works over one phrase, the reference entry, a
   visitor. The Reader sender: does `handToChat` with an anchor and no origin behave as the
   passage path does, from every mode?
6. Tests that would pass with the feature broken.

Run `npm run typecheck` and the touched suites (`npx vitest run tests/read-cited-work.test.ts
tests/paper-evidence.test.ts tests/citation-hover-card.test.tsx tests/chat-tools.test.ts
tests/chat-handoff.test.ts tests/glossary-and-bibliography-ask-in-chat.test.tsx`) after any fix.

Answer with numbered findings: severity, evidence (file:line), what you changed (if anything), and
what you left for me. End with one line: VERDICT: PUSH / PUSH AFTER MY FIXES / DO NOT PUSH.
