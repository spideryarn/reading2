/**
 * **Does Ask about Spideryarn answer from the Help, refuse the rest, and what
 * does a question cost?** — plan docs/plans/261007k-help-chatbot.md, Stage 3.
 * Write-up: docs/investigations/261007a-help-chat-model-and-refusals.md.
 *
 * ```
 * npx tsx evals/help-chat/run.ts --arm luna                                  # PAID: every question on HELP_CHAT_MODEL
 * npx tsx evals/help-chat/run.ts --arm deepseek --model deepseek/deepseek-v4.1-flash
 * npx tsx evals/help-chat/run.ts --arm luna-idle-8min --only a01,o01         # after a quiet spell, to see the cache expire
 * npx tsx evals/help-chat/run.ts --arm luna-24h --only a01 --retention 24h   # OpenAI's extended retention, eval body only
 * npx tsx evals/help-chat/run.ts --arm probe-default --only a01 --nonce A    # a prefix nobody has warmed (see the write-up)
 * ```
 *
 * **Production's own request**: `helpChatRequest` (src/help-chat-call.ts), the
 * body `askHelp` sends, through `runStream` as job `help-chat`, so the route's
 * provider policy, the reasoning setting and the ceiling are the reader's.
 * Only `model` is swapped for the candidate arm. Nothing here is a copy of the
 * prompt. The call goes through the gateway inside `withLedger("eval", …)`, so
 * every call is a ledger row and `npm run cost` sees it; nothing is declared
 * because nothing bypasses the gateway.
 *
 * **What is read off the wire, watching rather than bypassing**: `fetch` is
 * wrapped and the streamed response is cloned, so the upstream provider
 * OpenRouter names in each chunk and the final usage (prompt tokens, cached
 * tokens, cache writes, cost) are recorded per call. Time to first token and
 * total time are this script's own clock.
 *
 * Questions run one after another in the order of ./questions.ts, so call 1 is
 * the cold one for a fresh prefix and calls 2..n are what the cache does across
 * different questions.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { withLedger } from "../../src/cli-ledger.js";
import { HELP_CHAT_STALL_MS, HELP_CHAT_SYSTEM, HELP_CHAT_TIMEOUT_MS, HELP_CHAT_VERSION, helpChatRequest } from "../../src/help-chat-call.js";
import corpus from "../../src/help-corpus.generated.json" with { type: "json" };
import { loadEnvLocal } from "../../src/env.js";
import { runStream } from "../../src/stream-run.js";
import { QUESTIONS } from "./questions.js";

loadEnvLocal();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(HERE, "results", "261007a");
/** Stop if one run has spent more than this. A whole arm is a few cents. */
const BUDGET_USD = 0.6;

const ADDRESSES = new Set<string>(["/help", ...(corpus as { href: string }[]).map((p) => p.href)]);

export interface Row {
  arm: string;
  id: string;
  kind: string;
  prompt: string;
  systemSha: string;
  model: string;
  answeredBy: string;
  provider: string | null;
  ttftMs: number | null;
  ms: number;
  outcome: string;
  finishReason: string | null;
  promptTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
  /** Every link target in the answer, and the ones that are not a Help address. */
  links: string[];
  badLinks: string[];
  answer: string;
  error?: string;
}

interface Seen {
  provider: string | null;
  usage: Record<string, unknown> | null;
}

/** The last streamed OpenRouter response, read off a clone. Watching, not bypassing. */
let pending: Promise<Seen> | null = null;
function watchTheModel(): void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await real(input, init);
    if (String(input).includes("openrouter.ai")) {
      const copy = res.clone();
      pending = copy.text().then((text) => {
        let provider: string | null = null;
        let usage: Record<string, unknown> | null = null;
        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          try {
            const chunk = JSON.parse(line.slice(6)) as { provider?: unknown; usage?: unknown };
            if (typeof chunk.provider === "string") provider = chunk.provider;
            if (chunk.usage && typeof chunk.usage === "object") usage = chunk.usage as Record<string, unknown>;
          } catch {
            /* a keep-alive comment or a partial line */
          }
        }
        return { provider, usage };
      });
    }
    return res;
  }) as typeof fetch;
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

function linksIn(answer: string): string[] {
  return [...answer.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1] ?? "").concat(
    [...answer.matchAll(/https?:\/\/[^\s)>\]]+/g)].map((m) => m[0]).filter((u) => !answer.includes(`](${u}`)),
  );
}

