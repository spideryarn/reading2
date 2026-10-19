1. **Medium — `src/web/useDictation.ts:1169` — fixed.** A track ending in the
   first 600 ms reported the specific `[mic-unplugged]`, then the early-started
   tape settled as too short and `nothingKept` replaced it with `[mic-empty]`.
   `setError` now keeps a synchronous `shownError` alongside React state, and
   the empty-ending fallback speaks only when no earlier error has explained the
   ending. `tests/dictation-phases.test.ts:1464` was added first and failed with
   `[mic-empty]` before the fix; it passes afterwards. An ordinary accidental
   start-and-stop still reports `[mic-empty]`, pinned at
   `tests/dictation-phases.test.ts:1483`.

2. **Low — `tools/fleet/web/src/DictationControl.tsx:187` — fixed.** The fleet
   uses the same hook but retained *“Opening the microphone…”* while the product
   strip now gives the necessary instruction, *“Wait — opening the
   microphone…”*. The copy and its explanation now match, with the rendering
   assertion updated at `tests/fleet-dictation-control.test.tsx:205`.

3. **Low — `src/web/useDictation.ts:1748` — fixed.** The non-honoured remembered
   device path really did show `listening` without its microphone line until
   `listInputs()` settled. Recording was safe, so this was acceptable as a
   transient correctness state, but the gap was avoidable: the opened track's
   label is already known. `setDeviceLabel(opened)` now runs before the device
   list await; only the chosen-device verdict waits. The held-enumeration test
   asserts the label at `tests/dictation-phases.test.ts:651`.

4. **Low — `src/web/DictationStrip.tsx:297` and
   `docs/project/reader-profile.md:751` — fixed.** Comments and reference prose
   still said orange/listening began at `audiostart`, and one test described an
   impossible recogniser signal before a track existed. They now state the
   Stage 1 contract: `opening` ends when the track is owned, while `audiostart`
   affects live words only. The `liveGaveUp` comment was also corrected at
   `src/web/useDictation.ts:510`; its flag distinguishes “recogniser died” from
   Safari/Firefox's “no recogniser”, not the old pre-`audiostart` phase.

5. **Info — `src/web/useDictation.ts:1678` and `src/web/useDictation.ts:1711` —
   checked, no further change.** The earlier tape stays inside the microphone
   claim. Stop while waiting for the lock or `getUserMedia` still has no track
   to record; once capture returns, track, meter, ended listener, timer, phase,
   tape and cap deadline are established before the `listInputs()` await. Stop
   from there drains the tape before stopping the track and releasing the claim.
   The focused suite also covers the keeper/IndexedDB copy, cap and `endsAt`, the
   quiet warning, double-Stop through the real `useDictationField`, and Live's
   microphone lock.

6. **Info — `src/web/useDictation.ts:1458` — checked, no further change.** No
   production state is now set from `onaudiostart`. A late event therefore
   cannot regress Stop; recogniser restart leaves the tape and phase alone, and
   `liveGaveUp`'s remaining `armTape` is idempotent (one recorder is asserted at
   `tests/dictation-phases.test.ts:1299`). The fleet consumes the same corrected
   state. No Stage 2 recorder, preview request or preview UI was introduced, and
   there is no wider finding left for a product decision.

Tests: the requested focused Vitest command passed **34 files / 553 tests**;
after writing this review file, the doc-link suite was rerun and passed **18/18**.
`npm run typecheck` could not start under this review sandbox because `tsx`
received `listen EPERM` for `/tmp/tsx-1000/14.pipe`; running the identical driver
without its IPC wrapper (`node --import tsx scripts/typecheck.ts`) passed all
four TypeScript projects and confirmed coverage of **3,847 source files**.

**Verdict: Stage 1 is ready after the fixes above; Stage 2 remains unbuilt.**
