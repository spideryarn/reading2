# The live stall tick outlived the test that started it

Up: [postmortems.md](../project/postmortems.md)

The readiness run on `70156e45` passed every one of 43,255 tests and still failed. One unhandled
error did it:

```
ReferenceError: window is not defined
 ❯ resolveUpdatePriority  node_modules/react-dom/cjs/react-dom-client.development.js:1308
 ❯ dispatchSetState …
 ❯ Timeout._onTimeout     src/web/live/useLiveConversation.ts:728   (checkStall's setStall)
This error originated in "tests/live-session-flow.test.tsx"
```

**The class is a test harness that mounts and leaves the unmount to each test.** The hook was
right: its stall tick (`setInterval(checkStall, STALL_TICK_MS)`, one second, while `live`) is
cleared by its own effect cleanup. But `mount()` in `tests/live-session-flow.test.tsx` handed back
an `unmount` and nothing called it if the test did not, and **27 of 107 tests did not**. Those
hooks stayed mounted; any left live kept ticking on a bare Node timer. jsdom's teardown removes
`window` and stops jsdom's own timers but not Node's, and React's `dispatchSetState` reads
`window.event` even for a root that will never render again. A tick landing after teardown is the error. It depends on
timing, which is why it showed up only under the full suite's load.

Introduced by `dff07ebb3` (2026-09-15), which added the one-second stall tick. The leaked mounts
are older. The older ten-second session-cap tick only sets state when a minutes-long cap is reached;
the stall tick calls `setStall` every second, making the leaked mounts surface much sooner.

**Reproduced** against the old file by deleting `globalThis.window` in an `afterAll` and waiting
2.5 s to simulate a timer firing after environment teardown. That gave 24 unhandled errors, with
the readiness log's exact stack. The fixed file under the same probe gives none.

**Fix:** `mount()` registers each hook's unmount in a set, and `afterEach` unmounts whatever is
left. The harness owns the lifetime, so a test that forgets, or fails before its last line, cannot
leak a timer.

## Siblings

Swept every `createRoot` in `tests/` and every `setTimeout`/`setInterval` in `src/web/`. Fixed:

- **`src/web/useDebateChecks.ts` `waitForStoredCheck`** was a real leak in the app, not only in
  tests. After a broken answer stream it polled every 15 s until the check settled or the slug
  changed, and an unmount changed neither. Unmounting now clears `current`, which every late
  answer already checks. Covered by a new test in `tests/use-debate-checks.test.tsx`: without the
  fix, six total API calls instead of three — three extra recovery reads after unmount. With the
  fix, no reads after unmount. The tests also cover StrictMode effect replay and a slug change
  with an old read still in flight.
- **`tests/dictation-keep-hook.test.tsx`** was the same harness shape, with 21 of 25 tests never
  unmounting and two left recording. It gets the same `mounted` set.

Checked and left alone:

- **Inline-unmount files.** dictation-segments, dictation-phases, experimental-store, live-mic-lock,
  fold, fold-front-matter, prefetch-article, shelf-phone-hint and appearance unmount inline, so
  they leak only when a test is already failing.
- **Fake-timer files.** Scheduled fake timers do not fire after `useRealTimers()`. That alone
  does not prove cleanup: an asynchronous continuation can still schedule a new real timer.
- **`useDictationField`'s `againTimer`.** Flagged by the sweep, but `useEffect(() => closeAgain,
  …)` already clears it.

Every other interval in `src/web/` is cleared in its effect's cleanup.

**What would have caught the class, ranked by ease against value:**

1. **Register unmounts in the harness for `afterEach`.** Done for these two harnesses, before
   rendering so a render failure cannot skip registration. Unmount also removes the host element.
   There is no `@testing-library/react` here to do this automatically.
2. **Exercise StrictMode replay and navigation during asynchronous work.** Done for Debate:
   resetting the article ref on effect setup, before the initial refresh effect, keeps both paths
   working while cleanup invalidates late answers.
3. **Use `window` timers as a teardown defence.** Rejected as the fix: jsdom's `window.close()`
   would stop those timers, but it would leave the roots and other hook resources mounted.
