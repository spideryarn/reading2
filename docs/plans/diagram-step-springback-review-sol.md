## Verdict

The diagnosis is right for Drift and Trail. The proposed `heldSection` fix is incomplete and should not ship as written.

The main missing case is a smooth jump crossing section boundaries.

### 1. Diagnosis

The normal failure path is exactly as described:

- [`stepTo`](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:648>) jumps to a paragraph block.
- [`useReadingPosition`](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:925>) records that exact block.
- The spy measures the enclosing section and compares its first block against the paragraph.
- It schedules a debounced section value, which later replaces the paragraph and moves `atRow` back.

Two qualifications:

- The next ↓ repeats the same rung specifically when the reverted section start precedes that section’s first drawn paragraph. Otherwise it may jump backwards to that first paragraph. Either way, progress becomes wrong.
- The Force claim is not right as stated. Force is capped at depth 2 by `MAX_DRAWN_DEPTH`, while the spy uses `leafDepth - 1`. On normal depth-3 trees they coincide. On deeper trees, an ancestor’s start is also its first descendant section’s start, so it normally still coincides. Force can spring back on a shallow depth-2 tree, where its depth-2 leaves are paragraphs inside depth-1 sections, or with a stale layout falling through `stepStops`’ missing-block fallback.

I found no ordinary springback cause in `stepTarget`, `stepStops`, `setRoving`, `picked`/`shown`, or React batching. `stepTarget` and fresh `stepStops` are internally consistent.

There is one smaller rapid-repeat risk: `DiagramBand` derives `atRow` from `location.search`, not the `at` state returned by nuqs. `throttle(0)` flushes the actual URL on the next task, so extremely fast consecutive clicks could briefly reuse the old `readerRow`. That can collapse two presses into one, but it cannot explain a delayed visible springback. Passing `at` or `atRow` directly from `useReadingPosition` would remove that window.

### 2. The blocker in the proposed fix

Suppose the reader is in section A and jumps to paragraph P in section C:

1. `heldSection = C`.
2. `scrollToBlock` begins its 200 ms glide.
3. An early scroll frame still has section A under the reading line.
4. The spy sees `A !== C`, writes A, and changes the held section to A.
5. Later the glide reaches C. The spy now sees `C !== A` and writes C’s section start.

The paragraph target is still lost. This also applies to a scroll frame near the top: the `scrollY <= stickyOffset()` branch can clear the finer target unless programmatic-scroll suppression happens before that branch.

The debounce distinction matters:

- A debounce queued before the button press cannot later beat the press. In installed nuqs 2.10.0, the non-debounced `throttle(0)` path aborts the debounce queue; if it has already reached the global queue, the later value replaces the same map entry.
- A new debounce created by intermediate glide frames can beat the press. That is the remaining race.

The workspace currently contains an uncommitted implementation of the proposed `Anchor` design in [`position.ts`](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/position.ts:112>) and [`App.tsx`](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:925>). It has exactly this glide hole.

Other cases:

- Leaving A and returning works only if every spy write updates both fields. The original paragraph is intentionally forgotten after leaving; returning produces A’s section start.
- Caching `heldSection` is unsafe when `sections` changes. The current concurrent implementation’s URL effect reruns but immediately returns when `at === held.current.at`, leaving the old derived section cached.
- The top branch otherwise preserves existing behavior: an anchor at the physical top becomes `null`.
- Back/forward is sound when `at` changes: set the logical target before the instant scroll, then the resulting scroll event recognizes it.

### 3. What I would do instead

Keep `?at=` section-granular for ordinary scrolling, but allow deliberate jumps to remain finer. Do not store `heldSection` as independent state.

On every measurement:

1. If `glideTarget() !== null`, do nothing. Put this before the top branch.
2. Handle the top branch.
3. Derive `sectionContaining(synced.current)` from the current `sections` and block-row map.
4. If that equals the visible section, preserve the finer value.
5. Otherwise write the visible section and set `synced.current` to it.

This avoids stale derived state and handles projection changes automatically. If the reader interrupts a glide with a wheel or touch, `scroll.ts` clears `glideTarget`; the next real scroll measurement can update the section normally.

I would not make the whole spy block-granular for this fix. It would not fundamentally break consumers—most already perform containment checks, and stable block IDs support it—but it changes the documented URL contract and increases React updates from roughly one per section to one per block. The performance notes already identify section-level `useReadingPosition` updates as the Reader’s largest remaining render source, and Drift/Trail recompute their layout when `atRow` changes.

### 4. The failing test

The smallest honest test belongs in `tests/reading-anchor.test.ts` or `tests/url-state.test.ts`, using pure functions in `position.ts`.

A suitable signature is:

```ts
anchorFromScroll(
  sections,
  tops,
  line,
  held,
  jumpInFlight,
): Anchor | null
```

The first red regression is:

```ts
const held = anchorFor(SECTIONS, ROW_OF, paragraphInsideSectionA);

expect(
  anchorFromScroll(SECTIONS, topsShowingSectionA, LINE, held, false),
).toBeNull();
```

Against the old comparison with `held.at`, it returns section A and fails.

Do not ship without the second test:

```ts
const held = anchorFor(SECTIONS, ROW_OF, paragraphInsideSectionC);

expect(
  anchorFromScroll(SECTIONS, topsShowingSectionA, LINE, held, true),
).toBeNull();
```

Then assert that after arrival in C with `jumpInFlight = false`, it still returns `null`, while a later manual move to another section returns that section.

The concurrent test file currently covers same-section stepping, but assumes the spy sees only the final target row. It does not model the intermediate frames that defeat the proposed fix.

