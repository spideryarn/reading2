## Findings

- **CR-1 — P1 — mixed citation collisions lost model text**  
  [citations.ts:246](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/src/web/citations.ts:246)  
  **FIXED with test.** If one bracket contained both an ambiguous ID and a usable ID, the ambiguous ID disappeared. The whole bracket now remains plain text whenever any ID collides. Covered at [chat-mention-citations.test.ts:71](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/tests/chat-mention-citations.test.ts:71).

- **CR-2 — P1 — touch selection could lose the picker row to blur**  
  [MentionPicker.tsx:248](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/src/web/MentionPicker.tsx:248)  
  **FIXED with test.** Rows now pick on `pointerdown`, before touch/mouse/pen focus changes can close the list. Covered at [chat-mention-picker.test.tsx:185](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/tests/chat-mention-picker.test.tsx:185).

- **CR-3 — P1 — first-question refusal lost mention chips and submitted draft**  
  [ChatPanel.tsx:3376](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/src/web/ChatPanel.tsx:3376), [controller.ts:379](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/src/web/chat/controller.ts:379), [ConversationModes.tsx:1303](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/src/web/modes/conversation/ConversationModes.tsx:1303)  
  **FIXED with tests.** Mentioned first questions now remain in their composer until `begin`. A pre-stream refusal restores the exact submitted draft and retains its chips without overwriting a newer draft. Unknown disconnect outcomes are deliberately not made immediately resendable. Dialog-originated first questions follow the same rule.

No wider findings to report.

Security checks confirmed that cross-article links use the server-provided slug, never answer/title text; unavailable mentions produce no links; and all collision cases remain plain text. Keyboard, IME, retry/edit, state switching, ARIA, token/dark-mode, and 390px checks passed.

Verification:

- Final client regression: **75 files, 1,098 tests passed**
- Focused mention suites: **30 tests passed**
- CSS/palette/touch safeguards: **237 tests passed**
- All four TypeScript projects passed directly
- Lint exited successfully with informational existing complexity notices only
- `git diff --check` passed
- No commit made

APPROVE WITH FIXES APPLIED