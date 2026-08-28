/**
 * **The five predicates, and the two of them that are not the conjunction.**
 *
 * `src/block-policy.ts` exists because `gistable` was one Boolean meaning five
 * different things to five consumers, and the five disagreed. The risk in
 * replacing it is the opposite one: five names over one formula, which reads as
 * policy and states none. So every predicate here is checked against a fixture
 * where it must return **false** as well as one where it must return true — a
 * predicate that returns `true` for everything passes every test written the
 * obvious way (docs/plans/footnotes.md).
 *
 * The two that carry the whole design are `isSearchable`, which must say
 * **true** for a supplement, and `countsTowardReadingTime`, which must say
 * **true** for a `gistable: false` pull-quote. Invert either and this file goes
 * red; that was measured rather than hoped for, and the counts are in the stage
 * report.
 *
 * The reading-time half runs the **real pipeline** over the committed fixtures
 * rather than over hand-built blocks — canonicalise, Readability, sanitise,
 * split — because the numbers this change promises a reader are about gwern and
 * wikipedia, not about a fixture we wrote to make them come out. `ar5iv` is the
 * control: it has no notes and its clock must not move by a minute.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

import {
  articleWordCounts,
  countsTowardReadingTime,
  isBody,
  isBodyEvidence,
  isEmbeddable,
  isSearchable,
  isStructural,
} from "../src/block-policy.js";
import { splitIntoBlocks } from "../src/blocks.js";
import { deriveLibraryScalars } from "../src/library-scalars.js";
import { articleStats } from "../src/web/stats.js";
import { canonicaliseNotes } from "../src/notes.js";
import { readingMinutes } from "../src/reading-time.js";
import { sanitizeHtml } from "../src/sanitize.js";
import type { Block } from "../src/types.js";

/** A body paragraph: gistable, no treatment. Every predicate says yes. */
const PROSE: Block = {
  id: "spya-aaaaaa", tag: "p", kind: "text", text: "The argument.", words: 2,
  html: "<p>The argument.</p>", gistable: true,
};

/** A footnote's prose. Gistable — it is real prose — and apparatus. */
const NOTE: Block = {
  ...PROSE, id: "spya-bbbbbb", text: "A note nobody reads front to back.", words: 7,
  role: "footnote", treatment: "supplement", noteId: "n1",
};

/** An image. Not gistable, and squarely in the body. */
const MEDIA: Block = {
  ...PROSE, id: "spya-cccccc", kind: "media", tag: "figure", text: "", words: 0,
  html: "<figure><img></figure>", gistable: false,
};

/** A pull-quote repeating the paragraph above it: not gistable, still on the page. */
const PULLQUOTE: Block = {
  ...PROSE, id: "spya-dddddd", kind: "quote", tag: "blockquote",
  text: "The argument.", words: 2, gistable: false, note: "repeats body text",
};

/**
 * The **Postgres** spelling of "no treatment", which is `null` and not
 * `undefined`. One read — `scalarInputsQuery` in src/store/pg.ts — hands a raw
 * aggregate straight to `articleWordCounts` without a `Block` projection in
 * between to normalise it, so a predicate that only understood `undefined`
 * would count the notes on the shelf and nowhere else.
 */
const FROM_SQL = { words: 10, treatment: null };
const SUPPLEMENT_FROM_SQL = { words: 10, treatment: "supplement" as const };

describe("isSearchable — the one that includes supplements", () => {
  it("says yes to a footnote, which is the whole point of it", () => {
    /* If this ever goes red because someone made the five predicates agree,
       read src/block-policy.ts before "fixing" it: a note is often the best
       sentence in a piece and hiding it from search is what this feature exists
       not to do. */
    expect(isSearchable(NOTE)).toBe(true);
  });

  it("says yes to a body paragraph", () => {
    expect(isSearchable(PROSE)).toBe(true);
  });

  it("says no to an image — the negative sentinel", () => {
    expect(isSearchable(MEDIA)).toBe(false);
  });
});

describe("isBodyEvidence — what an automatic model call may read", () => {
  it("says no to a footnote — the negative sentinel", () => {
    expect(isBodyEvidence(NOTE)).toBe(false);
  });

  it("says yes to a body paragraph", () => {
    expect(isBodyEvidence(PROSE)).toBe(true);
  });

  it("says yes to a figure in the body, which is not the same question", () => {
    /* Sol's caveat on decision 3: do not quietly remove the code and media that
       automatic prompts see today. `articleText` drops empty text on its own;
       this predicate must not be the thing that decides it. */
    expect(isBodyEvidence(MEDIA)).toBe(true);
  });
});

