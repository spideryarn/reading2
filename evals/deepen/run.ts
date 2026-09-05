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
 * eval's proved mechanisms verbatim (`evalRegistry`, `fixtureFetch`) and its
 * gates. ⟨There were three: the third was `withoutTheInProcessPump`, and it is
 * gone. `enqueue` takes `pump: false` on the request now — src/jobs.ts § `pump`
 * — so the hazard is per-request rather than a global two `enqueue`s could race
 * on. 2026-09-05.⟩ Nothing in `src/` changes for this to work, except that
 * `saveDeepenRecords` publishes its file atomically because this eval reads that
 * directory from three jobs at once.
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
  unrunnableStepPlan,
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
  abandonStep,
  ABANDONED_MARKER,
  assertReaskNames,
  assertSeamProof,
  assertStepPlansRunnable,
  checkpointWriter,
  startPhaseFate,
  type PhaseFate,
  startRendezvous,
  type GateVerdict,
  type CostEstimate,
  estimate,
  fateReason,
  fileFixture,
  formatEstimate,
  jobIntegrityFindings,
  listRecordsDir,
  loadReadiness,
  readRecordsDir,
  recordingCheckpoints,
  requeueFinding,
  requeueVerdict,
  type SeamProof,
  type StepPlans,
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

/**
 * **How long phase D's rendezvous may hold anybody at the entry** before it
 * gives up, lets go, and drives the book anyway.
 *
 * The old number was 15 minutes and "generous on purpose", which was safe while
 * the barrier was a latch and nobody was actually held. It is not safe now. A
 * held load step is holding **its own claim**, whose effective deadline is
 * `EFFECTIVE_DEADLINE_MS` (740 s), and it is holding it *after* its step's clock
 * has started — so every second here is a second off that job's lease and a
 * second added to the `hierarchy` window question 5 reads.
 *
 * Three minutes is chosen against the thing being waited for rather than against
 * patience: both load jobs start from `fetch` on the same bytes at the same
 * instant, so they reach `hierarchy` within seconds of each other unless
 * something is already wrong — a shared box serialising them on a claim slot,
 * most likely (`STANDING_NOTES`). Waiting longer than this would not rescue that
 * case; it would only spend the survivor's lease on it. `startRendezvous`.
 */
const LOAD_RENDEZVOUS_TIMEOUT_MS = 3 * 60_000;

/**
 * **A hold long enough to be worth saying out loud**, in the run's notes.
 *
 * Below this, the wait is the ordinary jitter of two jobs reaching the same step;
 * above it, a reader comparing the load jobs' `hierarchy` clocks against
 * `STEP_BUDGET_MS.hierarchy` is reading a number with idle waiting inside it.
 */
const NOTABLE_HOLD_MS = 5_000;

/**
 * **How long all three measured steps must be in flight *together* before
 * question 5 may be quoted as an answer about load.**
 *
 * Declared here, printed in preflight, and passed into `budgetReport` — so the
 * number the report holds itself to is one chosen **before** the run spent
 * rather than after the figure was seen. ⟨Greg, 2026-09-05.⟩
 *
 * **Why a floor at all.** `peakConcurrency` used to be the load check and is now
 * arranged by construction: the rendezvous releases all three within one turn of
 * the event loop, so an instant of triple overlap is guaranteed to any run that
 * gets that far. What is *not* guaranteed is duration, and duration is bounded by
 * the **shortest** of the three — the load articles' `hierarchy`, which is far
 * shorter than a book's 658-778 s.
 *
 * **Why sixty seconds.** Against a 700 s budget it is under a tenth of the
 * book's step: below that, whatever the book's clock says is a clock for a step
 * that was contended at its beginning and alone for the rest, and calling it
 * "under load" would be the kind of overclaim this harness keeps having to
 * retract. It is a floor on what is worth quoting, **not** a prediction that the
 * run will clear it — and if you think it will not, that is an argument for not
 * buying phase D rather than for lowering the number afterwards.
 */
const FULL_CONCURRENCY_FLOOR_MS = 60_000;

/**
 * **How long any one read of the ledger may take before it gives up and says
 * so** — both the one `driveJob` makes the instant a job stops and the eight the
 * end-of-run reconciliation makes.
 *
 * A read of a local Postgres is milliseconds. The number is not a performance
 * budget: it is what stops a database fault from delaying, for ever, the thing
 * the reader is actually waiting for. Reconciliation sits between a thrown phase
 * and the exception that killed the run ⟨GPT Sol, DPN-17⟩; `driveJob`'s read
 * sits inside phase D's `allSettled`, so one read that never answers is a phase
 * that never reaches reporting at all ⟨DPN-21⟩.
 */
