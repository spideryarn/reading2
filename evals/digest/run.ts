/**
 * **The digest spike: generation half** — plan 261009a § Stage 3,
 * docs/plans/261009a-latest-model-versions-haiku-5-5-and-an-opus-digest-spike.md.
 *
 * Can Sonnet 5.5 or Haiku 5.5, handed an Opus 5.5 "digest" of the article as
 * well as the article, match Opus 5.5 on three reader-facing outputs? This
 * writes the outputs; judging happens elsewhere.
 *
 *   npx tsx evals/digest/run.ts --preflight   # estimate, print, spend nothing
 *   npx tsx evals/digest/run.ts --run         # generate (resumes: finished cells are skipped)
 *   npx tsx evals/digest/run.ts --report      # rebuild costs.json / costs.md from the cells
 *
 * See evals/digest/README.md for what each arm sends and why.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Article } from "../../src/article-input.js";
import { type AiRequestBody, openRouterJson, wireEffort } from "../../src/ai-call.js";
import type { SpendRecord } from "../../src/ai-spend.js";
import { isBodyEvidence } from "../../src/block-policy.js";
import { buildConverseMessages, citedBlockIds, unknownCitedIds } from "../../src/converse.js";
import { loadEnvLocal } from "../../src/env.js";
import { type Dropped as IdeasDropped, buildIdeas } from "../../src/ideas.js";
import { parseJsonAnswer } from "../../src/parse-json.js";
import { buildLevel, emptyDropped, paragraphWords } from "../../src/simple-summary.js";
import type { Idea, Meta, SimpleParagraph } from "../../src/types.js";
import { type Budget, BudgetHalted, BudgetRefused, openBudget, type paidStep } from "../dig-deeper/budget.js";
import { assertLocalDatabase, loadArticles, SLUGS, type Slug, targetLine } from "./articles.js";
import { type CapturedRequest, captureIdeas, captureSummaryFuller } from "./capture.js";
import { DIGEST_SYSTEM, DIGEST_USER, digestBlock } from "./prompts.js";
import { drain, withReservation } from "./budget.js";
import { assertResumeIdentity } from "./resume.js";

const HERE = import.meta.dirname;
const outFlag = process.argv.indexOf("--out");
if (outFlag !== -1 && !process.argv[outFlag + 1]) throw new Error("--out needs a directory");
const OUT = outFlag === -1 ? path.join(HERE, "..", "results", "digest-2026-10-09") : path.resolve(process.argv[outFlag + 1]!);
const CAP_USD = 6.0;
const DROP_Q2_ABOVE_USD = 5.0;
const CONCURRENCY = 6;
const CALL_TIMEOUT_MS = 15 * 60_000;
const DIGEST_MAX_TOKENS = 16_000;
/**
 * Production chat's ceiling **as it was on 2026-10-09, when this ran** — kept
 * so the run reproduces. Production now sends more on the high-power model
 * (src/converse.ts § `chatCeiling`, plan 261009e); a future run comparing Opus
 * should use that rather than this.
 */
const CHAT_MAX_TOKENS = 4000;

/* ------------------------------------------------------------- models -- */

const MODEL = {
  opus: "anthropic/claude-opus-5.5",
  sonnet: "anthropic/claude-sonnet-5.5",
  haiku: "anthropic/claude-haiku-5.5",
} as const;
type ModelKey = keyof typeof MODEL;

/**
 * Per million tokens. Opus and Sonnet from OpenRouter's listing (as
 * evals/dig-deeper/arms.ts § PRICES); Haiku 5.5 at its **above-100k** rate
 * ($0.50 / $2.50) so the bound stays an upper bound whatever the prompt length
 * (every prompt here is under 100k, where it is $0.10 / $0.50).
 */
const PRICE: Record<ModelKey, { input: number; output: number; cacheWrite: number }> = {
  opus: { input: 4, output: 20, cacheWrite: 5 },
  sonnet: { input: 2, output: 10, cacheWrite: 2.5 },
  haiku: { input: 0.5, output: 2.5, cacheWrite: 0.625 },
};
/** The realistic rate for the estimate (Haiku under 100k). */
const ESTIMATE_PRICE: Record<ModelKey, { input: number; output: number }> = {
  opus: { input: 4, output: 20 },
  sonnet: { input: 2, output: 10 },
  haiku: { input: 0.1, output: 0.5 },
};

/**
 * **Which effort each call actually ran at.** Job `eval` is a
 * `providerDefault` row in `CHAT_REASONING`, so the gateway strips any caller
 * `reasoning` and sends none — except to Opus 5.5, where `wireEffort` sends
 * `high` (High-powered AI's parity rule). With nothing sent, the model runs at
 * its own default: Sonnet 5.5 `high`, Haiku 5.5 `medium` (Anthropic's model
 * docs, via the claude-api skill, cached 2026-10-06). Production's Summary and
 * Ideas send `high` on the Messages wire; production chat sends nothing to
 * Sonnet and `high` to Opus. So Opus and Sonnet match production in every
 * task, and Haiku runs one level below what production would ask of it.
 */
const PROVIDER_DEFAULT_EFFORT: Record<ModelKey, string> = { opus: "medium", sonnet: "high", haiku: "medium" };
function effortOf(model: ModelKey): { sent: string | null; ran: string } {
  const sent = wireEffort("eval", MODEL[model]);
  return { sent, ran: sent ?? PROVIDER_DEFAULT_EFFORT[model] };
}

