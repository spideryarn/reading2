/**
 * **The glossary's *Dig deeper* spends its allowance before anything else
 * costs**, and every press it lets through searches first —
 * `makeLookUpTerm` in src/term-lookup.ts, plan 261001p stage 1 (Sol F5).
 *
 * Driven through injected parts, because the claims are about order: which
 * call happens, and which never does.
 */
import { describe, expect, it } from "vitest";

import type { DigFindings } from "../src/dig-deeper.js";
import type { LookupsByTerm } from "../src/glossary-lookups.js";
import { makeLookUpTerm } from "../src/term-lookup.js";
import type { AllowanceTaken } from "../src/store/contracts.js";
import type { Article, Block, GlossaryResponse } from "../src/types.js";

const block: Block = {
  id: "spya-aaaaaa" as Block["id"],
  kind: "text",
  tag: "p",
  gistable: true,
  html: "<p>Clark calls this predictive processing, after Helmholtz.</p>",
  text: "Clark calls this predictive processing, after Helmholtz.",
  words: 7,
};
const article = {
  meta: { slug: "harness", title: "A piece", byline: "A. Writer", publishedAt: "2026-01-02" },
  blocks: [block],
  tree: { rootId: block.id, nodes: {} },
  highPowerSince: null,
} as unknown as Article;
const entry = { id: "spya-pppppp", name: "predictive processing", aliases: [], blocks: [block.id] };

const FOUND: DigFindings = {
  sources: [{ url: "https://example.org/pp", title: "PP", excerpt: "A theory." }],
  searches: 1,
  libraryQuery: '"predictive processing"',
  library: [],
};

function harness(taken: AllowanceTaken) {
  const order: string[] = [];
  const digs: unknown[] = [];
  const finished: string[] = [];
  const prepare = makeLookUpTerm({
    reader: {
      loadArticle: async () => article,
      loadGlossary: async () =>
        ({
          glossary: { entries: [{ ...entry, kind: "term", background: "" }] },
          stale: false,
          outdated: false,
        }) as unknown as GlossaryResponse,
    },
    lookups: {
      load: async (): Promise<LookupsByTerm> => ({}),
      save: async (_slug, termId, lookup): Promise<LookupsByTerm> => ({ [termId]: lookup }),
    },
    allowance: {
      take: async (bucket) => {
        order.push(`take:${bucket}`);
        return taken;
      },
      finish: async (id) => {
        finished.push(id);
      },
    },
    library: async () => ({ hits: [], capped: false }),
    searchFirst: async (input) => {
      order.push("search");
      digs.push(input);
      return FOUND;
    },
    explainStream: async function* (req) {
      order.push("explain");
      digs.push(req.dig);
      yield {
        type: "done",
        ending: "finished",
        answer: "An answer.",
        citations: [],
        searches: 2,
        model: "a-model",
      };
    },
  });
  return { prepare, order, digs, finished };
}

describe("Dig deeper on a glossary entry", () => {
  it.each([
    ["rate", 429],
    ["concurrency", 429],
    ["global", 503],
  ] as const)("refuses on %s before any model call", async (kind, status) => {
    const h = harness({ kind });
    await expect(h.prepare("harness", entry.id)).rejects.toMatchObject({ status });
    expect(h.order).toEqual(["take:dig-deeper"]);
  });

  it("searches first, hands the findings to explain, then frees the slot", async () => {
    const h = harness({ kind: "allowed", id: "lease-1" });
    const question = await h.prepare("harness", entry.id);
    for await (const _ of question.stream()) {
      /* drain */
    }
    expect(h.order).toEqual(["take:dig-deeper", "search", "explain"]);
    expect(h.digs[0]).toMatchObject({
      slug: "harness",
      subject: "predictive processing",
      article: { title: "A piece", author: "A. Writer", date: "2026-01-02" },
    });
    expect((h.digs[0] as { context: string }).context).toContain("Clark calls this");
    expect(h.digs[1]).toBe(FOUND);
    expect(h.finished).toEqual(["lease-1"]);
  });

  it("frees the slot when the client goes before the stream starts", async () => {
    const h = harness({ kind: "allowed", id: "lease-2" });
    const question = await h.prepare("harness", entry.id);
    await question.release();
    await question.release();
    expect(h.finished).toEqual(["lease-2"]);
    expect(h.order).toEqual(["take:dig-deeper"]);
  });
});
