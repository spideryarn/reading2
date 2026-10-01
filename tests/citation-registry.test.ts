/**
 * **Citations rows carry the registry's record** — plan 261001a stage 5
 * (src/citation-registry.ts). No network and no database: `lookupWork` is a
 * fake, and the one test of the wiring checks the real deps are `lookupWork`
 * itself (the memory note *mutate the composition root*).
 */
import { describe, expect, it } from "vitest";

import { lookupWork, type LookupResult, type WorkId, type WorkRecord } from "../src/bibliographic.js";
import {
  attachCitationRegistry,
  citationRegistryDeps,
  MAX_REGISTRY_LOOKUPS,
  REGISTRY_CONCURRENCY,
  rowWorkId,
} from "../src/citation-registry.js";
import { debateRegistryDeps } from "../src/debate-registry.js";
import { REGISTRY_AUTHORS_KEPT } from "../src/registry-work.js";
import type { BlockId, Citations, CitedWork } from "../src/types.js";

const AT = "spya-k3m9qt" as BlockId;

function work(over: Partial<CitedWork> & Pick<CitedWork, "id" | "title" | "url" | "linkFrom">): CitedWork {
  return {
    key: `work:${over.title}`,
    why: "What the piece uses it for.",
    mentions: [],
    citedAt: [AT],
    firstCited: AT,
    citedInBody: true,
    ...over,
  };
}

function list(rows: CitedWork[]): Citations {
  return {
    version: "citations/4",
    generator: "m",
    slug: "s",
    sourceHash: "h",
    citations: rows,
    capped: false,
  } as Citations;
}

function record(id: string, title: string, over: Partial<WorkRecord> = {}): WorkRecord {
  return {
    id: id as WorkId,
    source: "crossref",
    title,
    authors: [{ family: "Vaswani", given: "Ashish" }, { family: "Shazeer", given: "Noam" }],
    year: 2017,
    venue: "NeurIPS",
    doi: id.replace(/^doi:/, ""),
    ...over,
  };
}

/** A fake registry: answers by id, and records every id it was asked. */
function fake(answers: Record<string, LookupResult>) {
  const asked: string[] = [];
  return {
    asked,
    lookup: async (id: WorkId): Promise<LookupResult> => {
      asked.push(id);
      return answers[id] ?? { kind: "not-found" };
    },
  };
}

const ATTENTION = work({
  id: "w1",
  title: "Attention Is All You Need",
  url: "https://doi.org/10.5555/attention",
  linkFrom: "doi",
});

describe("which rows are looked up", () => {
  it("is the row's link — a doi.org or arxiv.org address — and nothing else", () => {
    expect(rowWorkId(ATTENTION)).toBe("doi:10.5555/attention");
    expect(rowWorkId(work({ id: "a", title: "T", url: "https://arxiv.org/abs/1706.03762v5", linkFrom: "arxiv" }))).toBe(
      "arxiv:1706.03762",
    );
    /* An article-given link that happens to be a doi.org address is a DOI link too. */
    expect(rowWorkId(work({ id: "b", title: "T", url: "https://doi.org/10.1000/x", linkFrom: "article" }))).toBe("doi:10.1000/x");
    expect(rowWorkId(work({ id: "c", title: "T", url: "https://example.com/paper", linkFrom: "article" }))).toBeNull();
    expect(
      rowWorkId(work({ id: "d", title: "T", url: "https://scholar.google.com/scholar?q=10.1000/x", linkFrom: "search" })),
    ).toBeNull();
  });

  it("asks nothing for rows without an identifier", async () => {
    const reg = fake({});
    const out = await attachCitationRegistry(
      list([work({ id: "c", title: "T", url: "https://example.com/paper", linkFrom: "article" })]),
      reg,
    );
    expect(reg.asked).toEqual([]);
    expect(out.citations.citations[0]?.registry).toBeUndefined();
  });
});

