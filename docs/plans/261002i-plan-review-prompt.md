You are reviewing a plan before it is built, in the repo at the current directory (Spideryarn, an AI-assisted reading app). Read-only: do not edit anything.

Read the plan: docs/plans/261002i-one-adaptive-recall-and-a-tutorial-sub-mode-for-remember.md. Then read docs/project/remember-mode.md, src/converse.ts (REMEMBER_SYSTEM, systemFor, readItFor, stanceLine, buildConverseMessages), src/chat.ts (targetOf, withTurn, withRetry, withEdit, SpokenKind), src/routes.ts streamChat (stance/kind validation, MAX_REMEMBER_CHARS), src/types.ts (RememberStance, ThreadKind, THREAD_KINDS), src/db/schema.ts chat_threads (CHECK and chat_threads_one_remember), src/web/modes/conversation/ConversationModes.tsx, src/web/ChatPanel.tsx (stance picker), src/web/params.ts rememberParam, src/web/sub-modes.ts, src/store/export.ts.

Review it for:
1. Is the stage-2 design for removing the four stances right? In particular: keeping the column and read type, the route accepting-and-dropping a stale `stance`, and retry/edit no longer carrying a stance. Is there a simpler or safer shape? What breaks (export/import, fixtures, tests that assert stance, the help flag, the canned assistant line)?
2. Is a fourth ThreadKind `tutorial` (with a single-thread unique index) the right way to add Tutorial, versus alternatives? List every place in the code that would have to learn about it that the plan does not name — especially places that special-case "remember" with a string compare or an Extract<> and would silently treat a tutorial thread as a chat (e.g. reduce.ts, model.ts, export.ts, ChatDialog, last-view, activation, Reader, command bar, normalisers).
3. Prompt-design risks for the new Recall loop (always cite a block, two-way nudges, fill the gap when struggling, brevity) given the existing entitlement rules: e.g. does "every reply cites a block" conflict with "your own reasoning carries no block id", or does a nudge citing the answer's block give it away?
4. Prompt caching: does anything in the plan change bytes above the cache breakpoint per turn?
5. Anything that edits a security defence (docs/project/security-map.md).
6. Whether the order of stages or scope should change (e.g. something deferrable, or something the plan defers that's actually required).

Give findings ranked P0/P1/P2 with file:line evidence, and a short verdict at the end.
