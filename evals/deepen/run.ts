/**
 * Eval — **stage 5b: the first paid deepening wave, and the five questions it
 * exists to answer.**
 *
 *   npm run eval:deepen -- --book output/2701-h.html --article output/noema.html
 *   npm run eval:deepen -- --book … --article … --dry-run      (free: no model call)
 *   npm run eval:deepen -- --book … --article … --repeats 3 --spend
 *
 * **Preflight is the default posture and the paid path needs `--spend`.** With
 * neither flag this runs every gate, runs the free seam probe, prints the plan
 * and prints the bill — and buys nothing.
 * docs/plans/260904d-deepen-fat-sections.md § stage 5b.
 *
 * ## Why this is not one of the tools that already exist
 *
 * - `npm run hierarchy` used to pass `nullCheckpointStore()` and resume nothing,
 *   so every repeat would re-buy the ~$1.00 structure call **and hand each
 *   repeat a different seed** — precisely the confound that makes question 1
 *   unanswerable. Stage E put that command through the queue on 2026-09-05
 *   (`scripts/stage.ts`), so it resumes now; what it still has no notion of is
 *   the four phases, the fixture ingress, the gates, or the pairing below.
 * - `npm run eval:cost --against` has no force, and its `no-spend` finding
 *   exists to *refuse* a repeat of an already-done step.
 * - Adding a book to `evals/cost/fixtures.ts` would point a checked-in fixture
 *   at an **untracked** file and break that eval for everybody else.
 *
 * So: a new eval, self-contained, owning its own ingress — but reusing the cost
 * eval's three proved mechanisms verbatim (`evalRegistry`, `fixtureFetch`,
 * `withoutTheInProcessPump`) and its gates. Nothing in `src/` changes for this
 * to work.
 *
 * ## The four phases
 *
 * - **A — the book, ingested with deepening on.** One job, the production
 *   `STEPS`, with only stage 1 replaced by a fixture step that writes the local
 *   bytes. This is repeat 1.
 * - **B — the repeats, serial.** `{steps: ["hierarchy"], force: ["hierarchy"]}`
 *   against the same slug, with `SPIDERYARN_DEEPEN_REASK` naming that slug.
 *   **Serial deliberately**: a contended repeat would confound question 1, which
 *   is the one the rest of the plan leans on. Forcing re-runs the step; the
 *   *structure* checkpoint still resumes, so the seed is held constant and only
 *   the scoped wave is re-bought — which this run proves for free before it
 *   spends, and checks again against the ledger afterwards.
 * - **C — inertness.** One ordinary article ingested with the flag **off**, then
 *   the same article's hierarchy forced with the flag **on**. The published tree
 *   must be identical and `deepen.targets` must be 0. "Nobody asked" and "asked
 *   and found nothing" are different facts, and the artefacts distinguish them:
 *   the flag-off pass writes no records file at all.
 * - **D — the budget under load.** Three jobs at once at
 *   `DEFAULT_JOB_CONCURRENCY`: one more forced hierarchy on the book (so it is a
 *   further repeat rather than pure overhead) and two ordinary articles.
 *
 * ## What it refuses to do
 *
 * Every gate is before the first job exists, because none of them can be
 * repaired after the money has moved. Four are the cost eval's and are imported
 * rather than restated — a non-local database, an owner a browser could be
 * signed in as, an unseeded eval owner, a ledger that cannot be read. Two are
 * this eval's own:
 *
 * - **A re-ask lever that does not name the book**, or that names an article it
 *   must not. See `assertReaskNames`.
 * - **A seam that has not been watched working**, in this process, under this
 *   run's own book slug. See `proveTheSeam`.
 */

import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { inArray, sql } from "drizzle-orm";

import { withSpendAttribution } from "../../src/ai-spend.js";
import { withLedger } from "../../src/cli-ledger.js";
import { getDb } from "../../src/db/client.js";
import { articles, jobs as jobsTable } from "../../src/db/schema.js";
import { loadEnvLocal } from "../../src/env.js";
import { CASCADE_RECIPE } from "../../src/hierarchy-cascade.js";
import {
  DEEPEN_ENV,
  DEEPEN_RECORDS_ENV,
  REASK_ENV,
  type DeepenStats,
  deepenTree,
  freeAnswer,
} from "../../src/hierarchy-deepen.js";
import type { ExpansionRequest } from "../../src/hierarchy-expand.js";
import { buildTree, type ModelNode, structureRequest } from "../../src/hierarchy.js";
import { isMain } from "../../src/is-main.js";
import {
  type AdvanceParts,
  advanceJobWith,
  claimSession,
  DEADLINE_MARGIN_MS,
  DEFAULT_JOB_CONCURRENCY,
  enqueue,
  jobConcurrency,
  LEASE_MS,
  REQUEUE_BUDGET,
  STEP_BUDGET_MS,
  type StepRegistry,
} from "../../src/jobs.js";
import { modelFor } from "../../src/models.js";
import { environmentOwnerId, EVAL_OWNER_ID, runAsOwner } from "../../src/owner.js";
import { DEFAULT_INGEST_STEPS, STEPS } from "../../src/pipeline.js";
import { costStore } from "../../src/store/ai-calls.js";
import { loadArticle } from "../../src/store/index.js";
import type { Block, Job, StepName, Tree } from "../../src/types.js";
import type { CostFixture } from "../cost/fixtures.js";
import {
  assertDistinctEvalOwner,
  assertLedgerUsable,
  evalRegistry,
  fixtureFetch,
  localTarget,
} from "../cost/harness.js";
import {
  aggregateByAiJob,
  aggregateByStep,
  checkLedgerComplete,
  checkScope,
  type Money,
  moneyTotalNanos,
  type StepObservation,
  type StepSpend,
  totalMoney,
  formatStepTable,
} from "../cost/report.js";
import {
  assertReaskNames,
  assertSeamProof,
  checkpointWriter,
  type CostEstimate,
  estimate,
  fileFixture,
  formatEstimate,
  listRecordsDir,
  readRecordsDir,
  recordingCheckpoints,
  requeueVerdict,
  type SeamProof,
  treeDigest,
} from "./harness.js";
import {
  asDeepenFinding,
  boundTally,
  budgetReport,
  checkDriving,
  checkInertness,
  checkRepeatBoughtItsWave,
  compareRepeats,
  costReport,
  type DeepenFinding,
  formatFindings,
  formatQ1,
  formatQ2,
  formatQ3,
  formatQ4,
  formatDriving,
  formatQ5,
  q1Gate,
  type RecordsPass,
  type StepClock,
  usablePasses,
  verdictGate,
  wave1Unchanged,
  yesRates,
} from "./report.js";

/** Nothing here should take longer than this. A hung claim is a bug, not patience. */
const JOB_TIMEOUT_MS = 40 * 60_000;
const BUSY_BACKOFF_MS = 500;

/** The deadline a claimant works to, which is what question 5 is measured against. */
const EFFECTIVE_DEADLINE_MS = LEASE_MS - DEADLINE_MARGIN_MS;

/* ---------------------------------------------------------------- the record -- */

interface RunMeta {
  startedAt: string;
  commit: string;
  gitDirty: boolean;
  /** sha256 of `git diff HEAD -- src evals`, so a dirty tree is identifiable rather than flagged. */
  srcPatchSha256: string | null;
  databaseTarget: string;
  evalOwnerId: string;
  environmentOwnerId: string;
  node: string;
  model: string | null;
  effort: {
    hierarchy: string | null;
    pipelineEnvOverride: string | null;
    note: string;
  };
  /** What phase D is planned at — `DEFAULT_JOB_CONCURRENCY`. */
  jobConcurrency: number;
  /**
   * **What the queue's cap really is in this process**, read from
   * `jobConcurrency()` rather than the constant. `SPIDERYARN_JOB_CONCURRENCY` is
   * read at call time, so a shell that set it to 1 serialises phase D while the
   * metadata goes on saying 3. ⟨GPT Sol, DPN-04.⟩
   */
  jobConcurrencyRuntime: number;
  stepBudgetMs: number;
  effectiveDeadlineMs: number;
}

interface JobRecord {
  phase: "A" | "B" | "C" | "D";
  label: string;
  /** Which repeat of the book's wave this is, 1-based. `null` for an article job. */
  repeat: number | null;
  slug: string;
  jobId: string;
  createdArticle: boolean;
  /** What the levers really were while this job ran, read back rather than intended. */
  deepenFlag?: boolean;
  reaskEnv?: string | null;
  steps: readonly StepName[];
  force: readonly StepName[];
  /** The wall-clock window this job was driven in — how phase D's overlap is checked. */
  startedAt?: string;
  finishedAt?: string;
  jobStatus?: Job["status"];
  jobError?: string;
  stepOutcomes?: {
    name: string;
    status: string;
    detail?: string;
    error?: string;
    /** The step's own window, which is what phase D's concurrency is measured over. */
    startedAt?: string | null;
    finishedAt?: string | null;
    ms: number | null;
  }[];
  elapsedMs?: number;
  /** `finishedAt - startedAt` on the hierarchy step alone — question 5. */
  hierarchyMs?: number | null;
  /**
   * **How many times the claimant handed this job back at its own deadline**,
   * and `null` where it never did. Non-null on a re-asking pass means this run
   * stopped rather than buying the wave again — `driveToDone`.
   */
  requeuedAt?: number | null;
  /**
   * **`null` where the ledger read did not complete**, which is not the same
   * fact as `$0` and must never be summed as one. ⟨GPT Sol, DPN-02.⟩
   */
  money?: Money | null;
  byStep?: StepSpend[];
  byAiJob?: StepSpend[];
  unreadable?: number;
  /**
   * **What each step's own spend collector saw**, from `AdvanceParts.onStepSpend`
   * — the only evidence that can notice a ledger row that was never inserted.
   * A Postgres `forJob` read reports `unreadable: 0` however many are missing.
   */
  observedSpend?: StepObservation[];
  /** The records files this job left behind, by name. */
  recordsFiles?: string[];
  stats?: DeepenStats | null;
  /** Did the wave throw? `null` where no records file was written at all. */
  waveFailed?: boolean | null;
  waveFailureReason?: string | null;
  findings?: DeepenFinding[];
}


