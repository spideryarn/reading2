/**
 * One paid call, with its record, and the ledger the cap is enforced from.
 * Plan 261005j § Stage 2.
 *
 * Every call goes through `streamMessage("structure", …)`, the gateway the
 * structure step uses, inside a `collectSpend` scope of kind `eval`. The scope's
 * sink is the ledger file here, not `ai_calls`: this eval writes nothing to the
 * database. One line per network attempt, with the provider's own cost.
 *
 * **The re-ask rule is production's** (src/structure-slices.ts § `ask`): an
 * answer that came back whole and did not pass is asked for once more; a
 * refused or cut-short answer and a call that did not come back are not.
 * Transport retries before the response begins are `streamMessage`'s own and
 * show as extra network attempts on the same record.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { type AiCallRow, type CollectOptions, collectSpend, totalSpend } from "../../src/ai-spend.js";
import { estimateTokens } from "../../src/article-prompt.js";
import { finishedText, type MessagesBody, streamMessage, wasRefused } from "../../src/messages-stream.js";
import { modelFor, type ModelPower } from "../../src/models.js";
import { environmentOwnerId } from "../../src/owner.js";
import { MalformedJson } from "../../src/parse-json.js";
import { costStore } from "../../src/store/ai-calls.js";
import { ExpansionRefused } from "../../src/structure-cascade.js";
import { priceOf } from "../dig-deeper/arms.js";

export const POWER: ModelPower = "standard";

/** Why a call, or a cell, did not give what was asked. */
export type FailureReason =
  /* The call did not come back: a dropped connection, a 5xx, a 429. */
  | "transport"
  | "timeout"
  | "refused"
  | "truncated"
  /* The answer came back whole and is not the JSON asked for. */
  | "parse"
  /* The JSON is right and its starts do not divide the blocks it was given. */
  | "tiling";

export interface CallRecord {
  purpose: string;
  /** Which part or piece, where the purpose has several. */
  unit?: string;
  /** 1, or 2 for the one re-ask. */
  attempt: number;
  startedAt: string;
  endedAt: string;
  ms: number;
  /** How many network requests this was: more than 1 means a transport retry. */
  networkAttempts: number;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  usd: number;
  /** Network attempts the provider gave no cost for. Their cost is unknown, not zero. */
  unpriced: number;
  outcome: "ok" | FailureReason;
  /** A content-free note: an error's class and reason, never the article's words. */
  detail?: string;
}

/** Thrown when the next call would take the ledger past the cap. The cell is left unfinished. */
export class CapReached extends Error {
  constructor(readonly totalUsd: number, readonly capUsd: number, readonly wantedUsd: number) {
    super(`The cap is $${capUsd.toFixed(2)}; $${totalUsd.toFixed(4)} is spent or in flight and the next call is estimated at $${wantedUsd.toFixed(4)}.`);
    this.name = "CapReached";
  }
}

interface LedgerLine {
  at: string;
  cell: string;
  purpose: string;
  unit?: string;
  attempt: number;
  fake: boolean;
  usd: number;
  row: Partial<AiCallRow>;
}

const KEPT: readonly (keyof AiCallRow)[] = [
  "runId", "generationId", "scopeKind", "articleSlug", "wire", "job", "requestedModel", "answeredModel", "upstream",
  "startedAt", "finishedAt", "durationMs", "outcome", "creditsUsedNanos", "byokUpstreamNanos", "costSource", "isByok",
  "reportedInputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens",
];

/* Both pockets: what OpenRouter charged, and under BYOK what the upstream charged the key behind it (the Sol judge is BYOK here, and its rows read $0 until this added the second). */
const usdOfRow = (row: AiCallRow): number => ((row.creditsUsedNanos ?? 0) + (row.isByok ? (row.byokUpstreamNanos ?? 0) : 0)) / 1e9;

/**
 * The spend so far, on disk, and what is in flight. `--cap-usd` is enforced
 * from here: the total is read back from the file when a run starts, so a
 * resumed run keeps counting from where the last one stopped.
 */
export class Ledger {
  private spent = 0;
  private reserved = 0;
  lines = 0;

