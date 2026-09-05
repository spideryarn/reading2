/**
 * **Debate's pure half — the refusals, and the counting.** No network, no model.
 *
 * Everything here is a way this mode would be wrong *quietly*, and the mode is
 * unusually prone to that because of the one fact Stage 0 established:
 *
 * > **The web search never comes back empty.** Asked for pages responding to an
 * > invented blog post at a domain that does not exist, three searches ran and
 * > nine annotations came back — every one a real, correctly-cited page about
 * > sourdough starters, and not one of them a response to anything.
 *
 * So a panel showing nine plausible rows with real hostnames and real quotations
 * looks *exactly* like a panel that works. Nothing about it is visibly wrong.
 * What separates the two is entirely in this file: `articleReferenceQuote`,
 * `claimQuote`, `sourceQuote`, `selfSource`, and the counts that say how many
 * rows each refusal cost.
 *
 * The sourdough fixture below is built from that probe's own hostnames, and it
 * is the case the plan named as a required test: an article with no reception
 * yields an **empty group one** and a group two whose every row carries its
 * quotes, with the drop counts shown.
 *
 * ## What is deliberately not here
 *
 * Whether the prompts *work* — whether a real model, told to be restrained,
 * finds the reviews that exist and leaves the sourdough blogs alone. Only a
 * model can answer that, and it costs $0.13–0.27 a run to ask.
 *
 * docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md
 * docs/plans/260905f-debate-mode-stage-0-spike-results.md
 */
import { describe, expect, it } from "vitest";
import {
  anyLost,
  CLAIMS_SYSTEM,
  DEBATE_FENCE,
  DIRECT_SYSTEM,
  distinctSources,
  emptyLosses,
  locate,
  MAX_CLAIM_ROWS,
  MAX_DIRECT_ROWS,
  PROMPT_VERSION,
  blockTextById,
  readClaimGroup,
  readDirectGroup,
} from "../src/debate.js";
import { findQuote } from "../src/quote-match.js";
import { kindOfMessage, worthRetrying, DEBATE_SEARCH_DID_NOT_RUN } from "../src/messages.js";
import type { Block, SearchEvidence } from "../src/types.js";

const block = (id: string, text: string): Block => ({
  id,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
});

/**
 * The article the Stage 0 probe pretended to have written: a private baking
 * journal at a domain that does not exist, with no reception whatever.
 */
const ARTICLE_URL = "https://gregs-private-baking-notes.example/starter-week-3";

const blocks: Block[] = [
  block(
    "spya-aaaaaa",
    "A starter left at room temperature will fall apart within a week unless it is fed twice a day.",
  ),
  block(
    "spya-bbbbbb",
    "Rye flour ferments faster than white, so a rye starter reaches its peak several hours sooner.",
  ),
];

const blockText = blockTextById(blocks);

/**
 * **The nine pages the probe actually got back**, by their real hostnames.
 *
 * Every one is a genuine page about sourdough starters and none of them has ever
 * heard of the article. Their extracts are written here as the sort of prose
 * such a page carries — which is the point: there is nothing about any of them a
 * shape check could refuse.
 */
