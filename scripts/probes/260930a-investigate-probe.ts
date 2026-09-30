/**
 * **Stage-1 gate probe for Citations' *Investigate*** —
 * docs/plans/260930a-citations-investigate-one-work-on-demand.md § Stages,
 * step 1. A measurement, not the build: nothing here is imported by `src/`.
 *
 *   npx tsx scripts/probes/260930a-investigate-probe.ts list
 *   npx tsx scripts/probes/260930a-investigate-probe.ts maxchars
 *   npx tsx scripts/probes/260930a-investigate-probe.ts run <slug>:<id>[:p] ...
 *
 * `list` prints the local articles that have a citations list (READ only).
 * `maxchars` sends one tiny request with `max_characters` on the search tool
 * to see whether OpenRouter accepts it under `require_parameters`.
 * `run` makes ONE streamed chat-wire call per `<slug>:<id>`, with the whole
 * article cached first and the work second; a trailing `:p` adds a made-up
 * reader profile. Writes docs/plans/260930a-probe-results.md.
 *
 * Paid calls go through `openRouterStream` under the existing **`explain`**
 * job (its route: Anthropic pinned, `require_parameters`) — the
 * `citation-investigate` job does not exist yet. No spend collector is open,
 * so no ledger row is written (ai-spend.ts warns once per call); the cost is
 * read from the stream's own `usage.cost`.
 *
 * Budget: stops before a call once $1.50 has been spent, and stops after any
 * call that cost more than $0.30.
 */
import { writeFileSync } from "node:fs";
import { loadEnvLocal } from "../../src/env.js";
import { environmentOwnerId, runAsOwner } from "../../src/owner.js";
import { listArticles, loadArticle, loadCitations } from "../../src/store/index.js";
import { closeDb } from "../../src/db/client.js";
import { modelFor } from "../../src/models.js";
import { openRouterStream, classifyEnd } from "../../src/ai-call.js";
import {
  type StreamEnd,
  type Usage,
  whereSearchCountCameFrom,
} from "../../src/openrouter-stream.js";
import { articleWithIds, type OpenRouterMessage } from "../../src/article-prompt.js";
import { profileSection, renderProfile } from "../../src/profile.js";
import { findQuote } from "../../src/quote-match.js";
import type { Block, CitedWork } from "../../src/types.js";
import { INVESTIGATE_SYSTEM } from "./260930a-investigate-prompt.js";

const MAX_TOTAL_RESULTS = 8;
const MAX_RESULTS = 5;
const PASSAGE_CAP = 1_200;
const PASSAGES = 3;
const TIMEOUT_MS = 120_000;
const BUDGET = 1.5;
const PER_CALL_STOP = 0.3;

const PROFILE = renderProfile({
  profile:
    "Postdoc in cognitive science; comfortable with statistics and ML basics, not a specialist in this field.",
  purpose: "Deciding whether to cite this piece in a review, so I care about how solid its sources are.",
});

function tool(extra: Record<string, unknown> = {}) {
  return {
    type: "openrouter:web_search",
    parameters: {
      engine: "exa",
      max_total_results: MAX_TOTAL_RESULTS,
      max_results: MAX_RESULTS,
      ...extra,
    },
  };
}

function citingPassages(work: CitedWork, blocks: Block[]): string[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const ids = [work.firstCited, ...work.citedAt.filter((id) => id !== work.firstCited)];
  const out: string[] = [];
  for (const id of ids) {
    const b = byId.get(id);
    if (!b) continue;
    out.push(b.text.slice(0, PASSAGE_CAP));
    if (out.length >= PASSAGES) break;
  }
  return out;
}

function workPart(work: CitedWork, blocks: Block[], profile: string | null): string {
  const lines = [`=== THE WORK TO LOOK INTO ===`, ``, `Title: ${work.title}`];
  if (work.authors) lines.push(`Authors: ${work.authors}`);
  if (work.year) lines.push(`Year: ${work.year}`);
  if (work.reference) lines.push(`The article's reference entry: ${work.reference.quote.slice(0, 600)}`);
  if (work.linkFrom !== "search" && work.linkFrom !== "web" && work.url)
    lines.push(`The article's own link for it (${work.linkFrom}): ${work.url}`);
  lines.push(``, `What the article uses it for: ${work.why}`, ``, `Where the article cites it:`);
  for (const p of citingPassages(work, blocks)) lines.push(``, `"""`, p, `"""`);
  const who = profileSection(profile);
  if (who) lines.push(``, who);
  lines.push(``, `Look into this work.`);
  return lines.join("\n");
}

