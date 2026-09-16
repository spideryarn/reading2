# Show where you have spent time reading, in the spine and the gutter

Status: **planned**, 2026-09-16. Reviewed by GPT Sol ([the findings](260916c-reading-time-review-sol.md):
seven P1s and two P2s, all taken) and by Fable (the product calls; one dissent is recorded under
*Who, and behind what*).

From Sentry `SPIDERYARN-READING2-41`, the **first** of the two things in that report. The second, a
"back to where you were" that works everywhere, was
[260916a](260916a-back-to-where-you-were-survives-a-mode-change.md) and is built. Nothing here
touches it.

## What Greg asked for

> I would love for there to be a way to indicate where I've spent time in the article, perhaps in the
> spine and or as a kind of subtle indicator in the vertical gutter next to the text. And so perhaps
> what we could do is a heartbeat every second that makes a note of which blocks are fully or
> partially, maybe you get partial points for being partially visible.
>
> And every so often, maybe not every second, maybe every minute, we send an update to the server
> with the latest data from this heartbeat. And so we'll effectively have a data structure that says
> how much time each block has spent visible. And then we would visually indicate this.
>
> So I don't know how we indicate it on the spine. You could use the horizontal space almost like
> it's sort of, imagine it's sort of filling up towards the right. So maybe the spine is narrower in
> places where we haven't spent much time reading and thicker in places where we have spent time
> reading.
>
> And then there's something in the vertical gutter in the text as well. I could use opacity or it
> could use thickness again. I don't want it to be too obtrusive. I think this would help in a bunch
> of ways.
>
> One of the ways it would help is just seeing how far through the article I've read because I'm
> still having issues where, you know, if I switch from portrait to landscape or if I click on
> things, it takes me to other bits of the article and I sort of lose my place.
>
> — Greg, 2026-09-12

The job, in one line: **a reader can glance at the spine and see which parts of the piece they have
actually spent time on**, so that after being thrown around the article they can find the 40% mark
again by eye.

## Two house rules this deliberately goes against, and why that is Greg's call already made

Both were written before this report, and both would forbid the feature if read literally:

- [`BlockGutter.tsx`](../../src/web/BlockGutter.tsx): *"it is the reader's column — your marks on
  this text … Nothing machine-generated goes here."* Time spent is not machine-generated content; it
  is a trace of the reader's own reading, which is the nearest thing to "your marks" the app has that
  the reader did not type. **And it takes no slot**: the mark is a hairline down the gutter's edge,
  not an icon, so the one-column truncation arithmetic is untouched.
- [`Spine.tsx`](../../src/web/Spine.tsx): *"without inventing a width or an opacity the reader would
  have to learn"*. Greg asked for exactly that width, in those words. The legend is one sentence
  ("thicker where you have spent longer"), and it goes in the spine's tooltip.

Both comments are updated to say so, quoting him, so the next agent does not "fix" it back.

## The shape

```
 browser, owner only, experimental switch on
 ┌──────────────────────────────────────────────────────────────────────┐
 │ every 1s: page visible? reader active in the last 300 s?              │
 │           prose actually on screen? (Reader's gate, below)            │
 │   yes → for the rows on screen:                                       │
 │           share(row) = its visible px ÷ all rows' visible px          │
 │           pending[id] += share × elapsed    shown[id] += same         │
 │ every 60 s, and on hidden: POST pending with apiFetch, clear it FIRST │
 │ pagehide: POST whatever is pending with leavingFetch                  │
 │ a batch that fails is dropped, never re-sent                          │
 └──────────────────────────────────────────────────────────────────────┘
          │ POST /api/reading-time/:slug  { seconds: { spya-…: 3.5, … } }
          ▼
 spideryarn.reading_time (article_id, block_id) → seconds   [adds, never replaces]
          │ GET /api/reading-time/:slug  on open → { seconds: {…} }
          ▼
 shown = server totals at open + everything credited since
 level(id) = 0‥4 from shown seconds ÷ the block's own expected reading time
          │   (React state changes only when some block changes level)
          ├─ Spine: a left-aligned layer, width by level, runs of equal level merged
          └─ Gutter: one generated <style>: tr[data-block="spya-…"] { --read: 3 } → hairline opacity
```

### What counts as a second

