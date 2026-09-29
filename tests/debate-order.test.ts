/**
 * **The orders Debate's list can be drawn in** (src/web/debate-order.ts), tested
 * without a DOM.
 *
 * Three properties are invisible on screen until they are wrong:
 *
 *  1. **By claim follows the article, not the search.** Groups are in the order
 *     the piece makes its claims; a claim's identity is `(blockId, claimQuote)`,
 *     so one quote in two blocks is two claims and two quotes in one block are
 *     two claims too; rows sharing a page stay separate rows (the plan's F9).
 *  2. **Stance sorts on `readStoredLean`**, so a row written before the lean
 *     vocabulary changed sorts where its old `valence` says (F11).
 *  3. **An order is offered only when the data behind it exists and it draws
 *     something the others do not**, and asking for one that is not offered
 *     draws the one that is (F6, F14).
 */
import { describe, expect, it } from "vitest";
import type { BlockId, ClaimDebateRow, DebateLean, DirectDebateRow } from "../src/types.js";
import {
  RELEVANCE_DEFAULT,
  debateOrderOptions,
  effectiveDebateOrder,
  orderDebateRows,
  readAuthors,
  readBears,
  readPublishedYear,
  readWorkTitle,
  visibleClaims,
  yearOf,
} from "../src/web/debate-order.js";

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`. docs/project/block-ids.md. */
const B1 = "spya-k3m9qt" as BlockId;
const B2 = "spya-w7t24d" as BlockId;
const B3 = "spya-r5e8xh" as BlockId;

/** B1 is the first block of the article, B2 the second, B3 the third. */
const ARTICLE = new Map<BlockId, number>([
  [B1, 0],
  [B2, 1],
  [B3, 2],
]);
const NO_BLOCKS = new Map<BlockId, number>();

function direct(id: string, lean: DebateLean = "leans-against"): DirectDebateRow {
  return {
    id,
    url: `https://example.org/${id}`,
    title: "A reply",
    sourceQuote: "the third section does not survive its second",
    articleReferenceQuote: "Notes on my sourdough starter",
    relation: "disputes",
    lean,
    applies: "It says the piece contradicts itself.",
    identifies: [{ kind: "named", by: "title", witness: "Notes on my sourdough starter" }],
  };
}

function claim(
  id: string,
  blockId: BlockId,
  claimQuote: string,
  over: Partial<ClaimDebateRow> & Record<string, unknown> = {},
): ClaimDebateRow {
  return {
    id,
    url: `https://another.example/${id}`,
    title: "On starters",
    sourceQuote: "warmer water is what a starter wants",
    relation: "qualifies",
    lean: "neither",
    applies: "It agrees only above 22°C.",
    claimQuote,
    blockId,
    ...over,
  } as ClaimDebateRow;
}

const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id);

