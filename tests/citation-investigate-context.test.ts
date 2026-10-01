/**
 * **An investigation is attached only while what would be sent now is what was
 * sent** — src/citation-investigate-context.ts, plan 260930a § Staleness (Sol
 * P-4, one hash over everything).
 *
 * Each case changes one input the hash is meant to cover and checks the stored
 * answer stops attaching. That includes the article head and the current
 * Look-it-up match: both alter the request even when the article's blocks do not.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  attachInvestigations,
  CITATION_INVESTIGATE_VERSION,
  INVESTIGATE_PASSAGE_CAP,
  investigateArticleKey,
  investigateContext,
  investigateContextHash,
  type MatchedPage,
} from "../src/citation-investigate-context.js";
import { DIG_DEEPER_MODEL } from "../src/dig-deeper.js";
import { CAPABLE_MODEL_OPENROUTER, generationKey } from "../src/models.js";
import { PAPER_SELECTION_VERSION } from "../src/paper-evidence.js";
import type { BlockId, CitationInvestigation, Citations, CitedWork, Meta } from "../src/types.js";

const A = "spya-aaaaaa" as BlockId;
const B = "spya-bbbbbb" as BlockId;
const C = "spya-cccccc" as BlockId;
const D = "spya-dddddd" as BlockId;

const BLOCKS = [
  { id: A, text: "First paragraph cites Kaplan." },
  { id: B, text: "Second paragraph cites Kaplan again." },
  { id: C, text: "Third." },
  { id: D, text: "A fourth citing paragraph, past the cap of three." },
];

const META: Meta = {
  slug: "s",
  title: "The article title",
  byline: "A. Writer",
  siteName: "Example Review",
  url: "https://example.com/article",
};

const MATCHED: MatchedPage = {
  url: "https://arxiv.org/abs/2001.08361",
  title: "Scaling Laws",
  quotes: ["We study scaling laws."],
};

function work(over: Partial<CitedWork> = {}): CitedWork {
  return {
    id: "spya-nvstga",
    key: "k",
    title: "Scaling Laws",
    authors: "Kaplan",
    year: "2020",
    why: "The curve.",
    reference: { blockId: D, quote: "Kaplan 2020", start: 0 },
    mentions: [],
    citedAt: [A, B, C, D],
    firstCited: A,
    citedInBody: true,
    url: "https://arxiv.org/abs/2001.08361",
    linkFrom: "arxiv",
    ...over,
  };
}

const textOf = (blocks: typeof BLOCKS) => (id: string) => blocks.find((b) => b.id === id)?.text;

function hashFor(
  w: CitedWork,
  blocks = BLOCKS,
  profile: string | null = null,
  model = "m",
  meta: Meta = META,
  matched: MatchedPage | null = MATCHED,
): string {
  return investigateContextHash(
    investigateContext(w, textOf(blocks)),
    investigateArticleKey(meta, blocks),
    profile,
    matched,
    model,
  );
}

const STORED = (contextHash: string): CitationInvestigation => ({
  answer: "An answer.",
  sources: [],
  extractsRead: 1,
  longestExtractWords: 10,
  matchedHost: null,
  searches: 1,
  searchesFrom: "server_tool_use_details",
  model: "m",
  at: "2026-09-30T00:00:00.000Z",
  contextHash,
  promptVersion: CITATION_INVESTIGATE_VERSION,
});

function list(w: CitedWork): Citations {
  return {
    version: "citations/4",
    generator: "g",
    slug: "s",
    sourceHash: "h",
    citations: [w],
    capped: false,
    generatedAt: "x",
    elapsedMs: 1,
  };
}

describe("the investigate context", () => {
  it("sends the first-cited paragraph and up to two more, each capped", () => {
    const long = [{ id: A, text: "x".repeat(INVESTIGATE_PASSAGE_CAP + 50) }, ...BLOCKS.slice(1)];
    const context = investigateContext(work(), textOf(long));
    expect(context.passages).toHaveLength(3);
    expect(context.passages[0]).toHaveLength(INVESTIGATE_PASSAGE_CAP);
    expect(context.passages[1]).toBe("Second paragraph cites Kaplan again.");
    expect(context.reference).toBe("Kaplan 2020");
  });

  it("uses the article's whole reference-list entry when one was recovered", () => {
    const context = investigateContext(
      work({ entry: "Kaplan et al. Scaling Laws for Neural Language Models. 2020." }),
      textOf(BLOCKS),
    );
    expect(context.reference).toBe("Kaplan et al. Scaling Laws for Neural Language Models. 2020.");
  });

  it("includes the paper selection version in the fingerprint", () => {
    const context = investigateContext(work(), textOf(BLOCKS));
    const articleKey = investigateArticleKey(META, BLOCKS);
    const expected = createHash("sha256")
      .update(
        JSON.stringify([
          CITATION_INVESTIGATE_VERSION,
          PAPER_SELECTION_VERSION,
          generationKey("m"),
          articleKey,
          context.title,
          context.authors,
          context.year,
          context.reference,
          context.url,
          context.linkFrom,
          context.why,
          context.passages,
          null,
          [MATCHED.url, MATCHED.title, MATCHED.quotes],
        ]),
        "utf8",
      )
      .digest("hex")
      .slice(0, 16);
    expect(investigateContextHash(context, articleKey, null, MATCHED, "m")).toBe(expected);
  });
});

describe("attaching a stored investigation", () => {
  const base = work();
  const stored = new Map([[base.id, STORED(hashFor(base))]]);
  const attach = (
    w: CitedWork,
    blocks = BLOCKS,
    profile: string | null = null,
    model = "m",
    meta: Meta = META,
    matched: MatchedPage | null = MATCHED,
  ) =>
    attachInvestigations(list(w), stored, (row) => hashFor(row, blocks, profile, model, meta, matched))
      .citations[0]?.investigation;

  it("attaches while nothing it was made from has changed", () => {
    expect(attach(base)?.answer).toBe("An answer.");
  });

  it.each<[string, CitedWork]>([
    ["why", work({ why: "A different use." })],
    ["title", work({ title: "Scaling Laws, Revised" })],
    ["authors", work({ authors: "Someone Else" })],
    ["year", work({ year: "2021" })],
    ["link", work({ url: "https://doi.org/10.1/x" })],
    ["link source", work({ linkFrom: "article" })],
    ["reference", work({ reference: { blockId: D, quote: "Kaplan et al. 2020", start: 0 } })],
    ["reference-list entry", work({ entry: "Kaplan et al. Scaling Laws for Neural Language Models. 2020." })],
    ["citing passages", work({ firstCited: B, citedAt: [B, C] })],
  ])("hides it when the row's %s changed", (_what, changed) => {
    expect(attach(changed)).toBeUndefined();
  });

  it("hides it when a citing paragraph's text changed", () => {
    const edited = BLOCKS.map((b) => (b.id === B ? { ...b, text: "Second paragraph, rewritten." } : b));
    expect(attach(base, edited)).toBeUndefined();
  });

  it("hides it when any paragraph of the article changed, cited or not", () => {
    const edited = BLOCKS.map((b) => (b.id === C ? { ...b, text: "Third, edited." } : b));
    expect(attach(base, edited)).toBeUndefined();
  });

  it("hides it when the reader's profile changed, or appeared", () => {
    expect(attach(base, BLOCKS, "About the reader: a physicist")).toBeUndefined();
  });

  it("hides it when the configured model changed", () => {
    expect(attach(base, BLOCKS, null, "another-model")).toBeUndefined();
  });

  it.each<[string, Meta]>([
    ["title", { ...META, title: "A reader rename" }],
    ["byline", { ...META, byline: "Another Writer" }],
    ["site", { ...META, siteName: "Another Review" }],
    ["article URL", { ...META, url: "https://example.com/moved" }],
  ])("hides it when the article head's %s changed", (_what, changed) => {
    expect(attach(base, BLOCKS, null, "m", changed)).toBeUndefined();
  });

  it("hides it when a Look-it-up match appears or its sent fields change", () => {
    expect(attach(base, BLOCKS, null, "m", META, null)).toBeUndefined();
    expect(attach(base, BLOCKS, null, "m", META, { ...MATCHED, title: "A revised title" })).toBeUndefined();
    expect(attach(base, BLOCKS, null, "m", META, { ...MATCHED, quotes: ["A different verified quote."] })).toBeUndefined();
  });

  /* Plan 261001p stage 2, Sol F6: *Investigate* became *Dig deeper* — a
     forced search in the prompt, Opus throughout — so an answer from before
     must not be drawn under the new name. The version is what detaches it:
     Sonnet and Opus are one generation (`generationKey`), so the model alone
     would not. The old fingerprint is rebuilt by hand, from the recipe the
     test above pins, rather than by calling the function with the old
     constant, which no longer exists to call. */
  it("hides an answer written before Dig deeper — version 6, on Sonnet — and attaches one written now", () => {
    const context = investigateContext(base, textOf(BLOCKS));
    const articleKey = investigateArticleKey(META, BLOCKS);
    const recipe = (version: string, model: string) =>
      createHash("sha256")
        .update(
          JSON.stringify([
            version,
            PAPER_SELECTION_VERSION,
            generationKey(model),
            articleKey,
            context.title,
            context.authors,
            context.year,
            context.reference,
            context.url,
            context.linkFrom,
            context.why,
            context.passages,
            null,
            [MATCHED.url, MATCHED.title, MATCHED.quotes],
          ]),
          "utf8",
        )
        .digest("hex")
        .slice(0, 16);
    const now = (row: CitedWork) => hashFor(row, BLOCKS, null, DIG_DEEPER_MODEL);
    /* The recipe is the function's, so the old row below is a real old row. */
    expect(recipe(CITATION_INVESTIGATE_VERSION, DIG_DEEPER_MODEL)).toBe(now(base));

    const old = new Map([[base.id, { ...STORED(recipe("citation-investigate/6", CAPABLE_MODEL_OPENROUTER)), promptVersion: "citation-investigate/6" }]]);
    expect(attachInvestigations(list(base), old, now).citations[0]?.investigation).toBeUndefined();

    const dug = new Map([[base.id, STORED(now(base))]]);
    expect(attachInvestigations(list(base), dug, now).citations[0]?.investigation?.answer).toBe("An answer.");
  });

  it("leaves every row without a stored answer untouched", () => {
    const other = work({ id: "spya-thr2ww" });
    const out = attachInvestigations(list(other), stored, (row) => hashFor(row));
    expect(out.citations[0]).not.toHaveProperty("investigation");
  });
});