- **The page is visible** (`document.visibilityState === "visible"`).
- **The reader has done something in the last 300 s** (scroll, wheel, key, pointer, touch) **or the
  page has just become theirs to read**: mounting enabled, `visibilitychange → visible`, `pageshow`
  and `focus` all count as activity. Without that second half, opening an article and reading its
  first screen without touching anything would record nothing (GPT Sol, finding 3). 300 s rather than
  120 s because a tall desktop screen of dense text takes three or four minutes to read hands-off
  (Fable). The rule only exists to stop a laptop left open overnight, and the display saturates
  anyway, so the most an idle screen can do is mark one screenful as read.
- **The prose is actually on screen.** `Reader` works this out and hands it down, because only
  `Reader` knows it: `showText && !(bandOpen && fit.modeW === 0)`. **Not `.reader.band-covers`**: that
  class is also set when no band is open at all, including Plain on a phone, so keying off it would
  record nothing on exactly the device Greg reads on (GPT Sol, finding 1). `Reader.tsx` already says
  that every rule keyed off the class must also name `.mode-band`. `?text=0` leaves rows with no prose
  in them, so it earns nothing.
- **Elapsed time is measured, not assumed**, and capped at 2 s per tick, so a throttled timer or a
  sleep does not arrive as one enormous credit.

**A second is shared out, not multiplied.** On each tick, the rows on screen split the elapsed time in
proportion to how many of their pixels are visible, so a screen earns one second per second in total.
The first draft gave every visible block the full second, and both reviewers found the same hole in
that: a screen of eight paragraphs stays on screen for as long as it takes to read all eight, so every
one of them reaches "read" in the time it takes to read one, and the four levels collapse into two.
Sharing by area (which, for prose, is roughly sharing by words) means reading at an ordinary pace gives
each block about its own expected time, skimming at three times that pace gives it a third, and a
paragraph scrolled past stays faint. **This departs from Greg's literal "how much time each block has
spent visible" only in the denominator**, and the feedback note says so.

The viewport is the window below `stickyOffset()` ([`scroll.ts`](../../src/web/scroll.ts)). The
bottom bar is not subtracted (deferred).

### The hot path

This runs every second on every enabled owner's article, so it must not repeat the long-article cost
that [260905d](260905d-mode-switching-is-sluggish-on-a-very-long-article.md) measured (a
`querySelector` per row was 38% of script time on 2,046 blocks):

- **The row list is cached**: one `querySelectorAll("tr[data-block]")`, read again only when its first
  or last element has left the document or the row count has changed.
- **A binary search** on `getBoundingClientRect().top` finds the first row on screen, and rects are
  read only from there until a row starts below the viewport. That is about log₂ n reads plus a
  screenful, with nothing written to the DOM between reads.
- **Seconds and pending live in refs.** React state holds only the level map, and it is set only when
  a block's level changes, so `Reader` re-renders a few times a minute while you read, not every
  second.

### From seconds to how thick

`expected = Math.max(1, words * 60 / 230)` seconds. `level` comes from `seconds / expected`: under 0.1
→ 0 (nothing drawn), under 0.35 → 1, under 0.7 → 2, under 1 → 3, and 4 otherwise. The floor is one
second because a heading's share of a screen is small (sharing by area gives it a second or two over a
minute of reading), and it should still read as passed through. **The level is per block and
absolute**, and the alternatives lose:

- **Relative to the article's maximum**: one paragraph stared at for ten minutes would make
  everything else look unread. It answers "where did I spend *most* time", not "have I read this".
- **Raw seconds with a fixed cap**: a one-line heading and a 300-word paragraph would need the same
  time to look read.

Four levels rather than a continuous width, so that neighbouring blocks merge into runs on the spine
and the style sheet only changes when a block crosses a step.

### Where it is drawn

- **Spine**: a layer inside `.spine-track`, left-aligned, `level × 25%` of the rail's width, in a
  low-alpha foreground colour, positioned by the rows `measure()` already has. **It is painted after
  the parts and before `here` and the ticks** (`parts → reading time → here → ticks → jump origin /
  search / viewport / hit targets`). The spine has no `z-index`, so tree order is paint order, and
  `Spine.tsx` says permanent fills go before the ticks or they hide the article's subdivision (GPT Sol,
  finding 5). The runs are computed by a pure function in
  [`spine-marks.ts`](../../src/web/spine-marks.ts), with an order test beside
  `tests/spine-here.test.ts`.
