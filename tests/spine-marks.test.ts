/**
 * Search matches in the bird's-eye rail — src/web/spine-marks.ts.
 *
 * **This file exists because every failure here is invisible.** A mark in the
 * wrong lane is a mark; a mark placed against the wrong ruler is a mark; a band
 * counting its neighbour's last paragraph is a number that looks entirely
 * reasonable. Nothing about any of them shows up in a screenshot, and the rail
 * is a picture whose whole claim is that it is *accurate* — a bird's-eye view
 * you cannot trust is worse than none, because it is still confidently pointing
 * somewhere.
 *
 * See docs/project/search.md § The rail, and Spine.tsx § Search results down
 * the rail.
 */
import { describe, expect, it } from "vitest";
import {
  bandMatchCounts,
  jumpOriginMark,
  laneColour,
  laneOrder,
  spineMarks,
  type Row,
} from "../src/web/spine-marks.js";
import type { BlockMatch } from "../src/web/search-hits.js";
import type { BlockId } from "../src/types.js";

/**
 * `["blockId", [["run-a", 3]], 2]` — the searches that matched in a block, and
 * how many matches fell there. A `null` slot is a literal match.
 */
const matchesOf = (
  entries: [string, [string | null, number | null][], number][],
): Map<BlockId, BlockMatch> =>
  new Map(
    entries.map(([id, searches, count]) => [
      id as BlockId,
      { searches: searches.map(([runId, slot]) => ({ runId, slot })), count },
    ]),
  );

const rowsOf = (entries: [string, number, number, number][]): Map<string, Row> =>
  new Map(entries.map(([id, index, top, height]) => [id, { index, top, height }]));

describe("laneOrder", () => {
  it("packs the lanes, so two searches never leave six empty tracks", () => {
    /* The trade this function exists to make. Keying the lane off the slot
       number would be stable under every change and would divide the 10px
       gutter into eight tracks of 1.25px, six of them showing nothing. */
    const lanes = laneOrder(matchesOf([["a", [["r1", 2], ["r2", 7]], 2]]));
    expect(lanes.get("r1")).toBe(0);
    expect(lanes.get("r2")).toBe(1);
    expect(lanes.size).toBe(2);
  });

  it("gives two searches two lanes even when the palette has wrapped", () => {
    /* **The bug this is keyed by run id to prevent.** Slots repeat past the
       eighth search and select-all switches on every saved search there is, so
       a slot-keyed lane merges the ninth search with whichever earlier one
       shares its hue — one lane carrying the union of two searches' shapes,
       which is the opposite of what a lane is for. Raised by a GPT Sol review,
       2026-08-26. */
    const lanes = laneOrder(matchesOf([["a", [["r1", 3], ["r2", 3]], 2]]));
    expect(lanes.size).toBe(2);
    expect(lanes.get("r1")).not.toBe(lanes.get("r2"));
  });

  it("orders lanes by colour, not by which block was seen first", () => {
    /* A Map iterates in insertion order, and the insertion order here is the
       order blocks came out of the result list's *sort* — which the reader can
       change with the order control. Without the sort, switching from document
       order to confidence order would silently rearrange the rail. */
    const byDocument = laneOrder(matchesOf([["a", [["r5", 5]], 1], ["b", [["r1", 1]], 1]]));
    const byConfidence = laneOrder(matchesOf([["b", [["r1", 1]], 1], ["a", [["r5", 5]], 1]]));
    expect([...byDocument]).toEqual([...byConfidence]);
    expect(byDocument.get("r1")).toBe(0);
  });

  it("breaks a colour tie on the run id, stably", () => {
    const one = laneOrder(matchesOf([["a", [["zzz", 3], ["aaa", 3]], 2]]));
    const other = laneOrder(matchesOf([["a", [["aaa", 3], ["zzz", 3]], 2]]));
    expect(one.get("aaa")).toBe(0);
    expect([...one]).toEqual([...other]);
  });

  it("gives a literal match the first lane", () => {
    /* `null` — the words matcher, which belongs to no saved search. It is the
       matcher a reader is most likely to be using, so it has to have a lane at
       all; `""` is how it gets one without pretending to be a run. */
    const lanes = laneOrder(matchesOf([["a", [[null, null]], 3]]));
    expect(lanes.get("")).toBe(0);
    expect(lanes.size).toBe(1);
  });

  it("gives no lane to a search that matched nothing", () => {
    // A search switched on with no results must not push the others sideways
    // to make room for a track that stays empty.
    const lanes = laneOrder(matchesOf([["a", [["r4", 4]], 1]]));
    expect(lanes.has("r0")).toBe(false);
    expect(lanes.size).toBe(1);
  });
});

