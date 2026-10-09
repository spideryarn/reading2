Four findings fixed; changes are uncommitted.

- **C1 — P1 — [useDictation.ts:1899](/var/tmp/spideryarn-worktrees/qi-cfrv4spd-dictation-lands-in-next-box/src/web/useDictation.ts:1899):** A successful retry refused after navigation lacked `moved`, so a new press could erase its only copy. Added the marker.
- **C2 — P2 — [useDictationField.ts:399](/var/tmp/spideryarn-worktrees/qi-cfrv4spd-dictation-lands-in-next-box/src/web/useDictationField.ts:399):** A refused press reset the insertion proof and stole focus. The hook now reports refusal; the field returns before changing its state or focus.
- **C3 — P2 — [useDictation.ts:1958](/var/tmp/spideryarn-worktrees/qi-cfrv4spd-dictation-lands-in-next-box/src/web/useDictation.ts:1958):** Blocked recovery stayed invisible until navigation/remount. Recovery now waits while busy and runs again when the dictation and offer are settled.
- **C4 — P2 — [useDictation.ts:169](/var/tmp/spideryarn-worktrees/qi-cfrv4spd-dictation-lands-in-next-box/src/web/useDictation.ts:169):** The sentence implied Save unblocked dictation, although it only downloads. Corrected it to explain discarding after saving.
- **C5 — P1, wider, unchanged — [ChatPanel.tsx:3047](/var/tmp/spideryarn-worktrees/qi-cfrv4spd-dictation-lands-in-next-box/src/web/ChatPanel.tsx:3047):** Chat recovery still combines conversations within an article. This is the plan’s acknowledged deferral.

No destructive `keptNow` window was verified through normal clicks. The moved ending’s completion, artifact bookkeeping and device-copy handling check out. The strip retains Try again, Save and Discard.

Each fix has a regression test seen red beforehand. Final focused checks: **647 tests passed across 21 files**. All TypeScript projects passed via `node --import tsx scripts/typecheck.ts`; the npm wrapper hit sandbox IPC restrictions. Full `npm test` was blocked by unavailable Postgres/Docker. Scoped lint passed with existing advisories.

Added a [postmortem](/var/tmp/spideryarn-worktrees/qi-cfrv4spd-dictation-lands-in-next-box/docs/postmortems/261009a-a-refused-transition-must-preserve-state-at-every-entry-point.md).