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
import type { BlockMatch, MatchingSearch } from "./search-hits.js";

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
