/**
 * **One answer cell: an arm answers one example once** — plan 261001s § The
 * arms, § The Opus check, § Cost and latency.
 *
 * Isolated (the main matrix): the arm's request is production's with the
 * declared edits (`isolatedRequest`), streamed through production's runner
 * (`runStream`) on the arm's route, and accepted by its entry point's rule.
 * Production-shaped (the finalist run): `explainStream` itself for a glossary
 * or comment press, and production's own captured Citations request with the
 * model swapped — tool on, production's job and route.
 *
 * Everything paid goes through `paidStep`, so the cell's calls are the
 * gateway's own spend records: cost, tokens, cache, the model that answered,
 * the generation id, the upstream.
 */
import { type AiRequestBody, type StreamOutcome, openRouterJson } from "../../src/ai-call.js";
import type { SpendRecord } from "../../src/ai-spend.js";
import { DIG_ANSWER_TIMEOUT_MS, digSearchRequest } from "../../src/dig-deeper.js";
import { type Usage, whereSearchCountCameFrom } from "../../src/openrouter-stream.js";
import { EXPLAIN_STALL_MS, explainStream } from "../../src/explain.js";
import { runStream } from "../../src/stream-run.js";
import { refuseUnfinished } from "../../src/term-lookup.js";
import type { Block, Meta, SearchEvidence } from "../../src/types.js";
import { untrusted } from "../../src/untrusted-fence.js";
import { acceptCitation, acceptExplain, type Delivery } from "./accept.js";
import {
  type Arm,
  articlePartText,
  checkRequest,
  isolatedRequest,
  jobFor,
  modelMatches,
  readCheckVerdict,
  systemText,
} from "./arms.js";
import { type Budget, type Ledger, paidStep, recordUsd, requestChars, upperBoundUsd } from "./budget.js";
import type { Capture } from "./capture.js";
import { type CellBase, hashOf } from "./manifest.js";

/** One paid call of a cell, from the ledger's record plus our clock. */
export interface CallObs {
  role: "answer" | "draft" | "check";
  job: string;
  requested: string;
  returned: string | null;
  generationId: string | null;
  upstream: string | null;
  /** BYOK-aware dollars (`recordUsd`); `isByok` says whether that is credits or somebody's own key. */
  usd: number | null;
  isByok: boolean | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  ttftMs: number | null;
  totalMs: number;
  ending: StreamOutcome["kind"] | null;
  finishReason: string | null;
}

export interface AnswerCell extends CellBase {
  example: string;
  arm: string;
  run: number;
  mode: "isolated" | "production";
  ceiling: number;
  delivery: Delivery;
  /** The text the reader would have got, delivered or not — for diagnosis, never judged unless delivered. */
  raw: string;
  words: number;
  calls: CallObs[];
  check: { verdict: "keep" | "replace" | "invalid"; draftEnding: string | null } | null;
  /** How much of each request is the cached prefix (system + article), by characters. */
  prefixShare: number;
  /** The answer's part of what the reader waits: first token, or for the check the draft and the verdict. */
  firstWordMs: number | null;
  /** Something went wrong outside the acceptance rule: a refusal, a wrong model, an unreadable check. */
  failure: string | null;
}

export const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/** What one streamed call gave back, or the error that ended it. */
interface Streamed {
  role: CallObs["role"];
  requested: string;
  job: string;
  text: string;
  deltas: string[];
  kind: StreamOutcome["kind"] | null;
  finishReason: string | null;
  evidence: SearchEvidence[];
  ttftMs: number | null;
  totalMs: number;
  error: string | null;
}