const SOURDOUGH: SearchEvidence[] = [
  {
    url: "https://mlym.gregtech.eu/day-three",
    title: "Day three of my starter",
    excerpt:
      "On day three the starter smells sharp and there is very little rise. Do not panic and do " +
      "not throw it out. Keep feeding twice a day and it will settle.",
  },
  {
    url: "https://myeclecticbites.com/sourdough-starter-notes",
    title: "Sourdough starter notes",
    excerpt:
      "A starter kept on the counter will collapse in about a week if you feed it only once a " +
      "day. Twice is the number that works in a cool kitchen.",
  },
  {
    url: "https://gratzioso.net/warm-water-starters",
    title: "Warmer water for a young starter",
    excerpt:
      "Day-three starters want warmer water than most recipes suggest — around 30C rather than " +
      "room temperature — and the difference in activity is obvious within hours.",
  },
  {
    url: "https://nequalsonelifestyle.com/rye-vs-white",
    title: "Rye against white",
    excerpt:
      "Rye ferments faster than white flour, which is why a rye starter peaks earlier and then " +
      "falls earlier too. Plan your bake around the peak, not around the clock.",
  },
  {
    url: "https://sourdoughstarter.com/feeding-schedules",
    title: "Feeding schedules",
    excerpt:
      "Once a day is enough in a cold house. Twice a day is enough almost everywhere. Three " +
      "times is for a starter you are trying to rescue.",
  },
  {
    url: "https://consillar.com/fermentation-temperature",
    title: "Fermentation and temperature",
    excerpt:
      "Every ten degrees roughly doubles the rate of fermentation, so the same starter behaves " +
      "like two different starters in summer and winter.",
  },
];

const evidenceMap = (rows: readonly SearchEvidence[]): Map<string, SearchEvidence> =>
  new Map(rows.map((r) => [r.url, r]));

const admissible = evidenceMap(SOURDOUGH);

const groupInput = { admissible, articleUrl: ARTICLE_URL };

const claimInput = { ...groupInput, blockText };

/* ------------------------------------------------------ the sourdough fixture -- */

