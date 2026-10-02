# 261002e — the reading-time line brightens more slowly, and its card says the time

An admin suggestion from Greg, provenance confirmed with `scripts/feedback-reporter.ts` (exit 0).
Owner: [reading-time.md](../project/reading-time.md).

> For the reading timeline, I think it gets brighter when I read a block for more time. It seems to
> get brighter too fast. There's lots of blocks that have lines next to them that I think I haven't
> spent that much time on. So maybe increase the threshold or basically slow down the rate at which
> it gets brighter.
>
> Or make it kind of, I don't know, like finishing marginal returns of brightness with passing of
> time. And also add the time spent to the tooltip. Play at the tooltip with a rich tooltip.
>
> — Greg, 2026-10-01 19:50 (spya-d940uu, SPIDERYARN-READING2-9N)

## What is there now

[261001r](261001r-reading-time-line-gets-a-rich-card-and-grows-lighter-cross-references-quieter-than-the-glossary.md)
landed at 22:40, after this report: the line has a rich card (`BlockLinkCard.tsx` § `ReadingCard`)
and a steeper opacity ramp, 0 / .05 / .15 / .30 / .50 for levels 0–4. Its card deliberately says
nothing about *this* passage — Sol's plan review warned that a level read once would go stale while
the card is open.

The levels come from `readLevel` (reading-time.ts): the ratio of seconds spent to the time the
block takes at 230 wpm.

| level | ratio today | opacity |
|---|---|---|
| 1 | ≥ 0.10 | .05 |
| 2 | ≥ 0.35 | .15 |
| 3 | ≥ 0.70 | .30 |
| 4 | ≥ 1.00 | .50 |

So a 100-word paragraph (26 s to read) shows a line after **2.6 s**, and is at full strength after
26 s. A screen of prose shares each second by area, so scrolling slowly through a section leaves a
line on everything it passed. That is what Greg saw.

The 261001r ramp made the *top* steeper and the bottom zero; it did not change *when* a level is
reached, which is what this report is about. The two reports do not pull against each other here:
"no line until read" and "not too bright too soon" both say the time thresholds are too low.

## What we do

### 1. Thresholds that double — progressively delayed levels

Each level needs **twice** the time of the one before, starting later:

| level | ratio new | 100-word paragraph | opacity |
|---|---|---|---|
| 1 | ≥ 0.35 | 9 s | .05 |
| 2 | ≥ 0.70 | 18 s | .15 |
| 3 | ≥ 1.40 | 37 s | .30 |
| 4 | ≥ 2.80 | 73 s | .50 |

Each step comes twice as late as the one before. Strictly that is *progressively delayed
thresholds*, not a pure diminishing-returns curve: the opacity steps grow (.05, .10, .15, .20), so
level 1→2 buys more brightness per second than 0→1 did (Sol, plan review, P3). Past one read, though,
each extra second buys less. A glance (under a third of the reading time) draws nothing; reading it
once at a brisk pace is a faint line; full strength is a slow read, or nearly three — what a careful
read of a paper looks like.

The spine's thickness reads the same levels, so it slows the same way. That is wanted: it is the
same claim drawn smaller.

**The quiz's "Only what I've read" keeps its meaning exactly.** `READ_ENOUGH` (read-filter.ts) is
level 3 = 0.7× today; under the new table 0.7× is level 2, so it becomes 2 and the comment says why.
The 0.70 boundary is kept on purpose so this change moves no quiz question.

### 2. The card says how long you have spent here

The card's first line becomes live and specific to the row: **"About 1 min 20 s here, of the
~26 s it takes to read."** (and "Under a second here" below 1 s). Then the existing explanation of
what the line is and when it counts.

- **Where the seconds come from**: `useReadingTime` already holds `server` + `local` seconds per
  block inside its effect. It exposes a stable `timeFor(id) → { seconds, expected } | null` through
  a ref the effect fills, so nothing re-renders to offer it. `null` when recording is off.
- **Live, not read once**: `ReadingCard` takes the row's block id (the strip's
  `closest("tr[data-block]")`) and `timeFor`, and re-reads it once a second while it is mounted —
  one card, one interval, gone when the card closes. That answers Sol's staleness point rather than
  dodging it.
