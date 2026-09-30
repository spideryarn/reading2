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

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { CAPABLE_MODEL_OPENROUTER, HIGH_POWER_MODEL_OPENROUTER } from "../src/models.js";
import { DEV_OWNER_ID, type OwnerId, runAsOwner } from "../src/owner.js";

import { FIND_TIMEOUT_MS, LOOKUP_SYSTEM, makeFindCitation } from "../src/citation-find.js";
import {
  INVESTIGATE_MAX_CHARACTERS,
  INVESTIGATE_RATE_POLICY,
  INVESTIGATE_TIMEOUT_MS,
  investigateRequest,
  makeInvestigateCitation,
  provenanceOf,
  type InvestigateCitationDeps,
  type InvestigateEvent,
} from "../src/citation-investigate.js";
import { CITATION_INVESTIGATE_VERSION, investigateContext } from "../src/citation-investigate-context.js";
import { type AiRequestBody, type JsonCall, ProviderRefused, type StreamOutcome } from "../src/ai-call.js";
import { CITATION_LOOKUP_NO_MATCH } from "../src/messages.js";
import type { StreamRun, StreamRunEvent } from "../src/stream-run.js";
import type { AllowanceTaken, RatePolicy } from "../src/store/contracts.js";
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

/** A whole non-streamed chat completion, as `openRouterJson` hands the lookup's call back. */
function lookupAnswer(opts: {
  content?: string;
  finish?: string;
  results?: { url: string; title?: string; content?: string }[];
}): unknown {
  return {
    choices: [
      {
        finish_reason: opts.finish ?? "stop",
        message: {
          content: opts.content ?? JSON.stringify({ url: null }),
          annotations: (opts.results ?? []).map((r) => ({ type: "url_citation", url_citation: r })),
        },
      },
    ],
    usage: { server_tool_use: { web_search_requests: 1 } },
  };
}

/** The lookup's result: the arXiv page, whose URL carries the row's arXiv id (R-1), and an extract with both quotes in it. */
const PAPER_PAGE = {
  url: "https://arxiv.org/abs/2001.08361",
  title: "[2001.08361] Scaling Laws for Neural Language Models",
  content:
    "We study empirical scaling laws for language model performance on the cross-entropy loss. " +
    "The loss scales as a power-law with model size, dataset size, and compute.",
};
/** A lookup answer that identifies the page and passes every check: `assessed`, two verified quotes. */
const FOUND_ANSWER = lookupAnswer({
  results: [PAPER_PAGE],
  content: JSON.stringify({
    url: PAPER_PAGE.url,
    paperDoes: "It measures how loss falls as models grow.",
    paperDoesQuote: "We study empirical scaling laws for language model performance",
    support: "supports",
    supportQuote: "The loss scales as a power-law with model size",
  }),
});
/** No annotations at all — a no-match. The harness's default, so a row without a lookup still reads. */
const NO_MATCH_ANSWER = lookupAnswer({});

interface Harness {
  deltas: string[];
  /** The article the reader seam answers with — `ARTICLE` unless a case needs another. */
  article?: Article;
  outcome?: StreamOutcome;
  evidence?: SearchEvidence[] | null;
  lookup?: CitationLookup;
  find?: CitationFind | null;
  allowance?: AllowanceTaken;
  save?: (inv: CitationInvestigation) => Promise<void>;
  rows?: CitedWork[];
  /** The list every read after the first answers — the list made again while step 1 ran. `undefined`: unchanged. */
  rowsAfter?: CitedWork[] | ((savedFinds: CitationFind[], removedFindAts: string[]) => CitedWork[]);
  /** What the first step's model call answers, or throws. */
  lookupReply?: unknown | Error;
  saveFind?: (find: CitationFind) => Promise<void>;
}

function citationsOf(rows: CitedWork[]): Citations {
  return {
    version: "citations/4",
    generator: "g",
    slug: SLUG,
    sourceHash: "h",
    citations: rows,
    capped: false,
    generatedAt: "2026-09-30T00:00:00.000Z",
    elapsedMs: 1,
  };
}

