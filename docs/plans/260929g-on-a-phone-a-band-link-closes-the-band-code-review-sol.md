1. **must-fix — fixed** — [Reader.tsx:485](/home/greg/code/spideryarn2/.claude/worktrees/phone-link-closes-band/src/web/reader/Reader.tsx:485): Trajectory’s separate `onAway` path skipped focus capture, leaving focus inside its hidden band. Fixed by sharing the focus handoff and preserving it across further route steps. Red-first test: `moves focus to the pill and back when a focused stop steps the band aside`.

2. **must-fix — fixed** — [Reader.tsx:500](/home/greg/code/spideryarn2/.claude/worktrees/phone-link-closes-band/src/web/reader/Reader.tsx:500): restoration watched `bandAway`, not whether the band was actually hidden. Widening the window unmounted the pill and lost focus. Fixed by keying restoration to `bandAway && bandCovers`. Red-first test: `restores focus when a resize makes the stepped-aside band visible again`.

The remaining audit was clean: automatic Ideas/Timeline jumps remain press-armed, Trajectory opening retains raw `jumpTo`, non-band callers remain raw, Diagram’s follow/activation split is correct, and the chip retains `.return-chip` for Dock/offline-strip spacing.

Checks:

- Focused Vitest: 24/24 passed.
- Lint: only the existing Reader complexity advisories.
- `npm run typecheck`: exit 1 before TypeScript because the sandbox denied `tsx`’s IPC socket.
- Equivalent no-IPC invocation: exit 0; all 2,342 source files covered.
- No commit made.

Verdict: two focus defects fixed; the reviewed change is otherwise sound.