/**
 * **Where a reader's highlight goes among the model's quotes** —
 * src/web/quote-band-rows.ts, the Quotes band's row projection.
 * docs/plans/261003h-your-highlights-as-rows-in-quotes-and-who-and-when-on-every-row.md
 *
 * The rule that is easy to get wrong and impossible to see in a screenshot:
 * **the two `start`s are never compared.** A quote's is an offset into
 * `block.text` and a comment's into the rendered text, so the fixtures below
 * give the reader's rows *larger* `start`s than the model's in the same block
 * and still require the reader's first. A sort on `start` passes most articles
 * and fails that one.
 */
import { describe, expect, it } from "vitest";
import {
  aiProvenance,
  quoteBandRows,
  readerProvenance,
  readerRowComments,
  withYours,
  type QuoteBandRow,
} from "../src/web/quote-band-rows.js";
import { exactly } from "../src/web/relative-time.js";
import type { BlockId, Comment, Quote } from "../src/types.js";

const A = "spya-aaaaaa" as BlockId;
const B = "spya-bbbbbb" as BlockId;
const C = "spya-cccccc" as BlockId;
const GONE = "spya-zzzzzz" as BlockId;
const BLOCKS = [A, B, C].map((id) => ({ id }));

const quote = (id: string, blockId: BlockId, over: Partial<Quote> = {}): Quote => ({
  id,
  blockId,
  text: `the model's line ${id}`,
  ...over,
});

function highlight(id: string, blockId: BlockId, start: number, over: Partial<Comment> = {}): Comment {
  return {
    id,
    blockId,
    quote: `the reader's words ${id}`,
    start,
    colour: "yellow",
    createdAt: "2026-10-03T14:02:00.000Z",
    status: "none",
    ...over,
  } as Comment;
}

/** `ai:q1` / `me:h1` — the list as a reader would describe it. */
const said = (rows: readonly QuoteBandRow[]): string[] =>
  rows.map((row) => (row.by === "ai" ? `ai:${row.quote.id}` : `me:${row.comment.id}`));

const Q1 = quote("q1", A, { start: 0, importance: 0.2, striking: 0.9 });
const Q2 = quote("q2", B, { start: 5, importance: 0.9, striking: 0.1 });
const Q3 = quote("q3", C, { start: 0, importance: 0.5, striking: 0.5 });

describe("which comments are rows", () => {
  it("takes a selection with a colour, and nothing else", () => {
    const rows = readerRowComments([
      highlight("spya-hhhhh1", A, 3),
      /* A note on a selection, never coloured: something to say, not a line to keep. */
      { id: "spya-hhhhh2", blockId: A, quote: "a note, uncoloured", start: 3, body: "hm", createdAt: "2026-10-03T00:00:00.000Z", status: "none" },
      /* A bookmark on the whole paragraph, coloured or not, has no words. */
      { id: "spya-hhhhh3", blockId: B, colour: "pink", createdAt: "2026-10-03T00:00:00.000Z", status: "none" } as Comment,
      /* A Referee placement is a judgment on a criterion, not a reading note. */
      highlight("spya-hhhhh4", C, 0, { criterionId: "crit-1" }),
      /* A coloured comment WITH a note is both: a row here and a comment there. */
      highlight("spya-hhhhh5", C, 9, { colour: "pink", body: "why this bound?" }),
    ]);
    expect(rows.map((c) => c.id)).toEqual([
      "spya-hhhhh1",
      "spya-hhhhh5",
    ]);
  });
});

