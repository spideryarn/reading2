/**
 * **The search step, run once per example and frozen** — plan 261001s §
 * Holding the search step fixed.
 *
 * - glossary and comment: production's `searchFirst` (Luna + Exa, and the
 *   reader's library), aimed exactly as `makeLookUpTerm` and the comment route
 *   aim it, then production's request built by `buildExplainMessages`.
 * - citation: **the production press itself**, `makeInvestigateCitation` with
 *   production's deps, except four seams: a fake allowance (so the shared
 *   database's allowance is not spent), a writer that refuses to save, timing
 *   wrappers round `searchFirst` and `readPaper`, and a `run` that records the
 *   request it is handed and stops. So the forced search, *Look it up* (which
 *   saves its find, as a first press would), the paper read and the passages
 *   call are production's code end to end, and the frozen request is the very
 *   body production would have streamed.
 *
 * What is frozen goes to the gitignored run directory and never into git
 * (Sol F9): it holds web excerpts, paper text and passages from the reader's
 * other articles.
 */
import { createHash } from "node:crypto";
import type { AiRequestBody } from "../../src/ai-call.js";
import { articleWithIds } from "../../src/article-prompt.js";
import {
  investigatePart,
  makeInvestigateCitation,
  readCitedPaper,
} from "../../src/citation-investigate.js";
import {
  investigateContext,
  matchedPageOf,
  type InvestigateContext,
  type MatchedPage,
} from "../../src/citation-investigate-context.js";
import { DIG_ANSWER_TOKENS, DIG_DEEPER_MODEL, type DigFindings, searchFirst } from "../../src/dig-deeper.js";
import { buildExplainMessages, MAX_SEARCHES } from "../../src/explain.js";
import type { StreamRun } from "../../src/stream-run.js";
import { anchorIn } from "../../src/term-lookup.js";
import type { Block, CitationLookupState, Meta } from "../../src/types.js";
import type { Example } from "./examples.js";

export const CAPTURE_VERSION = 1;

/** One shared call of the press, as the ledger recorded it. */
export interface SharedCall {
  job: string;
  model: string;
  answeredBy: string | null;
  usd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  ms: number;
}