describe("laneColour", () => {
  it("never returns a colour, only a reference to one", () => {
    /* The seam hit-colours.ts exists to keep: slots are numbers here and hues
       live in styles/colourscales.css, so the palette stays editable from the
       stylesheet. A hex in this file would put a colour beyond the reach of the
       theme, and a palette change would mean editing TypeScript. */
    expect(laneColour(3)).toBe("var(--cat-3-rgb)");
    expect(laneColour(0)).toBe("var(--cat-0-rgb)");
  });

  it("paints a literal match in the one fixed search hue", () => {
    expect(laneColour(null)).toBe("var(--hit-rgb)");
  });
});

describe("spineMarks", () => {
  const rows = rowsOf([
    ["a", 0, 0, 100],
    ["b", 1, 100, 40],
    ["c", 2, 140, 300],
  ]);

  it("draws one bar per search per block, side by side", () => {
    const matches = matchesOf([["b", [["r1", 1], ["r4", 4]], 5]]);
    const marks = spineMarks(rows, matches, laneOrder(matches));
    expect(marks).toHaveLength(2);
    expect(marks.map((m) => m.lane)).toEqual([0, 1]);
    expect(marks.map((m) => m.rgb)).toEqual(["var(--cat-1-rgb)", "var(--cat-4-rgb)"]);
    // Same block, so same place: the lane is the only thing separating them.
    expect(new Set(marks.map((m) => m.top))).toEqual(new Set([100]));
  });

  it("draws two bars of one colour when two searches share a hue", () => {
    const matches = matchesOf([["b", [["r1", 3], ["r2", 3]], 2]]);
    const marks = spineMarks(rows, matches, laneOrder(matches));
    expect(marks).toHaveLength(2);
    expect(marks.map((m) => m.rgb)).toEqual(["var(--cat-3-rgb)", "var(--cat-3-rgb)"]);
    expect(marks.map((m) => m.lane)).toEqual([0, 1]);
  });

  it("makes a mark as tall as the paragraph it names", () => {
    /* The whole of how "how common" reads at a glance: a search that matched
       six long paragraphs paints far more of the rail than one that matched six
       list items, which is true and is what you want to know. */
    const matches = matchesOf([["a", [["r0", 0]], 1], ["c", [["r0", 0]], 1]]);
    const marks = spineMarks(rows, matches, laneOrder(matches));
    expect(marks.map((m) => m.height)).toEqual([100, 300]);
  });

  it("places a mark by measured pixels, not by its position in the block list", () => {
    /* The failure this whole module is arranged around. Block `c` is the third
       of three and starts 140px down a 440px article — a third of the way in,
       not two-thirds. A rail that placed it by index would look completely
       plausible and point at the wrong section. */
    const matches = matchesOf([["c", [["r0", 0]], 1]]);
    const [mark] = spineMarks(rows, matches, laneOrder(matches));
    expect(mark?.top).toBe(140);
  });

  it("skips a match whose block is no longer on the page", () => {
    /* Saved results outliving a re-extraction. A mark pointing at the wrong
       paragraph is worse than a missing one — it is the only failure here the
       reader would act on. */
    const matches = matchesOf([["gone", [["r2", 2]], 1], ["a", [["r2", 2]], 1]]);
    const marks = spineMarks(rows, matches, laneOrder(matches));
    expect(marks).toHaveLength(1);
    expect(marks[0]?.top).toBe(0);
  });

  it("comes out in reading order whatever order the results were in", () => {
    const matches = matchesOf([
      ["c", [["r0", 0]], 1],
      ["a", [["r0", 0]], 1],
      ["b", [["r0", 0]], 1],
    ]);
    const marks = spineMarks(rows, matches, laneOrder(matches));
    expect(marks.map((m) => m.top)).toEqual([0, 100, 140]);
  });

  it("gives every mark a key of its own when two searches share a block", () => {
    // React drops duplicate-keyed siblings with a warning nobody reads, so one
    // of the two lanes would simply not be drawn. Including the case where the
    // two searches share a palette slot, which a slot-keyed key would collide.
    const matches = matchesOf([["a", [["r1", 3], ["r2", 3]], 2], ["b", [["r1", 3]], 1]]);
    const marks = spineMarks(rows, matches, laneOrder(matches));
    expect(new Set(marks.map((m) => m.key)).size).toBe(marks.length);
  });
});

