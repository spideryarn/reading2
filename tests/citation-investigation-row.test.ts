/**
 * **An investigation's paper as columns and back** — src/store/citation-investigation-row.ts,
 * plan 261001a stage 3. Every state goes to columns and comes back equal; an
 * answer from before the stage (every paper column null) comes back with no
 * `paper` at all, so the row draws it as it did then; and a state never leaves
 * another state's column behind on an upsert, because every column is named.
 *
 * The CHECKs that hold the same shape in Postgres are in the migration
 * (drizzle/20261001001752_citation_investigation_paper.sql); the route test
 * stores through them.
 */
import { describe, expect, it } from "vitest";

import {
  influenceColumns,
  influenceFromRow,
  investigationColumns,
  investigationFromRow,
  paperColumns,
  paperFromRow,
} from "../src/store/citation-investigation-row.js";
import type { CitationInvestigation, CitationWebInfluence, InvestigatedPaper } from "../src/types.js";

const AT = "2026-10-01T12:00:00.000Z";

const PAPERS: InvestigatedPaper[] = [
  {
    state: "read",
    requestedUrl: "https://arxiv.org/pdf/2001.08361",
    finalUrl: "https://arxiv.org/pdf/2001.08361v1",
    host: "arxiv.org",
    words: 11200,
    sentWords: 4900,
    chunks: ["c1", "c2", "c9"],
    matchedBy: "arxiv",
    evidenceSha: "e".repeat(64),
    selectionVersion: "paper-selection/1",
    readAt: AT,
    passages: [{ chunk: "c9", page: 5, text: "A passage.", bears: "partly" }],
  },
  {
    state: "read",
    requestedUrl: "https://doi.org/10.1/x",
    finalUrl: "https://pub.example/x.pdf",
    host: "pub.example",
    words: 10,
    sentWords: 10,
    chunks: ["c1"],
    matchedBy: "title-author",
    evidenceSha: "f".repeat(64),
    selectionVersion: "paper-selection/1",
    readAt: AT,
    passages: null,
  },
  { state: "no-address", readAt: AT },
  { state: "unreadable", requestedUrl: "https://doi.org/10.1/x", host: "nature.com", unreadableWhy: "paywall-or-empty", readAt: AT },
  { state: "not-the-full-text", requestedUrl: "https://doi.org/10.1/x", finalUrl: "https://pub.example/x", host: "pub.example", readAt: AT },
  { state: "not-confirmed", requestedUrl: "https://arxiv.org/pdf/1", finalUrl: "https://arxiv.org/pdf/1", host: "arxiv.org", readAt: AT },
  { state: "identity-conflict", requestedUrl: "https://doi.org/10.1/z", host: "doi.org", readAt: AT },
];

const BASE: CitationInvestigation = {
  answer: "An answer.",
  sources: [{ url: "https://example.org/a" }],
  extractsRead: 1,
  longestExtractWords: 9,
  matchedHost: null,
  searches: 1,
  searchesFrom: "x",
  model: "m",
  at: AT,
  contextHash: "h",
  promptVersion: "citation-investigate/5",
};

function asRow(inv: CitationInvestigation) {
  return { articleId: "a", entryId: "spya-aaaaaa", ownerId: "o", ...investigationColumns(inv) };
}

describe("the paper's columns", () => {
  it.each(PAPERS.map((p) => [p.state, p] as const))("round-trips %s", (_state, paper) => {
    expect(investigationFromRow(asRow({ ...BASE, paper }))).toEqual({ ...BASE, paper });
  });

  it("reads an answer from before the stage, every paper column null, as no paper at all", () => {
    const legacy = investigationFromRow(asRow(BASE));
    expect(legacy).toEqual(BASE);
    expect(legacy).not.toHaveProperty("paper");
  });

  it("names every paper column for every state, so an upsert clears the last state's fields", () => {
    const names = Object.keys(paperColumns(undefined)).sort();
    expect(names).toHaveLength(13);
    for (const paper of PAPERS) expect(Object.keys(paperColumns(paper)).sort()).toEqual(names);
    expect(paperColumns({ state: "no-address", readAt: AT })).toMatchObject({ paperWords: null, paperPassages: null, paperHost: null });
  });

  it("refuses a state whose required column is missing, rather than drawing a paper we cannot vouch for", () => {
    const broken = { ...paperColumns(PAPERS[0]), paperWords: null };
    expect(() => paperFromRow(broken)).toThrow(/paper_words/);
  });
});

/* Plan 261003m stage 2. The CHECKs that hold the same shape in Postgres are in
   drizzle/20261003194854_citation_investigation_influence.sql; the route test
   stores through them. */
describe("the web influence's columns", () => {
  const INFLUENCE: CitationWebInfluence = {
    value: 0.8,
    quote: "widely cited as a seminal work on scaling",
    sourceUrl: "https://en.wikipedia.org/wiki/Scaling_laws",
    sourceTitle: "Scaling Laws - Wikipedia",
    version: "citation-influence/1",
  };

  it("round-trips a kept influence, with the answer and the paper beside it", () => {
    const inv = { ...BASE, paper: PAPERS[0] as InvestigatedPaper, influence: INFLUENCE };
    expect(investigationFromRow(asRow(inv))).toEqual(inv);
  });

  it("round-trips one whose source had no title", () => {
    const { sourceTitle: _title, ...untitled } = INFLUENCE;
    expect(influenceColumns(untitled)).toMatchObject({ influenceSourceTitle: null });
    expect(investigationFromRow(asRow({ ...BASE, influence: untitled }))).toEqual({ ...BASE, influence: untitled });
  });

  it("reads a press that kept none, every influence column null, as no influence at all", () => {
    const none = investigationFromRow(asRow(BASE));
    expect(none).not.toHaveProperty("influence");
  });

  it("names all five columns either way, so a second press that keeps none clears the first's", () => {
    const names = ["influence", "influenceQuote", "influenceSourceTitle", "influenceSourceUrl", "influenceVersion"];
    expect(Object.keys(influenceColumns(undefined)).sort()).toEqual(names);
    expect(Object.keys(influenceColumns(INFLUENCE)).sort()).toEqual(names);
    expect(Object.values(influenceColumns(undefined)).every((v) => v === null)).toBe(true);
    for (const name of names) expect(investigationColumns(BASE)).toHaveProperty(name, null);
  });

  it("reads a number that lost its quote, its source or its version as none, and keeps the answer", () => {
    for (const lost of ["influenceQuote", "influenceSourceUrl", "influenceVersion"] as const) {
      expect(influenceFromRow({ ...influenceColumns(INFLUENCE), [lost]: null })).toBeUndefined();
    }
    const row = { ...asRow({ ...BASE, influence: INFLUENCE }), influenceQuote: null };
    expect(investigationFromRow(row)).toEqual(BASE);
  });
});
