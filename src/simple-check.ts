/**
 * **Simple's fidelity guard** — after a level is written, a second, cheaper
 * model reads each paragraph beside the passages it cites and says whether
 * those passages contradict it.
 *
 * docs/plans/261001i-simple-fidelity-guard-built.md is the design; the evidence
 * is docs/plans/261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md
 * § Measuring the guard. The fault it was built for: on the PID paper, Simple
 * wrote that synergy *"grows with more feedback loops"*, borrowing the paper's
 * name for the connection type that does the opposite. A prompt rule did not
 * make that rare; this checker caught 24 of 30 hand-labelled faults, alarmed
 * on 1–2% of other paragraphs, and costs about $0.0027 a press.
 *
 * What it can't do: it reads only each paragraph's own cited passages, so a
 * claim that is wrong about the article but not contradicted by those passages
 * passes (3 of the 30). That is the price of a small evidence packet.
 *
 * src/simple-summary.ts § `writeLevel` decides what a verdict does: a flag buys
 * the level's one remaining attempt, and the second attempt is stored whatever
 * its verdict. **This file never throws.** A failed or unreadable check is an
 * outcome, `failed`, and the level is stored unchecked: the guard can cost a
 * reader a few seconds, never a summary.
 */

import { openRouterJson } from "./ai-call.js";
import { modelFor } from "./models.js";
import type { SimpleCheckFailure, SimpleCheckFlag, SimpleLevelCheck, SimpleParagraph } from "./types.js";

/**
 * **The switch.** `false`, and deployed, turns the guard off completely: no
 * checker call, no retry for a flag, and no `check` record on the artefact —
 * which is how a row written without the guard reads. For when the spend or the
 * wait turns out to be wrong in production.
 */
export const SIMPLE_CHECK_ENABLED = true;

/**
 * Which checker prompt judged a level, stored in every record. Bump it when
 * `SIMPLE_CHECK_SYSTEM` or the message shape changes: the rates measured in
 * 261001h belong to `/1`, and a changed prompt is a new measurement.
 */
export const SIMPLE_CHECK_VERSION = "simple-check/1";

/**
 * A check that has not answered in this long is a failed check. The measured
 * three-call press took 4.4 s median, 5.8 s p90 and 12.2 s at worst.
 */
export const CHECK_TIMEOUT_MS = 30_000;

/** The answer's ceiling: the measured request's, which no answer reached. */
export const CHECK_MAX_TOKENS = 4_000;

/**
 * The checker's instructions — **byte for byte the prompt 261001h measured**
 * (scripts/probes/261001h-fidelity-guard-probe.ts). It names the class of
 * fault, never the PID paper or the word "feedback", and it was not tuned on
 * the results. Not plain words, on purpose: a verdict nobody reads
 * (`PLAIN_WORDS_EXEMPT`, src/plain-words.ts).
 */
export const SIMPLE_CHECK_SYSTEM = `You check a short plain-words summary of an article against the article's own passages.

You get numbered summary paragraphs. Each comes with the passages it cites, quoted exactly from the article. For each paragraph, decide whether anything it says is contradicted by its passages:

- "contradicts": a claim the passages say the opposite of, or a finding pinned to the wrong thing. That includes a direction turned round (a rise called a fall, A causing B called B causing A), and calling something by the name the passages use for a different thing, so that a finding about one is told about the other — even when the everyday meaning of the words would fit.
- "ok": everything it says agrees with its passages, or is simply not covered by them. Simplifying, leaving things out, and everyday wording are fine. Something the passages do not mention is "ok", not "contradicts".

Be strict about contradictions and lenient about everything else. Only the passages count: not what you know about the subject.

Answer with JSON only, no prose around it:
{"verdicts":[{"n":1,"verdict":"ok"|"contradicts","why":"<one short sentence, only for contradicts>"}]}
with one entry per paragraph, in order.`;

/** Every paragraph with the text of its own cited blocks, and nothing else of the article. */
export function checkMessage(paragraphs: readonly SimpleParagraph[], textOf: ReadonlyMap<string, string>): string {
  return paragraphs
    .map((p, i) => {
      const passages = p.ids.map((id) => `[${id}] ${textOf.get(id) ?? ""}`).join("\n\n");
      return `PARAGRAPH ${i + 1}\n${p.text}\n\nITS PASSAGES\n${passages}`;
    })
    .join("\n\n=====\n\n");
}

export type CheckVerdict = { verdict: "ok" } | { verdict: "contradicts"; why: string };

/**
 * One verdict per paragraph, in order, or `null` for anything else — a count
 * that does not match, a verdict we do not know, numbering out of order, no
 * JSON at all. `null` is a failed check, never a pass: a guard that read an
 * unreadable answer as "ok" would be one that never checks.
 */
export function parseCheckVerdicts(content: string, count: number): CheckVerdict[] | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = parsed && typeof parsed === "object" ? (parsed as { verdicts?: unknown }).verdicts : undefined;
  if (!Array.isArray(list) || list.length !== count) return null;
  const out: CheckVerdict[] = [];
  for (const [i, item] of list.entries()) {
    if (!item || typeof item !== "object") return null;
    const v = item as { n?: unknown; verdict?: unknown; why?: unknown };
    if (v.n !== undefined && v.n !== i + 1) return null;
    if (v.verdict === "ok") out.push({ verdict: "ok" });
    else if (v.verdict === "contradicts") out.push({ verdict: "contradicts", why: typeof v.why === "string" ? v.why.trim() : "" });
    else return null;
  }
  return out;
}