async function streamOnce(
  role: CallObs["role"],
  job: "dig-deeper" | "eval" | "citation-investigate",
  request: AiRequestBody,
  collectEvidence: boolean,
): Promise<Streamed> {
  const started = Date.now();
  const out: Streamed = {
    role,
    requested: request.model,
    job,
    text: "",
    deltas: [],
    kind: null,
    finishReason: null,
    evidence: [],
    ttftMs: null,
    totalMs: 0,
    error: null,
  };
  try {
    for await (const ev of runStream({
      job,
      request,
      /* Production's clocks: a model too slow for them is a press that fails in production too. */
      timeoutMs: DIG_ANSWER_TIMEOUT_MS,
      stallMs: EXPLAIN_STALL_MS,
      collectEvidence,
    })) {
      if (ev.type === "delta") {
        out.ttftMs ??= Date.now() - started;
        out.deltas.push(ev.text);
        out.text += ev.text;
      } else {
        out.kind = ev.outcome.kind;
        out.finishReason = ev.finishReason;
        out.evidence = ev.evidence ?? [];
      }
    }
  } catch (err) {
    out.error = `${(err as { status?: number }).status ? `HTTP ${(err as { status?: number }).status}: ` : ""}${(err as Error).message}`;
  }
  out.totalMs = Date.now() - started;
  return out;
}

function observe(s: Streamed, record: SpendRecord | undefined): CallObs {
  return {
    role: s.role,
    job: s.job,
    requested: s.requested,
    returned: record?.answeredBy ?? null,
    generationId: record?.generationId ?? null,
    upstream: record?.upstream ?? null,
    usd: record ? recordUsd(record) : null,
    isByok: record?.isByok ?? null,
    inputTokens: record?.inputTokens ?? null,
    outputTokens: record?.outputTokens ?? null,
    cacheReadTokens: record?.cacheReadTokens ?? null,
    cacheWriteTokens: record?.cacheWriteTokens ?? null,
    reasoningTokens: record?.reasoningTokens ?? null,
    ttftMs: s.ttftMs,
    totalMs: s.totalMs,
    ending: s.kind,
    finishReason: s.finishReason,
  };
}

/** The share of a request's characters that sit in the cached prefix. */
export function prefixShareOf(request: AiRequestBody): number {
  const prefix = systemText(request).length + articlePartText(request).length;
  return prefix / JSON.stringify(request.messages).length;
}

export interface CellInputs {
  capture: Capture;
  arm: Arm;
  ceiling: number;
  mode: "isolated" | "production";
  /** The article, for the Citations guard and for `explainStream`. */
  article: { meta: Meta; blocks: Block[] };
}

/** The requests a cell will send, as values — what its key is made of and what the test reads. */
export function cellRequests(inp: CellInputs): { job: string; request: AiRequestBody }[] {
  const { capture, arm, ceiling, mode } = inp;
  const prod = capture.production.request;
  const sized = (r: AiRequestBody): AiRequestBody => ({ ...r, max_tokens: ceiling });
  if (mode === "production") {
    if (arm.kind !== "single") throw new Error(`${arm.id}: the production-shaped run takes single-model arms`);
    return [{ job: capture.production.job, request: sized({ ...prod, model: arm.model }) }];
  }
  if (arm.kind === "single") {
    return [{ job: jobFor(arm.model), request: sized(isolatedRequest(prod, capture.entry, arm.model)) }];
  }
  return [
    { job: jobFor(arm.draft), request: sized(isolatedRequest(prod, capture.entry, arm.draft)) },
    /* The checker's base: the Opus arm's own request, so it reads Opus's cached prefix. */
    { job: jobFor(arm.checker), request: sized(isolatedRequest(prod, capture.entry, arm.checker)) },
  ];
}

export function answerKey(inp: CellInputs, captureSha: string, source: string): string {
  return hashOf({
    requests: cellRequests(inp),
    captureSha,
    arm: inp.arm,
    ceiling: inp.ceiling,
    mode: inp.mode,
    source,
  });
}

function accept(inp: CellInputs, kind: StreamOutcome["kind"], deltas: string[], text: string, ownEvidence: SearchEvidence[]): Delivery {
  const { capture } = inp;
  if (capture.entry === "citation") {
    const c = capture.citation;
    if (!c) throw new Error(`${capture.exampleId}: a Citations capture without its citation inputs`);
    return acceptCitation(kind, deltas, {
      blocks: inp.article.blocks,
      context: c.context,
      matched: c.matched,
      findings: capture.findings,
      ownEvidence,
      paperRead: c.paperRead,
    });
  }
  return acceptExplain(capture.entry, kind, text);
}

/**
 * **Answer one cell.** Never throws for a model's failure — that is a cell
 * with `failure` set, which is a result. Throws only for the budget (refused
 * or halted) and for a broken capture.
 */
