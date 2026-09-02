/**
 * The cost eval's arithmetic — ledger rows in, a per-step table and a verdict
 * out. **No IO, no database, no model**, so all of it is unit-tested in
 * tests/cost-eval.test.ts against fixture rows; run.ts does the driving and
 * calls in here for every number it prints.
 *
 * Same split as evals/hierarchy-structure/{score,run}.ts, and for the same
 * reason: the part that costs money cannot be a test, so the part that does not
 * must be one.
 *
 * ## The four things this file exists to stop us getting wrong
 *
 * 1. **A total is not a sum over the money columns.** `totalRows`
 *    (src/store/ai-calls.ts) is the one implementation of the arithmetic, and
 *    the naive sum overstated the historical ledger by 84% — $52.62 against
 *    $31.22. `totalMoney` delegates; `naiveTotal` exists only so a test can show
 *    the two disagreeing.
 * 2. **Unpriced is unknown, not zero.** A step whose calls all reported no cost
 *    has an *unknown* bill, and a cold assertion that looked only at dollars
 *    would call that a harness failure — or worse, a saving.
 * 3. **Wall clock is `max(finishedAt) − min(startedAt)`, never
 *    `sum(durationMs)`.** Labels fan out into concurrent batches, so the sum is
 *    several times the wait. docs/project/ai-gateway.md § the duration trap.
 * 4. **`gateway ok` is not `stage ok`,** and one collector run per step is not
 *    guaranteed. Two `runId`s under one job and one step is duplicate execution
 *    — a third of everything this project has ever spent
 *    (docs/postmortems/260902c-the-truncation-retry-cost-storm.md) — and it is
 *    reported rather than folded into a larger number nobody questions.
 *
 * docs/plans/260902g-estimate-article-ingestion-and-mode-generation-costs.md,
 * evals/cost/feasibility.md.
 */

import type { AiCallRow, ScopeKind } from "../../src/ai-spend.js";
import { formatNanos } from "../../src/ai-spend.js";
import { totalRows } from "../../src/store/ai-calls.js";

/** What a set of rows cost, in the three pockets `totalRows` keeps apart. */
export interface Money {
  credits: number;
  upstream: number;
  computed: number;
  /** Calls that reported no money at all. The total is short by an unknown amount. */
  unpriced: number;
}

/**
 * **The one place this file adds the pockets together**, and it says so.
 *
 * `totalRows`' comment refuses to do it: `credits` is what OpenRouter deducted
 * and can be reconciled, `computed` is our own arithmetic against a price table
 * and has nobody to ask, `upstream` was billed to somebody else's key. A cost
 * eval genuinely wants one figure — "what did this article cost" — so it adds
 * them deliberately, here, rather than each caller doing it slightly
 * differently.
 */
export function moneyTotalNanos(money: Money): number {
  return money.credits + money.upstream + money.computed;
}

export function totalMoney(rows: readonly AiCallRow[]): Money {
  return totalRows(rows);
}

/**
 * **The wrong answer, kept on purpose.** `COALESCE(credits,0) +
 * COALESCE(byok_upstream,0) + COALESCE(computed,0)` as a plain sum over every
 * row, which is what an auditor writes when they look at the table rather than
 * at `totalRows`. On rows written before the 2026-09-02 rename it double-counts,
 * and the test that holds this against `totalMoney` is the only reason we can
 * say the real one is right rather than merely present.
 */
export function naiveTotal(rows: readonly AiCallRow[]): number {
  let n = 0;
  for (const r of rows) {
    n += (r.creditsUsedNanos ?? 0) + (r.byokUpstreamNanos ?? 0) + (r.computedCostNanos ?? 0);
  }
  return n;
}

/** Every value of a nullable field, deduplicated, in first-seen order. */
function distinct(values: readonly (string | null)[]): string[] {
  const seen: string[] = [];
  for (const v of values) {
    if (v !== null && !seen.includes(v)) seen.push(v);
  }
  return seen;
}

