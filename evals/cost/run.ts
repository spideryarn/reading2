/**
 * Eval — **what does one article cost?**
 *
 *   npm run eval:cost -- --fixture short-html
 *   npm run eval:cost -- --fixture long-html --fixture pdf --repeat 3
 *   npm run eval:cost -- --list                               (the corpus)
 *   npm run eval:cost -- --preflight                          (the gate only; spends nothing)
 *   npm run eval:cost -- --steps fetch,extract               (free: stops before the paid step)
 *   npm run eval:cost -- --steps fetch,extract,blocks,hierarchy,arc --keep
 *   npm run eval:cost -- --fixture short-html --all-modes     (ingest, then 8 mode jobs)
 *   npm run eval:cost -- --against <slug> --steps arc,tweets --batched-modes
 *
 * `--steps` names the steps the job runs, so a mode step has to be named after
 * the ingest steps it depends on — a fresh slug has no blocks for `arc` to read.
 * **`blocks` has to be named with `hierarchy`** (`unrunnableStepPlan`,
 * src/jobs.ts): a job that rebuilds the blocks and not the tree produces an
 * article that cannot be published, so `enqueue` refuses it rather than letting
 * the run get all the way to a publication failure.
 * `--keep` leaves the article and job behind for inspection instead of deleting
 * them; the ids are in the run's `run.json` either way. `--batched-modes` and
 * `--allow-unpriced` each disable one refusal below, deliberately, and both are
 * recorded in the result.
 *
 * ## `--all-modes`, and the decision that shapes it
 *
 * A per-mode cost has to be **cold**, and every other draw here mints a fresh
 * slug — so the obvious shape pays for a whole ingest per mode, eight times
 * over. On `long-html` that is ~$3.40 of scaffolding bought per mode.
 *
 * Instead: **ingest once, then run each mode as its own job against the adopted
 * article.** `runStep` marks the article cache only when *another step of the
 * same job* would read it (src/pipeline.ts § `cacheArticleForStep`), a
 * single-mode job has no other step in either direction, and Anthropic's cache
 * is explicit-only — so nothing an earlier job wrote can be read by a later
 * one. Adoption is the
 * designed path: a job arriving with neither URL nor upload is
 * `{kind: "adopted"}` (src/jobs.ts § `enqueue`).
 *
 * All of that is an argument, and the run does not rely on it: `checkColdDraw`
 * in report.ts makes it falsifiable — **a mode draw must show no cache read at
 * all**, and the earliest call of each ingest step must show none either, which
 * is what covers PDF extraction on a model that caches implicitly. And
 * `checkAdoption` catches the other way it could go wrong, a mode job that mints
 * instead of adopting and reports a whole cold ingest under the mode's name.
 *
 * `--modes` overrides the eight, which is how the sweep is proved for free: a
 * free step (`--modes blocks`, with `--steps fetch,extract`) drives the same
 * shape without a model call.
 *
 * ## `--against <slug>`
 *
 * One job on an article that already exists, for the batched-mode scenario —
 * what a reader who presses two buttons at once pays, against two separate
 * presses. `sharesArticleCache` paying off has never been priced. The target
 * must be an article those modes have **never** run on, or each skips on its
 * `stepIsDone` stamp and the `no-spend` finding stops the run.
 *
 * It drives a checked-in fixture through the **production** ingest queue under a
 * fresh run-tagged slug, reads the ledger back by job id, and reports what each
 * step cost — cold, with the comparability metadata that says which code and
 * which configuration produced the number.
 *
 * Design and the evidence for every mechanism below:
 * [evals/cost/feasibility.md](feasibility.md). The plan is
 * docs/plans/260902g-estimate-article-ingestion-and-mode-generation-costs.md.
 * The arithmetic is [report.ts](report.ts) and is unit-tested in
 * tests/cost-eval.test.ts; this file only drives and prints.
 *
 * ## The three mechanisms, and why each is the one it is
 *
 * 1. **Attribution — every step's `run` wrapped in
 *    `withSpendAttribution({ scopeKind: "eval" })`.** `runStep` opens its own
 *    collector with a literal `scopeKind: "job_step"` and nested collectors
 *    *shadow*, so wrapping the queue in an eval-scoped `collectSpend` records
 *    nothing. `withSpendAttribution` re-enters the **same** box with a patched
 *    attribution, and `scopeKind` is read at row-write time — so every call
 *    inside a step writes an `eval` row while keeping the owner, slug, job id
 *    and step name `runStep` set. `scripts/ai-cost.ts` already defines Product
 *    as `scopeKind !== "eval"`, so eval spend stays out of it with **no change
 *    to the cost machinery**.
 * 2. **Fixture ingress — only stage 1 is replaced**, through the existing
 *    `AdvanceParts.steps` seam. The fixture step reads the committed bytes and
 *    calls the exported `writeRaw()`; extract, blocks, hierarchy and assets are
 *    the production `STEPS` on the production session. **No SSRF guard is
 *    weakened** — a `file:`/`fixture:` scheme in `src/` was rejected for exactly
 *    that reason, and so was a local static server (the box's LAN address is
 *    private and blocked anyway).
 * 3. **`enqueue` ends with `pump()`, which drives the job with the PRODUCTION
 *    registry and wins the claim synchronously.** On the feasibility stage's
 *    first dry run this silently skipped the fixture step and the job went to
 *    the network. The fix is the existing idiom — `VERCEL` set across the
 *    `enqueue` call and nothing else, unset immediately after
 *    (tests/claim-session-postgres.test.ts, whose comment says it is there
 *    "only to stop `enqueue`'s pump").
 *
 * ## What it refuses to do, and why each refusal earns its place
 *
 * Five gates, all of them before the first job exists, because none of them can
 * be repaired after the money has moved. Four were added by GPT Sol's review of
 * the first version, 2026-09-02.
 *
 * - **A non-local database, or the filesystem store.** The `Target:` line is
 *   printed the way the `db-*` scripts print it; a run against anything else
 *   spends real money into somebody's real ledger.
 * - **A stale fixture, in *any* selected fixture.** Hashed up front rather than
 *   per draw: a warning printed after `enqueue` lets two articles be paid for
 *   before the third is checked.
 * - **An owner a browser could be signed in as.** `src/web/jobEngine.ts` drives
 *   every queued job of its owner, so a dev tab left open could win a claim and
 *   run a paid step through the *production* registry, billing it to Product.
 *   `VERCEL=1` silences this process's pump and says nothing to a browser.
 *   `src/owner.ts § EVAL_OWNER_ID`.
 * - **An eval owner that is not seeded**, because the alternative is a foreign
 *   key violation surfacing from inside `enqueue`.
 * - **More than one on-demand mode in a job.** They share a cached article
 *   prefix, so the second one's number is a warm read and is not what pressing
 *   that mode costs.
 *
 * And two refusals *after* a draw, which stop the run rather than annotate it:
 * a row that escaped the eval scope, and a ledger that is short of what the
 * step's own collector said it bought. See `Finding.fatal` in report.ts.
 *
 * ## What it leaves behind, and what it does not
 *
 * Every article and job it creates is recorded in the results file **before**
 * the job runs, so a crash leaves a cleanup manifest rather than orphans; the
 * articles and jobs are then deleted by id. The **ledger rows stay** — that is
 * the whole product of the run, and `ai_calls.article_id` is `on delete set
 * null` with `article_slug` kept beside it as the historical fact.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { inArray, sql } from "drizzle-orm";
import { withSpendAttribution } from "../../src/ai-spend.js";
import { withLedger } from "../../src/cli-ledger.js";
import { getDb } from "../../src/db/client.js";
import { articles, jobs as jobsTable } from "../../src/db/schema.js";
import { loadEnvLocal } from "../../src/env.js";
import { structureRequest } from "../../src/hierarchy.js";
import { isMain } from "../../src/is-main.js";
import {
  type AdvanceParts,
  advanceJobWith,
  claimSession,
  enqueue,
  type StepRegistry,
} from "../../src/jobs.js";
import { effortFor, STAGE_EFFORT } from "../../src/models.js";
import { environmentOwnerId, EVAL_OWNER_ID, runAsOwner } from "../../src/owner.js";
import { DEFAULT_INGEST_STEPS, STEPS } from "../../src/pipeline.js";
import { costStore } from "../../src/store/ai-calls.js";
import { STORE } from "../../src/store/live.js";
import type { Job, StepName } from "../../src/types.js";
import { type CostFixture, FIXTURES, fixtureByName } from "./fixtures.js";
import {
  AI_JOB_STEP,
  ALL_MODES,
  assertAdoptable,
  assertDistinctEvalOwner,
  assertLedgerUsable,
  assertOneOnDemandMode,
  assertSweepArgs,
  blocksFromDetail,
  drawMustStop,
  evalRegistry,
  fixtureFetch,
  localTarget,
  mustPayFor,
  parseStepList,
  requiredAiJobsFor,
  verifyFixtures,
  withoutTheInProcessPump,
} from "./harness.js";
import {
  type Adoption,
  aggregateByAiJob,
  aggregateByStep,
  checkAdoption,
  checkCold,
  checkBatchedDraw,
  checkColdDraw,
  type DrawOutcome,
  type DrawPhase,
  type Finding,
  formatFindings,
  formatPaidFailures,
  formatStepTable,
  formatVariation,
  headlineTotal,
  jobWallClockMs,
  type Money,
  moneyTotalNanos,
  observedVariation,
  type StepObservation,
  type StepSpend,
  totalMoney,
} from "./report.js";

/** Nothing this eval does should take longer than this. A hung claim is a bug, not patience. */
const DRAW_TIMEOUT_MS = 25 * 60_000;
const BUSY_BACKOFF_MS = 500;