async function ask(
  arm: string,
  model: string,
  q: (typeof QUESTIONS)[number],
  systemSha: string,
  retention: string | undefined,
  nonce: string | undefined,
): Promise<Row> {
  pending = null;
  /* `--retention 24h` adds OpenAI's \`prompt_cache_retention\` to this eval's
     body only, to see whether it survives OpenRouter; production sends none. */
  const base = helpChatRequest(q.question);
  /* `--nonce X` puts one line in front of the system message, for this eval
     only, so a cache probe starts from a prefix nobody has warmed. */
  const messages =
    nonce === undefined
      ? base.messages
      : (base.messages as { role: string; content: string }[]).map((m, i) => (i === 0 ? { ...m, content: `Cache probe ${nonce}.\n\n${String(m.content)}` } : m));
  const request = {
    ...base,
    messages,
    model,
    ...(retention === undefined ? {} : { prompt_cache_retention: retention }),
  } as ReturnType<typeof helpChatRequest>;
  const started = Date.now();
  let first: number | null = null;
  let text = "";
  let end: { outcome: { kind: string }; model: string; finishReason: string | null } | null = null;
  let error: string | undefined;
  try {
    for await (const event of runStream({
      job: "help-chat",
      request,
      timeoutMs: HELP_CHAT_TIMEOUT_MS,
      stallMs: HELP_CHAT_STALL_MS,
    })) {
      if (event.type === "delta") {
        if (first === null && event.text.trim() !== "") first = Date.now() - started;
        text += event.text;
      } else end = event;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const ms = Date.now() - started;
  const seen = pending ? await (pending as Promise<Seen>).catch(() => ({ provider: null, usage: null })) : { provider: null, usage: null };
  const u = seen.usage ?? {};
  const details = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const completion = (u.completion_tokens_details ?? {}) as Record<string, unknown>;
  const costDetails = (u.cost_details ?? {}) as Record<string, unknown>;
  const billed = num(u.cost);
  const upstream = num(costDetails.upstream_inference_cost);
  const answer = text.trim();
  const links = linksIn(answer);
  return {
    arm,
    id: q.id,
    kind: q.kind,
    prompt: HELP_CHAT_VERSION,
    systemSha,
    model,
    answeredBy: end?.model ?? model,
    provider: seen.provider,
    ttftMs: first,
    ms,
    outcome: end?.outcome.kind ?? "threw",
    finishReason: end?.finishReason ?? null,
    promptTokens: num(u.prompt_tokens),
    cachedTokens: num(details.cached_tokens),
    cacheWriteTokens: num(details.cache_write_tokens) ?? num(u.cache_write_tokens),
    completionTokens: num(u.completion_tokens),
    reasoningTokens: num(completion.reasoning_tokens),
    costUsd: billed !== null && billed > 0 ? billed : (upstream ?? billed),
    links,
    badLinks: links.filter((l) => !ADDRESSES.has(l)),
    answer,
    ...(error === undefined ? {} : { error }),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const arm = flag("--arm");
  if (!arm) throw new Error("--arm <name> is required");
  const model = flag("--model") ?? helpChatRequest("").model;
  const only = flag("--only")?.split(",") ?? null;
  const retention = flag("--retention");
  const nonce = flag("--nonce");
  const questions = QUESTIONS.filter((q) => only === null || only.some((o) => q.id.startsWith(o)));
  const systemSha = createHash("sha256").update(HELP_CHAT_SYSTEM).digest("hex").slice(0, 12);

  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${arm}.json`);
  const rows: Row[] = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Row[]) : [];
  watchTheModel();
  let spent = 0;
  for (const q of questions) {
    if (spent > BUDGET_USD) throw new Error(`Stopped: spent $${spent.toFixed(4)}, over the $${BUDGET_USD} budget.`);
    const row = await ask(arm, model, q, systemSha, retention, nonce);
    spent += row.costUsd ?? 0;
    rows.push(row);
    writeFileSync(file, `${JSON.stringify(rows, null, 1)}\n`);
    console.log(
      [
        q.id.padEnd(22),
        row.outcome,
        row.provider ?? "?",
        `prompt=${row.promptTokens}`,
        `cached=${row.cachedTokens}`,
        `write=${row.cacheWriteTokens}`,
        `out=${row.completionTokens}`,
        `$${row.costUsd?.toFixed(5) ?? "?"}`,
        `ttft=${row.ttftMs}ms`,
        `total=${row.ms}ms`,
        row.badLinks.length ? `BAD-LINKS(${row.badLinks.join(" ")})` : "",
        row.error ? `ERROR(${row.error})` : "",
      ].join(" "),
    );
  }
  console.log(`spent $${spent.toFixed(4)} on ${questions.length} calls; results in ${path.relative(process.cwd(), file)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await withLedger("eval", main);
}