/**
 * `max(finishedAt) − min(startedAt)` over a set of rows, in milliseconds, or
 * `null` when there are none.
 *
 * `null` rather than `0`, because a job with no rows and a job whose calls took
 * no time are different facts and a zero would be read as the second.
 */
export function jobWallClockMs(rows: readonly AiCallRow[]): number | null {
  if (rows.length === 0) return null;
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const r of rows) {
    first = Math.min(first, Date.parse(r.startedAt));
    last = Math.max(last, Date.parse(r.finishedAt));
  }
  return last - first;
}

/** What one group of calls cost, and everything about it worth comparing later. */
export interface StepSpend {
  /**
   * **The grouping key** — a pipeline step under `aggregateByStep`, an `AiJob`
   * under `aggregateByAiJob`, or `(no step)` for a call made outside a step.
   *
   * Both groupings are needed and neither substitutes for the other: **there is
   * no `labels` step.** The nav labels fan out inside `hierarchy`
   * (src/pipeline.ts § STEP_ORDER), so every label call carries
   * `stepName: "hierarchy"` and `job: "labels"` — and the baseline's
   * "hierarchy $0.24 + labels" split exists only in the second view.
   */
  step: string;
  calls: number;
  money: Money;
  /**
   * **Distinct collector runs that touched this step.** One per `runStep`, so
   * more than one on a single job means the step ran more than once — see the
   * duplicate-execution finding below.
   */
  runIds: string[];
  jobIds: string[];
  tokens: {
    /** `reportedInputTokens` — whatever the wire calls input. Not comparable across wires. */
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
  };
  /** Gateway outcomes, counted. `ok` only means the wire returned. */
  outcomes: Record<string, number>;
  requestedModels: string[];
  answeredModels: string[];
  upstreams: string[];
  serviceTiers: string[];
  /** `max(finishedAt) − min(startedAt)` over this step's rows. */
  wallClockMs: number;
  /** `sum(durationMs)`. Kept only so the report can show how far apart they are. */
  summedDurationMs: number;
}

const NO_STEP = "(no step)";

export function aggregateByStep(rows: readonly AiCallRow[]): StepSpend[] {
  return aggregate(rows, (r) => r.stepName ?? NO_STEP);
}

/**
 * The same numbers cut by `AiJob` instead — which is the only way to see the
 * hierarchy/labels split, because labels is a fan-out inside the `hierarchy`
 * step rather than a step of its own. See `StepSpend.step`.
 */
export function aggregateByAiJob(rows: readonly AiCallRow[]): StepSpend[] {
  return aggregate(rows, (r) => r.job);
}

function aggregate(rows: readonly AiCallRow[], keyOf: (r: AiCallRow) => string): StepSpend[] {
  const byStep = new Map<string, AiCallRow[]>();
  for (const r of rows) {
    const key = keyOf(r);
    const bucket = byStep.get(key);
    if (bucket) bucket.push(r);
    else byStep.set(key, [r]);
  }
  /* Insertion order is the order the rows arrived in, which for a ledger read
     is `started_at` — so a step table reads down the pipeline without this file
     needing its own copy of `STEP_ORDER` to drift from src/pipeline.ts. */
  return [...byStep.entries()].map(([step, group]) => ({
    step,
    calls: group.length,
    money: totalMoney(group),
    runIds: distinct(group.map((r) => r.runId)),
    jobIds: distinct(group.map((r) => r.jobId)),
    tokens: {
      input: sum(group, (r) => r.reportedInputTokens),
      output: sum(group, (r) => r.outputTokens),
      cacheRead: sum(group, (r) => r.cacheReadTokens),
      cacheWrite: sum(group, (r) => r.cacheWriteTokens),
      reasoning: sum(group, (r) => r.reasoningTokens),
    },
    outcomes: countBy(group.map((r) => r.outcome)),
    requestedModels: distinct(group.map((r) => r.requestedModel)),
    answeredModels: distinct(group.map((r) => r.answeredModel)),
    upstreams: distinct(group.map((r) => r.upstream)),
    serviceTiers: distinct(group.map((r) => r.serviceTier)),
    wallClockMs: jobWallClockMs(group) ?? 0,
    summedDurationMs: sum(group, (r) => r.durationMs),
  }));
}