/* ------------------------------------------------------------- the record -- */

/** Everything about the machine and the configuration that a later run compares against. */
interface RunMeta {
  startedAt: string;
  /** HEAD when the run started. The only thing that pins the module-private effort constants. */
  commit: string;
  gitDirty: boolean;
  /**
   * **sha256 of `git diff HEAD -- src evals`**, so a run made on a dirty tree is
   * still identifiable rather than merely flagged.
   *
   * `commit` alone does not pin the code that decides cost when the tree is
   * dirty — and on this box it always is, because several agents share the
   * checkout. Refusing a dirty tree would make the eval unrunnable here; a
   * digest over the two directories that determine what a call costs makes two
   * runs comparable-or-not on evidence. `null` when the tree is clean or git
   * could not be asked. GPT Sol, 2026-09-02.
   */
  srcPatchSha256: string | null;
  store: string;
  databaseTarget: string;
  /** Who the articles belong to. Never the environment owner — see `assertDistinctEvalOwner`. */
  evalOwnerId: string;
  environmentOwnerId: string;
  /**
   * `per-mode` (at most one on-demand mode in the job) or `batched-modes`.
   * **The two must never be aggregated together**: modes sharing one job share a
   * cached article prefix, so the second one's number is a warm read.
   */
  scenario: "per-mode" | "batched-modes";
  node: string;
  /**
   * **Effort, recorded because the baseline was nearly wrong by 2× without it.**
   * `fb82dc8` moved hierarchy from `high` to `medium` partway through the
   * ledger and no row said so, which made two halves of one table look
   * comparable when they were not.
   *
   * `hierarchy` is read from `structureRequest` rather than restated, because
   * the constant it comes from is module-private in src/hierarchy.ts and a
   * second copy of the string here is a copy free to drift. Labels' effort is
   * private in src/labels.ts with no exported reader at all; `commit` above is
   * what pins it, and that is stated rather than left to be discovered.
   */
  effort: {
    pipelineEnvOverride: string | null;
    hierarchy: string | null;
    labels: "module-private in src/labels.ts — pinned by commit + srcPatchSha256";
    articleStages: Record<string, string>;
  };
}

/** One independent cold draw: one article, one job. */
interface Draw {
  /**
   * **Ingest, mode or batched**, so the report can keep the three apart — see
   * `DrawPhase` in report.ts. Without it a per-mode number and the mode's share
   * of a batched job look like the same measurement, and one of them is warm.
   */
  phase: DrawPhase;
  /** The single mode a `mode` draw measures. `null` for ingest and batched draws. */
  mode: StepName | null;
  /** The corpus entry. `null` for an `--against` draw, which names a slug. */
  fixture: string | null;
  fixtureFile?: string;
  /** sha256 of the bytes **this run read**, beside what the manifest claims. */
  fixtureSha256?: { measured: string; manifest: string; matches: boolean };
  fixtureBytes?: number;
  /**
   * **Whether the queue adopted the article or minted a fresh one**, read back
   * rather than assumed. A mode job that mints pays for a whole cold ingest and
   * files the total under the mode's name, and nothing else here would notice —
   * it spent money, in the eval scope, on the step it was asked for.
   */
  adoption?: Adoption;
  /**
   * Did **this run** create the article? Cleanup deletes only the ones that
   * answer yes, so an `--against` run cannot take an article an earlier `--keep`
   * run left for the two batched draws after it.
   */
  createdArticle: boolean;
  /** 1-based, and where in the whole run's order this draw sat. */
  repeat: number;
  order: number;
  slug: string;
  url?: string;
  jobId: string;
  /** Filled after the job, so a crash leaves the slug and the job id to clean up by. */
  articleId?: string | null;
  jobStatus?: Job["status"];
  jobError?: string;
  /** **The stage outcome, which `gateway ok` does not answer.** One entry per step. */
  steps?: { name: string; status: string; detail?: string; error?: string }[];
  /** Blocks the job actually produced, against what the corpus manifest measured. */
  blocks?: { observed: number | null; manifest: number | null; matches: boolean | null };
  gistableBlocks?: number | null;
  /** Wall clock the runner saw, which includes every free local second around the calls. */
  elapsedMs?: number;
  /** `max(finishedAt) − min(startedAt)` over the job's ledger rows. Never a sum. */
  ledgerWallClockMs?: number | null;
  /** Lines of the ledger that could not be read. A total that is short must say so. */
  unreadable?: number;
  money?: Money;
  byStep?: StepSpend[];
  byAiJob?: StepSpend[];
  /**
   * What each step's own collector saw, from `AdvanceParts.onStepSpend` — the
   * only side that can tell you a row was made and never persisted.
   */
  observedSpend?: StepObservation[];
  findings?: Finding[];
}

interface RunFile {
  meta: RunMeta;
  runTag: string;
  notes: string[];
  draws: Draw[];
}

/**
 * Standing notes, in the results file rather than only in a comment, because a
 * later reader compares runs against these without opening the code.
 */