describe("by claim", () => {
  it("puts the rows about this piece first, then one group per claim in article order", () => {
    /* The search returned the third block's claim first; the article makes it last. */
    const claims = [
      claim("c-late", B3, "the third thing"),
      claim("c-early", B1, "the first thing"),
      claim("c-mid", B2, "the second thing"),
    ];
    const groups = orderDebateRows([direct("d1")], claims, "claim", ARTICLE);
    expect(groups.map((g) => g.kind)).toEqual(["piece", "claim", "claim", "claim"]);
    expect(groups.map((g) => (g.kind === "claim" ? g.claimQuote : "piece"))).toEqual([
      "piece",
      "the first thing",
      "the second thing",
      "the third thing",
    ]);
    /* The positive control: without the article's order it keeps the search's. */
    const unknown = orderDebateRows([direct("d1")], claims, "claim", NO_BLOCKS);
    expect(unknown.map((g) => (g.kind === "claim" ? g.claimQuote : "piece"))).toEqual([
      "piece",
      "the third thing",
      "the first thing",
      "the second thing",
    ]);
  });

  it("gathers rows that answer the same claim under one heading, in search order", () => {
    const groups = orderDebateRows(
      [],
      [claim("a", B2, "same"), claim("b", B1, "other"), claim("c", B2, "same")],
      "claim",
      ARTICLE,
    );
    expect(groups).toHaveLength(2);
    expect(groups[1]?.kind === "claim" && ids(groups[1].rows)).toEqual(["a", "c"]);
  });

  it("keeps the same words in two blocks as two claims", () => {
    const groups = orderDebateRows([], [claim("a", B2, "same words"), claim("b", B1, "same words")], "claim", ARTICLE);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => (g.kind === "claim" ? g.blockId : null))).toEqual([B1, B2]);
  });

  it("keeps two quotes from one block as two claims, first-seen first", () => {
    const groups = orderDebateRows([], [claim("a", B1, "second quote"), claim("b", B1, "first quote")], "claim", ARTICLE);
    expect(groups.map((g) => (g.kind === "claim" ? g.claimQuote : null))).toEqual(["second quote", "first quote"]);
  });

  it("puts a claim in a block the article does not know after the ones it does", () => {
    const stray = "spya-z9z9z9" as BlockId;
    const groups = orderDebateRows([], [claim("a", stray, "stray"), claim("b", B3, "known")], "claim", ARTICLE);
    expect(groups.map((g) => (g.kind === "claim" ? g.claimQuote : null))).toEqual(["known", "stray"]);
  });

  it("keeps two rows from one page as two rows when they answer two claims", () => {
    const shared = { url: "https://one.example/review" };
    const groups = orderDebateRows(
      [],
      [claim("a", B1, "one", shared), claim("b", B2, "two", shared)],
      "claim",
      ARTICLE,
    );
    expect(groups).toHaveLength(2);
    expect(groups.flatMap((g) => ids(g.rows))).toEqual(["a", "b"]);
  });

  it("draws no group about this piece when there are no rows about it", () => {
    const groups = orderDebateRows([], [claim("a", B1, "one")], "claim", ARTICLE);
    expect(groups.map((g) => g.kind)).toEqual(["claim"]);
  });
});

describe("stance", () => {
  it("puts critical first, then could not tell, neither, supportive, search order within each", () => {
    const rows = [
      direct("for", "leans-for"),
      direct("against-1", "leans-against"),
      direct("neither", "neither"),
      direct("cannot", "cannot-tell"),
      direct("against-2", "leans-against"),
    ];
    const [flat, ...rest] = orderDebateRows(rows, [], "stance", ARTICLE);
    expect(rest).toHaveLength(0);
    expect(flat?.kind).toBe("flat");
    expect(ids(flat?.rows ?? [])).toEqual(["against-1", "against-2", "cannot", "neither", "for"]);
  });

  /* The row the database hands back from before 2026-09-08: `valence`, no
     `lean`. Indexing by `row.lean` would sort it as `undefined`. */
  it("sorts a row stored under the old vocabulary by what its valence meant", () => {
    const legacy = { ...direct("legacy-negative"), valence: "negative" } as Record<string, unknown>;
    delete legacy.lean;
    const rows = [direct("for", "leans-for"), legacy as unknown as DirectDebateRow];
    const [flat] = orderDebateRows(rows, [], "stance", ARTICLE);
    expect(ids(flat?.rows ?? [])).toEqual(["legacy-negative", "for"]);
  });

  it("mixes both kinds of row into one flat list with no heading", () => {
    const groups = orderDebateRows(
      [direct("d", "leans-for")],
      [claim("c", B1, "x", { lean: "leans-against" })],
      "stance",
      ARTICLE,
    );
    expect(groups).toHaveLength(1);
    expect(ids(groups[0]?.rows ?? [])).toEqual(["c", "d"]);
  });
});

describe("the fields stage 2 will add, read defensively", () => {
  it("reads bears and publishedYear only when they are well formed", () => {
    expect(readBears({ bears: "partly" })).toBe("partly");
    expect(readBears({ bears: "very" })).toBeNull();
    expect(readBears({})).toBeNull();
    expect(readPublishedYear({ publishedYear: 2016 })).toBe(2016);
    expect(readPublishedYear({ publishedYear: "2016" })).toBeNull();
    expect(readPublishedYear({ publishedYear: 20.16 })).toBeNull();
    expect(readPublishedYear({})).toBeNull();
  });

  it("reads the work fields off any shape, and ignores the malformed", () => {
    expect(readWorkTitle({ workTitle: "Hippocampo-cortical coupling" })).toBe("Hippocampo-cortical coupling");
    expect(readWorkTitle({ workTitle: "  " })).toBeNull();
    expect(readWorkTitle({ workTitle: 7 })).toBeNull();
    expect(readAuthors({ authors: ["Maingret", 3, "", "Girardeau"] })).toEqual(["Maingret", "Girardeau"]);
    expect(readAuthors({ authors: "Maingret" })).toEqual([]);
    expect(readAuthors({})).toEqual([]);
  });

  it("takes the year from an article's publishedAt, or none", () => {
    expect(yearOf("2022-03-01T00:00:00Z")).toBe(2022);
    expect(yearOf("2016")).toBe(2016);
    expect(yearOf("March 3, 2019")).toBe(2019);
    expect(yearOf(undefined)).toBeNull();
    expect(yearOf("not a date")).toBeNull();
  });
});

