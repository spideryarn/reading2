/**
 * Eval — is the article actually being cached, and what does that save?
 *
 *   npm run eval:caching -- data/noema-mythology-of-conscious-ai
 *
 * **This one spends money.** Unlike evals/toc-labels.ts, which measures
 * artefacts already on disk, this makes real model calls — that is the whole
 * point of it. Every deterministic thing about prompt caching is already pinned
 * in tests/article-prompt.test.ts: that the cached prefix is byte-identical
 * across calls, that the reader's position stays out of it, that the four
 * batches of a label run share one outline. None of that proves a cache was
 * read. Only the provider can say that, and the only way to ask is to call it
 * twice and look at the number.
 *
 * That gap is the reason this file exists rather than another unit test. A
 * cache that has silently stopped working returns correct answers, raises no
 * error, and shows up as nothing but a larger bill — docs/reusable/silent-success.md.
 * There is also a public report of cache reads sitting at zero through
 * OpenRouter with Claude, so "no error" is specifically not evidence here.
 *
 * **The pass condition is a non-zero read on the second call**, of roughly the
 * article's own size. Anything else is a failure worth reading the output over.
 *
 * Results are committed under `evals/results/` so the next change is compared
 * against a number rather than against somebody's memory. See evals/README.md.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadEnvLocal } from "../src/env.js";
import { articleWithIds, estimateTokens } from "../src/article-prompt.js";
import { findPassages } from "../src/search.js";
import type { Block, Meta } from "../src/types.js";

/**
 * What Sonnet 5 costs, per million tokens, as of 2026-08-26.
 *
 * Written down here rather than imported because there is nowhere in the app
 * that knows prices — the app does not bill anyone. These are for this eval's
 * arithmetic only, and they are the first thing to go stale: check them against
 * the current pricing page before believing a saving printed below.
 * docs/research/prompt-caching-anthropic.md § Pricing.
 */
const PRICE = {
  input: 2.0,
  cacheWrite5m: 2.5,
  cacheRead: 0.2,
};

interface CallResult {
  label: string;
  promptTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  ms: number;
}

function usd(tokens: number, perMillion: number): number {
  return (tokens / 1_000_000) * perMillion;
}

/**
 * What this call cost, and what it would have cost with no caching at all.
 *
 * The comparison is the point. A cached call's `prompt_tokens` still counts the
 * whole prompt, so the raw number looks unchanged and says nothing about
 * whether the cache worked — the saving lives entirely in *which rate* each
 * part was billed at.
 */
function costs(r: CallResult): { actual: number; uncached: number } {
  const read = r.cacheReadTokens ?? 0;
  const write = r.cacheWriteTokens ?? 0;
  const total = r.promptTokens ?? read + write;
  const fresh = Math.max(0, total - read - write);
  return {
    actual: usd(fresh, PRICE.input) + usd(write, PRICE.cacheWrite5m) + usd(read, PRICE.cacheRead),
    uncached: usd(total, PRICE.input),
  };
}

async function loadArticle(dir: string): Promise<{ meta: Meta; blocks: Block[] }> {
  const { blocks } = JSON.parse(await readFile(path.join(dir, "blocks.json"), "utf-8")) as {
    blocks: Block[];
  };
  const meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf-8")) as Meta;
  return { meta, blocks };
}

/**
 * The sequence a reader actually performs, in the order they perform it.
 *
 * Two searches over one article, back to back. The first writes the article
 * into the cache; the second should read it. Search is the call used here
 * because it is the cheapest of the three request-path calls — no web tool, a
 * small answer — and the caching question is identical for all three, since
 * they share one article rendering.
 *
 * A gap is deliberately *not* left between them: the 5-minute TTL is measured
 * from the start of the writing request, and a reader who searches twice does
 * it within seconds.
 */
async function searchTwice(
  meta: Meta,
  blocks: Block[],
  criteria: [string, string],
): Promise<CallResult[]> {
  const out: CallResult[] = [];
  for (const [i, criterion] of criteria.entries()) {
    const started = Date.now();
    const result = await findPassages({ meta, blocks, criterion });
    out.push({
      label: i === 0 ? "search #1 (cold — expect a write)" : "search #2 (warm — expect a read)",
      /* Read back off the log line's own source rather than re-derived here, so
         this eval cannot quietly disagree with what the app reports. */
      promptTokens: result.usage?.promptTokens ?? null,
      cacheReadTokens: result.usage?.cacheReadTokens ?? null,
      cacheWriteTokens: result.usage?.cacheWriteTokens ?? null,
      ms: Date.now() - started,
    });
  }
  return out;
}