const STANDING_NOTES = [
  "Stage 1 (fetch) is a fixture read, so the elapsed time excludes real-world fetch latency. " +
    "It costs no model call, so the money is unaffected.",
  "There is no `labels` step: nav labels fan out inside `hierarchy`, so every label call " +
    "carries stepName=hierarchy and job=labels. The hierarchy/labels split is in `byAiJob`.",
  "Per-step wall clock is max(finishedAt) - min(startedAt). sum(durationMs) is printed beside " +
    "it and is several times larger wherever a step fanned out; it is not a wait.",
  "Unpriced rows are unknown, not zero. A total carrying them is short by an unknown amount.",
  "Pipeline cache breakpoints are conditional and off by default (`sharesArticleCache`), so an " +
    "ordinary ingest marks nothing and these are cold numbers in that sense too. Checked in the " +
    "code: `sharesArticleCache` returns false for anything that is not an ArticleStage, and " +
    "`hierarchy` is not one — so nothing an ingest writes can be read warm by a later draw.",
  "`scenario` says whether the modes were measured one per job (`per-mode`) or several in one " +
    "(`batched-modes`). The two are different numbers and must never be aggregated together.",
  "A draw that was billed and did not produce its artefact is a PAID FAILURE: its money was " +
    "really spent and it is not the price of anything, so it is excluded from every per-mode and " +
    "whole-article figure and listed separately. Read `jobStatus` and `steps` per draw, not the " +
    "money alone — a truncated generation is billed in full with an `outcome: \"ok\"` row.",
  "A missing ledger row is read against `steps`: if the step that would have bought it failed, " +
    "or never ran because something before it did, the absence is EXPLAINED (finding kind " +
    "`explained-absence`) and the sweep carries on — a run measuring how often hierarchy fails " +
    "cannot stop the first time it does. An absence nothing explains is still fatal and still " +
    "stops the run, because that is a row that was lost rather than never bought.",
  "`observedSpend` is what each step's own collector saw, from AdvanceParts.onStepSpend. Its " +
    "`calls` is what the ledger is reconciled against. Its `writeFailures` is a LOWER BOUND: " +
    "collectSpend calls onDone before draining its writes, so a write that rejects late is not " +
    "counted there — which is exactly why the check is calls-made against rows-kept.",
];

/* ---------------------------------------------------------------- driving -- */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * **The article a mode or batched draw adopts**, read out of `articles` before
 * the job is advanced.
 *
 * The id is carried as well as the slug because it is the only thing that can
 * tell an adoption from a mint after the fact: the slug of an article the queue
 * quietly replaced is the same slug.
 */
interface AdoptTarget {
  slug: string;
  /** `null` when there is no article under that slug, which `assertAdoptable` refuses. */
  articleId: string | null;
}

/**
 * What one draw is, as three shapes rather than one bag of optionals.
 *
 * The three ask for different things and only a union says so: an ingest draw
 * has bytes and no target, a mode draw has a target and exactly one mode, and a
 * batched draw has a target and a step list nobody derived.
 */
type DrawSpec =
  | {
      phase: "ingest";
      fixture: CostFixture;
      bytes: Uint8Array;
      steps: readonly StepName[];
      /** Which repeat of this fixture this is (1-based). */
      repeat: number;
    }
  | {
      phase: "mode";
      mode: StepName;
      /**
       * Kept for the record: which article shape this mode's number is about.
       * `null` for an `--against` draw, which names a slug and never learns what
       * the article behind it was ingested from.
       */
      fixture: CostFixture | null;
      target: AdoptTarget;
    }
  | { phase: "batched"; steps: readonly StepName[]; target: AdoptTarget };

interface DrawRequest {
  spec: DrawSpec;
  runTag: string;
  order: number;
  /** Accept a required step whose whole bill is unknown, as a note rather than a stop. */
  allowUnpriced: boolean;
  /** `--batched-modes`, which is what makes a warm first call expected rather than fatal. */
  batchedModes: boolean;
  runFile: RunFile;
  checkpoint: () => Promise<void>;
}

/** The four things every phase has to answer before a job can be enqueued. */
interface DrawShape {
  slug: string;
  /** Only an ingest draw claims a name with a URL; a mode job must carry none. */
  url: string | null;
  stepNames: readonly StepName[];
  fixture: CostFixture | null;
}

function shapeOf(spec: DrawSpec, runTag: string): DrawShape {
  if (spec.phase === "ingest") {
    return {
      /* **Run-tagged URL as well as slug.** `enqueue` routes through `freeSlug`,
         which *adopts* an existing article when the URL matches — so a second
         draw on a repeated URL would silently measure a warm re-run of the
         first. evals/cost/feasibility.md § the rest of the checklist. */
      slug: `evalcost-${runTag}-${spec.fixture.name}-${spec.repeat}`,
      url: `https://cost-eval.invalid/${runTag}/${spec.fixture.name}-${spec.repeat}`,
      stepNames: spec.steps,
      fixture: spec.fixture,
    };
  }
  /* **No URL and no upload, which is the whole of how a job adopts.** `enqueue`
     resolves a request carrying neither to `{kind: "adopted", slug}`
     (src/jobs.ts), and its docstring says several such jobs queuing on one
     article "is the whole of what Greg asked for". Passing a URL here would mint
     a second article and buy a cold ingest at the price of a mode. */
  return spec.phase === "mode"
    ? { slug: spec.target.slug, url: null, stepNames: [spec.mode], fixture: spec.fixture }
    : { slug: spec.target.slug, url: null, stepNames: spec.steps, fixture: null };
}

/**
 * Advance one job until it is done, backing off while somebody else holds the
 * single running slot.
 *
 * **The outer attribution round the advance is not the same thing as the
 * per-step overlay.** `collectSpend(run)` closes before `session.commit`
 * (src/jobs.ts), so a paid call added to `commit` or to a postcondition tomorrow
 * would fall through to *this* runner's outer eval collector — which is
 * eval-scoped, so the scope check would not fire, but which carries no job id
 * and no article, so `costStore.forJob` would never see the money either. It
 * would simply be missing. Naming the job and the slug here means such a call
 * lands somewhere `forJob` can find it. GPT Sol, 2026-09-02. (There is no such
 * purchase today; I checked, and so did Sol.)
 */
async function driveToDone(
  start: Job,
  steps: StepRegistry,
  onStepSpend: NonNullable<AdvanceParts["onStepSpend"]>,
): Promise<{ job: Job; elapsedMs: number }> {
  let job = start;
  const startedAt = Date.now();
  for (;;) {
    if (Date.now() - startedAt > DRAW_TIMEOUT_MS) {
      throw new Error(`${job.slug}: still not done after ${DRAW_TIMEOUT_MS / 60_000} minutes`);
    }
    const advanced = await withSpendAttribution(
      { jobId: job.id, articleSlug: job.slug, ownerId: EVAL_OWNER_ID },
      () => advanceJobWith(job.id, { session: claimSession, steps, onStepSpend }),
    );
    if (!advanced) throw new Error(`${job.slug}: job ${job.id} vanished mid-run`);
    job = advanced.job;
    if (advanced.done) return { job, elapsedMs: Date.now() - startedAt };
    /* `busy` means somebody else holds the single running slot — another agent's
       dev server, most likely, since this checkout is shared. Back off and ask
       again, exactly as `pump` does; exiting on `busy` is not a driver. */
    if (advanced.busy) await sleep(BUSY_BACKOFF_MS);
  }
}

/** The heading line for a draw, so `oneDraw` reads as a sequence rather than a shape test. */
function drawLabel(spec: DrawSpec, stepNames: readonly StepName[]): string {
  if (spec.phase === "ingest") return `${spec.fixture.name} r${spec.repeat} ingest`;
  if (spec.phase === "mode") return `${spec.fixture?.name ?? spec.target.slug} mode ${spec.mode}`;
  return `batched ${stepNames.join("+")}`;
}

/**
 * The record as it stands **before the job is advanced**, which is the version a
 * crash leaves behind — so it has to carry everything cleanup needs: the slug,
 * the job id, and whether this run created the article.
 */
function startingRecord(of: {
  spec: DrawSpec;
  shape: DrawShape;
  bytes: Uint8Array | null;
  measured: string | null;
  order: number;
  job: Job;
}): Draw {
  const { spec, shape, bytes, measured, order, job } = of;
  const fixture = shape.fixture;
  return {
    phase: spec.phase,
    mode: spec.phase === "mode" ? spec.mode : null,
    fixture: fixture?.name ?? null,
    ...(fixture ? { fixtureFile: fixture.file } : {}),
    ...(measured && fixture
      ? {
          fixtureSha256: {
            measured,
            manifest: fixture.sha256,
            matches: measured === fixture.sha256,
          },
          fixtureBytes: bytes?.byteLength ?? 0,
        }
      : {}),
    /* Only an ingest draw brings an article into being; every other phase is
       running on one that was already there, and cleanup reads this rather than
       guessing from the phase. */
    createdArticle: spec.phase === "ingest",
    repeat: spec.phase === "ingest" ? spec.repeat : 1,
    order,
    slug: job.slug,
    ...(shape.url !== null ? { url: shape.url } : {}),
    jobId: job.id,
  };
}