/* --------------------------------------------------------------- arms -- */

const ARMS = [
  { id: "A-opus", model: "opus", digest: false },
  { id: "B-sonnet", model: "sonnet", digest: false },
  { id: "C-sonnet+digest", model: "sonnet", digest: true },
  { id: "D-haiku", model: "haiku", digest: false },
  { id: "E-haiku+digest", model: "haiku", digest: true },
] as const satisfies readonly { id: string; model: ModelKey; digest: boolean }[];
type Arm = (typeof ARMS)[number];
type ArmId = Arm["id"];

type Task = "summary-fuller" | "ideas" | "chat-q1" | "chat-q2";

interface Question {
  id: "q1" | "q2";
  kind: string;
  text: string;
}

/* --------------------------------------------------------- the bodies -- */

interface Built {
  body: AiRequestBody;
  /** The texts to replace with a placeholder when the request is recorded. */
  redact: { text: string; label: string }[];
  maxTokens: number;
}

const ephemeral = { type: "ephemeral" } as const;

/**
 * A captured Messages-wire request, on the chat wire: the same system blocks
 * in the same order (article, [digest], the task's instructions), the same user
 * message, the same `max_tokens` and the same schema — as `response_format`,
 * which OpenRouter maps to Anthropic's structured output. The article is
 * marked for caching in every arm; a marker does not change what the model
 * sees.
 */
function fromCaptured(cap: CapturedRequest, model: ModelKey, digest: string | null, name: string): Built {
  const [article, instructions] = cap.system;
  if (!article || !instructions || cap.system.length !== 2) throw new Error(`${name}: expected two system blocks`);
  const user = cap.messages[0];
  if (!user || cap.messages.length !== 1) throw new Error(`${name}: expected one user message`);
  const system = [
    { type: "text", text: article.text, cache_control: ephemeral },
    ...(digest ? [{ type: "text", text: digestBlock(digest) }] : []),
    { type: "text", text: instructions.text },
  ];
  return {
    body: {
      model: MODEL[model],
      max_tokens: cap.max_tokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user.content },
      ],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema: cap.schema } },
    },
    redact: [
      { text: article.text, label: "article (articleWithIds, body evidence)" },
      ...(digest ? [{ text: digestBlock(digest), label: "digest block" }] : []),
    ],
    maxTokens: cap.max_tokens,
  };
}

/**
 * Production chat's messages (`buildConverseMessages`, kind `chat`, no
 * history, no position, no profile), with no tools: the article in the cached
 * user message, the digest as a second part of that message.
 */
function chatBody(article: Article, question: string, model: ModelKey, digest: string | null): Built {
  const meta: Meta = article.meta ?? ({ title: article.slug } as Meta);
  const messages = buildConverseMessages({ meta, blocks: article.blocks, history: [], question, kind: "chat" });
  const first = messages[1];
  if (first?.role !== "user" || !Array.isArray(first.content)) {
    throw new Error("chat: buildConverseMessages no longer puts the article in the second message");
  }
  const articlePart = first.content[0] as { type: "text"; text: string };
  if (digest) (first.content as unknown[]).push({ type: "text", text: digestBlock(digest) });
  return {
    body: { model: MODEL[model], max_tokens: CHAT_MAX_TOKENS, messages },
    redact: [
      { text: articlePart.text, label: "article (chat's 'Here is the whole article' + articleWithIds, all blocks)" },
      ...(digest ? [{ text: digestBlock(digest), label: "digest block" }] : []),
    ],
    maxTokens: CHAT_MAX_TOKENS,
  };
}

function digestBody(articleText: string): Built {
  return {
    body: {
      model: MODEL.opus,
      max_tokens: DIGEST_MAX_TOKENS,
      messages: [
        {
          role: "system",
          content: [
            { type: "text", text: articleText, cache_control: ephemeral },
            { type: "text", text: DIGEST_SYSTEM },
          ],
        },
        { role: "user", content: DIGEST_USER },
      ],
    },
    redact: [{ text: articleText, label: "article (articleWithIds, body evidence)" }],
    maxTokens: DIGEST_MAX_TOKENS,
  };
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

/** The outgoing body with the article and digest replaced by a label, length and hash. */
function redacted(b: Built): unknown {
  let json = JSON.stringify(b.body);
  for (const r of b.redact) {
    const enc = JSON.stringify(r.text).slice(1, -1);
    json = json.split(enc).join(`<${r.label}: ${r.text.length} chars, sha256 ${sha(r.text)}>`);
  }
  return JSON.parse(json);
}

/* ------------------------------------------------------------ budget -- */

/** One input token per UTF-8 byte (a true ceiling), plus `max_tokens` at the output price. */
function boundUsd(model: ModelKey, b: Built): number {
  const bytes = Buffer.byteLength(JSON.stringify(b.body), "utf8");
  const p = PRICE[model];
  return (bytes * Math.max(p.input, p.cacheWrite) + b.maxTokens * p.output) / 1e6;
}

/** Assumed output (thinking + answer) per task, for the estimate only. */
const EXPECTED_OUTPUT: Record<Task | "digest", number> = {
  digest: 9000,
  "summary-fuller": 5000,
  ideas: 12000,
  "chat-q1": 2500,
  "chat-q2": 2500,
};
function estimateUsd(model: ModelKey, b: Built, task: Task | "digest"): number {
  /* ~3.5 characters a token for English with ids; no cache discount assumed. */
  const tokens = JSON.stringify(b.body).length / 3.5;
  const p = ESTIMATE_PRICE[model];
  return (tokens * p.input + EXPECTED_OUTPUT[task] * p.output) / 1e6;
}

/* ------------------------------------------------------------- cells -- */

interface CallOut {
  slug: Slug;
  task: Task | "digest";
  arm: ArmId | "digest";
  model: string;
  answeredBy: string | null;
  effortSent: string | null;
  effortRan: string;
  maxTokens: number;
  boundUsd: number;
  ok: boolean;
  /** Why the output is not usable: the parse or validation error, the finish reason, the transport failure. */
  error: string | null;
  finishReason: string | null;
  raw: string;
  parsed: unknown;
  validation: Record<string, unknown>;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    reasoningTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
  };
  usd: number | null;
  latencyMs: number;
  generationIds: (string | null)[];
  upstreams: (string | null)[];
  /** Ledger rows for this cell (transport retries are separate rows). */
  calls: number;
  request: unknown;
  at: string;
}

