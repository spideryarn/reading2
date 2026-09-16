# Reading time — where you have spent time in the piece

**The spine is thicker where you have spent longer, and a faint hairline beside each passage says
the same thing up close.** It is there so a reader who has been thrown around the article — by a
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
- **Thickness is per block and absolute**: four steps of the time spent over the time the block takes
  to read at 230 words a minute, never under a second. Not relative to the most-read block, which
  would make everything else look unread. `readLevel`.
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
- **The spine layer's place in the track is its correctness**: after the parts, before the section
  fill, the hairlines and the search marks. [`Spine.tsx`](../../src/web/Spine.tsx),
  `tests/spine-reading.test.ts`.

## Not built

The plan's § Deferred has the list and why each waits: a "furthest I read" button, weighting towards
the reading line, recording for readers with the switch off, signed-in visitors' own time, and a
control to forget it.
