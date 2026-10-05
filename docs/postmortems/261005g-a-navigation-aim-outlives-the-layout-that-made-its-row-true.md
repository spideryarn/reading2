# A navigation aim outlives the layout that made its row true

Up: [postmortems.md](../project/postmortems.md).

Found in the 2026-10-05 review of [plan 261005h](../plans/261005h-three-robustness-bugs-unknown-wire-values-rootless-children-list-chain-timer.md), before approval to ship. Controlled tests reproduced stale steps after a completed jump; this review did not establish browser frequency or reader impact.

## What happened

Commit `9b71c5b54` replaced the navigation chain's 600 ms expiry with a completion fact. Its intent was sound: a delayed animation frame must not make a second press measure halfway through the first jump. The new settled-chain predicate, however, was only:

```ts
window.scrollY === chain.endedAtY
```

That offset can remain unchanged while rows move. Reader's `layoutKey` already names width, spine, Marginalia and chrome changes that rewrap or shift rows; `fold.ts` likewise provides a subscription because folding can move rows without scrolling. The arrow hook does not restart for every layout change. Diagram additionally kept a numeric row aim when its block mapping changed.

In the new fixed-offset cases in [step-chain.test.tsx](../../tests/step-chain.test.tsx), the first press targeted `spya-c2`. After settlement, the row rectangles changed while `scrollY` stayed constant. The next press should have measured row 7 and targeted `spya-c8`; both callers instead produced `[spya-c2, spya-c3]`. The Diagram case explicitly clears the old centred arrival, as Reader does when layout changes. A separate case replaces the block order while preserving the target's rectangle.

## The class: a validity predicate omits layout and row identity

The cache stores a position in a rendered article, but its validity predicate checks only the viewport offset. Removing expiry gives that incomplete predicate unlimited authority. A row number also depends on the current block order: an unchanged number can name a different stable block.

The original tests varied time, animation progress, touch cancellation and scroll offset while keeping the rows and their order fixed. Those tests proved the new completion rule under that assumption; they could not prove that an unchanged offset meant an unchanged reading position. Typechecking cannot establish that relationship either.

`git log -S endedAtY` and blame identify `9b71c5b54` as the introducing commit. Its message explicitly describes keeping the aim for as long as the page remains at the ending pixel.

## What would have caught it, ranked by ease against value

1. **Vary geometry independently of scroll offset in cache tests.** Cheap, and added in this review: finish the movement, change the rows, keep the offset, and assert the next destination. Replace row order separately, because geometry alone does not prove identity.
2. **Audit each cached position's validity inputs.** Low effort: ask which layout and identity changes can invalidate a remembered answer, rather than treating a scroll event as the complete list of changes. Here the existing layout-key and fold subscriptions already supplied counterexamples.
3. **A new expiry timer: rejected.** It bounds the stale period but accepts wrong steps inside it, and reintroduces the frame-versus-clock defect this stage fixes.
4. **Observers on every row or layout measurements on every render: rejected.** They impose recurring work on long articles. A targeted check when stepping, plus the Diagram's existing sampler, addresses this cache without another observation system.

## The fix that is right for the long term

Preserve the unfinished aim, including reduced-motion corrective frames. At completion, record the stable target, its element and rectangle, and the reading line. Before a later press trusts a settled aim, check that snapshot as well as the ending offset; otherwise measure again. This keeps the clamped-end and rapid-touch cases without treating reflow as another press.

The review fix is in `keynav.ts` § `Chain`. Diagram's existing row sampler invalidates changed layouts before updating its render state, and the panel drops chains when blocks, root or picture kind are replaced. The arrow hook already clears its chain when its block mapping changes. Geometry checks stay out of render. The durable rule is that a cached row remains usable only while the layout and identity that gave it meaning remain valid.

Reviewing that fix exposed a second assumption: discarding the sampler's chain ref does not necessarily render the buttons. A cancelled last-rung aim can sit ahead of the measured row; after target-only reflow, the sampler measured that same earlier row and React skipped the update, leaving Next marked unavailable. A real-scroll test observed `aria-disabled="true"` where `"false"` was expected. The sampler now publishes a fresh position when it discards an aim, while retaining the old state for ordinary unchanged samples. Replacing the block map uses a fresh context-bound chain holder, so that render already sees the old aim discarded; clearing the old holder in a passive effect had the same stale-render gap. Invalidation must reach the cache's consumers even when their other input has not changed.
