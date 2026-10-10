// @vitest-environment jsdom
/**
 * **What the panels draw from a registry record** — plan 261001a stages 5 and
 * 6. Citations: the by-line stays as the article gives it, and the registry
 * fills only a field the article leaves empty, marked with its source; a
 * conflict says so and draws nothing of the record. Debate: the record's
 * authors and year win over the AI's reading, and the *date* order sorts on
 * its year.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checksOwner, claimListOwner } from "./helpers/debate-claims-owner.js";

import type { BlockId, CitationRegistry, Bibliography, ClaimDebateRow, CitedWork, Debate, DebateCounts } from "../src/types.js";
import type { UseBibliography } from "../src/web/useBibliography.js";
import type { UseDebate } from "../src/web/useDebate.js";

const { BibliographyPanel, byLineOf, registryConflictNote, workByLine } = await import("../src/web/BibliographyPanel.js");
const { readCitationRegistry, readRegistryWork } = await import("../src/registry-work.js");
const { DebatePanel, rowWork } = await import("../src/web/DebatePanel.js");
const { orderReceptionRows, receptionOrderOptions, rowYear } = await import("../src/web/debate-order.js");

const AT = "spya-k3m9qt" as BlockId;

const FOUND: CitationRegistry = {
  kind: "found",
  source: "crossref",
  title: "Attention is all you need",
  authors: [
    { family: "Vaswani", given: "Ashish" },
    { family: "Shazeer", given: "Noam" },
    { family: "Parmar", given: "Niki" },
  ],
  moreAuthors: 5,
  year: 2017,
};

function work(over: Partial<CitedWork> = {}): CitedWork {
  return {
    id: "spya-a2b3c4",
    key: "doi:10.5555/attention",
    title: "Attention Is All You Need",
    why: "The piece leans on it.",
    mentions: [],
    citedAt: [AT],
    firstCited: AT,
    citedInBody: true,
    url: "https://doi.org/10.5555/attention",
    linkFrom: "doi",
    ...over,
  };
}

describe("Citations' by-line", () => {
  it("keeps the article's authors and year even when the registry has its own", () => {
    const line = workByLine(work({ authors: "Vaswani et al.", year: "2017", registry: FOUND }));
    expect(line).toEqual({ authors: "Vaswani et al.", year: "2017", filled: null, conflict: null });
  });

  it("fills only what the article leaves empty, and names the registry", () => {
    expect(workByLine(work({ registry: FOUND }))).toMatchObject({
      authors: "Ashish Vaswani, Noam Shazeer, Niki Parmar et al.",
      year: "2017",
      filled: { source: "crossref", fields: ["authors", "year"] },
    });
    expect(workByLine(work({ authors: "A. Vaswani", registry: { ...FOUND, source: "datacite" } }))).toMatchObject({
      authors: "A. Vaswani",
      year: "2017",
      filled: { source: "datacite", fields: ["year"] },
    });
    expect(byLineOf(work({ registry: FOUND }))).toBe("Ashish Vaswani et al. · 2017");
  });

  it("draws nothing of a conflict's, and says the identifier points elsewhere", () => {
    const line = workByLine(work({ registry: { kind: "conflict", source: "crossref" } }));
    expect(line).toEqual({ filled: null, conflict: "crossref" });
    expect(byLineOf(work({ registry: { kind: "conflict", source: "crossref" } }))).toBe("");
  });

  it("reads a malformed stored record as none", () => {
    const junk = { kind: "found", source: "openalex", title: "x", authors: [] } as unknown as CitationRegistry;
    expect(workByLine(work({ registry: junk }))).toEqual({ filled: null, conflict: null });
  });
});

describe("a stored citation count, read back (plan 261005i)", () => {
  const READ = "2026-10-04T12:00:00.000Z";
  const stored = (citedBy: unknown, over: object = {}) =>
    readCitationRegistry({ ...FOUND, ...over, citedBy } as unknown as CitationRegistry);

  it("keeps a Crossref record's count and the moment it was read, and nothing else in it", () => {
    expect(stored({ count: 357, readAt: READ, extra: "x" })).toEqual({ ...FOUND, citedBy: { count: 357, readAt: READ } });
    expect(stored({ count: 0, readAt: READ })).toMatchObject({ citedBy: { count: 0, readAt: READ } });
    expect(stored({ count: 2_147_483_647, readAt: READ })).toMatchObject({ citedBy: { count: 2_147_483_647 } });
  });

  it("drops a malformed count and keeps the record", () => {
    for (const bad of [
      { count: -1, readAt: READ },
      { count: 3.5, readAt: READ },
      { count: "357", readAt: READ },
      { count: 2_147_483_648, readAt: READ },
      { count: 357 },
      { count: 357, readAt: "last Tuesday" },
      { count: 357, readAt: 1_790_000_000_000 },
      { readAt: READ },
      [357, READ],
      "357",
      null,
    ]) {
      expect(stored(bad), JSON.stringify(bad)).toEqual(FOUND);
    }
  });

  it("drops a well-formed count from a DataCite record, which would be drawn as Crossref's (GPT Sol's F2)", () => {
    const read = stored({ count: 357, readAt: READ }, { source: "datacite" });
    expect(read).toEqual({ ...FOUND, source: "datacite" });
  });

  it("never reads a count off a conflict", () => {
    expect(
      readCitationRegistry({ kind: "conflict", source: "crossref", citedBy: { count: 357, readAt: READ } } as unknown as CitationRegistry),
    ).toEqual({ kind: "conflict", source: "crossref" });
  });

  it("leaves Debate's record without one: only Citations asks about a cited work's count", () => {
    expect(readRegistryWork({ ...FOUND, citedBy: { count: 357, readAt: READ } })).not.toHaveProperty("citedBy");
  });
});

/* ---------------------------------------------------------------- render -- */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function owner(citations: CitedWork[]): UseBibliography {
  const artefact: Bibliography = {
    version: "test",
    generator: "test",
    slug: "a-piece",
    sourceHash: "hash",
    citations,
    capped: false,
    generatedAt: "2026-09-11T09:00:00.000Z",
    elapsedMs: 1,
  } as Bibliography;
  return {
    status: "ready",
    bibliography: artefact,
    stale: false,
    outdated: false,
    slug: "a-piece",
    error: null,
    retryRead: async () => {},
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    automatic: false,
    ensure: async () => {},
    regenerate: async () => {},
    cancel: () => {},
    rewriting: false,
    refresh: async () => {},
    findNote: null,
    investigating: null,
    investigateStage: null,
    investigateDraft: null,
    investigateFailed: null,
    investigate: async () => {},
  } as UseBibliography;
}

