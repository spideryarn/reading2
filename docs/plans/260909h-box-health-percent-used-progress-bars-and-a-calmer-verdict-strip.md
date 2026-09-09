# Box health: % used everywhere, a bar on every tile, and a calmer verdict strip

Up: [fleet-dashboard-modes.md](../project/fleet-dashboard-modes.md) ·
built on [260908f-box-health-history-24h-graphs-and-swap-retention.md](260908f-box-health-history-24h-graphs-and-swap-retention.md)

> In Box Health mode of the Overseer web dashboard, always show X% used rather than 100-X% free.
> And probably move down the bar showing the orange/green Swap and/or make it less lurid, because
> it seems to be dominating the graphs - is it the most important? And in general, if possible show
> something like a progress bar to indicate visually how full/busy things are.
>
> — Greg, 2026-09-09

Three asks about one page: [`HealthPanel.tsx`](../../tools/fleet/web/src/HealthPanel.tsx), its tile
reader [`health-view.ts`](../../tools/fleet/web/src/health-view.ts), and the 24-hour chart
[`HealthHistory.tsx`](../../tools/fleet/web/src/HealthHistory.tsx) /
[`history-series.ts`](../../tools/fleet/web/src/history-series.ts). No collector measurement or
threshold change: `health.ts` keeps reporting exactly what it reports; only its reader-facing
reason wording changes below.

## 1. One direction, and it is "used"

Today the page mixes the two directions. Four readings say *used* — swap 37%, disk 52%, IO wait 0%,
load 0.5× — and one says *free*: the tile **Memory free 55%**, the chart **Memory available**. A
reader scanning five numbers has to flip one of them in their head, and it is the one whose colour
runs the other way, which is exactly where a misread is expensive.

So: **Memory used**, `100 − availableFraction`, with the sub-line `14 GiB of 31 GiB in use`. The
chart series becomes `Memory used`, which also makes its sentence read `peak 64%` rather than
`low 36%` like the other three. Once every series ran upward, the old `worseIs` direction switch
was removed rather than kept as dead machinery.

**The cutoff must not move when the direction does — and it nearly did.** The plan said `used > 85`
was the exact complement of `availableFraction < 0.15`. **GPT Sol showed that it is not**, once a
double has been through a subtraction:

```
availableFraction = 0.14999999999999997
0.14999999999999997 < 0.15          → true   (the collector: strained)
100 - 0.14999999999999997 * 100     → 85     (exactly)
85 > 85                             → false  (the tile: ok)
```

An amber badge over a green tile, on a value no round-numbered test would ever produce. So the built
version decides **the tone on the collector's own number in the collector's own direction**, and
flips only what is drawn and what is written. `MEMORY_USED_PERCENT` survives for the tooltip, the
chart's bands and the label — none of which is a judgement about a particular reading — and
`tests/fleet-web.test.tsx` pins both of the values above.

**One more place said "free"**: `computeVerdict`'s own reason strings, rendered verbatim on the
verdict card above the tiles ("available memory is 12.3% of total"). Also Sol's. They now read
`memory is 87.7% used — 12.3% available`; the comparison behind them is untouched.

Disk's sub-line goes the same way: `139 GiB free on /` → `139 GiB of 292 GiB used`. `usedKiB` and
`totalKiB` are both already in the reading.

*The simpler option passed over*: leave memory alone and add "(available)" to the label. Rejected —
it is the mixing itself Greg is objecting to, and a parenthesis does not unmix it.

## 2. The strip: moved down, and calmed

The orange-and-green barcode at the top of the last-24-hours card is the **verdict strip** — one
band per pixel column, the collector's own `verdict.level`, worst-wins. It has no heading (the four
charts below it all have one), which is very likely why it read as a swap bar. It is at full
saturation across the whole day, so a box that has been *strained* for six ordinary hours looks like
a six-hour emergency, and it is the loudest thing on a card whose actual subject is the four lines
underneath.

Three changes, all presentational:

- **Move it below the four series**, immediately above the legend, and let the time axis
  (`10:02 PM · 24 hours · now`) travel with it, where it now serves all five plots instead of one.
  The gap / retention / before-history sentences **stay at the top**: they are about the record, not
  about the strip, and reading a break as a fault is the failure that card was built to prevent.
- **Give it a label row like every other plot has**: `VERDICT` on the left, and on the right the
  totals, worst first — `critical 2m · strained 6h 12m · ok 17h`. That is new information, not decoration: it is
  the only place the day's damage is stated as a number rather than as a colour, and it is what
  makes the strip legible to a screen reader and to anyone who reads pages by their words.
- **Saturate by severity rather than uniformly.** `ok` is a 22% tint (quiet but still visibly
  green), `strained` is 50% amber, `unknown` is 55% violet, and `critical` stays full red. Direct
  SVG colour plus opacity provides the tint without making `color-mix()` support a condition of
  seeing the strip. The step that matters most — amber to red — gets *bigger*, not smaller, while
  the day stops shouting.