/**
 * **Adopted or minted, decided on the article id and not on the slug.**
 *
 * A slug is the same slug whether the article under it is the one the sweep
 * ingested or a replacement, so the id is the only observation that can tell
 * them apart — read back from `articles`, never inferred, which is the mistake
 * that let this eval run for a while creating every article under the wrong
 * owner.
 */
function adoptionAfter(
  spec: DrawSpec,
  wanted: string,
  gotSlug: string,
  articleId: string | null,
): Adoption {
  if (spec.phase === "ingest") {
    return { kind: "minted", requested: wanted, got: gotSlug, why: "an ingest draw mints" };
  }
  if (articleId !== null && articleId === spec.target.articleId) {
    return { kind: "adopted", slug: gotSlug, articleId };
  }
  return {
    kind: "minted",
    requested: spec.target.slug,
    got: gotSlug,
    why: `the article id moved from ${spec.target.articleId ?? "nothing"} to ${articleId ?? "nothing"}`,
  };
}

async function oneDraw(req: DrawRequest): Promise<Draw> {
  const { spec, runTag, order, runFile, checkpoint } = req;
  const { slug: wanted, url, stepNames, fixture } = shapeOf(spec, runTag);
  const bytes = spec.phase === "ingest" ? spec.bytes : null;

  /* Hashed again here so the record says what *this draw* read, but the run has
     already refused to start if any fixture was stale — `verifyFixtures` runs
     over the whole corpus before a single job exists, because a warning printed
     after `enqueue` lets two articles be paid for before the third is checked. */
  const measured = bytes ? createHash("sha256").update(bytes).digest("hex") : null;

  /* **The fixture step only where there are fixture bytes.** A mode job runs no
     `fetch` at all, so the production step in the registry is never reached —
     but building the overlay from the production `STEPS` says that out loud
     rather than handing a mode job a stage 1 that would read the wrong article's
     bytes if the step list ever grew one. */
  const steps = evalRegistry(
    bytes && fixture ? { ...STEPS, fetch: fixtureFetch(fixture, bytes, url ?? "") } : STEPS,
  );

  /* **What each step's collector saw**, so the ledger can be checked for being
     short rather than merely read. `onStepSpend` is an observer on the queue
     (src/jobs.ts § AdvanceParts) and cannot change what it watches. `calls` is
     the field that matters — see the note there on why `writeFailures` is only
     a lower bound. */
  const observedSpend: StepObservation[] = [];
  const onStepSpend: AdvanceParts["onStepSpend"] = (step, report) => {
    const seen = observedSpend.find((o) => o.step === step);
    const one = seen ?? { step, calls: 0, pending: 0, writeFailures: 0 };
    if (!seen) observedSpend.push(one);
    /* Accumulated rather than assigned: a step executed twice — the duplicate
       execution this eval exists partly to detect — reports twice, and taking
       the last would hide half the calls from the reconciliation. */
    one.calls += report.calls.length;
    one.pending += report.pending.length;
    one.writeFailures += report.writeFailures;
  };

  /* **The pre-spend half of the adoption check.** `enqueue` lets a job adopt a
     slug nobody holds — deliberately, and src/jobs.ts explains why — so a mode
     job pointed at a slug with no article behind it would run, create the row on
     publish, and report a whole cold ingest as the price of that mode. Asked of
     the database before the job exists, because after it the money has moved. */
  if (spec.phase !== "ingest") assertAdoptable(spec.target.slug, spec.target.articleId);

  let job: Job = await withoutTheInProcessPump(() =>
    enqueue({ slug: wanted, ...(url !== null ? { url } : {}), steps: [...stepNames] }),
  );

  /* Recorded **before** the job runs: a crash from here on leaves a cleanup
     manifest rather than an orphan article nobody can name. */
  const draw = startingRecord({ spec, shape: { slug: wanted, url, stepNames, fixture }, bytes, measured, order, job });
  runFile.draws.push(draw);
  await checkpoint();

  console.log(`\n${job.slug}  [${drawLabel(spec, stepNames)}]  job ${job.id}`);
  console.log("─".repeat(60));
  if (draw.fixtureSha256 && !draw.fixtureSha256.matches && fixture && measured) {
    console.log(
      `  STALE FIXTURE  ${fixture.file} hashes ${measured.slice(0, 12)}…, the manifest says ` +
        `${fixture.sha256.slice(0, 12)}… — update evals/cost/fixtures.ts deliberately`,
    );
  }

  /* **The slug the queue handed back, checked before the job is advanced.** An
     adopted request cannot move its slug today — only a `minted` allocation
     reserves a name, and the repair loop only moves that one — so this is here
     for the day that stops being true, and it stops the run *before* the paid
     step rather than diagnosing it afterwards. */
  if (spec.phase !== "ingest" && job.slug !== spec.target.slug) {
    draw.adoption = {
      kind: "minted",
      requested: spec.target.slug,
      got: job.slug,
      why: "the queue moved the slug",
    };
    draw.findings = checkAdoption(draw.adoption, spec.phase);
    await checkpoint();
    throw new Error(
      `${spec.target.slug}: ${draw.findings.map((f) => f.message).join(" ")} ` +
        "Stopping before this job spends anything.",
    );
  }

  const driven = await driveToDone(job, steps, onStepSpend);
  job = driven.job;
  draw.elapsedMs = driven.elapsedMs;
  draw.jobStatus = job.status;
  if (job.error !== undefined) draw.jobError = job.error;
  draw.steps = job.steps.map((s) => ({
    name: s.name,
    status: s.status,
    ...(s.detail !== undefined ? { detail: s.detail } : {}),
    ...(s.error !== undefined ? { error: s.error } : {}),
  }));
  const observedBlocks = blocksFromDetail(job.steps.find((s) => s.name === "blocks")?.detail);
  const manifestBlocks = fixture?.blocks ?? null;
  draw.blocks = {
    observed: observedBlocks,
    manifest: manifestBlocks,
    matches:
      observedBlocks === null || manifestBlocks === null ? null : observedBlocks === manifestBlocks,
  };
  draw.gistableBlocks = fixture?.gistableBlocks ?? null;

  /* **`forJob`, not a time window.** It exists (src/store/ai-calls-pg.ts), so
     the plan's older "read a bounded window and filter in memory" is
     superseded — and a window would pick up whatever the other agents sharing
     this database were buying at the same moment. */
  const ledger = await costStore.forJob(job.id);
  draw.unreadable = ledger.unreadable;
  draw.money = totalMoney(ledger.rows);
  draw.byStep = aggregateByStep(ledger.rows);
  draw.byAiJob = aggregateByAiJob(ledger.rows);
  draw.ledgerWallClockMs = jobWallClockMs(ledger.rows);
  draw.observedSpend = observedSpend;
  draw.findings = checkCold(ledger.rows, {
    mustPay: mustPayFor(fixture, stepNames),
    /* The second namespace: a priced `hierarchy` step proves the structure call
       ran and says nothing at all about the label fan-out, which shares its
       `stepName`. */
    mustPayJobs: requiredAiJobsFor(fixture, stepNames),
    observed: observedSpend,
    /* **What the job said its own steps did**, so an absence a failure explains
       can be told from a row that was lost. Filled from `job.steps` a few lines
       up, which is why this is here and the judgement is in report.ts: the
       statuses are IO, the rule about them is not. */
    stepStatuses: draw.steps ?? [],
    aiJobStep: AI_JOB_STEP,
    ...(req.allowUnpriced ? { allowUnpriced: true } : {}),
  });
  draw.articleId = await articleIdFor(job.slug);

  /* The post-job half of the adoption check — `assertAdoptable` above is the
     pre-spend half, and `adoptionAfter` says why the id rather than the slug. */
  draw.adoption = adoptionAfter(spec, wanted, job.slug, draw.articleId ?? null);
  draw.findings.push(...checkAdoption(draw.adoption, spec.phase));
  /* **And the coldness of the draw itself.** The all-modes stage ingests once
     and runs each mode as its own job, which is only a cold per-mode number if
     no later job can read the cache an earlier one wrote — and an ingest draw
     has two steps on models that cache implicitly, with no breakpoint needed.
     report.ts § `checkColdDraw` has the argument; this is the measurement. */
  draw.findings.push(
    ...checkColdDraw(ledger.rows, { phase: spec.phase, batchedModes: req.batchedModes }),
  );
  /* **The batched draw's own question**, which is the mirror of the one above:
     not "did anything read what it should not have" but "did anybody read what
     we paid to write". It is the only phase where a cache read is expected, so
     it is the only phase where a missing one is evidence — and it went unasked
     for the whole of the 2026-09-03 sweep, whose numbers proved the bug in
     260903c to a reader and to nothing automatic. report.ts § `checkBatchedDraw`. */
  draw.findings.push(...checkBatchedDraw(ledger.rows, spec.phase));
  await checkpoint();

  printDraw(draw);

  /* **A fatal finding stops the run, it does not decorate it.** Both kinds mean
     the same thing — the next draw will spend money and measure something other
     than what it claims — and a leak in particular is money landing in
     `npm run cost`'s Product bucket, one draw at a time. The `finally` in
     `main` still checkpoints, cleans up and prints the draws already paid for,
     so stopping loses nothing. evals/cost/feasibility.md § the one residual
     risk asks for exactly this refusal.

     **A draw that simply failed is not one of them**, and on 2026-09-03 it was:
     hierarchy failed its range check, its label fan-out never ran, and the
     missing `labels` rows read as lost. The sweep stopped two draws into
     measuring how often exactly that happens. `stoppedAtOrBefore` in report.ts
     is the telling apart; `drawMustStop` is the rule that reads it. */
  const fatal = drawMustStop(draw.findings);
  if (fatal.length > 0) {
    throw new Error(
      `${job.slug}: ${fatal.length} fatal finding(s) — ${fatal.map((f) => f.message).join(" ")} ` +
        "Stopping before the next draw spends anything.",
    );
  }
  return draw;
}

