# Narrow check (read-only): your round-2 P1 fixes, 261012d

Repo root: the current directory. This is not a new review round: discovery is closed. Check only whether your three round-2 P1 fixes in commit cb2eed61f (`git show cb2eed61f`) are correct and complete. Your findings are in docs/plans/261012d-round-2-code-review-sol.md.

- R2-1: the main Chat-list composer now sends through `sendTo` (ConversationModes.tsx). Does every composer that can send a first chat question with mentions (Chat list, ChatDialog, block chat card, any other Composer user) now take the refusal-preserving path? Does a non-mention first question behave exactly as before?
- R2-2: definite 4xx refusal restores the composer; network loss / empty stream opens the failed thread without enabling a duplicate send (controller.ts, effects.ts). Is the 4xx-vs-uncertain classification right (e.g. a 409 stale tail, a 402/429 quota refusal — does restoring the composer make sense for those, or did the change alter their existing behaviour)? Can the composer latch?
- R2-3: chip × removes the exact inserted anchor. Does the anchor stay correct when the reader types before it, deletes part of it, or the draft is replaced (dictation, restore from draft store)?

You may run pure client tests (tests/chat-mention*.test.ts(x), tests/chat-mentions-client.test.tsx, tests/chat-visible-blocks-reach-the-server.test.tsx, other tests/chat*.test.tsx). Do not edit files. For each: HOLDS or STILL OPEN with severity, file:line and the concrete fix. End with one line: FIXES HOLD or STILL OPEN.
