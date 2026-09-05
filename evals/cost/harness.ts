/**
 * The cost eval's three mechanisms, separated from the driving so they can be
 * unit-tested without a database, a network or a model — the same split
 * evals/hierarchy-structure/ makes between `model-arms.ts` and `run.ts`.
 *
 * All three are seams that already existed. **Nothing in `src/` changes for this
 * eval to work**, which was the coordination risk the feasibility stage existed
 * to size: evals/cost/feasibility.md.
 *
 * - **`evalRegistry`** overlays `scopeKind: "eval"` on everything a step buys.
 * - **`fixtureFetch`** replaces stage 1 with committed bytes, through the
 *   exported `writeRaw`, without weakening any SSRF guard.
 *
 * There were three. The third stopped `enqueue` racing the caller for the claim
 * with the *production* registry, and it is now `pump: false` on the request
 * itself — see § *the pump* below for what it was and why it went.
 *
 * Tested in tests/cost-eval.test.ts.
 */

import { createHash } from "node:crypto";
import { withSpendAttribution } from "../../src/ai-spend.js";
import { type FetchedDocument, writeRaw } from "../../src/fetch.js";
import type { StepRegistry } from "../../src/jobs.js";
import { type PipelineStep, STEP_ORDER, STEPS } from "../../src/pipeline.js";
import type { StepName } from "../../src/types.js";
import type { CostFixture } from "./fixtures.js";
import type { Finding } from "./report.js";

/* -------------------------------------------------- the local-target gate -- */

const LOCAL_HOSTS = ["127.0.0.1", "localhost", "::1", "[::1]"];

/**
 * **Refuse to run anywhere but a local database, before anything runs** — and
 * return the `Target:` line to print, with the password redacted.
 *
 * Several agents share this checkout and this database, and the ledger is the
 * product of the run. Three questions: is the store Postgres (the filesystem
 * ledger stopped being authoritative on 2026-09-02), is the database on this
 * machine, and does a `Target:` line get printed so whoever reads the output
 * knows which one it was. The last is not decoration —
 * docs/project/database.md § `DATABASE_URL=… npm run db:migrate` is a whole
 * section about a command reaching a database other than the one on its command
 * line, with a success message either way.
 *
 * Takes both values rather than reading them, so this can be exercised for
 * every answer instead of only for the one this machine happens to give.
 */
export function localTarget(store: string, url: string | undefined): string {
  if (store !== "postgres") {
    throw new Error(
      `This eval measures the Postgres pipeline and the store is "${store}". ` +
        "Run it as `npm run eval:cost`, which sets SPIDERYARN_STORE=postgres — the flag is " +
        "read once at module load (src/store/live.ts), so setting it inside the runner is too late.",
    );
  }
  if (!url) {
    throw new Error("DATABASE_URL is not set. `npm run db:start`, then it comes from .env.local.");
  }
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `Refusing to run against a non-local database (host "${host}"). This eval creates ` +
        "articles and jobs and spends money; the only place it may do that is a local Supabase.",
    );
  }
  return url.replace(/\/\/([^:@/]+):[^@/]*@/, "//$1:***@");
}

/* ------------------------------------------------------- the eval overlay -- */

/**
 * One step, with `scopeKind: "eval"` overlaid on everything it buys.
 *
 * `runStep` opens its own collector with a literal `scopeKind: "job_step"` and
 * nested collectors *shadow* rather than merge, so an eval-scoped `collectSpend`
 * wrapped round the queue records nothing at all. `withSpendAttribution`
 * re-enters the **same** box with a patched attribution, and `scopeKind` is read
 * at row-write time — so a call inside a wrapped `run` writes an `eval` row
 * while keeping the owner, slug, job id and step name `runStep` set.
 *
 * **The overlay covers calls made inside `step.run` and nothing else.** A call
 * made elsewhere in `runStep`'s collector — a postcondition, `session.commit` —
 * would still be `job_step`. Nothing on the ingest path buys anything there
 * today (embeddings are bought on the request path), and the scope-leak finding
 * in report.ts is what notices the day that changes.
 */