/** What one check came to. `failed` is the checker's own failure, never the level's. */
export type CheckOutcome =
  | { kind: "passed" }
  | { kind: "flagged"; flags: SimpleCheckFlag[] }
  | { kind: "failed"; failure: SimpleCheckFailure };

export interface CheckResult {
  outcome: CheckOutcome;
  /** Chat-wire token counts, when the provider reported them. Never added to the writer's. */
  inputTokens: number;
  outputTokens: number;
}

/**
 * Check one written level. **Never throws**: every failure is an outcome. The
 * call is metered by the gateway like any other, as job `simple-check`, inside
 * whatever collector the caller is in — the `simple` step's, in a press.
 *
 * The caller's signal is passed through, so a cancelled job or an aborted
 * sibling stops the check; the caller decides whether that is an abort.
 */
export async function checkLevel(
  paragraphs: readonly SimpleParagraph[],
  textOf: ReadonlyMap<string, string>,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<CheckResult> {
  const { signal } = opts;
  /* The checker's own deadline is a failed check, stored unchecked; the
     caller's signal is the job's, and the caller turns that into an abort. */
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? CHECK_TIMEOUT_MS);
  try {
    const call = await openRouterJson(
      "simple-check",
      {
        /* Quick tier: High-powered AI does not move it, as with `quiz-verdict`. */
        model: modelFor("simple-check", "standard"),
        max_completion_tokens: CHECK_MAX_TOKENS,
        messages: [
          { role: "system", content: SIMPLE_CHECK_SYSTEM },
          { role: "user", content: checkMessage(paragraphs, textOf) },
        ],
      },
      { signal: signal ? AbortSignal.any([signal, deadline]) : deadline },
    );
    const body = call.json as {
      choices?: { message?: { content?: unknown } }[];
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    } | null;
    const tokens = {
      inputTokens: typeof body?.usage?.prompt_tokens === "number" ? body.usage.prompt_tokens : 0,
      outputTokens: typeof body?.usage?.completion_tokens === "number" ? body.usage.completion_tokens : 0,
    };
    const content = body?.choices?.[0]?.message?.content;
    const verdicts = typeof content === "string" ? parseCheckVerdicts(content, paragraphs.length) : null;
    if (!verdicts) return { outcome: { kind: "failed", failure: "unreadable" }, ...tokens };
    const flags = verdicts.flatMap((v, paragraph) => (v.verdict === "contradicts" ? [{ paragraph, why: v.why }] : []));
    return { outcome: flags.length ? { kind: "flagged", flags } : { kind: "passed" }, ...tokens };
  } catch {
    /* A refusal, a timeout, a network failure, an abort. The gateway has
       already metered the attempt, with its outcome; nothing else here is
       worth logging, and the why would carry the article's words. */
    return { outcome: { kind: "failed", failure: "call" }, inputTokens: 0, outputTokens: 0 };
  }
}

/* ---------------------------------------------------------- the counting -- */

/**
 * The guard's rates over a set of stored levels — what
 * scripts/simple-check-report.ts prints. Pure, so its arithmetic is tested
 * rather than trusted.
 *
 * **What it sees and does not**: only levels that were stored, once each. A
 * press that failed for another reason stores nothing, and a re-run replaces
 * the record it had; the checker calls of both are still `ai_calls` rows of
 * purpose `simple-check`, which the report counts beside this.
 */
export interface CheckTally {
  /** Stored levels with a record. */
  levels: number;
  /** Levels whose first check answered (passed or flagged), the flag rate's denominator. */
  firstAnswered: number;
  /** Levels whose first check flagged them: a retry bought, or a spent budget. */
  firstFlagged: number;
  /** A flag bought another writer call. */
  retriedAfterFlag: number;
  /** That retry failed and the flagged first attempt was kept. */
  keptFirst: number;
  /** Validation had spent the first attempt, so a flag could not buy another. */
  budgetSpent: number;
  /** Stored with a flag on the text the reader sees. */
  storedFlagged: number;
  /** Stored unchecked, by why — on the first check or the retry's. */
  unchecked: Record<SimpleCheckFailure, number>;
}

export function tallyChecks(checks: Iterable<SimpleLevelCheck>): CheckTally {
  const t: CheckTally = {
    levels: 0,
    firstAnswered: 0,
    firstFlagged: 0,
    retriedAfterFlag: 0,
    keptFirst: 0,
    budgetSpent: 0,
    storedFlagged: 0,
    unchecked: { call: 0, unreadable: 0 },
  };
  for (const c of checks) {
    t.levels += 1;
    if (c.retriedAfterFlag) t.retriedAfterFlag += 1;
    if (c.retriedAfterFlag && c.stored === 1) t.keptFirst += 1;
    if (c.result === "flagged") t.storedFlagged += 1;
    if (c.result === "flagged" && !c.retriedAfterFlag) t.budgetSpent += 1;
    if (c.result === "unchecked") t.unchecked[c.failure] += 1;
    /* The first check flagged it if it bought a retry, or if it is stored
       flagged without one; it failed if it is stored unchecked without one. */
    const firstFailed = c.result === "unchecked" && !c.retriedAfterFlag;
    if (!firstFailed) t.firstAnswered += 1;
    if (c.retriedAfterFlag || (c.result === "flagged" && !c.retriedAfterFlag)) t.firstFlagged += 1;
  }
  return t;
}
