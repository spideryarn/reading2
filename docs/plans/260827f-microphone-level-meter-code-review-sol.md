The implementation is not safe to ship yet. Four blockers remain.

1. **Blocker — Stop can commit before the final dictated text arrives.** [`useDictation.ts:237`](../../src/web/useDictation.ts) calls `settle()`—and therefore `onEnd`/`onCommit`—before `r.stop()`. The unguarded [`onresult`](../../src/web/useDictation.ts) can then append the final result after the only commit. Change stop to mark the session stop-requested, call `r.stop()`, continue accepting that recogniser’s results, and finalize exactly once from `onend` (with an immediate fallback if `stop()` throws).

2. **Blocker — Recognition identity is being used for two different questions, and stale errors can terminate a new session.** A queued non-`aborted` error from old recogniser A after recogniser B starts passes through [`onerror`](../../src/web/useDictation.ts), clears B, and settles B. The same unguarded handler can set state after unmount. Add `if (recognition.current !== r) return` to both `onerror` and `onresult`; track “we requested stop/abort” explicitly per session rather than inferring it from identity.

3. **Blocker — The two ProfileBoxes fight, and rapid stop/start can strand even one box.** Every hook instance may open its own track and recogniser. Furthermore, [`settle()` suspends the module-wide context`](../../src/web/useDictation.ts) without ownership accounting:

   - Stopping A suspends B’s live analyser.
   - A pending `suspend()` can complete after B’s `audio()` saw `running`, leaving B suspended permanently.
   - Two active boxes violate the one-capture premise page-wide.

   Add a page-wide exclusive dictation owner so starting one box first terminates the other. Do not suspend the shared context per session; stopping the track and disconnecting its graph is sufficient. Alternatively, serialize suspension with a reference-counted lease, but exclusivity is simpler and matches the UI.

4. **Blocker — The wrong-positive feature-detection argument is unsound.** The comments themselves acknowledge that an implementation without the overload may ignore extra arguments, yet [`beginCapture()` assumes failure will be a `TypeError`](../../src/web/useDictation.ts). A wrong-positive browser can therefore accept `start(track)`, ignore the track, and open its own capture while yours remains live—the exact concurrent-capture failure being avoided. Make RMS capture opt-in only for an explicitly verified browser capability/release set, defaulting to binary detection everywhere else. `processLocally` is not a capability test for this overload.

5. **Should-fix — `InvalidStateError` can leave “Opening…” forever.** Chrome’s ended-track case produces precisely this exception, but [`beginCapture()` returns `abandoned`](../../src/web/useDictation.ts), after which the caller does nothing. A newly constructed recogniser cannot legitimately be “already running.” Treat this as failure, or stop the ended track and retry `start()` without it before returning `started`.

6. **Should-fix — An analyser can outlive an externally ended track indefinitely.** [`useAudioLevel`](../../src/web/useAudioLevel.ts) stops measuring but continues its rAF and retains both nodes until React receives a different track or unmounts. Install an `ended` listener owned by `useDictation` that terminates the session and clears the track; defensively cancel/disconnect the meter graph on `ended` as well.

7. **Should-fix — `onEnd` is at-most-once, not exactly-once.** The `was` gate prevents duplicates, but unmount disarms without calling it, while stale events can currently finalize the wrong session. If navigation must save confirmed text, commit before removal at the owning route level; do not casually invoke `onCommit` from the hook’s unmount cleanup. Document the callback as “once per mounted terminal session” unless navigation persistence is added.

8. **Should-fix — The binary fallback overstates what was measured.** The same weighted “level” bars imply amplitude, while `soundstart` supplies only yes/no activity; the 180 ms transition even draws intermediate magnitudes never observed. Use a visibly binary indicator—such as a dot plus “Sound detected”—or make all bars switch uniformly. Keep the waveform-shaped meter for RMS only.

9. **Should-fix — Meter release speed depends on display refresh rate.** Smoothing happens on every analyser rAF, so a 120 Hz iPad decays roughly twice as fast as a 60 Hz display even though DOM writes are capped. Make smoothing elapsed-time-based or sample/smooth at a fixed frequency, then test 8 ms and 16 ms frame schedules.

10. **Should-fix — The important lifecycle remains untested.** All 39 named tests pass, but there are no `useDictation` lifecycle tests. Add deterministic cases for stop→final-result→end ordering, stale results/errors after replacement and unmount, two hook instances, pending suspend/resume, late `getUserMedia`, ignored extra arguments, ended-track `InvalidStateError`, Safari restart failure, and exact finalization count. Also make the rAF fake genuinely cancel callbacks; the current no-op cancellation cannot prove loop teardown.

11. **Nit — Safari creates an AudioContext it never uses.** Gate `audio()` on the measured-track capability before creating/resuming it. Safari’s intended `owned === null → start()` restart branch itself is correct.

I found no defect in `MicLevel`’s `[level]` effect turnover: cleanup cancels the old loop and the new ref is written on the next eligible frame. The CSS calculation is dimensionally correct, and React’s constant inline `--level: 0` will not ordinarily overwrite direct mutations on rerender because the virtual value remains unchanged; the duplicate CSS/inline initialization is merely redundant.