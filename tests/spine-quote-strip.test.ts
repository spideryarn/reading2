/**
 * **The quotes down the rail's left edge, in every mode** —
 * docs/plans/261002h-quotes-in-the-spine-a-card-on-each-quote-and-previous-next.md § 1.
 *
 * The arithmetic: which blocks get a strip, how bright, and that nothing that
 * is not a quote reaches it; plus the CSS clamp and tree order that determine
 * whether the last strip stays visible and which layers paint over it.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { quoteAlphaByBlock, quoteRailMarks, type Row } from "../src/web/spine-marks.js";
import { NO_FOUND, railFound } from "../src/web/reader/passages.js";
import type { Found } from "../src/web/search-hits.js";
import type { BlockId } from "../src/types.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const spineSource = await readFile(path.join(ROOT, "src/web/Spine.tsx"), "utf8");
const spineCss = await readFile(path.join(ROOT, "src/web/styles/spine.css"), "utf8");

const rows = new Map<string, Row>([
  ["a", { index: 0, top: 0, height: 100 }],
  ["b", { index: 1, top: 100, height: 40 }],
  ["c", { index: 2, top: 140, height: 300 }],
]);

const quote = (blockId: string, alpha: number): Found =>
  ({
    key: `q:${blockId}:${alpha}`,
    blockId,
    runId: "quotes",
    slot: 0,
    quoteStroke: { tier: "light", alpha },
  }) as unknown as Found;
const search = (blockId: string): Found =>
  ({ key: `s:${blockId}`, blockId, runId: "r1", slot: 2, quoteStroke: null }) as unknown as Found;

describe("quoteAlphaByBlock", () => {
  it("keeps a block's brightest quote, so the fade still says which paragraph matters", () => {
    const by = quoteAlphaByBlock([quote("b", 0.7), quote("b", 0.92), quote("c", 0.8)]);
    expect(by.get("b" as BlockId)).toBe(0.92);
    expect(by.get("c" as BlockId)).toBe(0.8);
    expect(by.size).toBe(2);
  });

  it("ignores anything that is not a quote — a search never reaches the strip", () => {
    expect(quoteAlphaByBlock([search("a"), quote("c", 0.75)])).toEqual(new Map([["c", 0.75]]));
  });
});

describe("railFound", () => {
  it("takes the quotes out of the search lanes — Quotes' slot, and Skim's stop", () => {
    const s = search("a");
    expect(railFound([s, quote("b", 0.9)])).toEqual([s]);
    expect(railFound([quote("b", 0.9)])).toBe(NO_FOUND);
  });

  it("hands the list back by identity when there is no quote in it", () => {
    /* The memos downstream key on the array, so a fresh copy per render would
       rebuild the rail's lanes for nothing — `proseFound`'s reason. */
    const searches = [search("a"), search("c")];
    expect(railFound(searches)).toBe(searches);
  });
});

describe("quoteRailMarks", () => {
  it("places each strip on its block's row by the rail's pixel ruler, top to bottom", () => {
    const marks = quoteRailMarks(
      rows,
      new Map([
        ["c" as BlockId, 0.8],
        ["b" as BlockId, 1],
      ]),
    );
    expect(marks).toEqual([
      { key: "b", top: 100, height: 40, alpha: 1 },
      { key: "c", top: 140, height: 300, alpha: 0.8 },
    ]);
  });

  it("skips a block the page does not have rather than drawing it at the top", () => {
    expect(quoteRailMarks(rows, new Map([["gone" as BlockId, 1]]))).toEqual([]);
  });
});

describe("the strip's paint contract", () => {
  it("clamps its three-pixel floor inside the bottom of the rail", () => {
    expect(spineCss).toMatch(
      /\.spine-quote\s*\{[\s\S]*?top: min\(var\(--quote-top\), 100% - 3px\);[\s\S]*?min-height: 3px;/,
    );
  });

  it("paints over reading and the jump origin, but under search lanes", () => {
    const reading = spineSource.indexOf('className="spine-read"');
    const origin = spineSource.indexOf('className="spine-from"');
    const quotes = spineSource.indexOf('className="spine-quotes"');
    const matches = spineSource.indexOf('className="spine-matches"');
    expect([reading, origin, quotes, matches].every((at) => at >= 0)).toBe(true);
    expect(reading).toBeLessThan(quotes);
    expect(origin).toBeLessThan(quotes);
    expect(quotes).toBeLessThan(matches);
  });
});