function printDraw(draw: Draw): void {
  const money = draw.money;
  console.log(
    `  job           ${draw.jobStatus}` +
      (draw.jobError ? ` — ${draw.jobError}` : "") +
      `   steps: ${(draw.steps ?? []).map((s) => `${s.name}=${s.status}`).join(" ")}`,
  );
  console.log(
    `  adoption      ${
      draw.adoption === undefined
        ? "—"
        : draw.adoption.kind === "adopted"
          ? `adopted ${draw.adoption.slug} (article ${draw.adoption.articleId})`
          : `MINTED ${draw.adoption.got} — ${draw.adoption.why}`
    }`,
  );
  console.log(
    `  blocks        ${draw.blocks?.observed ?? "—"} observed, ` +
      `${draw.blocks?.manifest ?? "—"} in the manifest` +
      (draw.blocks?.matches === false ? "  MISMATCH — the splitter has moved" : "") +
      `   (${draw.gistableBlocks ?? "—"} gistable, measured 2026-09-02)`,
  );
  if (money) {
    console.log(
      `  spend         ${fmt(moneyTotalNanos(money))}` +
        `   credits ${fmt(money.credits)}  BYOK upstream ${fmt(money.upstream)}  ` +
        `computed ${fmt(money.computed)}` +
        (money.unpriced > 0
          ? `  — ${money.unpriced} call(s) reported no cost, so this is short by an unknown amount`
          : ""),
    );
  }
  console.log(
    `  clock         runner ${((draw.elapsedMs ?? 0) / 1000).toFixed(1)}s` +
      `   ledger envelope ${draw.ledgerWallClockMs === null || draw.ledgerWallClockMs === undefined ? "—" : `${(draw.ledgerWallClockMs / 1000).toFixed(1)}s`}` +
      "   (fetch is a fixture read, so no network latency is in either)",
  );
  if (draw.unreadable) console.log(`  UNREADABLE    ${draw.unreadable} ledger line(s) could not be read`);
  if (draw.byStep?.length) {
    console.log("  by step");
    console.log(formatStepTable(draw.byStep));
  }
  if (draw.byAiJob?.length) {
    console.log("  by AI job (hierarchy vs its label fan-out)");
    console.log(formatStepTable(draw.byAiJob));
  }
  const findings = formatFindings(draw.findings ?? []);
  if (findings) console.log(`  findings\n${findings}`);
}

/** `$0.0000`, through the one formatter, so no report here invents its own rounding. */
function fmt(nanos: number): string {
  return `$${(nanos / 1e9).toFixed(4)}`;
}

async function articleIdFor(slug: string): Promise<string | null> {
  const rows = await getDb()
    .select({ id: articles.id })
    .from(articles)
    .where(inArray(articles.slug, [slug]));
  return rows[0]?.id ?? null;
}

/**
 * Delete exactly what this run created, **and nothing else**.
 *
 * By the exact slugs and job ids this run minted — never a `LIKE 'evalcost-%'`
 * prefix, which would take a concurrent run's articles with it, and several
 * agents share this database.
 *
 * **By slug rather than by article id**, even though the id is recorded: the id
 * is only known once the job has finished, and a draw that crashed mid-job has
 * a slug and no id. Deleting by the thing that is written down *before* the job
 * runs is what makes the crash path leave nothing behind. The slug is unique in
 * `spideryarn.articles`, so it names one row exactly as an id would.
 *
 * The **ledger rows stay**: `ai_calls.article_id` is `on delete set null` and
 * `article_slug` is kept beside it as the historical fact, which is what makes
 * deleting the article safe and the measurement durable. That is the point of
 * the whole run, so it is not an oversight that this deletes nothing there.
 */
async function cleanup(draws: readonly Draw[]): Promise<void> {
  /* **Only the articles this run created**, which since the all-modes sweep is
     not every article it touched. An `--against` draw runs on one an earlier
     `--keep` run left behind for the two batched draws after it, and deleting
     it would take those two measurements with it. Every job is ours, so every
     job goes. */
  const slugs = draws.filter((d) => d.createdArticle).map((d) => d.slug);
  const jobIds = draws.map((d) => d.jobId);
  const db = getDb();
  const removed =
    slugs.length > 0
      ? await db.delete(articles).where(inArray(articles.slug, slugs)).returning({ id: articles.id })
      : [];
  if (jobIds.length > 0) await db.delete(jobsTable).where(inArray(jobsTable.id, jobIds));
  console.log(
    `\nCleaned up ${removed.length} article(s) of ${slugs.length} slug(s) this run created, and ` +
      `${jobIds.length} job(s). Ledger rows kept — that is the product of the run.` +
      (slugs.length < draws.length
        ? `  (${draws.length - slugs.length} draw(s) ran on articles this run did not create, ` +
          "and those are left alone.)"
        : ""),
  );
}

/* ------------------------------------------------------------------- main -- */

