/**
 * **Run every arm on every case, three times** — plan
 * docs/plans/260929c-shelf-topics-chosen-by-a-model.md § Reviews (R5–R9).
 *
 *     npx tsx evals/shelf-topics/run-arms.ts                    # all cases, all arms, runs 1–3
 *     npx tsx evals/shelf-topics/run-arms.ts --case greg-like,history --arm luna-score
 *     npx tsx evals/shelf-topics/run-arms.ts --force            # redo runs that already have a file
 *
 * **This spends money** (about a tenth of a cent per call; the whole eval was
 * well under $1). Every call is recorded: the chat arms through the gateway
 * (`openRouterJson("eval", …)`), Jev through the declared bypass in ./jev.ts,
 * all inside `withLedger("eval", …)`. A run whose file exists without an
 * error is skipped, so a rerun retries only the failures.
 *
 * The arms, predeclared — nothing is added after seeing results:
 *
 * | arm            | how it picks |
 * |----------------|--------------|
 * | baseline       | `chooseTerms` with today's defaults |
 * | jev-score      | Jev scores each prompt candidate 0–3 (expected score); `chooseTerms({quality})` |
 * | deepseek-score | the same rubric on the chat wire, integer scores; `chooseTerms({quality})` |
 * | luna-score     | GPT-6 Luna — since Stage 2, the production scorer itself (`lunaScore` below) |
 * | deepseek-order | the chat model returns ~30 candidate ids in order; taken as given |
 * | luna-order     | the same, GPT-6 Luna |
 *
 * Score arms feed production's own chooser through its seam
 * (`ChooseOptions.quality`, src/shelf-terms/choose.ts): a candidate the model
 * did not score, or scored 0, is never a topic.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { openRouterJson } from "../../src/ai-call.js";
import { withLedger } from "../../src/cli-ledger.js";
import { loadEnvLocal } from "../../src/env.js";
import { SHELF_TOPICS_MODEL } from "../../src/models.js";
import { type ChooseArticle, candidatePool, chooseTerms, type ShelfTerm } from "../../src/shelf-terms/choose.js";
import { type JsonGateway, scoreCandidates, scorerInput } from "../../src/shelf-terms/model-scores.js";
import { type CallRecord, RUN_ARMS, type RunArm, chooseInput, loadCases, RESULTS_DIR, RUNS, type RunFile, type ShelfCase } from "./case.js";
import { JEV_MODEL, jevDecide } from "./jev.js";
import {
  jevQuestion,
  jevState,
  LIST_LENGTH,
  ORDER_SCHEMA,
  orderMessages,
  type PromptCandidate,
  promptCandidates,
  SCORE_SCHEMA,
  scoreMessages,
} from "./prompt.js";

loadEnvLocal();

/** `~deepseek/deepseek-v4-flash-latest` pinned to its dated id (OpenRouter models list, 2026-09-29). */
export const DEEPSEEK_MODEL = "deepseek/deepseek-v4-flash-0731";
/** Production's pin (src/models.ts § `SHELF_TOPICS_MODEL`), so this arm moves when production does. */
export const LUNA_MODEL = SHELF_TOPICS_MODEL;
/**
 * Nine minutes. DeepSeek V4 Flash at the provider's default reasoning spent
 * 8,000+ reasoning tokens and 225 s on a 44-candidate case in the first trial,
 * and a 240 s deadline cut the next call off. The eval job cannot set an
 * effort (`CHAT_REASONING` in src/ai-call.ts owns it), so the latency is part
 * of what the arm measures.
 */
const CHAT_TIMEOUT_MS = 540_000;
/** Parallel calls. DeepSeek's minutes-long answers make 4 too slow. */
const CONCURRENCY = 8;

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const force = argv.includes("--force");
const onlyCases = flag("--case")?.split(",");
const onlyArm = flag("--arm");

function toList(terms: ShelfTerm[]): RunFile["list"] {
  return terms.slice(0, LIST_LENGTH).map((t) => ({
    key: t.key,
    label: t.label,
    count: t.articles.length,
    slugs: t.articles.map((a) => a.slug),
  }));
}

function chatRecord(model: string, json: unknown, latencyMs: number): CallRecord {
  const b = json as {
    model?: string;
    provider?: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
      cost?: number;
      cost_details?: { upstream_inference_cost?: number };
    };
  } | null;
  return {
    model,
    answeredBy: b?.model ?? null,
    provider: b?.provider ?? null,
    tokensIn: b?.usage?.prompt_tokens ?? null,
    tokensOut: b?.usage?.completion_tokens ?? null,
    reasoningTokens: b?.usage?.completion_tokens_details?.reasoning_tokens ?? null,
    costUsd: b?.usage?.cost ?? null,
    upstreamCostUsd: b?.usage?.cost_details?.upstream_inference_cost ?? null,
    latencyMs,
  };
}

