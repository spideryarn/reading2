1. **CR1 — P1: hidden experimental modes could become runnable model-proposed buttons.** `visibleModes` deliberately retains an already-open experimental mode as an escape hatch. That accidentally admitted hostile tokens such as Timeline—and retained experimental sub-modes—into Chat’s live allowlist while experiments were off. The red test rendered an enabled “Open Timeline” button. I explicitly remove experimental targets from the proposal set when the switch is off, while preserving the Dock escape hatch. Tests now cover ordinary Reader→Dock activation and both hidden cases. [Reader.tsx](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/reader/Reader.tsx:2692) [mode-herald-wiring.test.tsx](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/tests/mode-herald-wiring.test.tsx:388) [chat-tools.md](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/docs/project/chat-tools.md:886)

2. **CR2 — P2: a mode change during guide-id reconciliation left Chat pointing at a vanished optimistic thread.** If the band unmounted before the server folded a new guide into the stored singleton, returning to Chat retained the provisional id instead of opening the stored guide. The red test received the old id rather than `spya-gdsrv9`. I made reconciliation use the durable guide identity, and made that identity move or clear with its draft conversation. [ConversationModes.tsx](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/modes/conversation/ConversationModes.tsx:657) [chat-draft.ts](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/chat-draft.ts:134) [guide-in-chat-band.test.tsx](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/tests/guide-in-chat-band.test.tsx:379)

3. **CR3 — P2: the greeting asked for a reading reason that was already stored.** It displayed “Tell me why you’re reading it” beside the ready-to-send start button. I made the lead adapt to stored, missing, and unavailable purpose state, with red-first coverage. [GuideGreeting.tsx](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/GuideGreeting.tsx:79) [guide-in-chat-panel.test.tsx](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/tests/guide-in-chat-panel.test.tsx:201)

4. **CR4 — P3: the `?guide=1` documentation overstated URL atomicity and its behavior outside Chat.** The implementation performs replacement updates separately, and retains the flag until Chat can act on it. I corrected the source comments and `url-state.md`; the command-button documentation now also records the experimental escape-hatch exclusion. [params.ts](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/params.ts:352) [url-state.md](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/docs/project/url-state.md:76)

Verification:

- 220 scoped tests across 13 files passed.
- All four TypeScript projects passed direct `tsc --noEmit`.
- Biome lint exited 0; `git diff --check` passed.
- The full suite could not start because the local database was unavailable and Docker port discovery was denied by the sandbox. The requested touched tests all ran.
- No commit or production database operation was made.

**Verdict: land with my fixes.**