export async function answerCell(
  inp: CellInputs,
  meta: { slot: string; key: string; commit: string; example: string; run: number },
  budget: Budget,
  ledger: Ledger,
): Promise<AnswerCell> {
  const requests = cellRequests(inp);
  const boundUsd = requests.reduce((n, r) => n + upperBoundUsd(r.request.model, requestChars(r.request), inp.ceiling), 0);
  const isCitation = inp.capture.entry === "citation";

  type Outcome = { streams: Streamed[]; delivery: Delivery; raw: string; check: AnswerCell["check"]; failure: string | null };
  const { result, spent } = await paidStep(
    budget,
    { id: `${meta.slot}#${meta.key.slice(0, 12)}`, label: meta.slot, boundUsd },
    ledger,
    async (): Promise<Outcome> => {
      /* ---- production-shaped glossary / comment: explainStream itself ---- */
      if (inp.mode === "production" && !isCitation) {
        const ex = inp.capture.explain;
        if (!ex) throw new Error(`${inp.capture.exampleId}: no explain inputs in the capture`);
        const started = Date.now();
        const s: Streamed = {
          role: "answer",
          requested: requests[0]?.request.model ?? "",
          job: "dig-deeper",
          text: "",
          deltas: [],
          kind: null,
          finishReason: null,
          evidence: [],
          ttftMs: null,
          totalMs: 0,
          error: null,
        };
        let delivery: Delivery | null = null;
        try {
          for await (const ev of explainStream({
            meta: inp.article.meta,
            blocks: inp.article.blocks,
            blockId: ex.blockId,
            quote: ex.quote,
            dig: inp.capture.findings,
            power: "high",
            model: s.requested,
          })) {
            if (ev.type === "delta") {
              s.ttftMs ??= Date.now() - started;
              s.text += ev.text;
            } else {
              s.kind = ev.ending;
              if (inp.capture.entry === "glossary") {
                try {
                  refuseUnfinished(ev.ending);
                  delivery = { delivered: true, answer: ev.answer, ending: ev.ending };
                } catch (err) {
                  delivery = { delivered: false, why: `the glossary refuses ${ev.ending}: ${(err as Error).message}`, ending: ev.ending };
                }
              } else {
                delivery = { delivered: true, answer: ev.answer, ending: ev.ending };
              }
            }
          }
        } catch (err) {
          s.error = (err as Error).message;
        }
        s.totalMs = Date.now() - started;
        return {
          streams: [s],
          delivery: delivery ?? { delivered: false, why: `explainStream threw: ${s.error ?? "no done"}`, ending: s.kind },
          raw: s.text,
          check: null,
          failure: s.error,
        };
      }

      const first = requests[0];
      if (!first) throw new Error("no request");
      const job = first.job as "dig-deeper" | "eval" | "citation-investigate";
      const a = await streamOnce(inp.arm.kind === "check" ? "draft" : "answer", job, first.request, isCitation && inp.mode === "production");
      if (a.error || a.kind === null) {
        return {
          streams: [a],
          delivery: { delivered: false, why: `the call failed: ${a.error ?? "no end"}`, ending: a.kind },
          raw: a.text,
          check: null,
          failure: a.error ?? "no end",
        };
      }
      if (inp.arm.kind === "single") {
        return { streams: [a], delivery: accept(inp, a.kind, a.deltas, a.text, a.evidence), raw: a.text, check: null, failure: null };
      }

      /* ---- Luna wrote; Opus checks ---- */
      const base = requests[1];
      if (!base) throw new Error("no checker request");
      const c = await streamOnce("check", base.job as "dig-deeper", checkRequest(base.request, a.text.trim(), untrusted), false);
      if (c.error || c.kind === null) {
        return {
          streams: [a, c],
          delivery: { delivered: false, why: `the check failed: ${c.error ?? "no end"}`, ending: c.kind },
          raw: a.text,
          check: { verdict: "invalid", draftEnding: a.kind },
          failure: c.error ?? "no end",
        };
      }
      const verdict = c.kind === "finished" ? readCheckVerdict(c.text) : null;
      if (!verdict) {
        return {
          streams: [a, c],
          delivery: { delivered: false, why: `the check's reply was not a valid verdict (${c.kind})`, ending: c.kind },
          raw: c.text,
          check: { verdict: "invalid", draftEnding: a.kind },
          failure: null,
        };
      }
      if (verdict.action === "keep") {
        return {
          streams: [a, c],
          delivery: accept(inp, a.kind, a.deltas, a.text, []),
          raw: a.text,
          check: { verdict: "keep", draftEnding: a.kind },
          failure: null,
        };
      }
      return {
        streams: [a, c],
        /* A replacement is not streamed: one chunk through the guard, its ending the check's. */
        delivery: accept(inp, c.kind, [verdict.answer], verdict.answer, []),
        raw: verdict.answer,
        check: { verdict: "replace", draftEnding: a.kind },
        failure: null,
      };
    },
  );

  /* Pair each stream with its ledger record, in call order. */
  const calls = result.streams.map((s, i) => observe(s, spent.calls[i]));
  let failure = result.failure;
  let delivery = result.delivery;
  for (const c of calls) {
    if (c.returned !== null && !modelMatches(c.requested, c.returned)) {
      failure = `asked for ${c.requested}, answered by ${c.returned}`;
      delivery = { delivered: false, why: failure, ending: delivery.ending };
    } else if (c.returned === null && !failure) {
      failure = `${c.requested}: no model named in the response`;
      delivery = { delivered: false, why: failure, ending: delivery.ending };
    }
  }
  const draft = calls[0];
  const firstWordMs =
    inp.arm.kind === "check"
      ? calls.length === 2 && draft
        ? draft.totalMs + (calls[1]?.totalMs ?? 0)
        : null
      : (draft?.ttftMs ?? null);
  const firstRequest = requests[0]?.request;
  return {
    slot: meta.slot,
    key: meta.key,
    at: new Date().toISOString(),
    commit: meta.commit,
    example: meta.example,
    arm: inp.arm.id,
    run: meta.run,
    mode: inp.mode,
    ceiling: inp.ceiling,
    delivery,
    raw: result.raw,
    words: words(delivery.delivered ? delivery.answer : result.raw),
    calls,
    check: result.check,
    prefixShare: firstRequest ? prefixShareOf(firstRequest) : 0,
    firstWordMs,
    failure,
  };
}