/** Every run of >= 6 words in straight or curly double quotes. */
function quotedRuns(answer: string): string[] {
  const out: string[] = [];
  for (const m of answer.matchAll(/["“]([^"“”]{1,600})["”]/g)) {
    const inner = (m[1] ?? "").trim();
    if (inner.split(/\s+/).filter(Boolean).length >= 6) out.push(inner);
  }
  return out;
}

interface Row {
  label: string;
  linkFrom: string;
  profiled: boolean;
  model: string;
  firstTokenMs: number | null;
  totalMs: number;
  prompt: number | null;
  completion: number | null;
  cached: number | null;
  cacheWrite: number | null;
  searches: number | null;
  searchesFrom: string;
  annotations: number;
  withContent: number;
  contentMin: number | null;
  contentMed: number | null;
  contentMax: number | null;
  cost: number | null;
  finish: string | null;
  outcome: string;
  answerChars: number;
  quotes: string[];
  quotesNotInArticle: string[];
  quotesInAnExtract: number;
  answer: string;
  hosts: string[];
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : Math.round(((s[mid - 1] as number) + (s[mid] as number)) / 2);
}

async function oneCall(slug: string, id: string, profiled: boolean): Promise<Row> {
  const article = await loadArticle(slug);
  const { citations } = await loadCitations(slug);
  const work = citations.citations.find((c) => c.id === id);
  if (!work) throw new Error(`no citation ${id} in ${slug}`);
  const profile = profiled ? PROFILE : null;
  const messages: OpenRouterMessage[] = [
    { role: "system", content: INVESTIGATE_SYSTEM },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Here is the whole article.\n\n${articleWithIds(article.meta, article.blocks)}`,
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: workPart(work, article.blocks, profile) },
      ],
    },
  ];
  const model = modelFor("explain", "standard");
  const request = { model, max_tokens: 1500, tools: [tool()], messages };
  const end: StreamEnd = { terminated: false };
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  const started = Date.now();
  let first: number | null = null;
  let text = "";
  let used = model;
  let usage: (Usage & { cost?: number }) | undefined;
  const annotations = new Map<string, { content: string; title?: string | undefined }>();
  for await (const chunk of openRouterStream("explain", request, {
    signal: deadline,
    onActivity: () => {},
    end,
  })) {
    if (chunk.model) used = chunk.model;
    if (chunk.error) throw new Error(`provider error mid-stream`);
    const d = chunk.choices?.[0]?.delta;
    for (const a of d?.annotations ?? []) {
      const c = a.url_citation;
      if (a.type !== "url_citation" || !c?.url || annotations.has(c.url)) continue;
      annotations.set(c.url, { content: typeof c.content === "string" ? c.content : "", title: c.title });
    }
    if (typeof d?.content === "string" && d.content.length > 0) {
      if (first === null) first = Date.now() - started;
      text += d.content;
    }
    if (chunk.usage) usage = chunk.usage as Usage & { cost?: number };
  }
  const outcome = classifyEnd(end, { signal: undefined, deadline, stalled: new AbortController().signal });
  const counted = whereSearchCountCameFrom(usage);
  const lens = [...annotations.values()].map((a) => a.content.length).filter((n) => n > 0);
  const answer = text.trim();
  const articleText = article.blocks.map((b) => b.text).join("\n\n");
  const quotes = quotedRuns(answer);
  const notInArticle = quotes.filter((q) => !findQuote(articleText, q, undefined, "spaced"));
  const inExtract = notInArticle.filter((q) =>
    [...annotations.values()].some((a) => a.content && findQuote(a.content, q, undefined, "spaced")),
  ).length;
  return {
    label: `${slug.slice(0, 28)} / ${work.title.slice(0, 40)}`,
    linkFrom: work.linkFrom,
    profiled,
    model: used,
    firstTokenMs: first,
    totalMs: Date.now() - started,
    prompt: usage?.prompt_tokens ?? null,
    completion: usage?.completion_tokens ?? null,
    cached: usage?.prompt_tokens_details?.cached_tokens ?? null,
    cacheWrite: usage?.prompt_tokens_details?.cache_write_tokens ?? usage?.cache_write_tokens ?? null,
    searches: counted.searches,
    searchesFrom: usage ? counted.from : "no-usage",
    annotations: annotations.size,
    withContent: lens.length,
    contentMin: lens.length ? Math.min(...lens) : null,
    contentMed: median(lens),
    contentMax: lens.length ? Math.max(...lens) : null,
    cost: typeof usage?.cost === "number" ? usage.cost : null,
    finish: end.finishReason ?? null,
    outcome: outcome.kind,
    answerChars: answer.length,
    quotes,
    quotesNotInArticle: notInArticle,
    quotesInAnExtract: inExtract,
    answer,
    hosts: [...annotations.keys()].map((u) => {
      try {
        return new URL(u).host;
      } catch {
        return "?";
      }
    }),
  };
}

async function maxCharsCheck(): Promise<void> {
  const model = modelFor("explain", "standard");
  const request = {
    model,
    max_tokens: 200,
    tools: [tool({ max_characters: Number(process.env.PROBE_MAX_CHARS ?? 8000) })],
    messages: [
      { role: "system", content: "Answer in one sentence." },
      { role: "user", content: "Search once: what is the arXiv paper 'Attention Is All You Need' about?" },
    ],
  };
  const end: StreamEnd = { terminated: false };
  let usage: (Usage & { cost?: number }) | undefined;
  const lens: number[] = [];
  try {
    for await (const chunk of openRouterStream("explain", request as never, {
      signal: AbortSignal.timeout(60_000),
      onActivity: () => {},
      end,
    })) {
      for (const a of chunk.choices?.[0]?.delta?.annotations ?? [])
        if (a.url_citation?.content) lens.push(a.url_citation.content.length);
      if (chunk.usage) usage = chunk.usage as Usage & { cost?: number };
    }
    console.log(
      `max_characters accepted: finish=${end.finishReason} cost=${usage?.cost} contentLens=${lens.join(",")}`,
    );
  } catch (err) {
    console.log(`max_characters refused: ${(err as Error).name} ${(err as { status?: number }).status ?? ""} ${(err as Error).message}`);
  }
}

function fmt(n: number | null, d = 0): string {
  return n === null ? "—" : n.toFixed(d);
}

function report(rows: Row[], stoppedWhy: string | null): string {
  const lines: string[] = [];
  lines.push(`# 260930a — Investigate probe results`, ``);
  lines.push(
    `Produced by \`scripts/probes/260930a-investigate-probe.ts\` on ${new Date().toISOString().slice(0, 10)}, `
      + `the stage-1 gate in [the plan](260930a-citations-investigate-one-work-on-demand.md). `
      + `Draft prompt: \`scripts/probes/260930a-investigate-prompt.ts\`. Gateway job used: \`explain\` `
      + `(its route; \`citation-investigate\` does not exist yet). Tool: \`openrouter:web_search\`, `
      + `engine exa, max_total_results ${MAX_TOTAL_RESULTS}, max_results ${MAX_RESULTS}. Local articles, read only.`,
    ``,
  );
  if (stoppedWhy) lines.push(`**Stopped early:** ${stoppedWhy}`, ``);
  lines.push(
    `| # | work | link | prof | 1st tok s | total s | prompt | cached | write | out | searches (from) | annots | w/ content | content min/med/max | cost $ | finish | answer ch | quote guard |`,
    `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
  );
  rows.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | ${r.label.replace(/\|/g, "/")} | ${r.linkFrom} | ${r.profiled ? "y" : "n"} | ${fmt(r.firstTokenMs && r.firstTokenMs / 1000, 1)} | ${(r.totalMs / 1000).toFixed(1)} | ${fmt(r.prompt)} | ${fmt(r.cached)} | ${fmt(r.cacheWrite)} | ${fmt(r.completion)} | ${fmt(r.searches)} (${r.searchesFrom}) | ${r.annotations} | ${r.withContent} | ${fmt(r.contentMin)}/${fmt(r.contentMed)}/${fmt(r.contentMax)} | ${fmt(r.cost, 4)} | ${r.finish} / ${r.outcome} | ${r.answerChars} | ${r.quotesNotInArticle.length ? `TRIPPED (${r.quotesNotInArticle.length}; ${r.quotesInAnExtract} in an extract)` : r.quotes.length ? `ok (${r.quotes.length} article quote)` : "ok"} |`,
    );
  });
  const costs = rows.map((r) => r.cost).filter((c): c is number => c !== null);
  const total = costs.reduce((a, b) => a + b, 0);
  lines.push(
    ``,
    `Model: ${[...new Set(rows.map((r) => r.model))].join(", ")}. Total cost $${total.toFixed(4)} over ${rows.length} calls; `
      + `mean $${(total / Math.max(1, costs.length)).toFixed(4)}, max $${Math.max(0, ...costs).toFixed(4)}. `
      + `Mean total latency ${(rows.reduce((a, r) => a + r.totalMs, 0) / Math.max(1, rows.length) / 1000).toFixed(1)} s.`,
    ``,
  );
  lines.push(`## Answers (truncated to ~600 characters)`, ``);
  rows.forEach((r, i) => {
    lines.push(`### ${i + 1}. ${r.label}`, ``);
    lines.push(`Sources: ${r.hosts.join(", ") || "none"}`, ``);
    if (r.quotesNotInArticle.length)
      lines.push(`Quote guard tripped on: ${r.quotesNotInArticle.map((q) => `«${q.slice(0, 160)}»`).join("; ")}`, ``);
    lines.push("```text", r.answer.slice(0, 600) + (r.answer.length > 600 ? " …" : ""), "```", ``);
  });
  return lines.join("\n");
}