interface RunFile {
  meta: RunMeta;
  runTag: string;
  args: Record<string, unknown>;
  fixtures: { role: string; file: string; sha256: string; bytes: number }[];
  notes: string[];
  seamProof: SeamProof | null;
  estimate: CostEstimate;
  jobs: JobRecord[];
  answers?: Record<string, unknown>;
  findings?: DeepenFinding[];
}

const STANDING_NOTES = [
  "Stage 1 (fetch) is a fixture read of a file named on the command line, so no network latency " +
    "is in any elapsed time here, and there is no committed manifest holding those bytes constant " +
    "— output/ is gitignored. The sha256 of what this run read is in `fixtures`.",
  "There is no `labels` step: nav labels fan out inside `hierarchy`. Every label call carries " +
    "stepName=hierarchy and job=labels. The SCOPED EXPANSION CALLS also carry job=hierarchy, the " +
    "same as the whole-document structure call — so on a repeat with the structure checkpoint " +
    "resumed, the `hierarchy` bucket IS the wave. `checkRepeatBoughtItsWave` is what turns that " +
    "into a check rather than an assumption.",
  "Money is the ledger's (`costStore.forJob`). Token counts are reported beside it and are never " +
    "converted into a price here.",
  "Question 1 pairs candidates on parent-plus-derived-range, never on `where`, which is an ordinal " +
    "path derived from the answer's own fan-out. Verdict flips, changed fan-out and moved " +
    "boundaries at equal fan-out are three separate rows and must not be added together.",
  "A repeat is only a repeat if it bought its wave again. SPIDERYARN_DEEPEN_REASK names the book's " +
    "slug and nothing else; the structure checkpoint is deliberately still resumed, which is what " +
    "holds the seed constant.",
  "Phase D runs three jobs at once, and this box is shared: another agent's dev server holding a " +
    "claim slot would serialise them. Read the per-step clocks against each other, not only " +
    "against the budget.",
];

/* ------------------------------------------------------------------ driving -- */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * **Drive one job to done — unless it hands its claim back, and that is a
 * refusal rather than a retry.**
 *
 * `advanceJobWith` returns `{done: false, busy: false}` in two quite different
 * situations. The ordinary one is "there is more to do, ask again". The other is
 * a **requeue**: the claimant reached its own 740 s deadline inside a step,
 * unwound cleanly, and put the job back on the queue with `requeues`
 * incremented (src/jobs.ts § `pauseForDeadline`). The loop cannot tell them
 * apart from the flags alone — and the difference is $14.80.
 *
 * **Re-driving a requeued *re-asking* pass buys the whole wave again.** The
 * slug is still named in `SPIDERYARN_DEEPEN_REASK`, so the next claim ignores
 * the checkpoint rows the first one just wrote and pays for every scoped call a
 * second time; `REQUEUE_BUDGET = 2` permits three windows, so one nominal pass
 * of the book could buy its wave three times. That is absent from the printed
 * estimate entirely, which is why the estimate was never a bound.
 * ⟨GPT Sol reviewing the stage-5b harness, DPN-07.⟩
 *
 * So a re-asking pass stops on its first requeue: the job is left `queued` and
 * resumable, the self-abort is recorded, and the pass becomes a fatal finding
 * rather than a silent third purchase. An ordinary pass is re-driven as before,
 * and must be — a book's `hierarchy` step needs 658–778 s against a 740 s
 * deadline, so a requeue there is routine, and without the lever the re-drive
 * resumes every answer it already paid for.
 */
async function driveToDone(
  start: Job,
  steps: StepRegistry,
  opts: {
    onStepSpend: NonNullable<AdvanceParts["onStepSpend"]>;
    /** Is this slug named in the re-ask lever right now? Then a requeue re-buys. */
    reasking: boolean;
  },
): Promise<{ job: Job; elapsedMs: number; requeuedAt: number | null }> {
  let job = start;
  const startedAt = Date.now();
  const requeuesBefore = job.requeues ?? 0;
  for (;;) {
    if (Date.now() - startedAt > JOB_TIMEOUT_MS) {
      throw new Error(`${job.slug}: still not done after ${JOB_TIMEOUT_MS / 60_000} minutes`);
    }
    const advanced = await withSpendAttribution(
      { jobId: job.id, articleSlug: job.slug, ownerId: EVAL_OWNER_ID },
      () => advanceJobWith(job.id, { session: claimSession, steps, onStepSpend: opts.onStepSpend }),
    );
    if (!advanced) throw new Error(`${job.slug}: job ${job.id} vanished mid-run`);
    job = advanced.job;
    if (advanced.done) return { job, elapsedMs: Date.now() - startedAt, requeuedAt: null };
    const requeues = job.requeues ?? 0;
    if (requeueVerdict({ reasking: opts.reasking, requeuesBefore, requeuesNow: requeues }) === "stop") {
      return { job, elapsedMs: Date.now() - startedAt, requeuedAt: requeues };
    }
    /* `busy` means somebody else holds a running slot — another agent's dev
       server, most likely, since this box is shared. Back off and ask again,
       exactly as `pump` does. */
    if (advanced.busy) await sleep(BUSY_BACKOFF_MS);
  }
}

function stepMs(step: { startedAt?: string; finishedAt?: string }): number | null {
  if (step.startedAt === undefined || step.finishedAt === undefined) return null;
  return Date.parse(step.finishedAt) - Date.parse(step.startedAt);
}

/* ------------------------------------------------------------------ one job -- */

interface Ingress {
  fixture: CostFixture;
  bytes: Uint8Array;
}

interface RunContext {
  runTag: string;
  runFile: RunFile;
  recordsDir: string;
  checkpoint: () => Promise<void>;
  /** Free mode: a step list with no model call in it, for proving the shape. */
  dryRun: boolean;
}

/** What a job is asked for, before the queue has given it a name. */
interface JobSpec {
  phase: JobRecord["phase"];
  label: string;
  repeat: number | null;
  slug: string;
  url: string | null;
  ingress: Ingress | null;
  steps: readonly StepName[];
  force: readonly StepName[];
}

/** A job the queue has taken, and the registry that must drive it. */
interface QueuedJob {
  spec: JobSpec;
  job: Job;
  record: JobRecord;
  registry: StepRegistry;
  /** The records files that were already in the directory when this was queued. */
  before: ReadonlySet<string>;
}

/**
 * **The two environment levers, set for a whole phase rather than for a job.**
 *
 * They are `process.env`, read at call time by `deepeningEnabled()` and
 * `reaskExpansions(slug)` — so setting and restoring them *per job* was wrong the
 * moment phase D ran three jobs at once: the first to finish restored the
 * variable out from under the two still running. A phase is the unit that has one
 * answer to both questions, so a phase is what holds them.
 *
 * `reask` names slugs rather than being a boolean precisely so that one setting
 * can be right for three concurrent jobs: the book is re-bought and the two
 * articles beside it are not.
 */
async function withLevers<T>(
  levers: { deepen: boolean; reask: readonly string[] },
  fn: () => Promise<T>,
): Promise<T> {
  const flagBefore = process.env[DEEPEN_ENV];
  const reaskBefore = process.env[REASK_ENV];
  const reaskEnv = levers.reask.length > 0 ? levers.reask.join(",") : null;
  if (levers.deepen) process.env[DEEPEN_ENV] = "1";
  else delete process.env[DEEPEN_ENV];
  if (reaskEnv !== null) process.env[REASK_ENV] = reaskEnv;
  else delete process.env[REASK_ENV];
  console.log(
    `  levers  ${DEEPEN_ENV}=${levers.deepen ? "1" : "(unset)"}   ${REASK_ENV}=${reaskEnv ?? "(unset)"}`,
  );
  try {
    return await fn();
  } finally {
    if (flagBefore === undefined) delete process.env[DEEPEN_ENV];
    else process.env[DEEPEN_ENV] = flagBefore;
    if (reaskBefore === undefined) delete process.env[REASK_ENV];
    else process.env[REASK_ENV] = reaskBefore;
  }
}

/**
 * **Queue one job, with the production pump switched off on the request.**
 *
 * `enqueue` ends with `pump()`, which drives the job with the **production**
 * registry and wins the claim synchronously — so this eval's fixture ingress and
 * spend overlay would be bypassed entirely, and production's `fetch` would go to
 * the network at `https://deepen-eval.invalid/…`.
 *
 * **That is not hypothetical**: phase D's first `--dry-run` did exactly this, and
 * one of the three articles failed with a DNS error while its neighbours were
 * fine. The cause was the old silencer — `VERCEL=1` set across the `enqueue`
 * call, because `pump` returns immediately when it is set. A single global
 * variable, so two overlapping `enqueue`s raced on it: the first to return
 * restored it while the second was still inside.
 *
 * **`pump: false` is the fix, and it is not ours** — `src/jobs.ts` § `pump` added
 * it for `scripts/stage.ts` and `evals/cost/run.ts`, calling the `VERCEL` trick
 * "a lie … a process on a laptop claimed to be running on Vercel in order to get
 * one `if` to go the other way". It is per-request rather than per-process, so
 * there is no global left to race on and the hazard is gone rather than
 * sequenced around. `dryRunReport` still asserts afterwards that no fetch reached
 * the network, because the check outlived the bug that prompted it.
 */
