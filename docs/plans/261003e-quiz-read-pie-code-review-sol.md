No P0 or P1 findings. Two P2s were fixed; two wider P2s remain unchanged.

### Findings

- **P2 — extreme shares could draw the opposite quantity.** Three-decimal rounding made shares above roughly 99.9987% produce an SVG arc whose endpoints coincided, so SVG omitted it and “nearly all” looked like none. Fixed in [SharePie.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmafmm6-quiz-read-pie/src/web/SharePie.tsx:42) by retaining six decimals. Added red-first one-in-a-million edge cases in [share-pie.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmafmm6-quiz-read-pie/tests/share-pie.test.ts:33).

- **P2 — the interaction tests covered opening only.** Added coverage in [share-pie-card.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmafmm6-quiz-read-pie/tests/share-pie-card.test.tsx:52) proving keyboard focus opens the card, Escape closes it, and an outside pointer press closes a clicked/tapped card.

- **P2 — wider shared Tooltip mixed-input edge, not changed.** If keyboard focus opens a tooltip and the mouse subsequently enters and leaves its trigger, `useHover` can close it while focus remains. It stays closed until focus cycles. This is not a stuck-open state and does not affect ordinary keyboard, mouse, or touch use, but focus-triggered content ideally persists while focus remains. Fixing it belongs in shared [Tooltip.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmafmm6-quiz-read-pie/src/web/Tooltip.tsx:268), outside the authorised files.

- **P2 — design wording overstates the rule and `ScoreBars` accessibility, not changed.** [design-css-overview.md](/home/greg/code/spideryarn2/.claude/worktrees/fbmafmm6-quiz-read-pie/docs/project/design-css-overview.md:196) first says charts are categorically “not a sentence,” despite later calling this a preference, and says both component triggers open by finger and keyboard. `ScoreBars` is deliberately not keyboard-focusable. Because this is an important entry-point rule, I left it for explicit before/after approval.

  Before: “A figure … is a small chart or an icon, not a sentence” and “a trigger a finger and the keyboard can open.”

  Proposed: “Prefer a small chart or icon for a figure the reader glances at … `SharePie` is a button because its explanation must be reachable by touch and keyboard; `ScoreBars` deliberately stays out of the tab order because its accessible name carries the same information.”

### Interaction and styling verdict

Desktop mouse clicks do not pin the card: mouseleave closes it as an ordinary non-interactive hover tooltip. That is reasonable here; touch taps persist because controlled Tooltip suppresses synthetic touch-hover events. I corrected the misleading comment in `SharePie.tsx`.

The 24px target, negative margin, baseline alignment, non-wrapping group, UA reset, semantic dark-theme tokens, and supplied desktop/phone screenshots showed no further issue.

### Checks

- Targeted Vitest command: **passed**, 3 files / 20 tests.
- `npm run typecheck`: launcher blocked before TypeScript ran because the sandbox denies `tsx`’s Unix IPC socket (`EPERM`).
- Socket-free equivalent, `node --import tsx scripts/typecheck.ts`: **passed** all four projects and coverage of all 2,784 source files.
- Biome: no errors; one existing informational `QuizPanel` complexity warning.
- `git diff --check`: passed.
- No commit made.