describe("an article nobody has written about", () => {
  /**
   * **THE test of this file**, and the one the plan named by name.
   *
   * The model has been handed nine real pages and has done exactly what Stage 0
   * showed a model does: written them up as though they were responses. Every
   * row here is *well formed* — a URL the search genuinely returned, a quotation
   * genuinely in that page's extract, a relation, a valence, a sentence about
   * how it applies. Rule 1 passes on all of them.
   *
   * What none of them can do is show the page naming this article, because none
   * of them does. So group one is empty, and the count says why.
   */
  it("keeps no direct row, and says the reason was directness", () => {
    const reported = SOURDOUGH.slice(0, 3).map((page) => ({
      url: page.url,
      sourceQuote: page.excerpt!.slice(0, 40),
      /* The model's best attempt at the witness, and it is a paraphrase of the
         article rather than words the page contains — which is what a model
         produces when the page contains nothing of the kind. */
      articleReferenceQuote: "Greg's recent notes on his starter",
      relation: "qualifies",
      valence: "neutral",
      applies: "It bears on how often a young starter needs feeding.",
    }));

    const group = readDirectGroup(reported, groupInput, 3);

    expect(group.rows).toEqual([]);
    expect(group.counts.reportedRows).toBe(3);
    expect(group.counts.keptRows).toBe(0);
    expect(group.counts.lost.directnessUnverified).toBe(3);
    /* Not counted as anything else — the row was admissible right up to the one
       rule it fails, and a loss filed under the wrong reason is a foot line that
       tells the reader something untrue. */
    expect(group.counts.lost.uncited).toBe(0);
    expect(group.counts.lost.unverifiedSource).toBe(0);
    expect(anyLost(group.counts.lost)).toBe(true);
  });

  /**
   * Group two is where those same nine pages legitimately belong — they *do*
   * bear on the claims, they simply are not about the piece — so this is the
   * half that has to work rather than the half that has to refuse.
   *
   * Every surviving row carries all four things the plan requires, and the
   * assertion is written over the row itself rather than over a count, because
   * "three rows survived" is true of a validator that kept the wrong three.
   */
  it("keeps claim rows, each carrying its block, its claim quote and its source quote", () => {
    const reported = [
      {
        url: "https://myeclecticbites.com/sourdough-starter-notes",
        blockId: "spya-aaaaaa",
        claimQuote: "fall apart within a week unless it is fed twice a day",
        sourceQuote: "A starter kept on the counter will collapse in about a week",
        relation: "corroborates",
        valence: "positive",
        applies: "It reports the same collapse over the same period.",
      },
      {
        url: "https://nequalsonelifestyle.com/rye-vs-white",
        blockId: "spya-bbbbbb",
        claimQuote: "Rye flour ferments faster than white",
        sourceQuote: "Rye ferments faster than white flour",
        relation: "extends",
        valence: "positive",
        applies: "It adds that a rye starter also falls earlier.",
        limits: "It says nothing about how much sooner the peak comes.",
      },
    ];

    const group = readClaimGroup(reported, claimInput, 4);

    expect(group.counts.keptRows).toBe(2);
    expect(anyLost(group.counts.lost)).toBe(false);
    for (const row of group.rows) {
      expect(row.blockId).toMatch(/^spya-/);
      expect(row.claimQuote.length).toBeGreaterThan(0);
      expect(row.sourceQuote.length).toBeGreaterThan(0);
      expect(row.applies.length).toBeGreaterThan(0);
      /* The claim quote really is in the block it names — asserted here rather
         than trusted, because that is the whole content of the rule. */
      expect(blockText.get(row.blockId)).toContain(row.claimQuote);
    }
    expect(group.rows[1]?.limits).toBeTruthy();
    /* `limits` is optional and its absence must not be filled in: a mandatory
       caveat field manufactures caveats, which is why the first draft's rule was
       cut. */
    expect(group.rows[0]?.limits).toBeUndefined();
  });

  /**
   * **The counts the panel's foot line reads**, and the reason `returnedSources`
   * exists at all.
   *
   * A model handed evidence from six pages reported two rows, both validated,
   * and every loss counter reads zero. Without this number the panel would say
   * nothing at all, and four pages the search returned would have gone
   * unmentioned. `reportedRows` counts the model's output and must never stand
   * in for what the search found.
   */
  it("says how many pages the search returned, whatever the model reported", () => {
    const reported = [
      {
        url: "https://myeclecticbites.com/sourdough-starter-notes",
        blockId: "spya-aaaaaa",
        claimQuote: "fed twice a day",
        sourceQuote: "Twice is the number that works",
        relation: "corroborates",
        valence: "positive",
        applies: "Same schedule.",
      },
    ];

    const group = readClaimGroup(reported, claimInput, 4);

    expect(group.counts.returnedSources).toBe(SOURDOUGH.length);
    expect(group.counts.reportedRows).toBe(1);
    expect(group.counts.keptRows).toBe(1);
    expect(anyLost(group.counts.lost)).toBe(false);
    /* Six pages returned, one contributing — the exact pair the foot line
       compares, and the whole reason it cannot be derived from the losses. */
    expect(distinctSources(group.rows)).toBe(1);
    expect(distinctSources(group.rows)).not.toBe(group.counts.returnedSources);
  });
});

/* --------------------------------------------------------------- rule 1 & 2 -- */

describe("a row's identity is a URL the search returned", () => {
  const claimRow = (url: string) => ({
    url,
    blockId: "spya-aaaaaa",
    claimQuote: "fed twice a day",
    sourceQuote: "Twice is the number that works",
    relation: "corroborates",
    valence: "positive",
    applies: "Same schedule.",
  });

  it("refuses a real-looking URL the search never returned", () => {
    const group = readClaimGroup([claimRow("https://theatlantic.com/starters")], claimInput, 2);
    expect(group.rows).toEqual([]);
    expect(group.counts.lost.uncited).toBe(1);
  });

  it("refuses a URL that is not http(s) at all", () => {
    const group = readClaimGroup([claimRow("javascript:alert(1)")], claimInput, 2);
    expect(group.rows).toEqual([]);
    expect(group.counts.lost.uncited).toBe(1);
  });

  /**
   * **The title is the search result's, never the model's.**
   *
   * A plausible title beside a real address is exactly what a model produces
   * well, and a title is the most prominent thing on a row after the host.
   */
  it("shows the search result's title, not the model's", () => {
    const group = readClaimGroup(
      [
        {
          ...claimRow("https://myeclecticbites.com/sourdough-starter-notes"),
          title: "A Devastating Rebuttal",
        },
      ],
      claimInput,
      2,
    );
    expect(group.rows[0]?.title).toBe("Sourdough starter notes");
  });
});