function sum(records: SpendRecord[], f: (r: SpendRecord) => number | null): number | null {
  let t = 0;
  for (const r of records) {
    const v = f(r);
    if (v === null) return null;
    t += v;
  }
  return t;
}

async function callOnce(
  budget: Budget,
  ledger: Parameters<typeof paidStep>[2],
  id: string,
  model: ModelKey,
  built: Built,
): Promise<{
  text: string;
  finishReason: string | null;
  answeredBy: string | null;
  records: SpendRecord[];
  usd: number;
  ms: number;
  error: string | null;
}> {
  const started = Date.now();
  const bound = boundUsd(model, built);
  try {
    const { result, spent } = await withReservation(budget, { id, label: id, boundUsd: bound }, ledger, () =>
      /* One reservation covers one attempt; a transport retry needs another
         reservation, so disable the gateway's internal retry in this spike. */
      openRouterJson("eval", built.body, { signal: AbortSignal.timeout(CALL_TIMEOUT_MS), retryTransport: false }),
    );
    const json = result.json as {
      choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
      error?: unknown;
    } | null;
    const choice = json?.choices?.[0];
    const text = choice?.message?.content ?? "";
    const finishReason = choice?.finish_reason ?? null;
    let error: string | null = null;
    if (!choice) error = "no choices in the response (error envelope or unparsable body)";
    else if (finishReason === "length") error = "finish_reason length: the answer was cut off at max_tokens";
    else if (!text.trim()) error = `empty answer (finish_reason ${finishReason})`;
    return { text, finishReason, answeredBy: result.answeredBy, records: spent.calls, usd: spent.usd, ms: Date.now() - started, error };
  } catch (err) {
    if (err instanceof BudgetRefused || err instanceof BudgetHalted) throw err;
    const spent = (err as { spent?: { calls: SpendRecord[]; usd: number } }).spent;
    return {
      text: "",
      finishReason: null,
      answeredBy: null,
      records: spent?.calls ?? [],
      usd: spent?.usd ?? 0,
      ms: Date.now() - started,
      error: `call failed: ${(err as Error).name}: ${(err as Error).message}`.slice(0, 500),
    };
  }
}

function usageOf(records: SpendRecord[]): CallOut["usage"] {
  return {
    inputTokens: sum(records, (r) => r.inputTokens),
    outputTokens: sum(records, (r) => r.outputTokens),
    reasoningTokens: sum(records, (r) => r.reasoningTokens),
    cacheReadTokens: sum(records, (r) => r.cacheReadTokens),
    cacheWriteTokens: sum(records, (r) => r.cacheWriteTokens),
  };
}

/* ----------------------------------------------------- validate + render -- */

function validateSummary(raw: string, article: Article) {
  const evidenceIds = new Set(article.blocks.filter(isBodyEvidence).map((b) => b.id as string));
  const dropped = emptyDropped();
  const paragraphs = buildLevel(parseJsonAnswer<unknown>(raw, "summary"), "fuller", evidenceIds, dropped);
  return { parsed: paragraphs, validation: { paragraphs: paragraphs.length, words: paragraphWords(paragraphs), dropped } };
}

function validateIdeas(raw: string, article: Article) {
  const dropped: IdeasDropped = {
    unknownIds: 0,
    unquoted: 0,
    truncated: 0,
    overCap: 0,
    malformed: 0,
    unargued: 0,
    unanchored: 0,
  };
  const parsed = parseJsonAnswer<{ ideas?: unknown }>(raw, "ideas");
  const offered = Array.isArray(parsed.ideas) ? parsed.ideas.length : 0;
  const ideas = buildIdeas(parsed, {
    slug: article.slug,
    blocks: article.blocks,
    sourceHash: "digest-spike",
    power: "standard",
    elapsedMs: 0,
    dropped,
  });
  return { parsed: ideas.ideas, validation: { offered, kept: ideas.ideas.length, dropped } };
}

function validateProse(raw: string, article: Article) {
  const known = new Set(article.blocks.map((b) => b.id as string));
  return {
    parsed: null,
    validation: {
      words: raw.trim().split(/\s+/).filter(Boolean).length,
      citedIds: citedBlockIds(raw, known).length,
      unknownIds: unknownCitedIds(raw, known),
    },
  };
}