async function enqueueJob(ctx: RunContext, spec: JobSpec): Promise<QueuedJob> {
  const before = await listRecordsDir(ctx.recordsDir);
  const registry = evalRegistry(
    spec.ingress
      ? { ...STEPS, fetch: fixtureFetch(spec.ingress.fixture, spec.ingress.bytes, spec.url ?? "") }
      : STEPS,
  );
  const job: Job = await enqueue({
    slug: spec.slug,
    ...(spec.url !== null ? { url: spec.url } : {}),
    steps: [...spec.steps],
    ...(spec.force.length > 0 ? { force: [...spec.force] } : {}),
    pump: false,
  });
  const record: JobRecord = {
    phase: spec.phase,
    label: spec.label,
    repeat: spec.repeat,
    slug: job.slug,
    jobId: job.id,
    createdArticle: spec.ingress !== null,
    steps: spec.steps,
    force: spec.force,
  };
  /* Recorded **before** the job runs: a crash from here on leaves a cleanup
     manifest rather than an article nobody can name. */
  ctx.runFile.jobs.push(record);
  await ctx.checkpoint();
  console.log(`\n[${spec.phase}] ${spec.label}`);
  console.log("─".repeat(70));
  console.log(
    `  slug ${job.slug}   job ${job.id}\n` +
      `  steps ${spec.steps.join(",")}${spec.force.length ? `   force ${spec.force.join(",")}` : ""}`,
  );
  return { spec, job, record, registry, before };
}

/**
 * Drive one queued job to done, read the ledger and the records, and print it.
 *
 * **It reports rather than throws**, for everything after the job has stopped.
 * A ledger read or a records parse that rejected used to take the whole phase
 * down with it: `Promise.all` rejects on the first, `withLevers` then restores
 * `DEEPEN` and `REASK` out from under the two jobs still running, and reporting
 * starts reading half-written ledgers and deleting articles underneath live
 * tasks. ⟨GPT Sol, DPN-06.⟩ So the money that has already moved is recorded and
 * the failure becomes a fatal finding.
 */
async function driveJob(ctx: RunContext, queued: QueuedJob): Promise<JobRecord> {
  const { spec, job, record, registry, before } = queued;
  const findings: DeepenFinding[] = [...(record.findings ?? [])];
  record.startedAt = new Date().toISOString();

  /* **What each step's collector saw**, so the ledger can be checked for being
     short rather than merely read — `costStore.record` failures are counted and
     swallowed, and a Postgres `forJob` read cannot report a row that was never
     inserted. Copied from evals/cost/run.ts § `oneDraw`, accumulation and all:
     a step executed twice reports twice, and taking the last would hide half
     the calls from the reconciliation. */
  const observedSpend: StepObservation[] = [];
  const onStepSpend: NonNullable<AdvanceParts["onStepSpend"]> = (step, report) => {
    const seen = observedSpend.find((o) => o.step === step);
    const one = seen ?? { step, calls: 0, pending: 0, writeFailures: 0 };
    if (!seen) observedSpend.push(one);
    one.calls += report.calls.length;
    one.pending += report.pending.length;
    one.writeFailures += report.writeFailures;
  };

  const reasking = (process.env[REASK_ENV] ?? "").split(",").includes(job.slug);
  const driven = await driveToDone(job, registry, { onStepSpend, reasking });
  record.finishedAt = new Date().toISOString();
  record.elapsedMs = driven.elapsedMs;
  record.jobStatus = driven.job.status;
  record.requeuedAt = driven.requeuedAt;
  if (driven.job.error !== undefined) record.jobError = driven.job.error;
  record.stepOutcomes = driven.job.steps.map((s) => ({
    name: s.name,
    status: s.status,
    ...(s.detail !== undefined ? { detail: s.detail } : {}),
    ...(s.error !== undefined ? { error: s.error } : {}),
    startedAt: s.startedAt ?? null,
    finishedAt: s.finishedAt ?? null,
    ms: stepMs(s),
  }));
  record.hierarchyMs = record.stepOutcomes.find((s) => s.name === "hierarchy")?.ms ?? null;
  record.deepenFlag = process.env[DEEPEN_ENV] === "1";
  record.reaskEnv = process.env[REASK_ENV] ?? null;
  record.observedSpend = observedSpend;

  if (driven.requeuedAt !== null) {
    findings.push({
      kind: "requeued",
      fatal: true,
      message:
        `${spec.label}: the claimant handed this job back at its own deadline (requeue window ` +
        `${driven.requeuedAt} of ${REQUEUE_BUDGET + 1}) while ${REASK_ENV} still named ${job.slug}. ` +
        "This run STOPPED rather than re-claiming it: the next claim would ignore the checkpoint " +
        "rows this one just wrote and buy the whole wave again, and the budget permits three such " +
        "windows. The job is left `queued` and resumable; this pass is partial and must not be " +
        "quoted as a repeat.",
    });
  }

  /* **The ledger, and both ways it can be short.** `forJob` is the money that
     landed; `checkScope` asks whether it landed in the eval's bucket at all
     (this eval drives jobs with no `fetch` step, so the fixture check cannot
     stand in for it — DPN-01); `checkLedgerComplete` asks whether every call the
     collectors saw has a row (DPN-02). Both are the cost eval's, imported. */
  try {
    const ledger = await costStore.forJob(job.id);
    record.unreadable = ledger.unreadable;
    record.money = totalMoney(ledger.rows);
    record.byStep = aggregateByStep(ledger.rows);
    record.byAiJob = aggregateByAiJob(ledger.rows);
    findings.push(...checkScope(ledger.rows, "eval").map(asDeepenFinding));
    findings.push(...checkLedgerComplete(ledger.rows, observedSpend).map(asDeepenFinding));
    if (ledger.unreadable > 0) {
      findings.push({
        kind: "not-answerable",
        fatal: true,
        message: `${spec.label}: ${ledger.unreadable} ledger line(s) could not be read.`,
      });
    }
  } catch (err) {
    record.money = null;
    findings.push({
      kind: "not-answerable",
      fatal: true,
      message:
        `${spec.label}: the ledger read failed (${err instanceof Error ? err.message : String(err)}). ` +
        "Its spend is UNKNOWN, not zero, and question 4 is short by whatever this job bought.",
    });
  }

  const fresh = await readRecordsDir(ctx.recordsDir, { slug: job.slug, since: before }).catch(
    (err: unknown) => {
      findings.push({
        kind: "no-records",
        fatal: true,
        message:
          `${spec.label}: the records files could not be read ` +
          `(${err instanceof Error ? err.message : String(err)}).`,
      });
      return [] as Awaited<ReturnType<typeof readRecordsDir>>;
    },
  );
  record.recordsFiles = fresh.map((f) => f.file);
  const last = fresh.at(-1)?.parsed;
  record.stats = last?.stats ?? null;
  /* **A wave that threw still leaves a records file**, with the governor's
     decisions and the bill and no expansion — `deepen-records/2` added `failed`
     for exactly this. Quoting its verdict rates beside a successful pass's
     would put a partial measurement in the same column as a whole one, so the
     flag travels with the pass (`RecordsPass.failed`) and the gates refuse it. */
  record.waveFailed = last?.failed ?? null;
  record.waveFailureReason = last?.reason ?? null;
  if (record.waveFailed === true) {
    findings.push({
      kind: "wave-failed",
      fatal: true,
      message:
        `${spec.label}: the deepening wave threw (${last?.reason ?? "no reason recorded"}). The ` +
        "article kept the tree wave 1 produced; the records are the governor's decisions and " +
        "the bill, and this pass expanded nothing. It is excluded from questions 1-3.",
    });
  }
  record.findings = findings;

  console.log(
    `  job ${record.jobStatus}${record.jobError ? ` — ${record.jobError}` : ""}   ` +
      `${(record.stepOutcomes ?? []).map((s) => `${s.name}=${s.status}`).join(" ")}`,
  );
  console.log(
    `  spend ${record.money == null ? "NOT READ" : `$${(moneyTotalNanos(record.money) / 1e9).toFixed(4)}`}` +
      (record.money != null && record.money.unpriced > 0 ? `   (${record.money.unpriced} unpriced)` : "") +
      `   hierarchy step ${record.hierarchyMs === null || record.hierarchyMs === undefined ? "—" : `${(record.hierarchyMs / 1000).toFixed(1)}s`}`,
  );
  if (record.byAiJob?.length) console.log(formatStepTable(record.byAiJob));
  console.log(
    `  deepening ${
      record.stats === null
        ? "no records file — nobody asked"
        : `${record.stats.expanded}/${record.stats.targets} section(s), ${record.stats.calls} call(s) ` +
          `(${record.stats.resumed} resumed, ${record.stats.withheld} withheld, ${record.stats.outOfTime} out of time), ` +
          `yes ${record.stats.verdicts.rawYes}/${record.stats.verdicts.rawYes + record.stats.verdicts.rawNo}`
    }`,
  );
  if (findings.length > 0) console.log(formatFindings(findings));
  await ctx.checkpoint();
  return record;
}

/* -------------------------------------------------------------- the answers -- */

/**
 * How many input tokens a structure call on this document would carry, which is
 * the floor `checkRepeatBoughtItsWave` compares the ledger against.
 *
 * Free — `structureRequest` builds the request without sending it — and it is a
 * **conservative** floor: it is the estimated answer size, which is far smaller
 * than the prompt, so a re-bought structure call cannot slip under it.
 */