/**
 * **`selfSource`: the article presenting itself as a response to itself.**
 *
 * Such a row passes every other defence here — real URL, real quotation from
 * that URL, real claim quote — and Stage 0 already saw the article come back
 * among its own annotations. The comparison is `sameTarget`'s request identity,
 * deliberately **not** `urlKey`, whose folding of `http` into `https` and `www.`
 * into the bare host is generous in the wrong direction.
 *
 * The three spellings below are the three the plan asks for by name.
 */
describe("the article cannot cite itself", () => {
  const asRow = (url: string) => ({
    url,
    blockId: "spya-aaaaaa",
    claimQuote: "fed twice a day",
    sourceQuote: "fall apart within a week",
    relation: "corroborates",
    valence: "positive",
    applies: "It says exactly this.",
  });

  for (const [name, url] of [
    ["the exact spelling", ARTICLE_URL],
    ["a fragment-bearing one", `${ARTICLE_URL}#spya-aaaaaa`],
    ["a percent-encoded path", "https://gregs-private-baking-notes.example/starter%2Dweek%2D3"],
  ] as const) {
    it(`refuses ${name}`, () => {
      const group = readClaimGroup(
        [asRow(url)],
        /* **The map the stage would hand in**, which is the post-refusal one: the
           article is not in it. So this case is asking the row rule, not the
           annotation rule — the row names an address the search never offered
           and is still refused as `selfSource` rather than as `uncited`. */
        { admissible: evidenceMap(SOURDOUGH), articleUrl: ARTICLE_URL, blockText },
        2,
      );
      expect(group.rows).toEqual([]);
      /* **Under the reason that describes it, not as `uncited`.** The order of
         the checks is what makes this true: test the article's own address
         first, or the row is refused for the wrong and untrue reason. */
      expect(group.counts.lost.selfSource).toBe(1);
      expect(group.counts.lost.uncited).toBe(0);
    });
  }

  /* **The other half of this rule is not here, deliberately.** The same refusal
     is applied to the *annotations*, which is what keeps the piece the reader is
     already holding out of *"the search returned evidence from N pages"* — and
     that happens in `runPass`, where the annotations arrive. Asserting it here
     would mean building both maps in the test and then checking the test's own
     arithmetic. tests/debate-passes.test.ts § *counts the pages the search
     returned, minus the article itself* asks it of the code. */
});

/* ------------------------------------------------------------- rules 3 and 4 -- */

