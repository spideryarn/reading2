/**
 * Where a search's matches go in the bird's-eye rail — the arithmetic half of
 * Spine.tsx § Search results down the rail.
 *
 * Greg, 2026-08-26:
 *
 * > add dots/thin vertical lines of the relevant search-colour in all the
 * > places where there's a match in the Spine so it's easy to see at a glance
 * > where the results are in the doc (and how common)
 *
 * A file of its own for the reason layout.ts is one: this is arithmetic with
 * three ways to be quietly wrong, and none of them are visible in a screenshot
 * — a mark in the wrong lane looks exactly like a mark in the right lane, and a
 * mark placed by the wrong ruler looks exactly like a mark placed by the right
 * one until you compare it against the band it is supposed to be inside. The
 * component measures the DOM and paints; everything that could be a wrong
 * number is here, where a test can read it.
 *
 * ## The ruler, which is the thing to get right
 *
 * Every position in here is in **document pixels**, taken from the rows the
 * spine has already measured. `Found.at` — the "42% in" a result row prints —
 * is a different ruler: it counts *characters*, deliberately, because that is
 * the cheap stand-in for height when you have no DOM (search-hits.ts § Ruler).
 * The two answer the same question and disagree, sometimes by a lot: twenty
 * one-line list items hold few characters and a great many pixels. Using the
 * character ruler here would put marks in the wrong band, which is the one
 * thing a bird's-eye rail must not do, and it would do it without ever looking
 * broken.
 */
import type { BlockId } from "../types.js";
import type { JumpOrigin } from "./jump-history.js";
import type { ReadReach } from "./reading-time.js";
import type { BlockMatch, Found, MatchingSearch } from "./search-hits.js";

/** One block's row, in the rail's document-pixel space. */
export interface Row {
  /** Its index among the table's rows — what a band's `startRow`/`endRow` name. */
  index: number;
  top: number;
  height: number;
}

/** As much of an outline band as placing a mark inside it needs. */
export interface BandSpan {
  id: string;
  startRow: number;
  endRow: number;
}

/** One coloured bar in the rail. */
export interface SpineMark {
  key: string;
  top: number;
  height: number;
  /** Which track from the right-hand edge it sits in. */
  lane: number;
  /** A CSS colour *expression*, never a hex — see `laneColour`. */
  rgb: string;
}

/**
 * The lane each **search** draws in, by its run id (`""` for a literal match).
 *
 * **Keyed by the run and not by the palette slot**, which is a correction from
 * a GPT Sol review, 2026-08-26. Slots deliberately repeat past the eighth
 * search (hit-colours.ts § assignSlots) and select-all switches on every saved
 * search there is, so a slot-keyed lane merges the ninth search with whichever
 * earlier one shares its hue — one lane carrying the union of two searches'
 * shapes, which is the opposite of what a lane is for and looks like nothing at
 * all. Two searches wearing one colour now get two lanes, which is honest: the
 * palette has run out, and the panel says so by printing the criterion beside
 * every dot.
 *
 * **Packed, not fixed.** Lane `n` is the `n`th *search that actually matched
 * something*, so two searches get two lanes whichever of the eight palette
 * slots they happen to wear. Keying the lane off the slot number instead would
 * be stable under every change — nothing would ever move sideways — at the
 * price of a rail permanently divided into eight tracks, six of them empty and
 * each two pixels of bar. That trade is the wrong way round for a rail whose
 * whole job is to be readable out of the corner of the eye.
 *
 * The cost is real and worth stating: switching on a search that sorts before
 * an existing one shifts the existing one's lane. It is the same class of thing
 * as a saved search being recoloured when you delete the one above it
 * (hit-colours.ts § the honest cost), and it is much milder — the *colour*,
 * which is what says whose match it is, does not move.
 *
 * Ordered by slot and then by run id, the same order `blockMatches` puts a
 * block's searches in, so lanes read left-to-right in palette order and two
 * searches sharing a hue end up adjacent rather than at opposite edges.
 *
 * Searches that matched nothing take no lane at all. A search switched on with
 * no results should not push the others sideways to make room for a track that
 * stays empty.
 */
