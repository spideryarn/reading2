/**
 * Eval — **what does one article cost?**
 *
 *   npm run eval:cost -- --fixture short-html
 *   npm run eval:cost -- --fixture long-html --fixture pdf --repeat 3
 *   npm run eval:cost -- --list                               (the corpus)
 *   npm run eval:cost -- --preflight                          (the gate only; spends nothing)
 *   npm run eval:cost -- --steps fetch,extract,blocks         (free: stops before the paid step)
 *   npm run eval:cost -- --steps fetch,extract,blocks,hierarchy,arc --keep
 *
 * `--steps` names the steps the job runs, so a mode step has to be named after
 * the ingest steps it depends on — a fresh slug has no blocks for `arc` to read.
 * `--keep` leaves the article and job behind for inspection instead of deleting
 * them; the ids are in the run's `run.json` either way. `--batched-modes` and
 * `--allow-unpriced` each disable one refusal below, deliberately, and both are
 * recorded in the result.
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
import { type AdvanceParts, advanceJobWith, claimSession, enqueue } from "../../src/jobs.js";
import { effortFor, STAGE_EFFORT } from "../../src/models.js";
import { environmentOwnerId, EVAL_OWNER_ID, runAsOwner } from "../../src/owner.js";
import { DEFAULT_INGEST_STEPS, STEP_ORDER, STEPS } from "../../src/pipeline.js";
import { costStore } from "../../src/store/ai-calls.js";
import { STORE } from "../../src/store/live.js";
import type { Job, StepName } from "../../src/types.js";
import { type CostFixture, FIXTURES, fixtureByName } from "./fixtures.js";
import {
  assertDistinctEvalOwner,
  assertOneOnDemandMode,
  blocksFromDetail,
  evalRegistry,
  fixtureFetch,
  localTarget,
  mustPayFor,
  requiredAiJobsFor,
  verifyFixtures,
  withoutTheInProcessPump,
} from "./harness.js";
import {
  aggregateByAiJob,
  aggregateByStep,
  checkCold,
  type Finding,
  formatFindings,
  formatStepTable,
  jobWallClockMs,
  type Money,
  moneyTotalNanos,
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

/** One independent cold draw: one fixture, one fresh article, one job. */
interface Draw {
  fixture: string;
  fixtureFile: string;
  /** sha256 of the bytes **this run read**, beside what the manifest claims. */
  fixtureSha256: { measured: string; manifest: string; matches: boolean };
  fixtureBytes: number;
  /** 1-based, and where in the whole run's order this draw sat. */
  repeat: number;
  order: number;
  slug: string;
  url: string;
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
  "`observedSpend` is what each step's own collector saw, from AdvanceParts.onStepSpend. Its " +
    "`calls` is what the ledger is reconciled against. Its `writeFailures` is a LOWER BOUND: " +
    "collectSpend calls onDone before draining its writes, so a write that rejects late is not " +
    "counted there — which is exactly why the check is calls-made against rows-kept.",
];

/* ---------------------------------------------------------------- driving -- */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface DrawRequest {
  fixture: CostFixture;
  bytes: Uint8Array;
  runTag: string;
  /** Which repeat this is (1-based) and where in the whole run's order it sat. */
  repeat: number;
  order: number;
  /** The steps the job runs, `DEFAULT_INGEST_STEPS` unless `--steps` named others. */
  stepNames: readonly StepName[];
  /** Accept a required step whose whole bill is unknown, as a note rather than a stop. */
  allowUnpriced: boolean;
  runFile: RunFile;
  checkpoint: () => Promise<void>;
}

