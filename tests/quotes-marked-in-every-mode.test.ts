/**
 * **The quotes are marked in the prose in every mode, and in the paragraph bar
 * and the spine rail in none of them.**
 *
 * Greg, 2026-09-08 (SPIDERYARN-READING2-2P):
 *
 * > Always show the quotes (highlighted with a border around them), if there are
 * > any that have been generated. Always show them in the text view, even if
 * > we're not in quotes mode.
 *
 * The first half is the request. **The second half is the half that a careless
 * implementation gets wrong**, and it is why `proseFound` exists at all rather
 * than the two arrays being concatenated at the call site: `Reader` feeds its
 * chosen passages to four consumers, and only one of them may see the quotes.
 * An implementation that merged once, upstream of all four, satisfies every
 * assertion about `data-quote` in this file and quietly repaints the article's
 * paragraph bars. See `proseFound` in src/web/reader/passages.ts for the two
 * channels that would be destroyed.
 *
 * Node rather than jsdom: everything here is a pure function over `Found[]`.
 * What the *browser* does with the result — that the spans land on the right
 * characters — is tests/quote-marks.test.ts, in jsdom, for the reason that file
 * gives. And that the reading view is wired to call these at all is
 * tests/glossary-band-wiring.test.ts.
 *
 * docs/plans/260908i-quotes-marked-in-the-prose-in-every-mode.md.
 */
import { describe, expect, it } from "vitest";

import { MODES } from "../src/modes.js";
import { NO_FOUND, proseFound, selectPassages, type PassageSlots } from "../src/web/reader/passages.js";
import { blockHues, blockMatches, blockStrength, type Found } from "../src/web/search-hits.js";
import type { BlockId } from "../src/types.js";

const ONE = "spya-aaaaaa" as BlockId;
const TWO = "spya-bbbbbb" as BlockId;

/**
 * A search hit the model was **hedged** about — `confidence: 40`, which is the
 * whole point of it. A quote has no confidence at all, and `blockStrength` reads
 * `confidence === null ? 1`, so a quote allowed into that projection would take
 * this paragraph's bar from 0.4 to 1 and say the model was certain.
 */
const HEDGED: Found = {
  key: "search-1",
  blockId: ONE,
  runId: "run-a",
  slot: 0,
  index: 0,
  start: 0,
  end: 5,
  confidence: 40,
  valence: null,
  reasoning: "",
  quoteTier: null,
  /* The snippet fields the panel shows. Nothing here reads them — every
     assertion below is about which passages reach which projection — but the
     type is what stops a `Found` being half-built somewhere that does. */
  short: "hedge",
  long: "a hedged match",
  at: 0,
  whole: false,
};

/** A quote over the same paragraph, and one over a paragraph nothing else touched. */
const QUOTED: Found[] = [
  { ...HEDGED, key: "quote-1", runId: "quotes", confidence: null, quoteTier: 1, start: 2, end: 9 },
  {
    ...HEDGED,
    key: "quote-2",
    blockId: TWO,
    runId: "quotes",
    confidence: null,
    quoteTier: 2,
    start: 0,
    end: 7,
  },
];

const QUOTES_SLOT = { found: QUOTED, openKey: null };
const EMPTY = { found: NO_FOUND, openKey: null };

function slots(overrides: Partial<PassageSlots> = {}): PassageSlots {
  return {
    ideas: EMPTY,
    quotes: QUOTES_SLOT,
    timeline: EMPTY,
    referee: EMPTY,
    search: { found: [HEDGED], openKey: null },
    ...overrides,
  };
}

describe("the quotes are marked wherever the reader is standing", () => {
  it("marks the prose in a mode with no passages of its own", () => {
    /* Plain: `selectPassages` answers `NO_FOUND`, and the article still wears
       its quotes. This is the sentence Greg asked for. */
    const active = selectPassages("plain", slots());
    expect(active.found).toBe(NO_FOUND);
    expect(proseFound(active.found, QUOTED)).toEqual(QUOTED);
  });

  it("marks the prose in a mode that has passages of its own, without losing either", () => {
    const active = selectPassages("search", slots());
    const marked = proseFound(active.found, QUOTED);
    expect(marked.map((f) => f.key).sort()).toEqual(["quote-1", "quote-2", "search-1"]);
  });

  it("does not double the quotes in quotes mode, where they are already the slot", () => {
    /* The case the length checks alone would answer by concatenating the list
       with itself — every quote drawn twice, and the `unpressed` cache keyed on
       an array that changes identity every render. */
    const active = selectPassages("quotes", slots());
    expect(proseFound(active.found, QUOTED)).toBe(QUOTED);
  });

  it("holds every mode to it, so a fifteenth cannot quietly opt out", () => {
    /* Driven from `MODES` rather than a list written here, which is the rule
       tests/every-mode-says-which-passages-it-marks.test.ts established: a new
       mode is already a compile error in `selectPassages`, and this makes it a
       red test too. */
    for (const mode of MODES) {
      const marked = proseFound(selectPassages(mode, slots()).found, QUOTED);
      expect(marked.filter((f) => f.runId === "quotes"), `${mode} must mark the quotes`).toHaveLength(2);
    }
  });
});

describe("and nowhere else", () => {
  /* The three projections the quotes must NOT reach. Each is asserted against
     the *open mode's* slot, which is what `Reader` passes them, and then again
     against the merged list to show what the difference is worth — a test that
     only checked the first would pass against an implementation that merged
     upstream of everything. */
  it("leaves a hedged search's paragraph bar at the model's own confidence", () => {
    const active = selectPassages("search", slots()).found;
    expect(blockStrength(active).get(ONE)).toBeCloseTo(0.4);
    /* What it would have been. A quote's `confidence` is null, which
       `blockStrength` reads as certainty. */
    expect(blockStrength(proseFound(active, QUOTED)).get(ONE)).toBe(1);
  });

  it("keeps a search's own hue out of a paragraph only a quote is in", () => {
    const active = selectPassages("search", slots()).found;
    expect(blockHues(active).has(TWO), "no search matched the second paragraph").toBe(false);
    /* And what it would have been: every quote carries `slot: 0` so the spine
       rail can pack one lane, and slot 0 is the *first saved search's* colour. */
    expect(blockHues(proseFound(active, QUOTED)).get(TWO)).toEqual([0]);
  });

  it("keeps the spine rail counting the open mode's matches only", () => {
    const active = selectPassages("search", slots()).found;
    expect(blockMatches(active).get(ONE)?.count).toBe(1);
    expect(blockMatches(proseFound(active, QUOTED)).get(ONE)?.count).toBe(2);
  });
});

describe("the empty cases, which are about identity rather than about content", () => {
  /* `hitMarks` caches its work on the array **by identity** in a WeakMap, and
     `NO_FOUND` is the one empty array every non-producer shares. A `proseFound`
     that allocated on the way past would rebuild every block's marks on every
     render, in Plain, where there is nothing to draw at all. */
  it("hands back the shared empty array when there is nothing at all", () => {
    expect(proseFound(NO_FOUND, [])).toBe(NO_FOUND);
  });

  it("hands back the other side unchanged rather than copying it", () => {
    const active = [HEDGED];
    expect(proseFound(active, [])).toBe(active);
    expect(proseFound(NO_FOUND, QUOTED)).toBe(QUOTED);
  });
});