export interface Capture {
  version: typeof CAPTURE_VERSION;
  exampleId: string;
  entry: Example["entry"];
  slug: string;
  capturedAt: string;
  commit: string;
  /** sha256 of `articleWithIds(meta, blocks)` — a later run refuses an article that changed. */
  articleSha256: string;
  /** Production's answer request exactly as production builds it: Opus, tools on, 4,000 tokens. */
  production: { job: "dig-deeper" | "citation-investigate"; request: AiRequestBody };
  findings: DigFindings;
  /** glossary and comment: where the press is, and what it asks about. */
  explain?: { blockId: string; quote: string; subject: string; chosenBlockId: string | null };
  /** citation: what the quote guard and the provenance rule need. */
  citation?: {
    context: InvestigateContext;
    matched: MatchedPage | null;
    lookupRan: boolean;
    lookupOutcome: "found" | "no-match" | null;
    /** The lookup just written. Only `assessed` makes production skip it next press. Absent on legacy captures. */
    lookupState?: CitationLookupState | null;
    paperState: string;
    paperRead: boolean;
    paperPassages: number | null;
  };
  /** Wall-clock milliseconds of each shared step, for what the reader waits. */
  timings: { searchMs: number; lookupMs: number | null; paperMs: number | null; passagesMs: number | null };
  /** The shared calls (search, and on Citations *Look it up* and the passages), with their cost. */
  shared: SharedCall[];
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function articleSha(meta: Meta, blocks: readonly Block[]): string {
  return sha256(articleWithIds(meta, blocks));
}

/**
 * **Production's dug explain request**, the body `explainStream` hands
 * `runStream` when `dig` is set (src/explain.ts). tests/dig-deeper-eval.test.ts
 * drives the real `explainStream` with a stubbed fetch and checks this equals
 * what it sent, so the copy cannot drift.
 */
export function productionExplainRequest(
  meta: Meta,
  blocks: Block[],
  blockId: string,
  quote: string,
  findings: DigFindings,
  model: string = DIG_DEEPER_MODEL,
): AiRequestBody {
  return {
    model,
    max_tokens: DIG_ANSWER_TOKENS,
    tools: [{ type: "openrouter:web_search", parameters: { max_uses: MAX_SEARCHES, max_results: 5 } }],
    messages: buildExplainMessages(meta, blocks, blockId, quote, findings, null),
  };
}

/** The store and library, injected so this file imports no database at load. */
export interface CaptureDeps {
  loadArticle(slug: string): Promise<{ meta: Meta; blocks: Block[] }>;
  loadGlossary(slug: string): Promise<{ glossary: { entries: { id: string; name: string; aliases: string[] }[] } }>;
  library: NonNullable<Parameters<typeof searchFirst>[0]["library"]>;
  /** Production's investigate deps (src/store/index.ts § investigateCitationDeps). */
  investigateDeps: Parameters<typeof makeInvestigateCitation>[0];
  loadCitations: Parameters<typeof makeInvestigateCitation>[0]["reader"]["loadCitations"];
  loadFind: Parameters<typeof makeInvestigateCitation>[0]["finds"]["load"];
  commit: string;
}

/** Refuse before spending: every gold block id and the comment's quote must be in the article. */
export function checkExample(example: Example, blocks: readonly Block[]): void {
  const ids = new Set(blocks.map((b) => b.id as string));
  const missing = example.gold.grounded.flatMap((g) => g.blocks).filter((id) => !ids.has(id));
  if (missing.length > 0) throw new Error(`${example.id}: gold block ids not in the article: ${missing.join(", ")}`);
  if (example.entry === "comment") {
    const block = blocks.find((b) => b.id === example.blockId);
    if (!block) throw new Error(`${example.id}: block ${example.blockId} is not in the article`);
    if (!block.text.includes(example.quote)) throw new Error(`${example.id}: the quote is not verbatim in ${example.blockId}`);
  }
  if (example.entry === "glossary" && !ids.has(example.chosenBlockId)) {
    throw new Error(`${example.id}: chosen block ${example.chosenBlockId} is not in the article`);
  }
}

const articleFor = (meta: Meta) => ({ title: meta.title, author: meta.byline, date: meta.publishedAt });

/**
 * Capture one example. **Spends** (the search step; on Citations also *Look
 * it up* and the passages call) — call it inside `paidStep`.
 */
export async function captureExample(example: Example, deps: CaptureDeps): Promise<Omit<Capture, "shared">> {
  const article = await deps.loadArticle(example.slug);
  checkExample(example, article.blocks);
  const base = {
    version: CAPTURE_VERSION,
    exampleId: example.id,
    entry: example.entry,
    slug: example.slug,
    capturedAt: new Date().toISOString(),
    commit: deps.commit,
    articleSha256: articleSha(article.meta, article.blocks),
  } as const;

  if (example.entry === "glossary" || example.entry === "comment") {
    let blockId: string;
    let quote: string;
    let subject: string;
    if (example.entry === "glossary") {
      let entry = { name: example.term, aliases: [] as string[] };
      if (example.entryId) {
        const { glossary } = await deps.loadGlossary(example.slug);
        const stored = glossary.entries.find((e) => e.id === example.entryId);
        if (!stored) throw new Error(`${example.id}: no glossary entry ${example.entryId}`);
        entry = { name: stored.name, aliases: stored.aliases };
      }
      /* `makeLookUpTerm`'s anchor: the first block using the name or an alias. */
      const anchor = anchorIn(entry, article.blocks);
      if (!anchor) throw new Error(`${example.id}: the article never uses "${entry.name}"`);
      blockId = anchor.blockId;
      quote = anchor.quote;
      subject = entry.name;
    } else {
      blockId = example.blockId;
      quote = example.quote;
      subject = example.quote;
    }
    const started = Date.now();
    const findings = await searchFirst({
      slug: example.slug,
      subject,
      article: articleFor(article.meta),
      context: article.blocks.find((b) => b.id === blockId)?.text,
      library: deps.library,
    });
    const searchMs = Date.now() - started;
    return {
      ...base,
      production: {
        job: "dig-deeper",
        request: productionExplainRequest(article.meta, article.blocks, blockId, quote, findings),
      },
      findings,
      explain: { blockId, quote, subject, chosenBlockId: example.entry === "glossary" ? example.chosenBlockId : null },
      timings: { searchMs, lookupMs: null, paperMs: null, passagesMs: null },
    };
  }

  /* ---- a Citations press, production's own, stopped at the stream ---- */
  const STOP = new Error("dig-deeper eval: request captured");
  let captured: StreamRun | null = null;
  let findings: DigFindings | null = null;
  let searchMs = 0;
  let paperMs: number | null = null;
  let paperState = "not-read";
  const stamps: Record<string, number> = {};
  let lookupOutcome: "found" | "no-match" | null = null;
  let lookupState: CitationLookupState | null = null;
  const press = makeInvestigateCitation({
    ...deps.investigateDeps,
    allowance: { take: async () => ({ kind: "allowed", id: "dig-deeper-eval" }), finish: async () => {} },
    investigations: {
      save: async () => {
        throw new Error("dig-deeper eval: capture must never save an investigation");
      },
    },
    searchFirst: async (req) => {
      const t = Date.now();
      try {
        findings = await searchFirst(req);
        return findings;
      } finally {
        searchMs = Date.now() - t;
      }
    },
    readPaper: async (input) => {
      const t = Date.now();
      try {
        const evidence = await readCitedPaper(input);
        paperState = evidence.state;
        return evidence;
      } finally {
        paperMs = Date.now() - t;
      }
    },
    run: (args) => {
      captured = args;
      return (async function* () {
        /* `runStream` starts on the first iteration. Reject there, before any
           answer call, while remaining a real async generator for the seam. */
        yield await Promise.reject(STOP);
      })();
    },
  });
  const run = await press(example.slug, example.entryId, null);
  try {
    for await (const event of run.stream()) {
      if (event.type === "stage") stamps[event.stage] = Date.now();
      if (event.type === "lookup") {
        lookupOutcome = event.response.outcome;
        lookupState = event.response.outcome === "found" ? event.response.lookup.state : null;
      }
    }
    throw new Error(`${example.id}: the press finished without reaching its answer`);
  } catch (err) {
    if (err !== STOP) throw err;
  } finally {
    await run.release();
  }
  const sent = captured as StreamRun | null;
  const found = findings as DigFindings | null;
  if (!sent || !found) throw new Error(`${example.id}: the press stopped before its answer request`);

  /* `prepare()`'s inputs again, to give the guard what production gave it —
     and checked against what production actually sent. */
  const { citations } = await deps.loadCitations(example.slug);
  const row = citations.citations.find((w) => w.id === example.entryId);
  if (!row) throw new Error(`${example.id}: no cited work ${example.entryId}`);
  const { investigation: _earlier, ...work } = row;
  const text = new Map(article.blocks.map((b) => [b.id as string, b.text]));
  const context = investigateContext(work, (id) => text.get(id));
  const matched = matchedPageOf(work, work.lookup ? await deps.loadFind(example.slug, example.entryId) : null);
  const head = investigatePart(context, null, matched).split("\nWhere the article cites it:")[0] ?? "";
  const last = JSON.stringify(sent.request.messages);
  if (!head || !last.includes(JSON.stringify(head).slice(1, -1))) {
    throw new Error(`${example.id}: the work and match re-read after the press differ from what it sent`);
  }
  /* `paperSection` writes one `, the AI's reading: ` per verified passage. */
  const passages = paperState === "read" ? last.split(", the AI's reading: ").length - 1 : null;
  const paperStart = stamps["reading-paper"];
  const readingStart = stamps.reading;
  return {
    ...base,
    production: { job: "citation-investigate", request: sent.request },
    findings: found,
    citation: {
      context,
      matched,
      lookupRan: lookupOutcome !== null,
      lookupOutcome,
      lookupState,
      paperState,
      paperRead: paperState === "read",
      paperPassages: passages,
    },
    timings: {
      searchMs,
      lookupMs: stamps.finding && paperStart ? paperStart - stamps.finding : null,
      paperMs,
      passagesMs: paperStart && readingStart && paperMs !== null ? Math.max(0, readingStart - paperStart - paperMs) : null,
    },
  };
}
