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
 * - **`withoutTheInProcessPump`** stops `enqueue` racing the caller for the
 *   claim with the *production* registry.
 *
 * Tested in tests/cost-eval.test.ts.
 */

import { createHash } from "node:crypto";
import { withSpendAttribution } from "../../src/ai-spend.js";
import { type FetchedDocument, writeRaw } from "../../src/fetch.js";
import type { StepRegistry } from "../../src/jobs.js";
import { type PipelineStep, STEPS } from "../../src/pipeline.js";
import type { StepName } from "../../src/types.js";
import type { CostFixture } from "./fixtures.js";

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
 * `enqueue` ends with `pump(job.id, owner)`, `pump` calls `advanceJob`, and
 * `advanceJob` is `advanceJobWith(id, PRODUCTION)` — the production registry. It
 * starts synchronously inside `enqueue`, so it wins the claim before the caller
 * can, and the job then runs production's `fetch` (which goes to the network)
 * with no eval overlay on anything. The feasibility dry pass hit this on its
 * first run: the fixture step never executed and the job died in production's
 * `requireUrl`, which is the *loud* version — a fixture whose URL happens to
 * resolve would have run silently and wrongly.
 *
 * `pump` returns immediately when `VERCEL` is set, and that is the existing
 * idiom: tests/claim-session-postgres.test.ts sets it round `enqueue` for
 * exactly this, and its comment says the variable is there "only to stop
 * `enqueue`'s pump". Across the one call and nothing else, so the steps
 * themselves run with the ordinary environment.
 */
export async function withoutTheInProcessPump<T>(fn: () => Promise<T>): Promise<T> {
  const before = process.env.VERCEL;
  process.env.VERCEL = "1";
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = before;
  }
}

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
export function mustPayFor(fixture: CostFixture, steps: readonly StepName[]): string[] {
  const paying: readonly string[] =
    fixture.kind === "pdf" ? ["extract", ...PAYING_STEPS] : PAYING_STEPS;
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
export function requiredAiJobsFor(fixture: CostFixture, steps: readonly StepName[]): string[] {
  const jobs: string[] = [];
  for (const step of steps) {
    if (step === "extract") {
      if (fixture.kind === "pdf") jobs.push("pdf");
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

/** The modes a reader presses a button for — everything paid that is not ingest. */
const ON_DEMAND_MODES: readonly StepName[] = PAYING_STEPS.filter((s) => s !== "hierarchy");

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