function sum(rows: readonly AiCallRow[], of: (r: AiCallRow) => number | null): number {
  return rows.reduce((n, r) => n + (of(r) ?? 0), 0);
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  return counts;
}

/* ------------------------------------------------------- the cold check -- */

export type FindingKind =
  | "scope-leak"
  | "no-spend"
  | "unpriced"
  | "ledger-short"
  | "duplicate-execution"
  | "gateway-failure"
  | "call-count"
  | "unexpected-paid-step";

export interface Finding {
  kind: FindingKind;
  /** The step or `AiJob` it is about, or `null` for a whole-run finding. */
  step: string | null;
  message: string;
  /**
   * **Stop the run.** Four things earn it, and all four mean the number this
   * draw produced is not the number it claims to be, so the next draw would
   * spend money measuring the same wrong thing:
   *
   * - a row that escaped the eval scope (the next thing it does is land in
   *   `npm run cost`'s Product bucket);
   * - a step or `AiJob` that was supposed to pay and recorded nothing;
   * - a required step whose whole bill is *unknown* — a cost measurement cannot
   *   accept "unknown" as its answer, and `allowUnpriced` is the deliberate
   *   override;
   * - a ledger that is short of what the step said it bought.
   *
   * Everything else is reported beside the numbers and the run carries on — a
   * duplicate execution is a *finding about production*, not a broken harness.
   */
  fatal: boolean;
}

/**
 * **What one step's spend collector saw**, for reconciling against what the
 * ledger kept.
 *
 * The gap this closes: `costStore.record` failures are counted in
 * `SpendReport.writeFailures` and swallowed (src/ai-spend.ts), and a Postgres
 * `forJob` read reports `unreadable: 0` however many rows were never inserted —
 * absence is unknowable from the reading end. So a draw where the structure
 * call persisted and every label write failed passes every other check here and
 * silently under-reports. GPT Sol, 2026-09-02, finding 4.
 *
 * Supplied by the runner from `AdvanceParts.onStepSpend`, which is an observer
 * on the queue and cannot change what it watches.
 */
export interface StepObservation {
  step: string;
  /** Calls the collector recorded — `SpendReport.calls.length`. */
  calls: number;
  /** Calls opened and never recorded. Non-zero is a bug in the gateway, always. */
  pending: number;
  /** Recorded calls whose ledger write rejected. Each one is a row that is not there. */
  writeFailures: number;
}

export interface ColdExpectation {
  /** Steps that must have recorded non-zero spend for this run to be cold. */
  mustPay: readonly string[];
  /**
   * **`AiJob`s that must have recorded non-zero spend** — a second namespace,
   * and it is not redundant.
   *
   * There is no `labels` step: the nav labels fan out inside `hierarchy`, so
   * every label call carries `stepName: "hierarchy"`. One priced structure row
   * therefore satisfies a step-level check **even if every label call was
   * skipped or lost**, and the draw reports a plausible number for an article
   * whose labels were never bought. Only the `AiJob` cut can see it. GPT Sol,
   * 2026-09-02, finding 2 — and the first version of this file's own tests hid
   * the hole by giving label rows a `stepName` production cannot produce.
   */
  mustPayJobs?: readonly string[];
  /** Steps allowed to pay without being required to. Everything else is a surprise. */
  mayPay?: readonly string[];
  /** How many calls each step should have made. A mismatch is reported, never hidden. */
  expectedCalls?: Readonly<Record<string, number>>;
  /** What each step's collector saw, to reconcile against the rows that survived. */
  observed?: readonly StepObservation[];
  /**
   * Accept a required step whose entire bill is unknown, as a note rather than
   * a stop. Deliberate, and it makes the run's headline number short by an
   * unknown amount — which the report then has to say.
   */
  allowUnpriced?: boolean;
  /** The scope every row must carry. `eval`, or the run is being billed to the product. */
  scopeKind?: ScopeKind;
}

