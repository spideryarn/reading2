/**
 * **Citations' *Investigate*, with the model and the stores injected** —
 * src/citation-investigate.ts, docs/plans/260930a-citations-investigate-one-work-on-demand.md.
 *
 * What is pinned here:
 *
 * 1. **The request** — its own job, Exa pinned with the probe's caps and
 *    `max_characters`, the article as the cached first part, the work and the
 *    profile after it.
 * 2. **What was read is code's** — `provenanceOf` counts only results with a
 *    non-empty extract, and credits *Look it up*'s match only when its page is
 *    among them.
 * 3. **Only a clean `finished` ending with at least one extract is stored**, and
 *    `done` is yielded only after the save resolves.
 * 4. **A quotation the guard cannot find stops the answer** — the span is never
 *    yielded and nothing is stored.
 * 5. **Refusals come before anything is spent**: a 404, then the allowance.
 */
import { describe, expect, it } from "vitest";

import {
  INVESTIGATE_MAX_CHARACTERS,
  INVESTIGATE_RATE_POLICY,
  investigateRequest,
  makeInvestigateCitation,
  provenanceOf,
  type InvestigateEvent,
} from "../src/citation-investigate.js";
import { investigateContext } from "../src/citation-investigate-context.js";
import type { StreamOutcome } from "../src/ai-call.js";
import type { StreamRun, StreamRunEvent } from "../src/stream-run.js";
import type { AllowanceTaken } from "../src/store/contracts.js";
import type {
  Article,
  Block,
  BlockId,
  CitationFind,
  CitationInvestigation,
  CitationLookup,
  Citations,
  CitedWork,
  SearchEvidence,
} from "../src/types.js";

const SLUG = "an-article";
const ID = "spya-nvstga";
const FIRST = "spya-bbbbbb" as BlockId;
const SECOND = "spya-cccccc" as BlockId;

const BLOCKS = [
  { id: FIRST, text: "Kaplan et al. found the loss falls as a power law with model size.", tag: "p", kind: "p", words: 13, html: "", gistable: true },
  { id: SECOND, text: "The curve keeps going, the author says, and bigger is better.", tag: "p", kind: "p", words: 11, html: "", gistable: true },
] as unknown as Block[];

const ARTICLE = {
  meta: { title: "The scaling essay", slug: SLUG },
  blocks: BLOCKS,
  tree: {},
} as unknown as Article;

const TITLE = "Scaling Laws for Neural Language Models";

function work(over: Partial<CitedWork> = {}): CitedWork {
  return {
    id: ID,
    key: "arxiv:2001.08361",
    title: TITLE,
    authors: "Kaplan, J.",
    year: "2020",
    why: "The curve the piece extrapolates from.",
    reference: { blockId: SECOND, quote: "Kaplan 2020, Scaling Laws", start: 0 },
    mentions: [{ blockId: FIRST, quote: "Kaplan et al.", start: 0 }],
    citedAt: [FIRST, SECOND],
    firstCited: FIRST,
    citedInBody: true,
    url: "https://arxiv.org/abs/2001.08361",
    linkFrom: "arxiv",
    ...over,
  };
}

const LOOKUP: CitationLookup = {
  state: "assessed",
  host: "arxiv.org",
  searches: 1,
  model: "m",
  at: "2026-09-30T00:00:00.000Z",
  contextHash: "ctx",
  evidenceHash: "evi",
  excerptWords: 200,
  verdict: { support: "supports", quote: "The loss scales as a power-law with model size" },
  paperDoes: { says: "It measures loss.", quote: "We study empirical scaling laws for language model performance" },
};

const EVIDENCE: SearchEvidence[] = [
  { url: "https://arxiv.org/abs/2001.08361", title: "[2001.08361] Scaling Laws", excerpt: "We study empirical scaling laws for language model performance on the cross-entropy loss." },
  { url: "https://www.semanticscholar.org/paper/x", title: "Scaling Laws", excerpt: "one two three four five six seven eight nine ten eleven" },
  { url: "https://empty.example/page", title: "Nothing read", excerpt: "   " },
  { url: "https://absent.example/page", title: "No excerpt at all" },
];

function end(over: Partial<Extract<StreamRunEvent, { type: "end" }>> = {}): Extract<StreamRunEvent, { type: "end" }> {
  return {
    type: "end",
    outcome: { kind: "finished" },
    text: "",
    citations: [],
    evidence: EVIDENCE,
    searches: 1,
    searchesFrom: "server_tool_use_details",
    model: "anthropic/claude-sonnet-5",
    usage: undefined,
    finishReason: "stop",
    started: Date.now(),
    timedOut: false,
    stalled: false,
    clockError: () => new Error("clock [ai-slow]"),
    ...over,
  };
}