- **Gutter**: a 2px hairline down the gutter's text-side edge, at `opacity: calc(var(--read, 0) *
  0.1)`, drawn as a pseudo-element on `.blk-gutter`, so it adds no element and takes no slot. Fable
  argued for cutting it from v1, as the surface that fights a house rule. It stays because Greg asked
  for it by name, and it is a few lines of CSS behind the same switch.

**The gutter is driven by one generated `<style>` element, not by props to `TableView`.** Passing a
changing map into `TableView` would re-render every row of the article each time a block crossed a
level. A rule per non-zero block, `tr[data-block="spya-k3m9qt"] { --read: 3 }`, survives rows being
remounted and needs no imperative DOM writes. The id format is closed, so an id is safe inside a
selector ([block-ids.md](../project/block-ids.md)). There is no CSP forbidding an inline style (GPT
Sol checked).

### Who, and behind what

- **The owner only.** `useReadingTime(slug, blocks, enabled)` is mounted in `OwnedReader`
  ([`ArticlePage.tsx`](../../src/web/article/ArticlePage.tsx)) and reaches `Reader` through the owner
  arm of `ReaderCapability` as `{ levels, setCounting }`. `Reader` feeds the gate above into
  `setCounting`. A visitor never mounts it and makes no request, so
  `tests/public-network-trace.test.tsx` stays as it is. The server is owner-scoped too
  (`articleIdForOwned`), so an administrator, or anybody else on the slug, records and reads nothing.
- **Both halves are behind the experimental switch.** The switch gates *availability*, not consent:
  it decides which unfinished features are shown, and it is not a privacy control (GPT Sol, finding
  9). Recording is gated as well as drawing because it is new code running every second on the
  article view of every paying reader, and new data about a person, so it starts where the unfinished
  things are. **Fable dissented**: gate only the drawing and record for every owner, because reading
  time cannot be backfilled, and a reader who turns the switch on in a month would see an empty spine
  over the articles they read most. That is a real cost. Graduating recording is a one-line change
  once the recorder has run on Greg's own reading for a while, and it is listed under *Deferred*.
  With the switch off, nothing is sampled, nothing is requested, nothing is drawn, and nothing is
  deleted.

## The table

```
spideryarn.reading_time
  article_id  uuid     not null
  block_id    text     not null   check (block id format)
  seconds     double precision not null   check (seconds >= 0)
  primary key (article_id, block_id)
  foreign key (article_id, block_id) references block_identities on delete cascade