/**
 * One namespace's must-pay check, run over the step cut and again over the
 * `AiJob` cut. `what` names the namespace so a finding says which cut it is
 * about — "labels" is not a step and a message that implied it was would send
 * the next reader to `STEP_ORDER`.
 */
function checkMustPay(
  groups: readonly StepSpend[],
  required: readonly string[],
  what: "step" | "AI job",
  allowUnpriced: boolean,
): Finding[] {
  const byName = new Map(groups.map((s) => [s.step, s]));
  const findings: Finding[] = [];
  for (const name of required) {
    const group = byName.get(name);
    if (!group) {
      findings.push({
        kind: "no-spend",
        step: name,
        fatal: true,
        message: `${what} ${name} was expected to pay and has no ledger row at all.`,
      });
      continue;
    }
    if (moneyTotalNanos(group.money) > 0) continue;
    if (group.money.unpriced > 0) {
      findings.push({
        kind: "unpriced",
        step: name,
        fatal: !allowUnpriced,
        message:
          `${what} ${name} made ${group.calls} call(s) and every one reported no cost — ` +
          "its bill is unknown, not zero, and a cost measurement cannot report unknown.",
      });
      continue;
    }
    findings.push({
      kind: "no-spend",
      step: name,
      fatal: true,
      message:
        `${what} ${name} was expected to pay and recorded $0 over ${group.calls} call(s). ` +
        "A cold step that costs nothing is a harness failure, not a saving.",
    });
  }
  return findings;
}

/**
 * Every call a step's collector saw, against every row the ledger kept.
 *
 * Three different ways of being short, reported as one finding per step so the
 * message can say which of them happened.
 */
function checkLedgerComplete(
  rows: readonly AiCallRow[],
  observed: readonly StepObservation[],
): Finding[] {
  const findings: Finding[] = [];
  for (const o of observed) {
    const kept = rows.filter((r) => (r.stepName ?? NO_STEP) === o.step).length;
    const why: string[] = [];
    if (o.writeFailures > 0) why.push(`${o.writeFailures} ledger write(s) rejected`);
    if (o.pending > 0) why.push(`${o.pending} call(s) opened and never recorded`);
    if (kept !== o.calls) why.push(`the ledger has ${kept} row(s) for it`);
    if (why.length === 0) continue;
    findings.push({
      kind: "ledger-short",
      step: o.step,
      fatal: true,
      message:
        `${o.step} made ${o.calls} call(s) but ${why.join(", ")} — the ledger is short, and ` +
        "a Postgres read cannot tell you so: a row that was never inserted reads as unreadable: 0.",
    });
  }
  return findings;
}