  constructor(readonly file: string, readonly capUsd: number, readonly fake: boolean) {
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        this.spent += (JSON.parse(line) as LedgerLine).usd;
        this.lines += 1;
      }
    }
  }

  total(): number {
    return this.spent;
  }

  /** Reserve an estimate before a call, or throw `CapReached`. Returns the release. */
  admit(estimateUsd: number): () => void {
    if (this.spent + this.reserved + estimateUsd > this.capUsd) {
      throw new CapReached(this.spent + this.reserved, this.capUsd, estimateUsd);
    }
    this.reserved += estimateUsd;
    let released = false;
    return () => {
      if (!released) this.reserved -= estimateUsd;
      released = true;
    };
  }

  write(cell: string, purpose: string, unit: string | undefined, attempt: number, row: AiCallRow): void {
    const kept: Partial<AiCallRow> = {};
    for (const k of KEPT) (kept as Record<string, unknown>)[k] = row[k];
    const line: LedgerLine = {
      at: new Date().toISOString(),
      cell,
      purpose,
      ...(unit !== undefined ? { unit } : {}),
      attempt,
      fake: this.fake,
      usd: usdOfRow(row),
      row: kept,
    };
    appendFileSync(this.file, `${JSON.stringify(line)}\n`);
    this.spent += line.usd;
    this.lines += 1;
  }
}

/**
 * What a call is likely to cost, for admission against the cap only: the
 * request at four characters a token, and the answer's estimate plus as much
 * again for thinking. The ledger records what the provider then charged.
 */
export function estimateUsd(params: MessagesBody, answerTokens: number): number {
  const price = priceOf(modelFor("structure", POWER));
  const input = estimateTokens(JSON.stringify({ system: params.system, messages: params.messages }));
  return (input * price.input + (answerTokens * 2 + 4000) * price.output) / 1e6;
}

/** The request's size as the fit check counts it: prompt and blocks at four characters a token. */
export function requestTokens(params: MessagesBody): number {
  return estimateTokens(JSON.stringify({ system: params.system, messages: params.messages }));
}

export interface CallContext {
  /** `doc.arm.run`, for the ledger. */
  cell: string;
  slug: string;
  ledger: Ledger;
  calls: CallRecord[];
}

export interface Question<T> {
  purpose: string;
  unit?: string;
  params: MessagesBody;
  maxTokens: number;
  answerTokens: number;
  headroom?: number;
  capMs: number;
  /** Turn the answer's text into what was asked for, or throw. */
  accept: (text: string) => T;
}

export type Asked<T> = { ok: true; value: T } | { ok: false; reason: FailureReason };

/** A parse fault or a tiling fault, from the error an `accept` threw. */
function classify(err: unknown): "parse" | "tiling" {
  if (err instanceof MalformedJson || err instanceof ShapeFault) return "parse";
  if (err instanceof ExpansionRefused) {
    return err.reason === "invented-start" || err.reason === "outside-parent" || err.reason === "not-an-expansion" ? "tiling" : "parse";
  }
  return "tiling";
}

/**
 * **The collector for one of this eval's calls: rows kept for its own ledger
 * file, and on a real run written to `ai_calls` too.** Every paid call an eval
 * makes goes in the shared ledger (an eval's spend is refused without one,
 * src/ai-spend.ts § UnrecordedSpendRefused). A dry run's fake model reports
 * invented costs, so on a dry run (`ledger.fake`) nothing reaches the database
 * and the run does not need one. The rows are pushed first, so this eval's own
 * accounting does not wait on the database.
 */
export function evalSpend(ledger: Ledger, articleSlug: string, rows: AiCallRow[]): CollectOptions {
  if (ledger.fake) {
    return {
      attribution: { scopeKind: "eval", articleSlug },
      sink: async (row) => {
        rows.push(row);
      },
    };
  }
  return {
    attribution: { scopeKind: "eval", ownerId: environmentOwnerId(), articleSlug },
    sink: async (row) => {
      rows.push(row);
      await costStore.record(row);
    },
  };
}

/** Thrown by an `accept` for an answer that is JSON and not the shape asked for. */
export class ShapeFault extends Error {}

const errorClass = (err: unknown): string =>
  err instanceof ExpansionRefused ? `ExpansionRefused:${err.reason}` : err instanceof Error ? err.name : typeof err;