function renderMd(out: CallOut, title: string): string {
  const head = `# ${title}\n\n`;
  if (!out.ok) return `${head}**FAILED**: ${out.error}\n\n## Raw\n\n${out.raw || "(nothing)"}\n`;
  if (out.task === "summary-fuller") {
    const ps = out.parsed as SimpleParagraph[];
    return head + ps.map((p) => `${p.text}\n\n<sub>${p.ids.join(", ")}</sub>`).join("\n\n") + "\n";
  }
  if (out.task === "ideas") {
    const ideas = out.parsed as Idea[];
    return (
      head +
      ideas
        .map((i, n) => {
          const lines = [`## ${n + 1}. ${i.name} (${i.provenance})`, "", i.statement];
          if (i.whyYouNeedIt) lines.push("", `*Why you need it:* ${i.whyYouNeedIt}`);
          if (i.analogy) lines.push("", `*Analogy:* ${i.analogy}`);
          lines.push("", ...i.occurrences.map((o) => `- ${o.blockId}: "${o.quote}"`));
          return lines.join("\n");
        })
        .join("\n\n") +
      "\n"
    );
  }
  return head + out.raw.trim() + "\n";
}

/* --------------------------------------------------------------- plan -- */

interface Cell {
  slug: Slug;
  task: Task;
  arm: Arm;
  question?: Question;
  file: string;
}

function cellsFor(questions: Record<Slug, Question[]>, dropQ2: boolean): Cell[] {
  const cells: Cell[] = [];
  for (const slug of SLUGS) {
    for (const arm of ARMS) {
      const tasks: { task: Task; question?: Question }[] = [{ task: "summary-fuller" }, { task: "ideas" }];
      for (const q of questions[slug]) {
        if (dropQ2 && q.id === "q2") continue;
        tasks.push({ task: q.id === "q1" ? "chat-q1" : "chat-q2", question: q });
      }
      for (const t of tasks) {
        cells.push({
          slug,
          task: t.task,
          arm,
          ...(t.question ? { question: t.question } : {}),
          file: path.join(OUT, slug, t.task, `${arm.id}.json`),
        });
      }
    }
  }
  /* Dearest first, so a late hard stop costs the cheap cells rather than the ceiling. */
  const order: Record<ModelKey, number> = { opus: 0, sonnet: 1, haiku: 2 };
  return cells.sort((a, b) => order[a.arm.model] - order[b.arm.model]);
}

function readQuestions(): { questions: Record<Slug, Question[]>; hash: string } {
  const file = path.join(HERE, "questions.json");
  const text = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(text) as { questions: Record<string, Question[]> };
  for (const slug of SLUGS) {
    if (parsed.questions[slug]?.length !== 2) throw new Error(`questions.json: need two questions for ${slug}`);
  }
  return { questions: parsed.questions as Record<Slug, Question[]>, hash: sha(text) };
}