describe("no row survives as an unchecked paraphrase", () => {
  /**
   * **A failure drops the WHOLE row, not the quote.**
   *
   * The first draft let a row survive as "a paraphrase, labelled as one", and
   * that is precisely the hole: a model can attach an invented critique to an
   * unrelated but real annotation URL, and a label saying "paraphrase" does not
   * stop it being read as evidence.
   */
  it("drops the row when the source quote is not in that page's extract", () => {
    const group = readClaimGroup(
      [
        {
          url: "https://gratzioso.net/warm-water-starters",
          blockId: "spya-aaaaaa",
          claimQuote: "fed twice a day",
          sourceQuote: "this article is wrong about everything",
          relation: "disputes",
          valence: "negative",
          applies: "It rejects the piece outright.",
        },
      ],
      claimInput,
      2,
    );
    expect(group.rows).toEqual([]);
    expect(group.counts.lost.unverifiedSource).toBe(1);
  });

  /**
   * **The stored string is the haystack's characters, never the model's spelling
   * of them.**
   *
   * A model that retypes a quotation with different capitalisation and
   * whitespace still matches under the spaced pass — and what goes in the
   * artefact, and out to a stranger through the public DTO, has to be what the
   * page said rather than what the model typed.
   */
  it("stores the matched slice of the page, not the model's retyping", () => {
    const group = readClaimGroup(
      [
        {
          url: "https://consillar.com/fermentation-temperature",
          blockId: "spya-bbbbbb",
          claimQuote: "Rye flour ferments faster than white",
          sourceQuote: "every  ten\ndegrees ROUGHLY doubles the rate",
          relation: "extends",
          valence: "neutral",
          applies: "It gives the temperature rule behind the difference.",
        },
      ],
      claimInput,
      2,
    );
    expect(group.counts.keptRows).toBe(1);
    expect(group.rows[0]?.sourceQuote).toBe("Every ten degrees roughly doubles the rate");
  });

  /**
   * **The mutation that proves the matcher is the spaced one.**
   *
   * `findQuote`'s default is `"forgiving"`, whose second pass deletes whitespace
   * entirely and therefore accepts *fall a part* as a quotation of *fall apart*.
   * Its own docblock says that pass is for the browser and that on the server it
   * "buys nothing and costs the guarantee" — this mode's whole guarantee.
   *
   * Both halves are asserted: the default really would accept the split token
   * (so the test is about a live hazard rather than an imagined one), and
   * `locate` really does not.
   */
  it("refuses a word the model split in two, which the default matcher would accept", () => {
    const page = blocks[0]!.text;
    const split = "fall a part within a week";

    /* The hazard, demonstrated rather than described. */
    expect(findQuote(page, split)).not.toBeNull();

    expect(locate(page, split)).toBeNull();
    expect(locate(page, "fall apart within a week")).toBe("fall apart within a week");
  });

  it("drops a claim row whose quote is a paraphrase of the block", () => {
    const group = readClaimGroup(
      [
        {
          url: "https://myeclecticbites.com/sourdough-starter-notes",
          blockId: "spya-aaaaaa",
          claimQuote: "starters collapse if underfed",
          sourceQuote: "Twice is the number that works",
          relation: "corroborates",
          valence: "positive",
          applies: "Same schedule.",
        },
      ],
      claimInput,
      2,
    );
    expect(group.rows).toEqual([]);
    expect(group.counts.lost.claimNotInBlock).toBe(1);
  });

  it("drops a claim row naming a block this article does not have", () => {
    const group = readClaimGroup(
      [
        {
          url: "https://myeclecticbites.com/sourdough-starter-notes",
          blockId: "spya-zzzzzz",
          claimQuote: "fed twice a day",
          sourceQuote: "Twice is the number that works",
          relation: "corroborates",
          valence: "positive",
          applies: "Same schedule.",
        },
      ],
      claimInput,
      2,
    );
    expect(group.rows).toEqual([]);
    /* Its own reason rather than `claimNotInBlock`: a model naming a passage
       that has gone and a model paraphrasing one that is still there are two
       different failures, and only the first is what a re-extraction causes. */
    expect(group.counts.lost.unknownBlockId).toBe(1);
    expect(group.counts.lost.claimNotInBlock).toBe(0);
  });

  /**
   * A group-one row whose witness the page really does carry — so the rule is
   * shown to admit as well as to refuse, and the stored witness is the page's
   * own characters.
   */
  it("keeps a direct row whose page names the article, storing the page's words", () => {
    const review: SearchEvidence = {
      url: "https://bakingreview.example/on-gregs-notes",
      title: "On Greg's starter notes",
      excerpt:
        "Greg's Notes on my sourdough starter, week 3 argues for twice-daily feeding. That is " +
        "true in a cool kitchen and wrong in a warm one.",
    };
    const withReview = evidenceMap([...SOURDOUGH, review]);
    const group = readDirectGroup(
      [
        {
          url: review.url,
          sourceQuote: "true in a cool kitchen and wrong in a warm one",
          articleReferenceQuote: "notes on my sourdough starter, week 3",
          relation: "qualifies",
          valence: "negative",
          applies: "It accepts the schedule only for cool kitchens.",
        },
      ],
      { admissible: withReview, articleUrl: ARTICLE_URL },
      2,
    );
    expect(group.counts.keptRows).toBe(1);
    /* The page's capitalisation, not the model's. */
    expect(group.rows[0]?.articleReferenceQuote).toBe("Notes on my sourdough starter, week 3");
    expect(group.counts.lost.directnessUnverified).toBe(0);
  });
});

