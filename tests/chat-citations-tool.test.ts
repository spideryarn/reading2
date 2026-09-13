/**
 * `article_citations` — chat reading the stored citations list.
 *
 * docs/plans/260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list.md
 * § Stage 2, and the GPT Sol review beside it (F5, F6, F7, F9).
 *
 * Two halves. **The formatter** (`citationRows`, `citationsOutcome`) is
 * arithmetic over an artefact and tested as such, the way `articleLinks` is in
 * tests/chat-tools.test.ts. **The load** goes through `runTool` with the store's
 * `loadCitations` replaced, because the ways it can answer — a list, the
 * store's typed missing-list 404, another failure (including another 404), or
 * a stale list — are what the plan's review said the first draft would have got
 * wrong, and none of them needs Postgres to show.
 *
 * The ones worth reading twice:
 *
 *  - **Only the typed missing-list 404 is "there is no list".** Any other
 *    failure says the list could not be read. `readGlossary`'s catch-all is the
 *    thing not to copy (Sol F7): it turns a database outage into a confident
 *    false statement.
 *  - **A stale list emits no rows.** It describes an older article (Sol F5).
 *  - **`capped` changes what the count means.** N is the stored list's size,
 *    never the article's total (Sol F5).
 *  - **A bibliography-only work keeps its place** via `firstCited` (Sol F6).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  loadCitations: null as null | ((slug: string) => Promise<unknown>),
  calls: [] as string[],
}));

vi.mock("../src/store/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/index.js")>(
    "../src/store/index.js",
  );
  return {
    ...actual,
    loadCitations: async (slug: string) => {
      store.calls.push(slug);
      if (!store.loadCitations) throw new Error("test did not set loadCitations");
      return store.loadCitations(slug);
    },
  };
});

import {
  CHAT_TOOLS,
  CITATIONS_CHARS,
  MAX_CITATION_ROWS,
  MAX_LINK_BLOCKS,
  TOOL_NAMES,
  citationRows,
  citationsOutcome,
  describeCall,
  runTool,
} from "../src/chat-tools.js";
import type { Block, CitedWork, Citations, Meta } from "../src/types.js";
import { CitationsListNotFound } from "../src/store/citations-list-not-found.js";

const work = (over: Partial<CitedWork> = {}): CitedWork => ({
  id: "cw-default",
  key: "work:default",
  title: "Minds, Brains, and Programs",
  authors: "John Searle",
  year: "1980",
  why: "The Chinese Room, which the piece uses to argue syntax is not semantics.",
  relevance: 0.9,
  influence: 0.95,
  mentions: [],
  citedAt: ["spya-cit001"],
  firstCited: "spya-cit001",
  citedInBody: true,
  url: "https://doi.org/10.1017/S0140525X00005756",
  linkFrom: "doi",
  ...over,
});

const list = (works: CitedWork[], over: Partial<Citations> = {}): Citations => ({
  version: "test",
  generator: "test",
  slug: "piece",
  sourceHash: "h",
  citations: works,
  capped: false,
  generatedAt: "2026-09-13T00:00:00Z",
  elapsedMs: 1,
  ...over,
});

/** Three rows: a body-cited DOI, a bibliography-only one, and a Scholar search. */
const THREE = [
  work(),
  work({
    id: "cw-bib",
    key: "work:bib",
    title: "Being You: A New Science of Consciousness",
    authors: "Anil Seth",
    year: "2021",
    why: "Background reading on predictive processing, listed without being discussed.",
    relevance: 0.3,
    influence: 0.6,
    citedAt: [],
    firstCited: "spya-refs01",
    citedInBody: false,
    url: "https://arxiv.org/abs/2101.00001",
    linkFrom: "arxiv",
  }),
  (() => {
    const w = work({
      id: "cw-search",
      key: "work:search",
      title: "The Thermodynamics of Computation",
      authors: "Charles Bennett",
      year: "1982",
      why: "Cited for the claim that erasing a bit costs energy.",
      relevance: 0.5,
      citedAt: ["spya-cit002"],
      firstCited: "spya-cit002",
      url: "https://scholar.google.com/scholar?q=The+Thermodynamics+of+Computation+Bennett",
      linkFrom: "search",
    });
    // Absent, not undefined — `exactOptionalPropertyTypes` tells the two apart.
    delete w.influence;
    return w;
  })(),
];

const meta = { title: "A piece", slug: "piece" } as Meta;
const blocks: Block[] = [];
const ctx = { slug: "piece", meta, blocks };

const found = (citations: Citations, over: { stale?: boolean; outdated?: boolean } = {}) => ({
  citations,
  stale: over.stale ?? false,
  outdated: over.outdated ?? false,
});