describe("prioritised", () => {
  it("puts rows about this piece first, then directly, partly, loosely, and the unjudged last under their own line", () => {
    const groups = orderDebateRows(
      [direct("d")],
      [
        claim("none", B1, "a"),
        claim("loose", B1, "a", { bears: "loosely" }),
        claim("part", B2, "b", { bears: "partly" }),
        claim("direct", B1, "a", { bears: "directly" }),
        claim("none-2", B2, "b"),
      ],
      "prioritised",
      ARTICLE,
    );
    expect(groups.map((g) => g.kind)).toEqual(["flat", "unjudged"]);
    expect(ids(groups[0]?.rows ?? [])).toEqual(["d", "direct", "part", "loose"]);
    /* Search order within the unjudged, never re-sorted. */
    expect(ids(groups[1]?.rows ?? [])).toEqual(["none", "none-2"]);
  });

  it("draws no unjudged line when every claim row was judged", () => {
    const groups = orderDebateRows([], [claim("a", B1, "a", { bears: "partly" })], "prioritised", ARTICLE);
    expect(groups.map((g) => g.kind)).toEqual(["flat"]);
  });
});

describe("the relevance bar", () => {
  const rows = [
    claim("direct", B1, "a", { bears: "directly" }),
    claim("part", B1, "a", { bears: "partly" }),
    claim("loose", B1, "a", { bears: "loosely" }),
    claim("unjudged", B1, "a"),
  ];

  it("hides nothing at its default", () => {
    expect(RELEVANCE_DEFAULT).toBe("loosely");
    const r = visibleClaims(rows, RELEVANCE_DEFAULT);
    expect(r.hiddenCount).toBe(0);
    expect(ids(r.visible)).toEqual(["direct", "part", "loose", "unjudged"]);
  });

  it("hides below the stop, and never an unjudged row", () => {
    const partly = visibleClaims(rows, "partly");
    expect(ids(partly.visible)).toEqual(["direct", "part", "unjudged"]);
    expect(partly.hiddenCount).toBe(1);
    expect(partly.unscoredCount).toBe(1);
    const directly = visibleClaims(rows, "directly");
    expect(ids(directly.visible)).toEqual(["direct", "unjudged"]);
    expect(directly.hiddenCount).toBe(2);
    /* The one-pass promise, at every stop. */
    for (const stop of ["loosely", "partly", "directly"] as const) {
      const r = visibleClaims(rows, stop);
      expect(r.visible.length + r.hiddenCount, stop).toBe(rows.length);
    }
  });
});

describe("date", () => {
  it("puts the oldest first, same-year rows in search order, and the undated last under their own line", () => {
    const groups = orderDebateRows(
      [direct("d")],
      [
        claim("new", B1, "a", { publishedYear: 2020 }),
        claim("old", B1, "a", { publishedYear: 1999 }),
        claim("new-2", B1, "a", { publishedYear: 2020 }),
      ],
      "date",
      ARTICLE,
    );
    expect(groups.map((g) => g.kind)).toEqual(["flat", "undated"]);
    expect(ids(groups[0]?.rows ?? [])).toEqual(["old", "new", "new-2"]);
    expect(ids(groups[1]?.rows ?? [])).toEqual(["d"]);
  });

  it("marks the article's own year before the first row of that year or later", () => {
    const groups = orderDebateRows(
      [],
      [
        claim("later", B1, "a", { publishedYear: 2024 }),
        claim("same", B1, "a", { publishedYear: 2022 }),
        claim("earlier", B1, "a", { publishedYear: 2016 }),
      ],
      "date",
      ARTICLE,
      2022,
    );
    expect(groups.map((g) => (g.kind === "marker" ? `marker ${g.year}` : ids(g.rows).join(",")))).toEqual([
      "earlier",
      "marker 2022",
      /* The same-year row is under the marker, not claimed as before it. */
      "same,later",
    ]);
  });

  it("puts the marker after every dated row when all are older, and none without the article's year", () => {
    const rows = [claim("a", B1, "a", { publishedYear: 2001 })];
    expect(orderDebateRows([], rows, "date", ARTICLE, 2022).map((g) => g.kind)).toEqual(["flat", "marker"]);
    expect(orderDebateRows([], rows, "date", ARTICLE, 1990).map((g) => g.kind)).toEqual(["marker", "flat"]);
    expect(orderDebateRows([], rows, "date", ARTICLE, null).map((g) => g.kind)).toEqual(["flat"]);
  });
});

