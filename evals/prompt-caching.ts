/**
 * Eval — is the article actually being cached, and what does that save?
 *
 *   npm run eval:caching -- <slug> [<slug>...] [--wire=chat|messages|both]
 *
 * The article is read from the store (Postgres), by slug, as the owner in
 * `SPIDERYARN_OWNER_ID` — the `data/<slug>` folders this used to read no longer
 * exist for real articles. `--wire` defaults to `both`.
 *
 * **This one spends money.** Unlike evals/structure-labels.ts, which measures
 * artefacts already stored, this makes real model calls — that is the whole
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
 * ## The two wires, and what each arm checks
 *
 * **Chat wire** (`--wire=chat`): search twice, then two chat turns — the
 * request-path calls. Pass: the second call of each pair reads roughly the
 * article's own size.
 *
 * **Messages wire** (`--wire=messages`): the pipeline's wire. It calls the REAL
 * stage functions the pipeline's `STEPS` entries call. First it calls
 * `generateQuotes` at another effort as a negative control. Then it calls
 * `generateGlossary` and `generateQuotes`, one cache group (same renderer,
 * same effort), one after the other on one article, with `cacheArticle: true`
 * forced. Running the control first establishes that its own key was cold; a
 * read on either intended-cold call makes the run inconclusive rather than
 * pretending an entry left by somebody else says anything about this run.
 * `SPIDERYARN_PIPELINE_EFFORT` is set only around the control and restored.
 * Usage and cost come off the `ai_calls` ledger rows each call writes
 * (`collectSpend`), not off the stage's own return value.
 *
 * Cold-start honesty without touching the request bytes: both the control and
 * glossary must WRITE and read zero. If either reads, a previous run may have
 * warmed that key, and the arm is reported WARM, INCONCLUSIVE — never PASS.
 * PASS needs quotes to read exactly what glossary wrote. A positive write is
 * the provider's evidence that the prefix cleared the serving model's floor;
 * the floor is model-specific, so this eval does not hard-code Sonnet's 1,024.
 *
 * **What the Messages arm checks**: the wire, and the two stages' byte layout
 * (that glossary and quotes really do send the same prefix up to the
 * breakpoint). **What it does NOT check: the job wiring** — whether a real job
 * sets `cacheArticle` to `true` for both members of a same-group pair. This
 * forces the flag. That is tests/article-cache-call-site.test.ts, which walks
 * real jobs through `advanceJobWith` and reads the `StepContext` each step is
 * handed. docs/plans/261001l-prompt-caching-across-every-call.md § Stage 1.
 *
 * Results are committed under `evals/results/` so the next change is compared
 * against a number rather than against somebody's memory. See evals/README.md.
 */