export function checkCold(rows: readonly AiCallRow[], expect: ColdExpectation): Finding[] {
  const wantScope = expect.scopeKind ?? "eval";
  const findings: Finding[] = [];

  /* First, and fatal: the attribution overlay covers calls made inside
     `step.run`, and anything bought elsewhere inside `runStep`'s collector is
     still `job_step`. evals/cost/feasibility.md § the one residual risk. The
     dry pass's control arm is what this looks like when it fires. */
  for (const scope of distinct(rows.map((r) => r.scopeKind))) {
    if (scope === wantScope) continue;
    const leaked = rows.filter((r) => r.scopeKind === scope);
    findings.push({
      kind: "scope-leak",
      step: null,
      fatal: true,
      message:
        `${leaked.length} row(s) carry scopeKind "${scope}" rather than "${wantScope}" ` +
        `(steps: ${distinct(leaked.map((r) => r.stepName)).join(", ") || NO_STEP}). ` +
        "Eval spend is landing in the Product bucket of npm run cost.",
    });
  }

  const steps = aggregateByStep(rows);
  const allowed = new Set([...expect.mustPay, ...(expect.mayPay ?? [])]);
  const allowUnpriced = expect.allowUnpriced ?? false;

  findings.push(...checkMustPay(steps, expect.mustPay, "step", allowUnpriced));
  /* The second namespace, and the one that can see a missing label fan-out. */
  findings.push(
    ...checkMustPay(aggregateByAiJob(rows), expect.mustPayJobs ?? [], "AI job", allowUnpriced),
  );
  if (expect.observed) findings.push(...checkLedgerComplete(rows, expect.observed));

  for (const step of steps) {
    /* One `runStep` opens one collector, so one step of one job is one runId
       however many batches it fanned out into. More than one means the step was
       executed more than once. */
    if (step.runIds.length > 1 && step.jobIds.length <= 1) {
      findings.push({
        kind: "duplicate-execution",
        step: step.step,
        fatal: false,
        message:
          `${step.step} has ${step.runIds.length} distinct collector runs on one job ` +
          `(${step.runIds.join(", ")}) — the step ran more than once and every run was paid for.`,
      });
    }
    const failed = Object.entries(step.outcomes).filter(([outcome]) => outcome !== "ok");
    if (failed.length > 0) {
      findings.push({
        kind: "gateway-failure",
        step: step.step,
        fatal: false,
        message:
          `${step.step}: ${failed.map(([o, n]) => `${n} ${o}`).join(", ")} — ` +
          "paid for and not returned; the stage outcome is a separate question.",
      });
    }
    const expected = expect.expectedCalls?.[step.step];
    if (expected !== undefined && expected !== step.calls) {
      findings.push({
        kind: "call-count",
        step: step.step,
        fatal: false,
        message: `${step.step} made ${step.calls} call(s), expected ${expected}.`,
      });
    }
    if (!allowed.has(step.step) && moneyTotalNanos(step.money) > 0) {
      findings.push({
        kind: "unexpected-paid-step",
        step: step.step,
        fatal: false,
        message:
          `${step.step} spent ${formatNanos(moneyTotalNanos(step.money))} and was not expected ` +
          "to spend anything.",
      });
    }
  }

  return findings;
}

/* -------------------------------------------------------------- printing -- */

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/**
 * The per-step table, **with both clocks in it whether or not they differ.**
 *
 * A column that appears only when it disagrees is one nobody learns to read,
 * and the whole reason `summed` is here is that somebody will otherwise quote
 * it as the wait.
 */
export function formatStepTable(steps: readonly StepSpend[]): string {
  const lines: string[] = [];
  const width = Math.max(8, ...steps.map((s) => s.step.length));
  for (const s of steps) {
    const total = moneyTotalNanos(s.money);
    lines.push(
      `  ${s.step.padEnd(width)}  ${formatNanos(total).padStart(11)}  ` +
        `${String(s.calls).padStart(3)} call(s)  ` +
        `wall ${seconds(s.wallClockMs).padStart(7)}  summed ${seconds(s.summedDurationMs).padStart(7)}` +
        (s.money.unpriced > 0 ? `  ${s.money.unpriced} unpriced` : "") +
        (s.money.upstream > 0 ? `  (${formatNanos(s.money.upstream)} BYOK upstream)` : ""),
    );
    lines.push(
      `  ${" ".repeat(width)}  tokens ${s.tokens.input.toLocaleString()} in / ` +
        `${s.tokens.output.toLocaleString()} out / ${s.tokens.reasoning.toLocaleString()} reasoning / ` +
        `${s.tokens.cacheRead.toLocaleString()} cache-read / ${s.tokens.cacheWrite.toLocaleString()} cache-write`,
    );
    lines.push(
      `  ${" ".repeat(width)}  model ${s.requestedModels.join(",") || "—"}` +
        ` → ${s.answeredModels.join(",") || "—"}` +
        `  upstream ${s.upstreams.join(",") || "—"}` +
        `  tier ${s.serviceTiers.join(",") || "—"}` +
        `  gateway ${Object.entries(s.outcomes).map(([o, n]) => `${n} ${o}`).join(", ")}`,
    );
  }
  return lines.join("\n");
}

/**
 * The findings, fatal ones first and labelled, so that a run whose numbers look
 * plausible cannot be read past a leak.
 */
export function formatFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) return "";
  const ordered = [...findings].sort((a, b) => Number(b.fatal) - Number(a.fatal));
  return ordered.map((f) => `  ${f.fatal ? "FATAL" : "note "} ${f.message}`).join("\n");
}