/* ---------------------------------------------------------------- the counts -- */

describe("what a cap and a bad row are counted as", () => {
  const goodRow = (url: string) => ({
    url,
    blockId: "spya-aaaaaa",
    claimQuote: "fed twice a day",
    sourceQuote: "Twice is the number that works",
    relation: "corroborates",
    valence: "positive",
    applies: "Same schedule.",
  });

  /**
   * **Rows past the cap are counted before iteration stops.**
   *
   * A model can report forty rows, a cap stop the loop at twelve, and every
   * validation counter still read zero — which is why this is its own number.
   * Stopping silently would make position a ranking in a feature built to have
   * none.
   */
  it("counts the tail rather than swallowing it", () => {
    const url = "https://myeclecticbites.com/sourdough-starter-notes";
    const many = Array.from({ length: MAX_CLAIM_ROWS + 5 }, () => goodRow(url));
    const group = readClaimGroup(many, claimInput, 2);

    expect(group.counts.keptRows).toBe(MAX_CLAIM_ROWS);
    expect(group.counts.reportedRows).toBe(MAX_CLAIM_ROWS + 5);
    expect(group.counts.omittedOverCap).toBe(5);
    /* The cap is not a validation loss and must not be filed as one. */
    expect(anyLost(group.counts.lost)).toBe(false);
  });

  /**
   * **The direct group's own cap, exercised against its own reader.**
   *
   * The case above proves `readClaimGroup` stops at `MAX_CLAIM_ROWS`, and it was
   * for a while the only cap this file ran. That left a hole big enough to drive
   * the plan's own failure through: `readDirectGroup` could have been handed the
   * wrong constant, or no cap at all, and every test here would still have been
   * green — the two numbers are equal today, so no assertion about the *values*
   * can tell them apart. Only feeding an over-cap list to *this* reader can.
   *
   * So the rows are built to survive every other refusal — a page that names the
   * article, a quotation that is in it — which is what makes the tail a cap loss
   * rather than a validation loss, and what makes the assertion about the cap
   * rather than about the sourdough fixture's emptiness.
   */
  it("stops the direct group at its own cap, and counts the tail", () => {
    const review: SearchEvidence = {
      url: "https://bakingreview.example/on-gregs-notes",
      title: "On Greg's starter notes",
      excerpt:
        "Greg's Notes on my sourdough starter, week 3 argues for twice-daily feeding. That is " +
        "true in a cool kitchen and wrong in a warm one.",
    };
    const many = Array.from({ length: MAX_DIRECT_ROWS + 3 }, () => ({
      url: review.url,
      sourceQuote: "true in a cool kitchen and wrong in a warm one",
      articleReferenceQuote: "notes on my sourdough starter, week 3",
      relation: "qualifies",
      valence: "negative",
      applies: "It accepts the schedule only for cool kitchens.",
    }));
    const group = readDirectGroup(many, { admissible: evidenceMap([review]), articleUrl: ARTICLE_URL }, 2);

    expect(group.counts.keptRows).toBe(MAX_DIRECT_ROWS);
    expect(group.counts.reportedRows).toBe(MAX_DIRECT_ROWS + 3);
    expect(group.counts.omittedOverCap).toBe(3);
    /* The cap is not a validation loss here either. */
    expect(anyLost(group.counts.lost)).toBe(false);
  });

  it("caps the two groups separately", () => {
    expect(MAX_DIRECT_ROWS).toBe(MAX_CLAIM_ROWS);
    /* Stated as an inequality against the artefact maximum rather than as two
       equal numbers, because the failure the plan names is one cap read as
       covering both passes — which would permit twice what it says.

       This assertion exercises no code, and on its own it never could: the two
       readers are checked against their own caps by the two cases above. What it
       pins is the *artefact maximum* the plan states, so that raising one cap
       silently is a change somebody has to come here and make. */
    expect(MAX_DIRECT_ROWS + MAX_CLAIM_ROWS).toBe(24);
  });

  it("counts a row that is not an object at all", () => {
    const group = readClaimGroup([null, 42, "a row", []], claimInput, 2);
    expect(group.counts.lost.malformed).toBe(4);
    expect(group.counts.reportedRows).toBe(4);
  });

  it("counts a row with no sentence about how it applies", () => {
    const row = goodRow("https://myeclecticbites.com/sourdough-starter-notes") as Record<string, unknown>;
    delete row.applies;
    const group = readClaimGroup([row], claimInput, 2);
    expect(group.counts.lost.malformed).toBe(1);
  });

  /**
   * Rows are deliberately **not** deduplicated by URL: one review can answer two
   * different claims, and two rows about one page is a real answer rather than a
   * mistake. `distinctSources` is what the foot line counts instead.
   */
  it("keeps two rows about one page, and counts the page once", () => {
    const url = "https://myeclecticbites.com/sourdough-starter-notes";
    const group = readClaimGroup([goodRow(url), goodRow(url)], claimInput, 2);
    expect(group.counts.keptRows).toBe(2);
    expect(distinctSources(group.rows)).toBe(1);
  });

  it("starts every counter at zero", () => {
    expect(anyLost(emptyLosses())).toBe(false);
    expect(Object.values(emptyLosses()).every((n) => n === 0)).toBe(true);
  });

  /** The provider's own number, carried onto the artefact as the only alarm there is. */
  it("stores the search count per group", () => {
    expect(readClaimGroup([], claimInput, 7).counts.webSearches).toBe(7);
    expect(readDirectGroup([], groupInput, 3).counts.webSearches).toBe(3);
  });
});