const LEDGER_READ_DEADLINE_MS = 60_000;
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
    /** Is question 5 timing this job's measured step? Then a requeue is a lie. */
    measured: boolean;
    /** The fate this job shares with its siblings, where it has any. */
    fate?: PhaseFate;
  },
): Promise<{ job: Job; elapsedMs: number; requeuedAt: number | null; abandoned: string | null }> {
  let job = start;
  const startedAt = Date.now();
  const requeuesBefore = job.requeues ?? 0;
  for (;;) {
    if (Date.now() - startedAt > JOB_TIMEOUT_MS) {
      throw new Error(`${job.slug}: still not done after ${JOB_TIMEOUT_MS / 60_000} minutes`);
    }
    /* **Asked before every claim, which is half the invariant** (DPN-26). The
       three measured jobs share one fate, and once any of them has lost it none
       of the others begins another step or a re-drive. The other half is inside
       a claim that is already running, where this check cannot reach: the fate's
       abort signal, combined into the measured step's own `ctx.signal` by
       `announcing`, which is what stops a running step buying the calls it has
       not made yet (DPN-30). `startPhaseFate`. */
    const lost = opts.fate?.lost() ?? null;
    if (lost !== null) {
      return { job, elapsedMs: Date.now() - startedAt, requeuedAt: null, abandoned: lost };
    }
    const advanced = await withSpendAttribution(
      { jobId: job.id, articleSlug: job.slug, ownerId: EVAL_OWNER_ID },
      () => advanceJobWith(job.id, { session: claimSession, steps, onStepSpend: opts.onStepSpend }),
    );
    if (!advanced) throw new Error(`${job.slug}: job ${job.id} vanished mid-run`);
    job = advanced.job;
    if (advanced.done) {
      return { job, elapsedMs: Date.now() - startedAt, requeuedAt: null, abandoned: null };
    }
    const requeues = job.requeues ?? 0;
    const verdict = requeueVerdict({
      reasking: opts.reasking,
      measured: opts.measured,
      requeuesBefore,
      requeuesNow: requeues,
    });
    if (verdict === "stop") {
      return { job, elapsedMs: Date.now() - startedAt, requeuedAt: requeues, abandoned: null };
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
  /**
   * **Why this run's articles and jobs must NOT be cleaned up**, one reason per
   * entry, empty when there are none.
   *
   * A re-asking pass that hands its claim back is left `queued` on purpose, so
   * the paid answers behind it stay resumable — and ordinary cleanup then
   * deleted the article, which cascades to the checkpoint rows and throws the
   * work away under a comment promising it had been kept. ⟨GPT Sol, DPN-07.⟩
   */
  retain: string[];
  /** Why the run stopped before its remaining phases, if it did. */
  stopped: string | null;
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
  /**
   * **Hold this step at its entry until phase D says go** — `startRendezvous`.
   *
   * Not "say so when it begins", which is what this was and which was only half
   * of what phase D needs: a step that announces and then runs to completion
   * before its neighbour announces has told the truth and lined nothing up
   * (DPN-20). So the hook is *awaited*, and the step does not start until every
   * party is at the same entry.
   *
   * It wraps the step in this job's own registry, so it holds the real start
   * rather than a guess made from outside. Absent on every other job.
   *
   * **And the hold can end in a refusal.** A gate that gave up releases its
   * steps with `"abandoned"`, and the step then throws before it runs rather
   * than buying a measurement that cannot be quoted — `abandonStep`.
   */
  announce?: { step: StepName; arrive: (slug: string) => Promise<GateVerdict> };
  /**
   * **The fate this job shares with its siblings** — phase D's three, and nobody
   * else. Once any of them has lost the ability to answer question 5, none of
   * them claims again. `startPhaseFate`, DPN-26.
   */
  fate?: PhaseFate;
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
 * **One step held at its entry, and refused if the wait was for nothing.**
 *
 * The `await` is the whole of DPN-20: this used to call the hook and carry
 * straight on into the step, which records an arrival and lines nothing up.
 * Held, the step genuinely does not start until the rendezvous opens — and the
 * hold is inside the claim, which is what `LOAD_RENDEZVOUS_TIMEOUT_MS` is
 * measured against.
 *
 * **The throw is the other half**, and it is the one place this eval fails a
 * step on purpose. A gate that gave up has already lost question 5; running the
 * measured step anyway buys an answer the report will refuse to quote, which on
 * the book is $7.40. `abandonStep` holds both guards — never on `"go"`, never
 * under `--dry-run` — and the throw lands before `step.run`, so nothing is
 * bought. What you recognise it by afterwards is the finding `runPhaseD` puts on
 * the job's record, **not** the thrown error: the queue rewrites a failed step's
 * message before storing it, so `ABANDONED_MARKER` is already gone from
 * `stepOutcomes[].error` by the time anybody reads it — measured on a forced
 * `--dry-run`, not assumed.
 *
 * The overlay is on this job's own registry rather than on the shared `STEPS`,
 * so it cannot reach a job that did not ask for it — including one another agent
 * happens to be running against the same queue. `evalRegistry` wraps this in
 * turn, so the spend overlay still applies.
 */
function announcing(
  base: StepRegistry,
  announce: NonNullable<JobSpec["announce"]>,
  dryRun: boolean,
  fate: PhaseFate | undefined,
): StepRegistry {
  const step = base[announce.step];
  return {
    ...base,
    [announce.step]: {
      ...step,
      run: async (ctx: Parameters<typeof step.run>[0], store: Parameters<typeof step.run>[1], checkpoints: Parameters<typeof step.run>[2]) => {
        const verdict = await announce.arrive(ctx.slug);
        const refuse = abandonStep({ verdict, dryRun, slug: ctx.slug, step: announce.step });
        if (refuse !== null) throw refuse;
        /* **The step runs under its own signal AND the phase's** — DPN-30, and
           the only lever this eval has that reaches inside a claim. The claim's
           own `AbortController` is private to `advanceJobWith`, so the phase
           cannot cancel the *claim*; it does not need to. `ctx` is a plain data
           object whose `report` is an arrow closing over the step (src/jobs.ts §
           the `StepContext` literal), so a shallow spread carries `dir`,
           `htmlFile`, `deadlineAt`, `cacheArticle` and the rest across intact,
           and only `signal` is replaced.

           `AbortSignal.any` rather than a replacement: **`ctx.signal` keeps
           doing its own job**, and only a *lost fate* adds a second reason to
           stop. The same composition `src/labels.ts` and
           `src/hierarchy-deepen.ts` already make. */
        if (fate === undefined) return step.run(ctx, store, checkpoints);
        const under = { ...ctx, signal: AbortSignal.any([ctx.signal, fate.signal]) };
        return step.run(under, store, checkpoints);
      },
    },
  } as StepRegistry;
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
  const base: StepRegistry = spec.ingress
    ? { ...STEPS, fetch: fixtureFetch(spec.ingress.fixture, spec.ingress.bytes, spec.url ?? "") }
    : STEPS;
  const registry = evalRegistry(spec.announce ? announcing(base, spec.announce, ctx.dryRun, spec.fate) : base);
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
  /* **"Measured" is `announce`, not a second flag to keep in step with it.** Only
     phase D's three jobs carry the rendezvous hook, and they are exactly the
     jobs whose step question 5 times — so the one fact has one source and the
     two cannot drift apart. */
  const measured = spec.announce !== undefined;
  const driven = await driveToDone(job, registry, {
    onStepSpend,
    reasking,
    measured,
    ...(spec.fate !== undefined ? { fate: spec.fate } : {}),
  });
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

  /**
   * **Tell the siblings, and tell them at the instant this job stopped** — not
   * after its ledger and its records have been read, which takes seconds the
   * other two spend. `fateReason` decides *whether* this ending counts, and it
   * is where the rehearsal earns its faithfulness: a dry run's job failing at
   * its **last** free step is the expected ending and loses nothing, while a
   * failure earlier in the list, a requeue or a fallen-back wave lose the phase
   * in the rehearsal exactly as they would in the paid run. ⟨DPN-26, DPN-30.⟩
   *
   * `fateBefore` is read first, so a job can tell "I lost it" from "it was
   * already lost when I stopped" — the second is a casualty and says so.
   */
  const fateBefore = spec.fate?.lost() ?? null;
  const loseTheFate = (waveFailed: boolean): void => {
    if (!measured) return;
    const why = fateReason({
      label: spec.label,
      dryRun: ctx.dryRun,
      status: driven.job.status,
      requeued: driven.requeuedAt !== null,
      waveFailed,
      failedStep: driven.job.steps.find((st) => st.status === "error")?.name ?? null,
      steps: spec.steps,
    });
    if (why !== null) spec.fate?.lose(why);
  };
  loseTheFate(false);

  /* **A step this phase cancelled**, rather than one that broke. The fate was
     already lost when this job stopped, and its `ctx.signal` was aborted with
     it — so whatever it was in the middle of was cut short and whatever it had
     not started was never started. ⟨DPN-30.⟩ */
  if (fateBefore !== null && driven.job.status !== "done" && driven.abandoned === null) {
    findings.push({
      kind: "not-answerable",
      fatal: true,
      message:
        `${spec.label}: this job's measured step was CANCELLED, not broken — the phase had already ` +
        `lost the ability to answer (${fateBefore}) and the fate's abort signal is combined into ` +
        "this step's own. Calls it had not yet made were never made; at most the one request in " +
        "flight was paid for. Its clock is not a measurement.",
    });
  }

  /* **The sibling gave up before this job could claim again.** Not a failure of
     this job at all: `driveToDone` returned without claiming because the phase
     had already lost the ability to answer. Said as its own finding so it is not
     read as this job having broken. ⟨DPN-26.⟩ */
  if (driven.abandoned !== null) {
    findings.push({
      kind: "not-answerable",
      fatal: true,
      message:
        `${spec.label}: this job stopped without claiming again because its phase had already lost ` +
        `the ability to answer — ${driven.abandoned}. The three measured jobs share one fate, so ` +
        "none of them starts more paid work once any of them has lost it. Whatever call was " +
        "already in flight finished and was paid for; nothing further was started.",
    });
  }

  if (driven.requeuedAt !== null) {
    /* **Retained, and the run stops.** "Left queued and resumable" was a claim
       the harness then undid: ordinary cleanup deleted the article, which
       cascades to its expansion checkpoint rows, so the paid answers this pass
       had written were thrown away under a comment promising they were kept —
       and the next repeat would have published over the base revision the queued
       job is holding. Retaining is half the fix; `stopIfCompromised` in
       `runPhases` is the other half. ⟨GPT Sol, DPN-07-R.⟩ */
    ctx.retain.push(
      `${spec.label} (${job.slug}, job ${job.id}) is queued at requeue window ${driven.requeuedAt} ` +
        (reasking ? "with paid answers in its checkpoint rows" : "and is not re-driven"),
    );
    findings.push(
      requeueFinding({
        label: spec.label,
        slug: job.slug,
        window: driven.requeuedAt,
        windows: REQUEUE_BUDGET + 1,
        reasking,
        measured,
      }),
    );
  }

  /* **The ledger, and both ways it can be short.** `forJob` is the money that
     landed; `checkScope` asks whether it landed in the eval's bucket at all
     (this eval drives jobs with no `fetch` step, so the fixture check cannot
     stand in for it — DPN-01); `checkLedgerComplete` asks whether every call the
     collectors saw has a row (DPN-02). Both are the cost eval's, imported.

     **Under a deadline, and for the same reason the end-of-run re-read is**
     (`withDeadline`, DPN-17). This read is on phase D's path: three jobs finish
     into three of these, and one that never answers is one `allSettled` never
     settles, so the phase — and every finding and every number after it —
     waits for ever on a database that has gone away. A read that gives up says
     the spend is UNKNOWN, which is a fact the run can print.
     ⟨GPT Sol, DPN-21.⟩ */
  try {
    const ledger = await withDeadline(
      costStore.forJob(job.id),
      LEDGER_READ_DEADLINE_MS,
      `the ledger read for ${spec.label} (job ${job.id})`,
    );
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
    /* The third way to lose the phase, and the one that needs the records file
       to be readable before it can be known. `budgetReport` wants three
       completions with a wave's stats and **no failure**, so a fallback wave
       puts three out of reach exactly as an error does. ⟨DPN-26.⟩ */
    loseTheFate(true);
  }

  /* **Did this job stop having lost what it was bought for?** Two facts that
     were nowhere in the findings and so, to `stopIfCompromised`, looked exactly
     like a clean job: a terminal status that is not `done` (DPN-18), and
     deepening on with no records file at all — LOST, not "nobody asked"
     (DPN-19). Both are pure and both are exercised in
     tests/deepen-eval.test.ts; `jobIntegrityFindings` is where they are stated.
     ⟨GPT Sol.⟩ */
  findings.push(
    ...jobIntegrityFindings({
      label: spec.label,
      dryRun: ctx.dryRun,
      requeued: driven.requeuedAt !== null,
      status: record.jobStatus,
      deepenFlag: record.deepenFlag === true,
      hasRecords: record.stats != null,
    }),
  );
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
  console.log(`  deepening ${deepeningLine(record)}`);
  if (findings.length > 0) console.log(formatFindings(findings));
  await ctx.checkpoint();
  return record;
}

/**
 * **What one job's deepening pass did**, in a line — and *which* nothing, where
 * it did nothing.
 *
 * "No records file — nobody asked" was printed for both of the two facts DPN-19
 * is about: deepening off and nothing asked for (true, and phase C's whole
 * point), and deepening on with the file lost (false, and fatal). The finding
 * says so properly; this says so where a reader is watching the run.
 */
function deepeningLine(record: JobRecord): string {
  const s = record.stats;
  if (s != null) {
    return (
      `${s.expanded}/${s.targets} section(s), ${s.calls} call(s) ` +
      `(${s.resumed} resumed, ${s.withheld} withheld, ${s.outOfTime} out of time), ` +
      `yes ${s.verdicts.rawYes}/${s.verdicts.rawYes + s.verdicts.rawNo}`
    );
  }
  return record.deepenFlag === true
    ? "NO RECORDS FILE, and deepening was ON — this pass's records were LOST"
    : "no records file — deepening was off, so nobody asked";
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
        /* **Not merely "stats exist".** A wave that exhausted its redraws
           writes stats, is caught, falls back to wave 1 and lets the step finish
           `done` — so `j.stats != null` counted three failures as three
           measurements of the deepened path. ⟨GPT Sol, DPN-03-R.⟩ */
        hasSuccessfulStats: j.stats != null && j.waveFailed === false,
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
    fullConcurrencyFloorMs: FULL_CONCURRENCY_FLOOR_MS,
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

/**
 * **The step lists, which are the whole of what `--dry-run` changes.**
 *
 * `--dry-run` asks for `extract` rather than `blocks`, and that is not a
 * preference: `unrunnableStepPlan` (src/jobs.ts) refuses a job that runs
 * `blocks` without `hierarchy`, since the tree is checked against the blocks it
 * was built from and the article could never publish. Forcing `blocks` alone is
 * a 400 at `enqueue`, so the free rehearsal died before it created a single job
 * — while printing a clean report on the way down —
 * docs/postmortems/260905b-the-rehearsal-reported-a-clean-run-over-zero-jobs.md.
 * (`evals/cost/run.ts` proves its own sweep with `--modes blocks`; that pattern
 * is refused now too, so it is no longer a precedent to copy.)
 * `assertStepPlansRunnable` is what stops this being rediscovered by a person.
 *
 * **There is deliberately no split-ingest list here, and a dry run is why.**
 * Phase D's three measured windows have to intersect, and the obvious way to
 * arrange it was to take the two load articles as far as the measured step in
 * one job and run the measured step in a second — Sol's first suggestion for
 * DPN-15. It cannot work: a job that stops short of a publishable article
 * **fails**, and a failed job's draft revision is rolled back, so the second job
 * opens on an article with no fetched document at all. The `--dry-run` of
 * 2026-09-05 showed exactly that, four jobs deep, for free. `startRendezvous` is
 * Sol's other suggestion and the one that survives contact.
 */
export function stepsFor(dryRun: boolean): StepPlans {
  if (!dryRun) {
    return { ingest: DEFAULT_INGEST_STEPS, rerun: ["hierarchy"], force: ["hierarchy"] };
  }
  /* **The identical shape with no model call in it.** `extract` re-runs stage 2,
     which buys nothing, and driving it exercises the same enqueue → force →
     serial-repeat → concurrent-load machinery the paid run drives. It proves the
     driving; it proves nothing about the wave, and the seam probe is what covers
     that half. */
  return { ingest: ["fetch", "extract"], rerun: ["extract"], force: ["extract"] };
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
  /* **Before the first `enqueue`, on every path.** A step list the queue refuses
     takes every phase down at its first call and leaves a run with no jobs in
     it; the free rehearsal did exactly that and reported itself clean.
     `assertStepPlansRunnable`. */
  const plans = stepsFor(args.dryRun);
  assertStepPlansRunnable(plans, unrunnableStepPlan);
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
    /* Copied, not shared: phase D appends to this when its start rendezvous
       holds somebody or does not open, and `STANDING_NOTES` is a module
       constant. */
    notes: [...STANDING_NOTES],
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
  const { ingest, rerun } = plans;
  console.log(`  A  ${bookSlug}   ingest ${ingest.join(",")}   deepen ON     (repeat 1)`);
  for (let r = 2; r <= args.repeats; r++) {
    console.log(
      `  B  ${bookSlug}   ${rerun.join(",")} forced   deepen ON, re-ask ON   (repeat ${r}, serial)`,
    );
  }
  console.log(`  C  ${articleSlugs[0]}   ingest ${ingest.join(",")}   deepen OFF`);
  console.log(`  C  ${articleSlugs[0]}   ${rerun.join(",")} forced   deepen ON    (must be inert)`);
  console.log(
    `  D  three at once: ${articleSlugs[1]} and ${articleSlugs[2]} ingest, HELD at the entry to ` +
      `\`${rerun[0] ?? "hierarchy"}\` until ${bookSlug} ${rerun.join(",")} forced ` +
      `(repeat ${args.repeats + 1}) is there too, then all three released together`,
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
    "phase D: the two load steps are HELD at their entry, and only once both are there is the book driven at all — it reaches the same entry, and all three are released together. A shared START is what the run can arrange; whether the three windows then stay open together is `peakConcurrency`'s to measure, below",
    "phase D: if the load steps do not both reach the entry, the book's pass under load is NOT DRIVEN and NOT BOUGHT — it answers question 5 and nothing else, and question 5 is then unanswerable at any price",
    "phase D: if the gate gives up with all three driven, every measured step it releases is ABANDONED and throws before it runs, so a phase that cannot answer question 5 buys nothing trying to. Those jobs end `error` by this eval's doing and each says so in a finding of its own",
    "phase D: the three measured jobs share one fate — a failed step, a wave that fell back, or a claim handed back, and the other two stop before their next claim AND cancel the calls their running step has not made yet. One claim runs the whole hierarchy step (structure call, wave, AND a full label pass, which starts even after the wave failed), so stopping at the claim alone left up to ~$10.80 still to be bought; the fate's abort signal is combined into the measured step's own. What is left is the single request already in flight, which may still be billed",
    "phase D: a measured job STOPS on its first requeue rather than being re-driven — a re-drive takes the rendezvous's latched verdict, runs outside the gate, and lets the queue overwrite the first attempt's clock",
    "phase D: the hierarchy STEPS' own windows reach concurrency 3, and three of them completed with a wave's stats and no failure — a step that started and failed carries a clock and is not a measurement",
    `phase D: all three measured steps are in flight TOGETHER for at least ${(FULL_CONCURRENCY_FLOOR_MS / 1000).toFixed(0)}s — declared here, before anything is bought, so it cannot be chosen after the figure is seen. Peak concurrency 3 is ARRANGED by the rendezvous and is only a wiring check; this is the load measurement, and below the floor question 5 reports latency after a synchronised start rather than sustained three-job load`,
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

  const ctx: RunContext = {
    runTag,
    runFile,
    recordsDir,
    checkpoint,
    dryRun: args.dryRun,
    retain: [],
    stopped: null,
  };

  /**
   * **Both errors, or neither replaced by the other.**
   *
   * `reportRun` has to run whatever killed the phases — a run that died three
   * jobs in still paid for three jobs and must say what they bought. In a bare
   * `finally` that is a trap: a throw from the reporting **replaces** the
   * original, so the thing that actually stopped the run is lost and the
   * message a reader gets is about a records file. ⟨GPT Sol, DPN-17.⟩
   *
   * And the reporting is told *that* the run died, so its own output can say so
   * at the top rather than reading as the report of a run that finished.
   */
  let primary: unknown = null;
  try {
    await runPhases({
      ctx,
      args,
      runTag,
      book,
      articleFiles,
      bookSlug,
      articleSlugs,
      steps: plans,
    });
  } catch (err) {
    primary = err;
  }
  let reporting: unknown = null;
  try {
    await reportRun({
      ctx,
      args,
      bookSlug,
      runDir,
      measuredStep: rerun[0] ?? "hierarchy",
      /* A (1) + B (`repeats - 1`) + C (2) + D (3). The plan printed above is
         the same arithmetic said in words. */
      expectedJobs: args.repeats + 5,
      died: primary,
    });
  } catch (err) {
    reporting = err;
  }
  const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));
  if (primary !== null && reporting !== null) {
    throw new AggregateError(
      [asError(primary), asError(reporting)],
      "The run threw and then the reporting threw as well. Both are below; the first is what " +
        "stopped the run.",
    );
  }
  if (primary !== null) throw asError(primary);
  if (reporting !== null) throw asError(reporting);
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
  const empty = { repairs: [], droppedChildren: [], droppedHeadings: [], collapsedRungs: [] };
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
 * **Every fatal finding the run has already recorded against a job that has
 * stopped**, which is the question "can this run still answer the five
 * questions" asked cheaply.
 *
 * `driveJob` converts a ledger read that rejected, a records parse that failed
 * and a wave that threw into findings rather than throwing — it has to, because
 * a throw takes the levers down under two jobs that are still running
 * (DPN-06). But nothing then *acted* on them: an unreadable phase A, whose
 * records are the whole of question 1, went on to buy phases B, C and D
 * anyway. ⟨GPT Sol, DPN-06-R.⟩
 */
function fatalSoFar(records: readonly JobRecord[]): DeepenFinding[] {
  return records.flatMap((r) => (r.findings ?? []).filter((f) => f.fatal));
}

/**
 * **Stop before buying the next phase, if the last one cannot be believed.**
 *
 * Returns `true` when the run must go no further. The remaining phases are named
 * out loud, because "the run stopped" and "the run finished and found nothing"
 * are the two facts this whole harness exists to keep apart.
 */
function stopIfCompromised(ctx: RunContext, records: readonly JobRecord[], next: string): boolean {
  const fatal = fatalSoFar(records);
  if (fatal.length === 0) return false;
  ctx.stopped =
    `${fatal.length} fatal finding(s) on a job that has already stopped, so the run did not go on ` +
    `to ${next}. What is below covers what was really driven and really bought; the phases named ` +
    "are absent, not zero.";
  console.log(`\n${"!".repeat(70)}`);
  console.log(`STOPPING before ${next}.`);
  console.log(formatFindings(fatal));
  console.log("!".repeat(70));
  return true;
}

/**
 * **The four phases, in order**, extracted from `main` so that the driving and
 * the reporting are two things a reader can hold separately — the same split
 * `evals/cost/run.ts` makes with `runDraws`.
 *
 * It returns nothing: every job it drives has already been appended to
 * `ctx.runFile.jobs` and checkpointed by `enqueueJob`, which is what makes a
 * crash leave a cleanup manifest rather than orphans.
 *
 * **It can also stop early rather than run to the end.** Between phases it asks
 * whether anything already driven carries a fatal finding, and goes no further
 * if it does — see `stopIfCompromised`.
 */
async function runPhases(opts: {
  ctx: RunContext;
  args: Args;
  runTag: string;
  book: Ingress;
  articleFiles: readonly Ingress[];
  bookSlug: string;
  articleSlugs: readonly string[];
  steps: StepPlans;
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
  if (stopIfCompromised(ctx, [a], "the repeats (phase B), the control (C) or the load (D)")) return;

  /* B — the repeats, **serial**. A contended repeat would confound question 1,
     which is the one the rest of the plan leans on. */
  for (let r = 2; r <= args.repeats; r++) {
    const b = await withLevers({ deepen, reask: [liveBookSlug] }, async () =>
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
    /* **The requeue refusal is only a refusal if the run then stops.** The pass
       is left `queued` so its paid answers stay resumable, and the very next
       repeat would force `hierarchy` on the same slug and publish over the base
       revision that queued job is holding. ⟨GPT Sol, DPN-07-R.⟩ */
    if (stopIfCompromised(ctx, [b], `repeat ${r + 1} and phases C and D`)) return;
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
  if (stopIfCompromised(ctx, [off], "the flag-on half of phase C, or phase D")) return;
  const treeBefore = args.dryRun ? null : treeDigest((await loadArticle(off.slug)).tree);
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
  const treeAfter = args.dryRun ? null : treeDigest((await loadArticle(off.slug)).tree);
  const inertness =
    treeBefore === null || treeAfter === null
      ? []
      : checkInertness({
          offWroteRecords: (off.recordsFiles ?? []).length > 0,
          onWroteRecords: (on.recordsFiles ?? []).length > 0,
          targetsWhenOn: on.stats?.targets ?? null,
          callsWhenOn: on.stats?.calls ?? null,
          treeBefore,
          treeAfter,
        });
  /* **Appended, not assigned.** `driveJob` has already put this job's ledger,
     scope and records findings on the record, and overwriting the array dropped
     every one of them — a fatal `scope` or `ledger-short` finding recorded
     moments earlier vanished, and nothing downstream recomputes those checks.
     ⟨GPT Sol, DPN-01/02-R.⟩ */
  on.findings = [...(on.findings ?? []), ...inertness];
  console.log("\nPhase C — inertness");
  console.log("─".repeat(70));
  /* **A dry run has no tree to compare, and must not print one.** Both digests
     used to be the literal string `"dry-run"`, so the line read `identical` —
     a comparison of nothing with nothing, printed in the words of a passing
     check. docs/reusable/silent-success.md. */
  console.log(
    treeBefore === null || treeAfter === null
      ? "  tree NOT COMPARED: --dry-run publishes no tree, so inertness was not measured at all."
      : `  tree ${treeBefore.slice(0, 16)} → ${treeAfter.slice(0, 16)}   ` +
        `${treeBefore === treeAfter ? "identical" : "CHANGED"}`,
  );
  console.log(
    `  flag off wrote ${(off.recordsFiles ?? []).length} records file(s) (must be 0); ` +
      `flag on wrote ${(on.recordsFiles ?? []).length} (must be 1), targets ${on.stats?.targets ?? "—"}`,
  );
  if (inertness.length > 0) console.log(formatFindings(inertness));
  await ctx.checkpoint();
  if (stopIfCompromised(ctx, [on], "the load phase (D)")) return;

  /* D — three at once, and started together so that "at once" is true of the
     STEP. Its own function because it is the only phase with machinery of its
     own: the start rendezvous, and the drain that has to finish before the
     levers can be restored. */
  await runPhaseD({ ctx, args, runTag, articleFiles, articleSlugs, liveBookSlug, steps: opts.steps, deepen });
}

/**
 * **Phase D — three jobs at once, and the rendezvous that makes the three
 * measured steps START together rather than merely the three promises.**
 *
 * Separated from the other three because it is the only one with machinery of
 * its own, and because both of its hazards live here: the windows that have to
 * intersect (`startRendezvous`, DPN-15/DPN-20/DPN-20-R) and the drain that has
 * to finish before the levers are restored (DPN-06).
 *
 * ## The shape, in three beats
 *
 * 1. **Drive the two load jobs**, whose measured step is held at its entry.
 * 2. **The readiness wait** — both of them there, gate still shut. Nothing of
 *    the book has been driven, so nothing of it has been bought, and if this
 *    wait does not end `"all"` the run **stops here**: the book's pass exists to
 *    answer question 5 and nothing else, and with the load steps gone question 5
 *    is not answerable at any price (`loadReadiness`, DPN-23).
 * 3. **Drive the book**, which reaches the same entry through the same hook and
 *    is the third arrival. The gate opens and all three go together — or it
 *    gives up, and then **none of them runs**: every step it releases is
 *    released `"abandoned"` and throws before `step.run` (`abandonStep`).
 *
 * ## What this phase guarantees, exactly
 *
 * **The one-line version, and it is deliberately narrow:** *it no longer starts
 * paid measured work when the rendezvous already knows question 5 is impossible.*
 * ⟨GPT Sol, DPN-29, replacing a wider claim of mine that was not true.⟩
 *
 * Then four statements, meant to be quoted as they stand.
 *
 * 1. **The three measured steps are released together, and after DPN-25 nothing
 *    re-runs one of them outside that release.** When the gate ends `"all"` all
 *    three are released within one turn of the event loop of each other, so all
 *    three windows open at the same instant and neither load step can have
 *    finished before the book began. The qualification matters and used to be
 *    missing: a job that requeued was **re-driven**, its second arrival took the
 *    gate's latched verdict and ran outside it, and the queue replaced the first
 *    attempt's clock — so a retry falsified this claim while leaving a
 *    plausible-looking pass behind. A measured job now stops on its first
 *    requeue instead (`requeueVerdict`).
 * 2. **On a paid run, if they did not start together, none of them ran and none
 *    of them was bought.** The load steps never both reach the entry, so the
 *    book is never driven (`loadReadiness`); or the gate gives up with the book
 *    already driven, and every step it releases throws at the entry having
 *    bought nothing (`abandonStep`). Those jobs end `error` **by this eval's
 *    doing** and say so in a finding on their own records. *On a paid run*
 *    because `abandonStep` deliberately stands down under `--dry-run`, whose
 *    jobs are expected to fail at their last free step anyway.
 * 3. **Once any of the three has lost the phase, the other two stop before their
 *    next claim AND cancel the calls their running step has not yet made.** A
 *    measured step that failed, a wave that fell back, a claim handed back: any
 *    of them, and `startPhaseFate` both refuses the next claim and aborts a
 *    signal that `announcing` has combined into the measured step's own
 *    `ctx.signal`.
 *
 *    **The first half alone was not enough, and the sentence that said it was is
 *    the one DPN-29's standard let through** (DPN-30). One claim runs the *whole*
 *    `hierarchy` step, and that step buys a structure call, an expansion wave and
 *    a whole pass of labels — `generateHierarchy` catches a failed wave and falls
 *    straight through to `generateLabels` regardless. So "a call already in
 *    flight finishes" did not cover the calls a *running* step had not started
 *    yet, and up to about **$10.80** of phase D's $14.20 could still be bought
 *    after question 5 was known unanswerable: the book's $7.40 pass, plus
 *    whatever of the other load article's ~$3.40 remained.
 *
 *    What the abort really buys, read out of `src/` rather than assumed: label
 *    batches are queued *with* the signal (`src/labels.ts` §
 *    `queue.add(…, { signal })`), so **the ones that have not started are
 *    dropped**; the wave's calls carry it through `liveExpansionExecutor`; and
 *    `src/hierarchy-deepen.ts` § `DeepenOptions.signal` says of it *"cuts short a
 *    wait, never a call in flight"*. So the honest bound is now **the single
 *    request already in flight**, which may still be billed, rather than a whole
 *    label pass. The claim itself cannot be aborted — its `AbortController` is
 *    private to `advanceJobWith` — and does not need to be.
 * 4. **Whether the three windows stayed open together long enough to measure is
 *    NOT guaranteed, and is measured.** Two things can end the overlap, and the
 *    one I kept repeating is not one of them: **another agent's job cannot
 *    serialise these three after a successful gate**, because the gate only opens
 *    when all three hold claims, which is all three of
 *    `DEFAULT_JOB_CONCURRENCY`'s slots. ⟨DPN-29 — I asserted the contrary three
 *    times.⟩ What really remains is runtime failure, which statement 3 now stops,
 *    and **duration**: the load articles' `hierarchy` is far shorter than the
 *    book's 658-778 s, so the two of them close long before it does.
 *
 * That last point is worth reading twice before quoting question 5, because it
 * is the limit of what this phase can measure rather than a fault in it: the
 * book's step is genuinely contended only for as long as the shortest sibling
 * runs. `peakConcurrency` asks whether all three were ever open at one instant,
 * and after the rendezvous that instant is arranged by construction — so it now
 * confirms the phase ran rather than discovering that it overlapped.
 *
 * The one cost the arrangement imposes is on the load steps' clocks: they hold
 * inside their own claims, bounded by `LOAD_RENDEZVOUS_TIMEOUT_MS`, and the hold
 * is inside the measured step's own window, reported as a note when it is more
 * than a moment.
 */
async function runPhaseD(opts: {
  ctx: RunContext;
  args: Args;
  runTag: string;
  articleFiles: readonly Ingress[];
  articleSlugs: readonly string[];
  liveBookSlug: string;
  steps: StepPlans;
  deepen: boolean;
}): Promise<void> {
  const { ctx, args, runTag, articleFiles, articleSlugs, liveBookSlug, deepen } = opts;
  const { ingest, rerun, force } = opts.steps;
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

  /**
   * **The rendezvous, and which way round it goes.**
   *
   * The two load jobs start at `fetch` and reach the measured step only after
   * stages 1-3; the book's job is a forced `hierarchy` and is there at once. So
   * the book is **driven last** — but *all three* are held at the entry, and the
   * three-ness is the point.
   *
   * Holding only the loads and releasing them before driving the book left the
   * hole one party over: the loads waited for each other, nothing waited for the
   * book, and with the third queue slot taken both released load steps could
   * finish before the book ever reached `hierarchy` — while the outcome said
   * `"all"`. ⟨GPT Sol, DPN-20-R.⟩
   *
   * **The book does hold, inside its claim, and it costs nothing.** Its step
   * needs 658-778 s against a 740 s deadline and can give up none of it; by the
   * time it is driven both loads are already waiting *for it*, so its own wait
   * is one microtask. The loads are the ones that really hold, bounded by
   * `LOAD_RENDEZVOUS_TIMEOUT_MS`, and what that cost them is reported.
   *
   * `startRendezvous` says what it saw; a phase that did not line up is a note
   * here and a refusal in `budgetReport`. ⟨GPT Sol, DPN-15, DPN-20, DPN-20-R.⟩
   */
  const loadSlugs = [articleSlugs[1]!, articleSlugs[2]!];
  const rendezvous = startRendezvous({
    /* Three parties, not two: the book is one of them. */
    expected: loadSlugs.length + 1,
    timeoutMs: LOAD_RENDEZVOUS_TIMEOUT_MS,
  });
  const measuredStep = rerun[0] ?? "hierarchy";
  /* **One fate for the three of them** — the invariant behind DPN-26, and behind
     the four separate guards that preceded it. `startPhaseFate`. */
  const fate = startPhaseFate();

  const loadQueued: QueuedJob[] = [];
  for (const [i, slug] of loadSlugs.entries()) {
    loadQueued.push(
      await enqueueJob(ctx, {
        phase: "D",
        label: `ordinary article ${i + 1} ingest, under load`,
        repeat: null,
        slug,
        url: `https://deepen-eval.invalid/${runTag}/load${i + 1}`,
        ingress: loadIngress[i]!,
        steps: ingest,
        force: [],
        announce: { step: measuredStep, arrive: rendezvous.arrive },
        fate,
      }),
    );
  }
  /* **Queued now even though it may never be driven** (DPN-23). The record is
     what makes the absence visible: `budgetReport`'s `expected` counts phase-D
     jobs, so a book that was queued and refused still demands a third clock and
     question 5 still refuses — where a book that was never queued would have
     quietly lowered the bar to two. `loadReadiness`'s fatal finding rides on
     this record. */
  const bookQueued = await enqueueJob(ctx, {
    phase: "D",
    label: `book hierarchy forced under load (repeat ${args.repeats + 1})`,
    repeat: args.repeats + 1,
    slug: liveBookSlug,
    url: null,
    ingress: null,
    steps: rerun,
    force,
    announce: { step: measuredStep, arrive: rendezvous.arrive },
    fate,
  });

  /* **`allSettled`, not `all`.** `Promise.all` rejects the moment one job
     does, and the rejection travels straight out through `withLevers` —
     which restores `SPIDERYARN_DEEPEN_HIERARCHY` and `SPIDERYARN_DEEPEN_REASK`
     while the other two jobs are still running under them, and lets
     `reportRun` start reading half-written ledgers and deleting articles
     underneath live tasks. Draining first costs nothing and is the only way
     the levers mean what they say for the whole phase.
     ⟨GPT Sol, DPN-06.⟩

     **One set of levers for the whole phase**, which is what the re-ask list
     naming slugs makes possible: the book is re-bought and the two articles
     beside it are not, from one environment. */
  const settled = await withLevers({ deepen, reask: [liveBookSlug] }, async () => {
    const loadDriving = loadQueued.map((q) => driveJob(ctx, q));
    /* Attached now, so a load job that rejects while the book is still being
       waited for cannot surface as an unhandled rejection. `allSettled` below
       still sees the rejection itself. */
    for (const p of loadDriving) void p.catch(() => undefined);
    const loadsDrained = Promise.allSettled(loadDriving);
    /* **The first load job to STOP is a load job that will never arrive**, and
       that is the signal to give up on the readiness wait — not `allSettled`,
       which cannot resolve while its sibling is *held at the entry* waiting for
       a gate this wait has not opened yet. Waiting on all of them meant sitting
       out the whole timeout to learn something that was true in the first
       second. */
    const someLoadStopped = Promise.race(
      loadDriving.map((p) => p.then(() => undefined, () => undefined)),
    );
    try {
      /* **The readiness wait: both load steps at the entry, gate still shut.**
         Nothing of the book has been driven, so nothing of it has been bought.
         ⟨GPT Sol, DPN-20-R.⟩ */
      const ready = await rendezvous.waitFor(loadQueued.length, someLoadStopped);
      console.log(
        `  rendezvous: ${ready.arrived.length}/${ready.needed} load step(s) HELD at ` +
          `\`${measuredStep}\` after ${(ready.ms / 1000).toFixed(1)}s — ${ready.why}.`,
      );

      /* **DPN-23 — do not buy the book into a phase that cannot answer.** */
      const verdict = loadReadiness(ready);
      if (!verdict.go) {
        rendezvous.release();
        bookQueued.record.findings = [...(bookQueued.record.findings ?? []), ...verdict.findings];
        ctx.stopped =
          "Phase D's load steps never lined up, so the book's pass under load was NOT DRIVEN and " +
          "NOT BOUGHT. It exists only to answer question 5, and question 5 needs all three " +
          "measured windows open at one instant. Question 5 is absent, not zero.";
        console.log(`\n${"!".repeat(70)}`);
        console.log("NOT DRIVING THE BOOK under load.");
        console.log(formatFindings(verdict.findings));
        console.log("!".repeat(70));
        await ctx.checkpoint();
        return loadsDrained;
      }

      console.log("  Driving the book now; it is the third party and opens the gate.");
      const bookDriving = driveJob(ctx, bookQueued);
      void bookDriving.catch(() => undefined);
      /* **The book alone is the abandon signal here**, for the same reason: the
         two loads are held and cannot settle until the gate opens. If the book
         dies before it reaches the entry, this is what lets them go. */
      const lined = await rendezvous.wait(Promise.allSettled([bookDriving]));
      console.log(
        `  gate: ${lined.arrived.length}/${lined.needed} measured step(s) at \`${measuredStep}\` ` +
          `after ${(lined.ms / 1000).toFixed(1)}s — ${lined.why}. Released together.`,
      );
      /* **What the hold cost**, which is not nothing: it was spent inside each
         job's claim and inside its measured step's own clock. A reader comparing
         those clocks against `STEP_BUDGET_MS.hierarchy` has to know. The book's
         own hold is a microtask, because everyone was already waiting for it. */
      const notable = lined.held.filter((h) => h.ms >= NOTABLE_HOLD_MS);
      if (notable.length > 0) {
        const said = notable.map((h) => `${h.slug} ${(h.ms / 1000).toFixed(1)}s`).join(", ");
        console.log(`  held at the entry: ${said}`);
        ctx.runFile.notes.push(
          `Phase D held ${said} at the entry to \`${measuredStep}\` waiting for the others. That ` +
            "wait is INSIDE each job's claim and inside its measured step's clock, so those " +
            "jobs' `hierarchy` times are that much longer than the work took and their claims had " +
            "that much less of the 740 s deadline left.",
        );
      }
      if (lined.why !== "all") {
        /* **The gate gave up, so every step it just released was released
           `"abandoned"` and threw before it ran** — `abandonStep`. Not a warning
           any more: nothing was bought, and the jobs that were about to buy it
           are `error` on this eval's say-so rather than the pipeline's. */
        ctx.runFile.notes.push(
          `Phase D's start rendezvous ended "${lined.why}" after ${(lined.ms / 1000).toFixed(1)}s ` +
            `with ${lined.arrived.length} of ${lined.needed} measured step(s) at ` +
            `\`${measuredStep}\`, so the three were not started together and none of them ran.`,
        );
        console.log(
          "  WARNING: the phase did not line up, so every measured step it released was ABANDONED " +
            "before it ran. Question 5 is unanswerable and nothing was bought for it.",
        );
      }
      return Promise.allSettled([bookDriving, ...loadDriving]);
    } finally {
      /* **The failure release**, and it wraps the whole body rather than one
         wait. `wait` opens the gate on every ending it has, but a throw anywhere
         between the load jobs starting and it returning has no ending at all —
         and steps held at the entry would then sit there holding their claims
         until the leases ran out. The verdict is **latched** at the first
         opening, so this call cannot turn a gate that opened on all three into
         an abandonment under three running steps. */
      rendezvous.release();
    }
  });

  /* **The half of "abandoned" that the queue cannot rewrite.** The thrown error
     carries `ABANDONED_MARKER` and the queue replaces it with a reader-facing
     sentence; this finding is on the job's own record, so it reaches `run.json`
     and the closing findings block whatever the step's `error` ends up saying.
     Attached after the drain, because `driveJob` assigns `record.findings` and
     would otherwise overwrite it. Never under `--dry-run`, where `abandonStep`
     refuses to fire at all and nothing was abandoned.

     **Whom to attach it to is the gate's answer, not a snapshot's.** This used
     to read the slugs off `wait`'s `held` list, which is taken as the outcome is
     built — so a step that reached the entry *after* the gate closed was turned
     away and left with a bare `error` and no explanation. ⟨GPT Sol, DPN-28.⟩ */
  const abandoned = rendezvous.turnedAway();
  if (!ctx.dryRun) {
    for (const q of [...loadQueued, bookQueued]) {
      if (!abandoned.includes(q.record.slug)) continue;
      q.record.findings = [
        ...(q.record.findings ?? []),
        {
          kind: "not-answerable",
          fatal: true,
          message:
            `${q.spec.label}: ${ABANDONED_MARKER}. Its \`${measuredStep}\` was held at the entry, ` +
            "the rendezvous then gave up rather than opening on all three, and this eval threw " +
            "before the step ran. The job is `error` BY THIS EVAL'S DOING, not the pipeline's, " +
            "and it bought nothing — question 5 was already unanswerable, so running it would " +
            "have spent money on an answer the report would refuse to quote.",
        },
      ];
    }
  }

  const broke = settled.flatMap((s) => (s.status === "rejected" ? [s.reason as unknown] : []));
  if (broke.length > 0) {
    throw new AggregateError(
      broke.map((r) => (r instanceof Error ? r : new Error(String(r)))),
      `${broke.length} of phase D's ${settled.length} driven job(s) threw. Every one of them was ` +
        "drained before the levers were restored; the report below covers what the run really did.",
    );
  }
  /* **Phase D is last, so there is nothing to stop before.** Its fatal findings
     reach the reader through the findings block like everyone else's — all three
     jobs were drained first, which is the part that mattered. */
}



/* -------------------------------------------------------------- the report -- */


/**
 * **A promise with a deadline, and a rejection that names what it was waiting
 * for** — the shape `Promise.race` gives you without the two traps: the timer is
 * always cleared, and the loser's rejection cannot become an unhandled one.
 *
 * ⟨Where I disagreed with Sol: he asked for a *database-side* statement
 * deadline. `costStore.forJob` takes its connection from the shared pool
 * (`src/store/client.ts`), so a `SET statement_timeout` here would land on
 * whichever of the five connections the statement happened to get and would
 * outlive this function on it — a change to every later query in the process,
 * including the ones a paid job is making. `PGOPTIONS` is worse: it is read at
 * pool creation and would cap every statement the run makes. Both are `src/`
 * changes this round may not make, and neither is *safer* than a client-side
 * deadline for the thing the deadline is for, which is making sure the original
 * error still arrives. What is genuinely lost is the query being cancelled at
 * the server rather than merely abandoned here, and it is written down as owed.⟩
 */
async function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const alarm = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms / 1000}s`)), ms);
  });
  try {
    return await Promise.race([work, alarm]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    /* The loser keeps running; swallow its rejection so it cannot surface later
       as an unhandled one on top of whatever really went wrong. */
    void work.catch(() => undefined);
  }
}

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
 *
 * **The scope and completeness checks are applied to this read too**, and that
 * is not belt-and-braces: where the first read failed there has never been a
 * `checkScope` over those rows at all, so a job billed to Product would have
 * gone unreported — the first read's failure was recorded and the checks it
 * would have run were simply skipped. ⟨GPT Sol, DPN-01/02-R.⟩
 *
 * **Concurrent, and under a deadline.** Eight sequential reads with no timeout
 * sat between a thrown phase and the reader being told what threw. ⟨DPN-17.⟩
 */
async function reconcileLedgerAgain(jobs: readonly JobRecord[]): Promise<DeepenFinding[]> {
  const findings: DeepenFinding[] = [];
  const reads = await Promise.all(
    jobs.map(async (j) => {
      try {
        return {
          j,
          now: await withDeadline(
            costStore.forJob(j.jobId),
            LEDGER_READ_DEADLINE_MS,
            `the ledger re-read for ${j.phase} ${j.label}`,
          ),
          err: null as unknown,
        };
      } catch (err) {
        return { j, now: null, err };
      }
    }),
  );
  for (const { j, now, err } of reads) {
    if (now === null) {
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
    /* **Over the rows that are really there now**, whatever happened during the
       run. `asDeepenFinding` carries the fatality and the message across. */
    const late = [
      ...checkScope(now.rows, "eval").map(asDeepenFinding),
      ...checkLedgerComplete(now.rows, j.observedSpend ?? []).map(asDeepenFinding),
    ];
    for (const f of late) {
      findings.push({
        ...f,
        message: `${j.phase} ${j.label}, on the end-of-run ledger read: ${f.message}`,
      });
    }
    if (then == null) {
      /* The first read failed, this one worked: record what is really there
         rather than leaving the row `NOT READ` on evidence we now have. */
      j.money = nowMoney;
      j.unreadable = now.unreadable;
      j.byStep = aggregateByStep(now.rows);
      j.byAiJob = aggregateByAiJob(now.rows);
      /* **"Never driven" and "the read failed" both leave `money` unset**, and
         saying the second over the first is the mistake DPN-19 was about one
         seam over. `startedAt` is what tells them apart: `driveJob` stamps it
         before anything else, so a record without one was queued and refused —
         `loadReadiness`, DPN-23 — and has no bill of its own to have failed to
         read. */
      findings.push({
        kind: "note",
        fatal: false,
        message:
          j.startedAt === undefined
            ? `${j.phase} ${j.label}: this job was QUEUED AND NEVER DRIVEN, so it has no bill of ` +
              `its own. The ledger holds $${(moneyTotalNanos(nowMoney) / 1e9).toFixed(4)} against ` +
              "it, which should be nothing; the run stopped before this job for a reason stated " +
              "above."
            : `${j.phase} ${j.label}: the ledger read failed during the run and succeeded at the ` +
              `end. The bill below is the second read: ` +
              `$${(moneyTotalNanos(nowMoney) / 1e9).toFixed(4)}. Its scope and completeness were ` +
              "checked here rather than during the run.",
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
 * **The three ways this run can have nothing to report, said loudly and first.**
 *
 * Every judgement the report makes below is a loop or a filter over
 * `runFile.jobs`, so at zero jobs every one of them returns `[]` — not by
 * accident but *because* the failure emptied the collection the checks are
 * computed over. The healthiest possible answer and the worst possible outcome
 * are then the same bytes, and on 2026-09-05 they were: an empty driving table
 * under a paragraph explaining why the emptiness was expected, `Findings: none`,
 * and a written `run.json`, with the error on the last line of all.
 * docs/postmortems/260905b-the-rehearsal-reported-a-clean-run-over-zero-jobs.md.
 *
 * A banner rather than a finding alone, because a reader who stops at the top of
 * the output has read the part that decides whether to believe the rest.
 */
function reportAbsences(ctx: RunContext, died: unknown, expectedJobs: number): DeepenFinding[] {
  const findings: DeepenFinding[] = [];
  const banner = (heading: string, body: string): void => {
    console.log(`\n${"!".repeat(70)}`);
    console.log(heading);
    console.log(body);
    console.log("!".repeat(70));
  };
  if (died !== null) {
    const message = died instanceof Error ? died.message : String(died);
    banner("THE RUN DIED. What follows is what it had done by then, not a finished run.", `  ${message}`);
    findings.push({
      kind: "not-answerable",
      fatal: true,
      message: `The run threw and did not finish its phases: ${message}`,
    });
  }
  if (ctx.stopped !== null) {
    banner("THE RUN STOPPED EARLY.", `  ${ctx.stopped}`);
    findings.push({ kind: "not-answerable", fatal: true, message: ctx.stopped });
  }
  if (ctx.runFile.jobs.length === 0) {
    banner(
      "NO JOBS WERE CREATED AT ALL.",
      "  Nothing below is a result. Every table is empty because nothing ran, which is not the\n" +
        "  same fact as nothing being wrong — and a `Findings: none` over an empty run is the\n" +
        "  most believable wrong answer this harness can give. docs/reusable/silent-success.md.",
    );
    findings.push({
      kind: "not-answerable",
      fatal: true,
      message:
        "This run created no jobs. Nothing was driven, nothing was bought, and every question " +
        "below is unasked rather than answered.",
    });
    return findings;
  }
  /* **Zero is the loud shape; short is the likelier one.** The run knows how many
     jobs it set out to create — one ingest, `repeats - 1` repeats, two control
     passes, three under load — and a driving report over fewer of them is not the
     report it says it is. The discipline `expectedBookPasses` already applies to
     passes and `budgetReport`'s `expected` to clocks. A deliberate early stop is
     not this, and has said so above. */
  if (ctx.runFile.jobs.length < expectedJobs && ctx.stopped === null && died === null) {
    findings.push({
      kind: "not-answerable",
      fatal: true,
      message:
        `This run created ${ctx.runFile.jobs.length} of the ${expectedJobs} jobs it planned, and ` +
        "neither stopped on purpose nor threw. Something skipped a phase without saying so, and " +
        "the tables below are over whatever did run.",
    });
  }
  return findings;
}

/**
 * **Everything the run has to say once the jobs have stopped**, and it runs
 * whether or not the phases finished — a run that died three jobs in still paid
 * for three jobs and must say what they bought.
 *
 * The order is deliberate: what stopped the run first, then the per-repeat
 * checks (was this a repeat at all, was the seed held), then the driving, then
 * the five questions, then the findings — because a fatal finding above changes
 * what the numbers below mean, and a reader who stops after the first block has
 * read the part that decides whether to believe the rest.
 *
 * **Two absences it now refuses to print over.** A run that created **no jobs**
 * used to print the whole of this — the phase summaries, `Findings: none`, a
 * written `run.json` — and then throw on its last line: the free rehearsal did
 * exactly that for a whole morning, and a rehearsal exists to be believed.
 * A run that **died** was reported in the words of one that finished.
 * docs/postmortems/260905b-the-rehearsal-reported-a-clean-run-over-zero-jobs.md.
 */
async function reportRun(opts: {
  ctx: RunContext;
  args: Args;
  bookSlug: string;
  runDir: string;
  measuredStep: string;
  /** How many jobs the plan above said this run would create. */
  expectedJobs: number;
  /** What killed the phases, or `null` where they ran to the end. */
  died: unknown;
}): Promise<void> {
  const { ctx, args, runDir, measuredStep, died } = opts;
  await ctx.checkpoint();

  const findings: DeepenFinding[] = [];

  /* **Said before anything else, because everything else is read in its
     light.** ⟨`reportAbsences`.⟩ */
  findings.push(...reportAbsences(ctx, died, opts.expectedJobs));

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

  /* **Read once, filtered twice.** `passesOf` records a finding when a job wrote
     more than one records file, so calling it for the book's passes and again
     for everyone's reported that job twice. Phases A and B are the book and
     nobody else, which makes the filter exact.

     **Phase A and phase B, and nothing else**: the declared controlled
     population is the serial passes; phase D's book pass ran with two other
     jobs against it and is reported with question 5. */
  const allRecords: RecordsPass[] = ctx.runFile.jobs.flatMap(passesOf);
  const bookPasses = allRecords.filter((p) => p.phase === "A" || p.phase === "B");

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

  /* **"None" is a statement about a population, so the population is printed
     with it.** `Findings: none` over a run with no jobs in it is the most
     believable wrong answer this harness can give, and it gave it. */
  console.log(`\nFindings   (over ${ctx.runFile.jobs.length} job(s) that this run created)`);
  console.log("─".repeat(70));
  console.log(
    findings.length > 0
      ? formatFindings(findings)
      : ctx.runFile.jobs.length === 0
      ? "  NONE OBSERVED, over nothing: no job was created, so there was nothing to find anything\n" +
        "  wrong with. This is not a clean run."
      : "  none",
  );
  const fatal = findings.filter((f) => f.fatal);
  if (fatal.length > 0) {
    console.log(
      `\n${fatal.length} FATAL finding(s). These numbers are not what they claim to be — read ` +
        "them before quoting anything from this run.",
    );
    process.exitCode = 1;
  }

  if (ctx.retain.length > 0) {
    /* **Retention beats cleanup, and it is not a flag the caller chose.** A
       queued re-asking pass has paid answers in checkpoint rows that deleting
       the article would cascade away — the work the run said it was preserving.
       ⟨GPT Sol, DPN-07-R.⟩ */
    console.log(
      `\nRETAINED rather than cleaned up: ${ctx.runFile.jobs.length} job(s) and their articles ` +
        "stay, because partial paid work is resumable only while its article exists.",
    );
    for (const why of ctx.retain) console.log(`  - ${why}`);
    console.log(
      "  Resume it, or delete the articles by hand once you have decided the answers are not " +
        "worth keeping.",
    );
  } else if (args.keep) {
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
    /* **Every error, not the outermost one.** `main` throws an `AggregateError`
       when the run died and the reporting died after it, and printing only
       `err.message` there would say "the run threw and then the reporting threw
       as well" and name neither. ⟨GPT Sol, DPN-17.⟩ */
    const say = (e: unknown): string => (e instanceof Error ? e.message : String(e));
    console.error(`\n${say(err)}`);
    if (err instanceof AggregateError) {
      for (const inner of err.errors) console.error(`  - ${say(inner)}`);
    }
    process.exitCode = 1;
  });
}