function write(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

/* --------------------------------------------------------------- main -- */

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "--preflight" && mode !== "--run" && mode !== "--report") {
    throw new Error("usage: run.ts --preflight | --run | --report");
  }
  if (process.argv.includes("--retry-failed")) throw new Error("failures are retained as results; retry in a fresh --out directory to preserve spend and judging evidence");
  if (mode === "--report") return report();
  loadEnvLocal();
  console.log(targetLine());
  assertLocalDatabase();

  const { questions, hash: questionsHash } = readQuestions();
  const priorPlan = path.join(OUT, "preflight-run.json");
  if (fs.existsSync(priorPlan) && (JSON.parse(fs.readFileSync(priorPlan, "utf8")) as { questionsHash: string }).questionsHash !== questionsHash) {
    throw new Error("questions changed since generation; use a fresh --out directory");
  }
  const articles = await loadArticles();
  const caps = new Map<Slug, { summary: CapturedRequest; ideas: CapturedRequest }>();
  for (const slug of SLUGS) {
    const a = articles.get(slug)!;
    const summary = await captureSummaryFuller(a);
    const ideas = await captureIdeas(a);
    if (summary.system[0]?.text !== ideas.system[0]?.text) throw new Error(`${slug}: Summary and Ideas no longer send the same article bytes`);
    caps.set(slug, { summary, ideas });
  }

  /* ---- preflight: every call enumerated, estimated and bounded ---- */
  const placeholderDigest = "x".repeat(14_000); // ~2,000 words of notes, for sizing only
  const built = (c: Cell, digest: string | null): Built => {
    const cap = caps.get(c.slug)!;
    const a = articles.get(c.slug)!;
    if (c.task === "summary-fuller") return fromCaptured(cap.summary, c.arm.model, digest, "simple_summary_level");
    if (c.task === "ideas") return fromCaptured(cap.ideas, c.arm.model, digest, "ideas");
    return chatBody(a, c.question!.text, c.arm.model, digest);
  };
  /* Validate every saved cell before dispatching any paid work, including q2
     when this invocation would otherwise drop it. */
  const savedDigests = new Map<Slug, string>();
  for (const slug of SLUGS) {
    const file = path.join(OUT, slug, "digest.json");
    if (!fs.existsSync(file)) continue;
    const prev = JSON.parse(fs.readFileSync(file, "utf8")) as CallOut;
    assertResumeIdentity(file, prev, redacted(digestBody(caps.get(slug)!.summary.system[0]!.text)), effortOf("opus"));
    if (prev.ok) savedDigests.set(slug, prev.raw);
  }
  for (const c of cellsFor(questions, false)) {
    if (!fs.existsSync(c.file)) continue;
    const prev = JSON.parse(fs.readFileSync(c.file, "utf8")) as CallOut;
    const digest = c.arm.digest ? savedDigests.get(c.slug) : null;
    if (c.arm.digest && !digest) throw new Error(`${c.file}: saved digest arm has no usable digest`);
    assertResumeIdentity(c.file, prev, redacted(built(c, digest ?? null)), effortOf(c.arm.model));
  }
  const plan = (dropQ2: boolean) => {
    const rows: { label: string; model: ModelKey; estimate: number; bound: number }[] = [];
    for (const slug of SLUGS) {
      const d = digestBody(caps.get(slug)!.summary.system[0]!.text);
      rows.push({ label: `${slug} digest`, model: "opus", estimate: estimateUsd("opus", d, "digest"), bound: boundUsd("opus", d) });
    }
    for (const c of cellsFor(questions, dropQ2)) {
      const b = built(c, c.arm.digest ? placeholderDigest : null);
      rows.push({ label: `${c.slug} ${c.task} ${c.arm.id}`, model: c.arm.model, estimate: estimateUsd(c.arm.model, b, c.task), bound: boundUsd(c.arm.model, b) });
    }
    return rows;
  };
  let dropQ2 = false;
  let rows = plan(false);
  let estimate = rows.reduce((n, r) => n + r.estimate, 0);
  const fullEstimate = estimate;
  /* `--with-q2`: a second pass, after the first has shown what the calls
     really cost, to add the second question while the hard cap still holds. */
  if (estimate > DROP_Q2_ABOVE_USD && !process.argv.includes("--with-q2")) {
    dropQ2 = true;
    rows = plan(true);
    estimate = rows.reduce((n, r) => n + r.estimate, 0);
  }
  const worst = rows.reduce((n, r) => n + r.bound, 0);
  const byModel = (k: ModelKey) => rows.filter((r) => r.model === k);
  const preflight = {
    at: new Date().toISOString(),
    questionsHash,
    calls: rows.length,
    estimateUsd: estimate,
    estimateWithBothQuestionsUsd: fullEstimate,
    droppedSecondChatQuestion: dropQ2,
    worstCaseUsd: worst,
    capUsd: CAP_USD,
    assumptions:
      "estimate: request characters / 3.5 as input tokens, no cache discount, output per task " +
      JSON.stringify(EXPECTED_OUTPUT) +
      "; worst case: one input token per request byte at the dearer of input and cache-write prices, plus max_tokens at the output price (Haiku at its >100k rate). " +
      "Calls reserve their worst case before dispatch and wait while the cap has no room; with nothing in flight and no room, the run stops.",
    perModel: Object.fromEntries(
      (Object.keys(MODEL) as ModelKey[]).map((k) => [
        k,
        { calls: byModel(k).length, estimateUsd: byModel(k).reduce((n, r) => n + r.estimate, 0), worstCaseUsd: byModel(k).reduce((n, r) => n + r.bound, 0), effort: effortOf(k) },
      ]),
    ),
    rows,
  };
  console.log(
    `Preflight: ${rows.length} calls, estimate $${estimate.toFixed(2)}` +
      (dropQ2 ? ` (both chat questions would be $${fullEstimate.toFixed(2)}, over $${DROP_Q2_ABOVE_USD}: the second is dropped)` : "") +
      `, worst case $${worst.toFixed(2)}, cap $${CAP_USD.toFixed(2)}`,
  );
  for (const k of Object.keys(MODEL) as ModelKey[]) {
    const m = preflight.perModel[k]!;
    console.log(`  ${k}: ${m.calls} calls, est $${m.estimateUsd.toFixed(2)}, worst $${m.worstCaseUsd.toFixed(2)}, effort sent ${m.effort.sent ?? "none"} (runs at ${m.effort.ran})`);
  }
  write(path.join(OUT, mode === "--preflight" ? "preflight.json" : "preflight-run.json"), preflight);
  if (mode === "--preflight") return;

  /* ---- run ---- */
  const { environmentOwnerId } = await import("../../src/owner.js");
  const { costStore } = await import("../../src/store/ai-calls.js");
  const ledger = { attribution: { scopeKind: "eval" as const, ownerId: environmentOwnerId() }, sink: (row: Parameters<typeof costStore.record>[0]) => costStore.record(row) };
  const budget = openBudget(path.join(OUT, "budget.json"), CAP_USD);
  try {
    /* Digests, one per article, in parallel. */
    const digests = new Map<Slug, string>();
    await drain(
      SLUGS.map(async (slug) => {
        const file = path.join(OUT, slug, "digest.json");
        if (fs.existsSync(file)) {
          const saved = savedDigests.get(slug);
          if (saved) digests.set(slug, saved);
          return; // A failed digest is also a paid result, retained on resume.
        }
        const a = articles.get(slug)!;
        const b = digestBody(caps.get(slug)!.summary.system[0]!.text);
        const r = await callOnce(budget, ledger, `${slug}/digest`, "opus", b);
        const v = r.error ? null : validateProse(r.text, a);
        const out: CallOut = {
          slug,
          task: "digest",
          arm: "digest",
          model: MODEL.opus,
          answeredBy: r.answeredBy,
          effortSent: effortOf("opus").sent,
          effortRan: effortOf("opus").ran,
          maxTokens: b.maxTokens,
          boundUsd: boundUsd("opus", b),
          ok: r.error === null,
          error: r.error,
          finishReason: r.finishReason,
          raw: r.text,
          parsed: null,
          validation: v?.validation ?? {},
          usage: usageOf(r.records),
          usd: r.usd,
          latencyMs: r.ms,
          generationIds: r.records.map((x) => x.generationId),
          upstreams: r.records.map((x) => x.upstream),
          calls: r.records.length,
          request: redacted(b),
          at: new Date().toISOString(),
        };
        write(file, out);
        write(path.join(OUT, slug, "digest.md"), r.text.trim() + "\n");
        console.log(`digest ${slug}: ${out.ok ? "ok" : `FAILED ${out.error}`} $${(r.usd ?? 0).toFixed(4)} ${Math.round(r.ms / 1000)}s`);
        if (out.ok) digests.set(slug, r.text);
      }),
    );

    const cells = cellsFor(questions, dropQ2).filter((c) => !fs.existsSync(c.file));
    console.log(`${cells.length} cells to run`);
    let next = 0;
    let stopped: string | null = null;
    const worker = async () => {
      for (;;) {
        if (stopped) return;
        const c = cells[next++];
        if (!c) return;
        const digest = c.arm.digest ? (digests.get(c.slug) ?? null) : null;
        if (c.arm.digest && !digest) {
          console.log(`skip ${c.slug} ${c.task} ${c.arm.id}: no digest`);
          continue;
        }
        const a = articles.get(c.slug)!;
        const b = built(c, digest);
        let r: Awaited<ReturnType<typeof callOnce>>;
        try {
          r = await callOnce(budget, ledger, `${c.slug}/${c.task}/${c.arm.id}`, c.arm.model, b);
        } catch (err) {
          if (err instanceof BudgetRefused) {
            stopped = err.message;
            console.log(err.message);
            return;
          }
          throw err;
        }
        let error = r.error;
        let parsed: unknown = null;
        let validation: Record<string, unknown> = {};
        if (!error) {
          try {
            const v =
              c.task === "summary-fuller" ? validateSummary(r.text, a) : c.task === "ideas" ? validateIdeas(r.text, a) : validateProse(r.text, a);
            parsed = v.parsed;
            validation = v.validation;
          } catch (err) {
            error = `production validation rejected it: ${(err as Error).message}`;
          }
        }
        const eff = effortOf(c.arm.model);
        const out: CallOut = {
          slug: c.slug,
          task: c.task,
          arm: c.arm.id,
          model: MODEL[c.arm.model],
          answeredBy: r.answeredBy,
          effortSent: eff.sent,
          effortRan: eff.ran,
          maxTokens: b.maxTokens,
          boundUsd: boundUsd(c.arm.model, b),
          ok: error === null,
          error,
          finishReason: r.finishReason,
          raw: r.text,
          parsed,
          validation,
          usage: usageOf(r.records),
          usd: r.usd,
          latencyMs: r.ms,
          generationIds: r.records.map((x) => x.generationId),
          upstreams: r.records.map((x) => x.upstream),
          calls: r.records.length,
          request: redacted(b),
          at: new Date().toISOString(),
        };
        write(c.file, out);
        const title = `${c.slug} — ${c.task} — ${c.arm.id}` + (c.question ? `\n\n> ${c.question.text}` : "");
        write(c.file.replace(/\.json$/, ".md"), renderMd(out, title));
        console.log(
          `${c.slug} ${c.task} ${c.arm.id}: ${out.ok ? "ok" : `FAILED ${out.error}`} $${(r.usd ?? 0).toFixed(4)} ` +
            `${Math.round(r.ms / 1000)}s (spent $${budget.state().spentUsd.toFixed(4)})`,
        );
      }
    };
    await drain(Array.from({ length: CONCURRENCY }, worker));
    if (stopped) console.log(`STOPPED: ${stopped}`);
  } finally {
    budget.close();
  }
  report();
}