interface Harness {
  deltas: string[];
  outcome?: StreamOutcome;
  evidence?: SearchEvidence[] | null;
  lookup?: CitationLookup;
  find?: CitationFind | null;
  allowance?: AllowanceTaken;
  save?: (inv: CitationInvestigation) => Promise<void>;
  rows?: CitedWork[];
}

function harness(h: Harness) {
  const runs: StreamRun[] = [];
  const saved: CitationInvestigation[] = [];
  const finished: string[] = [];
  let taken = 0;
  const listed = h.rows ?? [work(h.lookup ? { lookup: h.lookup } : {})];
  const citations: Citations = {
    version: "citations/4",
    generator: "g",
    slug: SLUG,
    sourceHash: "h",
    citations: listed,
    capped: false,
    generatedAt: "2026-09-30T00:00:00.000Z",
    elapsedMs: 1,
  };
  const investigate = makeInvestigateCitation({
    reader: {
      loadCitations: async () => ({ citations, stale: false, outdated: false }),
      loadArticle: async () => ARTICLE,
    },
    finds: { load: async () => h.find ?? null },
    investigations: {
      save: async (_slug, _id, inv) => {
        if (h.save) await h.save(inv);
        saved.push(inv);
      },
    },
    allowance: {
      take: async () => {
        taken += 1;
        return h.allowance ?? { kind: "allowed", id: "lease-1" };
      },
      finish: async (id) => {
        finished.push(id);
      },
    },
    run: async function* (args: StreamRun) {
      runs.push(args);
      let text = "";
      for (const d of h.deltas) {
        text += d;
        yield { type: "delta", text: d } as const;
      }
      yield end({
        text,
        outcome: h.outcome ?? { kind: "finished" },
        evidence: h.evidence === undefined ? EVIDENCE : h.evidence,
      });
    },
    now: () => "2026-09-30T12:00:00.000Z",
  });
  return { investigate, runs, saved, finished, taken: () => taken };
}

async function drain(stream: AsyncGenerator<InvestigateEvent>) {
  const events: InvestigateEvent[] = [];
  let error: unknown = null;
  try {
    for await (const e of stream) events.push(e);
  } catch (err) {
    error = err;
  }
  const text = events.flatMap((e) => (e.type === "delta" ? [e.text] : [])).join("");
  return { events, error, text };
}

describe("the request", () => {
  it("is its own job, pins Exa with the probe's caps and max_characters, and caches the article", async () => {
    const h = harness({ deltas: ["Does it back the claim?\nIt does."] });
    const { stream } = await h.investigate(SLUG, ID, "About the reader: a physicist");
    await drain(stream());
    const [run] = h.runs;
    expect(run?.job).toBe("citation-investigate");
    expect(run?.collectEvidence).toBe(true);
    expect(run?.request.tools).toEqual([
      {
        type: "openrouter:web_search",
        parameters: { engine: "exa", max_total_results: 8, max_results: 5, max_characters: 8000 },
      },
    ]);
    expect(INVESTIGATE_MAX_CHARACTERS).toBe(8000);
    const messages = run?.request.messages as { role: string; content: unknown }[];
    expect(messages[0]?.role).toBe("system");
    const parts = messages[1]?.content as { type: string; text: string; cache_control?: unknown }[];
    expect(parts[0]?.cache_control).toEqual({ type: "ephemeral" });
    expect(parts[0]?.text).toContain(`${FIRST}: Kaplan et al.`);
    expect(parts[0]?.text).not.toContain("physicist");
    expect(parts[1]?.cache_control).toBeUndefined();
    expect(parts[1]?.text).toContain(`Title: ${TITLE}`);
    expect(parts[1]?.text).toContain("https://arxiv.org/abs/2001.08361");
    expect(parts[1]?.text).toContain("WHO IS READING THIS");
    expect(parts[1]?.text).toContain("physicist");
  });

  it("gives a searched row's Scholar link to nobody, and says so when no result is confirmed", () => {
    const context = investigateContext(
      work({ url: "https://scholar.google.com/scholar?q=x", linkFrom: "search" }),
      (id) => BLOCKS.find((b) => b.id === id)?.text,
    );
    const request = investigateRequest({
      meta: ARTICLE.meta,
      blocks: BLOCKS,
      context,
      profile: null,
      matched: null,
      model: "m",
    });
    const second = (request.messages as { content: { text: string }[] }[])[1]?.content[1]?.text ?? "";
    expect(second).not.toContain("scholar.google.com");
    expect(second).not.toContain("WHO IS READING THIS");
    expect(second).toMatch(/only when its title, authors and year match/);
  });

  it("puts Look it up's matched page and its verified quotes in, when there is one", async () => {
    const h = harness({
      deltas: ["Does it back the claim?\nIt does."],
      lookup: LOOKUP,
      find: { url: "https://arxiv.org/abs/2001.08361/", host: "arxiv.org", searches: 1, model: "m", at: "x", lookup: LOOKUP },
    });
    const { stream } = await h.investigate(SLUG, ID, null);
    await drain(stream());
    const parts = (h.runs[0]?.request.messages as { content: { text: string }[] }[] | undefined)?.[1]?.content ?? [];
    const second = parts[1]?.text ?? "";
    expect(second).toContain("https://arxiv.org/abs/2001.08361/");
    expect(second).toContain("The loss scales as a power-law with model size");
    expect(second).toContain("We study empirical scaling laws for language model performance");
  });
});

