# Reading time on the spine, drawn as an area chart

Up: [reading-time.md](../project/reading-time.md). Report `spya-jhe9mc`, Greg, 2026-10-03.

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

## What is there now, and why it cannot be read

The spine already draws what he describes, in outline: `.spine-read` is a bar from the rail's left
edge, a quarter of the rail wide per `ReadLevel` (Spine.tsx, spine-marks.ts § `readingRuns`,
spine.css). Three things make it unreadable:

1. **It is `--ink` at 0.28 opacity over the part's tan tint** — a slightly paler tan. No edge, no hue.
2. **Four widths only**, of a 12px rail: 3, 6, 9, 12px. No "wiggly line", just blocks.
3. **It is painted under `.spine-here`**, so in the section you are in it is washed out further.

## What we build

One `<svg class="spine-read">` over the whole track, in the same tree position as today's runs:

- **A filled area in a colour of its own**, semi-opaque, from the left edge out to each block's
  *reach*.
- **A solid 1px line down the area's right-hand edge** — the water level. Drawn only along read
  stretches, with the horizontal joins between neighbouring read blocks; an unread stretch has no
  area and no line, so "nothing there" keeps meaning "not read".
- **Reach is continuous-ish**: sixteenths of the rail rather than quarters, on the same doubling
  scale as `readLevel`, so the level boundaries do not move: under 0.35 of the reading time draws
  nothing; 0.35 → 4/16; 0.7 → 8/16; 1.4 → 12/16; 2.8 and over → 16/16; in between,
  `floor(4 × log2(ratio / 0.175))`. `readReach(seconds, words)` in reading-time.ts, with
  `readLevel === floor(readReach / 4)` asserted over a sweep in the test.
- **A new token `--read-time`** in tokens.css, dark and light, a cool hue that is not the part tint,
  the brand orange, or any search-slot colour. colour-scales.md gets its line.

### The parts

- `reading-time.ts`: `ReadReach` (an integer, 0 or 4…16) and `readReach`.
- `useReadingTime.ts`: a second state map `reach`, updated in the same `recompute` as `levels`.
  `levels` stays for the gutter hairline and the quiz, untouched.
- `spine-marks.ts`: `readingRuns` takes the reach map and returns `{top, height, reach}`; a pure
  `readingAreaPaths(runs, docHeight)` returns the two path strings (`area`, `edge`).
- `Spine.tsx`: the `reading` prop becomes the reach map; one svg, `viewBox="0 0 16 <docHeight>"`,
  `preserveAspectRatio="none"`, the edge with `vector-effect: non-scaling-stroke`.
- `Reader.tsx` passes `readingTime.reach`.
- spine.css § reading time, help-topics.tsx (two sentences that say "grey shading"),
  reading-time.md.

### Passed over

- **Only recolouring the four bars.** Cheapest, and fixes cause 1. Passed over because the report
  asks by name for a line whose distance from the margin is the amount, and four steps of 3px is
  not that. The extra cost here is one function and one state map.
- **Smoothing the line into a curve.** It would draw reach where there is none (between a read and
  an unread block). A step outline at 2–3px a block already wiggles.
- **Moving it above `.spine-here`.** The order is asserted and argued in Spine.tsx. A hue and an
  opaque edge should survive the wash; the browser check decides, and if it does not, that is a
  question for Greg rather than a silent reorder.
- **A chart wider than the rail** — see the open question.

### Cost

The Spine re-renders when a block's reach changes: a step every ~0.2 of a block's reading time
rather than every doubling. With a screenful of blocks sharing each second that is a render every
few seconds while reading, of a component that already re-renders when the reader crosses a section.

## Open question for Greg, not waited on

**[Q-jhe9mc-1] Should the chart be allowed more room than the 12px rail?** Built: inside the rail.
The alternatives are a wider rail everywhere (costs prose width on every screen) or a chart that
spills to the right over the page margin on hover. Recommendation: live with the 12px version for a
few days first.

## Stages

One stage. Done means: tests red first then green (`tests/spine-reading.test.ts`,
`tests/reading-time*.test.ts`), a mutation seen to turn them red, typecheck, a Sol code review, and a
browser check at desktop, iPad and phone widths with a seeded reading-time map.

## GPT Sol's plan review — build after fixes

[The review](261003j-reading-time-area-chart-plan-review-sol.md). All four accepted.

- **F1 (P1, established)** — the bare formula runs one step ahead just *below* 1.4 and 2.8 through
  floating point. Fix: `readReach` takes the level from `readLevel`; 0 → 0, 4 → 16, otherwise the
  log result clamped to `[4 × level, 4 × level + 3]`. Tests at each boundary and the representable
  value either side.
- **F2 (P2, established)** — a reach update re-renders `Reader`, whose `selectProse` callback
  depends on the whole `owner` object and so defeats `TableView`'s memo. Already true of a level
  change; this makes it more frequent. Fix: verify the chain, depend on what the callback uses, and
  show a reach-only update does not re-render `TableView`. The cost paragraph above is wrong about
  a fixed interval: the steps are log-spaced.
- **F3 (P2, reasoned)** — at full reach a centred 1px stroke at x = 16 is half clipped. Fix: keep
  the edge inside the rail (inset the far end by half a CSS pixel), and seed a saturated stretch in
  the browser check.
- **F4 (P2, established)** — `tests/use-reading-time.test.tsx` must cover the new map: reach moves
  inside an unchanged level while `levels` keeps its identity; unchanged reach keeps its identity;
  off and a new article clear it; the opening GET combines with local credit.

Sol also notes `.spine-here` is a 0.8 wash, so the edge under it keeps a fifth of its colour. The
browser check looks at exactly that.

## What landed

- As planned, in `dd80f1158`, plus the commit after it.
- **The edge line is a second svg, `.spine-read-line`, over `.spine-here`.** The browser check found
  that inside the section you are in the chart survived only as a ghost: the area a faint tint, the
  line a washed-out stripe. The area stays under the fill; the 1px line alone moves above it, still
  under the ticks and the search marks. This is the reorder § Passed over said would not be made
  silently, so it is in the debrief to Greg; it costs the *you are here* one pixel of line.
- **Search marks cover the edge where they coincide**, most on a full-reach stretch. Left: the
  reader asked for the marks, and the chart is intact outside them.
- **`--read-time` is a cyan**, `oklch(0.82 0.11 200)` dark and `oklch(0.5 0.1 200)` light. No hue on
  the rail is free; tokens.css says what its neighbours are.
- **F3 is solved in CSS** (`width: calc(100% - 0.5px)`, `overflow: visible`), not in the path.
- **Runs under a document pixel apart count as joined**, because row edges are measured floats.
  Sol: a reasoned concern only — a visible row is 24px at least and a folded one is zero high.
- **GPT Sol's code review — land after fixes**
  ([the review](261003j-reading-time-area-chart-code-review-sol.md)). It fixed F5 (`marginNotes`
  also depended on the whole owner object, so with marginalia open a reach update still re-rendered
  `TableView`; now a render-count test through the real `Reader`,
  [postmortem](../postmortems/261003d-a-callback-dependency-check-misses-another-prop-invalidating-the-memo.md))
  and F6 (Help said no shading means not read; a glance also draws nothing). F7, two signposts
  still saying "thicker", fixed here.
- **Browser check** at 1440, 820 and 390 wide, dark and light: read and unread tell apart at a
  glance; the edge is whole at full reach; the quote strip covers the area's left 4px and no more.
  Shots: `261003j-shot-*.png`.
- Not built: anything wider than the rail ([Q-jhe9mc-1]); touch has no card on the chart, as before.