/** One question: up to two calls, each recorded, each in the ledger. Never throws except `CapReached`. */
export async function ask<T>(ctx: CallContext, q: Question<T>): Promise<Asked<T>> {
  for (let attempt = 1; ; attempt++) {
    const release = ctx.ledger.admit(estimateUsd(q.params, q.answerTokens));
    const started = Date.now();
    const rows: AiCallRow[] = [];
    let networkAttempts = 0;
    let message: Anthropic.Message | null = null;
    let threw: unknown;
    const signal = AbortSignal.timeout(q.capMs);
    const { report } = await collectSpend(
      async () => {
        const call = streamMessage("structure", q.params, { power: POWER, signal });
        try {
          message = await call.finalMessage();
        } catch (err) {
          threw = err;
        } finally {
          networkAttempts = call.attempts();
        }
      },
      evalSpend(ctx.ledger, ctx.slug, rows),
    );
    release();
    for (const row of rows) ctx.ledger.write(ctx.cell, q.purpose, q.unit, attempt, row);
    const spent = totalSpend(report.calls);
    const last = report.calls.at(-1);
    const base = {
      purpose: q.purpose,
      ...(q.unit !== undefined ? { unit: q.unit } : {}),
      attempt,
      startedAt: new Date(started).toISOString(),
      endedAt: new Date().toISOString(),
      ms: Date.now() - started,
      networkAttempts,
      inputTokens: last?.inputTokens ?? null,
      outputTokens: last?.outputTokens ?? null,
      reasoningTokens: last?.reasoningTokens ?? null,
      cacheReadTokens: last?.cacheReadTokens ?? null,
      usd: spent.nanos / 1e9,
      unpriced: spent.unpriced,
    };
    const fail = (outcome: FailureReason, err: unknown): Asked<T> => {
      ctx.calls.push({ ...base, outcome, detail: errorClass(err) });
      return { ok: false, reason: outcome };
    };
    if (message === null) return fail(signal.aborted ? "timeout" : "transport", threw);
    const got: Anthropic.Message = message;
    let text: string;
    try {
      text = finishedText(got, q.purpose, q.maxTokens, q.answerTokens, q.headroom);
    } catch (err) {
      return fail(wasRefused(got) ? "refused" : "truncated", err);
    }
    try {
      const value = q.accept(text);
      ctx.calls.push({ ...base, outcome: "ok" });
      return { ok: true, value };
    } catch (err) {
      const failed = fail(classify(err), err);
      if (attempt >= 2) return failed;
    }
  }
}

/** `jobs`, at most `width` at once. `inPool` in src/structure-slices.ts is the same and is not exported. */
export async function inPool<T>(width: number, jobs: (() => Promise<T>)[]): Promise<T[]> {
  const out = new Array<T>(jobs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, worker));
  return out;
}

/** The model's context window, from OpenRouter's own listing. Free. */
export async function contextTokensOf(model: string): Promise<number> {
  const response = await fetch("https://openrouter.ai/api/v1/models");
  if (!response.ok) throw new Error(`The models listing answered ${response.status}.`);
  const { data } = (await response.json()) as { data: { id: string; context_length?: number }[] };
  const found = data.find((m) => m.id === model)?.context_length;
  if (typeof found !== "number") throw new Error(`The models listing has no context length for ${model}.`);
  return found;
}

/** The ledger rows of one scope that was not asked through `ask` (the slices path), as call records. */
export function recordsFromRows(rows: readonly AiCallRow[], purposeOf: (row: AiCallRow, i: number) => string): CallRecord[] {
  return [...rows]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((row, i) => ({
      purpose: purposeOf(row, i),
      attempt: 1,
      startedAt: row.startedAt,
      endedAt: row.finishedAt,
      ms: row.durationMs ?? 0,
      networkAttempts: 1,
      inputTokens: row.reportedInputTokens,
      outputTokens: row.outputTokens,
      reasoningTokens: row.reasoningTokens,
      cacheReadTokens: row.cacheReadTokens,
      usd: usdOfRow(row),
      unpriced: row.creditsUsedNanos === null ? 1 : 0,
      outcome: row.outcome === "ok" ? ("ok" as const) : ("transport" as const),
    }));
}