describe("bandMatchCounts", () => {
  const rows = rowsOf([
    ["a", 0, 0, 10],
    ["b", 1, 10, 10],
    ["c", 2, 20, 10],
    ["d", 3, 30, 10],
  ]);
  const bands = [
    { id: "one", startRow: 0, endRow: 1 },
    { id: "two", startRow: 2, endRow: 3 },
  ];

  it("counts matches, not blocks", () => {
    /* "How common" means how much is in here. Two hits in one paragraph and one
       hit in it are different answers, and the count is the only place that
       difference is expressible — the rail draws them as the same mark. */
    const counts = bandMatchCounts(rows, matchesOf([["a", [["r0", 0]], 3]]), bands);
    expect(counts.get("one")).toBe(3);
  });

  it("treats endRow as inclusive", () => {
    /* Off by one here moves a section's last paragraph into the next section's
       count — wrong by an amount nobody would ever notice. */
    const counts = bandMatchCounts(rows, matchesOf([["b", [["r0", 0]], 1]]), bands);
    expect(counts.get("one")).toBe(1);
    expect(counts.has("two")).toBe(false);
  });

  it("adds up across the blocks of one band", () => {
    const counts = bandMatchCounts(
      rows,
      matchesOf([["c", [["r0", 0]], 2], ["d", [["r1", 1]], 5]]),
      bands,
    );
    expect(counts.get("two")).toBe(7);
  });

  it("leaves an empty band out rather than storing a zero", () => {
    // So a hover card can say nothing at all, rather than "0 matches" on every
    // band of an article during a search.
    const counts = bandMatchCounts(rows, matchesOf([["a", [["r0", 0]], 1]]), bands);
    expect(counts.has("two")).toBe(false);
  });

  it("is empty when nothing has been searched for", () => {
    expect(bandMatchCounts(rows, new Map(), bands).size).toBe(0);
  });

  it("ignores a match whose block is no longer on the page", () => {
    const counts = bandMatchCounts(rows, matchesOf([["gone", [["r0", 0]], 9]]), bands);
    expect(counts.size).toBe(0);
  });
});

/* ------------------------------------------ where the reader jumped from -- */

/**
 * One mark, at the block a jump started from — Stage C of
 * docs/plans/260906g-back-to-where-you-jumped-from.md.
 *
 * The same class of invisibility as everything above it: a tick at the wrong
 * row is a tick, and a tick drawn at the top of the rail because the origin
 * could not be found looks exactly like a reader who really did jump from the
 * first paragraph.
 */
describe("jumpOriginMark", () => {
  const rows = rowsOf([
    ["a", 0, 0, 100],
    ["b", 1, 100, 40],
    ["c", 2, 140, 300],
  ]);

  it("puts the mark on the origin block's own row, by the rail's pixel ruler", () => {
    /* Block `b` is the second of three and 100px down a 440px article — a
       quarter of the way in, not two-thirds. The same ruler `spineMarks` uses
       and for the same reason: the character ruler a result row prints its
       "42% in" from would place this in the wrong band. */
    expect(jumpOriginMark(rows, { kind: "block", blockId: "b" as BlockId })).toEqual({
      top: 100,
      height: 40,
    });
  });

  it("draws nothing on an entry no jump stamped", () => {
    // The ordinary state of the rail: no chip, so no mark.
    expect(jumpOriginMark(rows, null)).toBeNull();
  });

  it("draws nothing for an origin at the top of the article", () => {
    /* **There is no block to mark.** `top` exists precisely because no row had
       reached the reading line (jump-history.ts § JumpOrigin, GPT Sol F8), so
       marking the first row would put a tick where the reader was not — and
       the chip already says "back to the beginning", which is the whole of the
       information there is. */
    expect(jumpOriginMark(rows, { kind: "top" })).toBeNull();
  });

  it("skips an origin the page no longer has, rather than drawing it at the top", () => {
    /* A stamp outliving a re-extraction. `spineMarks` makes the same choice for
       the same reason: a mark pointing at the wrong paragraph is worse than a
       missing one, and it is the failure a reader would act on. The chip is
       already gone in this case — it hides a stamp it cannot resolve. */
    expect(jumpOriginMark(rows, { kind: "block", blockId: "gone" as BlockId })).toBeNull();
  });

  it("carries no lane and no colour, so it can take neither", () => {
    /* The rail is 12px wide and the search lanes are packed into the right-hand
       gutter: a mark arriving with a `lane` would have to be given one out of
       that packing, and `laneOrder` would move every search sideways to make
       room for it. Being a different shape from `SpineMark` is what makes that
       impossible rather than merely avoided. */
    const mark = jumpOriginMark(rows, { kind: "block", blockId: "c" as BlockId });
    expect(mark && Object.keys(mark).sort()).toEqual(["height", "top"]);
  });
});