import { writeFile, mkdir } from "node:fs/promises";
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
    const result = await findPassages({ power: "standard", meta, blocks, criterion });
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
    for await (const event of converse({ power: "standard",
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

function report(calls: CallResult[], articleTokens: number): string {
  const lines: string[] = [];
  lines.push("## Chat wire — search and chat");
  lines.push("");
  lines.push(`Article as \`articleWithIds\` renders it: about ${articleTokens.toLocaleString()} tokens.`);
  lines.push("Costs in this table are computed from the list prices above, not read off the ledger.");
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

/**
 * One Messages-wire call, as the ledger recorded it.
 *
 * Read off the `ai_calls` row (`SpendRecord`) rather than off the stage's own
 * return value, so this eval reads the same numbers the cost report does. A
 * stage that made more than one call (a retry) shows its first and says how
 * many there were, and the verdict fails rather than treating that selected row
 * as the whole measurement.
 */
export interface WireCall {
  label: string;
  effort: string;
  /** Rows for the expected job. The verdict requires exactly one. */
  calls: number;
  /** In-flight calls when the collector closed. Any makes the measurement incomplete. */
  pending: number;
  /** Calls whose ledger sink failed. The in-memory row remains, but the claim "from the ledger" does not. */
  writeFailures: number;
  /** Rows attributed to another job inside this supposedly single-stage measurement. */
  otherCalls: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costUsd: number | null;
  upstream: string | null;
  ms: number;
}

async function messagesArm(slug: string): Promise<{ calls: WireCall[]; articleTokens: number }> {
  const { loadArticle } = await import("../src/store/index.js");
  const { environmentOwnerId, runAsOwner } = await import("../src/owner.js");
  const { collectSpend, totalSpend } = await import("../src/ai-spend.js");
  const { costStore } = await import("../src/store/ai-calls.js");
  const { generateGlossary } = await import("../src/glossary.js");
  const { generateQuotes } = await import("../src/quotes.js");
  const { articleText } = await import("../src/article-prompt.js");
  const { isBodyEvidence } = await import("../src/block-policy.js");
  const { effortFor } = await import("../src/models.js");

  const owner = environmentOwnerId();
  return runAsOwner(owner, async () => {
    const stored = await loadArticle(slug);
    /* The reader-facing store view, shaped into the Article the stage functions
       accept. This is not byte-for-byte production's `readArticle`: loadArticle
       applies a shelf title override to `meta`, while a pipeline draft reads the
       extracted metadata. Both stages get this one object, so the cross-stage
       byte-layout question this arm asks is still exact; it does not claim to
       snapshot every byte a particular production job sent. */
    const article = { slug, blocks: stored.blocks, tree: stored.tree, meta: stored.meta ?? null };
    const articleTokens = estimateTokens(articleText(article.meta, article.blocks.filter(isBodyEvidence)));

    const measure = async (
      label: string,
      job: "glossary" | "quotes",
      run: () => Promise<unknown>,
    ): Promise<WireCall> => {
      const effort = effortFor(job);
      const started = Date.now();
      const { report } = await collectSpend(run, {
        attribution: { scopeKind: "eval", ownerId: owner, articleSlug: slug },
        sink: (row) => costStore.record(row),
      });
      const mine = report.calls.filter((c) => c.job === job);
      const otherCalls = report.calls.length - mine.length;
      const first = mine[0];
      if (!first) throw new Error(`${label}: the ledger recorded no ${job} call`);
      /* Cost is every call the stage made, even though the token columns retain
         the first row so a future retry cannot manufacture a plausible aggregate
         cache ratio. The verdict below refuses multiple or unexpected rows. */
      const { nanos, unpriced } = totalSpend(report.calls);
      return {
        label,
        effort,
        calls: mine.length,
        pending: report.pending.length,
        writeFailures: report.writeFailures,
        otherCalls,
        inputTokens: first.inputTokens ?? 0,
        cacheReadTokens: first.cacheReadTokens ?? 0,
        cacheWriteTokens: first.cacheWriteTokens ?? 0,
        outputTokens: first.outputTokens ?? 0,
        costUsd: unpriced > 0 ? null : nanos / 1e9,
        upstream: first.upstream,
        ms: Date.now() - started,
      };
    };

    /* `previous: null` and no profile: a first pass, the shape an article with
       neither artefact gets. Nothing here writes either artefact back. */
    const glossary = () =>
      generateGlossary({ article, previous: null, profile: null, power: "standard", cacheArticle: true });
    const quotes = () =>
      generateQuotes({ article, previous: null, profile: null, power: "standard", cacheArticle: true });

    const calls: WireCall[] = [];
    /* The negative control goes first so its own key has to establish a cold
       write. If it read an entry left by another run, the verdict is honestly
       inconclusive rather than calling a working effort split broken. */
    const before = process.env.SPIDERYARN_PIPELINE_EFFORT;
    const controlEffort = effortFor("quotes") === "high" ? "low" : "high";
    process.env.SPIDERYARN_PIPELINE_EFFORT = controlEffort;
    try {
      calls.push(
        await measure(
          `quotes at effort ${controlEffort} (cold control — expect a write, no read)`,
          "quotes",
          quotes,
        ),
      );
    } finally {
      if (before === undefined) delete process.env.SPIDERYARN_PIPELINE_EFFORT;
      else process.env.SPIDERYARN_PIPELINE_EFFORT = before;
    }
    calls.push(await measure("glossary (cold — expect a write, no read)", "glossary", glossary));
    calls.push(await measure("quotes (same group — expect an exact read)", "quotes", quotes));
    return { calls, articleTokens };
  });
}

type Verdict = "PASS" | "FAIL" | "WARM, INCONCLUSIVE";

/**
 * The Messages arm's verdict, stated. Three calls, three conditions, and a
 * cold start that has to be shown rather than assumed.
 */
export function messagesVerdict([control, cold, warm]: WireCall[]): { verdict: Verdict; why: string[] } {
  if (!control || !cold || !warm) return { verdict: "FAIL", why: ["fewer than three calls were measured"] };

  const accounting = [control, cold, warm].flatMap((call) => {
    const problems: string[] = [];
    if (call.calls !== 1) problems.push(`${call.label}: ${call.calls} matching ledger rows (want exactly 1)`);
    if (call.otherCalls !== 0) problems.push(`${call.label}: ${call.otherCalls} unexpected other-job rows`);
    if (call.pending !== 0) problems.push(`${call.label}: ${call.pending} call(s) still pending when collection closed`);
    if (call.writeFailures !== 0) problems.push(`${call.label}: ${call.writeFailures} ledger write failure(s)`);
    return problems;
  });
  if (accounting.length > 0) return { verdict: "FAIL", why: accounting };

  const warmed = [control, cold].filter((call) => call.cacheReadTokens > 0);
  if (warmed.length > 0) {
    return {
      verdict: "WARM, INCONCLUSIVE",
      why: [
        `${warmed.map((call) => `${call.label} read ${call.cacheReadTokens.toLocaleString()} tokens`).join("; ")} ` +
          "on a call that was meant to establish a cold key. An earlier run or real job may have warmed it, " +
          "so this run cannot attribute the later read or test the effort split. Wait out the TTL, or use another article.",
      ],
    };
  }
  const why: string[] = [];
  let ok = true;
  for (const writer of [control, cold]) {
    if (writer.cacheWriteTokens <= 0) {
      ok = false;
      why.push(
        `${writer.label} wrote no cache tokens: the breakpoint was not sent, the prefix is below the serving ` +
          "model's floor, or the provider did not create an entry.",
      );
    } else {
      why.push(
        `${writer.label} wrote ${writer.cacheWriteTokens.toLocaleString()} tokens and read none — a true cold start.`,
      );
    }
  }
  if (
    cold.cacheWriteTokens > 0 &&
    warm.cacheReadTokens === cold.cacheWriteTokens &&
    warm.cacheWriteTokens === 0
  ) {
    why.push(
      `quotes read exactly the ${warm.cacheReadTokens.toLocaleString()} tokens glossary wrote — ` +
        "the two stages send the same prefix and the wire reused it.",
    );
  } else {
    ok = false;
    why.push(
      `quotes read ${warm.cacheReadTokens.toLocaleString()} and wrote ${warm.cacheWriteTokens.toLocaleString()}, ` +
        `against glossary's ${cold.cacheWriteTokens.toLocaleString()}-token write (want an exact read and no write). ` +
        "Zero means the bytes differ before the breakpoint or the provider did not reuse the entry; a partial " +
        "read means only an earlier prefix matched.",
    );
  }
  if (control.cacheWriteTokens > 0 && cold.cacheWriteTokens > 0)
    why.push(`the cold writes at efforts ${control.effort} and ${cold.effort} establish two separate cache keys.`);
  return { verdict: ok ? "PASS" : "FAIL", why };
}

function messagesReport(calls: WireCall[], articleTokens: number): { text: string; verdict: Verdict } {
  const lines: string[] = [];
  lines.push("## Messages wire — cold effort control, then glossary and quotes");
  lines.push("");
  lines.push(
    "The real stage functions (`generateGlossary`, `generateQuotes`) with `cacheArticle: true` forced. " +
      `Article as \`articleText\` renders it: about ${articleTokens.toLocaleString()} tokens. ` +
      "Tokens and cost are read off the `ai_calls` ledger rows.",
  );
  lines.push("");
  lines.push("**Checks** the Messages wire and the two stages' byte layout. **Does not check** the job wiring");
  lines.push("that decides `cacheArticle` — that is tests/article-cache-call-site.test.ts.");
  lines.push("");
  lines.push("| call | effort | input (uncached) | cache read | cache write | output | cost | provider | ms |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---|---:|");
  let total = 0;
  let priced = true;
  for (const c of calls) {
    if (c.costUsd === null) priced = false;
    else total += c.costUsd;
    lines.push(
      `| ${c.label}${c.calls !== 1 ? ` (${c.calls} matching calls; first shown)` : ""} | ${c.effort} | ${c.inputTokens} | ` +
        `${c.cacheReadTokens} | ${c.cacheWriteTokens} | ${c.outputTokens} | ` +
        `${c.costUsd === null ? "unpriced" : `$${c.costUsd.toFixed(4)}`} | ${c.upstream ?? "—"} | ${c.ms} |`,
    );
  }
  lines.push("");
  lines.push(
    `**Spent on this arm: ${priced ? `$${total.toFixed(4)}` : `at least $${total.toFixed(4)} (some calls unpriced)`}.**`,
  );
  lines.push("");
  const { verdict, why } = messagesVerdict(calls);
  lines.push(`### Verdict: **${verdict}**`);
  lines.push("");
  for (const w of why) lines.push(`- ${w}`);
  return { text: lines.join("\n"), verdict };
}

type Wire = "chat" | "messages" | "both";

async function main(): Promise<void> {
  loadEnvLocal();
  const args = process.argv.slice(2);
  const wireArg = args.find((a) => a.startsWith("--wire="))?.slice("--wire=".length) ?? "both";
  if (wireArg !== "chat" && wireArg !== "messages" && wireArg !== "both") {
    console.error(`--wire must be chat, messages or both, not ${wireArg}`);
    process.exit(1);
  }
  const wire: Wire = wireArg;
  /* A path is reduced to its last segment, so the old `data/<slug>` spelling
     still names the article — which is read from the store either way. */
  const slugs = args.filter((a) => !a.startsWith("--")).map((a) => path.basename(a));
  if (slugs.length === 0) {
    console.error("Usage: npm run eval:caching -- <slug> [...] [--wire=chat|messages|both]");
    console.error("This calls a model and costs money. See evals/README.md.");
    process.exit(1);
  }

  const { loadArticle } = await import("../src/store/index.js");
  const { environmentOwnerId, runAsOwner } = await import("../src/owner.js");
  /* No `closeDb` here: `withLedger` writes the chat arm's ledger rows after
     `main` returns, and a closed pool would simply be reopened by that write.
     An idle pool lets the process exit on its own. */
  let failed = false;
  for (const slug of slugs) {
    const runAt = new Date();
    const sections: string[] = [`# Prompt caching — ${slug}`, "", `Run ${runAt.toISOString()}.`, ""];

    if (wire !== "messages") {
      const { meta, blocks } = await runAsOwner(environmentOwnerId(), () => loadArticle(slug));
      const articleTokens = estimateTokens(articleWithIds(meta, blocks));
      console.log(`\n${slug} — chat wire, about ${articleTokens.toLocaleString()} tokens\n`);

      /* Two criteria that are genuinely different, so nothing but the cache
         could make the second call cheaper. */
      const calls = await searchTwice(meta, blocks, [
        "passages where the author states their main claim",
        "passages that give a concrete example",
      ]);
      const chat = await chatTwice(slug, meta, blocks);
      const text = report([...calls, ...chat], articleTokens);
      console.log(text);
      sections.push(text, "");
    }

    if (wire !== "chat") {
      console.log(`\n${slug} — Messages wire: cold effort control, glossary, quotes\n`);
      const { calls, articleTokens } = await messagesArm(slug);
      const { text, verdict } = messagesReport(calls, articleTokens);
      console.log(text);
      sections.push(text, "");
      if (verdict !== "PASS") failed = true;
    }

    await mkdir("evals/results", { recursive: true });
    const stamp = runAt.toISOString().replaceAll(":", "-").replaceAll(".", "-");
    const out = path.join("evals/results", `prompt-caching-${slug}-${stamp}.md`);
    await writeFile(out, `${sections.join("\n")}\n`, { flag: "wx" });
    console.log(`\nWritten to ${out}`);
  }

  if (wire !== "messages") {
    console.log(
      "\nNote: the chat arm checks search and chat. Explain shares their article\n" +
        "rendering and their explicit breakpoint, so it is covered by construction\n" +
        "rather than by a call here — but say so, rather than listing it as checked.",
    );
  }
  if (failed) process.exitCode = 1;
}

const invokedDirectly = isMain(import.meta.url);

if (invokedDirectly) {
  /* See the note at the foot of evals/learn-recall.ts. */
  withLedger("eval", main).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { costs, report };