function structureTokenFloor(blocks: number): number {
  /* Nothing here has the blocks in hand once the job is finished, and reading
     them back to price a check would be a second definition of what a structure
     call is. So the floor is deliberately crude: a whole-document call on a book
     carries at least this, and a wave of scoped calls carries far less. The
     figure is ~1 token per 3 characters over a book-sized prompt, floored at a
     number no wave could reach. */
  return Math.max(50_000, blocks * 100);
}

/**
 * **The five answers, each behind a gate that can refuse it.**
 *
 * Every one of Q1-Q5 could print a clean-looking number over evidence that was
 * absent, partial or failed, which is the disease `budgetReport` was already
 * caught with once and the review found in four more places:
 *
 * - **Q1** was computed over four book passes and calls them a controlled
 *   population of three. The declared population is A+B — serial *because* a
 *   contended repeat confounds question 1 — and phase D's book pass ran with
 *   two other jobs against it. It is reported with Q5, where the contention is
 *   the point. ⟨GPT Sol, DPN-12.⟩
 * - **Q1, Q2 and Q3** aggregated the records of a pass whose wave *threw*.
 *   ⟨DPN-05.⟩ And `0 of 0` prints as a flip rate of none. ⟨DPN-11.⟩
 * - **Q4** dropped any job whose ledger read never completed, so a missing bill
 *   read as a smaller one. ⟨DPN-02.⟩
 * - **Q5** counted three failed steps as three measurements. ⟨DPN-03/04.⟩
 */
function answerTheQuestions(opts: {
  /** Phase A and B's passes only — the declared controlled population for Q1. */
  bookPasses: RecordsPass[];
  /** How many of those the run set out to make. */
  expectedBookPasses: number;
  /** Every pass of every slug, failed ones included; the gates do the filtering. */
  allRecords: RecordsPass[];
  jobs: readonly JobRecord[];
  /** How many hierarchy steps phase D planned to run at once. */
  expectedLoadSteps: number;
  /** Which step phase D is measured on — `hierarchy`, or `blocks` under `--dry-run`. */
  measuredStep: string;
}): { answers: Record<string, unknown>; findings: DeepenFinding[]; printed: string } {
  const findings: DeepenFinding[] = [];
  const lines: string[] = [];
  const { bookPasses, allRecords, jobs, measuredStep } = opts;
  const book = usablePasses(bookPasses);

  /* --- Q1: phase A and phase B, and nothing else. */
  lines.push("\nQ1  Is the verdict stable across repeats?  (phases A and B only, serial)");
  lines.push("─".repeat(70));
  let q1: ReturnType<typeof compareRepeats> | null = null;
  if (book.usable.length >= 2) {
    findings.push(...wave1Unchanged(book.usable));
    try {
      q1 = compareRepeats(book.usable);
      lines.push(formatQ1(q1));
    } catch (err) {
      lines.push(`  REFUSED: ${err instanceof Error ? err.message : String(err)}`);
      findings.push({
        kind: "no-ranges",
        fatal: true,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    lines.push(
      `  NOT ANSWERABLE: ${book.usable.length} usable pass(es) of the book's wave` +
        `${book.failed.length > 0 ? ` and ${book.failed.length} failed` : ""}. Question 1 needs at ` +
        "least two, and each has to have bought its own calls.",
    );
  }
  const q1Findings = q1Gate({
    expectedPasses: opts.expectedBookPasses,
    usable: book.usable,
    failed: book.failed,
    stability: q1,
  });
  findings.push(...q1Findings);
  if (q1Findings.length > 0) lines.push(formatFindings(q1Findings));

  /* --- Q2 and Q3, over the passes that did not fail. */
  const all = usablePasses(allRecords);
  const everyRecord = all.usable.flatMap((p) => [...p.records]);
  lines.push("\nQ2  Does the model always say yes?  (raw yes rate, by wave and by node size)");
  lines.push("─".repeat(70));
  lines.push(
    `  over ${all.usable.length} pass(es)` +
      (all.failed.length > 0 ? `, ${all.failed.length} FAILED pass(es) excluded` : ""),
  );
  const q2 = yesRates(everyRecord);
  lines.push(formatQ2(q2));
  const q2Findings = verdictGate({ question: "Question 2", assessed: q2.overall.asked, failed: all.failed });
  findings.push(...q2Findings);
  if (q2Findings.length > 0) lines.push(formatFindings(q2Findings));

  lines.push("\nQ3  How often does a bound overrule the model?");
  lines.push("─".repeat(70));
  const q3 = boundTally(everyRecord);
  lines.push(formatQ3(q3));
  const q3Findings = verdictGate({ question: "Question 3", assessed: q3.assessed, failed: all.failed });
  findings.push(...q3Findings);
  if (q3Findings.length > 0) lines.push(formatFindings(q3Findings));

  /* --- Q4: every job, including the ones whose ledger could not be read. */
  lines.push("\nQ4  What does it actually cost?");
  lines.push("─".repeat(70));
  const q4 = costReport(
    jobs.map((j) => ({
      label: `${j.phase} ${j.label}`,
      nanos: j.money == null ? null : moneyTotalNanos(j.money),
      unpriced: j.money?.unpriced ?? 0,
      unreadable: j.unreadable ?? 0,
      isBook: j.repeat !== null,
    })),
  );
  lines.push(formatQ4(q4));
  findings.push(...q4.findings);

  /* --- Q5: phase D, on the step's own clocks and the step's own concurrency. */
  lines.push("\nQ5  Does it fit the budget under load?");
  lines.push("─".repeat(70));
  const clocks: StepClock[] = jobs
    .filter((j) => j.phase === "D")
    .map((j) => {
      const step = j.stepOutcomes?.find((s) => s.name === measuredStep);
      return {
        slug: j.slug,
        label: `${j.phase} ${j.label}`,
        ms: step?.ms ?? null,
        status: step?.status ?? null,
        startedAt: step?.startedAt ?? null,
        finishedAt: step?.finishedAt ?? null,
        hasStats: j.stats != null,
        outOfTime: j.stats?.outOfTime ?? null,
        withheld: j.stats?.withheld ?? null,
        resumed: j.stats?.resumed ?? null,
        uncheckpointed: j.stats?.uncheckpointed ?? null,
      };
    });
  const q5 = budgetReport({
    clocks,
    budgetMs: STEP_BUDGET_MS.hierarchy,
    deadlineMs: EFFECTIVE_DEADLINE_MS,
    expected: opts.expectedLoadSteps,
  });
  lines.push(formatQ5(q5));
  findings.push(...q5.findings);
  for (const over of q5.overBudget) {
    findings.push({
      kind: "over-budget",
      fatal: false,
      message: `${over.label} took ${((over.ms ?? 0) / 1000).toFixed(1)}s, past STEP_BUDGET_MS.hierarchy.`,
    });
  }
  /* **Phase D's book pass belongs here, not in Q1.** It is a real repeat and a
     real data point — that is why it is a repeat at all — but it ran under
     contention, so its place is beside the load measurement. */
  const dBook = allRecords.filter(
    (p) => p.phase === "D" && jobs.some((j) => j.slug === p.slug && j.repeat !== null),
  );
  for (const p of dBook) {
    lines.push(
      `  ${p.label} (the book's wave under load): ${p.stats.expanded}/${p.stats.targets} section(s), ` +
        `${p.stats.calls} call(s), yes ${p.stats.verdicts.rawYes}/` +
        `${p.stats.verdicts.rawYes + p.stats.verdicts.rawNo}` +
        `${p.failed ? "   FAILED — partial" : ""}. Deliberately NOT in question 1: it ran with two ` +
        "other jobs against it, and contention is the confound question 1's serial repeats exist " +
        "to keep out.",
    );
  }

  return {
    answers: { q1, q2, q3, q4, q5, phaseDBookPasses: dBook.map((p) => p.label) },
    findings,
    printed: lines.join("\n"),
  };
}

/* ------------------------------------------------------------------- args -- */

interface Args {
  book: string;
  articles: string[];
  repeats: number;
  spend: boolean;
  dryRun: boolean;
  keep: boolean;
}

function required(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} needs a value`);
  return value;
}

export function assertArgs(args: Args): void {
  if (args.spend && args.dryRun) {
    throw new Error(
      "--spend and --dry-run contradict each other: --dry-run runs the identical shape with a " +
        "step list that has no model call in it, which is how this harness is proved for free. " +
        "Pass one or the other.",
    );
  }
  if (args.repeats < 2) {
    throw new Error(
      `--repeats ${args.repeats} cannot answer question 1, which is the one the rest of the plan ` +
        "leans on: a stability figure needs at least two passes of the same wave. Phase A is " +
        "repeat 1, so --repeats 2 is the smallest run that measures anything.",
    );
  }
  if (args.repeats > 5) {
    throw new Error(
      `--repeats ${args.repeats} would buy the book's wave ${args.repeats} times over. The plan ` +
        "sized stage 5b at about $42 for three; refusing rather than letting a typo multiply it.",
    );
  }
  if (args.articles.length === 0) throw new Error("--article is required (an ordinary article's HTML)");
  if (args.articles.length > 3) {
    throw new Error("--article takes at most 3: one for phase C and two for phase D.");
  }
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { book: "", articles: [], repeats: 3, spend: false, dryRun: false, keep: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--book":
        args.book = required(argv[++i], "--book");
        break;
      case "--article":
        args.articles.push(required(argv[++i], "--article"));
        break;
      case "--repeats":
        args.repeats = Number(required(argv[++i], "--repeats"));
        if (!Number.isInteger(args.repeats)) throw new Error("--repeats needs an integer");
        break;
      case "--spend":
        args.spend = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--keep":
        args.keep = true;
        break;
      case "--preflight":
        /* The default posture, accepted so that saying it out loud is allowed. */
        break;
      default:
        throw new Error(`Unknown argument ${argv[i]}`);
    }
  }
  if (!args.book) throw new Error("--book is required (a long document's HTML)");
  assertArgs(args);
  return args;
}