async function draw(citations: CitedWork[]) {
  await act(async () =>
    root.render(
      createElement(BibliographyPanel, {
        head: null,
        access: { kind: "owner", owner: owner(citations) },
        order: "document",
        onOrder: () => {},
        bar: null,
        onBar: () => {},
        onJump: () => {},
      }),
    ),
  );
}

describe("a Citations row on screen", () => {
  it("marks a filled-in by-line with its registry", async () => {
    await draw([work({ registry: FOUND })]);
    const by = host.querySelector(".cite-by");
    expect(by?.textContent).toContain("Ashish Vaswani et al. · 2017");
    expect(by?.textContent).toContain("from Crossref");
  });

  it("says nothing about a registry where the article gave both", async () => {
    await draw([work({ authors: "Vaswani", year: "2017", registry: FOUND })]);
    expect(host.textContent).not.toContain("Crossref");
  });

  it("says when the article's identifier points to a different title", async () => {
    await draw([work({ registry: { kind: "conflict", source: "datacite" } })]);
    expect(host.textContent).toContain(registryConflictNote("datacite"));
  });
});

/* ---------------------------------------------------------------- Debate -- */

function claim(id: string, over: Partial<ClaimDebateRow> = {}): ClaimDebateRow {
  return {
    id,
    url: "https://doi.org/10.1073/pnas.1",
    title: "Dreams and memory",
    sourceQuote: "a passage",
    relation: "qualifies",
    lean: "neither",
    applies: "It narrows the claim.",
    claimQuote: "the claim",
    blockId: AT,
    ...over,
  };
}

const RECORD = {
  source: "datacite" as const,
  title: "Dreams and memory: the whole title",
  authors: [{ family: "Wamsley", given: "Erin" }, { family: "Stickgold" }],
  year: 2010,
};