beforeEach(() => {
  store.loadCitations = null;
  store.calls = [];
});

describe("citationRows — the formatter, as arithmetic", () => {
  it("one row per work, in the artefact's order, with every part a row promises", () => {
    const out = citationRows(list(THREE));
    expect(out.total).toBe(3);
    expect(out.matched).toBe(3);
    expect(out.rows).toHaveLength(3);
    expect(out.cut).toBe(false);
    const [first] = out.rows;
    expect(first).toContain("Minds, Brains, and Programs");
    expect(first).toContain("John Searle · 1980");
    expect(first).toContain("used for: The Chinese Room");
    expect(first).toContain("relevance 0.90");
    expect(first).toContain("influence 0.95");
    expect(first).toContain("https://doi.org/10.1017/S0140525X00005756");
    expect(first).toContain("spya-cit001");
  });

  it("says a missing score is missing rather than printing zero or nothing", () => {
    const row = citationRows(list(THREE)).rows[2] ?? "";
    expect(row).toContain("relevance 0.50");
    expect(row).toMatch(/influence not scored/);
  });

  it("names where each link came from, for every linkFrom", () => {
    const wording: Record<CitedWork["linkFrom"], string> = {
      doi: "DOI in the article",
      arxiv: "arXiv id in the article",
      article: "a link in the article",
      search: "a Scholar search, not the work's own page",
      web: "found on the web",
    };
    for (const [linkFrom, words] of Object.entries(wording)) {
      const row = citationRows(list([work({ linkFrom: linkFrom as CitedWork["linkFrom"] })])).rows[0];
      expect(row, linkFrom).toContain(words);
    }
  });

  it("a bibliography-only work says so and keeps its place (Sol F6)", () => {
    const row = citationRows(list(THREE)).rows[1] ?? "";
    expect(row).toContain("only in the references [spya-refs01]");
    expect(row).not.toContain("cited in the text");
  });

  it("caps a work's block ids and states the rest exactly", () => {
    const ids = Array.from({ length: MAX_LINK_BLOCKS + 4 }, (_, i) => `spya-many${String(i).padStart(2, "0")}`);
    const row = citationRows(list([work({ citedAt: ids, firstCited: ids[0] ?? "" })])).rows[0] ?? "";
    expect(row).toContain(ids[MAX_LINK_BLOCKS - 1]);
    expect(row).not.toContain(ids[MAX_LINK_BLOCKS]);
    expect(row).toContain("and 4 more");
  });

  it("query matches folded substrings of title, authors, year and why", () => {
    expect(citationRows(list(THREE), "THERMODYNAMICS").matched).toBe(1);
    expect(citationRows(list(THREE), "seth").matched).toBe(1);
    expect(citationRows(list(THREE), "1980").matched).toBe(1);
    expect(citationRows(list(THREE), "predictive processing").matched).toBe(1);
    expect(citationRows(list(THREE), "costs energy").rows[0]).toContain("Bennett");
    expect(citationRows(list([work({ title: "Gödel, Escher, Bach" })]), "godel").matched).toBe(1);
    // The total is the stored list's, whatever the query.
    expect(citationRows(list(THREE), "nothing like this").total).toBe(3);
    expect(citationRows(list(THREE), "nothing like this").matched).toBe(0);
  });

  it("stops at the row cap and says so, with exact counts", () => {
    const many = Array.from({ length: MAX_CITATION_ROWS + 5 }, (_, i) =>
      work({ id: `cw-${i}`, key: `k${i}`, title: `Work ${i}`, why: "short." }),
    );
    const out = citationRows(list(many));
    expect(out.rows).toHaveLength(MAX_CITATION_ROWS);
    expect(out.matched).toBe(MAX_CITATION_ROWS + 5);
    expect(out.cut).toBe(true);
  });

  it("stops at the character cap between whole rows, before the row cap", () => {
    const long = "x".repeat(500);
    const many = Array.from({ length: 20 }, (_, i) =>
      work({ id: `cw-l${i}`, key: `l${i}`, title: `Long ${i}`, why: long }),
    );
    const out = citationRows(list(many));
    expect(out.rows.length).toBeLessThan(20);
    expect(out.rows.length).toBeLessThan(MAX_CITATION_ROWS);
    expect(out.rows.join("\n").length).toBeLessThanOrEqual(CITATIONS_CHARS);
    expect(out.cut).toBe(true);
    // Whole rows: each one still ends with where the article cites it.
    for (const r of out.rows) expect(r).toContain("spya-cit001");
  });

  it("keeps the first row inside the character cap too", () => {
    const out = citationRows(list([work({ why: "y".repeat(CITATIONS_CHARS * 2) })]));
    expect(out.rows).toHaveLength(1);
    expect(out.rows.join("\n\n").length).toBeLessThanOrEqual(CITATIONS_CHARS);
    expect(out.rows[0]).toContain("spya-cit001");
    expect(out.cut).toBe(false);
  });

  it("does not call an internally inconsistent body citation references-only", () => {
    const row = citationRows(
      list([work({ citedInBody: true, citedAt: [], firstCited: "spya-cit001" })]),
    ).rows[0] ?? "";
    expect(row).toContain("cited in the text");
    expect(row).toContain("stored text locations are missing");
    expect(row).toContain("spya-cit001");
    expect(row).not.toContain("only in the references");
  });
});