/* ------------------------------------------------- the forced-search probe -- */

/**
 * **Can this model run its own forced search?** One call per finalist:
 * production's search-step request (`digSearchRequest`, `tool_choice:
 * "required"`, the Exa tool) with the model swapped. A compatibility note for
 * whether the Luna step could go, not evidence about search quality (plan §
 * Holding the search step fixed, Sol F2).
 */
export async function probeForcedSearch(
  model: string,
  req: Parameters<typeof digSearchRequest>[0],
  budget: Budget,
  ledger: Ledger,
  id: string,
): Promise<{ ok: boolean; searches: number | null; status: string; usd: number | null; returned: string | null }> {
  const body = { ...digSearchRequest(req), model };
  const { result, spent } = await paidStep(
    budget,
    { id, label: `probe ${model}`, boundUsd: upperBoundUsd(model, requestChars(body), Number((body as Record<string, unknown>).max_completion_tokens ?? 2_000), 0.05) },
    ledger,
    async () => {
      try {
        const call = await openRouterJson(jobFor(model), body, { signal: AbortSignal.timeout(60_000) });
        return { json: call.json as { usage?: Usage } | null, error: null as string | null };
      } catch (err) {
        const status = (err as { status?: number }).status;
        return { json: null, error: `${status ? `HTTP ${status}` : "error"}: ${(err as Error).message}` };
      }
    },
  );
  const record = spent.calls[0];
  const returned = record?.answeredBy ?? null;
  const usd = record ? recordUsd(record) : null;
  if (result.error) return { ok: false, searches: null, status: result.error, usd, returned };
  if (!modelMatches(model, returned)) return { ok: false, searches: null, status: `answered by ${returned}`, usd, returned };
  const { searches, from } = whereSearchCountCameFrom(result.json?.usage);
  return { ok: (searches ?? 0) > 0, searches, status: `searches from ${from}`, usd, returned };
}