- **Plumbing**: `BlockLinkProvider` gets an optional `readingTimeFor` prop beside `resolveXref`;
  Reader passes `owner?.readingTime.timeFor`. A visitor never has the strip anyway (owner only).
  Absent ⇒ the card falls back to today's words without a time.
- **Words, not a stopwatch**: a small `spentWords(seconds)` in reading-time.ts — "45 s",
  "1 min 20 s", "14 min" (seconds dropped from 10 min up). Not `mic-recording.ts`'s
  `formatDuration`, which is `m:ss` for a running timer.

## Passed over

- **A continuous opacity** (say `log(ratio)` directly, no levels). Smoother, but the level map is
  deliberately four steps so the spine merges runs and the style sheet changes only when a block
  crosses one (reading-time.ts § `readLevel`). Doubling thresholds get the shape with none of that
  rework.
- **Only raising the thresholds** (×2 everywhere). Simpler by one sentence, but keeps the linear
  spacing Greg asked us to move away from, and moves the quiz boundary.
- **Changing the opacity ramp again.** 261001r set it a day ago for the opposite-sounding report;
  the time axis is what is wrong.

## Deferred

- Touch: the card still does not open on a tap (unchanged from 261001r).
- A per-reader reading speed (calibrating 230 wpm to you). A real improvement, but a new idea with
  its own questions; the doubling ladder is tolerant of speed differences.

## Tests

- `tests/reading-time.test.ts` § `readLevel`: the new boundaries, red first.
- `spentWords` cases.
- A jsdom test that the reading card shows the row's time and updates while open (fake timers).
- `read-filter` keeps 0.7×: a test that 0.69× is not read and 0.70× is.
- reading-time.md and quiz.md where they state numbers.

## Browser check

A Sonnet subagent on the box (Playwright): owner article, experimental on; hover a line, see the
time; wait, see it tick.

## Plan review (GPT Sol, 2026-10-02) — what changed

All six findings checked and taken (`…-plan-review-sol.md`). No P0.

1. **P1** tests/use-reading-time.test.tsx encoded the old levels in three places; its fixtures move
   (100 words, and server seconds 25 / 170) so each test still proves what it was about.
2. **P2** The card's "clearest once you have spent as long as it takes to read" and `ReadLevel`'s
   comment became false; both reworded.
3. **P2** Moving straight from one line to the next could keep the first card's state. `ReadingCard`
   reads `timeFor` on every render (the interval only bumps a tick) and is keyed by block id; a test
   hovers A then B without closing.
4. **P2** The lookup ref is cleared *before* the `enabled` guard, installed with the run's own maps,
   and cleared on cleanup only if still its own. Hook tests: stable identity, live seconds, switch
   off → null, another article, StrictMode replay. Removing both clears turns the off test red.
5. **P3** "Diminishing returns" overclaimed the combined curve; corrected above.
6. **P3** "Under a second" is now below 1 s, with 0.5 and 0.99 pinned.

## Code review (GPT Sol, 2026-10-02) and the browser check

No P0–P1 (`…-code-review-sol.md`). Sol fixed in place: tests for an unmounted hook's lookup and for an
open card when recording ends (mutation-checked); exact-boundary cases at 0.35 / 0.7 / 1.4 / 2.8; and
comments that still said each step "costs twice" or that two reads reach full strength. Its one
wider P3, two CSS comments (gutter.css, spine.css) that said a glance shows a sliver, is fixed too.

Browser, on the box (Playwright, Sonnet subagent, `fowler-phrenology`): the card opens on hover with
"You have spent 1 min 58 s here. It takes about 3 s to read."; moving straight to another row's line
changes it at once ("4 min 27 s … 9 s"); no "darker"; no console errors from the change
([shot](261002e-shot-card.png)). The time ticks up, but slowly: a second is shared by area between
the ~19 rows on screen, so one row gains about a tenth of a second per second. That is the
recorder's design (reading-time.ts § `shareVisible`), not a fault in the card. The seeded rows were
all at level 4, so the opacity ladder was not re-measured across levels; it is unchanged CSS.