/* ------------------------------------------------------------------- main -- */

function currentMeta(databaseTarget: string): RunMeta {
  const git = (a: string[]): string => execFileSync("git", a, { encoding: "utf-8" }).trim();
  let hierarchyEffort: string | null = null;
  let model: string | null = null;
  try {
    /* Free, and it reads the real constants rather than restating them: an empty
       body is a legal argument (`budgetFor` throws only when the answer cannot
       fit one response), and no call is made. The alternative was writing the
       model id and the effort down here, which is a second copy of a constant
       that has already moved once and taken a whole analysis with it —
       evals/cost/run.ts § structureEffort. */
    hierarchyEffort = structureRequest([]).effort;
    /* `modelFor("hierarchy")`, which is the same door `recordCandidate` writes
       onto every record — so the run's metadata and the records cannot disagree
       about which model produced them. `structureRequest`'s params leave the id
       to `streamMessage`, so reading it there gives `undefined`. */
    model = modelFor("hierarchy");
  } catch {
    /* A signature change here must not stop a paid run — `commit` recovers it. */
  }
  let patch: string | null = null;
  try {
    const diff = git(["diff", "HEAD", "--", "src", "evals"]);
    patch = diff.length === 0 ? null : createHash("sha256").update(diff).digest("hex");
  } catch {
    patch = null;
  }
  return {
    startedAt: new Date().toISOString(),
    commit: git(["rev-parse", "HEAD"]),
    gitDirty: git(["status", "--porcelain"]).length > 0,
    srcPatchSha256: patch,
    databaseTarget,
    evalOwnerId: EVAL_OWNER_ID,
    environmentOwnerId: environmentOwnerId(),
    node: process.version,
    model,
    effort: {
      hierarchy: hierarchyEffort,
      pipelineEnvOverride: process.env.SPIDERYARN_PIPELINE_EFFORT ?? null,
      note:
        "The expansion prompt's own effort is module-private in src/hierarchy-expand.ts " +
        "(EXPAND_EFFORT = PRODUCTION_EFFORT); `commit` and `srcPatchSha256` are what pin it. " +
        "Every CandidateRecord carries the model and effort it was decided under.",
    },
    jobConcurrency: DEFAULT_JOB_CONCURRENCY,
    jobConcurrencyRuntime: jobConcurrency(),
    stepBudgetMs: STEP_BUDGET_MS.hierarchy,
    effectiveDeadlineMs: EFFECTIVE_DEADLINE_MS,
  };
}

/**
 * **A queue cap that is not what phase D was planned at cannot measure phase D**
 * — and the run would spend $40.90 first and print an unmeasurable Q5 second.
 * Asked before anything is enqueued, on every path, so the refusal can be
 * watched on the free ones. ⟨GPT Sol, DPN-04.⟩
 */
export function assertJobConcurrency(runtime: number, planned: number): void {
  if (runtime === planned) return;
  throw new Error(
    `The queue's runtime cap is ${runtime} and phase D is planned at ${planned}: ` +
      "SPIDERYARN_JOB_CONCURRENCY is set in this process. Question 5 asks whether the hierarchy " +
      "step fits its budget with DEFAULT_JOB_CONCURRENCY jobs at once, and at any other cap the " +
      "three phase-D jobs serialise while all three promises stay alive — which reads as a pass. " +
      "Unset the variable and run again.",
  );
}

async function assertEvalOwnerReady(): Promise<void> {
  assertDistinctEvalOwner(EVAL_OWNER_ID, environmentOwnerId());
  const found = await getDb().execute(sql`select 1 from auth.users where id = ${EVAL_OWNER_ID}::uuid`);
  if (found.rows.length > 0) return;
  throw new Error(
    `The eval owner ${EVAL_OWNER_ID} is not in auth.users on this database. Run ` +
      "`npm run db:seed-owner` (scripts/seed-accounts.ts § SEEDED_ACCOUNTS). Without the row " +
      "every article this eval creates fails a foreign key from inside enqueue.",
  );
}

async function cleanup(jobs: readonly JobRecord[]): Promise<void> {
  const slugs = [...new Set(jobs.filter((j) => j.createdArticle).map((j) => j.slug))];
  const jobIds = jobs.map((j) => j.jobId);
  const db = getDb();
  const removed =
    slugs.length > 0
      ? await db.delete(articles).where(inArray(articles.slug, slugs)).returning({ id: articles.id })
      : [];
  if (jobIds.length > 0) await db.delete(jobsTable).where(inArray(jobsTable.id, jobIds));
  console.log(
    `\nCleaned up ${removed.length} article(s) and ${jobIds.length} job(s) this run created. ` +
      "Ledger rows and checkpoint rows stay — the ledger is the product of the run, and the " +
      "checkpoints are what would make a later attempt cheap.",
  );
}

