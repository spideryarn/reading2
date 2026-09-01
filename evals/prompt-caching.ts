/**
 * Eval — is the article actually being cached, and what does that save?
 *
 *   npm run eval:caching -- data/noema-mythology-of-conscious-ai
 *
 * **This one spends money.** Unlike evals/hierarchy-labels.ts, which measures
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
import { converse } from "../src/converse.js";
import { withLedger } from "../src/cli-ledger.js";
import type { Block, ChatMessage, Meta } from "../src/types.js";
import { isMain } from "../src/is-main.js";

/**
 * What Sonnet 5 costs, per million tokens, as of 2026-08-26.
 *
 * Written down here rather than imported because there is nowhere in the app
 * that knows prices — the app does not bill anyone. These are for this eval's
 * arithmetic only, and they are the first thing to go stale: check them against
 * the current pricing page before believing a saving printed below.
 * docs/research/260826b-prompt-caching-anthropic.md § Pricing.
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

/**
 * Two turns of a chat, which is where the cache had quietly stopped working.
 *
 * **This is the call the eval used to claim it made and did not.** The header
 * said "search / chat / explain"; the code called `findPassages` and nothing
 * else. Chat, meanwhile, was the one request path using OpenRouter's automatic
 * breakpoint, and that breakpoint marked the final user message — a message
 * carrying the reader's position, which is prepended per call and never stored,
 * so turn two could not reproduce it and paid a cold write of the whole
 * article. docs/postmortems/260826h-chat-cache-automatic-breakpoint.md.
 *
 * So turn *two* is the measurement here, not turn one. A single chat call tells
 * you nothing this feature needs to know: the bug was invisible on the first
 * turn and total on every one after it.
 *
 * `useTools: false` deliberately. Tools render at position zero, ahead of both
 * system and messages, so a turn that drops them mid-conversation invalidates
 * the whole prefix — a real effect, and one that would show up here as a cache
 * failure that is nothing to do with the article. One variable at a time.
 */
async function chatTwice(slug: string, meta: Meta, blocks: Block[]): Promise<CallResult[]> {
  const out: CallResult[] = [];
  const questions = ["What is this piece arguing?", "And what does it say against that?"];
  const history: ChatMessage[] = [];

  for (const [i, question] of questions.entries()) {
    const started = Date.now();
    let answer = "";
    let usage: CallResult | null = null;
    for await (const event of converse({
      meta,
      blocks,
      history,
      question,
      /* The reader has scrolled, because a reader always has — and it is
         precisely `at` that made the bug fire. Two different blocks across the
         two turns, so a prefix that depends on the position cannot pass by
         standing still. */
      at: blocks[i === 0 ? 0 : Math.min(2, blocks.length - 1)]?.id,
      slug,
      useTools: false,
    })) {
      if (event.type === "delta") answer += event.text;
      if (event.type === "done") {
        usage = {
          label:
            i === 0 ? "chat turn #1 (cold — expect a write)" : "chat turn #2 (warm — expect a read)",
          promptTokens: event.usage.inputTokens,
          cacheReadTokens: event.usage.cacheReadTokens,
          cacheWriteTokens: event.usage.cacheWriteTokens,
          ms: Date.now() - started,
        };
        answer = event.text;
      }
    }
    if (!usage) throw new Error("chat turn ended without a done event");
    out.push(usage);

    /* The history the next turn sends is the history the *app* would send —
       src/routes.ts stores the bare question, not the one with the position
       line on it. Reproducing that here is the whole point: an eval that
       replayed the exact bytes it had sent would have passed against the bug. */
    history.push({ id: `spya-q${i}`, role: "user", text: question, status: "done" } as ChatMessage);
    history.push({
      id: `spya-a${i}`,
      role: "assistant",
      text: answer,
      status: "done",
    } as ChatMessage);
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

  for (let i = 0; i + 1 < calls.length; i += 2) {
    lines.push(...verdict(calls[i]!, calls[i + 1]!, articleTokens));
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Did this pair of calls actually reuse the article? Stated, not left to the table.
 *
 * A pair rather than the whole run, because there are two pairs now — search and
 * chat — and one verdict over four calls would have to pick which pair it meant.
 * Reading a number off row two and calling it "the result" is how chat's failure
 * survived: the eval only ever had one pair, so the code that read `calls[1]`
 * was correct and the header that said it covered three features was not.
 */
function verdict(cold: CallResult, warm: CallResult, articleTokens: number): string[] {
  const lines: string[] = [];
  const read = warm.cacheReadTokens ?? 0;
  lines.push(`### ${warm.label}`);
  lines.push("");

  /* A pair is only "cold" if nothing warmed it. Re-running this eval
     inside the 5-minute TTL of a previous run leaves the entry in place, so call
     one reads too and the totals look better than a first-ever visit would. Said
     out loud because otherwise the saving here reads as the steady-state figure
     when it is the best case. */
  if ((cold.cacheReadTokens ?? 0) > 0) {
    lines.push(
      "> Note: call #1 read from cache too, so a previous run had already warmed it — " +
        "the TTL is 5 minutes. The saving above is the warm case. For a true cold start, " +
        "wait out the TTL or use an article this eval has not touched.",
    );
    lines.push("");
  }
  /* The verdict, stated rather than left to be inferred from the table. A
     number nobody interprets is how "0" gets read as "fine". */
  /* `read > 0` was the old bar and it was too low: the system prompt sits ahead
     of the article in the same prefix, so a hit on that alone would clear it
     while the article — the whole point — missed entirely. The article is the
     bulk of the prefix, so a real reuse reads most of it. GPT Sol's review,
     2026-08-26. */
  const expected = Math.round(articleTokens * 0.8);
  if (read >= expected) {
    lines.push(
      `**PASS.** The second call read ${read.toLocaleString()} tokens from cache, ` +
        `against an article of about ${articleTokens.toLocaleString()} — so it is the ` +
        "article being reused, not just the system prompt in front of it.",
    );
  } else if (read > 0) {
    lines.push(
      `**PARTIAL — treat as a failure.** The second call read ${read.toLocaleString()} ` +
        `tokens, but the article alone is about ${articleTokens.toLocaleString()}, so ` +
        "something ahead of the breakpoint matched and the article did not. That is the " +
        "shape of a per-call value inside the prefix: check what varies between the two " +
        "requests, then tests/article-prompt.test.ts for what is meant to be pinned.",
    );
  } else {
    lines.push(
      "**FAIL.** The second call read nothing from cache. The prompts are byte-identical " +
        "(tests/article-prompt.test.ts proves that), so the fault is between us and the " +
        "provider: check provider pinning, and that the prefix clears the 1,024-token floor.",
    );
  }
  return lines;
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

    const chat = await chatTwice(path.basename(dir), meta, blocks);

    const text = report(dir, [...calls, ...chat], articleTokens);
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
    "\nNote: this checks search and chat. Explain shares their article rendering\n" +
      "and their explicit breakpoint, so it is covered by construction rather\n" +
      "than by a call here — but say so, rather than listing it as checked.\n" +
      "The pipeline's shared block is `articleText`; to check it, run two of\n" +
      "arc, tweets or glossary back to back on one article and compare their\n" +
      "cacheReadTokens in the pipeline log.",
  );
}

const invokedDirectly = isMain(import.meta.url);

if (invokedDirectly) {
  /* See the note at the foot of evals/remember-stances.ts. */
  withLedger("eval", main).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { costs, report };
