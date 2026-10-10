C1 — P2 — [useLive.ts:75](/var/tmp/spideryarn-worktrees/fbt858ug-live-default-engine/src/web/live/useLive.ts:75): cross-engine Reconnect did not expose its pending restart, so the status panel could not offer **Cancel reconnect**. Added rendered pending state with cancellation coverage.

C2 — P3 — [LiveButton.tsx:96](/var/tmp/spideryarn-worktrees/fbt858ug-live-default-engine/src/web/live/LiveButton.tsx:96): pointer selection returned focus to the arrow, trapping reading shortcuts. Pointer choices now suppress focus return; keyboard choices still return focus.

C3 — P3 — [LiveButton.tsx:98](/var/tmp/spideryarn-worktrees/fbt858ug-live-default-engine/src/web/live/LiveButton.tsx:98): controlled menu state could open or remain open after the control became busy. Open-state changes are now refused while busy, and an open menu closes when a call begins.

C4 — P3 — [mode-band.css:1493](/var/tmp/spideryarn-worktrees/fbt858ug-live-default-engine/src/web/styles/mode-band.css:1493): the active arrow only gained an orange border and remained dimmed, contradicting the intended single lit control. It now shares the Live button’s active background and foreground without disabled opacity.

C5 — P3 — [privacy-page.test.ts:105](/var/tmp/spideryarn-worktrees/fbt858ug-live-default-engine/tests/privacy-page.test.ts:105): the extraction regex was not actually line-anchored, and four names anywhere could satisfy the test. It now verifies the exact four declarations and the complete paired-engine disclosure.

C6 — P3 — [gpt-live-engine.test.tsx:395](/var/tmp/spideryarn-worktrees/fbt858ug-live-default-engine/tests/gpt-live-engine.test.tsx:395): added missing assertions for Reconnect cancellation state, Enter/Space/ArrowDown, keyboard and pointer focus behavior, and a genuinely closed disabled menu.

C7 — P3, left unchanged — [LiveStatus.tsx:229](/var/tmp/spideryarn-worktrees/fbt858ug-live-default-engine/src/web/live/LiveStatus.tsx:229): Realtime briefly has `placement === null` while connecting, but resolves it before requesting its ticket; the setting is disabled during that interval. Added transition coverage in [chat-live-handoff.test.tsx:443](/var/tmp/spideryarn-worktrees/fbt858ug-live-default-engine/tests/chat-live-handoff.test.tsx:443).

The effective-engine, loading-window, switch-off, lingers, privacy wording, split geometry, coarse width, and composer-height rules are otherwise correct. The stale-wording sweep found only explicitly dated historical statements. Nothing wider needs an author decision.

Checks:

- Requested Vitest command: 4 files, 133 tests passed.
- `npm run typecheck`: sandbox blocked `tsx`’s IPC socket before TypeScript ran. The identical checker via `node --import tsx scripts/typecheck.ts` passed all four projects and covered all 3,624 source files.
- Scoped lint: no errors; existing advisory complexity/specificity messages only.
- Additional full `npm test`: unavailable because the sandbox cannot reach the local Postgres/Docker service.

APPROVE WITH FIXES