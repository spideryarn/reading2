You are reviewing a plan before it is built, in the Spideryarn repo (this checkout). Read-only.

Plan: docs/plans/261012f-guide-hands-content-questions-to-a-new-chat.md — read it first.

Then read the code it touches: src/next-steps.ts, src/chat-tools.ts (offer_next_steps), src/types.ts (NextStep),
src/web/GuideNextSteps.tsx, src/web/ChatPanel.tsx (where GuideNextSteps is drawn, onSendNew, SendHow),
src/web/modes/conversation/ConversationModes.tsx (onSendNew, sendTo, the handoff effect, the guide in Chat's band),
src/converse.ts (GUIDE_SYSTEM), src/web/styles/chat-actions.css and mode-band.css (.chat-suggest-btn, .guide-next-steps),
evals/guide/next-steps.ts, and docs/project/security-map.md for the untrusted parties (the article is untrusted and the guide sees it).

Questions:
1. Is a sixth NextStep kind "chat" pressed through ChatPanel's onSendNew correct and safe? Any case where onSendNew in the guide view
   would mint the wrong kind, append to an existing conversation, or lose the reader's open draft? Does anything else consume NextStep
   exhaustively (switches, stored JSON readers, MCP, admin, export) that must learn the new kind?
2. Security: a hostile article could steer the guide to offer a chat step with planted words. The press is the reader's and sends to Chat
   (which reads the same article). Is that acceptable within the existing rules for ask steps? Anything to add (length cap, the eval's hostile cases)?
3. The prompt change: is the wording likely to produce a chat step for content questions and not for reading questions? Is "under 60 words" sensible
   given the guide also ends with offer_next_steps?
4. Styling: anything wrong with a legend on the fieldset and one orange filled step?
5. A simpler option the plan missed?

Write findings numbered F1.., each with severity (high/medium/low), the evidence (file:line), and the fix. End with a one-line verdict:
BUILD AS PLANNED, BUILD WITH CHANGES, or RETHINK.