describe("which orders are offered, and which one is drawn", () => {
  const twoClaims = [claim("a", B1, "one", { lean: "leans-for" }), claim("b", B2, "two", { lean: "leans-against" })];

  it("offers by claim and stance on a debate from before stage 2, and nothing needing new data", () => {
    expect(debateOrderOptions([direct("d")], twoClaims, ARTICLE)).toEqual(["claim", "stance"]);
  });

  it("draws by claim when prioritised or date is asked for and no row can support it", () => {
    expect(effectiveDebateOrder([direct("d")], twoClaims, "prioritised", ARTICLE)).toBe("claim");
    expect(effectiveDebateOrder([direct("d")], twoClaims, "date", ARTICLE)).toBe("claim");
    expect(effectiveDebateOrder([direct("d")], twoClaims, "stance", ARTICLE)).toBe("stance");
  });

  it("offers and draws prioritised — the default — once a claim row carries bears", () => {
    const judged = [claim("a", B1, "one", { bears: "partly" }), claim("b", B2, "two", { bears: "directly" })];
    expect(effectiveDebateOrder([], judged, "prioritised", ARTICLE)).toBe("prioritised");
    expect(debateOrderOptions([], judged, ARTICLE)).toContain("prioritised");
  });

  /* `bears` orders and filters claim rows only, so a judgment on a row about
     this piece would offer an order that changes nothing. */
  it("does not offer prioritised when only a row about this piece carries bears", () => {
    const d = { ...direct("d"), bears: "directly" } as DirectDebateRow;
    expect(effectiveDebateOrder([d], twoClaims, "prioritised", ARTICLE)).toBe("claim");
  });

  it("offers all four when the rows carry both fields and each order draws something different", () => {
    const rows = [
      /* prioritised b,c,a · date c,a,b · stance a,b,c · by claim a|b|c. */
      claim("a", B1, "one", { bears: "loosely", publishedYear: 2001, lean: "leans-against" }),
      claim("b", B2, "two", { bears: "directly", publishedYear: 2010, lean: "neither" }),
      claim("c", B3, "three", { bears: "partly", publishedYear: 1990, lean: "leans-for" }),
    ];
    expect(debateOrderOptions([], rows, ARTICLE)).toEqual(["prioritised", "claim", "date", "stance"]);
    expect(effectiveDebateOrder([], rows, "date", ARTICLE)).toBe("date");
  });

  /* A visitor's rows come through the public types, which carry none of the
     new fields: only by claim and stance, whatever the URL asks for. */
  it("gives rows without the new fields only by claim and stance", () => {
    expect(debateOrderOptions([direct("d")], twoClaims, ARTICLE)).toEqual(["claim", "stance"]);
    expect(effectiveDebateOrder([direct("d")], twoClaims, "date", ARTICLE)).toBe("claim");
  });

  /* F14: two buttons that give the same list teach the reader the control does
     nothing. One row cannot be ordered at all. */
  it("offers no bar when every order would draw the same list", () => {
    expect(debateOrderOptions([direct("d")], [], ARTICLE)).toEqual([]);
    expect(debateOrderOptions([], [claim("a", B1, "one")], ARTICLE)).toEqual([]);
    /* Two direct rows already critical-first: stance changes nothing. */
    expect(
      debateOrderOptions([direct("x", "leans-against"), direct("y", "leans-for")], [], ARTICLE),
    ).toEqual([]);
    /* The positive control: the same two the other way round, and stance moves them. */
    expect(
      debateOrderOptions([direct("y", "leans-for"), direct("x", "leans-against")], [], ARTICLE),
    ).toEqual(["claim", "stance"]);
  });

  it("draws the preferred order when the requested one would draw the same list", () => {
    /* Stance would draw exactly what by claim draws, so by claim is what is on
       screen — and it is what the bar would say, if there were one. */
    expect(effectiveDebateOrder([direct("d")], [], "stance", ARTICLE)).toBe("claim");
  });

  it("treats two claim headings as a different list from the same rows flat", () => {
    /* Same row order both ways, but by claim draws two headings and stance none. */
    const rows = [claim("a", B1, "one", { lean: "leans-against" }), claim("b", B2, "two", { lean: "leans-for" })];
    expect(debateOrderOptions([], rows, ARTICLE)).toEqual(["claim", "stance"]);
  });

  it("keeps prioritised distinct when its relevance bar can change an otherwise identical list", () => {
    const rows = [claim("a", B1, "one", { bears: "loosely" })];
    expect(debateOrderOptions([], rows, ARTICLE)).toEqual(["prioritised", "claim"]);
    expect(effectiveDebateOrder([], rows, "claim", ARTICLE)).toBe("claim");
  });

  it("keeps date distinct when its missing-year line or article marker changes the rendered list", () => {
    const rows = [
      claim("dated", B1, "one", { publishedYear: 2020 }),
      claim("undated", B1, "one"),
    ];
    expect(debateOrderOptions([], rows, ARTICLE, 2022)).toContain("date");
    expect(effectiveDebateOrder([], rows, "date", ARTICLE, 2022)).toBe("date");
  });
});

