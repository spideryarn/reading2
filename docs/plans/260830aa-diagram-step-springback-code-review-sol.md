Verdict: the springback algorithm is correct. I would make one functional history fix and clean up the URL contract wording before committing. The guard order, dependency array, and `sectionContaining` allocation are sound.

## Finding: Back can lose to an active glide

Medium severity, and pre-existing rather than introduced by this diff.

When Back restores an entry with no `?at=`, the URL effect calls raw `window.scrollTo({ top: 0 })` at [App.tsx:936](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:936). Unlike the non-null branch, that does not call `cancel()`.

The failure sequence is:

1. `jumpTo` starts a glide and pushes history at [App.tsx:1009](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:1009).
2. Back changes `at` to `null`.
3. The effect scrolls to zero, but the pending glide frame remains alive.
4. The next `tick` moves toward the old destination again at [scroll.ts:467](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/scroll.ts:467).
5. The new guard correctly ignores those intermediate movements.
6. Once the glide ends, the spy writes the destination section into the Back entry.

I would add a `scrollToTop()` alongside `scrollToBlock()`:

```ts
export function scrollToTop() {
  cancel();
  markOurScroll(150);
  window.scrollTo({ top: 0, behavior: "auto" });
}
```

Then use it in the `at === null` branch. A test should start a public `scrollToBlock` glide, invoke `scrollToTop`, run the queued frames, and prove the old destination never resumes.

## 1. Guard order and timing

The order at [position.ts:181](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/position.ts:181) is right: glide first, then physical top, then containment.

There is no stale-mid-flight measurement window after normal glide completion:

- Each non-final `tick` calls `scrollTo`, then registers the next glide frame.
- Its scroll event later schedules the spy frame at [App.tsx:969](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:969); the handler captures no coordinates.
- If the final glide frame and spy frame run in the same rendering cycle, the glide frame was registered first. It scrolls to the exact destination and calls `cancel()`, setting `aiming = null`, before the spy runs.
- If the spy is deferred, it likewise sees the final position.
- Even an old queued scroll event is harmless because `measure()` re-reads every rectangle and `window.scrollY`; the event carries no old position.

One performance detail: the guard does not currently prevent the rectangle reads, because function arguments are evaluated first at [App.tsx:954](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:954). If desired:

```ts
const jumpInFlight = glideTarget() !== null;
const tops = jumpInFlight
  ? []
  : rows.map((el) =>
      el ? el.getBoundingClientRect().top : Number.POSITIVE_INFINITY,
    );

const next = positionToWrite({
  sections,
  rowOf,
  tops,
  line,
  jumpInFlight,
  atTop,
  held: synced.current,
});
```

That preserves the tested pure guard while avoiding the more expensive DOM reads during a glide. It is an optimisation, not a correctness fix.

## 2. Dependency array and immediate measurement

Adding `rowOf` causes no additional effect restarts in normal operation.

`rowOf` changes only when `article.blocks` changes at [App.tsx:933](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:933). But `sections` already depends on the same `article.blocks` identity at [App.tsx:1111](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:1111). Therefore every `rowOf` change already came with a `sections` change and would already have restarted the effect.

The immediate `measure()` is also correct:

- If reflow leaves the reading line inside the held paragraph’s current section, retaining that finer block is the new intended rule.
- If reflow moves another section under the line, it writes that section.
- If re-extraction removes the held block, `sectionContaining` returns `null` and the visible section replaces it.
- If the effect restarts during a glide, the guard suppresses the immediate write.

It no longer “corrects” a paragraph to its section merely because layout changed. That is intentional, not lost synchronization.

## 3. Per-frame allocation

I agree with leaving `sections.map(s => s.row)` as-is.

The performance notes identify two materially larger costs:

- React updates when `?at=` changes at [performance.md:599](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/performance.md:599).
- Reading every section rectangle at [performance.md:620](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/performance.md:620).

A small array over roughly tens of sections is not the thing those measurements identify. If optimizing this path, skip the DOM reads while the guard is active before introducing another cached projection or duplicating `activeSectionIndex`.

## 4. Uncovered paths

- Back/forward with a non-null, valid `at` is sound: the URL effect updates `synced` before the instant scroll, and `scrollToBlock(..., "auto")` cancels any glide. The null-target race above is the exception.
- `?note=` arrival is sound. While it glides, intermediate sections are suppressed. On landing, a different destination section is written; a note within the held section preserves the finer `at`. The exact note remains represented by `?note=`.
- `layoutKey` reflow is sound for the reasons above.
- Reduced motion is sound. `jumpTo` sets `synced` before `scrollToBlock`; the instant branch cancels any old glide before scrolling at [scroll.ts:494](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/scroll.ts:494). Its scroll event therefore measures only the final position.
- A target whose final position is physically within the top zone will still clear `?at=`. That is existing top-of-article policy, not a new reduced-motion divergence.

The tests do leave important wiring unproved:

- Reverting `DiagramBand` to `location.search` would not fail [reading-position.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/reading-position.test.ts:163); the test models two abstract presses but never renders `DiagramBand` or exercises nuqs’s delayed URL flush.
- Nothing exercises an actual glide, scroll event, and spy-rAF sequence.
- Nothing changes `sections` between measurements to prove the derived-section claim.
- The test at [reading-position.test.ts:126](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/reading-position.test.ts:126) is misnamed: it says “writes nothing” but expects `{ at: MIDDLE }`. I would rename it to “replaces an unplaceable id with the visible section.”

## 5. Documentation

The Force correction is accurate. Force is capped at depth 2 at [diagram.ts:517](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/diagram.ts:517), while the spy uses `max(1, leafDepth - 1)` at [position.ts:56](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/position.ts:56). They coincide on a normal depth-3 tree; on a depth-2 tree Force draws paragraph leaves while the spy remains at depth 1.

The problem is that the new qualification contradicts older absolute wording in the same files:

- [url-state.md:305](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/url-state.md:305) says `?at=` holds a section start.
- [url-state.md:316](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/url-state.md:316) says reopening always lands at the section top.
- [position.ts:4](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/position.ts:4), [params.ts:143](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/params.ts:143), and [web-client.md:46](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/web-client.md:46) retain the same absolute claim.
- [diagram.md:627](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/diagram.md:627) should say the spy is section-granular, not that `?at=` itself “is a section.”

I would use:

> `?at=` always holds a block id. Ordinary scrolling writes the first block of the section in view. A deliberate jump—or an incoming or history URL—may name a finer block, which the spy preserves while the reader remains inside that block’s section.

And change the reopening cost to:

> After ordinary scrolling, reopening lands at the top of the recorded section. A URL last set by a finer block jump reopens at that block.

Finally, “a fifth of a second later” at [diagram.md:632](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/diagram.md:632) and [url-state.md:325](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/url-state.md:325) is too exact: the glide is 200 ms, but the URL write is debounced by 300 ms at [params.ts:52](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/params.ts:52). I would simply say “later” or “when the queued position write landed.”

I ran the relevant suites: 117 tests across `reading-position`, `scroll`, `url-state`, and `diagram`; all passed. No files were edited.