export function evalScoped<N extends StepName>(step: PipelineStep<N>): PipelineStep<N> {
  return {
    ...step,
    run: (ctx, store, checkpoints) =>
      withSpendAttribution({ scopeKind: "eval" }, () => step.run(ctx, store, checkpoints)),
  };
}

export function evalRegistry(steps: StepRegistry): StepRegistry {
  /* `Object.entries` loses the `{ [K in StepName]: PipelineStep<K> }` pairing —
     the mapped type is what keeps a step's name and its `run` signature
     together, and there is no way to say "the same K on both sides" through an
     entries round trip. The cast is over a registry built key by key from the
     one it was handed, so no key is invented or dropped, and the test asserts
     that every key survives. */
  return Object.fromEntries(
    Object.entries(steps).map(([name, step]) => [name, evalScoped(step as PipelineStep)]),
  ) as unknown as StepRegistry;
}

/* ---------------------------------------------------------- stage 1, held -- */

/**
 * Stage 1, replaced by committed bytes.
 *
 * It calls the same exported `writeRaw` production's fetch step calls, so the
 * bytes land in the same content-addressed `sources` bucket under the same key
 * and stage 2 onwards cannot tell where they came from — src/pipeline.ts says
 * as much about the upload half. The feasibility dry pass demonstrated it by
 * watching the real extractor come back with the fixture's own title.
 *
 * **No SSRF guard is weakened**, which is the whole reason this is a step in an
 * eval rather than a `file:`/`fixture:` scheme in `src/fetch.ts`: that would be
 * a guard bypass living in production code so that an eval can run.
 *
 * **Stage 1 is therefore not measured.** It costs no model call, so the money
 * is unaffected; what the report loses is real-world fetch latency, and it says
 * so rather than letting a reader assume the elapsed time includes it.
 */
export function fixtureFetch(
  fixture: CostFixture,
  bytes: Uint8Array,
  url: string,
): PipelineStep<"fetch"> {
  return {
    ...STEPS.fetch,
    async run(ctx) {
      const detail = `${Math.round(bytes.byteLength / 1024)} KB (fixture ${fixture.name})`;
      ctx.report(detail);
      const doc: FetchedDocument = {
        requestedUrl: url,
        url,
        chain: [url],
        status: 200,
        kind: fixture.kind,
        contentType: fixture.contentType,
        bytes,
        /* HTML is stored as the decoded string and a PDF as its bytes —
           `storedDocumentBytes` in src/fetch.ts is the one place that decides,
           and this only has to hand it the right shape. */
        text: fixture.kind === "pdf" ? null : new TextDecoder("utf-8").decode(bytes),
        encoding: fixture.kind === "pdf" ? null : "utf-8",
        fetchedAt: new Date().toISOString(),
      };
      return { parts: { raw: await writeRaw(doc) }, detail };
    },
  };
}

/* ------------------------------------------------------------- the pump -- */

/**
 * **The trap that would have produced a corpus of network-fetched,
 * Product-attributed articles**, and it is not in the plan.
 *
 * `enqueue` used to end with `pump(job.id, owner)` unconditionally, `pump` calls
 * `advanceJob`, and `advanceJob` is `advanceJobWith(id, PRODUCTION)` — the
 * production registry. It starts synchronously inside `enqueue`, so it wins the
 * claim before the caller can, and the job then runs production's `fetch` (which
 * goes to the network) with no eval overlay on anything. The feasibility dry
 * pass hit this on its first run: the fixture step never executed and the job
 * died in production's `requireUrl`, which is the *loud* version — a fixture
 * whose URL happens to resolve would have run silently and wrongly.
 *
 * **The defence is `pump: false` on the request** (src/jobs.ts §
 * `EnqueueRequest`), and there is no helper left here to import. Until
 * 2026-09-05 it was `withoutTheInProcessPump`, which set `VERCEL=1` across the
 * `enqueue` call because `pump` returns immediately when it is set — a process
 * on this box claiming to be on Vercel in order to get one `if` to go the other
 * way, in the *third* place that trick had been copied to. Stage E of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * gave `enqueue` the honest parameter and deleted all three.
 */