/* ------------------------------------------------- the closed vocabularies -- */

describe("relation and valence", () => {
  const row = {
    url: "https://myeclecticbites.com/sourdough-starter-notes",
    blockId: "spya-aaaaaa",
    claimQuote: "fed twice a day",
    sourceQuote: "Twice is the number that works",
    applies: "Same schedule.",
  };

  /**
   * A value outside the vocabulary becomes the vocabulary's own "we cannot
   * tell", rather than dropping the row. `unclear` and `unknown` are correct
   * answers and are drawn as calmly as the rest — a model that cannot tell
   * whether a page agrees should say so and be believed.
   */
  it("falls back to unclear and unknown rather than dropping the row", () => {
    const group = readClaimGroup(
      [{ ...row, relation: "demolishes", valence: "62% negative" }],
      claimInput,
      2,
    );
    expect(group.counts.keptRows).toBe(1);
    expect(group.rows[0]?.relation).toBe("unclear");
    expect(group.rows[0]?.valence).toBe("unknown");
    expect(anyLost(group.counts.lost)).toBe(false);
  });

  it("keeps a valence that is in the set", () => {
    const group = readClaimGroup([{ ...row, relation: "disputes", valence: "negative" }], claimInput, 2);
    expect(group.rows[0]?.relation).toBe("disputes");
    expect(group.rows[0]?.valence).toBe("negative");
  });
});

/* ------------------------------------------------------------- the prompts -- */

/**
 * The prompts are pinned by *rule*, in the shape tests/quiz.test.ts uses: a rule
 * is here by name because it is the fix for a specific way this mode goes wrong,
 * and because it is the kind of paragraph a later tidy-up would shorten out
 * without knowing what it was for.
 */
