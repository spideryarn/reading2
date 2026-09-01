/**
 * What a claims run is allowed to become — `validateClaims` in
 * src/referee-claims.ts.
 *
 * Pure, deterministic, no network and no model. This is the file that holds the
 * three rules the cross-family review made the condition of Claims surviving at
 * all (docs/plans/260831an-referee-mode-for-peer-reviewers.md § 2), and two of
 * the three are properties of *this function* rather than of a prompt:
 *
 * - **Document order, never thinness order.** The sort is by block position and
 *   the comparator cannot see `passages`. The test for it feeds claims in a
 *   thinness-first order and asserts they come out in the paper's order — which
 *   is the only arrangement of the fixture that can tell the two rules apart, so
 *   the fixture is built for that and says so.
 * - **The third empty state.** A claim whose passages were all thrown away must
 *   be distinguishable from one the model named none for, because the panel
 *   prints different sentences and only one of them would be true.
 *
 * The third rule — linkage, never adequacy — is not checkable here and is
 * labelled as such in src/referee-claims-run.ts: `reasoning` is free text and
 * nothing in a validator reads English.
 */
import { describe, expect, it } from "vitest";

import {
  type Claim,
  discardedClaims,
  DOCUMENT_ORDER_NOTE,
  LINKAGE_NOT_ADEQUACY,
  MAX_CLAIMS,
  MAX_PASSAGES,
  NO_PASSAGE_FOUND,
  PASSAGES_UNUSABLE,
  UnreadableClaims,
  validateClaims,
} from "../src/referee-claims.js";
import type { Block } from "../src/types.js";

/**
 * Five blocks in the paper's own order: the abstract makes two claims, and the
 * results section takes them up.
 *
 * **The claim the paper makes first has MORE passages under it.** That is the
 * whole point of the fixture and it took a mutation run to get right. The
 * rejected design ranked claims *by how few supporting passages they had* —
 * thinnest first — so a fixture whose thin claim is also the paper's first claim
 * cannot tell the two rules apart, and the first version of this file had
 * exactly that: the thinness sort was applied and every ordering assertion
 * stayed green. So THICK is stated first and THIN second, and document order and
 * thinness order now disagree about which comes out on top.
 */
const BLOCKS = [
  { id: "spya-anc234", text: "We show that the method halves annotation time." },
  { id: "spya-bqd345", text: "We also show that it generalises to three unseen domains." },
  { id: "spya-cmr456", text: "Median annotation time fell from 40 minutes to 19 minutes." },
  {
    id: "spya-dfw567",
    text: "Accuracy held on law, medicine and finance, none of which were in training.",
  },
  { id: "spya-ekn678", text: "Held-out accuracy was 0.91, 0.88 and 0.90 respectively." },
] as Block[];

/** The claim the paper states **first**, and it has two passages under it. */
const THICK = {
  blockId: "spya-anc234",
  quote: "the method halves annotation time",
  claim: "The method halves annotation time",
  passages: [
    { blockId: "spya-ekn678", quote: "0.91, 0.88 and 0.90", reasoning: "gives the three numbers" },
    { blockId: "spya-cmr456", quote: "fell from 40 minutes to 19 minutes", reasoning: "reports the timing" },
  ],
};

/** The claim the paper states **second**, and it has one. */
const THIN = {
  blockId: "spya-bqd345",
  quote: "it generalises to three unseen domains",
  claim: "It generalises to three unseen domains",
  passages: [
    { blockId: "spya-dfw567", quote: "law, medicine and finance", reasoning: "names the domains" },
  ],
};

describe("rule 1 — document order, never thinness order", () => {
  it("puts the claim with FEWER passages second, because the paper says it second", () => {
    /* Fed thin-first, which is the arrangement the rejected design would have
       produced. The assertion is that it comes out the other way round, and the
       second line is what makes the test discriminating: the winning claim has
       *more* passages, so no ranking by support count in either direction could
       produce this order. */
    const { claims } = validateClaims({ claims: [THIN, THICK] }, BLOCKS);
    expect(claims.map((c) => c.claim)).toEqual([THICK.claim, THIN.claim]);
    expect(claims[0]?.passages.length).toBeGreaterThan(claims[1]?.passages.length ?? 0);
  });

  it("puts a claim's passages in the paper's order too, not the model's", () => {
    const { claims } = validateClaims({ claims: [THICK] }, BLOCKS);
    // Fed eee555 first and ccc333 second; the paper has ccc333 first.
    expect(claims[0]?.passages.map((p) => p.blockId)).toEqual(["spya-cmr456", "spya-ekn678"]);
  });

  it("orders two claims made in the same block by where in it they are made", () => {
    const long = [
      { id: "spya-fpz789", text: "First we claim speed. Second we claim accuracy." },
    ] as Block[];
    const { claims } = validateClaims(
      {
        claims: [
          { blockId: "spya-fpz789", quote: "Second we claim accuracy", claim: "accuracy" },
          { blockId: "spya-fpz789", quote: "First we claim speed", claim: "speed" },
        ],
      },
      long,
    );
    expect(claims.map((c) => c.claim)).toEqual(["speed", "accuracy"]);
  });
});