describe("citationsOutcome — what goes back to the model", () => {
  it("fences the rows and keeps our sentences outside the fence", () => {
    const out = citationsOutcome(found(list(THREE)), "");
    const open = out.content.indexOf("<<<UNTRUSTED ARTICLE CITATIONS");
    const close = out.content.indexOf("<<<END UNTRUSTED ARTICLE CITATIONS>>>");
    expect(open).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(open);
    const before = out.content.slice(0, open);
    const inside = out.content.slice(open, close);
    expect(before).toContain("3 works in the stored list");
    expect(before).toMatch(/written by whoever published this article/);
    expect(before).toMatch(/“used for” lines were written by a model/);
    expect(before).not.toContain("Minds, Brains");
    expect(inside).toContain("Minds, Brains");
    expect(out.content.slice(close)).not.toContain("Minds, Brains");
    expect(out.detail).toBe("3 works");
  });

  it("when the list is capped, never calls N the article's total (Sol F5)", () => {
    const out = citationsOutcome(found(list(THREE, { capped: true })), "");
    const head = out.content.slice(0, out.content.indexOf("<<<UNTRUSTED"));
    expect(head).toContain("3 works in the stored list");
    expect(head).toMatch(/may leave works out/);
    expect(head).toMatch(/not how many works the article cites/);
    const plain = citationsOutcome(found(list(THREE)), "");
    expect(plain.content).not.toMatch(/may leave works out/);
  });

  it("announces a row or character cut, with exact counts, outside the fence", () => {
    const many = Array.from({ length: MAX_CITATION_ROWS + 5 }, (_, i) =>
      work({ id: `cw-c${i}`, key: `c${i}`, title: `Work ${i}`, why: "short." }),
    );
    const out = citationsOutcome(found(list(many)), "");
    const head = out.content.slice(0, out.content.indexOf("<<<UNTRUSTED"));
    expect(head).toContain(`${MAX_CITATION_ROWS + 5} works in the stored list`);
    expect(head).toContain(`Showing the first ${MAX_CITATION_ROWS}`);
    expect(head).toMatch(/not all of them/);
  });

  it("with a query, says how many of the stored list matched", () => {
    const out = citationsOutcome(found(list(THREE)), "thermodynamics");
    expect(out.content).toContain("1 of the 3 works in the stored list matches that");
    expect(out.detail).toBe("1 work");
    expect(out.label).toBe("looked through the citations for “thermodynamics”");
  });

  it("a query that matches nothing is a complete answer, and names the total", () => {
    const out = citationsOutcome(found(list(THREE)), "bicycles");
    expect(out.content).toContain("complete answer, not an error");
    expect(out.content).toContain("3 works");
    expect(out.content).not.toContain("<<<UNTRUSTED");
  });

  it("an empty list is an article that cites nothing, not a missing list", () => {
    const out = citationsOutcome(found(list([])), "");
    expect(out.content).toContain("complete answer, not an error");
    expect(out.content).not.toMatch(/has been made for this article/);
  });

  it("an empty capped list still says the model reported omitted works", () => {
    const out = citationsOutcome(found(list([], { capped: true })), "");
    expect(out.content).toMatch(/said the article cites more than it kept/);
    expect(out.content).toMatch(/0 is the number in the stored list/);
    expect(out.content).not.toMatch(/made and found none/);
  });

  it("an outdated list is announced even when there are no rows to show", () => {
    const empty = citationsOutcome(found(list([]), { outdated: true }), "");
    expect(empty.content).toMatch(/older version of the citations step/);

    const noMatch = citationsOutcome(found(list(THREE), { outdated: true }), "bicycles");
    expect(noMatch.content).toMatch(/older version of the citations step/);
  });

  it("a stale list emits no rows (Sol F5)", () => {
    const out = citationsOutcome(found(list(THREE), { stale: true }), "");
    expect(out.content).toMatch(/older version of the article/);
    expect(out.content).not.toContain("Minds, Brains");
    expect(out.content).not.toContain("<<<UNTRUSTED");
    expect(out.detail).toBe("out of date");
  });

  it("an outdated list is announced above the rows, and still shown", () => {
    const out = citationsOutcome(found(list(THREE), { outdated: true }), "");
    const open = out.content.indexOf("<<<UNTRUSTED");
    expect(out.content.slice(0, open)).toMatch(/older version of the citations step/);
    expect(out.content.slice(open)).toContain("Minds, Brains");
    const current = citationsOutcome(found(list(THREE)), "");
    expect(current.content).not.toMatch(/older version of the citations step/);
  });
});