/** The step lists, which are the whole of what `--dry-run` changes. */
function stepsFor(dryRun: boolean): {
  ingest: readonly StepName[];
  rerun: readonly StepName[];
  force: readonly StepName[];
} {
  if (!dryRun) {
    return { ingest: DEFAULT_INGEST_STEPS, rerun: ["hierarchy"], force: ["hierarchy"] };
  }
  /* **The identical shape with no model call in it.** `blocks` re-runs the
     splitter, which is free, and forcing it drives the same enqueue → force →
     serial-repeat → concurrent-phase machinery the paid run drives. It proves
     the driving; it proves nothing about the wave, and the seam probe is what
     covers that half. Exactly how evals/cost/run.ts proves its sweep with
     `--modes blocks`. */
  return { ingest: ["fetch", "extract", "blocks"], rerun: ["blocks"], force: ["blocks"] };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseTarget = localTarget(process.env.DATABASE_URL);
  const meta = currentMeta(databaseTarget);
  const paid = args.spend;

  console.log(`Target: ${databaseTarget}`);
  console.log(
    `Commit: ${meta.commit.slice(0, 8)}` +
      (meta.gitDirty ? ` (tree dirty, src+evals patch ${meta.srcPatchSha256?.slice(0, 12) ?? "?"})` : ""),
  );
  console.log(`Ledger: ${costStore.describe()}`);
  console.log(`Owner:  ${meta.evalOwnerId}   (environment owner ${meta.environmentOwnerId})`);
  console.log(`Model:  ${meta.model ?? "?"}   hierarchy effort ${meta.effort.hierarchy ?? "?"}`);
  console.log(
    `Budget: STEP_BUDGET_MS.hierarchy ${(meta.stepBudgetMs / 1000).toFixed(0)}s, ` +
      `self-abort at ${(meta.effectiveDeadlineMs / 1000).toFixed(0)}s, ` +
      `job concurrency ${meta.jobConcurrencyRuntime} (planned ${meta.jobConcurrency})`,
  );

  assertJobConcurrency(meta.jobConcurrencyRuntime, meta.jobConcurrency);
  await assertEvalOwnerReady();
  await assertLedgerUsable(() => costStore.forJob("spya-deepen-probe"));

  /* The bytes, hashed as they are read. Both files before anything is enqueued:
     an ingress that cannot be read must not be discovered after phase A has
     been paid for. */
  const book = await fileFixture(args.book, "book");
  const articleFiles: Ingress[] = [];
  for (const [i, file] of args.articles.entries()) {
    articleFiles.push(await fileFixture(file, `article-${i + 1}`));
  }

  const runTag = Math.random().toString(36).slice(2, 10);
  const stamp = new Date().toISOString().slice(0, 10);
  const runDir = path.join(import.meta.dirname, "..", "results", `deepen-5b-${stamp}-${runTag}`);
  const recordsDir = path.join(runDir, "records");
  await mkdir(recordsDir, { recursive: true });
  process.env[DEEPEN_RECORDS_ENV] = recordsDir;

  /* Slugs are decided here, not by the queue, because the re-ask lever names a
     slug and the lever has to be checked BEFORE anything is bought. `enqueue`
     can still move a minted slug (it appends a short id), so every job records
     the slug the queue handed back, and the book's is re-checked once it is
     known. */
  const bookSlug = `evaldeepen-${runTag}-book`;
  const articleSlugs = [`evaldeepen-${runTag}-inert`, `evaldeepen-${runTag}-load1`, `evaldeepen-${runTag}-load2`];

  const counts = {
    bookIngestDeepened: 1,
    bookHierarchyRepeat: args.repeats - 1 + 1 /* the phase-D repeat */,
    articleIngestDeepened: 3,
    articleHierarchyResumed: 1,
  };
  const bill = estimate(counts);

  const runFile: RunFile = {
    meta,
    runTag,
    args: { ...args, mode: paid ? "spend" : args.dryRun ? "dry-run" : "preflight" },
    fixtures: [
      { role: "book", file: args.book, sha256: book.fixture.sha256, bytes: book.bytes.byteLength },
      ...articleFiles.map((a, i) => ({
        role: `article-${i + 1}`,
        file: args.articles[i]!,
        sha256: a.fixture.sha256,
        bytes: a.bytes.byteLength,
      })),
    ],
    notes: STANDING_NOTES,
    seamProof: null,
    estimate: bill,
    jobs: [],
  };
  /* Serialised and uniquely named — `checkpointWriter` says why, and phase D is
     what made it necessary: three concurrent jobs all checkpointing. */
  const checkpoint = checkpointWriter(path.join(runDir, "run.json"), () => runFile);
  await checkpoint();

  /* ------------------------------------------------------------ the plan -- */

  console.log("\nThe plan");
  console.log("─".repeat(70));
  const { ingest, rerun, force } = stepsFor(args.dryRun);
  console.log(`  A  ${bookSlug}   ingest ${ingest.join(",")}   deepen ON     (repeat 1)`);
  for (let r = 2; r <= args.repeats; r++) {
    console.log(
      `  B  ${bookSlug}   ${rerun.join(",")} forced   deepen ON, re-ask ON   (repeat ${r}, serial)`,
    );
  }
  console.log(`  C  ${articleSlugs[0]}   ingest ${ingest.join(",")}   deepen OFF`);
  console.log(`  C  ${articleSlugs[0]}   ${rerun.join(",")} forced   deepen ON    (must be inert)`);
  console.log(
    `  D  three at once: ${bookSlug} forced (repeat ${args.repeats + 1}), ` +
      `${articleSlugs[1]} ingest, ${articleSlugs[2]} ingest`,
  );

  console.log("\nWhat it will check");
  console.log("─".repeat(70));
  for (const line of [
    "the re-ask lever names the book's slug and neither article's — else repeats are free and circular",
    "the deepening path touches `hierarchy-deepen` and never `hierarchy-structure` — the seed is held",
    "an ordinary repeat resumes and buys nothing; a re-asking one buys every call again and reads none",
    "every repeat's wave-1 frontier is identical — if it moved, the seed moved and Q1 is void",
    "every repeat bought its own wave (stats.calls > 0 where stats.targets > 0)",
    "no REPEAT's `hierarchy` ledger rows carry a whole structure call's worth of input tokens — and phase A's do, because the ingest is what buys the seed",
    "every ledger row carries scopeKind \"eval\", so nothing here is billed to Product",
    "every call each step's own collector saw has a ledger row, and the ledger is re-read at the end to say whether the numbers stood still",
    "phase C: the published tree is unchanged, the flag-off pass wrote no records file, and deepen.targets is 0 — an eligible section makes it an invalid control, not a note",
    "phase D: the hierarchy STEPS' own windows reach concurrency 3, and three of them completed with stats — a step that started and failed carries a clock and is not a measurement",
    "a re-asking pass that hands its claim back at its own deadline is STOPPED, not re-driven: re-claiming it buys the whole wave again",
    "candidates paired across repeats on parent-plus-range, never on `where` — refused outright if the range is missing",
    "question 1 over phases A and B only, over passes whose wave did not throw, and refused outright if it matched nothing",
    "questions 2 and 3 refused where no node carried a verdict; question 4 refused where any job's bill is missing, unpriced or unreadable",
  ]) {
    console.log(`  - ${line}`);
  }

  console.log("\nWhat it will cost");
  console.log("─".repeat(70));
  console.log(formatEstimate(bill));

  /* ------------------------------------------------------- the free proof -- */

  console.log("\nThe seam, proved for free");
  console.log("─".repeat(70));
  assertReaskNames({
    envValue: bookSlug,
    mustName: [bookSlug],
    mustNotName: articleSlugs,
  });
  console.log(`  ${REASK_ENV}=${bookSlug} names the book and neither article.  ok`);
  const proof = await proveTheSeam(bookSlug);
  runFile.seamProof = proof;
  console.log(
    `  cold ${proof.cold} call(s); ordinary repeat ${proof.repeatWithoutReask}; re-asking repeat ` +
      `${proof.repeatWithReask} with ${proof.readsWhileReasking} read(s); namespaces touched: ` +
      `${proof.namespaces.join(", ")}.  ok`,
  );
  await checkpoint();

  if (!paid && !args.dryRun) {
    console.log(
      "\n--preflight (the default): every gate above passed and the seam was watched working. " +
        "Nothing was bought.\n  Add --dry-run to drive the identical four-phase shape with a " +
        "step list that has no model call in it, or --spend to buy the estimate above.",
    );
    console.log(`\nWrote ${path.relative(process.cwd(), runDir)}/run.json`);
    return;
  }

  /* ------------------------------------------------------------ the phases -- */

  const ctx: RunContext = { runTag, runFile, recordsDir, checkpoint, dryRun: args.dryRun };

  try {
    await runPhases({
      ctx,
      args,
      runTag,
      book,
      articleFiles,
      bookSlug,
      articleSlugs,
      steps: { ingest, rerun, force },
    });
  } finally {
    await reportRun({ ctx, args, bookSlug, runDir, measuredStep: rerun[0] ?? "hierarchy" });
  }
}


/* ------------------------------------------------------- the seam, proved -- */

/**
 * **The free proof, and it lives here rather than in `harness.ts` for a reason
 * that is about the import graph rather than about tidiness.**
 *
 * It needs `buildTree`, which is in `src/hierarchy.ts`, which imports the app —
 * and through it `src/cli-ledger.ts` and the ledger's filesystem adapter. This
 * file already imports the world and is never loaded by a test; `harness.ts` is
 * imported by `tests/deepen-eval.test.ts`, and keeping the reach out of it is
 * what lets that suite touch no store at all rather than needing an entry in
 * `tests/store-migration-registry.ts` excusing one.
 * docs/project/database.md; `scripts/store-migration-candidates.ts` is what says
 * whether this is still true.
 *
 * The assertions it is held to are `assertSeamProof`, which stays in
 * `harness.ts` and is unit-tested there — this half is the driving.
 */

/**
 * **Twelve synthetic paragraphs and a fake executor, and it costs nothing.**
 *
 * Two authored headings that no boundary starts on, so the heading rule forces
 * the one section open — the same construction `tests/hierarchy-deepen-wave.test.ts`
 * uses, because the point is to exercise `deepenTree`'s checkpoint behaviour and
 * not to be a realistic article.
 *
 * **It runs under the run's own book slug**, which is the whole reason it is
 * here rather than left to the test suite: the tests prove the mechanism against
 * a fixed slug, and what this run needs to know is that the mechanism fires for
 * *this* slug, on this machine, with the environment this process is actually
 * carrying.
 */
function probeBlocks(): Block[] {
  /* **Inside the function, not beside it.** The program's edge is an
     `await withLedger(...)` at module scope above, so a `const` declared below
     it is in its temporal dead zone when `main` runs — which this file learned
     by throwing `Cannot access 'ALPHABET' before initialization` out of the
     preflight. A function declaration hoists; a `const` does not. */
  const ALPHABET = "abcdefghjkmnpqrstuvwxyz023456789";
  const id = (i: number): string => `spya-p${ALPHABET[Math.floor(i / 32) % 32]}${ALPHABET[i % 32]}000`;
  return Array.from({ length: 24 }, (_, i) => {
    const text = `Paragraph ${String(i).padStart(4, "0")} says something about the matter at hand.`;
    const heading = i === 6 || i === 15;
    return {
      id: id(i),
      tag: heading ? "h2" : "p",
      kind: heading ? "heading" : "text",
      ...(heading ? { level: 2 as const } : {}),
      text: heading ? `Heading ${i}` : text,
      words: 40,
      html: `<${heading ? "h2" : "p"} id="${id(i)}">${text}</${heading ? "h2" : "p"}>`,
      gistable: true,
    } as Block;
  });
}

export async function proveTheSeam(slug: string): Promise<SeamProof> {
  const blocks = probeBlocks();
  const first = blocks[0]!.id;
  const last = blocks.at(-1)!.id;
  const empty = { repairs: [], droppedChildren: [], droppedHeadings: [], collapsedRungs: [], droppedQuestions: [] };
  const proposal: ModelNode = {
    title: "The Whole Probe",
    gist: "It argues one thing at length, in two parts.",
    range: [first, last],
    children: [
      {
        title: "The Headed Part",
        gist: "It sets out the case under headings of its own.",
        range: [first, blocks[11]!.id],
      },
      {
        title: "The Plain Part",
        gist: "It answers the objection at moderate length.",
        range: [blocks[12]!.id, last],
      },
    ],
  };
  const tree: Tree = buildTree(proposal, {}, blocks, slug, empty);
  const store = recordingCheckpoints({ slug, articleId: "deepen-eval-seam-probe" });

  let sent = 0;
  const execute = async (request: ExpansionRequest): Promise<ReturnType<typeof freeAnswer>> => {
    sent++;
    const sections = request.own.split(/^SECTION /m).filter((s) => s.trim().length > 0);
    return freeAnswer(
      JSON.stringify({
        sections: sections.map((section, i) => {
          const ids = [...section.matchAll(/(spya-p[a-z0-9]{5})/g)].map((m) => m[1]!);
          const at = blocks.findIndex((b) => b.id === ids[0]);
          const to = blocks.findIndex((b) => b.id === ids.at(-1));
          const middle = at + Math.floor((to - at + 1) / 2);
          return {
            section: i + 1,
            children: [at, middle].map((start, k) => ({
              start: blocks[start]!.id,
              title: `Part ${k + 1} of section ${i + 1}`,
              gist: `Part ${k + 1} makes a claim of its own about the matter.`,
              verdict: k === 0 ? "finished" : "needs-deeper",
            })),
          };
        }),
      }),
    );
  };

  const pass = async (reask: boolean): Promise<number> => {
    sent = 0;
    await deepenTree({ tree, blocks, slug, checkpoints: store, execute, recipe: CASCADE_RECIPE, reask });
    return sent;
  };

  const cold = await pass(false);
  const repeatWithoutReask = await pass(false);
  const before = store.touched.length;
  const repeatWithReask = await pass(true);
  const readsWhileReasking = store.touched
    .slice(before)
    .filter((t) => t.startsWith("read ")).length;

  const proof: SeamProof = {
    cold,
    repeatWithoutReask,
    repeatWithReask,
    readsWhileReasking,
    namespaces: [...store.namespaces()].sort(),
  };
  assertSeamProof(proof);
  return proof;
}


