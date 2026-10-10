You are reviewing a plan (read-only) in the Spideryarn repo, before it is built.

Plan: docs/plans/261010a-gpt-live-is-the-live-engine-for-everyone-realtime-from-an-arrow-on-the-live-button.md

Read it, then the code it changes: src/web/live/engine.ts, src/web/live/useLive.ts,
src/web/live/LiveButton.tsx, src/web/menu.ts (the shared Radix DropdownMenu pieces and
useFingerPressMenu), the .chat-live* rules in src/web/styles/mode-band.css,
tests/gpt-live-engine.test.tsx, src/web/PrivacyPage.tsx (around the live voice models) and
tests/privacy-page.test.ts, docs/project/live-conversation.md (§ The default model, § The second
engine, § What this engine does not have), and the queue item text quoted in the plan.

Greg (product owner) has decided the product question: GPT-Live becomes the default for every
reader; Realtime only with Experimental features on, chosen from a small arrow on the Live button.
Do not relitigate that. Review for:

1. Correctness of the engine rules, especially the turn-Experimental-off-mid-call rule, the
   "lingers" rule in useLive, Reconnect across engines, and readers with old localStorage values.
2. Anything elsewhere in the code that assumes Realtime is what a reader without Experimental gets
   (grep for it: LiveStatus, Tap to talk, microphone placement, tooltips, docs, tests, server routes,
   cost tracking) that the plan misses.
3. The split-button design: accessibility (names, keyboard, focus), the key-propagation concern,
   touch, Radix usage, and whether disabled-during-call is right.
4. Privacy page wording and its test.
5. Anything simpler.

Write findings numbered P1.. with severity (P1 blocker / P2 should fix / P3 nit), file:line
evidence, and a suggested fix. End with a one-line verdict: APPROVE, APPROVE WITH CHANGES, or
REJECT.
