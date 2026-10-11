VERDICT: SHIP AFTER FIXES

## Findings

C1. [src/web/ChatDialog.tsx:936](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/src/web/ChatDialog.tsx:936), [src/web/ChatDialog.tsx:1312](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/src/web/ChatDialog.tsx:1312) — **Medium.** The paragraph-side chat dialog discarded the composer’s `SendHow` argument for both new anchored conversations and follow-ups. Typed, dictated, and mixed questions therefore stored `modality = NULL`. I forwarded modality through both adapters and added red-first regression tests for both paths.

C2. [src/web/ChatPanel.tsx:268](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/src/web/ChatPanel.tsx:268), [src/web/modes/conversation/ConversationModes.tsx:1437](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/src/web/modes/conversation/ConversationModes.tsx:1437) — **Medium.** The “Ask something new…” list composer had the same failure: its adapter accepted only the question, silently dropping provenance before `useChat.send`. I widened the callback contract, forwarded modality, and added a red-first test asserting it reaches the actual POST body.

Root cause: TypeScript permits callbacks with fewer parameters, so the one-argument adapters typechecked while silently discarding argument two.

Verification: 121 focused tests pass; all TypeScript projects pass. The supplied 98 Postgres tests pass. Lint reports only existing cognitive-complexity advisories. A fresh full `npm test` could not start because this environment has no reachable database.

## Wider issues

None.