/** The JSON object in a chat answer, or null. */
function contentJson(json: unknown): unknown {
  const text = (json as { choices?: { message?: { content?: string } }[] } | null)?.choices?.[0]?.message?.content;
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function chat(
  model: string,
  messages: { role: string; content: string }[],
  schema: object,
  name: string,
): Promise<{ record: CallRecord; parsed: unknown; raw: unknown }> {
  const t0 = performance.now();
  const call = await openRouterJson(
    "eval",
    {
      model,
      max_tokens: 16_000,
      messages,
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    },
    { signal: AbortSignal.timeout(CHAT_TIMEOUT_MS) },
  );
  const latencyMs = Math.round(performance.now() - t0);
  return { record: chatRecord(model, call.json, latencyMs), parsed: contentJson(call.json), raw: call.json };
}

function scoresFrom(parsed: unknown, cands: PromptCandidate[]): { scores: Map<string, number>; missing: number; invalid: number } {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const scores = new Map<string, number>();
  let invalid = 0;
  const rows = (parsed as { scores?: { id?: unknown; score?: unknown }[] } | null)?.scores ?? [];
  for (const r of rows) {
    const c = typeof r.id === "string" ? byId.get(r.id) : undefined;
    const s = r.score;
    if (!c || typeof s !== "number" || !Number.isInteger(s) || s < 0 || s > 3 || scores.has(c.key)) {
      invalid += 1;
      continue;
    }
    scores.set(c.key, s);
  }
  return { scores, missing: cands.length - scores.size, invalid };
}

type ArmBody = (out: RunFile, c: ShelfCase, input: ChooseArticle[], cands: PromptCandidate[]) => Promise<unknown>;

/** Each arm fills `out` and returns the raw response to keep (null for none). */
const ARM_BODY: Record<RunArm, ArmBody> = {
  baseline: async (out, _c, input) => {
    out.candidates = 0;
    out.list = toList(chooseTerms(input).terms);
    return null;
  },
  "jev-score": jevScore,
  "deepseek-score": (out, c, input, cands) => chatScore(DEEPSEEK_MODEL, out, c, input, cands),
  "luna-score": lunaScore,
  "deepseek-order": (out, c, _input, cands) => chatOrder(DEEPSEEK_MODEL, out, c, cands),
  "luna-order": (out, c, _input, cands) => chatOrder(LUNA_MODEL, out, c, cands),
};

async function jevScore(out: RunFile, c: ShelfCase, input: ChooseArticle[], cands: PromptCandidate[]): Promise<unknown> {
  const questions = Object.fromEntries(cands.map((p) => [p.id, jevQuestion(c, p)]));
  const r = await jevDecide(jevState(c), questions);
  out.call = {
    model: JEV_MODEL,
    answeredBy: r.answeredBy,
    provider: r.provider,
    tokensIn: r.inputTokens,
    tokensOut: r.outputTokens,
    reasoningTokens: null,
    costUsd: r.costUsd,
    upstreamCostUsd: null,
    latencyMs: r.latencyMs,
  };
  const scores = new Map<string, number>();
  for (const p of cands) {
    const s = r.answers[p.id]?.score;
    if (typeof s === "number" && Number.isFinite(s) && s >= 0) scores.set(p.key, s);
  }
  out.missing = cands.length - scores.size;
  out.scores = Object.fromEntries(scores);
  out.list = toList(chooseTerms(input, { quality: scores }).terms);
  return r.body;
}

async function chatScore(
  model: string,
  out: RunFile,
  c: ShelfCase,
  input: ChooseArticle[],
  cands: PromptCandidate[],
): Promise<unknown> {
  const r = await chat(model, scoreMessages(c, cands), SCORE_SCHEMA, "topic_scores");
  out.call = r.record;
  const { scores, missing, invalid } = scoresFrom(r.parsed, cands);
  out.scores = Object.fromEntries(scores);
  out.missing = missing;
  out.invalid = invalid;
  out.list = toList(chooseTerms(input, { quality: scores }).terms);
  return r.raw;
}

/**
 * **The production scorer, unchanged** (src/shelf-terms/model-scores.ts, plan
 * 260929c § Stage 2): its prompt, its request, its parser, its model — so this
 * arm measures what ships. The call is recorded as job `shelf-topics` in eval
 * scope (`withLedger("eval")` below), which is ai-gateway.md's rule for an eval
 * that exercises a product job. The wrapper around the gateway only keeps the
 * raw body for the call record; it changes nothing sent.
 *
 * A refusal from `parseScores` (a score outside 0–3, bad JSON) is an error for
 * this run, where the Stage 1 arm counted the bad rows as `invalid` and kept the
 * rest — production refuses the whole answer, and so does this arm now.
 */
async function lunaScore(out: RunFile, c: ShelfCase, input: ChooseArticle[], cands: PromptCandidate[]): Promise<unknown> {
  let raw: unknown = null;
  const gateway: JsonGateway = async (job, body, opts) => {
    const call = await openRouterJson(job, body, opts);
    raw = call.json;
    return call;
  };
  const articles = c.articles
    .filter((a) => a.skipped === null)
    .map((a) => ({ slug: a.slug, title: a.title, gist: a.gist }));
  const t0 = performance.now();
  try {
    const got = await scoreCandidates(scorerInput(articles, c.profile, cands), {
      model: LUNA_MODEL,
      gateway,
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    out.scores = Object.fromEntries(got.scores);
    out.missing = cands.length - got.scored;
    out.list = toList(chooseTerms(input, { quality: got.scores }).terms);
  } finally {
    out.call = chatRecord(LUNA_MODEL, raw, Math.round(performance.now() - t0));
  }
  return raw;
}

async function chatOrder(model: string, out: RunFile, c: ShelfCase, cands: PromptCandidate[]): Promise<unknown> {
  const r = await chat(model, orderMessages(c, cands), ORDER_SCHEMA, "topic_order");
  out.call = r.record;
  const byId = new Map(cands.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const ids = (r.parsed as { order?: unknown[] } | null)?.order ?? [];
  for (const id of ids) {
    const p = typeof id === "string" ? byId.get(id) : undefined;
    if (!p || seen.has(p.id)) {
      out.invalid += 1;
      continue;
    }
    seen.add(p.id);
    if (out.list.length < LIST_LENGTH) out.list.push({ key: p.key, label: p.label, count: p.count, slugs: p.slugs });
  }
  if (!ids.length) out.error = "no order in the answer";
  return r.raw;
}

async function runOne(c: ShelfCase, arm: RunArm, run: number, cands: PromptCandidate[], dir: string): Promise<void> {
  const file = path.join(dir, `${arm}-${run}.json`);
  if (!force && existsSync(file) && !(JSON.parse(readFileSync(file, "utf8")) as RunFile).error) return;
  const input = chooseInput(c);
  const out: RunFile = {
    case: c.id,
    arm,
    run,
    at: new Date().toISOString(),
    call: null,
    candidates: cands.length,
    scores: null,
    missing: 0,
    invalid: 0,
    error: null,
    list: [],
  };
  let raw: unknown = null;
  try {
    raw = await ARM_BODY[arm](out, c, input, cands);
  } catch (e) {
    out.error = e instanceof Error ? e.message.slice(0, 600) : String(e);
  }
  writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
  if (raw !== null) {
    mkdirSync(path.join(dir, "raw"), { recursive: true });
    writeFileSync(path.join(dir, "raw", `${arm}-${run}.json`), `${JSON.stringify(raw, null, 1)}\n`);
  }
  const cost = out.call ? (out.call.costUsd || out.call.upstreamCostUsd || 0) : 0;
  console.log(
    `${c.id} ${arm}-${run}: ${out.list.length} topics` +
      (out.call ? `, ${out.call.tokensIn}→${out.call.tokensOut} tok, $${cost.toFixed(5)}, ${out.call.latencyMs} ms` : "") +
      (out.missing || out.invalid ? `, missing ${out.missing} invalid ${out.invalid}` : "") +
      (out.error ? `  ERROR ${out.error.slice(0, 200)}` : ""),
  );
}

/** The prompt candidates for a case, written once so every arm and run sees the same list. */
function candidatesFor(c: ShelfCase, dir: string): PromptCandidate[] {
  const file = path.join(dir, "candidates.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as PromptCandidate[];
  const input = chooseInput(c);
  const base = chooseTerms(input).terms.map((t) => t.key);
  const cands = promptCandidates(candidatePool(input), base);
  writeFileSync(file, `${JSON.stringify(cands, null, 1)}\n`);
  return cands;
}

async function main(): Promise<void> {
  const cases = loadCases().filter((c) => !onlyCases || onlyCases.includes(c.id));
  const arms = RUN_ARMS.filter((a) => !onlyArm || a === onlyArm);
  const jobs: (() => Promise<void>)[] = [];
  for (const c of cases) {
    const dir = path.join(RESULTS_DIR, c.id);
    mkdirSync(dir, { recursive: true });
    const cands = candidatesFor(c, dir);
    for (const arm of arms) for (const run of RUNS) jobs.push(() => runOne(c, arm, run, cands, dir));
  }
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        if (job) await job();
      }
    }),
  );
}

await withLedger("eval", main);
