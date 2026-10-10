/**
 * **How each of Debate's two lists is arranged** (src/web/reception-order.ts),
 * tested without a DOM. Since 2026-10-03 (plan 261003o) the two searches are two
 * sub-modes, so there are two arrangements rather than four orders over one
 * mixed list:
 *
 *  - **Claims** is always grouped by claim, and nothing else.
 *  - **Reception** has three orders, `?debateby=`: *as found* (`prioritised`,
 *    the default), *date* and *stance*.
 *
 * Three properties are invisible on screen until they are wrong:
 *
 *  1. **Claims follows the article, not the search.** Groups are in the order
 *     the piece makes its claims; a claim's identity is `(blockId, claimQuote)`,
 *     so one quote in two blocks is two claims and two quotes in one block are
 *     two claims too; rows sharing a page stay separate rows (260929h's F9).
 *  2. **Stance sorts on `readStoredLean`**, so a row written before the lean
 *     vocabulary changed sorts where its old `valence` says (F11).
 *  3. **An order is offered only when the data behind it exists and it draws
 *     something the others do not**, and asking for one that is not offered
 *     draws the one that is (F6, F14).
 */
import { describe, expect, it } from "vitest";
import type { BlockId, ClaimReceptionRow, ReceptionLean, DirectReceptionRow } from "../src/types.js";
import {
  RELEVANCE_DEFAULT,
  effectiveReceptionOrder,
  groupByClaim,
  orderReceptionRows,
  readAuthors,
  readBears,
  readPublishedYear,
  readWorkTitle,
  receptionOrderOptions,
  visibleClaims,
  yearOf,
} from "../src/web/reception-order.js";

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

function direct(
  id: string,
  lean: ReceptionLean = "leans-against",
  over: Record<string, unknown> = {},
): DirectReceptionRow {
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
    ...over,
  } as DirectReceptionRow;
}

function claim(
  id: string,
  blockId: BlockId,
  claimQuote: string,
  over: Partial<ClaimReceptionRow> & Record<string, unknown> = {},
): ClaimReceptionRow {
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
  } as ClaimReceptionRow;
}

const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id);

describe("Claims, grouped by claim", () => {
  it("draws one group per claim in article order", () => {
    /* The search returned the third block's claim first; the article makes it last. */
    const claims = [
      claim("c-late", B3, "the third thing"),
      claim("c-early", B1, "the first thing"),
      claim("c-mid", B2, "the second thing"),
    ];
    expect(groupByClaim(claims, ARTICLE).map((g) => g.claimQuote)).toEqual([
      "the first thing",
      "the second thing",
      "the third thing",
    ]);
    /* The positive control: without the article's order it keeps the search's. */
    expect(groupByClaim(claims, NO_BLOCKS).map((g) => g.claimQuote)).toEqual([
      "the third thing",
      "the first thing",
      "the second thing",
    ]);
  });

  it("gathers rows that answer the same claim under one heading, in search order", () => {
    const groups = groupByClaim(
      [claim("a", B2, "same"), claim("b", B1, "other"), claim("c", B2, "same")],
      ARTICLE,
    );
    expect(groups).toHaveLength(2);
    expect(ids(groups[1]?.rows ?? [])).toEqual(["a", "c"]);
  });

  it("keeps the same words in two blocks as two claims", () => {
    const groups = groupByClaim([claim("a", B2, "same words"), claim("b", B1, "same words")], ARTICLE);
    expect(groups.map((g) => g.blockId)).toEqual([B1, B2]);
  });

  it("keeps two quotes from one block as two claims, first-seen first", () => {
    const groups = groupByClaim([claim("a", B1, "second quote"), claim("b", B1, "first quote")], ARTICLE);
    expect(groups.map((g) => g.claimQuote)).toEqual(["second quote", "first quote"]);
  });

  it("puts a claim in a block the article does not know after the ones it does", () => {
    const stray = "spya-z9z9z9" as BlockId;
    const groups = groupByClaim([claim("a", stray, "stray"), claim("b", B3, "known")], ARTICLE);
    expect(groups.map((g) => g.claimQuote)).toEqual(["known", "stray"]);
  });

  it("keeps two rows from one page as two rows when they answer two claims", () => {
    const shared = { url: "https://one.example/review" };
    const groups = groupByClaim([claim("a", B1, "one", shared), claim("b", B2, "two", shared)], ARTICLE);
    expect(groups).toHaveLength(2);
    expect(groups.flatMap((g) => ids(g.rows))).toEqual(["a", "b"]);
  });

  it("draws nothing for no claim rows", () => {
    expect(groupByClaim([], ARTICLE)).toEqual([]);
  });

  /* Plan 261003o, step 1: within a claim, the rows the AI judged to bear most
     directly come first and the ones it did not judge last — *prioritised*'s
     rule, now inside each claim. */
  it("puts directly, partly, loosely, then the unjudged, within each claim, search order within each", () => {
    const groups = groupByClaim(
      [
        claim("none", B1, "a"),
        claim("loose", B1, "a", { bears: "loosely" }),
        claim("part-b", B2, "b", { bears: "partly" }),
        claim("direct", B1, "a", { bears: "directly" }),
        claim("none-b", B2, "b"),
        claim("direct-2", B1, "a", { bears: "directly" }),
        claim("direct-b", B2, "b", { bears: "directly" }),
      ],
      ARTICLE,
    );
    expect(groups.map((g) => ids(g.rows))).toEqual([
      ["direct", "direct-2", "loose", "none"],
      ["direct-b", "part-b", "none-b"],
    ]);
  });

  /* A row stored before `bears` existed, with the old `valence` vocabulary,
     is an unjudged row and still has its group. */
  it("still groups a legacy row with no bears and the old valence", () => {
    const legacy = { ...claim("legacy", B1, "a"), valence: "negative" } as Record<string, unknown>;
    delete legacy.lean;
    const groups = groupByClaim([legacy as unknown as ClaimReceptionRow, claim("new", B1, "a", { bears: "partly" })], ARTICLE);
    expect(groups).toHaveLength(1);
    expect(ids(groups[0]?.rows ?? [])).toEqual(["new", "legacy"]);
  });
});