/* GPT Sol round 2, R1: once a bar is drawn, the order on screen must be one of
   its buttons. Moving the identification bar can take away the only row an
   asked-for order needed; the fallback then has to land on a button that is
   there, not on *by claim* when *by claim* was folded into *prioritised*. */
describe("the order drawn is always a button on the bar", () => {
  it("falls back to an offered order when the asked-for one lost its data and by claim was folded away", () => {
    /* One claim, two rows, both judged, different stances: by claim draws one
       heading (which is not structure), so it signs the same as prioritised
       and is not offered; date has no year to sort by. */
    const rows = [
      claim("a", B1, "one", { lean: "leans-for", bears: "directly" }),
      claim("b", B1, "one", { lean: "leans-against", bears: "directly" }),
    ];
    const options = debateOrderOptions([], rows, ARTICLE);
    expect(options).toEqual(["prioritised", "stance"]);
    expect(options).toContain(effectiveDebateOrder([], rows, "date", ARTICLE));
  });

  it("holds for every order asked for, over a spread of debates", () => {
    const debates: { direct: DirectDebateRow[]; claims: ClaimDebateRow[]; year: number | null }[] = [
      {
        direct: [],
        claims: [
          claim("a", B1, "one", { bears: "directly" }),
          claim("b", B1, "one", { lean: "leans-against", bears: "directly" }),
        ],
        year: null,
      },
      { direct: [direct("d")], claims: [claim("a", B1, "one", { lean: "leans-for" }), claim("b", B2, "two")], year: null },
      {
        direct: [],
        claims: [
          claim("a", B1, "one", { publishedYear: 2001, lean: "leans-for" }),
          claim("b", B2, "two", { publishedYear: 1999 }),
        ],
        year: 2000,
      },
      {
        direct: [direct("d", "leans-for")],
        claims: [
          claim("a", B2, "two", { bears: "partly", publishedYear: 2010 }),
          claim("b", B1, "one", { bears: "directly" }),
        ],
        year: 2005,
      },
    ];
    let checked = 0;
    for (const d of debates) {
      const options = debateOrderOptions(d.direct, d.claims, ARTICLE, d.year);
      if (options.length === 0) continue;
      for (const asked of ["prioritised", "claim", "date", "stance"] as const) {
        expect(options).toContain(effectiveDebateOrder(d.direct, d.claims, asked, ARTICLE, d.year));
        checked += 1;
      }
    }
    /* A loop that skipped every debate would pass having checked nothing. */
    expect(checked).toBeGreaterThanOrEqual(12);
  });
});
