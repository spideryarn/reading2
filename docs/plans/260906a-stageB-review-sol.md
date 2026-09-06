Do not approve Stage B yet. I found one P0 correctness bug and one P1 teardown bug.

### Findings

- **B-1 — P0: An abort can resolve successfully and misclassify the interrupted page as scanned.** The signal is checked before `readOnePage()`, but not after it or before returning ([src/pdf-figure-read.ts:248](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/pdf-figure-read.ts:248), [src/pdf-figure-read.ts:255](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/pdf-figure-read.ts:255)). I reproduced this five times against `harder` page 7 with aborts after 0–100 ms. pdf.js warned that the worker task was terminated, then returned empty text; `pageWords()` counted zero and recorded the page as `"scanned"` ([src/pdf-figure-read.ts:297](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/pdf-figure-read.ts:297)):

  ```json
  {"candidates":[],"skippedPages":[{"page":7,"reason":"scanned"}],"unread":[]}
  ```

  The call should have rejected with the abort reason. Check `throwIfAborted()` after every `readOnePage()`—or once immediately before the successful return—and add this real regression case before Stage C.

- **B-2 — P1: The abort handler’s first `destroy()` rejection would be unhandled.** `void loadingTask.destroy()` discards a rejecting promise ([src/pdf-figure-read.ts:239](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/pdf-figure-read.ts:239)). Catching the separate, later invocation in `finally` ([src/pdf-figure-read.ts:272](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/pdf-figure-read.ts:272)) does not handle the first promise. A teardown failure during abort can therefore become an unhandled rejection. The abort-started call needs its own rejection handler.

- **B-3 — P2: The teardown tests do not prove that cleanup failure cannot suppress destroy.** Both fake methods always resolve ([tests/pdf-figure-read.test.ts:283](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/tests/pdf-figure-read.test.ts:283), [tests/pdf-figure-read.test.ts:292](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/tests/pdf-figure-read.test.ts:292)). The tests would remain green if the two guarded calls were replaced by straight sequential awaits, reintroducing a worker leak whenever `cleanup()` rejects. The production implementation is currently correct; add a rejecting-cleanup case that still observes `destroy`.

- **B-4 — P2: The measured candidate assertions mostly pin metadata, not decoded pixels.** The shape checks pin page/key/dimensions/kind, while `classifyRaster()` on RGB establishes only valid shape and byte count ([tests/pdf-figure-read.test.ts:93](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/tests/pdf-figure-read.test.ts:93), [tests/pdf-figure-read.test.ts:108](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/tests/pdf-figure-read.test.ts:108)). Arbitrary same-length, non-zero bytes could pass every integration assertion. A digest for at least one substantial real figure would make the fixture observation complete.

### Verified sound behavior

- Ordinary success, early return, loading-task rejection, `getPage()` rejection, text-layer rejection, and operator-list rejection all reach the outer `finally`. No normal path after `getDocument()` escapes teardown.
- The object timeout is sound: successful and synchronous-error paths clear the timer; on timeout the timer has already fired, and a late callback sees `settled` and returns ([src/pdf-figure-read.ts:373](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/pdf-figure-read.ts:373)). It cannot re-settle the promise or keep the process alive.
- The caller’s bytes are copied before every path that hands data to pdf.js ([src/pdf-figure-read.ts:225](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/pdf-figure-read.ts:225), [src/pdf-figure-read.ts:228](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/pdf-figure-read.ts:228)). The real post-destroy PNG test does prove that one returned buffer remains accessible, correctly sized, and non-zero after teardown.
- Empty and whitespace-only text layers count as zero. Sideways text deliberately counts. A genuine `getTextContent()` rejection propagates and tears down; the abort-induced empty result is the B-1 exception.
- The scan-order replacement is sound for the cost claim: a sub-threshold page asserts that `getOperatorList()` is never invoked ([tests/pdf-figure-read.test.ts:389](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/tests/pdf-figure-read.test.ts:389)). Eager-starting or awaiting it before text classification would fail.
- `npx vitest run tests/pdf-figure-read.test.ts`: **20/20 passed**, 5.82s.
- No files changed.