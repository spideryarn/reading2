Pass with one residual P3. No refusal: I found no P0 or P1 in the fixes.

### F4 — P3 — one stale count remains

[SiteFooter.tsx:164](/home/greg/code/spideryarn2/.claude/worktrees/feedback-contact-page/src/web/SiteFooter.tsx:164) still says the default `page` spacing applies to four pages. `ContactPage` is now the fifth default-variant caller, alongside Library, Profile, Privacy, and SignIn. This is the same stale-count finding, so F4 is not completely closed.

### Requested checks

1. **F1 closes the reproduced sequence.** `sentBody` captures `A`; dismissing after the edit preserves `A+B`, mints another ID, and the second POST contains `A+B` under that new ID. The test at [feedback-dialog.test.tsx:773](/home/greg/code/spideryarn2/.claude/worktrees/feedback-contact-page/tests/feedback-dialog.test.tsx:773) asserts all four facts.

2. **The guards behave correctly.** Success while open marks the thank-you seen; closing then resets exactly once. Success while closed remains on the sent stage until the reader reopens, sees it, and dismisses it. There is no loop or stale ref across reports. Writing `thanksSeen.current` inside the effect that reads it is sound: it records effect-to-effect history and does not affect rendering, so state would add no value.

3. **F2 is closed.** `discard()` advances `shotGeneration`, resets `preparing`, and stale conversions return before changing screenshot state. All picker, paste, and drop paths share `takeFile`; none has different generation semantics that the bump breaks.

4. **F3’s claims are now true.** Signed-out `/contact` returns before `FeedbackButton` is mounted, while signed-in rendering adds it. `FeedbackButton` supplies `location.href` and the article slug; `reportBody` includes both unconditionally. Passage IDs, recent requests, and their Vercel IDs come solely from diagnostics collected behind consent.

5. **The F1 and F2 tests are honest.** F1 tests the filed body, preserved draft, new ID, and second filed body directly. F2 stops at asserting that `shot` did not enter the next form, but that is the exact state subsequently serialized by `send`, so it is causal rather than adjacent.

Verification: `npx vitest run tests/feedback-dialog.test.tsx` passed, 32/32. No files changed.