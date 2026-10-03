/**
 * **Every quote says when it was chosen, and keeps saying the same thing.**
 * `Quote.addedAt`, src/quotes.ts § `buildQuotes` and § `InheritedQuote`.
 *
 * Greg, 2026-10-03: *"Store when it happened."* The list's `generatedAt` is
 * overwritten by every Find more, so without a time of its own a quote appended
 * on Tuesday to Monday's list could not say Monday.
 *
 * Three things have to hold, and each fails silently — the tooltip would go on
 * printing a plausible date:
 *
 * - a run's new quotes carry **the run's one time**, the same value the list's
 *   `generatedAt` gets;
 * - a quote the list **already had** is never re-stamped — not on an append,
 *   and not on a replace that hands it its old id (GPT Sol, 261003h Q4);
 * - a quote stored **before the field existed stays without one**. Its absence
 *   is what makes the card say *on or before*; filling it in would turn a
 *   bound into a claim.
 *
 * docs/plans/261003h-your-highlights-as-rows-in-quotes-and-who-and-when-on-every-row.md
 */
import { describe, expect, it } from "vitest";
import { buildQuotes, idsByText, noneDropped, PROMPT_VERSION } from "../src/quotes.js";
import { CAPABLE_MODEL } from "../src/models.js";
import type { Block, Quote, Quotes } from "../src/types.js";

function block(id: string, text: string): Block {
  return { id, tag: "p", kind: "text", text, words: text.split(/\s+/).length, html: `<p>${text}</p>`, gistable: true };
}

const FIRST = "Writing is thinking, and there is no other kind of thinking.";
const SECOND = "The mathematical marriage of convenience starts to fall apart here.";
const THIRD = "Most people never had to write anything at all, and now they must.";

const BLOCKS: Block[] = [
  block("spya-aaaaaa", FIRST),
  block("spya-bbbbbb", SECOND),
  block("spya-cccccc", THIRD),
];

const MONDAY = "2026-09-28T09:10:00.000Z";
const TUESDAY = "2026-09-29T14:02:00.000Z";

const opts = { slug: "writes", blocks: BLOCKS, sourceHash: "hash-1", elapsedMs: 10, power: "standard" as const };

function stored(quotes: Quote[], over: Partial<Quotes> = {}): Quotes {
  return {
    version: PROMPT_VERSION,
    generator: CAPABLE_MODEL,
    slug: "writes",
    sourceHash: "hash-1",
    profileHash: null,
    quotes,
    discarded: noneDropped(),
    generatedAt: MONDAY,
    elapsedMs: 100,
    passes: 1,
    lastAdded: quotes.length,
    ...over,
  };
}

describe("a run's new quotes", () => {
  it("are all stamped with the run's one time, which is also the list's generatedAt", () => {
    const built = buildQuotes({ quotes: [{ text: FIRST }, { text: THIRD }] }, {
      ...opts,
      dropped: noneDropped(),
      now: TUESDAY,
    });
    expect(built.generatedAt).toBe(TUESDAY);
    expect(built.quotes.map((q) => q.addedAt)).toEqual([TUESDAY, TUESDAY]);
  });

  it("without a time handed in, still share one clock read with the list", () => {
    const built = buildQuotes({ quotes: [{ text: FIRST }, { text: THIRD }] }, { ...opts, dropped: noneDropped() });
    expect(Number.isNaN(Date.parse(built.generatedAt))).toBe(false);
    expect(built.quotes.map((q) => q.addedAt)).toEqual([built.generatedAt, built.generatedAt]);
  });
});

describe("Find more — an append", () => {
  it("keeps the time a quote already had, and stamps only what it adds", () => {
    const kept: Quote = { id: "spya-keep01", blockId: "spya-aaaaaa", text: FIRST, start: 0, addedAt: MONDAY };
    const built = buildQuotes({ quotes: [{ text: SECOND }] }, {
      ...opts,
      dropped: noneDropped(),
      existing: stored([kept]),
      now: TUESDAY,
    });
    expect(built.quotes.map((q) => [q.text, q.addedAt])).toEqual([
      [FIRST, MONDAY],
      [SECOND, TUESDAY],
    ]);
    /* The list's own time moves, which is exactly why the quote needs its own. */
    expect(built.generatedAt).toBe(TUESDAY);
  });

  it("leaves a quote from before the field existed without one", () => {
    const old: Quote = { id: "spya-keep01", blockId: "spya-aaaaaa", text: FIRST, start: 0 };
    const built = buildQuotes({ quotes: [{ text: SECOND }] }, {
      ...opts,
      dropped: noneDropped(),
      existing: stored([old]),
      now: TUESDAY,
    });
    const first = built.quotes[0]!;
    expect(first.id).toBe("spya-keep01");
    expect("addedAt" in first).toBe(false);
    expect(built.quotes[1]?.addedAt).toBe(TUESDAY);
  });
});

describe("a replace that inherits an id", () => {
  it("inherits the time with it: chosen on Monday is still chosen on Monday", () => {
    const before = stored([{ id: "spya-oldold", blockId: "spya-aaaaaa", text: FIRST, start: 0, addedAt: MONDAY }]);
    const built = buildQuotes({ quotes: [{ text: FIRST }, { text: THIRD }] }, {
      ...opts,
      dropped: noneDropped(),
      inherit: idsByText(before),
      now: TUESDAY,
    });
    const again = built.quotes.find((q) => q.text === FIRST)!;
    expect(again.id).toBe("spya-oldold");
    expect(again.addedAt).toBe(MONDAY);
    /* The one it did not have before is this run's. */
    expect(built.quotes.find((q) => q.text === THIRD)?.addedAt).toBe(TUESDAY);
  });

  it("inherits the absence too — an old quote does not acquire the rewrite's time", () => {
    const before = stored([{ id: "spya-oldold", blockId: "spya-aaaaaa", text: FIRST, start: 0 }]);
    const built = buildQuotes({ quotes: [{ text: FIRST }] }, {
      ...opts,
      dropped: noneDropped(),
      inherit: idsByText(before),
      now: TUESDAY,
    });
    const again = built.quotes[0]!;
    expect(again.id).toBe("spya-oldold");
    expect("addedAt" in again).toBe(false);
  });

  it("carries id and time together out of idsByText, and nothing for a quote without one", () => {
    const map = idsByText(
      stored([
        { id: "spya-oldold", blockId: "spya-aaaaaa", text: FIRST, addedAt: MONDAY },
        { id: "spya-older1", blockId: "spya-bbbbbb", text: SECOND },
      ]),
    );
    expect([...map.values()]).toEqual([{ id: "spya-oldold", addedAt: MONDAY }, { id: "spya-older1" }]);
  });
});
