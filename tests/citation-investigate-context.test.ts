/**
 * **An investigation is attached only while what would be sent now is what was
 * sent** — src/citation-investigate-context.ts, plan 260930a § Staleness (Sol
 * P-4, one hash over everything).
 *
 * Each case changes one input the hash is meant to cover and checks the stored
 * answer stops attaching; and the one input it is written not to cover (the
 * article's head, via a rename) is pinned too, so that choice is visible.
 */
import { describe, expect, it } from "vitest";

import {
  attachInvestigations,
  CITATION_INVESTIGATE_VERSION,
  INVESTIGATE_PASSAGE_CAP,
  investigateArticleKey,
  investigateContext,
  investigateContextHash,
} from "../src/citation-investigate-context.js";
import type { BlockId, CitationInvestigation, Citations, CitedWork } from "../src/types.js";

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

function hashFor(w: CitedWork, blocks = BLOCKS, profile: string | null = null, model = "m"): string {
  return investigateContextHash(investigateContext(w, textOf(blocks)), investigateArticleKey(blocks), profile, model);
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
});

describe("attaching a stored investigation", () => {
  const base = work();
  const stored = new Map([[base.id, STORED(hashFor(base))]]);
  const attach = (w: CitedWork, blocks = BLOCKS, profile: string | null = null, model = "m") =>
    attachInvestigations(list(w), stored, (row) => hashFor(row, blocks, profile, model)).citations[0]
      ?.investigation;

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

  it("leaves every row without a stored answer untouched", () => {
    const other = work({ id: "spya-thr2ww" });
    const out = attachInvestigations(list(other), stored, (row) => hashFor(row));
    expect(out.citations[0]).not.toHaveProperty("investigation");
  });
});