describe("rule 2 — a null result is about the model, never about the paper", () => {
  /* The sentences are values rather than strings inside the panel precisely so
     they can be checked here. tests/referee-copy-is-about-the-model.test.ts
     holds them to the rule; this only checks they exist and are distinct, which
     is the half that would break silently if somebody merged them. */
  it("has two different sentences for the two different empty states", () => {
    expect(NO_PASSAGE_FOUND).not.toEqual(PASSAGES_UNUSABLE);
    expect(NO_PASSAGE_FOUND).toMatch(/^The model did not find/);
    expect(PASSAGES_UNUSABLE).toMatch(/^The model/);
  });

  it("says out loud what a row is and is not, and that the order is not a ranking", () => {
    expect(LINKAGE_NOT_ADEQUACY.toLowerCase()).toContain("yours to judge");
    expect(DOCUMENT_ORDER_NOTE.toLowerCase()).toContain("not");
    expect(DOCUMENT_ORDER_NOTE.toLowerCase()).toContain("ranked");
  });

  it("keeps a claim with no passages rather than dropping it", () => {
    /* Dropping it would be worse than the sentence it is here to carry: the
       claim would simply not appear, and a referee reading the list would take
       the paper to have claimed only what is in front of them. */
    const { claims } = validateClaims(
      { claims: [{ ...THIN, passages: [] }] },
      BLOCKS,
    );
    expect(claims).toHaveLength(1);
    expect(claims[0]?.passages).toEqual([]);
    expect(claims[0]?.discarded).toBe(0);
  });
});

describe("the third state — named passages that could not be found", () => {
  it("counts them on the claim, so the panel can tell it from having found none", () => {
    const { claims, dropped } = validateClaims(
      {
        claims: [
          {
            ...THIN,
            passages: [
              { blockId: "spya-zwt234", quote: "anything", reasoning: "a block we do not have" },
              { blockId: "spya-cmr456", quote: "a sentence the paper never wrote", reasoning: "" },
            ],
          },
        ],
      },
      BLOCKS,
    );
    expect(claims[0]?.passages).toEqual([]);
    /* The whole assertion. `discarded` of 0 here would make the panel print
       "the model did not find a passage" about an answer that named two. */
    expect(claims[0]?.discarded).toBe(2);
    expect(dropped.passageUnknownIds).toBe(1);
    expect(dropped.passageUnquoted).toBe(1);
  });

  it("does not count a repeated passage as discarded, because the passage is on the row", () => {
    const { claims, dropped } = validateClaims(
      {
        claims: [
          {
            ...THIN,
            passages: [
              { blockId: "spya-cmr456", quote: "fell from 40 minutes", reasoning: "once" },
              { blockId: "spya-cmr456", quote: "fell from 40 minutes", reasoning: "twice" },
            ],
          },
        ],
      },
      BLOCKS,
    );
    expect(claims[0]?.passages).toHaveLength(1);
    expect(claims[0]?.discarded).toBe(0);
    expect(dropped.passageDuplicates).toBe(1);
  });
});