function currentMeta(databaseTarget: string, scenario: RunMeta["scenario"]): RunMeta {
  const git = (args: string[]): string =>
    execFileSync("git", args, { encoding: "utf-8" }).trim();
  let hierarchyEffort: string | null = null;
  try {
    /* Free, and it reads the real constant rather than restating it. An empty
       body is a legal argument: `budgetFor` only throws when the answer cannot
       fit one response. Guarded, because a signature change here must not stop
       a paid run — a missing effort is recoverable from `commit`. */
    hierarchyEffort = structureEffort();
  } catch {
    hierarchyEffort = null;
  }
  return {
    startedAt: new Date().toISOString(),
    commit: git(["rev-parse", "HEAD"]),
    /* **A dirty tree makes `commit` a half-truth**, and this run's numbers may
       have been produced by code that is in no commit at all. Said out loud
       rather than left for whoever compares two runs to wonder about. */
    gitDirty: git(["status", "--porcelain"]).length > 0,
    /* **Not a refusal.** Sol's alternative — "either refuse a dirty tree or
       record a patch digest" — and the digest is the one that works here: this
       checkout is shared by several agents, so it is essentially always dirty
       and a refusal would make the eval unrunnable rather than careful. Scoped
       to `src` and `evals`, which are the directories that decide what a call
       costs; a doc edit does not make two runs incomparable. */
    srcPatchSha256: patchDigest(git),
    store: STORE,
    databaseTarget,
    evalOwnerId: EVAL_OWNER_ID,
    environmentOwnerId: environmentOwnerId(),
    scenario,
    node: process.version,
    effort: {
      pipelineEnvOverride: process.env.SPIDERYARN_PIPELINE_EFFORT ?? null,
      hierarchy: hierarchyEffort,
      labels: "module-private in src/labels.ts — pinned by commit + srcPatchSha256",
      articleStages: Object.fromEntries(
        (Object.keys(STAGE_EFFORT) as (keyof typeof STAGE_EFFORT)[]).map((s) => [s, effortFor(s)]),
      ),
    },
  };
}

/**
 * Hierarchy's effort, read through the only exported door onto it.
 *
 * An empty body is a legal argument — `budgetFor` throws only when the answer
 * cannot fit one response — and this makes no call and costs nothing. The
 * alternative was writing `"medium"` down here, which is a second copy of a
 * constant that has already moved once and taken a whole analysis with it.
 */
function structureEffort(): string {
  return structureRequest([]).effort;
}

/** sha256 of the working-tree diff over the code that decides cost, or null. */
function patchDigest(git: (args: string[]) => string): string | null {
  try {
    const patch = git(["diff", "HEAD", "--", "src", "evals"]);
    return patch.length === 0 ? null : createHash("sha256").update(patch).digest("hex");
  } catch {
    return null;
  }
}

/**
 * **The eval owner exists in `auth.users`, and is not the environment's.**
 *
 * Two questions, and the second one is only useful because the first has an
 * answer a person can act on: `articles.owner_id` is a foreign key into
 * `auth.users`, so an unseeded eval owner surfaces as a constraint violation
 * from inside `enqueue` — which reads as a database bug and sends whoever hits
 * it to the schema, three layers from the missing row. The same mistake
 * `environmentOwnerId` documents at length.
 */
async function assertEvalOwnerReady(): Promise<void> {
  assertDistinctEvalOwner(EVAL_OWNER_ID, environmentOwnerId());
  const found = await getDb().execute(
    sql`select 1 from auth.users where id = ${EVAL_OWNER_ID}::uuid`,
  );
  if (found.rows.length > 0) return;
  throw new Error(
    `The eval owner ${EVAL_OWNER_ID} is not in auth.users on this database. ` +
      "Run `npm run db:seed-owner`, which creates it (scripts/seed-accounts.ts § SEEDED_ACCOUNTS). " +
      "Without the row every article this eval creates fails a foreign key from inside enqueue.",
  );
}

interface Args {
  fixtures: string[];
  repeat: number;
  /** `null` when the run never said, which `--against` refuses to survive. */
  steps: StepName[] | null;
  /**
   * Ingest once per fixture, then run each on-demand mode as its own job against
   * the **adopted** article. The alternative pays for a fresh ingest per mode —
   * ~$3.40 of scaffolding per mode on `long-html`.
   */
  allModes: boolean;
  /** Which modes `--all-modes` sweeps. `ALL_MODES` unless `--modes` named others. */
  modes: StepName[];
  /** Run against an article that already exists, by slug. */
  against: string | null;
  keep: boolean;
  preflight: boolean;
  /** Deliberately measure several modes in one job — a separate, labelled scenario. */
  batchedModes: boolean;
  /** Deliberately accept a required step whose whole bill is unknown. */
  allowUnpriced: boolean;
}