describe("runTool(\"article_citations\") — the load, and its four answers", () => {
  it("reads the list for the article the reader has open", async () => {
    store.loadCitations = async () => found(list(THREE));
    const out = await runTool("article_citations", {}, ctx);
    expect(store.calls).toEqual(["piece"]);
    expect(out.detail).toBe("3 works");
    expect(out.content).toContain("<<<UNTRUSTED ARTICLE CITATIONS");
    expect(out.label).toBe("read this article's citations");
  });

  it("passes the query through", async () => {
    store.loadCitations = async () => found(list(THREE));
    const out = await runTool("article_citations", { query: "Seth" }, ctx);
    expect(out.detail).toBe("1 work");
    expect(out.content).toContain("Being You");
    expect(out.content).not.toContain("Minds, Brains");
  });

  it("the missing-list 404 says no list was made, and does not pretend to have read one", async () => {
    store.loadCitations = async () => {
      throw new CitationsListNotFound();
    };
    const out = await runTool("article_citations", {}, ctx);
    expect(out.content).toContain("citations list has been made for this article");
    expect(out.content).toContain("complete answer, not an error");
    expect(out.content).toMatch(/do not pretend to have read one/);
    expect(out.detail).toBe("none yet");
  });

  it("a different 404 is a read failure, not proof that no citations list was made", async () => {
    store.loadCitations = async () => {
      throw Object.assign(new Error("article disappeared"), { status: 404 });
    };
    const out = await runTool("article_citations", {}, ctx);
    expect(out.content).toMatch(/could not be read/);
    expect(out.content).toMatch(/does not mean there is none/);
    expect(out.content).not.toContain("has been made for this article");
    expect(out.detail).toBe("could not read it");
  });

  it("any other failure says the list could not be read — never that it is absent (Sol F7)", async () => {
    store.loadCitations = async () => {
      throw Object.assign(new Error("connection terminated"), { code: "57P01" });
    };
    const out = await runTool("article_citations", {}, ctx);
    expect(out.content).toMatch(/could not be read/);
    expect(out.content).toMatch(/does not mean there is none/);
    expect(out.content).not.toContain("has been made for this article");
    expect(out.content).not.toContain("complete answer");
    expect(out.detail).toBe("could not read it");
  });

  it("a non-404 status is still a failure, not an absence", async () => {
    store.loadCitations = async () => {
      throw Object.assign(new Error("boom"), { status: 500 });
    };
    const out = await runTool("article_citations", {}, ctx);
    expect(out.detail).toBe("could not read it");
  });

  it("a stale list comes back as a non-error outcome with no rows", async () => {
    store.loadCitations = async () => found(list(THREE), { stale: true });
    const out = await runTool("article_citations", {}, ctx);
    expect(out.detail).toBe("out of date");
    expect(out.content).not.toContain("Minds, Brains");
  });

  it("an outdated list says so and still lists", async () => {
    store.loadCitations = async () => found(list(THREE), { outdated: true });
    const out = await runTool("article_citations", {}, ctx);
    expect(out.content).toMatch(/older version of the citations step/);
    expect(out.content).toContain("Minds, Brains");
  });
});

describe("the definition", () => {
  it("is one of the tools, with an optional query", () => {
    expect(TOOL_NAMES.has("article_citations")).toBe(true);
    const def = CHAT_TOOLS.find((t) => t.function.name === "article_citations");
    expect(def?.function.parameters.properties).toHaveProperty("query");
    expect(def?.function.parameters.required ?? []).not.toContain("query");
  });

  it("does not oversell itself, and says a link is not a reason to fetch", () => {
    const text = CHAT_TOOLS.find((t) => t.function.name === "article_citations")?.function
      .description ?? "";
    expect(text).toMatch(/Do NOT use it for a question the article itself answers/);
    expect(text).toMatch(/not a reason to fetch it/);
    expect(text).not.toMatch(/always|whenever/i);
  });

  it("names the call before it runs", () => {
    expect(describeCall("article_citations", {})).toBe("read this article's citations");
    expect(describeCall("article_citations", { query: "Searle" })).toBe(
      "looked through the citations for “Searle”",
    );
  });
});