function harness(h: Harness) {
  const runs: StreamRun[] = [];
  const saved: CitationInvestigation[] = [];
  const finished: string[] = [];
  const buckets: string[] = [];
  const policies: RatePolicy[] = [];
  const lookupCalls: AiRequestBody[] = [];
  const savedFinds: CitationFind[] = [];
  const removedFindAts: string[] = [];
  let reads = 0;
  const listed = h.rows ?? [work(h.lookup ? { lookup: h.lookup } : {})];
  const deps: InvestigateCitationDeps = {
    reader: {
      loadCitations: async () => {
        reads += 1;
        const after = typeof h.rowsAfter === "function" ? h.rowsAfter(savedFinds, removedFindAts) : h.rowsAfter;
        const rows = reads > 1 && after !== undefined ? after : listed;
        return { citations: citationsOf(rows), stale: false, outdated: false };
      },
      loadArticle: async () => h.article ?? ARTICLE,
    },
    finds: {
      /* The store: a find saved by step 1 is the one read back. */
      load: async () => {
        const found = savedFinds.at(-1) ?? h.find ?? null;
        return found && !removedFindAts.includes(found.at) ? found : null;
      },
      save: async (_slug, _id, find) => {
        if (h.saveFind) await h.saveFind(find);
        savedFinds.push(find);
      },
    },
    lookupCall: async (body): Promise<JsonCall> => {
      lookupCalls.push(body);
      const reply = h.lookupReply === undefined ? NO_MATCH_ANSWER : h.lookupReply;
      if (reply instanceof Error) throw reply;
      return { json: reply, answeredBy: "anthropic/claude-sonnet-5", generationId: null };
    },
    investigations: {
      save: async (_slug, _id, inv) => {
        if (h.save) await h.save(inv);
        saved.push(inv);
      },
    },
    allowance: {
      take: async (bucket, policy) => {
        buckets.push(bucket);
        policies.push(policy);
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
  };
  const investigate = makeInvestigateCitation(deps);
  return {
    investigate,
    deps,
    runs,
    saved,
    finished,
    buckets,
    policies,
    lookupCalls,
    savedFinds,
    removedFindAts,
    taken: () => buckets.length,
  };
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
  it("forbids quotation marks outright, and leaves room for the answer (260930d reproduction)", async () => {
    const h = harness({ deltas: ["Does it back the claim?\nIt does."] });
    await drain((await h.investigate(SLUG, ID, null)).stream());
    const body = h.runs[0]?.request as unknown as { max_tokens?: number; messages: { role: string; content: unknown }[] };
    const system = String(body.messages.find((m) => m.role === "system")?.content);
    /* 4 of 5 real calls were stopped by the guard when the prompt allowed
       quotation marks for the article's words and the work's title: the model
       then quoted its own phrases, the paper's terms and result titles too. */
    expect(system).toContain("NO QUOTATION MARKS AT ALL");
    expect(system).not.toContain("Use quotation marks only for");
    expect(body.max_tokens).toBeGreaterThanOrEqual(3000);
  });

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

  /* Whether a result is the work is code's claim, drawn under the answer as
     "We could not confirm that any result is this work itself." A browser check
     found the model saying "This search turned up the work itself, hosted
     directly on gwern.net" directly above it (plan 260930a § Review log). So
     the prompt leaves that claim to code, in both branches, and has results
     named by site. */
  it("tells the model not to say whether any result is the work, and to name results by site", () => {
    const context = investigateContext(work(), (id) => BLOCKS.find((b) => b.id === id)?.text);
    for (const matched of [
      null,
      { url: "https://arxiv.org/abs/2001.08361", title: "Scaling Laws", quotes: [] },
    ]) {
      const request = investigateRequest({ meta: ARTICLE.meta, blocks: BLOCKS, context, profile: null, matched, model: "m" });
      const messages = request.messages as { role: string; content: unknown }[];
      const system = messages[0]?.content as string;
      expect(system).toMatch(/Never say whether you found the work itself/);
      expect(system).toMatch(/the reader is told that separately/);
      expect(system).toMatch(/by its site/);
      expect(system, "the old instruction to describe a result as this work").not.toMatch(/describe a result as this work/i);
      expect(system, "the old instruction to say the work itself was not found").not.toMatch(/work itself was not found/);
      const second = (messages[1]?.content as { text: string }[] | undefined)?.[1]?.text ?? "";
      expect(second, "the second part invites the claim again").not.toMatch(/Describe a result as this work/);
    }
    expect(CITATION_INVESTIGATE_VERSION, "the prompt changed, so stored answers must detach").toBe(
      "citation-investigate/4",
    );
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
    expect(
      provenanceOf(
        [{ url: "https://example.org/paper", excerpt: "an extract" }],
        "https://example.org:8443/paper",
      ).matchedHost,
    ).toBeNull();
    expect(
      provenanceOf(
        [{ url: "http://example.org/paper", excerpt: "an extract" }],
        "https://example.org/paper",
      ).matchedHost,
    ).toBeNull();
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
      promptVersion: "citation-investigate/4",
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
    expect(seen).toEqual(["stage", "lookup", "stage", "delta"]);
    release();
    await pump;
    expect(seen).toEqual(["stage", "lookup", "stage", "delta", "done"]);
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

  it("sets the allowance: one at a time, 8 an hour, 20 a day, 55 for everyone (plan 260930d P-6)", () => {
    expect(INVESTIGATE_RATE_POLICY).toMatchObject({
      concurrency: 1,
      fills: 8,
      windowMs: 60 * 60 * 1000,
      daily: { fills: 20, globalFills: 55, windowMs: 24 * 60 * 60 * 1000 },
    });
  });

  it("leases the slot for both deadlines plus the margin, since one press is now both calls (P-6)", () => {
    expect(INVESTIGATE_RATE_POLICY.leaseMs).toBe(FIND_TIMEOUT_MS + INVESTIGATE_TIMEOUT_MS + 30_000);
  });
});

/* ------------------------------------------- plan 260930d: one press, two steps -- */

/** The reading's second user part — the work, the match or its absence, the why — as sent. */
function secondPart(runs: StreamRun[]): string {
  const messages = runs[0]?.request.messages as { content: { text: string }[] }[] | undefined;
  return messages?.[1]?.content[1]?.text ?? "";
}

function types(events: InvestigateEvent[]): string[] {
  return events.map((e) => (e.type === "stage" ? `stage:${e.stage}` : e.type));
}

describe("step 1, the lookup — when it runs (P-2)", () => {
  it("is skipped only for a current assessed lookup", async () => {
    const h = harness({
      deltas: ["An answer."],
      lookup: LOOKUP,
      find: { url: "https://arxiv.org/abs/2001.08361", host: "arxiv.org", searches: 1, model: "m", at: "x", lookup: LOOKUP },
    });
    const { events, error } = await drain((await h.investigate(SLUG, ID, null)).stream());
    expect(error).toBeNull();
    expect(h.lookupCalls).toHaveLength(0);
    expect(types(events)).toEqual(["stage:reading", "delta", "done"]);
  });

  it.each(["no-extract", "not-identified", "unreadable"] as const)(
    "runs again for a %s lookup — this press is now its only way to improve",
    async (state) => {
      const lookup = { ...LOOKUP, state } as unknown as CitationLookup;
      const h = harness({ deltas: ["An answer."], lookup });
      const { events, error } = await drain((await h.investigate(SLUG, ID, null)).stream());
      expect(error).toBeNull();
      expect(h.lookupCalls).toHaveLength(1);
      expect(types(events)).toEqual(["stage:finding", "lookup", "stage:reading", "delta", "done"]);
    },
  );

  it("runs for a row with no lookup at all, and sends Look it up's own prompt (P-1)", async () => {
    const h = harness({ deltas: ["An answer."] });
    await drain((await h.investigate(SLUG, ID, null)).stream());
    expect(h.lookupCalls).toHaveLength(1);
    const system = (h.lookupCalls[0]?.messages as { role: string; content: string }[] | undefined)?.[0]?.content;
    expect(system).toBe(LOOKUP_SYSTEM);
  });

  it("takes one allowance for the whole press, from the investigate bucket, and frees it once", async () => {
    const h = harness({ deltas: ["An answer."], lookupReply: FOUND_ANSWER });
    await drain((await h.investigate(SLUG, ID, null)).stream());
    expect(h.buckets).toEqual(["citation-investigate"]);
    expect(h.finished).toEqual(["lease-1"]);
  });

  it("can free the allowance when the admitted client never starts the stream", async () => {
    const h = harness({ deltas: ["An answer."] });
    const admitted = await h.investigate(SLUG, ID, null);
    expect(h.finished).toEqual([]);

    await admitted.release();
    await admitted.release();

    expect(h.lookupCalls).toHaveLength(0);
    expect(h.runs).toHaveLength(0);
    expect(h.finished).toEqual(["lease-1"]);
  });
});

describe("step 1, the lookup — what it hands on", () => {
  it("stores the find and yields exactly the body POST …/find answers", async () => {
    const h = harness({ deltas: ["An answer."], lookupReply: FOUND_ANSWER });
    const { events } = await drain((await h.investigate(SLUG, ID, null)).stream());
    const frame = events.find((e) => e.type === "lookup");

    /* The route, driven with the same reply, the same row and the same clock. */
    const findSaved: CitationFind[] = [];
    const find = makeFindCitation({
      reader: {
        loadCitations: async () => ({ citations: citationsOf([work()]), stale: false, outdated: false }),
        loadArticle: async () => ARTICLE,
      },
      finds: { save: async (_s, _i, f) => void findSaved.push(f) },
      allowance: { take: async () => ({ kind: "allowed", id: "l" }), finish: async () => {} },
      call: async () => ({ json: FOUND_ANSWER, answeredBy: "anthropic/claude-sonnet-5", generationId: null }),
      now: () => "2026-09-30T12:00:00.000Z",
    });
    const fromRoute = await find(SLUG, ID);
    expect(fromRoute.outcome).toBe("found");
    expect(frame?.type === "lookup" ? frame.response : null).toEqual(fromRoute);
    expect(h.savedFinds).toEqual(findSaved);
    expect(h.savedFinds[0]?.lookup?.state).toBe("assessed");
  });

  it("keeps /find's allowance scoped to the provider call, not the later save", async () => {
    let saveStarted: (() => void) | undefined;
    const saving = new Promise<void>((resolve) => {
      saveStarted = resolve;
    });
    let letSaveFinish: (() => void) | undefined;
    const saveGate = new Promise<void>((resolve) => {
      letSaveFinish = resolve;
    });
    const finished: string[] = [];
    const find = makeFindCitation({
      reader: {
        loadCitations: async () => ({ citations: citationsOf([work()]), stale: false, outdated: false }),
        loadArticle: async () => ARTICLE,
      },
      finds: {
        save: async () => {
          saveStarted?.();
          await saveGate;
        },
      },
      allowance: {
        take: async () => ({ kind: "allowed", id: "find-lease" }),
        finish: async (id) => void finished.push(id),
      },
      call: async () => ({ json: FOUND_ANSWER, answeredBy: "anthropic/claude-sonnet-5", generationId: null }),
      now: () => "2026-09-30T12:00:00.000Z",
    });

    const pending = find(SLUG, ID);
    await saving;
    expect(finished).toEqual(["find-lease"]);
    letSaveFinish?.();
    await pending;
  });

  it("feeds a found page into the matched branch and the quote guard, read back from the store (P-3)", async () => {
    const h = harness({
      deltas: [`The page says "The loss scales as a power-law with model size."`],
      lookupReply: FOUND_ANSWER,
      /* What the list reads after step 1: the new lookup attached, as `attachLookups` would. */
      rowsAfter: (finds) => {
        const lookup = finds.at(-1)?.lookup;
        return [work(lookup ? { lookup } : {})];
      },
    });
    const { error, text } = await drain((await h.investigate(SLUG, ID, null)).stream());
    expect(error).toBeNull();
    expect(text).toContain("The loss scales as a power-law with model size");
    const second = secondPart(h.runs);
    expect(second).toContain("A first check matched one search result to this work:");
    expect(second).toContain(`URL: ${PAPER_PAGE.url}`);
    expect(h.saved[0]?.matchedHost).toBe("arxiv.org");
  });

  it("without the re-read, the found page would not be matched — the control for the case above", async () => {
    const h = harness({
      deltas: ["An answer."],
      lookupReply: FOUND_ANSWER,
      rowsAfter: [work()],
    });
    await drain((await h.investigate(SLUG, ID, null)).stream());
    const second = secondPart(h.runs);
    expect(second).toContain("No search result has been matched to this work.");
  });

  it("on no match, yields the no-match body and goes on unconfirmed (P-5)", async () => {
    const h = harness({ deltas: ["An answer."], lookupReply: NO_MATCH_ANSWER });
    const { events, error } = await drain((await h.investigate(SLUG, ID, null)).stream());
    expect(error).toBeNull();
    const frame = events.find((e) => e.type === "lookup");
    expect(frame?.type === "lookup" ? frame.response : null).toEqual({
      outcome: "no-match",
      message: CITATION_LOOKUP_NO_MATCH,
    });
    expect(h.savedFinds).toHaveLength(0);
    expect(h.runs).toHaveLength(1);
    expect(h.saved[0]?.matchedHost).toBeNull();
    const second = secondPart(h.runs);
    expect(second).toContain("No search result has been matched to this work.");
  });

  it("keeps an older code-identified match when a later quick check finds no page (260930d review, C-2 overruled)", async () => {
    const unreadable = { ...LOOKUP, state: "unreadable" as const } as CitationLookup;
    const oldFind: CitationFind = {
      url: PAPER_PAGE.url,
      host: "arxiv.org",
      searches: 1,
      model: "m",
      at: unreadable.at,
      lookup: unreadable,
    };
    const h = harness({
      deltas: ["An answer."],
      lookup: unreadable,
      find: oldFind,
      lookupReply: NO_MATCH_ANSWER,
      rowsAfter: (_saved, removed) => [work(removed.includes(unreadable.at) ? {} : { lookup: unreadable })],
    });

    const { error } = await drain((await h.investigate(SLUG, ID, null)).stream());

    expect(error).toBeNull();
    /* Look it up never deleted a find on a no-match, and the merged press does
       not either: that page passed code's identity check, and one search that
       came back empty is not evidence against it. */
    const second = secondPart(h.runs);
    expect(second).toContain("A first check matched one search result to this work:");
  });
});

describe("step 1, the lookup — when it fails (P-5)", () => {
  it.each([
    ["a refused call", new ProviderRefused(429, "busy", new Headers())],
    ["the network", new TypeError("fetch failed")],
    ["a body cut off mid-read", new TypeError("terminated")],
    ["an answer that did not finish", lookupAnswer({ finish: "length" })],
  ] as const)("stops the press on %s, and spends nothing more", async (_what, reply) => {
    const h = harness({ deltas: ["An answer."], lookupReply: reply });
    const { events, error } = await drain((await h.investigate(SLUG, ID, null)).stream());
    expect((error as Error).message).toMatch(/\[cite-lookup-failed\]$/);
    expect(h.runs, "the second, dearer call was made").toHaveLength(0);
    expect(types(events)).toEqual(["stage:finding"]);
    expect(h.saved).toHaveLength(0);
    expect(h.finished).toEqual(["lease-1"]);
  });

  it("stops the press on its deadline", async () => {
    const h = harness({ deltas: ["An answer."] });
    const slow = makeInvestigateCitation({
      ...h.deps,
      lookupTimeoutMs: 5,
      lookupCall: (_body, { signal }) =>
        new Promise<JsonCall>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    });
    const { error } = await drain((await slow(SLUG, ID, null)).stream());
    expect((error as Error).message).toMatch(/\[cite-lookup-failed\]$/);
    expect(h.runs).toHaveLength(0);
  });

  it("fails the press on a store failure, not as a provider failure", async () => {
    const broken = new Error("connection to the database was lost");
    const h = harness({
      deltas: ["An answer."],
      lookupReply: FOUND_ANSWER,
      saveFind: async () => {
        throw broken;
      },
    });
    const { events, error } = await drain((await h.investigate(SLUG, ID, null)).stream());
    expect(error).toBe(broken);
    expect(events.some((e) => e.type === "lookup"), "a lookup frame for a find that was not stored").toBe(false);
    expect(h.runs).toHaveLength(0);
    expect(h.finished).toEqual(["lease-1"]);
  });

  it.each(["fetch failed", "terminated"])(
    "does not mistake a store TypeError(%s) for undici failing the provider call",
    async (message) => {
      const broken = new TypeError(message);
      const h = harness({
        deltas: ["An answer."],
        lookupReply: FOUND_ANSWER,
        saveFind: async () => {
          throw broken;
        },
      });
      const { error } = await drain((await h.investigate(SLUG, ID, null)).stream());
      expect(error).toBe(broken);
      expect(h.runs).toHaveLength(0);
      expect(h.finished).toEqual(["lease-1"]);
    },
  );

  it("fails the press on a bug in the call, rather than calling it the provider's", async () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'choices')");
    const h = harness({ deltas: ["An answer."], lookupReply: bug });
    const { error } = await drain((await h.investigate(SLUG, ID, null)).stream());
    expect(error).toBe(bug);
    expect(h.runs).toHaveLength(0);
  });
});

describe("between the steps: the list is read again (P-3)", () => {
  it("does not skip the lookup when the assessed reading is no longer current at the re-read", async () => {
    const find = { url: "https://arxiv.org/abs/2001.08361", host: "arxiv.org", searches: 1, model: "m", at: "x", lookup: LOOKUP };
    const h = harness({
      deltas: ["An answer."],
      lookup: LOOKUP,
      find,
      lookupReply: FOUND_ANSWER,
      rowsAfter: (finds) => {
        const replacement = finds.at(-1)?.lookup;
        return [work(replacement ? { lookup: replacement } : {})];
      },
    });
    const { events, error } = await drain((await h.investigate(SLUG, ID, null)).stream());
    expect(error).toBeNull();
    expect(h.lookupCalls).toHaveLength(1);
    expect(types(events)).toEqual(["stage:finding", "lookup", "stage:reading", "delta", "done"]);
    expect(secondPart(h.runs)).toContain("A first check matched one search result to this work:");
  });

  it("sends the why the list has after step 1, not the one it had at the press", async () => {
    const h = harness({
      deltas: ["An answer."],
      rowsAfter: [work({ why: "A different use, written by the list made again." })],
    });
    await drain((await h.investigate(SLUG, ID, null)).stream());
    const second = secondPart(h.runs);
    expect(second).toContain("What the article uses it for: A different use, written by the list made again.");
    expect(second).not.toContain("The curve the piece extrapolates from.");
  });

  it("reads again even when step 1 was skipped", async () => {
    const find = { url: "https://arxiv.org/abs/2001.08361", host: "arxiv.org", searches: 1, model: "m", at: "x", lookup: LOOKUP };
    const h = harness({
      deltas: ["An answer."],
      lookup: LOOKUP,
      find,
      rowsAfter: [work({ lookup: LOOKUP, why: "Changed meanwhile." })],
    });
    await drain((await h.investigate(SLUG, ID, null)).stream());
    expect(h.lookupCalls).toHaveLength(0);
    const second = secondPart(h.runs);
    expect(second).toContain("What the article uses it for: Changed meanwhile.");
  });

  it("stops, spending nothing more, when the work is no longer on the list", async () => {
    const h = harness({ deltas: ["An answer."], rowsAfter: [] });
    const { events, error } = await drain((await h.investigate(SLUG, ID, null)).stream());
    expect((error as Error).message).toMatch(/\[cite-gone\]$/);
    expect(types(events)).toEqual(["stage:finding", "lookup"]);
    expect(h.runs).toHaveLength(0);
    expect(h.saved).toHaveLength(0);
    expect(h.finished).toEqual(["lease-1"]);
  });
});

/* ------------------------------------------------ High-powered AI (260930f) -- */

describe("High-powered AI — both of the press's calls follow the article (Sol F4)", () => {
  const HIGH = { ...ARTICLE, highPowerSince: "2026-09-30T00:00:00.000Z" } as unknown as Article;

  it("sends Opus for the reading and for the nested find-first lookup, on an administrator's article", async () => {
    const h = harness({ deltas: ["An answer."], article: HIGH });
    await runAsOwner(ADMIN_USER_ID_LOCAL as OwnerId, async () => {
      await drain((await h.investigate(SLUG, ID, null)).stream());
    });
    expect(h.lookupCalls[0]?.model).toBe(HIGH_POWER_MODEL_OPENROUTER);
    expect((h.runs[0]?.request as unknown as { model: string }).model).toBe(HIGH_POWER_MODEL_OPENROUTER);
  });

  it("sends Sonnet for the same article when its owner is not an administrator", async () => {
    const h = harness({ deltas: ["An answer."], article: HIGH });
    await runAsOwner(DEV_OWNER_ID, async () => {
      await drain((await h.investigate(SLUG, ID, null)).stream());
    });
    expect(h.lookupCalls[0]?.model).toBe(CAPABLE_MODEL_OPENROUTER);
    expect((h.runs[0]?.request as unknown as { model: string }).model).toBe(CAPABLE_MODEL_OPENROUTER);
  });
});