describe("isEmbeddable and isStructural — gistable AND body", () => {
  it("say no to a footnote", () => {
    expect(isEmbeddable(NOTE)).toBe(false);
    expect(isStructural(NOTE)).toBe(false);
  });

  it("say no to an image", () => {
    expect(isEmbeddable(MEDIA)).toBe(false);
    expect(isStructural(MEDIA)).toBe(false);
  });

  it("say yes to a body paragraph", () => {
    expect(isEmbeddable(PROSE)).toBe(true);
    expect(isStructural(PROSE)).toBe(true);
  });
});

describe("countsTowardReadingTime — body, whatever gistable says", () => {
  it("says no to a footnote — the negative sentinel", () => {
    expect(countsTowardReadingTime(NOTE)).toBe(false);
  });

  it("says YES to a pull-quote that carries no gist", () => {
    /* The second predicate that is not the conjunction, and the one an
       over-eager refactor breaks. Those words are on the page and under the
       reader's eye; whether the ToC can describe them has nothing to do with
       how long the article takes to read. */
    expect(PULLQUOTE.gistable).toBe(false);
    expect(countsTowardReadingTime(PULLQUOTE)).toBe(true);
    expect(isStructural(PULLQUOTE)).toBe(false);
  });

  it("says yes to an image, which costs nothing because it has no words", () => {
    expect(countsTowardReadingTime(MEDIA)).toBe(true);
  });
});

describe("null and undefined are the same absence", () => {
  it("reads a Postgres null as body", () => {
    expect(isBody(FROM_SQL)).toBe(true);
    expect(countsTowardReadingTime(FROM_SQL)).toBe(true);
  });

  it("reads a Postgres 'supplement' as apparatus", () => {
    expect(countsTowardReadingTime(SUPPLEMENT_FROM_SQL)).toBe(false);
  });

  it("sums the two spellings identically", () => {
    /* The failure this guards is a shelf card and a masthead disagreeing by the
       length of the bibliography, with each number looking reasonable on its
       own page — docs/reusable/silent-success.md. */
    const fromFs = [{ words: 10 }, { words: 10, treatment: "supplement" as const }];
    expect(articleWordCounts([FROM_SQL, SUPPLEMENT_FROM_SQL])).toEqual(
      articleWordCounts(fromFs),
    );
  });
});

describe("articleWordCounts", () => {
  it("splits the argument from the apparatus and keeps both", () => {
    expect(articleWordCounts([PROSE, NOTE, PULLQUOTE])).toEqual({
      body: 2 + 2,
      supplement: 7,
      total: 11,
    });
  });

  it("is all body when nothing is classified", () => {
    const counts = articleWordCounts([PROSE, MEDIA, PULLQUOTE]);
    expect(counts.supplement).toBe(0);
    expect(counts.body).toBe(counts.total);
  });
});

/**
 * The one thing the SQL half of library search must keep doing.
 *
 * `pg-shelf.ts` filters on `gistable` in SQL, outside any TypeScript predicate,
 * and the correct change to it was **none** — the plan said otherwise and the
 * plan was wrong (GPT Sol, decision 4). A source-level guard rather than a
 * query test because the query is built inside the search function and a
 * database-gated suite skips itself silently when the database is down, which
 * is the one thing a test defending an absence must not do.
 */
describe("library full-text search stays open to supplements", () => {
  it("has no treatment filter in the Postgres search", () => {
    const source = readFileSync("src/store/pg-shelf.ts", "utf8");
    /* The `where` clause only, and with its comments stripped: the comment
       inside it explains at length why there is no treatment filter, so a
       search over the raw text would fail on the explanation and pass on the
       code — a check that reads the wrong thing in both directions. */
    const clause = source
      .slice(source.indexOf(".where("), source.indexOf(".orderBy("))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(clause).toContain("revisionBlocks.gistable");
    expect(clause).not.toContain("treatment");
  });
});