describe("what an answer puts on the row", () => {
  it("keeps a found record whose title agrees", async () => {
    const reg = fake({ "doi:10.5555/attention": { kind: "found", record: record("doi:10.5555/attention", "Attention is all you need") } });
    const out = await attachCitationRegistry(list([ATTENTION]), reg);
    expect(out.citations.citations[0]?.registry).toEqual({
      kind: "found",
      source: "crossref",
      title: "Attention is all you need",
      authors: [
        { family: "Vaswani", given: "Ashish" },
        { family: "Shazeer", given: "Noam" },
      ],
      year: 2017,
      venue: "NeurIPS",
    });
    expect(out.counts).toMatchObject({ identified: 1, asked: 1, found: 1, conflict: 0 });
  });

  it("keeps a disagreeing title as a conflict, and none of the record", async () => {
    const reg = fake({
      "doi:10.5555/attention": {
        kind: "found",
        record: record("doi:10.5555/attention", "Soil microbiomes of the Atacama desert", { source: "datacite" }),
      },
    });
    const out = await attachCitationRegistry(list([ATTENTION]), reg);
    expect(out.citations.citations[0]?.registry).toEqual({ kind: "conflict", source: "datacite" });
    expect(out.counts.conflict).toBe(1);
  });

  it("does not treat a generic exact title as enough identity evidence", async () => {
    const row = work({ id: "editorial", title: "Editorial", url: "https://doi.org/10.1000/editorial", linkFrom: "doi" });
    const reg = fake({
      "doi:10.1000/editorial": { kind: "found", record: record("doi:10.1000/editorial", "Editorial") },
    });
    const out = await attachCitationRegistry(list([row]), reg);
    expect(out.citations.citations[0]?.registry).toBeUndefined();
    expect(out.counts).toMatchObject({ found: 0, conflict: 0, unconfirmed: 1 });
  });

  it("does not mistake a supplement sharing the parent title's opening for the cited work", async () => {
    const reg = fake({
      "doi:10.5555/attention": {
        kind: "found",
        record: record("doi:10.5555/attention", "Attention Is All You Need: Supplementary Information"),
      },
    });
    const out = await attachCitationRegistry(list([ATTENTION]), reg);
    expect(out.citations.citations[0]?.registry).toEqual({ kind: "conflict", source: "crossref" });
  });

  it("refuses a same-title answer returned under another identifier", async () => {
    const out = await attachCitationRegistry(list([ATTENTION]), {
      lookup: async () => ({
        kind: "found",
        record: record("doi:10.5555/somewhere-else", "Attention Is All You Need"),
      }),
    });
    expect(out.citations.citations[0]?.registry).toBeUndefined();
    expect(out.counts.unavailable).toBe(1);
  });

  it("leaves the row as it was when the registry is unavailable, not found, or throws — and the step succeeds", async () => {
    const rows = [
      ATTENTION,
      work({ id: "w2", title: "Two", url: "https://doi.org/10.1000/two", linkFrom: "doi" }),
      work({ id: "w3", title: "Three", url: "https://doi.org/10.1000/three", linkFrom: "doi" }),
    ];
    const out = await attachCitationRegistry(list(rows), {
      lookup: async (id) => {
        if (id === "doi:10.1000/three") throw new Error("boom");
        return id === "doi:10.1000/two" ? { kind: "not-found" } : { kind: "unavailable", why: "busy" };
      },
    });
    expect(out.citations.citations.map((w) => w.registry)).toEqual([undefined, undefined, undefined]);
    expect(out.citations.citations.map((w) => "registry" in w)).toEqual([false, false, false]);
    expect(out.counts).toMatchObject({ asked: 3, notFound: 1, unavailable: 2, found: 0 });
  });

  it("clears an earlier revision's registry rather than keeping it", async () => {
    const stale = { ...ATTENTION, registry: { kind: "conflict" as const, source: "crossref" as const } };
    const out = await attachCitationRegistry(list([stale]), fake({}));
    expect("registry" in (out.citations.citations[0] ?? {})).toBe(false);
  });

  it("keeps at most REGISTRY_AUTHORS_KEPT authors and counts the rest", async () => {
    const many = Array.from({ length: REGISTRY_AUTHORS_KEPT + 5 }, (_, i) => ({ family: `Author${i}` }));
    const reg = fake({
      "doi:10.5555/attention": { kind: "found", record: record("doi:10.5555/attention", "Attention Is All You Need", { authors: many }) },
    });
    const out = await attachCitationRegistry(list([ATTENTION]), reg);
    const r = out.citations.citations[0]?.registry;
    expect(r?.kind).toBe("found");
    if (r?.kind !== "found") return;
    expect(r.authors).toHaveLength(REGISTRY_AUTHORS_KEPT);
    expect(r.moreAuthors).toBe(5);
  });

  it("bounds every registry string before storing it on a row", async () => {
    const title = `A distinctive registry title ${"t".repeat(400)}`;
    const row = work({ id: "long", title, url: "https://doi.org/10.1000/long", linkFrom: "doi" });
    const out = await attachCitationRegistry(list([row]), fake({
      "doi:10.1000/long": {
        kind: "found",
        record: record("doi:10.1000/long", title, {
          authors: [{ family: "f".repeat(150), given: "g".repeat(150) }],
          venue: "v".repeat(300),
        }),
      },
    }));
    const registry = out.citations.citations[0]?.registry;
    expect(registry?.kind).toBe("found");
    if (registry?.kind !== "found") return;
    expect(registry.title.length).toBeLessThanOrEqual(300);
    expect(registry.authors[0]?.family.length).toBeLessThanOrEqual(100);
    expect(registry.authors[0]?.given?.length).toBeLessThanOrEqual(100);
    expect(registry.venue?.length).toBeLessThanOrEqual(200);
  });
});

