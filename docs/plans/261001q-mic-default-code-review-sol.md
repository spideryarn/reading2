Review complete. No P0 findings. I fixed two P1s and two P2s; nothing was committed.

### P1

1. Stopping during `enumerateDevices()` could release the mic lock, then let the stale dictation open a microphone afterward.

   Fixed in [useDictation.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbg8byyd-mic-default/src/web/useDictation.ts:2152) with ownership checks after the recognition probe and every new enumeration boundary. Added red-then-green lock regressions for both normal and chosen-device fallback paths. Live’s existing stale check was correct; its fallback now also avoids leaking a resolved stale stream or publishing stale notice state.

2. A missing chosen microphone still fell back to `{audio:true}` while Live claimed it was using the system default. On Chromium that can be Chrome’s own choice.

   Both capture paths now try:

   `chosen device → exact "default" → unconstrained only if "default" also disappeared`

   Every actual request goes through `audioConstraint`. Live says “another microphone” if both exact IDs vanished rather than falsely claiming the system default. The shared `deviceMissing` path is tested with a non-`DOMException` rejection.

### P2

1. `(your choice)` and both pickers could reflect mount-time state after the other microphone surface changed the shared preference.

   Dictation now snapshots the current preference when each press starts; Live refreshes it when connecting. The unavailable fallback omits `(your choice)`, while same-device ID adoption and mid-dictation changes retain it correctly.

2. `honoured` started as `true` whenever no explicit preference existed, even when exact `"default"` failed and capture fell back.

   It now starts false and becomes true only when the primary request actually returns a track.

No WebKit/iOS activation regression was evident: pre-permission enumeration exposes blank IDs and therefore retains unconstrained capture, while `getUserMedia` does not have `getDisplayMedia`’s transient-activation requirement. This is a code/API conclusion, not a real-iPhone verification. [Media Capture specification](https://www.w3.org/TR/mediacapture-streams/), [WebKit’s async-gesture report](https://bugs.webkit.org/show_bug.cgi?id=198040).

### Wider P2 for you to decide

[src/web/live/mic-placement.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbg8byyd-mic-default/src/web/live/mic-placement.ts:13) still says `mic-devices.ts` refuses to prefer `"default"`. That comment is now false, but the file was outside the allowed edit scope.

Verification:

- Requested seven Vitest files: **200 tests passed**
- Typechecking: **all 2,588 source files covered and passed**
- `npm run typecheck` itself could not start because the sandbox denied tsx’s `/tmp/tsx-1000/*.pipe`; running the same script via `node --import tsx scripts/typecheck.ts` passed.
- Focused lint: no errors; only existing complexity advice and the existing `boolean | void` warning.