describe("provenanceOf", () => {
  it("counts only results with a non-empty extract, and lists exactly those", () => {
    const p = provenanceOf(EVIDENCE, null);
    expect(p.extractsRead).toBe(2);
    expect(p.sources.map((s) => s.url)).toEqual([
      "https://arxiv.org/abs/2001.08361",
      "https://www.semanticscholar.org/paper/x",
    ]);
    expect(p.longestExtractWords).toBe(13);
    expect(p.matchedHost).toBeNull();
  });

  it("reads zero when no result carried an extract", () => {
    expect(provenanceOf([EVIDENCE[2] as SearchEvidence, EVIDENCE[3] as SearchEvidence], null).extractsRead).toBe(0);
  });

  it("credits Look it up's page only when its URL, normalised, is among the extracts", () => {
    expect(provenanceOf(EVIDENCE, "https://ARXIV.org/abs/2001.08361/#top").matchedHost).toBe("arxiv.org");
    expect(provenanceOf(EVIDENCE, "https://arxiv.org/abs/9999.00001").matchedHost).toBeNull();
    /* A page that came back without an extract was not read. */
    expect(provenanceOf(EVIDENCE, "https://empty.example/page").matchedHost).toBeNull();
  });
});

describe("what is kept", () => {
  it("stores a finished answer with code's provenance, and yields `done` with it", async () => {
    const h = harness({ deltas: ["Does it back the claim?\n", "The abstract on arxiv.org says it does."] });
    const { stream } = await h.investigate(SLUG, ID, null);
    const { events, error, text } = await drain(stream());
    expect(error).toBeNull();
    expect(text).toBe("Does it back the claim?\nThe abstract on arxiv.org says it does.");
    expect(h.saved).toHaveLength(1);
    const done = events.at(-1);
    expect(done?.type).toBe("done");
    expect(done?.type === "done" ? done.investigation : null).toEqual(h.saved[0]);
    expect(h.saved[0]).toMatchObject({
      answer: "Does it back the claim?\nThe abstract on arxiv.org says it does.",
      extractsRead: 2,
      longestExtractWords: 13,
      matchedHost: null,
      searches: 1,
      searchesFrom: "server_tool_use_details",
      at: "2026-09-30T12:00:00.000Z",
      promptVersion: "citation-investigate/1",
    });
    expect(h.finished).toEqual(["lease-1"]);
  });

  it("yields `done` only after the save has resolved", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const h = harness({ deltas: ["An answer."], save: () => gate });
    const { stream } = await h.investigate(SLUG, ID, null);
    const it = stream();
    const seen: string[] = [];
    const pump = (async () => {
      for await (const e of it) seen.push(e.type);
    })();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual(["delta"]);
    release();
    await pump;
    expect(seen).toEqual(["delta", "done"]);
  });

  for (const outcome of [
    { kind: "unknown-finish-reason" },
    { kind: "wants-tools" },
    { kind: "truncated" },
    { kind: "filtered" },
    { kind: "abandoned" },
    { kind: "unterminated" },
    { kind: "provider-failed" },
  ] as StreamOutcome[]) {
    it(`stores nothing and yields no done when the stream ended ${outcome.kind}`, async () => {
      const h = harness({ deltas: ["Half an answer."], outcome });
      const { stream } = await h.investigate(SLUG, ID, null);
      const { events, error } = await drain(stream());
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/\[[a-z0-9-]+\]$/);
      expect(events.some((e) => e.type === "done")).toBe(false);
      expect(h.saved).toHaveLength(0);
      expect(h.finished).toEqual(["lease-1"]);
    });
  }

  it("refuses an answer written with no extract to read", async () => {
    const h = harness({ deltas: ["An answer from memory."], evidence: [EVIDENCE[2] as SearchEvidence] });
    const { stream } = await h.investigate(SLUG, ID, null);
    const { events, error } = await drain(stream());
    expect((error as Error).message).toMatch(/\[cite-no-extract\]$/);
    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(h.saved).toHaveLength(0);
  });

  it("refuses when the runner collected no evidence at all", async () => {
    const h = harness({ deltas: ["An answer."], evidence: null });
    const { stream } = await h.investigate(SLUG, ID, null);
    expect((await drain(stream())).error).toBeInstanceOf(Error);
    expect(h.saved).toHaveLength(0);
  });

  it("credits Look it up's match in what is stored only when its page was read", async () => {
    const find = { url: "https://arxiv.org/abs/2001.08361", host: "arxiv.org", searches: 1, model: "m", at: "x", lookup: LOOKUP };
    const read = harness({ deltas: ["An answer."], lookup: LOOKUP, find });
    await drain((await read.investigate(SLUG, ID, null)).stream());
    expect(read.saved[0]?.matchedHost).toBe("arxiv.org");

    const unread = harness({ deltas: ["An answer."], lookup: LOOKUP, find, evidence: [EVIDENCE[1] as SearchEvidence] });
    await drain((await unread.investigate(SLUG, ID, null)).stream());
    expect(unread.saved[0]?.matchedHost).toBeNull();

    /* A stored find whose lookup is not the one attached (stale) is not a match. */
    const stale = harness({ deltas: ["An answer."], find });
    await drain((await stale.investigate(SLUG, ID, null)).stream());
    expect(stale.saved[0]?.matchedHost).toBeNull();
  });
});