describe("Reception, as found", () => {
  it("leaves the rows in the order the search found them, with no heading", () => {
    const rows = [direct("for", "leans-for"), direct("against", "leans-against")];
    const groups = orderReceptionRows(rows, "prioritised");
    expect(groups.map((g) => g.kind)).toEqual(["flat"]);
    expect(ids(groups[0]?.rows ?? [])).toEqual(["for", "against"]);
  });

  it("draws nothing for no rows", () => {
    expect(orderReceptionRows([], "prioritised")).toEqual([]);
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
    const [flat, ...rest] = orderReceptionRows(rows, "stance");
    expect(rest).toHaveLength(0);
    expect(flat?.kind).toBe("flat");
    expect(ids(flat?.rows ?? [])).toEqual(["against-1", "against-2", "cannot", "neither", "for"]);
  });

  /* The row the database hands back from before 2026-09-08: `valence`, no
     `lean`. Indexing by `row.lean` would sort it as `undefined`. */
  it("sorts a row stored under the old vocabulary by what its valence meant", () => {
    const legacy = { ...direct("legacy-negative"), valence: "negative" } as Record<string, unknown>;
    delete legacy.lean;
    const rows = [direct("for", "leans-for"), legacy as unknown as DirectReceptionRow];
    const [flat] = orderReceptionRows(rows, "stance");
    expect(ids(flat?.rows ?? [])).toEqual(["legacy-negative", "for"]);
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
    const groups = orderReceptionRows(
      [
        direct("d"),
        direct("new", "neither", { publishedYear: 2020 }),
        direct("old", "neither", { publishedYear: 1999 }),
        direct("new-2", "neither", { publishedYear: 2020 }),
      ],
      "date",
    );
    expect(groups.map((g) => g.kind)).toEqual(["flat", "undated"]);
    expect(ids(groups[0]?.rows ?? [])).toEqual(["old", "new", "new-2"]);
    expect(ids(groups[1]?.rows ?? [])).toEqual(["d"]);
  });

  it("marks the article's own year before the first row of that year or later", () => {
    const groups = orderReceptionRows(
      [
        direct("later", "neither", { publishedYear: 2024 }),
        direct("same", "neither", { publishedYear: 2022 }),
        direct("earlier", "neither", { publishedYear: 2016 }),
      ],
      "date",
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
    const rows = [direct("a", "neither", { publishedYear: 2001 })];
    expect(orderReceptionRows(rows, "date", 2022).map((g) => g.kind)).toEqual(["flat", "marker"]);
    expect(orderReceptionRows(rows, "date", 1990).map((g) => g.kind)).toEqual(["marker", "flat"]);
    expect(orderReceptionRows(rows, "date", null).map((g) => g.kind)).toEqual(["flat"]);
  });

  /* Reception draws two groups, each ordered on its own. A marker over a group
     with no dated row in it would mark a place in nothing. */
  it("draws no marker over rows none of which has a year", () => {
    expect(orderReceptionRows([direct("a")], "date", 2022).map((g) => g.kind)).toEqual(["undated"]);
  });
});

/* The panel hands these Reception's two identification groups — the rows that
   link or quote the piece, and the ones that only name it — because each order
   is applied **within** each (plan 261003o, step 5). */
describe("which orders Reception offers, and which one is drawn", () => {
  const forThenAgainst = [direct("y", "leans-for"), direct("x", "leans-against")];

  it("offers as found and stance when stance would move a row, and nothing needing a year", () => {
    expect(receptionOrderOptions([forThenAgainst, []])).toEqual(["prioritised", "stance"]);
  });

  it("offers all three when the rows carry years and each order draws something different", () => {
    const rows = [
      /* as found a,b,c · date c,a,b · stance b,c,a. */
      direct("a", "leans-for", { publishedYear: 2001 }),
      direct("b", "leans-against", { publishedYear: 2010 }),
      direct("c", "neither", { publishedYear: 1990 }),
    ];
    expect(receptionOrderOptions([rows, []])).toEqual(["prioritised", "date", "stance"]);
    expect(effectiveReceptionOrder([rows, []], "date")).toBe("date");
  });

  /* F14: two buttons that give the same list teach the reader the control does
     nothing. One row cannot be ordered at all. */
  it("offers no bar when every order would draw the same list", () => {
    expect(receptionOrderOptions([[direct("d")], []])).toEqual([]);
    expect(receptionOrderOptions([[], []])).toEqual([]);
    /* Two rows already critical-first: stance changes nothing. */
    expect(receptionOrderOptions([[direct("x", "leans-against"), direct("y", "leans-for")], []])).toEqual([]);
  });

  /* Each order is applied within a group, so two rows in *different* groups
     are never reordered against each other — and an order that could only
     have moved one past the other is not offered. */
  it("does not offer an order that could only move a row across the two groups", () => {
    expect(receptionOrderOptions([[direct("y", "leans-for")], [direct("x", "leans-against")]])).toEqual([]);
    /* The positive control: the same two rows in one group, and stance moves them. */
    expect(receptionOrderOptions([forThenAgainst, []])).toContain("stance");
    /* …and it is offered when it reorders the title-only group alone. */
    expect(receptionOrderOptions([[], forThenAgainst])).toContain("stance");
  });

  it("draws as found when date is asked for and no row carries a year", () => {
    expect(effectiveReceptionOrder([forThenAgainst, []], "date")).toBe("prioritised");
    expect(effectiveReceptionOrder([forThenAgainst, []], "stance")).toBe("stance");
  });

  it("draws as found when the requested order would draw the same list", () => {
    expect(effectiveReceptionOrder([[direct("d")], []], "stance")).toBe("prioritised");
  });

  it("keeps date distinct when its missing-year line or article marker changes the rendered list", () => {
    const rows = [direct("dated", "neither", { publishedYear: 2020 }), direct("undated")];
    expect(receptionOrderOptions([rows, []], 2022)).toContain("date");
    expect(effectiveReceptionOrder([rows, []], "date", 2022)).toBe("date");
  });

  /* GPT Sol round 2 of 260929h, R1: once a bar is drawn, the order on screen
     must be one of its buttons. */
  it("always draws an order that is a button on the bar, over a spread of debates", () => {
    const debates: { sections: DirectReceptionRow[][]; year: number | null }[] = [
      { sections: [forThenAgainst, []], year: null },
      { sections: [[], forThenAgainst], year: null },
      {
        sections: [
          [direct("a", "leans-for", { publishedYear: 2001 }), direct("b", "neither", { publishedYear: 1999 })],
          [direct("c", "leans-against")],
        ],
        year: 2000,
      },
      {
        sections: [[direct("a", "leans-against", { publishedYear: 2010 }), direct("b", "leans-against")], []],
        year: 2005,
      },
    ];
    let checked = 0;
    for (const d of debates) {
      const options = receptionOrderOptions(d.sections, d.year);
      if (options.length === 0) continue;
      for (const asked of ["prioritised", "date", "stance"] as const) {
        expect(options).toContain(effectiveReceptionOrder(d.sections, asked, d.year));
        checked += 1;
      }
    }
    /* A loop that skipped every debate would pass having checked nothing. */
    expect(checked).toBeGreaterThanOrEqual(12);
  });
});
