Reviewed the touch sequence, gutter stacking, BlockLinkCard provenance/listeners, and measuring-copy markup. No production-code defect found; only test coverage needed fixing. No commit made.

Checks:

- Focused Vitest suite: 146/146 passed.
- Typecheck: all four projects passed; all 2,775 files covered. The npm wrapper hit a sandbox IPC restriction, so I ran its underlying script directly.
- `git diff --check`: passed.

1. **P2** — Structure’s tests omitted touch hover/lift events, compatibility mouse events, and delayed tooltip teardown, so they could miss an iPad-only self-close or incorrect second tap. Evidence: [structure-card-opens.test.tsx:269](/home/greg/code/spideryarn2/.claude/worktrees/fba868zs-tap-opens-rich-tooltips/tests/structure-card-opens.test.tsx:269), [outline-panel.test.tsx:647](/home/greg/code/spideryarn2/.claude/worktrees/fba868zs-tap-opens-rich-tooltips/tests/outline-panel.test.tsx:647). **FIXED** by replaying the complete sequence and waiting beyond the delay-group timeout.

2. **P2** — The reading-time test omitted `pointerleave` and compatibility mouse events, despite claiming to cover the complete iPad sequence. Evidence: [reading-time-card.test.tsx:245](/home/greg/code/spideryarn2/.claude/worktrees/fba868zs-tap-opens-rich-tooltips/tests/reading-time-card.test.tsx:245). **FIXED** by adding the missing events before the mouse-labelled click.

Verdict: Approved after test hardening; no production-code findings.