function required(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} needs a value`);
  return value;
}

function parseArgs(argv: readonly string[]): Args {
  /* Before the loop rather than as a case in it: `process.exit` inside a switch
     is a fallthrough to one linter and unreachable code to the typechecker, and
     listing the corpus is not really an argument to a run. */
  if (argv.includes("--list")) {
    for (const f of FIXTURES) console.log(`${f.name}  ${f.file}  (${f.words} words)`);
    process.exit(0);
  }
  const args: Args = {
    fixtures: [],
    repeat: 1,
    steps: null,
    allModes: false,
    modes: [...ALL_MODES],
    against: null,
    keep: false,
    preflight: false,
    batchedModes: false,
    allowUnpriced: false,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--fixture": {
        const name = required(argv[++i], "--fixture");
        fixtureByName(name);
        args.fixtures.push(name);
        break;
      }
      case "--repeat":
        args.repeat = Number(required(argv[++i], "--repeat"));
        if (!Number.isInteger(args.repeat) || args.repeat < 1) {
          throw new Error("--repeat needs a positive integer");
        }
        break;
      case "--steps":
        args.steps = parseStepList(argv[++i], "--steps");
        break;
      case "--all-modes":
        args.allModes = true;
        break;
      /* **`--modes` is how the sweep gets proved for free.** The eight are what
         a real run buys; naming a free step instead (`--modes blocks`, with an
         ingest that stopped at `extract`) drives the identical shape — one
         ingest, then adopted jobs, one run.json, one cleanup — without a model
         call. It is also how a sweep that stopped half way is finished off. */
      case "--modes":
        args.modes = parseStepList(argv[++i], "--modes");
        break;
      case "--against":
        args.against = required(argv[++i], "--against");
        break;
      case "--keep":
        args.keep = true;
        break;
      case "--preflight":
        args.preflight = true;
        break;
      case "--batched-modes":
        args.batchedModes = true;
        break;
      case "--allow-unpriced":
        args.allowUnpriced = true;
        break;
      default:
        throw new Error(`Unknown argument ${argv[i]}`);
    }
  }
  /* Checked before the default fixture is filled in, or "--against with a
     fixture" would fire on every --against run. */
  assertSweepArgs({
    allModes: args.allModes,
    against: args.against,
    repeat: args.repeat,
    fixtures: args.fixtures,
    steps: args.steps,
    batchedModes: args.batchedModes,
  });
  if (args.fixtures.length === 0 && args.against === null) args.fixtures.push("short-html");
  return args;
}

/**
 * **The three shapes a run can take**, in one place so `main` reads as setup,
 * this, and cleanup.
 *
 * `draw` is handed in rather than the pieces it needs, because the ordering and
 * the checkpointing belong to the run and not to the plan.
 */
async function runDraws(
  args: Args,
  chosen: readonly CostFixture[],
  bytes: ReadonlyMap<string, Uint8Array>,
  stepList: readonly StepName[],
  draw: (spec: DrawSpec) => Promise<Draw>,
): Promise<void> {
  if (args.against !== null) {
    /* **`--against` — one job on an article that already exists**, which is
       how the batched-mode scenario gets measured: `sharesArticleCache` paying
       off has never been priced, and it can only be priced on an article whose
       modes have never run. The `no-spend` finding is what turns "these modes
       were already generated and skipped on their `stepIsDone` stamp" into a
       stop rather than a run of zeroes. */
    const target: AdoptTarget = {
      slug: args.against,
      articleId: await articleIdFor(args.against),
    };
    /* **One on-demand mode is a per-mode draw, not a batched one**, whatever the
       run as a whole is called — and the difference is not cosmetic: only a
       `mode` draw is held to `checkColdDraw`, and a single mode against a
       kept article is exactly the case that check exists for.
       `assertOneOnDemandMode` has already refused a second mode unless
       `--batched-modes` was passed, so `named` is at most one long here. */
    const named = stepList.filter((s) => ALL_MODES.includes(s));
    const single = !args.batchedModes && named.length === 1 ? named[0] : undefined;
    await draw(
      single === undefined
        ? { phase: "batched", steps: stepList, target }
        : { phase: "mode", mode: single, fixture: null, target },
    );
  } else if (args.allModes) {
    /* **Ingest once, then one job per mode against the adopted article.**
       The obvious shape — a fresh slug per mode, which is what every other
       draw here does — pays for ingest eight times over, ~$3.40 of scaffolding
       per mode on `long-html`. See report.ts § `checkColdDraw` for why
       the cheaper shape is still a cold measurement, and for the check that
       says so rather than arguing it.

       **Not interleaved across fixtures**, unlike the repeats below: a mode
       job has to come after the ingest that gave it an article, so the run is
       a fixture at a time. */
    for (const fixture of chosen) {
      const ingest = await draw({
        phase: "ingest",
        fixture,
        bytes: bytes.get(fixture.name)!,
        steps: stepList,
        repeat: 1,
      });
      /* Read back rather than carried: `articleIdFor` is what `oneDraw` filled
         this from, and every mode job is checked against it.

         **There is deliberately no "stop if the ingest failed" guard here.** A
         failed ingest can be a *paid* failure and often is — a truncated
         hierarchy is billed in full and comes back with an `outcome: "ok"` row
         beside a failed step — so `no-spend` does not fire and this line is
         reached. That is the right behaviour rather than a hole: the failed
         ingest is recorded as a paid failure and kept out of every quoted figure
         (`headlineTotal`), and the mode draws that follow read the article's
         blocks rather than its hierarchy, so their numbers are unaffected. What
         a guard here would cost is the only way to drive this shape for free —
         a free step list has nothing in `mustPay`, so its ingest ends short of
         publishing and the adopted jobs still run, which is how the sweep was
         proved without spending. An ingest that failed before the article row
         exists stops at `assertAdoptable` on the first mode, which is the case
         that genuinely cannot continue. */
      const target: AdoptTarget = { slug: ingest.slug, articleId: ingest.articleId ?? null };
      for (const mode of args.modes) {
        await draw({ phase: "mode", mode, fixture, target });
      }
    }
  } else {
    /* **Interleaved** — fixture A r1, fixture B r1, fixture A r2, … — so a
       drift over the minutes of a run (a provider warming up, a rate limiter
       engaging) lands across every fixture's repeats rather than inside one
       fixture's. The same reason evals/hierarchy-structure/run.ts interleaves.
       This is the shape that measures hierarchy's observed variation. */
    for (let repeat = 1; repeat <= args.repeat; repeat++) {
      for (const fixture of chosen) {
        await draw({
          phase: "ingest",
          fixture,
          bytes: bytes.get(fixture.name)!,
          steps: stepList,
          repeat,
        });
      }
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseTarget = localTarget(STORE, process.env.DATABASE_URL);
  /* **Before anything else that could spend.** A job in one job is one cache
     group, so a step list holding two compatible modes measures the second one
     warm — and no amount of checking afterwards can un-warm it. */
  const stepList = args.steps ?? [...DEFAULT_INGEST_STEPS];
  if (!args.batchedModes) assertOneOnDemandMode(stepList);
  const meta = currentMeta(databaseTarget, args.batchedModes ? "batched-modes" : "per-mode");

  console.log(`Target: ${databaseTarget}`);
  console.log(`Store:  ${meta.store}   commit ${meta.commit.slice(0, 8)}${meta.gitDirty ? ` (tree dirty, src+evals patch ${meta.srcPatchSha256?.slice(0, 12) ?? "?"})` : ""}`);
  console.log(`Ledger: ${costStore.describe()}`);
  console.log(`Owner:  ${meta.evalOwnerId}   (environment owner ${meta.environmentOwnerId})`);
  console.log(
    `Effort: hierarchy=${meta.effort.hierarchy ?? "?"}  ` +
      `env override=${meta.effort.pipelineEnvOverride ?? "none"}`,
  );
  console.log(
    `Steps:  ${stepList.join(", ")}   scenario ${meta.scenario}` +
      (args.allModes ? `\nModes:  ${args.modes.join(", ")}  (one job each, adopted)` : "") +
      (args.against !== null ? `\nAgainst: ${args.against}  (an article that already exists)` : ""),
  );
  await assertEvalOwnerReady();
  /* Last, and before any money: the run's product is rows in this table, and on
     2026-09-02 a run spent $0.0333 into a ledger that could not hold it. */
  await assertLedgerUsable(() => costStore.forJob("spya-ledger-probe"));
  if (args.preflight) {
    console.log(
      "\n--preflight: the gates above are everything this run checks — local target, distinct " +
        "seeded eval owner, one on-demand mode, and a ledger that answers. It spends nothing and " +
        "proves nothing else about the pipeline; the free end-to-end proof is the dry pass in " +
        "evals/cost/feasibility.md.",
    );
    return;
  }

  /* Loaded once, so every repeat of a fixture measures identical bytes. */
  const chosen = args.fixtures.map(fixtureByName);
  const bytes = new Map<string, Uint8Array>();
  for (const f of chosen) {
    bytes.set(f.name, new Uint8Array(await readFile(path.join(import.meta.dirname, "..", "..", f.file))));
  }

  /* **Every fixture hashed before a single job exists.** Per-draw checking
     printed a warning after `enqueue` and carried on, so a three-fixture corpus
     would have paid for two articles before discovering the third had changed.
     GPT Sol, 2026-09-02, finding 1. */
  const stale = verifyFixtures(chosen.map((f) => ({ fixture: f, bytes: bytes.get(f.name)! })));
  if (stale.length > 0) {
    throw new Error(`Refusing to run — ${stale.length} stale fixture(s):\n  ${stale.join("\n  ")}`);
  }

  const runTag = Math.random().toString(36).slice(2, 10);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  /* **`runTag` in the directory name.** The stamp is to the second and several
     agents share this box, so two similar runs starting in one second would
     otherwise share a directory — and each would overwrite the other's cleanup
     manifest, which is the file that says what to delete. */
  const runDir = path.join(
    import.meta.dirname,
    "..",
    "results",
    "cost",
    `${stamp}-${runTag}-${args.against !== null ? `against-${args.against}` : args.fixtures.join("+")}${args.allModes ? "-all-modes" : ""}`,
  );
  await mkdir(runDir, { recursive: true });
  const runFile: RunFile = { meta, runTag, notes: STANDING_NOTES, draws: [] };
  /* **Written through a temporary file and renamed**, which is atomic on one
     filesystem. A checkpoint that overwrites in place can be interrupted
     half-written, and the file it truncates is the only record of which
     articles and jobs this run created. */
  const checkpoint = async (): Promise<void> => {
    const final = path.join(runDir, "run.json");
    const temp = `${final}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(runFile, null, 2)}\n`, "utf-8");
    await rename(temp, final);
  };
  await checkpoint();

  let order = 0;
  const draw = (spec: DrawSpec): Promise<Draw> =>
    oneDraw({
      spec,
      runTag,
      order: ++order,
      allowUnpriced: args.allowUnpriced,
      batchedModes: args.batchedModes,
      runFile,
      checkpoint,
    });

  try {
    await runDraws(args, chosen, bytes, stepList, draw);
  } finally {
    /* In a `finally`, so a run that died after three draws still reports the
       three it paid for — and still cleans up. A crashed run must not lose the
       runs that already cost money. */
    await checkpoint();
    if (args.keep) {
      console.log(
        `\n--keep: leaving ${runFile.draws.length} article(s)/job(s) behind. ` +
          `Their ids are in ${path.relative(process.cwd(), runDir)}/run.json.`,
      );
    } else {
      await cleanup(runFile.draws);
    }
    summarise(runFile);
    console.log(`\nWrote ${path.relative(process.cwd(), runDir)}/run.json`);
  }
}

/**
 * **The stage outcome, which is a different question from `gateway ok`.**
 *
 * A truncated hierarchy comes back with a perfectly ok ledger row beside it and
 * a failed *step*: the model returned, and what it returned did not fit. So the
 * outcome the variation summary counts is the job's, and the reason is the
 * failing step's own error rather than anything the gateway said.
 */
function outcomeOf(d: Draw): DrawOutcome {
  const failedStep = (d.steps ?? []).find((s) => s.status === "error" || s.status === "bug");
  const succeeded = d.jobStatus === "done" && failedStep === undefined;
  return {
    label: `${d.fixture ?? d.slug}${d.mode ? ` ${d.mode}` : ""}`,
    totalNanos: d.money ? moneyTotalNanos(d.money) : 0,
    succeeded,
    ...(succeeded
      ? {}
      : { failure: failedStep ? `${failedStep.name} ${failedStep.status}` : (d.jobStatus ?? "unknown") }),
  };
}

/**
 * **Per-fixture observed variation over the repeated ingest draws.**
 *
 * Only ingest draws, and only where there is more than one: a median over a
 * single draw is that draw printed twice, and it reads as evidence it is not.
 * report.ts § `observedVariation` for the two statistics deliberately absent.
 */
function printVariation(ingests: readonly Draw[]): void {
  const of = (f: string): Draw[] => ingests.filter((d) => (d.fixture ?? d.slug) === f);
  const repeated = [...new Set(ingests.map((d) => d.fixture ?? d.slug))].filter(
    (f) => of(f).length > 1,
  );
  if (repeated.length === 0) return;
  console.log("\nObserved variation, cold ingest draws");
  console.log("─".repeat(60));
  for (const f of repeated) console.log(formatVariation(f, observedVariation(of(f).map(outcomeOf))));
}

/**
 * **Per-mode costs, kept apart from the ingest they were adopted from — and
 * from the draws that were billed and produced nothing.**
 *
 * A mode whose response was billed and then failed parsing or validation has a
 * real bill and no artefact, and quoting it as "Ideas costs $X" is exactly the
 * plausible wrong number this eval exists to avoid. So the headline per-mode and
 * whole-article figures cover the draws that **succeeded**, and the paid
 * failures are listed underneath with their money — the same treatment
 * `observedVariation` gives the repeated draws, generalised rather than
 * reinvented. GPT Sol, 2026-09-03.
 *
 * The whole-article line adds it up once, here, so that a reader is not left to
 * do it and is not tempted to add a batched draw in as well.
 */
function printModes(modes: readonly Draw[], ingests: readonly Draw[]): void {
  if (modes.length === 0) return;
  console.log("\nPer mode (one job each, against the adopted article)");
  console.log("─".repeat(60));
  for (const d of modes) {
    const outcome = outcomeOf(d);
    console.log(
      `  ${(d.fixture ?? "").padEnd(12)} ${(d.mode ?? "").padEnd(9)}  ` +
        `${fmt(moneyTotalNanos(d.money!)).padStart(9)}  ${d.jobStatus}` +
        (outcome.succeeded ? "" : "   PAID FAILURE — spent, not a price for anything"),
    );
  }
  for (const f of [...new Set(modes.map((d) => d.fixture ?? d.slug))]) {
    const mine = modes.filter((d) => (d.fixture ?? d.slug) === f);
    const ingest = ingests.find((d) => (d.fixture ?? d.slug) === f);
    const modeTotal = headlineTotal(mine.map(outcomeOf));
    const ingestTotal = ingest ? headlineTotal([outcomeOf(ingest)]) : null;
    console.log(
      `  ${f}: ${modeTotal.succeeded} of ${modeTotal.draws} mode(s) generated, ` +
        `${fmt(modeTotal.nanos)}` +
        (ingestTotal ? `, ingest ${fmt(ingestTotal.nanos)}` : ""),
    );
    /* **The whole-article figure exists only when the whole article was
       generated.** Adding up the modes that worked and calling it "whole
       article" would quote a price for a set of artefacts nobody has. */
    if (ingestTotal) {
      console.log(
        modeTotal.complete && ingestTotal.complete
          ? `    whole article ${fmt(modeTotal.nanos + ingestTotal.nanos)}`
          : "    whole article: no figure — " +
            `${modeTotal.paidFailures.length + ingestTotal.paidFailures.length} part(s) were ` +
            "billed and produced nothing, so this article was never wholly generated. " +
            `Total paid, failures included: ${fmt(modeTotal.totalPaidNanos + ingestTotal.totalPaidNanos)}.`,
      );
    }
    for (const block of [formatPaidFailures(modeTotal), ingestTotal ? formatPaidFailures(ingestTotal) : ""]) {
      if (block) console.log(block);
    }
  }
}

function summarise(runFile: RunFile): void {
  const done = runFile.draws.filter((d) => d.money);
  if (done.length === 0) return;
  console.log("\nAll draws");
  console.log("─".repeat(60));
  for (const d of done) {
    console.log(
      `  ${(d.fixture ?? d.slug).padEnd(12)} ${(d.mode ?? d.phase).padEnd(9)} r${d.repeat}  ` +
        `${fmt(moneyTotalNanos(d.money!)).padStart(9)}  ${d.jobStatus}` +
        (d.money!.unpriced > 0 ? `  (${d.money!.unpriced} unpriced)` : "") +
        (d.adoption?.kind === "minted" && d.phase !== "ingest" ? "  MINTED" : "") +
        (d.findings?.some((f) => f.fatal) ? "  FATAL FINDINGS" : ""),
    );
  }

  const ingests = done.filter((d) => d.phase === "ingest");
  printVariation(ingests);
  printModes(done.filter((d) => d.phase === "mode"), ingests);

  const batched = done.filter((d) => d.phase === "batched");
  if (batched.length > 0) {
    console.log(
      "\nBatched-mode draws are a SEPARATE scenario and must not be added to the per-mode " +
        "numbers: modes sharing one job share a cached article prefix, so all but the first " +
        "read warm. That is what makes them worth measuring.",
    );
  }

  const fatal = done.flatMap((d) => d.findings ?? []).filter((f) => f.fatal);
  if (fatal.length > 0) {
    console.log(
      `\n${fatal.length} fatal finding(s). These numbers are not a cold measurement — ` +
        "read the findings above before quoting anything from this run.",
    );
  }
}

if (isMain(import.meta.url)) {
  /* The program's edge: credentials load here and nowhere deeper, and the
     ledger wraps the whole run so that anything the runner buys *outside* a job
     step is eval-scoped too. The steps' own calls get their scope from the
     overlay, not from here — `runStep` opens its own collector and nested
     collectors shadow.

     **`EVAL_OWNER_ID`, not `environmentOwnerId()`, and this line is the whole of
     the browser isolation.** `enqueue` and `advanceJobWith` both ask
     `currentOwnerId()`, so this is what decides whose jobs these are — and a dev
     tab drives every queued job of the owner it is signed in as
     (src/web/jobEngine.ts). `assertDistinctEvalOwner` checks the two ids differ;
     it cannot check that the *jobs* got the right one, and for a while they did
     not: the gate passed while every article was still created under the
     environment owner. Caught by running it and reading `articles.owner_id`,
     which is the only thing that could have caught it. */
  loadEnvLocal();
  /* **A refused run is a sentence, not a stack trace.** Every gate above throws
     an error whose message is the whole point — which database, which owner,
     which step list, or that the ledger cannot hold what this would buy — and a
     `StoreFailure` from Postgres arrives with forty lines of driver frames on
     top of it. The person reading is deciding what to do next, so the message
     goes last and alone. `cause` carries the original for anyone who wants it. */
  await withLedger("eval", () => runAsOwner(EVAL_OWNER_ID, main)).catch((err: unknown) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