/* -------------------------------------------------------------- the phases -- */

/**
 * **The four phases, in order**, extracted from `main` so that the driving and
 * the reporting are two things a reader can hold separately — the same split
 * `evals/cost/run.ts` makes with `runDraws`.
 *
 * It returns nothing: every job it drives has already been appended to
 * `ctx.runFile.jobs` and checkpointed by `enqueueJob`, which is what makes a
 * crash leave a cleanup manifest rather than orphans.
 */
async function runPhases(opts: {
  ctx: RunContext;
  args: Args;
  runTag: string;
  book: Ingress;
  articleFiles: readonly Ingress[];
  bookSlug: string;
  articleSlugs: readonly string[];
  steps: { ingest: readonly StepName[]; rerun: readonly StepName[]; force: readonly StepName[] };
}): Promise<void> {
  const { ctx, args, runTag, book, articleFiles, bookSlug, articleSlugs } = opts;
  const { ingest, rerun, force } = opts.steps;
  const deepen = !args.dryRun;

    /* A — the book, ingested. Repeat 1. */
    const a = await withLevers({ deepen, reask: [] }, async () =>
      driveJob(
        ctx,
        await enqueueJob(ctx, {
          phase: "A",
          label: "book ingest, deepening on (repeat 1)",
          repeat: 1,
          slug: bookSlug,
          url: `https://deepen-eval.invalid/${runTag}/book`,
          ingress: book,
          steps: ingest,
          force: [],
        }),
      ),
    );
    const liveBookSlug = a.slug;
    /* The queue can move a minted slug. Everything downstream names the slug it
       handed back, and the lever is re-checked against it before a repeat can
       be free and silent. */
    assertReaskNames({ envValue: liveBookSlug, mustName: [liveBookSlug], mustNotName: articleSlugs });

    /* B — the repeats, **serial**. A contended repeat would confound question 1,
       which is the one the rest of the plan leans on. */
    for (let r = 2; r <= args.repeats; r++) {
      await withLevers({ deepen, reask: [liveBookSlug] }, async () =>
        driveJob(
          ctx,
          await enqueueJob(ctx, {
            phase: "B",
            label: `book hierarchy forced (repeat ${r})`,
            repeat: r,
            slug: liveBookSlug,
            url: null,
            ingress: null,
            steps: rerun,
            force,
          }),
        ),
      );
    }

    /* C — inertness on an ordinary article. */
    const inertIngress = articleFiles[0]!;
    const off = await withLevers({ deepen: false, reask: [] }, async () =>
      driveJob(
        ctx,
        await enqueueJob(ctx, {
          phase: "C",
          label: "ordinary article ingest, deepening OFF",
          repeat: null,
          slug: articleSlugs[0]!,
          url: `https://deepen-eval.invalid/${runTag}/inert`,
          ingress: inertIngress,
          steps: ingest,
          force: [],
        }),
      ),
    );
    const treeBefore = args.dryRun ? "dry-run" : treeDigest((await loadArticle(off.slug)).tree);
    const on = await withLevers({ deepen, reask: [] }, async () =>
      driveJob(
        ctx,
        await enqueueJob(ctx, {
          phase: "C",
          label: "the same article, hierarchy forced, deepening ON",
          repeat: null,
          slug: off.slug,
          url: null,
          ingress: null,
          steps: rerun,
          force,
        }),
      ),
    );
    const treeAfter = args.dryRun ? "dry-run" : treeDigest((await loadArticle(off.slug)).tree);
    const inertness = args.dryRun
      ? []
      : checkInertness({
          offWroteRecords: (off.recordsFiles ?? []).length > 0,
          onWroteRecords: (on.recordsFiles ?? []).length > 0,
          targetsWhenOn: on.stats?.targets ?? null,
          callsWhenOn: on.stats?.calls ?? null,
          treeBefore,
          treeAfter,
        });
    on.findings = inertness;
    console.log("\nPhase C — inertness");
    console.log("─".repeat(70));
    console.log(
      `  tree ${treeBefore.slice(0, 16)} → ${treeAfter.slice(0, 16)}   ` +
        `${treeBefore === treeAfter ? "identical" : "CHANGED"}\n` +
        `  flag off wrote ${(off.recordsFiles ?? []).length} records file(s) (must be 0); ` +
        `flag on wrote ${(on.recordsFiles ?? []).length} (must be 1), targets ${on.stats?.targets ?? "—"}`,
    );
    if (inertness.length > 0) console.log(formatFindings(inertness));
    await ctx.checkpoint();

    /* D — three at once. */
    console.log(`\n[D] three jobs at once, at DEFAULT_JOB_CONCURRENCY=${DEFAULT_JOB_CONCURRENCY}`);
    console.log("─".repeat(70));
    /* **Two more articles, from two more files if they were given and from the
       first one twice if they were not.** Two ingests of identical bytes under
       two different slugs are still two independent jobs — different articles,
       different checkpoint rows, nothing shared — so the load is real either
       way. What is lost is variety, and the run says so rather than letting a
       reader assume three different documents. */
    const loadIngress = [articleFiles[1] ?? articleFiles[0]!, articleFiles[2] ?? articleFiles[0]!];
    if (articleFiles.length < 3) {
      console.log(
        `  (only ${articleFiles.length} article file(s) given, so phase D ingests the same bytes ` +
          "under fresh slugs — two independent jobs sharing nothing, but not two different documents)",
      );
    }
    /* **Queued one at a time, driven all at once.** The pump silencer round
       `enqueue` is a single global variable, so overlapping `enqueue`s let one
       job's pump start under the production registry and go to the real network
       — see `enqueueJob`. Only the driving is the measurement, and only the
       driving is concurrent.

       **One set of levers for the whole phase**, which is what the re-ask list
       naming slugs makes possible: the book is re-bought and the two articles
       beside it are not, from one environment. */
    const queued: QueuedJob[] = [];
    queued.push(
      await enqueueJob(ctx, {
        phase: "D",
        label: `book hierarchy forced under load (repeat ${args.repeats + 1})`,
        repeat: args.repeats + 1,
        slug: liveBookSlug,
        url: null,
        ingress: null,
        steps: rerun,
        force,
      }),
    );
    for (const [i, slug] of [articleSlugs[1]!, articleSlugs[2]!].entries()) {
      queued.push(
        await enqueueJob(ctx, {
          phase: "D",
          label: `ordinary article ${i + 1} ingest, under load`,
          repeat: null,
          slug,
          url: `https://deepen-eval.invalid/${runTag}/load${i + 1}`,
          ingress: loadIngress[i]!,
          steps: ingest,
          force: [],
        }),
      );
    }
    /* **`allSettled`, not `all`.** `Promise.all` rejects the moment one job
       does, and the rejection travels straight out through `withLevers` —
       which restores `SPIDERYARN_DEEPEN_HIERARCHY` and `SPIDERYARN_DEEPEN_REASK`
       while the other two jobs are still running under them, and lets
       `reportRun` start reading half-written ledgers and deleting articles
       underneath live tasks. Draining first costs nothing and is the only way
       the levers mean what they say for the whole phase.
       ⟨GPT Sol, DPN-06.⟩ */
    const settled = await withLevers({ deepen, reask: [liveBookSlug] }, async () =>
      Promise.allSettled(queued.map((q) => driveJob(ctx, q))),
    );
    const broke = settled.flatMap((s) => (s.status === "rejected" ? [s.reason as unknown] : []));
    if (broke.length > 0) {
      throw new AggregateError(
        broke.map((r) => (r instanceof Error ? r : new Error(String(r)))),
        `${broke.length} of phase D's ${queued.length} jobs threw. Every one of them was drained ` +
          "before the levers were restored; the report below covers what the run really did.",
      );
    }
}


/* -------------------------------------------------------------- the report -- */

/**
 * **Read every job's ledger a second time, once nothing is still writing.**
 *
 * `driveJob` reads the ledger the instant its job stops, and a row written by a
 * call that finished a moment before can still be in flight — `collectSpend`
 * calls `onDone` before it drains `box.writes`, so the per-job read is taken at
 * the one moment a late write is neither in the ledger nor in the collector's
 * failure count. This second read is free, is taken after every job in the run
 * has stopped, and says whether anything moved. A difference is a finding
 * rather than a correction: the question is not "what is the number" but
 * "did the number the run reported stand still". ⟨GPT Sol, DPN-02.⟩
 */