*Not changed*: the orange bar along the bottom of the IO-wait chart (pages actually moving to or
from swap). It is the other orange bar on the card and it is a candidate for what Greg meant, but it
is one 4px mark inside one chart, it is the only drawing of an event `health.ts` is emphatic must
not be folded into a percentage, and its own sentence is beside the label. Flagged in the reply
rather than changed unasked.

*The simpler option passed over*: delete the strip. Rejected — it is the only thing on the page that
answers "was there trouble overnight", which is the question the card exists for.

## 3. A bar on every tile

Each `Stat` gains an optional bar, drawn under the number: a track, a fill in the tile's own tone,
and **tick marks where amber and red begin**. So the tile becomes a small vertical slice of the
chart below it — same cutoffs, same colours, one source.

| Tile | Fill | Ticks |
|---|---|---|
| Load | `ratio / 8`, the chart's own ceiling (`critical × 2`) | 2×, 4× |
| Memory used | `used / 100` | 85%, 95% |
| Swap used | `used / 100` | 90%, 98% |
| Disk used | `percent / 100` | 90%, 97% |
| Swap & IO | `waPercent / 100`, **and only when the big number is that percentage** | 50% |

**The rule the bar keeps: it measures the big number, or it does not appear.** So: no bar for a
reading that could not be taken (violet dash), none for `swap: none`, none for a swap-activity
sample that was not taken, and — Sol's catch — **none on the turns when the Swap & IO tile's big
number is the word "swapping"**, because a box swapping hard at 0% IO wait drew an empty track under
an amber alarm, which reads as *nothing is wrong* in the one shape a glance takes at face value. A value past the end of the track is **clipped and marked**, mirroring `overCeiling`
in the chart. `aria-hidden`, because the number and the sub-line above it already say everything the
bar says — the bar is the glance, never the carrier.

*The simpler option passed over*: a bar with no ticks. Rejected for one tile in particular — swap at
37% looks half full and is nowhere near its 90% cutoff, and a bar without its threshold invites
exactly that misread.

## What the plan review changed, and what it did not

GPT Sol reviewed this before it was built ([codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md)).
Taken: the floating-point boundary above (a real defect, and the reason the plan's own test would
have passed while the page was wrong); the verdict-reason strings; no bar under a "swapping"
headline; and dropping `describeGaps` from the strip's `aria-label`, since that sentence is visible
at the top of the card and the two copies would now be heard as two claims.

Two findings overruled, and why:

- *"The verdict totals are scope expansion."* They are the only text this strip has ever had. It had
  no label at all, which is most of why Greg took it for a swap bar, and "colour is never the only
  carrier" is a rule this panel already holds itself to everywhere else.
- *"Bars only for naturally bounded values — memory, swap, disk."* Greg asked for "how full/busy",
  and busy is load. The load ceiling is not arbitrary: it is the chart's own axis, imported, so the
  tile and the graph under it are read the same way.

## What the code review changed

The second review ran write-capable over the built code and fixed five things, all kept:

- **`overseer tick` still printed memory as what remains** — a surface neither the plan nor I had
  looked at. Red test first (`tests/overseer-cli-tick.test.ts`), then `12.5% used · 3.9 of 31 GiB in
  use`.
- **The Load tile's number and its bar were different facts.** The headline was raw load (`8.0`)
  while the tone and the bar were both the ratio, so a 6%-full bar sat under a big `8.0`. The
  headline is the ratio now (`0.5×`) with the raw load in the sub-line — the same rule the Swap & IO
  tile already states: *the headline is whichever fact earned the colour*. **This changes a number
  Greg reads**, which is why it is called out here and in the reply rather than buried.
- **`verdictTotals` was counting the wrong span.** The verdict bands used `gapAfterMs` rather than
  the `coverageMs` the plots use, ignored a covering predecessor at the left edge, and ran straight
  through corrupt-record holes — so the totals could count minutes the chart itself had hatched as
  unobserved. The bands are built from the same canonical coverage now, and the edges are pinned.
- **The over-ceiling notch was red on red**, invisible exactly when it fired.
- **`color-mix()` in an SVG `fill` has no fallback** — an older iOS Safari can treat the whole value
  as invalid. Direct colour plus `fill-opacity` gives the same graded scale and degrades.

It also deleted `SeriesSpec.bands.worseIs`, which existed only for the memory series that now runs
the same way as the other three. Accepted: it was dead the moment the direction was unified, and
leaving a direction switch with one direction in it is an invitation to a future series being
plotted upside down without anybody noticing.

## Checks

- `tests/fleet-web.test.tsx` — the tile boundary tests move to used-space; add one pinning
  `availableFraction: 0.15` as **ok** on both the tile and the chart band, which is the
  direction-flip bug this plan could introduce.
- `tests/fleet-history-series.test.ts` — memory's worst point is a peak; verdict durations use the
  same clipped coverage as the gaps, including a predecessor at the left edge and excluding holes.
- `npm test`, `npm run typecheck`, browser pass at 420px and 1000px against the real box.
