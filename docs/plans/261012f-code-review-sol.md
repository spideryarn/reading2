## Findings

F1 — Medium — The *Ask in Chat* button could mint two chats if activated twice before navigation rendered. A synchronous latch now permits one activation, immediately disables the button, and has a regression test. [GuideNextSteps.tsx](/var/tmp/spideryarn-worktrees/fbes283p-guide-hands-off-to-chat/src/web/GuideNextSteps.tsx:243)

F2 — Medium — The final per-turn prompt still said “under 100 words,” contradicting the new 60-word limit. Corrected it and added a prompt test. The evals used that stale reminder, so I also corrected the investigation: results remain conservative evidence, but are not a byte-for-byte evaluation of the final prompt. [converse.ts](/var/tmp/spideryarn-worktrees/fbes283p-guide-hands-off-to-chat/src/converse.ts:2479), [investigation](/var/tmp/spideryarn-worktrees/fbes283p-guide-hands-off-to-chat/docs/investigations/261012a-guide-hands-off-to-chat-and-shorter-measured.md:19)

F3 — Low — An unbroken question up to the allowed 160 characters could overflow a narrow band. Added `min-width: 0` and `overflow-wrap: anywhere`, plus disabled-state styling. [chat-actions.css](/var/tmp/spideryarn-worktrees/fbes283p-guide-hands-off-to-chat/src/web/styles/chat-actions.css:94)

F4 — Low — An exact duplicate `chat` step was silently removed before the at-most-one check, contrary to the promise to report dropped chat steps. Reordered the checks and added coverage. Invalid and duplicate steps still do not consume the three-step cap. [next-steps.ts](/var/tmp/spideryarn-worktrees/fbes283p-guide-hands-off-to-chat/src/next-steps.ts:112)

F5 — Low — The guide documentation retained the old 100-word and three-passage limits. Updated it to 60 words and at most two passages. [chat-tools.md](/var/tmp/spideryarn-worktrees/fbes283p-guide-hands-off-to-chat/docs/project/chat-tools.md:1117)

F6 — Info — No further wiring, cascade, accessibility, or security defect found. `onChatNew` is supplied only for a guide, `onSendNew` mints the band’s `chat` kind with no `typed`, steps disappear while the guide is answering, draw order and keys are stable, the fieldset is named by its visible legend, and styling is guide-scoped with valid light/dark tokens. The `security-map.md` description is accurate.

F7 — Info — Most feature tests fail without the change. The band test alone exercises pre-existing `onSendNew` behavior and would pass, but its paired real-panel test fails without the new wiring. Added regressions for double activation, narrow wrapping, duplicate-chat reporting, and the stale prompt; each was observed failing before its fix.

Checks:

- Focused Vitest suite: 6 files, 139 tests passed.
- Typecheck: all four projects passed; all 3,735 source files covered.
- `npm run typecheck` was attempted but the sandbox denied `tsx`’s IPC socket. Running the same wrapper as `node --import tsx scripts/typecheck.ts` passed.
- `git diff --check` passed.
- No commit made.

LAND WITH FIXES