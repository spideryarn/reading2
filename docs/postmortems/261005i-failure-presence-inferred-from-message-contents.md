# Failure presence inferred from message contents

Found in the quiet autosave review, 2026-10-05. Parent: [postmortems.md](../project/postmortems.md).

The shared hook treated a truthy message as evidence of failure and assumed every rejected value
was an `Error`. A rejection with `Error("")` therefore left unsaved words in `dirty`; a rejection
with `null` or `undefined` threw inside the catch. The quiet status line then read *Saves as you
type.* rather than reporting failure. The class is **failure presence inferred from message
contents**: optional presentation text was doing the job of a state discriminant.

Introduced by `bc4ac3f2d241e99da93092486ab81e0079855c80` (the original autosave hook,
2026-10-01). The quiet UI exposed the consequence but did not introduce the predicate. Existing
tests rejected only with nonempty `Error` messages, sharing the assumption being tested.

The narrow fix in [`useAutosavedText.ts`](../../src/web/useAutosavedText.ts) tests failure presence
against `null`, catches `unknown`, and supplies a nonempty fallback. This is sufficient for this
nullable string representation; a future failure record should keep its existence independent of
its optional message. Stale-draft failures still let newer words save normally.

Four regressions in [`autosaved-text.test.tsx`](../../tests/autosaved-text.test.tsx) rejected with an
empty-message Error, a string, undefined and null. Before the fix: **4 failed, 23 passed**, all four
returning `dirty` instead of `error`, plus two unhandled rejections. After: **27 passed**. The tests
also check the visible failure sentence and retention of the draft and stored value.

Countermeasures, ranked by ease against value:

1. **Adversarial rejection values at the async boundary** — implemented above; cheap, and catches
   the shared assumption rather than just one server error sentence.
2. **Explicit presence predicates** — implemented in the hook; failure payload contents cannot
   decide whether a request succeeded.
3. **A whole-repo failure-state migration** — rejected for this review: the sibling add-purpose
   session already checks against null and preserves a visible failure. Reworking unrelated request
   handling would widen the change without strengthening this boundary.

Departure writes and failures after a box has gone remain best effort; this fix concerns the
mounted box's ordinary save and does not claim delivery on page exit.