```

- **Keyed to `block_identities`.** The composite FK makes a garbage id impossible to store.
  `block_identities` rows are never deleted and are only upserted on re-extraction
  (`src/store/artifacts-pg.ts`), so the time survives a re-run. Deleting the article cascades through
  it.
- **No `owner_id`**, unlike the sibling reader-state tables. Only an article's owner can write, and
  ownership is inherited through the article (`src/owner.ts`). Signed-in visitors recording their own
  time on a shared article would need a reader key; that is deferred.
- **No timestamp columns.** The row holds a running total, not a history.
- **The upsert adds**: `insert … select … join block_identities … on conflict do update set seconds =
  reading_time.seconds + excluded.seconds`. The join drops ids this article has never had, so one
  stale id does not fail the batch.
- It is an ordinary additive migration, generated with `npm run db:generate`.

## The wire

- `GET /api/reading-time/:slug` → `{ seconds: Record<BlockId, number> }`. 404 for a slug the caller
  does not own.
- `POST /api/reading-time/:slug` with `{ seconds: Record<BlockId, number> }` → 204. **400** if the
  body is not that shape, has more than 5,000 entries, has a key that is not a block id, or has a value
  that is not finite, is ≤ 0, or is over 3,600. 404 as above.
- **Each batch is sent at most once.** An additive POST cannot be retried safely: if the server
  committed a request and the answer was lost, a retry would count it twice. `leavingFetch` cannot
  report failure at all (GPT Sol, finding 2). So pending seconds are **taken and cleared before** each
  send, and a failed send is dropped. Normally at most a minute of reading is lost to a failure; the
  first batch can also contain however long the opening read took. The loss is accepted; retrying
  would need idempotency keys and server-side deduplication, which are deferred. **An ordinary flush
  waits for the opening GET**, or a slow GET can include a batch the
  client still also holds in its local display total. A new mount's GET likewise waits for any cleanup
  POST still in flight from the preceding mount, or a quick trip through Metadata can make the mark
  disappear until the next reload. The minute flush and the `hidden` flush use `apiFetch`, and
  `pagehide` sends only what is still pending, with `leavingFetch`
  ([`lib/api.ts`](../../src/web/lib/api.ts)). A real teardown sends immediately; a bfcache page remains
  live and preserves the GET-before-POST ordering. Because nothing is ever re-sent, one batch holds at
  most about a minute of seconds after the opening read, far below the 3,600 cap and the ~60 KiB
  keepalive budget.

## Privacy

[privacy.md](../project/privacy.md) and `/privacy`: the page says there are no advertising or
analytics trackers, and lists what we keep. This feature is neither of those things, since it is shown
only to the reader it is about. But it **is** a new kind of thing we keep, and the list must say so.
The new bullet under *What we keep*:

> **How long you have spent on each part of your articles** — with experimental features on, a running
> total of the seconds each passage has been on your screen, so that the spine and the margin can show
> you where you have been. We keep the totals, not a history of your reading sessions (our ordinary
> server logs do show when an update arrived). It is not shown to anybody reading an article you have
> shared, and it goes when the article does.

It says "passage" rather than "paragraph" because headings, figures and lists are counted too. The
logs clause is there because every POST is a timestamped request line naming the slug, so "never
when" would have been false (GPT Sol, finding 4). `LAST_UPDATED` is bumped, and a paragraph in
privacy.md records why.

**Both export projections carry it**, because `ARTICLE_TABLE_COVERAGE` requires an answer for each
(GPT Sol, finding 7). The reader bundle gets `augmentations/reading-time.json`, and the rollback gets
`reading-time.json` beside `glossary-lookups.json`. The pinned manifest in
`tests/store-artefact-manifest.test.ts` and the sentinel seeder in
`tests/store-export-covers-tables.test.ts` both learn about it.

## Stages

1. **Server**: the schema, the migration, `ReadingTimeStore` (`read`, `add`) in
   `src/store/pg-reading-time.ts`, the two routes, both export projections, and the drift test's table
   list. Tests: adding accumulates; unknown ids are dropped; another owner's slug 404s on both verbs;
   each validation arm 400s; both exports carry the data; deleting the article removes the rows.
2. **Recorder**: pure `shareVisible(rects, viewport)`, `firstOnScreen` and `readLevel(seconds, words)`
   in `src/web/reading-time.ts`, with numeric unit tests (0 words, 300 words, a row taller than the
   window, two rows splitting a second). `useReadingTime` owns the interval, the gates, the refs and
   the flushes, and is tested with fake timers and stubbed rects: reading the first screen with no
   gesture counts; a hidden page, an idle reader and a closed gate earn nothing; returning to a visible
   page after a long absence counts again; a failed flush is **not** re-sent; hidden followed by
   pagehide does not send the same seconds twice; level state changes only when a level changes.
3. **Display and copy**: the capability wiring and the gate in `Reader`; the spine layer and its order
   test; the gutter's style element and CSS; the two house-rule comments; `/privacy`; and docs (a short
   `reading-time.md` under the reading-view entry point, plus experimental-features.md's list). Then a
   browser check on the box (a Playwright subagent) that **reads to about 40% at a steady pace,
   lingers on one screen, and reloads**, and checks that the spine shows a frontier at that point and
   that the lingered screen is no thinner than the rest. At desktop width, and at phone width in Plain
   mode.

Each stage ends green (scoped tests, `npm run typecheck`) and committed. GPT Sol reviews the code
before it is pushed.

## Deferred, named

- **History as a stacked list in the bottom bar**: Greg's other idea, not this report's half.
- **A "take me to the furthest I read" button.** The spine is enough to find that place by eye, and a
  button is one more control.
- **Weighting towards where the eye is** (the reading line at 35% of the viewport) rather than sharing
  a second by area.
- **Keeping unsent seconds across a closed tab** (`localStorage`), and **retrying a failed batch**
  (which needs idempotency keys). At most a minute is lost either way.
- **Recording for every owner**, not only those with experimental features on: Fable's dissent.
- **Subtracting the bottom bar** from the viewport.
- **Signed-in visitors' own time** on a shared article (needs a reader key, above).
- **A "forget my reading time" control.** Deleting the article, or asking by email, does it today.
- **Showing it anywhere else**: the shelf's "% read", the outline, the metadata page.

## The simpler thing passed over

**Keep it in `localStorage` and send nothing.** No table, no routes, no privacy line. It loses on
two counts: Greg asked for the server in so many words ("every minute, we send an update to the
server"), and a place kept in one browser is not there on another device, or after the browser clears
site data, which Safari does to a site's storage on its own schedule.