/* ------------------------------------------------------ reading a job back -- */

/** `19 blocks, 19 new ids (0 kept)` → 19. Null when the step did not run or said something else. */
export function blocksFromDetail(detail: string | undefined): number | null {
  const m = detail?.match(/^(\d+) blocks\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Every step that buys a model call over the whole article.
 *
 * **`labels` is not on it and must not be**, because there is no `labels` step:
 * the nav labels fan out inside `hierarchy` (src/pipeline.ts § STEP_ORDER), so
 * their rows carry `stepName: "hierarchy"`.
 */
const PAYING_STEPS: readonly StepName[] = [
  "hierarchy",
  "arc",
  "tweets",
  "glossary",
  "quotes",
  "ideas",
  "timeline",
  "quiz",
  "sketch",
];

/**
 * Which steps **must** have paid for this run to be a cold measurement.
 *
 * `extract` pays for a PDF and nothing else — a model reads the pages
 * (src/pdf-read.ts) where Readability is free — so a $0 `extract` on an HTML
 * article is correct rather than a failure, and this is a function of the
 * fixture rather than one list.
 *
 * **Intersected with the steps the job was actually asked for**, or a run
 * deliberately stopping short of `hierarchy` — a free smoke pass, or a later
 * per-mode run — would report a fatal no-spend for a step that never ran.
 */
export function mustPayFor(fixture: CostFixture | null, steps: readonly StepName[]): string[] {
  const paying: readonly string[] =
    fixture?.kind === "pdf" ? ["extract", ...PAYING_STEPS] : PAYING_STEPS;
  return steps.filter((s) => paying.includes(s));
}

/**
 * **Which `AiJob`s must appear in the ledger**, which is a different question
 * from which steps must pay and catches something the step check cannot.
 *
 * `hierarchy` is one step and *two* jobs — the structure call and the label
 * fan-out — and both carry `stepName: "hierarchy"`. So a draw where every label
 * batch was skipped or lost still shows a priced `hierarchy` step and reports a
 * plausible number for an article whose labels were never bought. Requiring
 * `job: "labels"` is the only check that sees it. GPT Sol, 2026-09-02.
 *
 * PDF extraction is `job: "pdf"` (`NonTaskAiJob` in src/models.ts), not a
 * `Task`, which is why it cannot be derived from the step name alone either.
 * Every other paying step is a `Task` of the same name.
 */
export function requiredAiJobsFor(
  /**
   * `null` for an `--against` draw, which names an article by slug and never
   * learns what kind of document is under it. The only thing that hangs on the
   * kind is whether `extract` must pay, and an `--against` run does not run
   * `extract` — it runs modes on an article that was extracted long ago.
   */
  fixture: CostFixture | null,
  steps: readonly StepName[],
): string[] {
  const jobs: string[] = [];
  for (const step of steps) {
    if (step === "extract") {
      if (fixture?.kind === "pdf") jobs.push("pdf");
      continue;
    }
    if (step === "hierarchy") {
      jobs.push("hierarchy", "labels");
      continue;
    }
    if (PAYING_STEPS.includes(step)) jobs.push(step);
  }
  return jobs;
}

/**
 * **Which pipeline step an `AiJob`'s calls are made inside**, wherever the two
 * names differ.
 *
 * Only two do, and both are the same trick: the nav labels fan out inside
 * `hierarchy` (there is no `labels` step), and PDF transcription is `job: "pdf"`
 * inside `extract`. Every other paying step buys an `AiJob` of its own name, so
 * the map holds the exceptions and the lookup falls through to the name itself.
 *
 * The cold check needs it to answer a question the ledger cannot: an `AiJob`
 * with no rows either never ran or lost them, and the only way to tell is
 * whether the *step* it would have run inside got that far. See
 * `ColdExpectation.stepStatuses` in report.ts.
 */
export const AI_JOB_STEP: Readonly<Record<string, string>> = {
  labels: "hierarchy",
  pdf: "extract",
};

/**
 * **The gate that turns findings into a stop**, so the rule is a function a test
 * can hold rather than a filter buried in the runner.
 *
 * A fatal finding means the number this draw produced is not the number it
 * claims to be, and the next draw would spend money measuring the same wrong
 * thing — so `oneDraw` throws on a non-empty answer here. What must *not* reach
 * it is an absence the job's own status explains: a draw whose `hierarchy`
 * failed before its label fan-out is a paid failure to be counted, and on
 * 2026-09-03 it stopped the sweep that existed to count it
 * (evals/results/cost/2026-09-03-04-59-07-1bpfhts0-long-html).
 */
export function drawMustStop(findings: readonly Finding[]): Finding[] {
  return findings.filter((f) => f.fatal);
}

/* ------------------------------------------------------------- the guards -- */

/**
 * **Hash every fixture before any job exists**, and hand back what is stale.
 *
 * Per-draw checking was the first version and it is not enough: it prints a
 * warning *after* `enqueue`, and a corpus of three would have paid for the first
 * two articles before discovering the third had changed. The manifest contract
 * is "re-hashed and refused", and refusing has to happen before the money can
 * move. GPT Sol, 2026-09-02, finding 1.
 */
export function verifyFixtures(
  loaded: readonly { fixture: CostFixture; bytes: Uint8Array }[],
): string[] {
  const stale: string[] = [];
  for (const { fixture, bytes } of loaded) {
    const measured = createHash("sha256").update(bytes).digest("hex");
    if (measured === fixture.sha256) continue;
    stale.push(
      `${fixture.file} hashes ${measured.slice(0, 12)}…, the manifest says ` +
        `${fixture.sha256.slice(0, 12)}… — the bytes changed since they were measured. ` +
        "Update evals/cost/fixtures.ts deliberately, re-measuring words and blocks with it.",
    );
  }
  return stale;
}

/**
 * **Refuse to run as an owner a browser might be signed in as.**
 *
 * `src/web/jobEngine.ts` § `apply` drives every queued or running job it can
 * list, on the first list as well as later ones, and `GET /api/jobs` lists by
 * owner. So a dev tab left open on this box will call `/advance` on an eval job
 * that shares its owner — and if it wins a claim handoff part-way through a long
 * job it runs the remaining paid step through the **production** registry, with
 * no eval overlay, putting `job_step` rows into `npm run cost`'s Product bucket.
 * The scope-leak check finds that only after the money has been spent.
 *
 * `VERCEL=1` round `enqueue` stops *this process's* pump and says nothing at all
 * to a browser. A distinct owner is the isolation. There are several dev servers
 * open on this box, so this is live rather than theoretical. GPT Sol,
 * 2026-09-02, finding 3.
 */
export function assertDistinctEvalOwner(evalOwner: string, environmentOwner: string): void {
  if (evalOwner !== environmentOwner) return;
  throw new Error(
    `Refusing to run: the eval and the environment share the same owner (${evalOwner}). ` +
      "Any dev tab signed in as that owner drives its queued jobs through the production " +
      "step registry, which bills them to Product. Seed the dedicated eval account with " +
      "`npm run db:seed-owner` (src/owner.ts § EVAL_OWNER_ID), or unset SPIDERYARN_OWNER_ID " +
      "if it has been pointed at the eval owner.",
  );
}

/**
 * The modes a reader presses a button for — everything paid that is not ingest.
 *
 * **Exported as `ALL_MODES` because it is what `--all-modes` buys**, and the
 * stage's whole bill is the length of this list times a per-mode price. A ninth
 * mode arriving and being swept in silently would change what a run costs
 * without anybody choosing it, which is why tests/cost-eval.test.ts writes the
 * eight out longhand rather than deriving them from here.
 */
const ON_DEMAND_MODES: readonly StepName[] = PAYING_STEPS.filter((s) => s !== "hierarchy");
export const ALL_MODES = ON_DEMAND_MODES;

/**
 * `--steps fetch,extract,blocks,hierarchy` or `--modes arc,ideas` — a comma-separated
 * list, checked against `STEP_ORDER` so a typo is a message rather than a job
 * that quietly runs the default five and a bill nobody expected.
 *
 * `flag` is in the message because the two callers are different mistakes: a
 * misspelled step and a misspelled mode read identically otherwise.
 */
export function parseStepList(spec: string | undefined, flag: string): StepName[] {
  const named = (spec ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (named.length === 0) throw new Error(`${flag} needs a comma-separated list of step names`);
  const unknown = named.filter((s) => !STEP_ORDER.includes(s as StepName));
  if (unknown.length > 0) {
    throw new Error(`${flag}: unknown step(s) ${unknown.join(", ")}. Have: ${STEP_ORDER.join(", ")}`);
  }
  return named as StepName[];
}

/**
 * **The argument combinations that would spend money measuring something other
 * than what they claim**, refused before the first job exists.
 *
 * Each one is a real mistake rather than a tidiness rule, and the message says
 * which. They are here rather than in the parser so they can be exercised for
 * every answer, including the ones this machine does not happen to produce.
 */
export function assertSweepArgs(args: {
  allModes: boolean;
  against: string | null;
  repeat: number;
  fixtures: readonly string[];
  /** `null` when the run never said, which is the case `--against` cannot survive. */
  steps: readonly StepName[] | null;
  /** `--batched-modes`, which turns off the cold check — and must not do so silently. */
  batchedModes: boolean;
}): void {
  if (args.allModes && args.batchedModes) {
    throw new Error(
      "--all-modes and --batched-modes contradict each other: --all-modes runs one job per mode " +
        "whatever else is passed, so nothing is batched — but --batched-modes is what tells the " +
        "report a warm first call is expected, and it would turn the cold check off across the " +
        "whole sweep. One stray flag, eight per-mode numbers with nothing checking they are " +
        "cold. Pass one or the other.",
    );
  }
  if (args.allModes && args.repeat > 1) {
    throw new Error(
      "--all-modes runs each mode once against the article it just ingested, so --repeat > 1 " +
        "would find every mode already generated: a mode with a `stepIsDone` stamp skips " +
        "(src/pipeline.ts), the run records $0 for it, and the fatal no-spend finding stops " +
        "the sweep — after it has paid for a second ingest. Run it again with a fresh run tag " +
        "instead, or use --repeat on an ingest-only step list to measure hierarchy variation.",
    );
  }
  if (args.allModes && args.against !== null) {
    throw new Error(
      "--all-modes and --against name two different articles: the first ingests a fresh one " +
        "under a run-tagged slug, the second runs on one that already exists. Pick one.",
    );
  }
  if (args.against !== null && args.steps === null) {
    throw new Error(
      "--against needs --steps. The default is the five ingest steps and stage 1 is a fixture " +
        "read, so an --against run that did not say what to run would try to re-fetch an " +
        "article it holds no bytes for.",
    );
  }
  if (args.against !== null && args.fixtures.length > 0) {
    throw new Error(
      "--against runs on a slug, not on bytes, so --fixture has nothing to do there. The " +
        "fixture manifest is what an ingest draw is held constant by; an article that already " +
        "exists was ingested from whatever it was ingested from.",
    );
  }
}

/**
 * **A mode draw with no article to adopt is a cold ingest waiting to happen**,
 * and this is the pre-spend half of `checkAdoption` in report.ts.
 *
 * A job carrying neither a URL nor an upload is `{kind: "adopted"}` in `enqueue`
 * — but adoption of a slug nobody has is *allowed through* deliberately
 * (src/jobs.ts explains why: the slug carries a random short id, so no other
 * reader can come to want it). The job then runs, `lockOrCreateArticle` creates
 * the row on publish, and what the runner measures is a fresh empty article
 * wearing a mode's name.
 *
 * So the runner asks the database whether the article is there **before**
 * advancing the job. The post-job check in report.ts stays: this one cannot see
 * an article that is swapped underneath a running job.
 */
export function assertAdoptable(slug: string, articleId: string | null): void {
  if (articleId !== null) return;
  throw new Error(
    `There is no article "${slug}" on this database, so this job has nothing to adopt: ` +
      "`enqueue` lets a slug nobody holds through, the job would create the article on publish, " +
      "and the number it produced would be a cold ingest filed under a mode's name. " +
      "Ingest it first (--all-modes does), or name a slug an earlier --keep run left behind.",
  );
}

/**
 * **One on-demand mode per job, or the number is not the cost of that mode.**
 *
 * `sharesArticleCache` deliberately marks the article prefix when a later step
 * in the *same job* renders byte-identical bytes at the same effort
 * (src/pipeline.ts) — so `{steps: ["glossary","quotes"]}` has glossary pay the
 * 1.25× cache-write premium and quotes read it warm. `checkCold` only asks
 * whether spend is positive, so both pass, and the pair is then quoted as the
 * cost of pressing each mode separately. It is not: a reader presses them
 * minutes apart, in two jobs that share nothing.
 *
 * The ingest steps are unaffected — `sharesArticleCache` returns false for
 * anything that is not an `ArticleStage`, and `hierarchy` is not one, so an
 * ordinary ingest marks nothing and writes no cache entry for a later draw of
 * the same fixture to read. Checked in the code rather than assumed.
 *
 * A batched-mode job is a legitimate *separate, labelled* scenario — it is what
 * a reader who presses two buttons in one job actually pays — but it must not be
 * aggregated as per-mode cost, so asking for one is a deliberate flag rather
 * than something a step list can slip into. GPT Sol, 2026-09-02, finding 5.
 */
export function assertOneOnDemandMode(steps: readonly StepName[]): void {
  const modes = steps.filter((s) => ON_DEMAND_MODES.includes(s));
  if (modes.length <= 1) return;
  throw new Error(
    `Refusing to run ${modes.length} on-demand modes in one job (${modes.join(", ")}): ` +
      "compatible modes share a cached article prefix inside one job, so the second one reads " +
      "warm and its number is not what pressing that mode costs. Run one on-demand mode per " +
      "job, or pass --batched-modes to record this as a separate, labelled scenario.",
  );
}

/**
 * **Ask the ledger a question before spending anything, because the run's whole
 * product is rows in it.**
 *
 * Written after the first paid run, which cost $0.0333 and kept **neither row**:
 * `spideryarn.ai_calls` was missing columns `src/db/schema.ts` had already
 * declared, so every insert failed `42703` and was swallowed into a warning, and
 * the read afterwards threw an uncaught `StoreFailure` over the top of the
 * cleanup. Every gate this file had passed — local target, distinct owner, one
 * mode — because none of them asked the one question that mattered.
 *
 * A **read** probe is enough for that class: the failing selects and the failing
 * inserts name the same table, so a select that mentions every column fails
 * exactly when an insert would. It cannot prove a write will land — a constraint
 * violation or a full disk would still get through — which is why the
 * calls-made-against-rows-kept reconciliation stays. This is the cheap gate; that
 * is the expensive one.
 *
 * @param probe a read against the ledger — `costStore.forJob` of an id that
 *   matches nothing. Injected rather than imported so the failure can be tested
 *   without a database.
 */
export async function assertLedgerUsable(probe: () => Promise<unknown>): Promise<void> {
  try {
    await probe();
  } catch (err) {
    throw new Error(
      "The ledger cannot be read, so this run would spend money and record nothing: " +
        `${err instanceof Error ? err.message : String(err)}\n` +
        "  Usually the database is behind the code — `npm run db:migrate`, and read its output " +
        "rather than its exit line. See docs/project/database.md § A watermark is not a ledger.",
      { cause: err },
    );
  }
}