async function reconcileLedgerAgain(jobs: readonly JobRecord[]): Promise<DeepenFinding[]> {
  const findings: DeepenFinding[] = [];
  for (const j of jobs) {
    let now: Awaited<ReturnType<typeof costStore.forJob>>;
    try {
      now = await costStore.forJob(j.jobId);
    } catch (err) {
      findings.push({
        kind: "not-answerable",
        fatal: true,
        message:
          `${j.phase} ${j.label}: the ledger could not be re-read at the end of the run ` +
          `(${err instanceof Error ? err.message : String(err)}), so nothing here confirms the ` +
          "figure this job reported.",
      });
      continue;
    }
    const then = j.money;
    const nowMoney = totalMoney(now.rows);
    if (then == null) {
      /* The first read failed, this one worked: record what is really there
         rather than leaving the row `NOT READ` on evidence we now have. */
      j.money = nowMoney;
      j.unreadable = now.unreadable;
      j.byStep = aggregateByStep(now.rows);
      j.byAiJob = aggregateByAiJob(now.rows);
      findings.push({
        kind: "note",
        fatal: false,
        message:
          `${j.phase} ${j.label}: the ledger read failed during the run and succeeded at the end. ` +
          `The bill below is the second read: $${(moneyTotalNanos(nowMoney) / 1e9).toFixed(4)}.`,
      });
      continue;
    }
    if (moneyTotalNanos(nowMoney) !== moneyTotalNanos(then)) {
      findings.push({
        kind: "not-answerable",
        fatal: true,
        message:
          `${j.phase} ${j.label}: the ledger said ` +
          `$${(moneyTotalNanos(then) / 1e9).toFixed(4)} while the run was going and ` +
          `$${(moneyTotalNanos(nowMoney) / 1e9).toFixed(4)} at the end. Rows landed after the ` +
          "per-job read, so every figure taken at that moment is a floor rather than a total.",
      });
      j.money = nowMoney;
      j.byStep = aggregateByStep(now.rows);
      j.byAiJob = aggregateByAiJob(now.rows);
    }
    j.unreadable = now.unreadable;
  }
  return findings;
}

/**
 * **Everything the run has to say once the jobs have stopped**, in a `finally`
 * so a run that died three jobs in still reports the three it paid for.
 *
 * The order is deliberate: the per-repeat checks first (was this a repeat at
 * all, was the seed held), then the driving, then the five questions, then the
 * findings — because a fatal finding above changes what the numbers below mean,
 * and a reader who stops after the first block has read the part that decides
 * whether to believe the rest.
 */
async function reportRun(opts: {
  ctx: RunContext;
  args: Args;
  bookSlug: string;
  runDir: string;
  measuredStep: string;
}): Promise<void> {
  const { ctx, args, runDir, measuredStep } = opts;
  await ctx.checkpoint();

  const findings: DeepenFinding[] = [];
  findings.push(...(await reconcileLedgerAgain(ctx.runFile.jobs)));

  const bookRepeats = ctx.runFile.jobs.filter((j) => j.repeat !== null);
  for (const j of bookRepeats) {
    if (j.stats == null) continue;
    const hierarchyInput =
      j.byAiJob?.find((r) => r.step === "hierarchy")?.tokens.input ?? j.stats.usage.inputTokens;
    const own = checkRepeatBoughtItsWave({
      label: `${j.phase} ${j.label}`,
      stats: j.stats,
      ledgerHierarchyInputTokens: hierarchyInput,
      structureInputTokensFloor: structureTokenFloor(
        Number(j.stepOutcomes?.find((s) => s.name === "blocks")?.detail?.match(/^(\d+)/)?.[1] ?? 0),
      ),
      /* **Phase A buys the structure call; that is what phase A is for.** The
         guard was applied to it as well, and Moby-Dick's measured 453,832-token
         structure call is over the 256,900-token floor — so a *successful* run
         would have spent $40.90 and then reported `structure-rebought` fatally.
         ⟨GPT Sol, DPN-08.⟩ */
      structure: j.phase === "A" ? "bought" : "resumed",
    });
    j.findings = [...(j.findings ?? []), ...own];
  }

  /* **Each records file bound to the job that wrote it**, rather than matched
     to a job by its position in a directory listing. That is what carries the
     phase (so Q1 can be A+B only) and the `failed` flag (so a partial pass is
     not aggregated as a whole one) onto every pass. ⟨DPN-05, DPN-12.⟩ */
  const onDisk = new Map(
    (
      await readRecordsDir(ctx.recordsDir).catch((err: unknown) => {
        /* In a `finally`, so a throw here would replace whatever killed the
           run with a message about a records file. */
        findings.push({
          kind: "no-records",
          fatal: true,
          message:
            "The records directory could not be read at reporting time " +
            `(${err instanceof Error ? err.message : String(err)}), so questions 1-3 have no ` +
            "evidence at all. The files are still on disk.",
        });
        return [] as Awaited<ReturnType<typeof readRecordsDir>>;
      })
    ).map(({ file, parsed }) => [file, parsed]),
  );
  /**
   * **One pass per job, and it is the LAST file the job wrote.**
   *
   * A job that handed its claim back and was re-driven runs `deepenTree` twice
   * and writes twice; the second run resumes what the first bought and asks
   * about the rest, so its file covers the whole wave and the first is a prefix
   * of it. Counting both would put a partial pass beside a whole one — the same
   * mistake DPN-05 is about, arriving by a different door — and would make the
   * expected-pass count wrong for a phase A whose book requeued, which is
   * routine at 658-778 s against a 740 s deadline. `driveJob` reads `stats` off
   * the last file for the same reason.
   */
  const passesOf = (j: JobRecord): RecordsPass[] => {
    const files = (j.recordsFiles ?? []).filter((f) => onDisk.has(f));
    const file = files.at(-1);
    if (file === undefined) return [];
    if (files.length > 1) {
      findings.push({
        kind: "note",
        fatal: false,
        message:
          `${j.phase} ${j.label} wrote ${files.length} records files (${files.join(", ")}), so its ` +
          "wave ran more than once — the job was re-driven. The last one is the complete pass and " +
          "is the only one questions 1-3 are computed over; the earlier ones are its prefixes.",
      });
    }
    const parsed = onDisk.get(file)!;
    return [
      {
        label: `${j.phase} ${j.repeat === null ? j.slug : `r${j.repeat}`}`,
        slug: parsed.slug,
        writtenAt: parsed.writtenAt,
        stats: parsed.stats,
        records: parsed.records,
        failed: parsed.failed ?? false,
        reason: parsed.reason ?? null,
        file,
        phase: j.phase,
      },
    ];
  };

  /* **Phase A and phase B, and nothing else.** The declared controlled
     population is the serial passes; phase D's book pass ran with two other
     jobs against it and is reported with question 5. */
  const bookPasses = bookRepeats
    .filter((j) => j.phase === "A" || j.phase === "B")
    .flatMap(passesOf);
  const allRecords: RecordsPass[] = ctx.runFile.jobs.flatMap(passesOf);

  /* **The driving is checked on every run, paid or free** — the network
     escape, the serial repeats, the concurrent load phase, the forces that
     were honoured. It was written for `--dry-run` and belongs on the paid
     path for the same reason: a fetch that reached the network is worse when
     money is moving, not better. */
  const driving = checkDriving(ctx.runFile.jobs, {
    measuredStep,
    jobConcurrency: jobConcurrency(),
    plannedConcurrency: DEFAULT_JOB_CONCURRENCY,
  });
  findings.push(...driving);
  /* **The per-job findings last, after the structure check has been added to
     them** — a job's own list is the record, and this is a view of it. */
  findings.push(...ctx.runFile.jobs.flatMap((j) => j.findings ?? []));
  console.log("\nThe driving");
  console.log("─".repeat(70));
  console.log(formatDriving(ctx.runFile.jobs));

  if (args.dryRun) {
    /* **And no question table at all.** No records file was written, so every
       row would be a zero — and a table of zeroes is exactly what somebody
       quotes back later as "the wave found nothing". The dry run proves the
       driving and says so. */
    ctx.runFile.findings = findings;
    await ctx.checkpoint();
    console.log(
      "\n--dry-run: no model call was made, so questions 1-5 were not asked. Their answers " +
        "are deliberately absent rather than printed as zeroes.\n" +
        `  Expect the phase-D concurrency note here: the measured step is \`${measuredStep}\`, ` +
        "which takes milliseconds, so three of them rarely overlap however concurrently the jobs " +
        "were driven. On the paid path the step is `hierarchy` and runs for minutes, and the same " +
        "note there is the real thing — it makes question 5 unanswerable.",
    );
  } else {
    const { answers, findings: qFindings, printed } = answerTheQuestions({
      bookPasses,
      /* Phase A is repeat 1 and phases B are the rest, so the controlled
         population is exactly `--repeats` passes — phase D's is not in it. */
      expectedBookPasses: args.repeats,
      allRecords,
      jobs: ctx.runFile.jobs,
      expectedLoadSteps: ctx.runFile.jobs.filter((j) => j.phase === "D").length,
      measuredStep,
    });
    findings.push(...qFindings);
    ctx.runFile.answers = answers;
    ctx.runFile.findings = findings;
    await ctx.checkpoint();
    console.log(printed);
  }

  console.log("\nFindings");
  console.log("─".repeat(70));
  console.log(findings.length === 0 ? "  none" : formatFindings(findings));
  const fatal = findings.filter((f) => f.fatal);
  if (fatal.length > 0) {
    console.log(
      `\n${fatal.length} FATAL finding(s). These numbers are not what they claim to be — read ` +
        "them before quoting anything from this run.",
    );
    process.exitCode = 1;
  }

  if (args.keep) {
    console.log(`\n--keep: leaving ${ctx.runFile.jobs.length} job(s) and their articles behind.`);
  } else {
    await cleanup(ctx.runFile.jobs);
  }
  console.log(`\nWrote ${path.relative(process.cwd(), runDir)}/run.json`);
  console.log(`Records in ${path.relative(process.cwd(), ctx.recordsDir)}/`);
}

/* --------------------------------------------------------- the program's edge -- */

if (isMain(import.meta.url)) {
  loadEnvLocal();
  await withLedger("eval", () => runAsOwner(EVAL_OWNER_ID, main)).catch((err: unknown) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