function report(dir: string, calls: CallResult[], articleTokens: number): string {
  const lines: string[] = [];
  lines.push(`# Prompt caching — ${path.basename(dir)}`);
  lines.push("");
  lines.push(`Article: about ${articleTokens.toLocaleString()} tokens.`);
  lines.push("");
  lines.push("| call | prompt | cache read | cache write | ms | cost | uncached |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  let actual = 0;
  let uncached = 0;
  for (const c of calls) {
    const { actual: a, uncached: u } = costs(c);
    actual += a;
    uncached += u;
    lines.push(
      `| ${c.label} | ${c.promptTokens ?? "—"} | ${c.cacheReadTokens ?? "—"} | ` +
        `${c.cacheWriteTokens ?? "—"} | ${c.ms} | $${a.toFixed(5)} | $${u.toFixed(5)} |`,
    );
  }
  lines.push("");
  lines.push(
    `**Total: $${actual.toFixed(5)} against $${uncached.toFixed(5)} uncached** — ` +
      `${uncached > 0 ? Math.round((1 - actual / uncached) * 100) : 0}% saved.`,
  );
  lines.push("");

  const cold = calls[0];
  const warm = calls[1];
  const read = warm?.cacheReadTokens ?? 0;

  /* The first call is only "cold" if nothing warmed it. Re-running this eval
     inside the 5-minute TTL of a previous run leaves the entry in place, so call
     one reads too and the totals look better than a first-ever visit would. Said
     out loud because otherwise the saving here reads as the steady-state figure
     when it is the best case. */
  if ((cold?.cacheReadTokens ?? 0) > 0) {
    lines.push(
      "> Note: call #1 read from cache too, so a previous run had already warmed it — " +
        "the TTL is 5 minutes. The saving above is the warm case. For a true cold start, " +
        "wait out the TTL or use an article this eval has not touched.",
    );
    lines.push("");
  }
  /* The verdict, stated rather than left to be inferred from the table. A
     number nobody interprets is how "0" gets read as "fine". */
  if (read > 0) {
    lines.push(
      `**PASS.** The second call read ${read.toLocaleString()} tokens from cache. ` +
        `The article is about ${articleTokens.toLocaleString()}, so the prefix is being reused.`,
    );
  } else {
    lines.push(
      "**FAIL.** The second call read nothing from cache. The prompts are byte-identical " +
        "(tests/article-prompt.test.ts proves that), so the fault is between us and the " +
        "provider: check provider pinning, and that the prefix clears the 1,024-token floor.",
    );
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  loadEnvLocal();
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error("Usage: npm run eval:caching -- <dir with blocks.json + meta.json> [...]");
    console.error("This calls a model and costs money. See evals/README.md.");
    process.exit(1);
  }

  for (const dir of dirs) {
    const { meta, blocks } = await loadArticle(dir);
    const articleTokens = estimateTokens(articleWithIds(meta, blocks));
    console.log(`\n${path.basename(dir)} — about ${articleTokens.toLocaleString()} tokens\n`);

    /* Two criteria that are genuinely different, so nothing but the cache could
       make the second call cheaper. */
    const calls = await searchTwice(meta, blocks, [
      "passages where the author states their main claim",
      "passages that give a concrete example",
    ]);

    const text = report(dir, calls, articleTokens);
    console.log(text);

    await mkdir("evals/results", { recursive: true });
    const out = path.join("evals/results", `prompt-caching-${path.basename(dir)}.md`);
    await writeFile(out, `${text}\n`);
    console.log(`\nWritten to ${out}`);
  }

  /* The bare-text rendering is what arc, tweets and glossary share. Printed
     rather than called, because proving *that* cache needs two pipeline stages
     run back to back — expensive, and worth doing deliberately rather than as a
     side effect of this script. */
  console.log(
    "\nNote: this checks the request-path cache (search / chat / explain).\n" +
      "The pipeline's shared block is `articleText`; to check it, run two of\n" +
      "arc, tweets or glossary back to back on one article and compare their\n" +
      "cacheReadTokens in the pipeline log.",
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { costs, report };