describe("the quote guard, inside the stream", () => {
  it("stops at a source's quotation, never yields it, and stores nothing", async () => {
    const h = harness({
      deltas: ["Does it back the claim?\nThe abstract on arxiv.org says ", '"we study empirical', ' scaling laws" and more.'],
    });
    const { stream } = await h.investigate(SLUG, ID, null);
    const { events, error, text } = await drain(stream());
    expect((error as Error).message).toBe(
      "This answer tried to quote a source directly, which we can't check, so it was stopped and not kept. " +
        "Investigating again usually gets one that says it in its own words. [cite-quoted]",
    );
    expect(text).toBe("Does it back the claim?\nThe abstract on arxiv.org says ");
    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(h.saved).toHaveLength(0);
  });

  it("lets the article's own words, the work's title and Look it up's verified quotes through", async () => {
    const answer =
      `The work, "${TITLE}," backs the article's "loss falls as a power law," and ` +
      `the abstract, per Look it up, says "The loss scales as a power-law with model size."`;
    const h = harness({
      deltas: [answer],
      lookup: LOOKUP,
      find: { url: "https://arxiv.org/abs/2001.08361", host: "arxiv.org", searches: 1, model: "m", at: "x", lookup: LOOKUP },
    });
    const { error, text } = await drain((await h.investigate(SLUG, ID, null)).stream());
    expect(error).toBeNull();
    expect(text).toBe(answer);
    expect(h.saved).toHaveLength(1);
  });

  it("does not allow Look it up's quotes when there is no match", async () => {
    const answer = `The abstract says "The loss scales as a power-law with model size."`;
    const h = harness({ deltas: [answer] });
    const { error } = await drain((await h.investigate(SLUG, ID, null)).stream());
    expect((error as Error).message).toMatch(/\[cite-quoted\]$/);
  });

  it("stops a quotation left open at the end", async () => {
    const h = harness({ deltas: ['It says "bigger is better and'] });
    const { error } = await drain((await h.investigate(SLUG, ID, null)).stream());
    expect((error as Error).message).toMatch(/\[cite-quoted\]$/);
    expect(h.saved).toHaveLength(0);
  });
});

describe("refusals before anything is spent", () => {
  it("is a 404 for an id the list does not have, with no allowance taken and no call", async () => {
    const h = harness({ deltas: ["x"] });
    await expect(h.investigate(SLUG, "spya-n2t3h4", null)).rejects.toMatchObject({ status: 404 });
    expect(h.taken()).toBe(0);
    expect(h.runs).toHaveLength(0);
  });

  it.each([
    ["concurrency", 429],
    ["rate", 429],
    ["global", 503],
  ] as const)("refuses a spent allowance (%s) as %i, with no call", async (kind, status) => {
    const h = harness({ deltas: ["x"], allowance: { kind } as AllowanceTaken });
    await expect(h.investigate(SLUG, ID, null)).rejects.toMatchObject({ status });
    expect(h.runs).toHaveLength(0);
  });

  it("sets the allowance the plan measured: one at a time, 8 an hour, 20 a day, 60 for everyone", () => {
    expect(INVESTIGATE_RATE_POLICY).toMatchObject({
      concurrency: 1,
      fills: 8,
      windowMs: 60 * 60 * 1000,
      daily: { fills: 20, globalFills: 60, windowMs: 24 * 60 * 60 * 1000 },
    });
  });
});