describe("in order, and prioritised — reading order, by block only", () => {
  const mine = readerRowComments([
    highlight("h-c", C, 2),
    highlight("h-b-late", B, 400),
    highlight("h-b-early", B, 90),
    highlight("h-a", A, 50),
  ]);

  it("interleaves by block, the reader's first inside a block, in their own start order", () => {
    /* Every reader `start` in B (90, 400) is past the model's (5). Compared, the
       model's row would come first; it must not be. */
    expect(said(quoteBandRows([Q1, Q2, Q3], mine, "document", BLOCKS))).toEqual([
      "me:h-a",
      "ai:q1",
      "me:h-b-early",
      "me:h-b-late",
      "ai:q2",
      "me:h-c",
      "ai:q3",
    ]);
  });

  it("puts a highlight between the model's blocks where it falls, and after the last when past it", () => {
    const only = readerRowComments([highlight("h-b", B, 0), highlight("h-c", C, 0)]);
    expect(said(quoteBandRows([Q1], only, "document", BLOCKS))).toEqual(["ai:q1", "me:h-b", "me:h-c"]);
    expect(said(quoteBandRows([Q3], only, "document", BLOCKS))).toEqual(["me:h-b", "me:h-c", "ai:q3"]);
  });

  it("is the same under prioritised: the bar has already cut the model's list, never the reader's", () => {
    /* `shownAiQuotes` arrives already filtered — q1 and q3 are below the bar. */
    expect(said(quoteBandRows([Q2], mine, "prioritised", BLOCKS))).toEqual([
      "me:h-a",
      "me:h-b-early",
      "me:h-b-late",
      "ai:q2",
      "me:h-c",
    ]);
  });

  it("puts a highlight whose block the article no longer has last, even after the model's", () => {
    const lost = readerRowComments([highlight("h-gone", GONE, 0), highlight("h-a", A, 7)]);
    expect(said(quoteBandRows([Q1, Q3], lost, "document", BLOCKS))).toEqual([
      "me:h-a",
      "ai:q1",
      "ai:q3",
      "me:h-gone",
    ]);
  });

  it("keeps it last even when a model's quote is on a missing block too", () => {
    const stale = quote("q-gone", GONE);
    const lost = readerRowComments([highlight("h-gone", GONE, 0), highlight("h-c", C, 0)]);
    expect(said(quoteBandRows([Q1, stale], lost, "document", BLOCKS))).toEqual([
      "ai:q1",
      "me:h-c",
      "ai:q-gone",
      "me:h-gone",
    ]);
  });

  it("never reorders the model's rows, and with no highlights is exactly them", () => {
    expect(said(quoteBandRows([Q3, Q1, Q2], [], "document", BLOCKS))).toEqual(["ai:q3", "ai:q1", "ai:q2"]);
  });

  it("shows the reader's rows alone when there is no list yet", () => {
    expect(said(quoteBandRows([], mine, "document", BLOCKS))).toEqual([
      "me:h-a",
      "me:h-b-early",
      "me:h-b-late",
      "me:h-c",
    ]);
  });
});

describe("most important, most striking — the reader's rows first, as a group", () => {
  const mine = readerRowComments([highlight("h-c", C, 2), highlight("h-a", A, 50)]);

  it.each(["importance", "striking"] as const)("%s: the reader's in reading order, then the model's as ranked", (rank) => {
    /* The model's list arrives ranked; whatever that order is, it is kept. */
    const ranked = rank === "importance" ? [Q2, Q3, Q1] : [Q1, Q3, Q2];
    expect(said(quoteBandRows(ranked, mine, rank, BLOCKS))).toEqual([
      "me:h-a",
      "me:h-c",
      ...ranked.map((q) => `ai:${q.id}`),
    ]);
  });
});

describe("the count", () => {
  it("appends the reader's own to the model's count, and says nothing when there are none", () => {
    expect(withYours("14 quotes", 3)).toBe("14 quotes + 3 yours");
    expect(withYours("5 of 14", 1)).toBe("5 of 14 + 1 yours");
    expect(withYours("5 of 14", 0)).toBe("5 of 14");
  });
});

describe("who and when", () => {
  const MON = "2026-09-28T09:10:00.000Z";
  const TUE = "2026-09-29T14:02:00.000Z";

  it("gives a quote its own time", () => {
    expect(aiProvenance({ addedAt: MON }, TUE)).toBe(`Chosen by the AI · ${exactly(MON)}`);
  });

  it("says on or before the list's time for a quote stored without one", () => {
    expect(aiProvenance({}, TUE)).toBe(`Chosen by the AI · on or before ${exactly(TUE)}`);
  });

  it("still says who when there is no time at all", () => {
    expect(aiProvenance({}, undefined)).toBe("Chosen by the AI");
  });

  it("says a highlight was saved then — not that it was coloured then", () => {
    expect(readerProvenance({ createdAt: MON })).toBe(`Your highlight · saved ${exactly(MON)}`);
  });
});
