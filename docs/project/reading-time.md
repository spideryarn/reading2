# Reading time — where you have spent time in the piece

Up: [reading-view-overview.md](reading-view-overview.md)

**The spine carries a tinted area that reaches further across where you have spent longer, with a
line down its edge, and a faint hairline beside each passage says the same thing up close.** It is there so a reader who has been thrown around the article — by a
citation, a search hit, a rotation — can find the place they had got to by eye. The plan, and every
number's reasoning, is
[260916c](../plans/260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md). The
server half is [`src/store/pg-reading-time.ts`](../../src/store/pg-reading-time.ts) and the `POST
/api/reading-time/:slug` route in [`src/routes.ts`](../../src/routes.ts) (tests:
[`reading-time-route.test.ts`](../../tests/reading-time-route.test.ts),
[`reading-time.test.ts`](../../tests/reading-time.test.ts),
[`use-reading-time.test.tsx`](../../tests/use-reading-time.test.tsx)).

> I would love for there to be a way to indicate where I've spent time in the article, perhaps in the
> spine and or as a kind of subtle indicator in the vertical gutter next to the text. […] One of the
> ways it would help is just seeing how far through the article I've read
>
> — Greg, 2026-09-12 (SPIDERYARN-READING2-41)

## Who gets it

**Every signed-in owner, on their own articles, whatever
[the experimental switch](experimental-features.md) says** — both the recording and the drawing,
since 2026-10-05. A visitor, signed in or not, records nothing and sees nothing.

From 2026-09-16 until then both halves were behind the switch, and nothing was sampled while it was
off, so a stretch read with it off looked unread for ever. Greg reported the line missing after a
load ([261005g](../plans/261005g-reading-time-line-waits-on-the-experimental-switch-not-on-a-timer.md),
which has the trace and the four options) and was asked whether it should come out:

**Decided: A** — Greg, 2026-10-05. His whole answer was "A", and A was: all of it, for everyone,
always recorded and always drawn.

**What that gives up, named when he chose: a reader cannot yet switch it off or erase it.** It goes
when the article is deleted, or on request by email, and `/privacy` promises nothing more. An off
switch and an erase are the obvious next step, under *Not built* below.

The gate was one argument: `OwnedReader` in
[`ArticlePage.tsx`](../../src/web/article/ArticlePage.tsx) passes `true` where it passed the switch.
`useReadingTime` keeps its `enabled` parameter and its `off` status, because that is where an off
switch would plug in. `tests/public-network-trace.test.tsx` § "reads the owner's reading time with
experimental features off" pins it through the real `App`.

## What is true of it, and where each rule lives

- **A second is shared, not multiplied.** Once a second, the rows on screen split the elapsed time by
  visible pixels, so a screen earns one second per second. Crediting every visible block in full made
  a screen of eight paragraphs look read after reading one of them.
  [`reading-time.ts`](../../src/web/reading-time.ts) § `shareVisible`.
- **It counts only while somebody could be reading**: the page visible, some activity (arriving
  counts) in the last five minutes, and the prose on screen. `Reader` decides the last of those,
  because `.band-covers` is also set when no band is open.
  [`useReadingTime.ts`](../../src/web/useReadingTime.ts) header.
- **The amount is per block and absolute**: the time spent over the time the block takes to read at
  230 words a minute, never under a second. Not relative to the most-read block, which would make
  everything else look unread. The gutter reads it as four levels, `readLevel`; the spine reads it
  as a **reach in sixteenths of the rail**, `readReach`, on a longer scale of its own (below). The
  two start together, at 0.35 of the reading time, and share nothing else.
- **On the spine it is an area chart on its side**, since 2026-10-03: a semi-opaque area in a colour
  of its own (`--read-time`) from the left edge out to each block's reach, and a translucent line down
  its right-hand edge. An unread stretch has neither. Before that it was four widths of a faint
  `--ink` bar, which read as a paler part tint.

  > I think the spine is now indicating which bits I have spent time reading and which bits I haven't,
  > but I can't make sense of it. I wondered about having, using some kind of horizontal line or area,
  > like an area chart, but sort of rotated 90 degrees, where the, yeah, I'm almost imagining like a
  > water level but rotated 90 degrees. So the distance from the left-hand margin would be an
  > indication of how much time I've spent reading it, and maybe the area would have some kind of
  > semi-opaque color that it adds. And so I could just look at a glance and see that wiggly line going
  > down to show which bits I've read the most, or something else. But right now I can't easily tell
  > what I've read and what I haven't.
  >
  > — Greg, 2026-10-03 (spya-jhe9mc)

  [261003j](../plans/261003j-reading-time-on-the-spine-drawn-as-an-area-chart.md).
  spine-marks.ts § `readingAreaPaths`, spine.css § reading time.
- **The chart is a curve, and quiet.** Its first version stepped at every block and was the loudest
  thing on the rail. Now the outline eases from one block's reach to the next, and in and out at
  the ends of a read stretch, and both the area and the line are fainter. It still draws nothing in
  a stretch you have not read; what the curve costs is that a little-read block beside a much-read
  one is drawn slightly fuller than it is.

  > We recently added the cyan kind of horizontal levels to the spine to indicate what we've read. I
  > wonder, well, firstly, I think the cyan is too opaque to visible somehow, so it kind of drowns
  > other stuff out. Secondly, I was wondering, what if we were to smooth it a bit so it'd be a bit
  > more like a curve and less like a bunch of blocks, like skyscrapers on a skyline.
  >
  > — Greg, 2026-10-03 (spya-bguwsn)

  [261003o](../plans/261003o-spine-reading-chart-quieter-and-smoothed-into-a-curve.md).
