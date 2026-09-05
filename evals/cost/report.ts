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
import { ARTICLE_RENDERER, STAGE_EFFORT } from "../../src/models.js";
import type { ArticleStage } from "../../src/models.js";
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
  | "unexpected-paid-step"
  /** The earliest call of a step read a cache it was supposed to be cold of. */
  | "warm-first-call"
  /** A per-mode draw read a cache at all, and it sent no breakpoint for one to exist. */
  | "warm-mode-call"
  /**
   * A required step or `AiJob` bought nothing, **and the job's own step statuses
   * say why** — the step that would have bought it failed, or never ran because
   * something before it did. See `stoppedAtOrBefore`.
   */
  | "explained-absence"
  /** A call reported no cache-read count, so there is no evidence it was cold. */
  | "unknown-cache-telemetry"
  /**
   * A call paid the 1.25x premium to write a cache entry and nothing later in the
   * same batched job read it. The premium is a bet on a read; this is the bet
   * lost. See `checkBatchedDraw`.
   */
  | "unclaimed-cache-write"
  /** A job that was supposed to adopt an article minted a fresh one instead. */
  | "not-adopted";

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
   * **The second and the fourth are not the same absence**, and the difference
   * is the point of `stoppedAtOrBefore`: a row that is missing because the step
   * that would have bought it failed is a paid failure to be counted, not a lost
   * row, and it is reported loudly and non-fatally so the sweep can go on
   * counting. Only an absence nothing explains stops the run.
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
 *
 * **Still the sharp instrument, and still the only per-step one.** Since
 * 2026-09-04 a `LedgerRead` also carries `lateCalls` — the process-wide count of
 * calls that finished after their collector had reported and so left no row
 * (src/store/contracts.ts) — which is enough to stop a bill being *quoted* as a
 * total, and nowhere near enough to say which step lost what. This is what says
 * that.
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

/**
 * **What the job said one of its steps did** — the fact that tells an absence
 * apart from a loss.
 *
 * Structurally what `Draw.steps` already holds in run.ts, narrowed to the two
 * fields this file may reason about. `status` is the job's own word
 * (`StepStatus` in src/types.ts: pending, running, done, skipped, error) and is
 * typed as a string here because report.ts is pure arithmetic over what it is
 * handed and has no business importing the pipeline's vocabulary.
 */
export interface StepOutcome {
  name: string;
  status: string;
}

/**
 * The statuses that mean the pipeline stopped here. `bug` is not a `StepStatus`
 * production writes today, and it is in the set because `outcomeOf` in run.ts
 * counts it as a failure — the two lists disagreeing is the kind of drift that
 * makes one summary contradict the other.
 */
const STOPPED = new Set(["error", "bug", "failed"]);

/**
 * **The judgement this whole distinction hangs on: which absences are explained.**
 *
 * A required step or `AiJob` with no priced row is either a *lost row* — money
 * really spent and the ledger short of it, the class that cost this project a
 * silent $0.0333 run — or a *paid failure*, where the step that would have
 * bought it never got the chance. The two look identical from the ledger, and
 * only the job's own step statuses can separate them.
 *
 * The rule is **at or before**, and the direction matters both ways. Walking the
 * steps in pipeline order, anything from the first failure onwards never
 * completed, so an absence there is explained. A failure *after* `producedBy`
 * explains nothing about it: `hierarchy` finishing and `arc` blowing up leaves a
 * missing `labels` row exactly as lost as it ever was.
 *
 * Found by evals/results/cost/2026-09-03-04-59-07-1bpfhts0-long-html: draw 2's
 * `hierarchy` was billed $0.2124 and then failed its own range check, so the
 * label fan-out — which runs only after hierarchy succeeds — bought nothing, and
 * the fatal `no-spend` stopped a sweep whose purpose was to count how often that
 * happens. Draws 3 and 4 never ran.
 *
 * `undefined` when nothing explains it, which keeps the finding fatal. A run
 * that supplies no statuses gets the old behaviour: no explanation is not an
 * explanation.
 */