describe("how many, and how fast", () => {
  it("asks at most MAX_REGISTRY_LOOKUPS, the first in list order, and never more than two at once", async () => {
    const rows = Array.from({ length: MAX_REGISTRY_LOOKUPS + 20 }, (_, i) =>
      work({ id: `w${i}`, title: `Work ${i}`, url: `https://doi.org/10.1000/w${i}`, linkFrom: "doi" }),
    );
    const asked: string[] = [];
    let inFlight = 0;
    let most = 0;
    const out = await attachCitationRegistry(list(rows), {
      lookup: async (id) => {
        asked.push(id);
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return { kind: "not-found" };
      },
    });
    expect(asked).toHaveLength(MAX_REGISTRY_LOOKUPS);
    expect(asked[0]).toBe("doi:10.1000/w0");
    expect(asked).not.toContain(`doi:10.1000/w${MAX_REGISTRY_LOOKUPS}`);
    expect(most).toBe(REGISTRY_CONCURRENCY);
    expect(out.counts).toMatchObject({ identified: MAX_REGISTRY_LOOKUPS + 20, asked: MAX_REGISTRY_LOOKUPS, overCap: 20 });
  });

  it("asks once for an identifier two rows share", async () => {
    const reg = fake({});
    await attachCitationRegistry(list([ATTENTION, { ...ATTENTION, id: "w1b" }]), reg);
    expect(reg.asked).toEqual(["doi:10.5555/attention"]);
  });

  it("stops starting lookups when the run budget is spent, without dropping a row", async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      work({ id: `w${i}`, title: `Distinctive work number ${i}`, url: `https://doi.org/10.1000/b${i}`, linkFrom: "doi" }),
    );
    let clock = 0;
    const asked: WorkId[] = [];
    const out = await attachCitationRegistry(list(rows), {
      now: () => clock,
      lookupBudgetMs: 60,
      lookup: async (id) => {
        asked.push(id);
        clock += 61;
        return { kind: "not-found" };
      },
    });
    expect(asked).toEqual(["doi:10.1000/b0"]);
    expect(out.citations.citations).toHaveLength(5);
    expect(out.counts).toMatchObject({ asked: 1, notFound: 1, overBudget: 4, overCap: 0 });
  });
});

describe("the composition root", () => {
  it("hands both steps stage 1's lookupWork itself", () => {
    expect(citationRegistryDeps.lookup).toBe(lookupWork);
    expect(debateRegistryDeps.lookup).toBe(lookupWork);
  });
});