describe("Debate's by-line and date order", () => {
  it("prefers the record's authors and year to the AI's, and says where they came from", () => {
    const w = rowWork(claim("c", { authors: ["Somebody"], publishedYear: 2024, registry: RECORD }));
    expect(w.authors).toEqual(["Erin Wamsley", "Stickgold"]);
    expect(w.year).toBe(2010);
    expect(w.registry).toBe("datacite");
    expect(w.registryFields).toEqual(["authors", "year"]);
    /* A whole engine title stays the headline. */
    expect(w.headline).toBe("Dreams and memory");
  });

  it("gives a cut-short engine title way to the record's whole one", () => {
    expect(rowWork(claim("c", { title: "Dreams and memory: the whole ...", registry: RECORD })).headline).toBe(
      RECORD.title,
    );
  });

  it("draws as before without a record", () => {
    const w = rowWork(claim("c", { authors: ["Somebody"], publishedYear: 2024 }));
    expect(w).toMatchObject({ authors: ["Somebody"], year: 2024, registry: null });
  });

  it("falls back field by field and attributes only what the registry supplied", () => {
    const noAuthors = rowWork(claim("a", {
      authors: ["Extracted Author"],
      publishedYear: 2024,
      registry: { ...RECORD, authors: [] },
    }));
    expect(noAuthors).toMatchObject({ authors: ["Extracted Author"], year: 2010, registry: "datacite" });
    expect(noAuthors.registryFields).toEqual(["year"]);

    const { year: _year, ...recordWithoutYear } = RECORD;
    const noYear = rowWork(claim("b", {
      authors: ["Extracted Author"],
      publishedYear: 2024,
      registry: recordWithoutYear,
    }));
    expect(noYear).toMatchObject({ authors: ["Erin Wamsley", "Stickgold"], year: 2024, registry: "datacite" });
    expect(noYear.registryFields).toEqual(["authors"]);
  });

  it("dates rows by the record's year first, and offers the date order on it alone", () => {
    const rows = [
      claim("ai-dated", { publishedYear: 2015 }),
      claim("registry-dated", { publishedYear: 2024, registry: RECORD }),
      claim("undated", { url: "https://blog.example.org/x" }),
    ];
    expect(rowYear(rows[1] as ClaimDebateRow)).toBe(2010);
    /* *Date* is one of Reception's orders since 2026-10-03 (plan 261003o); the
       rule reads any row's year, so these fixtures serve as they are. */
    const groups = orderReceptionRows(rows, "date");
    expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([["registry-dated", "ai-dated"], ["undated"]]);
    const onlyRegistry = [claim("a", { registry: RECORD }), claim("b", { lean: "leans-for" })];
    expect(receptionOrderOptions([onlyRegistry])).toContain("date");
  });
});

function debateOwner(row: ClaimDebateRow): UseDebate {
  const counts: DebateCounts = {
    returnedSources: 1,
    reportedRows: 1,
    keptRows: 1,
    omittedOverCap: 0,
    lost: {
      uncited: 0,
      selfSource: 0,
      unverifiedSource: 0,
      directnessUnverified: 0,
      sourceIsCopy: 0,
      claimNotInBlock: 0,
      unknownBlockId: 0,
      malformed: 0,
    },
    webSearches: 1,
  };
  const debate: Debate = {
    version: "debate/4",
    generator: "m",
    slug: "s",
    sourceHash: "h",
    searchedAt: "2026-10-01T00:00:00.000Z",
    direct: { rows: [], counts: { ...counts, returnedSources: 0, reportedRows: 0, keptRows: 0 } },
    claims: { rows: [row], counts },
    elapsedMs: 1,
  };
  return {
    status: "ready",
    debate,
    stale: false,
    outdated: false,
    slug: "s",
    error: null,
    retryRead: async () => {},
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    automatic: false,
    ensure: async () => {},
    regenerate: async () => {},
    cancel: () => {},
    rewriting: false,
    refresh: async () => {},
  } as UseDebate;
}

/** The owner has chat, and nothing here presses it (tests/debate-claim-chat.test.tsx does). */
const NO_CLAIM_CHATS = { summaries: [], onCheck: () => {}, onLens: () => {}, onOpen: () => {} };

describe("a Debate row on screen", () => {
  it("draws the registry by-line and names the exact fields it supplied", async () => {
    const row = claim("shown", { authors: ["Extracted Author"], publishedYear: 2024, registry: RECORD });
    await act(async () =>
      root.render(
        createElement(DebatePanel, {
          head: null,
          access: { kind: "owner", owner: debateOwner(row), claimList: claimListOwner(), checks: checksOwner(), citers: { result: { kind: "no-doi" }, retry: () => {} }, claimChats: NO_CLAIM_CHATS },
          onJump: () => {},
          /* The fixture is a claim row, so Claims is the sub-mode that draws it. */
          view: "claims",
          onView: () => {},
          articleTitle: null,
          order: "prioritised",
          onOrder: () => {},
          blockOrder: new Map([[AT, 0]]),
          relevance: null,
          onRelevance: () => {},
          articleYear: null,
          thread: null,
          onThread: () => {},
        }),
      ),
    );
    const byline = host.querySelector<HTMLElement>(".dbt-byline");
    expect(byline?.textContent).toContain("Erin Wamsley, Stickgold · 2010");
    expect(byline?.title).toContain("Authors and year from DataCite");
    expect(host.querySelector(".dbt-detail")?.textContent).toContain("Authors and year from DataCite");
  });
});