async function main(): Promise<void> {
  loadEnvLocal();
  const [mode, ...args] = process.argv.slice(2);
  await runAsOwner(environmentOwnerId(), async () => {
    if (mode === "list") {
      for (const e of await listArticles()) {
        try {
          const { citations } = await loadCitations(e.slug);
          const rows = citations.citations;
          console.log(
            `${e.slug}\t${rows.length}\t${rows.map((c) => `${c.id}:${c.linkFrom}:${c.title.slice(0, 50)}`).slice(0, 12).join(" | ")}`,
          );
        } catch {
          /* no citations list */
        }
      }
      return;
    }
    if (mode === "maxchars") return maxCharsCheck();
    if (mode !== "run") throw new Error("mode: list | maxchars | run");
    const rows: Row[] = [];
    let spent = 0;
    let stopped: string | null = null;
    for (const arg of args) {
      if (spent >= BUDGET) {
        stopped = `budget of $${BUDGET} reached after ${rows.length} calls`;
        break;
      }
      const [slug, id, p] = arg.split(":");
      if (!slug || !id) throw new Error(`bad arg ${arg}`);
      console.log(`→ ${slug} ${id}${p ? " (profiled)" : ""}`);
      const row = await oneCall(slug, id, p === "p");
      rows.push(row);
      spent += row.cost ?? PER_CALL_STOP;
      console.log(
        `  $${row.cost} ${row.totalMs}ms searches=${row.searches}(${row.searchesFrom}) annots=${row.annotations}/${row.withContent} finish=${row.finish} quotes=${row.quotes.length} bad=${row.quotesNotInArticle.length}`,
      );
      writeFileSync("docs/plans/260930a-probe-results.md", report(rows, stopped));
      if ((row.cost ?? 0) > PER_CALL_STOP) {
        stopped = `call ${rows.length} cost $${row.cost} > $${PER_CALL_STOP}`;
        break;
      }
    }
    writeFileSync("docs/plans/260930a-probe-results.md", report(rows, stopped));
    console.log(`spent $${spent.toFixed(4)}${stopped ? ` — ${stopped}` : ""}`);
  });
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
