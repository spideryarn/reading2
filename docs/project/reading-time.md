# Reading time — where you have spent time in the piece

**The spine carries a tinted area that reaches further across where you have spent longer, with a
line down its edge, and a faint hairline beside each passage says the same thing up close.** It is there so a reader who has been thrown around the article — by a
citation, a search hit, a rotation — can find the place they had got to by eye. Part of
[reading-view-overview.md](reading-view-overview.md). The plan, and every number's reasoning, is
[260916c](../plans/260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md).

> I would love for there to be a way to indicate where I've spent time in the article, perhaps in the
> spine and or as a kind of subtle indicator in the vertical gutter next to the text. […] One of the
> ways it would help is just seeing how far through the article I've read
>
> — Greg, 2026-09-12 (SPIDERYARN-READING2-41)

**Owner only, and behind [the experimental switch](experimental-features.md)**, both the recording
and the drawing.

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
- **The rail is rarely full, and fainter again**, since 2026-10-04. The reach is logarithmic from a
  quarter of the rail at 0.35 of the reading time to the whole of it at about 45 times the reading
  time (seven doublings), so each sixteenth is the same multiple of time. One read at the expected
  pace is 6 sixteenths. Before, the rail filled at 2.8, and on Greg's own reading 43% of the drawn
  passages were full width; now 2.7% are. The area is at 0.18 and the line at 0.65. What it gives
  up: a full-strength gutter line no longer means a full rail.

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

The plan's § Deferred has the list and why each waits: a "furthest I read" button, weighting towards
the reading line, recording for readers with the switch off, signed-in visitors' own time, and a
control to forget it.