describe("what the prompts insist on", () => {
  /**
   * **Restraint, not thoroughness** — the counter-intuitive one, and the one
   * most likely to be "improved" away. Stage 0b measured that ordering
   * exhaustiveness tripled the search count (36 searches for $0.10, cap at 4)
   * and bought no extra evidence, because the results are capped regardless.
   */
  it("asks both passes to search sparingly", () => {
    for (const prompt of [DIRECT_SYSTEM, CLAIMS_SYSTEM]) {
      expect(prompt).toMatch(/do not be exhaustive/i);
      expect(prompt).not.toMatch(/be thorough/i);
    }
  });

  /** The finding the mode exists around, said to the model in its own terms. */
  it("tells pass A that an empty list is the usual answer", () => {
    expect(DIRECT_SYSTEM).toMatch(/empty/i);
    expect(DIRECT_SYSTEM).toMatch(/most articles have none/i);
  });

  it("tells pass A that a page must name this article", () => {
    expect(DIRECT_SYSTEM).toContain("articleReferenceQuote");
    expect(DIRECT_SYSTEM).toMatch(/a recent essay/);
  });

  it("tells pass B that a block id and the article's own words are both required", () => {
    expect(CLAIMS_SYSTEM).toContain("claimQuote");
    expect(CLAIMS_SYSTEM).toContain("blockId");
  });

  /** Both prompts name the fence they are parsed by, so the two cannot drift. */
  it("names the fence the parser looks for", () => {
    for (const prompt of [DIRECT_SYSTEM, CLAIMS_SYSTEM]) {
      expect(prompt).toContain("```" + DEBATE_FENCE);
    }
  });

  /**
   * `limits` is optional and the prompt says the alternative out loud, because a
   * mandatory caveat field manufactures caveats — the rule Sol's review cut from
   * the first draft.
   */
  it("tells both passes to omit a row rather than invent a limitation", () => {
    for (const prompt of [DIRECT_SYSTEM, CLAIMS_SYSTEM]) {
      expect(prompt).toMatch(/omit the row rather than invent a limitation/i);
    }
  });

  /** docs/project/new-mode.md § The words the mode puts in front of the reader. */
  it("carries the plainer-than-the-article rule", () => {
    for (const prompt of [DIRECT_SYSTEM, CLAIMS_SYSTEM]) {
      expect(prompt).toContain("plainer than the article, never further from it");
    }
  });

  /**
   * The pages come back from inside the provider, so this sentence is **not** a
   * boundary and § Security says so. It is here because it is cheap and because
   * `src/pdf-frontmatter.ts` sets the same precedent for text this app did not
   * write.
   */
  it("tells both passes the pages are untrusted", () => {
    for (const prompt of [DIRECT_SYSTEM, CLAIMS_SYSTEM]) {
      expect(prompt).toMatch(/UNTRUSTED DATA/);
    }
  });
});

/* ------------------------------------------------------------ the plumbing -- */

describe("the stamp and the failure copy", () => {
  it("has a prompt version that is one constant", () => {
    expect(PROMPT_VERSION).toBe("debate/1");
  });

  /**
   * A search that did not run offers another go, because a model choosing not to
   * search and a provider falling back to one that dropped the tool both come
   * out differently next time.
   */
  it("offers a retry when the search did not run", () => {
    expect(kindOfMessage(DEBATE_SEARCH_DID_NOT_RUN.message)).toBe("retry");
    expect(worthRetrying(DEBATE_SEARCH_DID_NOT_RUN.message)).toBe(true);
  });

  /**
   * The message the reader gets must not describe an empty result, because the
   * whole point of failing here is that a search that never ran and a search
   * that found nothing are different facts.
   */
  it("does not tell the reader the search found nothing", () => {
    expect(DEBATE_SEARCH_DID_NOT_RUN.message).not.toMatch(/found nothing/i);
    expect(DEBATE_SEARCH_DID_NOT_RUN.message).toMatch(/did not run/i);
  });
});