/* ------------------------------------------------------------- report -- */

function readCells(): CallOut[] {
  const outs: CallOut[] = [];
  for (const slug of SLUGS) {
    const dir = path.join(OUT, slug);
    if (!fs.existsSync(dir)) continue;
    if (fs.existsSync(path.join(dir, "digest.json"))) outs.push(JSON.parse(fs.readFileSync(path.join(dir, "digest.json"), "utf8")) as CallOut);
    for (const task of fs.readdirSync(dir)) {
      const tdir = path.join(dir, task);
      if (!fs.statSync(tdir).isDirectory()) continue;
      for (const f of fs.readdirSync(tdir).filter((x) => x.endsWith(".json"))) {
        outs.push(JSON.parse(fs.readFileSync(path.join(tdir, f), "utf8")) as CallOut);
      }
    }
  }
  return outs;
}

function report(): void {
  const outs = readCells();
  const usd = (xs: CallOut[]) => xs.reduce((n, x) => n + (x.usd ?? 0), 0);
  const digests = outs.filter((o) => o.task === "digest");
  const cells = outs.filter((o) => o.task !== "digest");
  const digestBySlug = Object.fromEntries(
    digests.map((d) => [
      d.slug,
      { usd: d.usd, ok: d.ok, words: (d.validation as { words?: number }).words ?? null, citedIds: (d.validation as { citedIds?: number }).citedIds ?? null, unknownIds: (d.validation as { unknownIds?: string[] }).unknownIds ?? [], outputTokens: d.usage.outputTokens, reasoningTokens: d.usage.reasoningTokens, inputTokens: d.usage.inputTokens, cacheWriteTokens: d.usage.cacheWriteTokens, latencyMs: d.latencyMs, effortRan: d.effortRan },
    ]),
  );
  const digestTotal = usd(digests);
  /* **The same calls at list price with no cache discount.** Which arm read a
     cached article depended on run order (the digest warmed Opus's cache for
     arm A; arm B's calls warmed Sonnet's and Haiku's for the +digest arms), so
     the billed figures favour whichever arm ran second. This one does not. */
  const keyOf = (model: string): ModelKey => (Object.keys(MODEL) as ModelKey[]).find((k) => MODEL[k] === model)!;
  const listUsd = (xs: CallOut[]) =>
    xs.reduce((n, x) => {
      const p = ESTIMATE_PRICE[keyOf(x.model)];
      return n + ((x.usage.inputTokens ?? 0) * p.input + (x.usage.outputTokens ?? 0) * p.output) / 1e6;
    }, 0);
  const tokens = (xs: CallOut[], f: (u: CallOut["usage"]) => number | null) => xs.reduce((n, x) => n + (f(x.usage) ?? 0), 0);
  const digestListTotal = listUsd(digests);
  const tasks = [...new Set(cells.map((c) => c.task))];
  const perArm = Object.fromEntries(
    ARMS.map((arm) => {
      const mine = cells.filter((c) => c.arm === arm.id);
      const own = usd(mine);
      const perTask = Object.fromEntries(tasks.map((t) => [t, usd(mine.filter((c) => c.task === t))]));
      const perArticle = Object.fromEntries(SLUGS.map((s) => [s, usd(mine.filter((c) => c.slug === s))]));
      return [
        arm.id,
        {
          model: MODEL[arm.model],
          effortRan: effortOf(arm.model).ran,
          effortSent: effortOf(arm.model).sent,
          calls: mine.length,
          failures: mine.filter((c) => !c.ok).map((c) => `${c.slug} ${c.task}: ${c.error}`),
          usd: own,
          usdWithDigest: arm.digest ? own + digestTotal : own,
          listUsd: listUsd(mine),
          listUsdWithDigest: listUsd(mine) + (arm.digest ? digestListTotal : 0),
          outputTokens: tokens(mine, (u) => u.outputTokens),
          reasoningTokens: tokens(mine, (u) => u.reasoningTokens),
          cacheReadTokens: tokens(mine, (u) => u.cacheReadTokens),
          perTask,
          perArticle,
          perArticleWithDigest: Object.fromEntries(
            SLUGS.map((s) => [s, perArticle[s]! + (arm.digest ? (digestBySlug[s]?.usd ?? 0) : 0)]),
          ),
        },
      ];
    }),
  );
  /* Break-even: tasks per article at which Opus-direct costs as much as cheaper-model-plus-digest. */
  const nTasks = new Set(cells.map((c) => `${c.task}`)).size;
  const perTaskAvg = (id: ArmId, list = false) =>
    ((list ? perArm[id]?.listUsd : perArm[id]?.usd) ?? 0) / Math.max(1, cells.filter((c) => c.arm === id).length);
  const completeMatrix = nTasks > 0 && digests.length === SLUGS.length &&
    ARMS.every((arm) => SLUGS.every((slug) => tasks.every((task) =>
      cells.filter((c) => c.arm === arm.id && c.slug === slug && c.task === task).length === 1,
    )));
  const digestAvg = digestTotal / Math.max(1, digests.length);
  const digestListAvg = digestListTotal / Math.max(1, digests.length);
  const breakEvenOf = (list: boolean) =>
    Object.fromEntries(
      (["C-sonnet+digest", "E-haiku+digest"] as const).map((id) => {
        const saving = perTaskAvg("A-opus", list) - perTaskAvg(id, list);
        return [id, completeMatrix && saving > 0 ? (list ? digestListAvg : digestAvg) / saving : null];
      }),
    );
  const breakEven = { billed: breakEvenOf(false), listPriceNoCache: breakEvenOf(true) };
  const ledgerRows = outs.reduce((n, o) => n + o.calls, 0);
  const costs = {
    at: new Date().toISOString(),
    totalUsd: usd(outs),
    completeMatrix,
    ledgerRows,
    digestTotalUsd: digestTotal,
    digestPerArticle: digestBySlug,
    perArm,
    breakEvenTasksPerArticle: breakEven,
    perCall: outs.map((o) => ({
      slug: o.slug,
      task: o.task,
      arm: o.arm,
      ok: o.ok,
      error: o.error,
      answeredBy: o.answeredBy,
      effortRan: o.effortRan,
      usd: o.usd,
      ...o.usage,
      latencyMs: o.latencyMs,
      calls: o.calls,
      generationIds: o.generationIds,
    })),
  };
  write(path.join(OUT, "costs.json"), costs);

  const $ = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `$${n.toFixed(4)}`);
  const lines: string[] = [];
  lines.push("# Digest spike — costs (2026-10-09)", "");
  lines.push(
    `Total **${$(costs.totalUsd)}** over ${outs.length} cells (${ledgerRows} ledger rows, job \`eval\`, scope \`eval\`, local database). ` +
      "Every figure is the gateway's own spend record for the call (`recordUsd`, src/ai-spend.ts: OpenRouter's `usage.cost`).",
    "",
  );
  lines.push("## Effort each arm ran at", "");
  lines.push(
    "Job `eval` sends no `reasoning` except to Opus 5.5, where the gateway's `wireEffort` sends `high`. " +
      "The others run at their provider default: Sonnet 5.5 `high`, Haiku 5.5 `medium`. " +
      "Production sends `high` for Summary and Ideas and nothing (Sonnet) or `high` (Opus) for chat, so **Haiku runs one level below production's ask**. " +
      "The digest also ran at `high`, not the `medium` the brief asked for: the eval route cannot send `medium` to Opus.",
    "",
  );
  lines.push("| arm | model | effort sent | effort ran |", "|---|---|---|---|");
  for (const arm of ARMS) lines.push(`| ${arm.id} | ${MODEL[arm.model]} | ${effortOf(arm.model).sent ?? "none"} | ${effortOf(arm.model).ran} |`);
  lines.push("", "## The digest, per article (paid once per article)", "");
  lines.push("| article | cost | words | ids cited | unknown ids | input tok | output tok | of which thinking | seconds |", "|---|---|---|---|---|---|---|---|---|");
  for (const [s, d] of Object.entries(digestBySlug)) {
    lines.push(`| ${s} | ${$(d.usd)} | ${d.words ?? "—"} | ${d.citedIds ?? "—"} | ${d.unknownIds.length} | ${d.inputTokens ?? "—"} | ${d.outputTokens ?? "—"} | ${d.reasoningTokens ?? "—"} | ${Math.round(d.latencyMs / 1000)} |`);
  }
  lines.push("", `Digest total ${$(digestTotal)}.`, "");
  lines.push("## Per arm: cost to produce these outputs", "");
  lines.push(
    "Billed cost depends on cache order: every call marks the article for caching, so whichever call reached an upstream second could read what the first wrote " +
      "(see the cache-read column: the +digest arms ran after their no-digest twins and read far more), and a write that nobody read cost 1.25× the input price. " +
      "So billed figures flatter the arms that ran second. The list-price column prices every call's input and output tokens at the uncached rate, which compares arms fairly.",
    "",
  );
  lines.push(
    `| arm | calls | failures | billed | billed + digests | list, no cache | list + digests | output tok | of which thinking | cache-read tok | ${tasks.join(" | ")} |`,
    `|---|---|---|---|---|---|---|---|---|---|${tasks.map(() => "---").join("|")}|`,
  );
  for (const [id, a] of Object.entries(perArm)) {
    lines.push(
      `| ${id} | ${a.calls} | ${a.failures.length} | ${$(a.usd)} | ${$(a.usdWithDigest)} | ${$(a.listUsd)} | ${$(a.listUsdWithDigest)} | ${a.outputTokens} | ${a.reasoningTokens} | ${a.cacheReadTokens} | ${tasks.map((t) => $(a.perTask[t])).join(" | ")} |`,
    );
  }
  lines.push("", "(the per-task columns are billed)");
  lines.push("", "Per article, digest amortised over this article's tasks only:", "");
  lines.push(`| arm | ${SLUGS.join(" | ")} |`, `|---|${SLUGS.map(() => "---").join("|")}|`);
  for (const [id, a] of Object.entries(perArm)) {
    lines.push(`| ${id} | ${SLUGS.map((s) => `${$(a.perArticle[s])} / ${$(a.perArticleWithDigest[s])}`).join(" | ")} |`);
  }
  lines.push("", "(without digest / with this article's digest added)", "");
  lines.push("## Break-even", "");
  for (const list of [false, true]) {
    lines.push(
      `**${list ? "List price, no cache" : "Billed"}.** Average task: Opus ${$(perTaskAvg("A-opus", list))}, Sonnet+digest ${$(perTaskAvg("C-sonnet+digest", list))}, ` +
        `Haiku+digest ${$(perTaskAvg("E-haiku+digest", list))}; average digest ${$(list ? digestListAvg : digestAvg)}. ` +
        "Tasks on one article after which a digest plus the cheaper model costs less than Opus alone:",
      "",
    );
    for (const [id, n] of Object.entries(list ? breakEven.listPriceNoCache : breakEven.billed)) {
      lines.push(`- ${id}: ${!completeMatrix ? "unavailable (incomplete matrix)" : n === null ? "never (no saving per task)" : n.toFixed(1)}`);
    }
    lines.push("");
  }
  lines.push("These are cost break-evens only. Whether a cheaper arm's output is as good as Opus's is the judging's question.");
  lines.push("", "## Failures", "");
  const failed = outs.filter((o) => !o.ok);
  if (failed.length === 0) lines.push("None.");
  for (const f of failed) lines.push(`- ${f.slug} ${f.task} ${f.arm}: ${f.error}`);
  lines.push("", "## Per call", "");
  lines.push("| article | task | arm | ok | cost | in | out | thinking | cache read | cache write | s |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const o of outs) {
    lines.push(`| ${o.slug} | ${o.task} | ${o.arm} | ${o.ok ? "yes" : "NO"} | ${$(o.usd)} | ${o.usage.inputTokens ?? "—"} | ${o.usage.outputTokens ?? "—"} | ${o.usage.reasoningTokens ?? "—"} | ${o.usage.cacheReadTokens ?? "—"} | ${o.usage.cacheWriteTokens ?? "—"} | ${Math.round(o.latencyMs / 1000)} |`);
  }
  write(path.join(OUT, "costs.md"), lines.join("\n") + "\n");
  console.log(`costs: $${costs.totalUsd.toFixed(4)} over ${outs.length} cells; written to ${path.relative(process.cwd(), OUT)}/costs.{json,md}`);
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