function stoppedAtOrBefore(
  steps: readonly StepOutcome[] | undefined,
  producedBy: string,
): StepOutcome | undefined {
  if (!steps) return undefined;
  const at = steps.findIndex((s) => s.name === producedBy);
  /* A step the job never listed cannot be explained by this job's failures.
     Whatever went wrong there is a different bug, and it stays fatal. */
  if (at === -1) return undefined;
  for (const step of steps.slice(0, at + 1)) {
    if (STOPPED.has(step.status)) return step;
  }
  return undefined;
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
   * **What the job recorded for each of its steps, in pipeline order** — the
   * only evidence that can turn a fatal missing row into a counted paid failure.
   *
   * Passed in rather than read: this file is pure, and `Draw.steps` in run.ts is
   * where the job's own answer lives. Omit it and every absence stays fatal,
   * which is what every caller got before 2026-09-03.
   */
  stepStatuses?: readonly StepOutcome[];
  /**
   * Which step each `AiJob` in `mustPayJobs` runs inside, for the two whose
   * names differ from their step's — `AI_JOB_STEP` in harness.ts holds them and
   * says why there are only two. Anything not in the map is looked up under its
   * own name.
   */
  aiJobStep?: Readonly<Record<string, string>>;
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
 *
 * `stepOf` maps the required name onto the pipeline step that would have bought
 * it, which is the identity for the step cut and `AI_JOB_STEP` for the job cut.
 */
function checkMustPay(
  groups: readonly StepSpend[],
  required: readonly string[],
  what: "step" | "AI job",
  allowUnpriced: boolean,
  expect: ColdExpectation,
  stepOf: (name: string) => string,
): Finding[] {
  const byName = new Map(groups.map((s) => [s.step, s]));
  const findings: Finding[] = [];
  for (const name of required) {
    const group = byName.get(name);
    if (group && moneyTotalNanos(group.money) > 0) continue;

    /* **Asked before any of the three fatals below.** All three are ways of
       saying "this bought nothing", and every one of them is the *expected*
       shape of a draw whose pipeline stopped short — so the explanation is a
       property of the absence rather than of which flavour of absence it is. */
    const stopped = stoppedAtOrBefore(expect.stepStatuses, stepOf(name));
    if (stopped) {
      findings.push({
        kind: "explained-absence",
        step: name,
        fatal: false,
        message:
          `PAID FAILURE — ${what} ${name} bought nothing` +
          (group ? ` beyond ${group.calls} unpaid call(s)` : " and has no ledger row") +
          `, and step ${stopped.name} is ${stopped.status}: it never ran, so this is an absence ` +
          "the job's own status explains rather than a row that was lost. The draw's money was " +
          "really spent and is not the price of anything — it is kept out of every headline " +
          "figure and listed beside them. The run carries on: a sweep that measures how often " +
          "this happens cannot stop the first time it does.",
      });
      continue;
    }

    if (!group) {
      findings.push({
        kind: "no-spend",
        step: name,
        fatal: true,
        message: `${what} ${name} was expected to pay and has no ledger row at all.`,
      });
      continue;
    }
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
 *
 * **Exported because the deepening eval needs the same reconciliation** and a
 * second copy of it would be a second opinion about what "the ledger is short"
 * means. evals/deepen/run.ts maps these onto its own finding type.
 */
export function checkLedgerComplete(
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

/**
 * **Did every row land in the eval's own bucket?**
 *
 * Fatal, because the attribution overlay covers calls made inside `step.run`
 * and anything bought elsewhere inside `runStep`'s collector is still
 * `job_step` — evals/cost/feasibility.md § the one residual risk. The dry
 * pass's control arm is what this looks like when it fires.
 *
 * **Exported because it is the only check that can see eval money being billed
 * to Product**, and the deepening eval needs exactly it: that one drives jobs
 * with no `fetch` step at all, so its fixture check cannot stand in for this.
 * ⟨GPT Sol reviewing the stage-5b harness, DPN-01.⟩
 */
export function checkScope(rows: readonly AiCallRow[], wantScope: ScopeKind): Finding[] {
  const findings: Finding[] = [];
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
  return findings;
}

export function checkCold(rows: readonly AiCallRow[], expect: ColdExpectation): Finding[] {
  const wantScope = expect.scopeKind ?? "eval";
  const findings: Finding[] = [];

  /* First, and fatal. */
  findings.push(...checkScope(rows, wantScope));

  const steps = aggregateByStep(rows);
  const allowed = new Set([...expect.mustPay, ...(expect.mayPay ?? [])]);
  const allowUnpriced = expect.allowUnpriced ?? false;

  findings.push(...checkMustPay(steps, expect.mustPay, "step", allowUnpriced, expect, (n) => n));
  /* The second namespace, and the one that can see a missing label fan-out. Its
     names are not step names, so it needs the map to ask the step question. */
  findings.push(
    ...checkMustPay(
      aggregateByAiJob(rows),
      expect.mustPayJobs ?? [],
      "AI job",
      allowUnpriced,
      expect,
      (n) => expect.aiJobStep?.[n] ?? n,
    ),
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

/* ------------------------------------------ the all-modes sweep's checks -- */

/**
 * Which part of an all-modes sweep a draw is, and therefore what it means.
 *
 * - `ingest` — the fixture through the ingest queue under a fresh slug. Mints an
 *   article; hierarchy and its label fan-out are what it buys.
 * - `mode` — one on-demand mode as its own job against the **adopted** article
 *   the ingest draw made. This is the number "what does pressing Ideas cost".
 * - `batched` — several modes in one job, `--against` an article that already
 *   exists. A different number, deliberately, and **it must never be aggregated
 *   with the per-mode ones**: modes sharing a job share a cached article prefix,
 *   so all but the first read warm. That is what makes it worth measuring —
 *   `sharesArticleCache` has never been priced — and what makes it a separate
 *   scenario.
 */
export type DrawPhase = "ingest" | "mode" | "batched";

/**
 * **A draw's coldness, made falsifiable — and the two rules are different
 * strengths for a reason.**
 *
 * The sweep ingests once and then runs each mode as its own job against the
 * adopted article, rather than paying for a fresh ingest per mode (~$3.40 of
 * scaffolding per mode on `long-html`). That is only a *cold* per-mode number if
 * a later job cannot read the cached article prefix an earlier one wrote. The
 * argument that it cannot is in the plan — `runStep` marks the article only when
 * **another step of the same job** would read it (src/pipeline.ts §
 * `cacheArticleForStep`), a single-mode job has no other step, and Anthropic's
 * cache is explicit-only so nothing warms implicitly. That predicate looked only
 * at *later* steps until 2026-09-03, which was a bug in the batched case and
 * makes no difference here: a lone mode has nothing in either direction.
 *
 * All of which is an argument. These are the measurements.
 *
 * **A per-mode draw: no cache read at all, on any call.** Every one of the eight
 * modes gates its only `cache_control` on `opts.cacheArticle` (src/arc.ts,
 * tweets.ts, glossary.ts, quotes.ts, ideas.ts, timeline.ts, quiz.ts,
 * sketch.ts), and a single-mode job leaves that false — so no breakpoint is
 * sent, and Anthropic can neither write nor read one. A read of *any* size is
 * therefore anomalous, not merely a warm first call, and the weaker
 * earliest-call rule would let it through.
 *
 * **An ingest draw: the earliest call by `startedAt` of each step must be
 * cold.** Earliest, not any, because within-run caching here is deliberate and
 * is part of what production pays: hierarchy's label fan-out shares
 * `stepName: "hierarchy"` with the structure call and legitimately reads off it,
 * and a rule of "no cache read anywhere" would fail every fan-out whose write
 * premium we choose to pay.
 *
 * **Per step, not per draw, and this is the finding Sol's review turned up.**
 * An earlier version returned early for every non-mode draw, which left the two
 * paths where implicit provider caching is actually possible with no gate at
 * all: PDF extraction is `PDF_READER_MODEL` (an OpenAI model — src/models.ts),
 * and OpenAI caches a repeated prefix automatically, across jobs and without a
 * breakpoint. The fixture bytes and the prompt are byte-identical between runs,
 * so a rerun inside the cache lifetime would report a discounted `extract` as
 * cold ingest. Dictation is `DICTATION_MODEL`, a Gemini model, and Gemini caches
 * implicitly by default — the same trap, on the interactions side.
 *
 * **Not under `--batched-modes` and not on a batched draw**, where the warm read
 * is the thing being measured.
 */
export function checkColdDraw(
  rows: readonly AiCallRow[],
  opts: { phase: DrawPhase; batchedModes: boolean },
): Finding[] {
  if (opts.phase === "batched" || opts.batchedModes) return [];
  if (rows.length === 0) return [];
  return opts.phase === "mode" ? modeDrawIsCold(rows) : eachStepStartsCold(rows);
}

/** How far a read may fall short of the write it claims and still count as that write's. */
const CACHE_CLAIM_TOLERANCE = 0.1;

/**
 * Which shared-article cache group a step belongs to, or `null` for a step that
 * is in none.
 *
 * **Using the pipeline's own tables here is a narrower thing than it looks, and
 * the distinction is the whole reason this gate is trustworthy.** The rule below
 * takes *membership* from `STAGE_EFFORT` and `ARTICLE_RENDERER` — a symmetric
 * question ("do these two stages send the same bytes at the same effort") that
 * the pipeline has always answered correctly — and takes the *verdict* from the
 * ledger. What it never asks is `sharesArticleCache`'s question, "should this
 * step mark", which is where the direction bug lived and which a check would
 * inherit whole.
 *
 * An earlier draft of this file claimed a predicate-based check "would have
 * passed on the broken code" full stop. GPT Sol was right that this is too
 * broad: a check that used the predicate only to find a compatible pair and then
 * demanded a read would have failed. Avoiding the production predicate for the
 * verdict is still the right instinct; avoiding its tables for membership was
 * over-correction, and it cost this gate the group-scoping it needed.
 *
 * A step in no group — `hierarchy` and its `labels` fan-out above all — is out of
 * scope entirely rather than forgiven case by case. Labels writes three entries
 * in parallel and reads at most one **on purpose**, so any rule about unclaimed
 * writes is simply the wrong question to ask it.
 */
function cacheGroupOf(step: string | null): string | null {
  if (step === null) return null;
  const effort = STAGE_EFFORT[step as ArticleStage] as string | undefined;
  const renderer = ARTICLE_RENDERER[step as ArticleStage] as string | undefined;
  return effort === undefined || renderer === undefined ? null : `${effort}+${renderer}`;
}

/**
 * **Did the write premium get collected?** The batched draw's own question, and
 * the one nothing was asking.
 *
 * A batched draw exists to price two modes sharing a job, which is the only shape
 * where the article cache can pay off at all. `checkColdDraw` returns `[]` for it
 * — correctly, because a warm read is the thing being measured rather than a
 * contamination — and that left the phase with **no rule at all**. The eval
 * computed the numbers that prove
 * [260903c](../../docs/postmortems/260903c-the-conditional-article-cache-breakpoint-marks-the-writer-but-never-the-reader.md)
 * and printed them without judging them; a human found the bug by reading a table.
 *
 * **The rule is stated in money, on purpose, and this is the whole design.** The
 * obvious implementation asks `sharesArticleCache` who *should* share and checks
 * that they did — and it would have passed on the broken code, because the
 * predicate was right about the group and wrong about the direction, and a check
 * built on the predicate inherits both. So this asks a question the pipeline's
 * tables cannot answer for it:
 *
 * > **Every call that paid to write a cache entry must be followed, within this
 * > draw, by a call that reads about that many tokens.**
 *
 * A write is a 1.25x bet on a later read. An unclaimed write is that bet lost,
 * whatever the reason — no breakpoint on the reader (this bug), a prefix that
 * diverges before the article (the `ideas`/`ARTICLE_RENDERER` near-miss), an
 * expired TTL, a group that was never really a group. The check does not care
 * which, and that is why it survives the next mechanism.
 *
 * Deliberately loose in one direction: a write is happy with *any* later read of
 * the right size, not a matched pair. Hierarchy's label fan-out writes three
 * near-identical entries in parallel and reads one of them, and a one-to-one
 * matcher would call two of those a loss when paying for them is a documented
 * choice about latency. Money going missing is the signal; bookkeeping is not.
 */
export function checkBatchedDraw(rows: readonly AiCallRow[], phase: DrawPhase): Finding[] {
  if (phase !== "batched" || rows.length === 0) return [];
  const findings: Finding[] = [];

  const inGroups = rows.filter((r) => cacheGroupOf(r.stepName) !== null);
  if (inGroups.length === 0) return [];

  for (const row of inGroups) {
    if (row.cacheReadTokens === null) {
      findings.push(noCacheTelemetry(row, `A call of this batched draw (step ${row.stepName})`));
    } else if (row.cacheWriteTokens === null) {
      findings.push(
        noCacheTelemetry(row, `A call of this batched draw (step ${row.stepName})`, "cache-write"),
      );
    }
  }
  /* One unknown poisons the arithmetic for the whole group — a missing field
     could have been the read that squares any of these writes — so stop rather
     than report a shortfall that is really an absence. */
  if (findings.length > 0) return findings;

  const priced = inGroups as (AiCallRow & { cacheWriteTokens: number; cacheReadTokens: number })[];
  const byGroup = new Map<string, typeof priced>();
  for (const r of priced) {
    const key = cacheGroupOf(r.stepName) as string;
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(r);
    else byGroup.set(key, [r]);
  }

  for (const [, group] of byGroup) {
    const calls = [...group].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const steps = new Set(calls.map((c) => c.stepName));

    /* **Reads are consumed, at most once each.** `some()` per writer was the
       first version and it let one read absolve any number of writes — GPT Sol
       exercised it with arc writing 25,428 unread, ideas writing 27,239 and
       timeline reading 27,239, and got no findings at all. Scoping to a group
       stops a read answering for another group's write; consuming stops it
       answering twice inside this one. */
    const unspent = calls.filter((c) => c.cacheReadTokens > 0).map((c) => ({ call: c, spent: false }));

    for (const writer of calls.filter((c) => c.cacheWriteTokens > 0)) {
      const floor = writer.cacheWriteTokens * (1 - CACHE_CLAIM_TOLERANCE);
      const claim = unspent.find(
        (r) =>
          !r.spent &&
          Date.parse(r.call.startedAt) > Date.parse(writer.startedAt) &&
          r.call.cacheReadTokens >= floor,
      );
      if (claim) {
        claim.spent = true;
        continue;
      }
      const best = Math.max(
        0,
        0,
        ...calls
          .filter((c) => Date.parse(c.startedAt) > Date.parse(writer.startedAt))
          .map((c) => c.cacheReadTokens),
      );
      findings.push({
        kind: "unclaimed-cache-write",
        step: writer.stepName,
        fatal: true,
        message:
          `Step ${writer.stepName ?? "(unnamed)"} paid to write ${writer.cacheWriteTokens} cached ` +
          `token(s) and no later call in its cache group read them — the best any of them managed ` +
          `was ${best}. That is the 1.25x write premium spent on nothing, which is the exact loss ` +
          "the conditional breakpoint exists to prevent. Either the reader is sending no " +
          "`cache_control` (a request without one performs no lookup, however warm the entry is), " +
          "or the two prompts diverge somewhere before the article and the prefixes never matched.",
      });
    }

    /* **And the silence that looks like success.** Two members of one group in a
       batched job with no write and no read anywhere is not "nothing to check":
       it is both markers missing, which is what a regression that switched
       `cacheArticle` off everywhere would look like. The rule above cannot see
       it, because it only ever asks about writes that happened. */
    if (steps.size > 1 && calls.every((c) => c.cacheWriteTokens === 0 && c.cacheReadTokens === 0)) {
      findings.push({
        kind: "unclaimed-cache-write",
        step: calls[0]?.stepName ?? null,
        fatal: true,
        message:
          `This batched job ran ${[...steps].join(" and ")}, which share one cached article prefix, ` +
          "and no call wrote or read a single cached token. A pair that shares a group and caches " +
          "nothing means neither request carried a `cache_control` breakpoint — the whole saving " +
          "this scenario exists to measure is silently absent, and every number here is a cold one " +
          "wearing a batched label.",
      });
    }
  }
  return findings;
}

/**
 * **Unknown is fatal, and the message has to say which kind of fatal.**
 *
 * A coerced `cacheReadTokens ?? 0` passed the guard with no evidence at all: a
 * provider or a fallback that omits the field would read as proof of coldness.
 * For a sweep whose numbers get published, no telemetry means the draw cannot be
 * called cold — which is a different sentence from "it was warm", and a reader
 * who is told the wrong one goes looking for the wrong thing.
 */
function noCacheTelemetry(row: AiCallRow, what: string, field = "cache-read"): Finding {
  return {
    kind: "unknown-cache-telemetry",
    step: row.stepName,
    fatal: true,
    message:
      `${what} reported no ${field} count at all (${row.requestedModel} via ` +
      `${row.upstream ?? "an upstream that did not say"}), so there is no evidence it was cold. ` +
      "Fatal because it is unknown, not because it is warm: coercing the absent field to zero " +
      "is what let a guard with nothing under it pass.",
  };
}

function modeDrawIsCold(rows: readonly AiCallRow[]): Finding[] {
  const findings: Finding[] = [];
  for (const row of rows) {
    if (row.cacheReadTokens === null) {
      findings.push(noCacheTelemetry(row, "A call of this per-mode draw"));
      continue;
    }
    if (row.cacheReadTokens === 0) continue;
    findings.push({
      kind: "warm-mode-call",
      step: row.stepName,
      fatal: true,
      message:
        `A call of this per-mode draw read ${row.cacheReadTokens} cached token(s). A single-mode ` +
        "job sends no `cache_control` breakpoint at all — every mode gates its only one on " +
        "`opts.cacheArticle` — so there is nothing here that should be readable, at any size. " +
        "Either a breakpoint has appeared or a later job is reading a prefix an earlier one " +
        "wrote, and every per-mode number after the first would be a warm read priced as cold.",
    });
  }
  return findings;
}

function eachStepStartsCold(rows: readonly AiCallRow[]): Finding[] {
  const findings: Finding[] = [];
  const byStep = new Map<string, AiCallRow[]>();
  for (const r of rows) {
    const bucket = byStep.get(r.stepName ?? NO_STEP);
    if (bucket) bucket.push(r);
    else byStep.set(r.stepName ?? NO_STEP, [r]);
  }
  for (const [step, group] of byStep) {
    /* **By the clock, not by the array.** `forJob` comes back ordered by
       `started_at` today, so "the first row" and "the earliest call" happen to
       agree — and a check that relies on that would go quietly wrong the day the
       ordering changed, asking about a call that is not the one the argument is
       about. Ties are taken as a group: two rows can share a millisecond, and
       picking whichever arrived first would make the verdict depend on an order
       the reader cannot see. */
    const earliestAt = Math.min(...group.map((r) => Date.parse(r.startedAt)));
    for (const row of group.filter((r) => Date.parse(r.startedAt) === earliestAt)) {
      if (row.cacheReadTokens === null) {
        findings.push(noCacheTelemetry(row, `The earliest call of step ${step}`));
        continue;
      }
      if (row.cacheReadTokens === 0) continue;
      findings.push({
        kind: "warm-first-call",
        step: row.stepName,
        fatal: true,
        message:
          `The earliest call of step ${step} read ${row.cacheReadTokens} cached token(s), so ` +
          "this step did not start cold. On an OpenAI or Gemini model there need be no " +
          "breakpoint for that: both cache a repeated prefix implicitly, and this eval resends " +
          "byte-identical committed bytes. A discounted rerun reported as a cold first " +
          "generation is the wrong number, not a cheap one.",
      });
    }
  }
  return findings;
}

/**
 * Whether `enqueue` took the article we named or made a new one.
 *
 * A union rather than a boolean, because the interesting case has to say *what*
 * it got instead — a mint whose slug you cannot see is a mint you cannot chase.
 */
export type Adoption =
  | { kind: "adopted"; slug: string; articleId: string }
  | {
      kind: "minted";
      requested: string;
      got: string;
      /** Which of the two observations noticed — the slug moved, or the article id did. */
      why: string;
    };

/**
 * **A mode job that minted is a cold ingest wearing the mode's name**, and
 * nothing else in this file would notice.
 *
 * A job arriving with neither a URL nor an upload is `{kind: "adopted"}`
 * (src/jobs.ts § `enqueue`), so the sweep's mode jobs pass none. If that ever
 * stops being true — a changed default, a URL that creeps in, a slug the queue
 * steps aside from — the job ingests a fresh empty article, pays for the whole
 * pipeline, and reports the total under `ideas`. Every other check passes: it
 * spent money, in the eval scope, on the step it was asked for.
 *
 * An ingest draw is *expected* to mint, so it is not asked.
 */
export function checkAdoption(adoption: Adoption, phase: DrawPhase): Finding[] {
  if (phase === "ingest" || adoption.kind === "adopted") return [];
  return [
    {
      kind: "not-adopted",
      step: null,
      fatal: true,
      message:
        `This draw asked for "${adoption.requested}" and the queue gave it ` +
        `"${adoption.got}" (${adoption.why}) — the job minted a fresh article instead of ` +
        "adopting the one the sweep ingested, so what it measures is a whole cold ingest " +
        "filed under a mode's name.",
    },
  ];
}

/* --------------------------------------------------- observed variation -- */

/**
 * One draw, reduced to the two facts a variation summary needs.
 *
 * **`succeeded` is the stage/job outcome, not the gateway's.** `outcome: "ok"`
 * on a ledger row only means the wire returned; a truncated hierarchy is a `bug`
 * failure with a perfectly ok row beside it (src/token-budget.ts,
 * docs/postmortems/260826a-toc-max-tokens.md). Counting the gateway's word
 * would report zero failures over a run of them.
 */
export interface DrawOutcome {
  label: string;
  totalNanos: number;
  succeeded: boolean;
  /** Why it failed, when it did — `truncated`, `bug`, whatever the stage said. */
  failure?: string;
}

/**
 * What a set of repeated draws actually showed. **Never a tail probability and
 * never a standard deviation** — the plan's Principles forbid both, and over
 * four draws either would be a number with no evidence under it.
 *
 * `null` rather than `0` for the middle and the ends of an empty set, because a
 * zero there reads as "these draws cost nothing".
 */
export interface ObservedVariation {
  draws: number;
  median: number | null;
  min: number | null;
  max: number | null;
  /** `max − min`, and the whole of what we claim about spread. */
  range: number | null;
  succeeded: number;
  failures: number;
  /** Failures by what the stage said went wrong, so truncation can be told from a bug. */
  failureKinds: Record<string, number>;
  /** The middle of the draws that worked — the number a reader would be quoted. */
  medianGivenSuccess: number | null;
  /** Every nano the set was billed, **failures included**: a stop is not a refund. */
  totalPaidNanos: number;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  /* An even count has no middle element, so the two either side of the gap are
     averaged — the ordinary definition, written out because the alternative
     (taking the upper of the two) is a silent bias on a four-draw set. */
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function observedVariation(draws: readonly DrawOutcome[]): ObservedVariation {
  const costs = draws.map((d) => d.totalNanos);
  const ok = draws.filter((d) => d.succeeded);
  const failureKinds: Record<string, number> = {};
  for (const d of draws) {
    if (d.succeeded) continue;
    const kind = d.failure ?? "unknown";
    failureKinds[kind] = (failureKinds[kind] ?? 0) + 1;
  }
  const min = costs.length === 0 ? null : Math.min(...costs);
  const max = costs.length === 0 ? null : Math.max(...costs);
  return {
    draws: draws.length,
    median: median(costs),
    min,
    max,
    range: min === null || max === null ? null : max - min,
    succeeded: ok.length,
    failures: draws.length - ok.length,
    failureKinds,
    medianGivenSuccess: median(ok.map((d) => d.totalNanos)),
    totalPaidNanos: costs.reduce((n, c) => n + c, 0),
  };
}

/** The failure kinds as `2 truncated, 1 hierarchy error`, or "" when none failed. */
function namedFailures(v: ObservedVariation): string {
  return Object.entries(v.failureKinds)
    .map(([kind, n]) => `${n} ${kind}`)
    .join(", ");
}

/**
 * The variation summary as a paragraph, with the words the plan chose.
 *
 * It says *observed variation* rather than anything that sounds like a
 * distribution, and it names the failure kinds rather than folding them into the
 * median — a run whose cheapest two draws were truncations is not a cheap run.
 *
 * **And a set where nothing succeeded gets a different paragraph**, because the
 * ordinary one is a confident-looking cost line built entirely out of failures:
 * "median $0.21, range $0.20–$0.22" reads as the price of an article, and it is
 * the price of not getting one. The numbers are still printed — what four
 * failures cost is worth knowing — under a heading that says what they are.
 * Every draw of a set failing is not hypothetical: it is the neighbouring case
 * to the run that prompted all this
 * (evals/results/cost/2026-09-03-04-59-07-1bpfhts0-long-html), where the sweep
 * stopped rather than going on to find out.
 */
export function formatVariation(what: string, v: ObservedVariation): string {
  if (v.draws === 0) return `  ${what}: no draws.`;
  const tail =
    "    Observed variation only. No tail probability and no standard deviation: over this " +
    "many draws either would be a number with no evidence under it.";
  if (v.succeeded === 0) {
    return [
      `  ${what}: ${v.draws} draw(s) and NOT ONE produced its artefact (${namedFailures(v)}) — ` +
        "there is no cost to quote here.",
      `    Every figure that follows is the price of failing, not the price of the thing: ` +
        `median ${formatNanos(v.median ?? 0)}, range ${formatNanos(v.min ?? 0)}–` +
        `${formatNanos(v.max ?? 0)} (spread ${formatNanos(v.range ?? 0)}).`,
      `    Total paid across every draw, all of them failures: ${formatNanos(v.totalPaidNanos)}.`,
      tail,
    ].join("\n");
  }
  const lines = [
    `  ${what}: ${v.draws} draw(s), observed variation — ` +
      `median ${formatNanos(v.median ?? 0)}, range ${formatNanos(v.min ?? 0)}–` +
      `${formatNanos(v.max ?? 0)} (spread ${formatNanos(v.range ?? 0)}).`,
    `    ${v.succeeded} succeeded, ${v.failures} failed` +
      (v.failures > 0 ? ` (${namedFailures(v)})` : "") +
      `; median given success ${v.medianGivenSuccess === null ? "—" : formatNanos(v.medianGivenSuccess)}.`,
    `    Total paid across every draw, failures included: ${formatNanos(v.totalPaidNanos)}.`,
    tail,
  ];
  return lines.join("\n");
}

/* ------------------------------------------------------- what may be quoted -- */

/** A draw that was billed and did not produce the thing it was billed for. */
export interface PaidFailure {
  label: string;
  /** Really spent. A stop is not a refund, and the money has to appear somewhere. */
  nanos: number;
  /** What the stage said went wrong — `hierarchy bug`, `truncated`, `error`. */
  failure: string;
}

/**
 * **The headline figure and the money that must not be inside it.**
 *
 * A mode that is billed and then fails parsing or validation has a perfectly
 * real bill and no artefact. Quoting that as "Ideas costs $X" is the failure
 * mode this whole eval exists to avoid — a plausible wrong number — and folding
 * it into "whole article" is the same mistake one level up. So the two are
 * separated here, in the same shape `observedVariation` already uses for the
 * repeated draws: **cost conditional on success is the number, total paid is
 * reported beside it**, and the failures are named rather than counted.
 *
 * `gateway ok` is not the question. `DrawOutcome.succeeded` is the stage/job
 * outcome — a truncated generation has an `outcome: "ok"` row beside it.
 */
export interface HeadlineTotal {
  /** How many of the draws produced what they were billed for. */
  succeeded: number;
  draws: number;
  /** The sum over the successful draws, and the only figure that may be quoted. */
  nanos: number;
  /** Billed, and not a price for anything. */
  paidFailures: PaidFailure[];
  /** Every nano the set was billed, failures included. */
  totalPaidNanos: number;
  /**
   * Whether `nanos` is a complete answer to "what does this set cost". False as
   * soon as one draw failed: the successful ones still cost what they cost, but
   * the set is missing a price for the part that failed.
   */
  complete: boolean;
}

export function headlineTotal(draws: readonly DrawOutcome[]): HeadlineTotal {
  const ok = draws.filter((d) => d.succeeded);
  const paidFailures = draws
    .filter((d) => !d.succeeded)
    .map((d) => ({ label: d.label, nanos: d.totalNanos, failure: d.failure ?? "unknown" }));
  return {
    succeeded: ok.length,
    draws: draws.length,
    nanos: ok.reduce((n, d) => n + d.totalNanos, 0),
    paidFailures,
    totalPaidNanos: draws.reduce((n, d) => n + d.totalNanos, 0),
    complete: paidFailures.length === 0 && draws.length > 0,
  };
}

/** The paid failures as their own block, so their money is visible and separate. */
export function formatPaidFailures(t: HeadlineTotal): string {
  if (t.paidFailures.length === 0) return "";
  const lines = t.paidFailures.map(
    (f) => `    ${f.label}: ${formatNanos(f.nanos)} spent, ${f.failure} — no artefact.`,
  );
  return [
    `  Paid failures (${t.paidFailures.length}), excluded from every figure above and ` +
      "really spent:",
    ...lines,
  ].join("\n");
}

/* ------------------------------------------------ cold and warm, per round -- */

/**
 * One call's cache telemetry, in the order the calls were made.
 *
 * Deliberately not `AiCallRow`: the interactions runner reads its calls off the
 * live collector, where a `SpendRecord` carries `ms` and no start time (the
 * timestamps are derived at row-write time, src/ai-spend.ts § `write`). So the
 * ordering here is the caller's to supply and to justify — see `roundCache`.
 */
export interface CacheCall {
  cacheRead: number | null;
  cacheWrite: number | null;
}

/**
 * What a round's calls say about the cache, as four outcomes rather than a
 * boolean.
 *
 * `within-round` is the one a boolean loses, and it is the common case: chat's
 * tool loop makes a second call that reads the prefix the first call wrote.
 * That is a cold turn — the round arrived with nothing cached — and treating it
 * as warm would suppress the most interesting ratio in the set.
 */
export type RoundCache =
  | { kind: "no-calls" }
  /** No cache-read count on some call, so nothing here is established either way. */
  | { kind: "unknown"; why: string }
  /** Nothing was read that this round had not written itself. */
  | { kind: "cold"; readWithinRound: number }
  /** A call read a cache no earlier call in this round wrote — it was already there. */
  | { kind: "warm"; read: number };

/**
 * **Cold or warm, read off the calls rather than off the round's position.**
 *
 * The rule: walking the calls in order, a read is *pre-existing* if no earlier
 * call in this round has written any cache. That is the earliest-call rule
 * generalised — the first call has no predecessor, so any read by it is
 * pre-existing — and it also catches the case the earliest-call rule alone
 * misses, where a cheap first call writes nothing and the second reads a prefix
 * from an earlier round.
 *
 * **Order is the caller's claim, and the failure direction is safe.** These come
 * off the collector in the order the calls were *recorded*, which is the order
 * they finished; every function driven by evals/cost/interactions.ts awaits its
 * calls one at a time, so finishing order is calling order. If that ever stops
 * being true, a concurrent pair can look like a read before its own write —
 * which reports a warm round and withholds a ratio, rather than printing one
 * that is wrong.
 *
 * A `null` cache-write is read as zero: not knowing whether this round wrote a
 * cache is not evidence that it did.
 */
export function roundCache(calls: readonly CacheCall[]): RoundCache {
  if (calls.length === 0) return { kind: "no-calls" };
  let written = 0;
  let readWithinRound = 0;
  for (const call of calls) {
    if (call.cacheRead === null) {
      return {
        kind: "unknown",
        why: "a call reported no cache-read count, so whether it was cold is unknown rather than " +
          "established — and unknown is not evidence of coldness",
      };
    }
    if (call.cacheRead > 0) {
      if (written === 0) return { kind: "warm", read: call.cacheRead };
      readWithinRound += call.cacheRead;
    }
    written += call.cacheWrite ?? 0;
  }
  return { kind: "cold", readWithinRound };
}

/** One measured round, reduced to what decides whether a ratio may be printed. */
export interface RoundForRatio {
  expected: "cold" | "warm";
  nanos: number;
  /** Calls that reported no cost. A total carrying them is short by an unknown amount. */
  unpriced: number;
  /** The round threw. What it bought is what it bought before failing. */
  failed: boolean;
  cache: RoundCache;
}

/**
 * **"cache worth 2.5×" or nothing, and nothing is a fine answer.**
 *
 * The ratio was being printed from two rounds labelled cold and warm by their
 * position in the loop, which is not an observation. Chat's tool loop can read
 * cache on a later call when the first was cold; chat may invoke passage search
 * before the standalone search task, warming a round still labelled cold; a
 * failed round's number is what it bought before it fell over; and an unpriced
 * round's number is short by an unknown amount. Any of those makes the quotient
 * a wrong number wearing a plausible one's clothes.
 *
 * So it is printed only when both rounds succeeded, both were priced, and each
 * one's observed cache state is the state it was labelled with.
 */
export function cacheRatio(
  cold: RoundForRatio,
  warm: RoundForRatio,
): { kind: "ratio"; ratio: number } | { kind: "none"; why: string } {
  for (const [what, round] of [["cold", cold], ["warm", warm]] as const) {
    if (round.failed) return { kind: "none", why: `the ${what} round failed` };
    if (round.unpriced > 0) {
      return { kind: "none", why: `the ${what} round has ${round.unpriced} unpriced call(s)` };
    }
    if (round.nanos <= 0) return { kind: "none", why: `the ${what} round recorded no cost` };
    if (round.cache.kind === "unknown") {
      return { kind: "none", why: `the ${what} round's cache state is unknown: ${round.cache.why}` };
    }
    if (round.cache.kind === "no-calls") {
      return { kind: "none", why: `the ${what} round made no calls` };
    }
    if (round.cache.kind !== round.expected) {
      return {
        kind: "none",
        why:
          `the ${what} round was labelled ${round.expected} and read ` +
          (round.cache.kind === "warm"
            ? `${round.cache.read} pre-existing cached token(s)`
            : "no pre-existing cache"),
      };
    }
  }
  return { kind: "ratio", ratio: cold.nanos / warm.nanos };
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
 *
 * **Three ranks, not two.** An explained absence is not fatal — the run has to
 * carry on past it, or a sweep counting semantic failures stops at the first one
 * — but it is not an aside either: it says this draw was billed and produced
 * nothing, which is the one thing a reader must not miss while scanning a page
 * of dollars. So it sorts above the ordinary notes, and its message leads with
 * the words rather than relying on the label, because the same text is what a
 * later reader finds in `run.json`.
 */
function findingRank(f: Finding): number {
  if (f.fatal) return 0;
  return f.kind === "explained-absence" ? 1 : 2;
}

export function formatFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) return "";
  const ordered = [...findings].sort((a, b) => findingRank(a) - findingRank(b));
  return ordered.map((f) => `  ${f.fatal ? "FATAL" : "note "} ${f.message}`).join("\n");
}
