# Trajectory's question above its quote, and on-screen block links lit in every band

Two admin reports from Greg, 2026-10-01, built together because both are small and both live in
the band. Sentry `SPIDERYARN-READING2-8J` (`spya-jq5db6`) and `-8K` (`spya-rqch7a`).

> In Trajectory mode, show the question *above* the quote. see screenshot
>
> — Greg, 2026-10-01 (8J)

> In Summary and Tweet-threads mode (and a bunch of others), we include block-links.
>
> In such modes, highlight any block-links whose blocks are currently visible on the screen.
>
> Ideally do this with reusable machinery.
>
> — Greg, 2026-10-01 (8K)

## 8J — the cue goes above the quote

The screenshot is the current row of the Trajectory list: section path, then the quote in full,
then the stop's cue (*"What does the tumor seem to do with tamoxifen itself once resistance
develops?"*) under it. The cue is the question to read the passage with, so it should come first.

**Change**: in `TrajectoryPanel.tsx`, the row's `.traj-what` draws place → cue → words instead of
place → words → cue. Nothing else moves: the cue is still on the current row only, the FAQ's
question still sits above the whole row (`StopQuestions`, 5C), and the prose's door cue is
untouched (it says where the *next* stop leads, under the door, which is a different job).

Test: `tests/trajectory-panel.test.tsx` gains an order assertion — on the current row the cue
precedes the words in document order. Red first.

## 8K — light the block links whose blocks are on screen

### What is already here

- **One block-link component.** `BlockRef` / `BlockRange` (`src/web/BlockRef.tsx`) is the block link
  in every mode (Summary, Tweets, Glossary, Quotes, Timeline, Ideas, FAQ, Citations, Cited ids in
  Chat and Summary, Debate, Quiz, Claims, Criteria, Sketch, Candidates, Simple, PassageLinks), and
  every one carries `data-block-link="<id>"` — which `BlockLinkCard` already uses as its hook.
- **"Which rows are on screen", cheaply.** `useReadingTime.ts` § `rowsOnScreen`: a binary search
  (`firstOnScreen`) plus a screenful of rect reads, between `stickyOffset()` and the window bottom.
- **"Drive many elements from one style element".** `ReadingTimeStyle` + `gutterCss`: a memoised
  `<style>` whose rules are keyed on `data-block`, so a change re-renders one tiny component and no
  table row. `SAFE_ID` keeps an id that fails the format out of the selector.
- **Whether the prose is on screen at all.** `Reader`'s `bandOverProse` (band open, no room beside
  the prose, not stepped aside) — the gate reading time already uses.

### The change

1. **Move `rowsOnScreen`** out of `useReadingTime.ts`. It reads rects, so not into the pure
   `reading-time.ts`, but into a small new module `src/web/on-screen.ts` together with the row
   cache (`freshRows`) both callers need, and `useReadingTime` imports it. One spelling, two users.
2. **A pure function** `onScreenIds(rows: RowBox[], viewTop, viewBottom): BlockId[]` — a block counts
   when at least `min(24px, its own height)` of it is between the lines, so a two-pixel sliver at the
   bottom edge does not light a link for a paragraph nobody can read. Sorted, deduplicated.
3. **A pure function** `onScreenLinkCss(ids): string` — one rule,
   `.mode-band :is([data-block-link="a"],[data-block-link="b"]) { … }`, `SAFE_ID`-filtered, empty
   string for no ids. **Scoped to `.mode-band`**: Greg said "in such modes", and a link inside the
   prose (or the hover card) lighting up because its own paragraph is on screen would be noise.
4. **`<OnScreenLinksStyle enabled />`**, its own memoised component, mounted by `Reader` beside
   `ReadingTimeStyle`. It owns one rAF sampler (scroll + resize, read-then-one-setState, the
   `useColumnContext` shape), keeps the sorted id list as a string so an unchanged screenful is no
   re-render, and renders the `<style>`. `enabled = bandOpen && !bandOverProse`: with no band there
   is nothing to light, and with a band lying over the prose no block is visible.
5. **The look** (prose.css § block ids): the declarations come from one token,
   `--block-link-on-screen`, set to `var(--highlight-wash)` — a soft orange wash behind the link,
   full opacity, `border-radius: 3px`, `box-decoration-break: clone` so a wrapped link washes each
   line. The generated rule names only selectors; the declarations stay in the stylesheet.

Every mode gets it with no change to any panel, which is the "reusable machinery" Greg asked for.
`BlockRange` lights each end separately, which is literally what he asked for.

### The simpler and the bigger options passed over

- **A React context of visible ids, read by every `BlockRef`.** Works, and is the obvious React
  shape, but it re-renders every link on every paragraph boundary and touches every band's subtree.
  The style element re-renders one component and touches none. Also: the card's own hook
  (`data-block-link`) already is the reusable seam.
- **An `IntersectionObserver` per row.** Thousands of targets on a long article; `PageContents.tsx`
  already records why this repo prefers a scroll sampler here.
- **Lighting a Summary section when *any* block in its range is on screen** ("you are in this
  section"). Nice, but it is Structure's "you are here", a different feature, and not what was
  asked. Deferred, named.
- **Highlighting inside the prose too.** Declined for now (point 3).

### Tests (red first)

- `tests/on-screen.test.ts`: `onScreenIds` (sliver excluded, short row fully on screen included,
  sticky top respected, order/dedupe) and `onScreenLinkCss` (scoped to `.mode-band`, unsafe id
  dropped, empty for none).
- `tests/on-screen-links-style.test.tsx`: mounted with rows faked in jsdom (stubbed
  `getBoundingClientRect`), it writes a rule naming the visible ids, rewrites it after a scroll, and
  writes nothing when `enabled` is false.
- Existing `use-reading-time.test.tsx` stays green across the move.

### Browser check

Playwright on the box: an article with Summary open at desktop width — scroll the prose, and the
links in the band whose blocks are on screen wash orange and the rest do not; Tweets the same;
Trajectory's current row shows the cue above the quote. Phone width: band over the prose, no wash.

## Sol's plan review, and what changed

[261001n-plan-review-sol.md](261001n-plan-review-sol.md): no P0, verdict "revise before build", all
four taken.

- **P1, stale after a reflow.** The sampler takes Reader's `layoutKey` as a re-run trigger and a
  `ResizeObserver` on `table.zoom`, exactly as `useColumnContext` does.
- **P1, the gate.** `bandOpen && fit.modeW > 0` — band and prose painted side by side. The planned
  `!bandOverProse` was true with the band stepped aside on a phone, where `.mode-band` is
  `display: none` and every scroll frame would have paid for rect reads.
- **P2, the Dock.** The bottom line is `innerHeight - dockOffset()`; tested.
- **P2, opacity.** The generated rule must carry declarations (CSS cannot switch a set on from a
  custom property), so it does: wash, `opacity: 1`, radius, `box-decoration-break`. The colour is a
  token in prose.css. Summary's `.summ-range` still dims both ends from the parent; the wash shows
  through it, and the "full opacity" claim is dropped rather than restyling Summary.
- Scope wording: the passage Chat *dialog* is not a band and is not lit; the Chat *mode* is.

## Also raised, and left out

The Overseer passed on a finding from `qw-compact-tops-and-diagram-enlarge`: on a landscape iPhone
Trajectory's *"What do you want from this piece?"* form takes 137px of a ~338px band above an
existing route. Collapsing it is a product call about how discoverable the purpose question is
(plan 260930e put it there deliberately), and is not either report's subject, so it is not built
here; it goes in the debrief for Greg.
