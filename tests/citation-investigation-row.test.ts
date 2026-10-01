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

import { investigationColumns, investigationFromRow, paperColumns, paperFromRow } from "../src/store/citation-investigation-row.js";
import type { CitationInvestigation, InvestigatedPaper } from "../src/types.js";

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