async function oneDraw(req: DrawRequest): Promise<Draw> {
  const { fixture, bytes, runTag, repeat, order, stepNames, runFile, checkpoint } = req;
  /* Hashed again here so the record says what *this draw* read, but the run has
     already refused to start if any fixture was stale — `verifyFixtures` runs
     over the whole corpus before a single job exists, because a warning printed
     after `enqueue` lets two articles be paid for before the third is checked. */
  const measured = createHash("sha256").update(bytes).digest("hex");
  /* **Run-tagged URL as well as slug.** `enqueue` routes through `freeSlug`,
     which *adopts* an existing article when the URL matches — so a second draw
     on a repeated URL would silently measure a warm re-run of the first.
     evals/cost/feasibility.md § the rest of the checklist. */
  const slug = `evalcost-${runTag}-${fixture.name}-${repeat}`;
  const url = `https://cost-eval.invalid/${runTag}/${fixture.name}-${repeat}`;

  const steps = evalRegistry({ ...STEPS, fetch: fixtureFetch(fixture, bytes, url) });

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

  let job: Job = await withoutTheInProcessPump(() =>
    enqueue({ slug, url, steps: [...stepNames] }),
  );

  /* Recorded **before** the job runs: a crash from here on leaves a cleanup
     manifest rather than an orphan article nobody can name. */
  const draw: Draw = {
    fixture: fixture.name,
    fixtureFile: fixture.file,
    fixtureSha256: { measured, manifest: fixture.sha256, matches: measured === fixture.sha256 },
    fixtureBytes: bytes.byteLength,
    repeat,
    order,
    slug: job.slug,
    url,
    jobId: job.id,
  };
  runFile.draws.push(draw);
  await checkpoint();

  console.log(`\n${job.slug}  [${fixture.name} r${repeat}]  job ${job.id}`);
  console.log("─".repeat(60));
  if (!draw.fixtureSha256.matches) {
    console.log(
      `  STALE FIXTURE  ${fixture.file} hashes ${measured.slice(0, 12)}…, the manifest says ` +
        `${fixture.sha256.slice(0, 12)}… — update evals/cost/fixtures.ts deliberately`,
    );
  }

  const startedAt = Date.now();
  for (;;) {
    if (Date.now() - startedAt > DRAW_TIMEOUT_MS) {
      throw new Error(`${job.slug}: still not done after ${DRAW_TIMEOUT_MS / 60_000} minutes`);
    }
    /* **An outer attribution round the advance, and it is not the same thing as
       the per-step overlay.** `collectSpend(run)` closes before `session.commit`
       (src/jobs.ts), so a paid call added to `commit` or to a postcondition
       tomorrow would fall through to *this* runner's outer eval collector —
       which is eval-scoped, so the scope check would not fire, but which carries
       no job id and no article, so `costStore.forJob` would never see the money
       either. It would simply be missing. Naming the job and the slug here means
       such a call lands somewhere `forJob` can find it. GPT Sol, 2026-09-02.
       (There is no such purchase today; I checked, and so did Sol.) */
    const advanced = await withSpendAttribution(
      { jobId: job.id, articleSlug: job.slug, ownerId: EVAL_OWNER_ID },
      () => advanceJobWith(job.id, { session: claimSession, steps, onStepSpend }),
    );
    if (!advanced) throw new Error(`${job.slug}: job ${job.id} vanished mid-run`);
    job = advanced.job;
    if (advanced.done) break;
    /* `busy` means somebody else holds the single running slot — another agent's
       dev server, most likely, since this checkout is shared. Back off and ask
       again, exactly as `pump` does; exiting on `busy` is not a driver. */
    if (advanced.busy) await sleep(BUSY_BACKOFF_MS);
  }
  draw.elapsedMs = Date.now() - startedAt;
  draw.jobStatus = job.status;
  if (job.error !== undefined) draw.jobError = job.error;
  draw.steps = job.steps.map((s) => ({
    name: s.name,
    status: s.status,
    ...(s.detail !== undefined ? { detail: s.detail } : {}),
    ...(s.error !== undefined ? { error: s.error } : {}),
  }));
  const observedBlocks = blocksFromDetail(job.steps.find((s) => s.name === "blocks")?.detail);
  draw.blocks = {
    observed: observedBlocks,
    manifest: fixture.blocks,
    matches:
      observedBlocks === null || fixture.blocks === null ? null : observedBlocks === fixture.blocks,
  };
  draw.gistableBlocks = fixture.gistableBlocks;

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
    ...(req.allowUnpriced ? { allowUnpriced: true } : {}),
  });
  draw.articleId = await articleIdFor(job.slug);
  await checkpoint();

  printDraw(draw);

  /* **A fatal finding stops the run, it does not decorate it.** Both kinds mean
     the same thing — the next draw will spend money and measure something other
     than what it claims — and a leak in particular is money landing in
     `npm run cost`'s Product bucket, one draw at a time. The `finally` in
     `main` still checkpoints, cleans up and prints the draws already paid for,
     so stopping loses nothing. evals/cost/feasibility.md § the one residual
     risk asks for exactly this refusal. */
  const fatal = draw.findings.filter((f) => f.fatal);
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
  const slugs = draws.map((d) => d.slug);
  const jobIds = draws.map((d) => d.jobId);
  const db = getDb();
  const removed =
    slugs.length > 0
      ? await db.delete(articles).where(inArray(articles.slug, slugs)).returning({ id: articles.id })
      : [];
  if (jobIds.length > 0) await db.delete(jobsTable).where(inArray(jobsTable.id, jobIds));
  console.log(
    `\nCleaned up ${removed.length} article(s) of ${slugs.length} slug(s) and ` +
      `${jobIds.length} job(s). Ledger rows kept — that is the product of the run.`,
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
  steps: StepName[];
  keep: boolean;
  preflight: boolean;
  /** Deliberately measure several modes in one job — a separate, labelled scenario. */
  batchedModes: boolean;
  /** Deliberately accept a required step whose whole bill is unknown. */
  allowUnpriced: boolean;
}