/**
 * **The two numbers a reader is actually shown, and they have to be the same
 * number.**
 *
 * The masthead over the article you are reading (src/web/stats.ts) and the card
 * you decide from before you open it (src/library-scalars.ts) run on opposite
 * sides of the wire. src/reading-time.ts exists because nothing would ever have
 * told us they had drifted — the card saying 47 min and the masthead 54, both
 * looking perfectly reasonable on their own page — and it shares only the
 * words-per-minute formula, never the numerator. `articleWordCounts` is the
 * numerator, and this is where the two are held to it.
 *
 * Here rather than in tests/library.test.ts because it must run with **no
 * database**: the shelf's own suites are Postgres-gated and skip themselves
 * silently when it is down, which is exactly what a test defending a visible
 * number must not do.
 */
describe("the shelf card and the masthead", () => {
  const withNotes: Block[] = [
    { ...PROSE, id: "spya-100000", words: 2300 },
    { ...NOTE, id: "spya-100001", words: 700 },
  ];
  const tree = {
    version: "1", generator: "t", slug: "s", rootId: "n0",
    nodes: {
      n0: { id: "n0", depth: 0, parent: null, children: [],
        range: ["spya-100000", "spya-100001"], title: "All", gist: "It argues something." },
    },
  } as unknown as Parameters<typeof deriveLibraryScalars>[0]["tree"];

  it("both count the body and neither counts the notes", () => {
    const card = deriveLibraryScalars({ blocks: withNotes, tree });
    const masthead = articleStats({
      slug: "s", meta: { slug: "s", title: "T" }, blocks: withNotes, tree,
    } as unknown as Parameters<typeof articleStats>[0]);

    expect(card.wordCount).toBe(2300);
    expect(masthead.words).toBe(2300);
    expect(masthead.minutes).toBe(readingMinutes(2300));
  });

  it("agree with each other, whatever the article is made of", () => {
    /* The property, not the number: two implementations of one derivation is
       the divergence this pair of modules exists to make impossible. */
    const card = deriveLibraryScalars({ blocks: withNotes, tree });
    const masthead = articleStats({
      slug: "s", meta: { slug: "s", title: "T" }, blocks: withNotes, tree,
    } as unknown as Parameters<typeof articleStats>[0]);
    expect(card.wordCount).toBe(masthead.words);
  });

  it("still count every word when nothing is apparatus", () => {
    // The control: without it both assertions above pass on a derivation that
    // returns zero, or one that drops the last block whatever it is.
    const plain: Block[] = withNotes.map((b) => {
      const { role: _r, treatment: _t, noteId: _n, ...rest } = b;
      return rest;
    });
    expect(deriveLibraryScalars({ blocks: plain, tree }).wordCount).toBe(3000);
  });
});

/* ------------------------------------------------------------------ */

/** Straight through the real pipeline, exactly as `npm run blocks` would. */
function realBlocks(fixture: string): Block[] {
  const dom = new JSDOM(readFileSync(`evals/extraction/fixtures/${fixture}.html`, "utf8"));
  canonicaliseNotes(dom.window.document);
  const article = new Readability(dom.window.document).parse();
  const out = splitIntoBlocks(`<html><body>${sanitizeHtml(article?.content ?? "")}</body></html>`);
  return (Array.isArray(out) ? out : (out as { blocks: Block[] }).blocks) as Block[];
}

describe("the clock, over the real corpus", () => {
  /**
   * Measured by running the pipeline, not copied from the plan. `before` is
   * every block's words, which is what both callers summed until now.
   */
  const cases: { fixture: string; before: number; after: number }[] = [
    { fixture: "gwern", before: 73, after: 55 },
    { fixture: "wiki_transformer", before: 50, after: 35 },
    { fixture: "acx_footnotes", before: 28, after: 23 },
    { fixture: "tufte", before: 10, after: 9 },
    // The control, and the reason the other four are evidence: a fixture with
    // no notes must not move by a minute.
    { fixture: "ar5iv", before: 24, after: 24 },
  ];

  for (const { fixture, before, after } of cases) {
    it(`${fixture}: ${before} min → ${after} min`, () => {
      const blocks = realBlocks(fixture);
      const counts = articleWordCounts(blocks);
      expect(readingMinutes(counts.total)).toBe(before);
      expect(readingMinutes(counts.body)).toBe(after);
    });
  }

  it("ar5iv has no supplement blocks at all, which is why it is the control", () => {
    /* Without this the control passes vacuously on any fixture the classifier
       happens to be silent about, including one where the classifier broke. */
    expect(realBlocks("ar5iv").filter((b) => !isBody(b))).toHaveLength(0);
    expect(realBlocks("gwern").filter((b) => !isBody(b)).length).toBeGreaterThan(0);
  });
}, 120_000);