- **The rail uses a longer logarithmic scale and fainter paint**, chosen to leave only a few percent
  of measured drawn blocks at full width. A full-strength gutter line no longer means a full rail.
  The sample, results and limits of that inference are in the plan below; the thresholds live in
  `readReach`, and the opacities in spine.css § reading time.

  > Spine reading chart make the cyan horizontal-reading-level slightly fainter. and also somehow
  > make it a bit logarithmic so it's rarer that the reading-time fills up completely all the way to
  > the right
  >
  > — Greg, 2026-10-04

  [261004j](../plans/261004j-spine-reading-chart-fainter-and-rarely-full.md).
  [`reading-time.ts`](../../src/web/reading-time.ts) § `readReach` is the scale's one definition.
- **Each gutter level's elapsed-time threshold doubles**: 0.35, 0.7, 1.4 and 2.8 of the reading
  time. A glance draws nothing, one brisk read is faint, and full strength takes a slow read or
  nearly three. 0.7 is a boundary because it is the quiz's "read".

  > It seems to get brighter too fast. There's lots of blocks that have lines next to them that I
  > think I haven't spent that much time on. So maybe increase the threshold or basically slow down
  > the rate at which it gets brighter.
  >
  > — Greg, 2026-10-01 (spya-d940uu)

  [261002e](../plans/261002e-reading-time-line-brightens-more-slowly-and-its-card-says-the-time.md).
- **Sent after the opening read, then once a minute, on hide and on `pagehide`, and never twice.**
  A new opening read also waits for the preceding mount's cleanup write. Those two orderings stop an
  opening snapshot from counting the same local batch twice or overtaking it. A real teardown sends
  immediately; a bfcache page remains live and waits. The server adds what it is sent, so a failed
  batch is dropped rather than retried. Normally at most a minute is lost; the first batch can also
  contain however long the opening read took.
- **Stored as running totals**, `spideryarn.reading_time (article_id, block_id) → seconds`, keyed to
  `block_identities` so the time survives a re-extraction and goes with the article. No timestamps.
  In both exports. `/privacy` says we keep it.
- **The gutter is one generated `<style>` element**, never a prop into `TableView`, which would
  re-render every row whenever one block crossed a step. `gutterCss`,
  [`ReadingTimeStyle.tsx`](../../src/web/ReadingTimeStyle.tsx), gutter.css § reading time.
- **The hairline gets lighter, not darker.** It is `--ink` — near-white on the dark page — at an
  opacity of `level × (level + 1) × 0.025`: nothing unread or glanced at, 0.05 at level 1, 0.50 at the
  top. Zero at level 0 is required, not tidy: the 2px line is not clipped by its zero-wide strip.
  Greg, 2026-10-01, when the `title` said "darker" and he saw it brighten:

  > there's no visible line at first, and then for stuff I've been reading a lot, there is a visible
  > line, and that visible line would have to be, you know, whitish to show up against the default
  > black background.
  >
  > — Greg, 2026-10-01 (spya-mn3ruw)

- **The hairline says what it is on hover**, since 2026-09-29, because Greg found it and could not
  tell what it meant (SPIDERYARN-READING2-4S). It is a `span.blk-read`, last in the gutter, and its
  hover strip is zero wide on a row with no reading time. **A rich card since 2026-10-01**, not a
  `title`: the reading view's one delegated card (`BlockLinkCard.tsx` § `ReadingCard`), placed at the
  pointer's height rather than the paragraph's top. **It says the time** since 2026-10-02 — "You have
  spent 1 min 20 s here. It takes about 26 s to read." — live while open, from `useReadingTime`'s
  `timeFor`, which only the owner's Reader hands the card
  ([261002e](../plans/261002e-reading-time-line-brightens-more-slowly-and-its-card-says-the-time.md)).
  Nothing yet on touch.
  **The line is drawn inside its own strip** since 2026-10-01: it used to sit 2px outside it, so
  pointing at the line found nothing and Greg asked again (SPIDERYARN-READING2-84,
  [261001l](../plans/261001l-quieter-experimental-switch-tooltips-on-the-vertical-lines-readers-only-filter-in-admin-feedback.md)).
  gutter.css § reading time;
  [260929c](../plans/260929c-mode-bar-order-and-groups-experimental-switch-gutter-icons-diagram-behind-the-switch-reading-time-line-explained.md).
- **The spine layers' place in the track is their correctness**: the area after the parts and
  before the section fill, the hairlines and the search marks; the edge line over the section fill
  alone, because under it the line could not be read in the section you are in. [`Spine.tsx`](../../src/web/Spine.tsx),
  `tests/spine-reading.test.ts`.

## Who else reads it

- **The quiz**, since 2026-09-30: *Only what I've read* narrows it to questions whose passages have
  been on screen for 70% of their reading time (level 2 or more since 2026-10-02), and says what share of the body's words is. The hook's `status` exists for it —
  `off`, `loading`, `loaded`, `failed` — because an empty level map means "read nothing" only once
  the opening read has answered. [quiz.md § Only what you have read](quiz.md#only-what-you-have-read).

## Not built

- **A way to switch it off, and a way to erase it** — the obvious next step now that every owner
  has it (above), and not built. Two separate things: a setting that stops the recording and the
  drawing, and a button that deletes the stored totals for one article or for all of them. The
  hook's `enabled` parameter is the seam for the first; the second needs a `DELETE` beside the two
  routes. When either lands, `/privacy`'s bullet gains a sentence.
- The plan's § Deferred has the rest and why each waits: a "furthest I read" button, weighting
  towards the reading line, and signed-in visitors' own time.