export function laneOrder(matches: Map<BlockId, BlockMatch>): Map<string, number> {
  const present = new Map<string, MatchingSearch>();
  for (const match of matches.values()) {
    for (const search of match.searches) present.set(search.runId ?? "", search);
  }
  const order = [...present.values()].sort((a, b) => {
    const slotDiff = (a.slot ?? -1) - (b.slot ?? -1);
    if (slotDiff !== 0) return slotDiff;
    const left = a.runId ?? "";
    const right = b.runId ?? "";
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return new Map(order.map((search, lane) => [search.runId ?? "", lane]));
}

/**
 * The CSS colour a lane paints in — the only place a slot becomes a hue.
 *
 * `null` is the literal matcher, which belongs to no saved search and therefore
 * has no categorical colour; it wears the one fixed search hue, the same
 * `--hit-rgb` the wash under a phrase uses. Everything else resolves through
 * `styles/colourscales.css`, so the palette stays editable from the stylesheet
 * — the seam src/web/hit-colours.ts exists to keep, and the reason nothing in
 * this file ever returns a hex.
 */
export function laneColour(slot: number | null): string {
  return slot === null ? "var(--hit-rgb)" : `var(--cat-${slot}-rgb)`;
}

/**
 * Every bar to draw, one per (block, search) pair.
 *
 * A paragraph two searches both found gets two bars side by side rather than
 * one bar of a compromise colour — the same choice the paragraph bar makes, for
 * the same reason: the colour is what says *whose* match it is, and a blend
 * says nobody's.
 *
 * A match naming a block the page does not have is **skipped**, not drawn at
 * the top. That happens when saved results outlive a re-extraction, and a mark
 * pointing at the wrong paragraph is worse than a missing one — it is the only
 * failure here the reader would act on.
 *
 * Sorted by position so the DOM order is reading order. Nothing renders
 * differently for it; it means a snapshot of the rail can be read down the page
 * like the article, and it costs one sort of a list that is at most a few
 * hundred long.
 */
export function spineMarks(
  rows: Map<string, Row>,
  matches: Map<BlockId, BlockMatch>,
  lanes: Map<string, number>,
): SpineMark[] {
  const out: SpineMark[] = [];
  for (const [blockId, match] of matches) {
    const row = rows.get(blockId);
    if (!row) continue;
    for (const search of match.searches) {
      const lane = lanes.get(search.runId ?? "");
      if (lane === undefined) continue;
      out.push({
        /* The run id and not the slot, for the reason `laneOrder` gives: past
           the eighth search two of these would otherwise be the same string,
           and React drops duplicate-keyed siblings with a warning nobody
           reads — so one of the two lanes simply would not be drawn. */
        key: `${blockId}:${search.runId ?? ""}`,
        top: row.top,
        height: row.height,
        lane,
        rgb: laneColour(search.slot),
      });
    }
  }
  out.sort((a, b) => a.top - b.top || a.lane - b.lane);
  return out;
}

/**
 * How many matches fall inside each band, by the band's node id.
 *
 * This is where "how common" gets a number rather than a shape. The rail shows
 * the distribution; the band's hover card says *four matches in this section*,
 * which is the thing a two-pixel mark cannot.
 *
 * Counted by **row index** rather than by pixel, because that is what a band
 * actually is — `startRow`/`endRow` come straight from the outline. Comparing
 * tops would give a different answer for a block sitting exactly on a band
 * boundary, and which answer would depend on sub-pixel rounding, so the same
 * article could count differently at two window widths.
 *
 * `endRow` is **inclusive**, matching the outline. Getting that off by one
 * would move a section's last paragraph into the next section's count, which is
 * wrong by an amount nobody would ever notice.
 *
 * Bands with nothing in them are left out rather than stored as `0`, so the
 * caller can ask `has` rather than `> 0` and a card can say nothing at all.
 */
export function bandMatchCounts(
  rows: Map<string, Row>,
  matches: Map<BlockId, BlockMatch>,
  bands: BandSpan[],
): Map<string, number> {
  const counts = new Map<string, number>();
  if (matches.size === 0) return counts;
  /* Resolved once, outside the band loop. Bands and matches are both in the
     hundreds at worst, and doing the lookup inside would make this a map
     lookup per pair rather than per match. */
  const placed: { index: number; count: number }[] = [];
  for (const [blockId, match] of matches) {
    const row = rows.get(blockId);
    if (row) placed.push({ index: row.index, count: match.count });
  }
  for (const band of bands) {
    let n = 0;
    for (const { index, count } of placed) {
      if (index >= band.startRow && index <= band.endRow) n += count;
    }
    if (n > 0) counts.set(band.id, n);
  }
  return counts;
}

/* ------------------------------------------ where the reader jumped from -- */

/**
 * A bar in the rail that belongs to no lane — where and how tall, and nothing
 * else.
 *
 * **Deliberately not a `SpineMark`.** That type carries a `lane` and an `rgb`,
 * and both are search vocabulary: lanes are *packed* by `laneOrder`, so
 * anything holding one has to be given a track out of the same 10px gutter, and
 * every search would move sideways to make room for it. Being a different shape
 * is what makes that impossible rather than merely avoided.
 */
export interface OriginMark {
  top: number;
  height: number;
}

/**
 * **One faint tick at the block the reader jumped from**, or `null` for nothing
 * to draw — Stage C of docs/plans/260906g-back-to-where-you-jumped-from.md.
 *
 * The chip (ReturnChip.tsx) says *where* the reader can go back to, in words;
 * this answers the thing a label cannot, which is **how far they came**. Same
 * datum as the chip — `readStamp(history.state)`, through `useJumpOrigin` — so
 * there is no second record to keep in sync and no decay curve to learn. Greg
 * asked for a fading trail of previous locations; the plan's § Why not the
 * fading spine trail is the argument for one mark instead, and it is the rail's
 * own rule: it acquires marks when the reader asks for them and at no other
 * time.
 *
 * **Two of the three ways to draw nothing are the point of the function**, and
 * neither looks wrong if you get it wrong:
 *
 * - **`top` is not a block.** The origin is `top` precisely because no row had
 *   reached the reading line (jump-history.ts § JumpOrigin, GPT Sol F8), so
 *   marking the first row would claim the reader was standing in the first
 *   paragraph when they were looking at the masthead. The chip says "back to
 *   the beginning", which is the whole of the information.
 * - **A block this page no longer has** — a stamp that outlived a
 *   re-extraction — is skipped rather than placed at zero, the same choice
 *   `spineMarks` makes for a stale search result and for the same reason.
 */
export function jumpOriginMark(
  rows: Map<string, Row>,
  origin: JumpOrigin | null,
): OriginMark | null {
  if (origin === null || origin.kind === "top") return null;
  const row = rows.get(origin.blockId);
  return row ? { top: row.top, height: row.height } : null;
}

/** One stretch of the rail read to the same reach — `readingRuns`. */
export interface ReadingRun {
  top: number;
  height: number;
  /** Sixteenths of the rail's width, 4 to 16 — reading-time.ts § `readReach`. */
  reach: ReadReach;
}

/**
 * **Where you have spent time reading, as runs down the rail** —
 * docs/plans/260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md.
 *
 * > maybe the spine is narrower in places where we haven't spent much time
 * > reading and thicker in places where we have spent time reading.
 * >
 * > — Greg, 2026-09-12
 *
 * Neighbouring rows at the same reach become one run, which keeps the path
 * short on a two-thousand-block article. **Neighbouring means adjacent
 * `index`**, not adjacent in the map: a row this page does not have, or one
 * with no reach, ends the run rather than being bridged, so a gap the reader
 * skipped stays a gap. Rows are placed by the same document-pixel ruler as
 * every other mark here. Thickness was four widths until 2026-10-03; it is a
 * reach in sixteenths now, and `readingAreaPaths` draws it.
 */
export function readingRuns(
  rows: Map<string, Row>,
  reach: ReadonlyMap<BlockId, ReadReach>,
): ReadingRun[] {
  const lit: { index: number; top: number; bottom: number; reach: ReadReach }[] = [];
  for (const [id, r] of reach) {
    if (!(r > 0)) continue;
    const row = rows.get(id);
    if (row) lit.push({ index: row.index, top: row.top, bottom: row.top + row.height, reach: r });
  }
  lit.sort((a, b) => a.index - b.index);
  const runs: ReadingRun[] = [];
  let prev: (typeof lit)[number] | undefined;
  for (const r of lit) {
    const last = runs[runs.length - 1];
    if (last && prev && prev.index + 1 === r.index && prev.reach === r.reach) {
      last.height = r.bottom - last.top;
    } else {
      runs.push({ top: r.top, height: r.bottom - r.top, reach: r.reach });
    }
    prev = r;
  }
  return runs;
}

/** The two paths of the rail's reading-time chart — `readingAreaPaths`. */
export interface ReadingAreaPaths {
  /** The filled area: `edge`, with each stretch closed down the rail's left side. */
  area: string;
  /** The line along the area's right-hand side. Never closed, never filled. */
  edge: string;
}

/**
 * The furthest an ease may reach either side of a boundary, as a share of the
 * document's height: 8px each side on an 800px rail, so 16px for a whole join.
 * Without a cap two long runs would be joined by one long slope, and neither
 * would show the reach it has.
 */
const EASE_CAP = 1 / 100;

/**
 * How far apart, in document pixels, one run's bottom and the next one's top
 * may be and still be the same stretch. Row edges are measured, so neighbours
 * can disagree by a fraction of a pixel; a row the reader skipped is a line of
 * text tall at least.
 */
const SAME_STRETCH_PX = 1;

/** A path coordinate: hundredths of a unit are finer than anything painted. */
const coord = (v: number): string => String(Math.round(v * 100) / 100);

/**
 * **The reading-time runs as an area chart turned on its side** — x is reach in
 * sixteenths (so the viewBox is 16 wide), y is the rail's document pixels.
 * docs/plans/261003j-reading-time-on-the-spine-drawn-as-an-area-chart.md.
 *
 * > I'm almost imagining like a water level but rotated 90 degrees.
 * >
 * > — Greg, 2026-10-03 (spya-jhe9mc)
 *
 * **A curve, not steps**, since later the same day: a block is two or three
 * pixels of rail, and a step at every boundary drew a row of towers.
 * docs/plans/261003o-spine-reading-chart-quieter-and-smoothed-into-a-curve.md.
 *
 * > what if we were to smooth it a bit so it'd be a bit more like a curve and
 * > less like a bunch of blocks, like skyscrapers on a skyline.
 * >
 * > — Greg, 2026-10-03 (spya-bguwsn)
 *
 * Each stretch (runs with no unread gap between them) is one outline: it eases
 * out from the left edge inside the first run, eases from one reach to the next
 * across each boundary, and eases back to the left edge inside the last run. An
 * ease reaches half the shorter of the two runs it joins on either side of
 * the boundary, `EASE_CAP` at most, so a long run keeps a straight side at its
 * own reach.
 *
 * **Nothing is drawn where nothing was read.** The eases at a stretch's ends
 * stay inside its own runs, and an unread gap starts a new subpath, so an empty
 * stretch of rail keeps meaning "not read". What the curve does give up is
 * between two read neighbours: up to half of the lesser-read one is drawn at
 * more than its reach, and half of the other at less.
 *
 * **It cannot overshoot the rail.** Each cubic's two control points take their
 * x from its two end points, so the curve stays between them.
 *
 * At full reach the edge is at x = 16, the viewBox's far side: keeping that
 * stroke inside the rail is spine.css § reading time's job, not this one's.
 */
export function readingAreaPaths(runs: readonly ReadingRun[], docHeight: number): ReadingAreaPaths {
  /* No visible extent means no mark. A zero-height cubic would still stroke
     horizontally across the rail and change its neighbours' easing budgets. */
  runs = runs.filter((run) => run.height > 0);
  const cap = docHeight * EASE_CAP;
  /** An S from (xa, ya), going straight down at both ends, to (xb, yb). */
  const ease = (xa: number, ya: number, xb: number, yb: number): string => {
    const mid = coord((ya + yb) / 2);
    return `C${coord(xa)} ${mid} ${coord(xb)} ${mid} ${coord(xb)} ${coord(yb)}`;
  };
  let area = "";
  let edge = "";
  for (let i = 0; i < runs.length; ) {
    /* One stretch: runs[i..end], each joined to the one before it. */
    let end = i;
    for (let next = runs[end + 1]; next !== undefined; next = runs[end + 1]) {
      const cur = runs[end];
      if (!cur || Math.abs(next.top - (cur.top + cur.height)) >= SAME_STRETCH_PX) break;
      end++;
    }
    const first = runs[i];
    const last = runs[end];
    if (!first || !last) break;
    const bottom = last.top + last.height;

    let y = first.top + Math.min(first.height / 2, cap);
    let d = `M0 ${coord(first.top)}${ease(0, first.top, first.reach, y)}`;
    /** Straight down to `to`, unless the last ease already ended there. */
    const down = (to: number): void => {
      if (to <= y) return;
      d += `V${coord(to)}`;
      y = to;
    };
    for (let j = i; j < end; j++) {
      const [above, below] = [runs[j], runs[j + 1]];
      if (!above || !below) break;
      const half = Math.min(above.height / 2, below.height / 2, cap);
      down(below.top - half);
      /* `Math.max`: two joined runs may overlap by a fraction of a pixel
         (`SAME_STRETCH_PX`), and the outline must never go back up the rail. */
      const to = Math.max(y, below.top + half);
      d += ease(above.reach, y, below.reach, to);
      y = to;
    }
    down(bottom - Math.min(last.height / 2, cap));
    d += ease(last.reach, y, 0, Math.max(y, bottom));

    edge += d;
    area += `${d}Z`;
    i = end + 1;
  }
  return { area, edge };
}

/* --------------------------------------------------- the quotes, every mode -- */

/** One stretch of the rail's quote strip — `quoteRailMarks`. */
export interface QuoteRailMark {
  key: string;
  top: number;
  height: number;
  /** The strip's alpha: the brightest quote in the block, `quoteAlpha`'s ramp. */
  alpha: number;
}

/**
 * **Where the quotes are, as a strip down the rail's left edge** —
 * docs/plans/261002h-quotes-in-the-spine-a-card-on-each-quote-and-previous-next.md.
 *
 * > Perhaps show Quotes in the spine (use the same colour we use for their
 * > outline-border)
 * >
 * > — Greg, 2026-09-10 (spya-yd2c47)
 *
 * **Not a `SpineMark`, for `OriginMark`'s reason**: a lane is search vocabulary
 * and lanes are packed, so a quote lane would push every search sideways and be
 * counted as a "search match" on a band's card. The gutter is the right 10px of
 * a 12px rail, so the strip takes the left 2px, which nothing packs.
 *
 * `byBlock` is a block's brightest quote alpha, keyed by block id — built from
 * the marks the prose actually draws, so a quote the bar hides, or one whose
 * block a re-extraction took away, has no strip. A block this page has no row
 * for is skipped rather than drawn at zero, the rule every mark here keeps.
 * One mark per block rather than runs: blocks are a few hundred at most, and a
 * per-block alpha is what lets the fade still say which paragraph matters.
 */
export function quoteRailMarks(
  rows: Map<string, Row>,
  byBlock: ReadonlyMap<BlockId, number>,
): QuoteRailMark[] {
  const out: QuoteRailMark[] = [];
  for (const [blockId, alpha] of byBlock) {
    const row = rows.get(blockId);
    if (!row) continue;
    out.push({ key: blockId, top: row.top, height: row.height, alpha });
  }
  out.sort((a, b) => a.top - b.top);
  return out;
}

/**
 * A block's brightest quote, from the marks the prose draws — `quoteRailMarks`'
 * input. Anything without a `quoteStroke` is not a quote and is ignored, so
 * this can be handed any `Found[]` without the rail ever showing a search.
 */
export function quoteAlphaByBlock(found: readonly Found[]): Map<BlockId, number> {
  const out = new Map<BlockId, number>();
  for (const f of found) {
    if (!f.quoteStroke) continue;
    const was = out.get(f.blockId);
    if (was === undefined || f.quoteStroke.alpha > was) out.set(f.blockId, f.quoteStroke.alpha);
  }
  return out;
}