describe("every row is an index into the piece", () => {
  it("replaces the model's typing with the article's own characters", () => {
    const { claims } = validateClaims(
      {
        claims: [
          { ...THICK, quote: "The Method Halves Annotation Time", passages: [] },
        ],
      },
      BLOCKS,
    );
    // Case-folded match, article's casing stored.
    expect(claims[0]?.quote).toBe("the method halves annotation time");
  });

  it("refuses a quote the model split a word in, because that is not a copy", () => {
    /* `findQuote`'s forgiving second pass deletes whitespace entirely and would
       accept this; `"spaced"` does not. The distinction is the difference between
       "which characters do I wash" and "did the model copy this", and this
       validator is asking the second question.
       src/quote-match.ts § `passes`. */
    const { claims, dropped } = validateClaims(
      { claims: [{ ...THICK, quote: "halves anno tation time", passages: [] }] },
      BLOCKS,
    );
    expect(claims).toEqual([]);
    expect(dropped.unquoted).toBe(1);
  });

  it("drops a claim naming a block this article does not have", () => {
    const { claims, dropped } = validateClaims(
      { claims: [{ ...THICK, blockId: "spya-zwt234" }] },
      BLOCKS,
    );
    expect(claims).toEqual([]);
    expect(dropped.unknownIds).toBe(1);
  });

  it("drops a claim with no line saying what the claim is", () => {
    const { claims, dropped } = validateClaims(
      { claims: [{ blockId: "spya-anc234", quote: "halves annotation time" }] },
      BLOCKS,
    );
    expect(claims).toEqual([]);
    expect(dropped.malformed).toBe(1);
  });

  it("gives a claim a stable id derived from its anchor, not a minted one", () => {
    /* Load-bearing rather than cosmetic: a claim is validated twice — once as it
       streams and once over the whole reply — and a minted id would differ
       between the two, so the claim the referee had switched on would go dark
       the moment the authoritative answer landed. */
    const once = validateClaims({ claims: [THICK] }, BLOCKS).claims[0];
    const again = validateClaims({ claims: [THICK] }, BLOCKS).claims[0];
    expect(once?.id).toBe(again?.id);
    expect(once?.id).toContain("spya-anc234");
  });

  it("drops a second claim anchored to the same words", () => {
    const { claims, dropped } = validateClaims({ claims: [THICK, THICK] }, BLOCKS);
    expect(claims).toHaveLength(1);
    expect(dropped.duplicates).toBe(1);
  });
});

describe("what it refuses outright", () => {
  it("throws rather than answering with an empty list it cannot justify", () => {
    /* An unreadable reply quietly becoming `[]` would be stored as the
       meaningful answer *this paper makes no claims up front*, which is a
       sentence about the paper that nothing has earned.
       docs/reusable/silent-success.md. */
    expect(() => validateClaims({ notClaims: [] }, BLOCKS)).toThrow(UnreadableClaims);
    expect(() => validateClaims(null, BLOCKS)).toThrow(UnreadableClaims);
  });

  it("answers an empty list when the model returned one, and counts nothing", () => {
    const { claims, dropped } = validateClaims({ claims: [] }, BLOCKS);
    expect(claims).toEqual([]);
    expect(discardedClaims(dropped)).toBe(0);
  });

  it("tells 'found nothing' apart from 'found things I could not use'", () => {
    const bad = validateClaims({ claims: [{ blockId: "spya-zwt234", quote: "x", claim: "x" }] }, BLOCKS);
    expect(bad.claims).toEqual([]);
    expect(discardedClaims(bad.dropped)).toBe(1);
  });
});

describe("the caps", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      blockId: "spya-fpz789",
      quote: `claim ${i}`,
      claim: `claim ${i}`,
    }));

  it("counts what it truncated rather than trimming in silence", () => {
    const text = many(MAX_CLAIMS + 3)
      .map((c) => c.quote)
      .join(". ");
    const blocks = [{ id: "spya-fpz789", text }] as Block[];
    const { claims, dropped } = validateClaims({ claims: many(MAX_CLAIMS + 3) }, blocks);
    expect(claims).toHaveLength(MAX_CLAIMS);
    expect(dropped.truncated).toBe(3);
  });

  it("caps a claim's passages and counts those too", () => {
    const text = Array.from({ length: MAX_PASSAGES + 2 }, (_, i) => `note ${i}`).join(". ");
    const blocks = [
      { id: "spya-bqd345", text: "We also show that it generalises to three unseen domains." },
      { id: "spya-fpz789", text },
    ] as Block[];
    const { claims, dropped } = validateClaims(
      {
        claims: [
          {
            ...THIN,
            passages: Array.from({ length: MAX_PASSAGES + 2 }, (_, i) => ({
              blockId: "spya-fpz789",
              quote: `note ${i}`,
              reasoning: "",
            })),
          },
        ],
      },
      blocks,
    );
    expect((claims[0] as Claim).passages).toHaveLength(MAX_PASSAGES);
    expect(dropped.passageTruncated).toBe(2);
  });
});
