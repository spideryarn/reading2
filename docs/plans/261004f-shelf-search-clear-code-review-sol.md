1. **P1 — broken spacing utilities. Fixed.** `tw:pr-11tw:text-sm` generated neither utility. Also, `pr-11`/`right-1.5` shrink at the supported 12px root, allowing text under the fixed-size target. [Library.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbwzmvva-shelf-search-clear/src/web/Library.tsx:1228) now uses fixed 44px padding and 6px inset. Production CSS confirms 32px box, 18px glyph, 40px coarse target, with no sizing utility override.

2. **P2 — stale and over-broad pointer state. Fixed.** Only touch and pen suppress focus; mouse, unknown pointers, keyboard, voice, and assistive activation restore it. Keyboard-like clicks override abandoned touch state, and `pointercancel` clears it. Tests model iOS’s mouse-labelled click and the stale-touch case.

3. **P3 — test blind spots. Fixed.** [shelf-search-clear.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbwzmvva-shelf-search-clear/tests/shelf-search-clear.test.tsx:178) now verifies the exact padding/inset classes, preserves `text-sm`, and catches variant-prefixed sizing utilities. Its `.own-clear` assertion and exact CSS rule check bind the input to the rule. The 350ms wait is sound: the 200ms debounce is scheduled first, so machine load delays both without reversing them.

4. **P3 — inaccurate wording. Fixed.** Removed the unsupported claim that Greg failed to find the existing glyph, documented pen behavior, updated the stale-state plan note, and kept Greg’s only words exact and blockquoted.

Escape works without changing Enter’s blur behavior. `tests/close-cross.test.ts` still accurately guards the enumerated modal/panel closes; the shelf test separately owns the non-modal consumer’s cascade checks.

Verification: requested Vitest run passed, 31/31; documentation tests passed, 16/16; production CSS build passed; lint has no errors. The exact `npm run typecheck` launcher was blocked by sandbox IPC, but the same script via `node --import tsx scripts/typecheck.ts` passed all projects and covered all 2,977 source files. Full `npm test` could not reach the sandbox-blocked Postgres/Docker service.

VERDICT: ship after the fixes I made