/**
 * `--steps arc` or `--steps fetch,extract,blocks` — named steps rather than the
 * ingest default. That is how the later stages run one mode at a time, and how
 * a free pass stops short of the first paid step.
 *
 * Checked against `STEP_ORDER` here, so a typo is a message rather than a job
 * that quietly runs the default five and a bill nobody expected.
 */
function parseSteps(spec: string | undefined): StepName[] {
  const named = (spec ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (named.length === 0) throw new Error("--steps needs a comma-separated list");
  const unknown = named.filter((s) => !STEP_ORDER.includes(s as StepName));
  if (unknown.length > 0) {
    throw new Error(`Unknown step(s) ${unknown.join(", ")}. Have: ${STEP_ORDER.join(", ")}`);
  }
  return named as StepName[];
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
    steps: [...DEFAULT_INGEST_STEPS],
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
        args.steps = parseSteps(argv[++i]);
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
  if (args.fixtures.length === 0) args.fixtures.push("short-html");
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseTarget = localTarget(STORE, process.env.DATABASE_URL);
  /* **Before anything else that could spend.** A job in one job is one cache
     group, so a step list holding two compatible modes measures the second one
     warm — and no amount of checking afterwards can un-warm it. */
  if (!args.batchedModes) assertOneOnDemandMode(args.steps);
  const meta = currentMeta(databaseTarget, args.batchedModes ? "batched-modes" : "per-mode");

  console.log(`Target: ${databaseTarget}`);
  console.log(`Store:  ${meta.store}   commit ${meta.commit.slice(0, 8)}${meta.gitDirty ? ` (tree dirty, src+evals patch ${meta.srcPatchSha256?.slice(0, 12) ?? "?"})` : ""}`);
  console.log(`Ledger: ${costStore.describe()}`);
  console.log(`Owner:  ${meta.evalOwnerId}   (environment owner ${meta.environmentOwnerId})`);
  console.log(
    `Effort: hierarchy=${meta.effort.hierarchy ?? "?"}  ` +
      `env override=${meta.effort.pipelineEnvOverride ?? "none"}`,
  );
  console.log(`Steps:  ${args.steps.join(", ")}   scenario ${meta.scenario}`);
  await assertEvalOwnerReady();
  if (args.preflight) {
    console.log(
      "\n--preflight: the gates above are everything this run checks — local target, distinct " +
        "seeded eval owner, one on-demand mode. It spends nothing and proves nothing about the " +
        "pipeline; the free end-to-end proof is the dry pass in evals/cost/feasibility.md.",
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
    `${stamp}-${runTag}-${args.fixtures.join("+")}`,
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

  /* **Interleaved** — fixture A r1, fixture B r1, fixture A r2, … — so a drift
     over the minutes of a run (a provider warming up, a rate limiter engaging)
     lands across every fixture's repeats rather than inside one fixture's. The
     same reason evals/hierarchy-structure/run.ts interleaves. */
  let order = 0;
  try {
    for (let repeat = 1; repeat <= args.repeat; repeat++) {
      for (const fixture of chosen) {
        await oneDraw({
          fixture,
          bytes: bytes.get(fixture.name)!,
          runTag,
          repeat,
          order: ++order,
          stepNames: args.steps,
          allowUnpriced: args.allowUnpriced,
          runFile,
          checkpoint,
        });
      }
    }
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

function summarise(runFile: RunFile): void {
  const done = runFile.draws.filter((d) => d.money);
  if (done.length === 0) return;
  console.log("\nAll draws");
  console.log("─".repeat(60));
  for (const d of done) {
    console.log(
      `  ${d.fixture.padEnd(12)} r${d.repeat}  ${fmt(moneyTotalNanos(d.money!)).padStart(9)}  ` +
        `${d.jobStatus}` +
        (d.money!.unpriced > 0 ? `  (${d.money!.unpriced} unpriced)` : "") +
        (d.findings?.some((f) => f.fatal) ? "  FATAL FINDINGS" : ""),
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
  await withLedger("eval", () => runAsOwner(EVAL_OWNER_ID, main));
}
