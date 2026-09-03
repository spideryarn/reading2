/**
 * The deterministic half of the cost eval — everything in `evals/cost/report.ts`
 * that turns ledger rows into a number or a verdict. No database, no network, no
 * model: the part that spends money is not a test.
 *
 * Same split as the hierarchy-structure eval (score.ts pinned here, run.ts not).
 *
 * Three of these exist because the *baseline* got them wrong first, and the
 * expectations are written as literals rather than derived by re-running the
 * arithmetic under test:
 *
 * - **BYOK totalling.** A naive sum over the money columns overstated the
 *   historical ledger by 84%. `totalMoney` must delegate to `totalRows`, and
 *   `naiveTotal` is here so the test can *show* the two disagreeing — a check
 *   that has been seen to fail rather than one that has only been seen to pass.
 * - **The wall clock.** Per step it is `max(finishedAt) − min(startedAt)`, never
 *   `sum(durationMs)`; concurrent label batches make the second one several
 *   times the first.
 * - **Unpriced rows are unknown, not zero.** A step whose every call reported no
 *   cost must not read as "this step cost nothing", which is what a cold
 *   assertion looking only at dollars would say.
 *
 * docs/plans/260902g-estimate-article-ingestion-and-mode-generation-costs.md,
 * evals/cost/feasibility.md.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AiCallRow, collectSpend, recordSpend, type SpendRecord } from "../src/ai-spend.js";
import { STEPS } from "../src/pipeline.js";
import type { PipelineStep } from "../src/pipeline.js";
import type { StepRegistry } from "../src/jobs.js";
import type { StepName } from "../src/types.js";
import { DEV_OWNER_ID, EVAL_OWNER_ID } from "../src/owner.js";
import { fixtureByName } from "../evals/cost/fixtures.js";
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
  evalScoped,
  localTarget,
  mustPayFor,
  parseStepList,
  requiredAiJobsFor,
  verifyFixtures,
  withoutTheInProcessPump,
} from "../evals/cost/harness.js";
import {
  aggregateByStep,
  cacheRatio,
  checkAdoption,
  checkCold,
  checkBatchedDraw,
  checkColdDraw,
  type DrawOutcome,
  formatFindings,
  formatPaidFailures,
  formatStepTable,
  formatVariation,
  headlineTotal,
  jobWallClockMs,
  naiveTotal,
  observedVariation,
  type RoundForRatio,
  roundCache,
  totalMoney,
} from "../evals/cost/report.js";

/** One ledger row, with every field a real `AiCallRow` carries. */
function row(over: Partial<AiCallRow> = {}): AiCallRow {
  return {
    id: "row-1",
    runId: "run-1",
    generationId: null,
    scopeKind: "eval",
    ownerId: "owner-1",
    articleSlug: "evalcost-x",
    jobId: "spya-job1",
    stepName: "hierarchy",
    wire: "messages",
    job: "hierarchy",
    requestedModel: "anthropic/claude-sonnet-5",
    answeredModel: "anthropic/claude-sonnet-5",
    upstream: "anthropic",
    credentialFingerprint: "abc123def456",
    startedAt: "2026-09-02T10:00:00.000Z",
    finishedAt: "2026-09-02T10:00:10.000Z",
    durationMs: 10_000,
    outcome: "ok",
    creditsUsedNanos: 1_000_000,
    byokUpstreamNanos: null,
    isByok: false,
    providerAccount: "openrouter",
    costSource: "provider",
    computedCostNanos: null,
    priceVersion: null,
    reportedInputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite5mTokens: null,
    cacheWrite1hTokens: null,
    reasoningTokens: 5,
    webSearches: null,
    serviceTier: "standard",
    inferenceGeo: null,
    realtimeSessionId: null,
    providerEventId: null,
    eventKind: null,
    providerStatus: null,
    inputTextTokens: null,
    inputAudioTokens: null,
    inputImageTokens: null,
    cachedTextTokens: null,
    cachedAudioTokens: null,
    outputTextTokens: null,
    outputAudioTokens: null,
    transcriptionSeconds: null,
    ...over,
  };
}

describe("totalMoney — BYOK-aware, and unpriced is unknown", () => {
  /* The four kinds of row the ledger holds, one of each. Deliberately including
     the shape that made the naive sum wrong: a chat-wire row written before the
     rename carried `upstream_inference_cost` equal to `cost`. */
  const mixed: AiCallRow[] = [
    /* Ordinary OpenRouter call: 1c. */
    row({ id: "a", creditsUsedNanos: 10_000_000, isByok: false, byokUpstreamNanos: null }),
    /* BYOK (a Luna PDF chunk): OpenRouter charged nothing, somebody else's key
       was billed 2c. */
    row({
      id: "b",
      stepName: "extract",
      creditsUsedNanos: 0,
      isByok: true,
      byokUpstreamNanos: 20_000_000,
    }),
    /* Straight to Anthropic: our own arithmetic, a third pocket. */
    row({
      id: "c",
      creditsUsedNanos: null,
      costSource: "computed",
      computedCostNanos: 30_000_000,
      providerAccount: "anthropic",
      isByok: null,
    }),
    /* Reported no money at all — unknown, not zero. */
    row({ id: "d", creditsUsedNanos: null, costSource: "none", isByok: false }),
  ];

  it("keeps the three pockets apart and counts the unpriced row", () => {
    expect(totalMoney(mixed)).toEqual({
      credits: 10_000_000,
      upstream: 20_000_000,
      computed: 30_000_000,
      unpriced: 1,
    });
  });

  it("disagrees with a naive sum over the money columns, which is the point", () => {
    /* The row that breaks it: non-BYOK with a legacy upstream figure equal to
       its credits. `totalRows` must not read `byokUpstreamNanos` off it. */
    const legacy = [
      row({ id: "e", creditsUsedNanos: 10_000_000, isByok: false, byokUpstreamNanos: 10_000_000 }),
    ];
    expect(totalMoney(legacy).credits).toBe(10_000_000);
    expect(totalMoney(legacy).upstream).toBe(0);
    expect(naiveTotal(legacy)).toBe(20_000_000);
  });

  it("says nothing is priced when nothing is, rather than saying it was free", () => {
    const nothing = [row({ creditsUsedNanos: null, costSource: "none" })];
    expect(totalMoney(nothing)).toEqual({ credits: 0, upstream: 0, computed: 0, unpriced: 1 });
  });
});

describe("aggregateByStep", () => {
  /* Two concurrent label batches inside one step run, plus a hierarchy call.
     The label batches overlap: 8s of wall clock, 14s of summed duration. */
  const rows: AiCallRow[] = [
    row({
      id: "h",
      stepName: "hierarchy",
      job: "hierarchy",
      runId: "run-h",
      startedAt: "2026-09-02T10:00:00.000Z",
      finishedAt: "2026-09-02T10:02:00.000Z",
      durationMs: 120_000,
      creditsUsedNanos: 40_000_000,
      reportedInputTokens: 9_000,
      outputTokens: 3_000,
      reasoningTokens: 1_200,
    }),
    row({
      id: "l1",
      stepName: "labels",
      job: "labels",
      runId: "run-l",
      startedAt: "2026-09-02T10:02:00.000Z",
      finishedAt: "2026-09-02T10:02:06.000Z",
      durationMs: 6_000,
      creditsUsedNanos: 5_000_000,
      reportedInputTokens: 1_000,
      outputTokens: 200,
      cacheReadTokens: 700,
      answeredModel: "anthropic/claude-sonnet-5",
    }),
    row({
      id: "l2",
      stepName: "labels",
      job: "labels",
      runId: "run-l",
      startedAt: "2026-09-02T10:02:00.000Z",
      finishedAt: "2026-09-02T10:02:08.000Z",
      durationMs: 8_000,
      creditsUsedNanos: 6_000_000,
      reportedInputTokens: 1_100,
      outputTokens: 250,
      cacheReadTokens: 700,
      answeredModel: "anthropic/claude-sonnet-5-20260900",
      upstream: "google-vertex",
    }),
  ];

  const steps = aggregateByStep(rows);

  it("groups by step, in first-call order", () => {
    expect(steps.map((s) => s.step)).toEqual(["hierarchy", "labels"]);
    expect(steps.map((s) => s.calls)).toEqual([1, 2]);
  });

  it("uses the wall-clock envelope, not the sum of durations", () => {
    const labels = steps[1]!;
    /* 10:02:00 → 10:02:08 is 8s; the durations add to 14s because the two
       batches ran at the same time. ai-gateway.md § the duration trap. */
    expect(labels.wallClockMs).toBe(8_000);
    expect(labels.summedDurationMs).toBe(14_000);
  });

  it("sums the token counters and keeps the distinct models and upstreams", () => {
    const labels = steps[1]!;
    expect(labels.tokens).toEqual({
      input: 2_100,
      output: 450,
      cacheRead: 1_400,
      cacheWrite: 0,
      reasoning: 10,
    });
    expect(labels.answeredModels).toEqual([
      "anthropic/claude-sonnet-5",
      "anthropic/claude-sonnet-5-20260900",
    ]);
    expect(labels.upstreams).toEqual(["anthropic", "google-vertex"]);
  });

  it("counts one collector run per step when the step ran once", () => {
    expect(steps.map((s) => s.runIds.length)).toEqual([1, 1]);
  });

  it("puts a row with no step name under its own heading rather than dropping it", () => {
    const orphan = aggregateByStep([row({ stepName: null })]);
    expect(orphan.map((s) => s.step)).toEqual(["(no step)"]);
  });
});

describe("jobWallClockMs", () => {
  it("is the envelope across every row, however the calls overlapped", () => {
    expect(
      jobWallClockMs([
        row({ startedAt: "2026-09-02T10:00:00.000Z", finishedAt: "2026-09-02T10:02:00.000Z" }),
        row({ startedAt: "2026-09-02T10:01:00.000Z", finishedAt: "2026-09-02T10:03:30.000Z" }),
      ]),
    ).toBe(210_000);
  });

  it("is null with no rows, rather than a zero that reads as an instant job", () => {
    expect(jobWallClockMs([])).toBeNull();
  });
});

describe("checkCold", () => {
  const paid = row({ stepName: "hierarchy", creditsUsedNanos: 40_000_000 });

  it("passes a run where every step that must pay did", () => {
    expect(checkCold([paid], { mustPay: ["hierarchy"] })).toEqual([]);
  });

  it("fails a step that was expected to pay and is missing entirely", () => {
    const findings = checkCold([paid], { mustPay: ["hierarchy", "labels"] });
    expect(findings.map((f) => f.kind)).toEqual(["no-spend"]);
    expect(findings[0]!.step).toBe("labels");
    expect(findings[0]!.fatal).toBe(true);
  });

  it("fails a cold step whose calls all cost zero", () => {
    const free = row({ stepName: "labels", creditsUsedNanos: 0, costSource: "provider" });
    const findings = checkCold([paid, free], { mustPay: ["hierarchy", "labels"] });
    expect(findings.map((f) => f.kind)).toEqual(["no-spend"]);
    expect(findings[0]!.step).toBe("labels");
  });

  it("calls an all-unpriced step unknown rather than free — and stops on it", () => {
    /* Fatal since GPT Sol's review, 2026-09-02: it used to be a note, so a run
       whose required step reported no cost at all carried on to the next paid
       draw. A cost measurement cannot report `unknown` as its answer.
       `allowUnpriced` is the deliberate override, exercised below. */
    const unpriced = row({ stepName: "labels", creditsUsedNanos: null, costSource: "none" });
    const findings = checkCold([paid, unpriced], { mustPay: ["hierarchy", "labels"] });
    expect(findings.map((f) => f.kind)).toEqual(["unpriced"]);
    expect(findings[0]!.fatal).toBe(true);
    expect(findings[0]!.message).toContain("unknown");
  });

  it("refuses a row that leaked out of the eval scope", () => {
    const leaked = row({ id: "leak", scopeKind: "job_step" });
    const findings = checkCold([leaked], { mustPay: ["hierarchy"] });
    expect(findings.map((f) => f.kind)).toEqual(["scope-leak"]);
    expect(findings[0]!.fatal).toBe(true);
    expect(findings[0]!.message).toContain("job_step");
  });

  it("reports duplicate execution rather than hiding it", () => {
    /* Two collector runs of one step on one job — the $5.43 incident's
       signature, and the reason this is a finding rather than a bigger number
       nobody questions. */
    const again = row({ id: "again", runId: "run-2" });
    const findings = checkCold([paid, again], { mustPay: ["hierarchy"] });
    expect(findings.map((f) => f.kind)).toEqual(["duplicate-execution"]);
    expect(findings[0]!.message).toContain("2");
  });

  it("flags a call count that is not what was expected, in either direction", () => {
    const findings = checkCold([paid], {
      mustPay: ["hierarchy"],
      expectedCalls: { hierarchy: 3 },
    });
    expect(findings.map((f) => f.kind)).toEqual(["call-count"]);
    expect(findings[0]!.fatal).toBe(false);
  });

  it("flags a gateway failure separately from the money", () => {
    const errored = row({ id: "err", runId: "run-1", outcome: "error", creditsUsedNanos: 500_000 });
    const findings = checkCold([paid, errored], { mustPay: ["hierarchy"] });
    expect(findings.map((f) => f.kind)).toEqual(["gateway-failure"]);
  });

  it("flags spend on a step nobody expected to pay", () => {
    const surprise = row({ id: "s", stepName: "blocks", creditsUsedNanos: 1_000 });
    const findings = checkCold([paid, surprise], { mustPay: ["hierarchy"] });
    expect(findings.map((f) => f.kind)).toEqual(["unexpected-paid-step"]);
    expect(findings[0]!.step).toBe("blocks");
  });
});

describe("formatting", () => {
  it("prints both clocks per step, so the sum cannot be read as the wait", () => {
    const table = formatStepTable(
      aggregateByStep([
        row({
          stepName: "labels",
          startedAt: "2026-09-02T10:00:00.000Z",
          finishedAt: "2026-09-02T10:00:08.000Z",
          durationMs: 8_000,
          creditsUsedNanos: 12_340_000,
        }),
      ]),
    );
    expect(table).toContain("labels");
    expect(table).toContain("$0.0123");
    /* 8.0s of wall clock, 8.0s summed — printed even when they agree, because
       a column that appears only when it disagrees is a column nobody reads. */
    expect(table).toContain("8.0s");
  });

  it("says how much of a total is unknown rather than quietly shortening it", () => {
    const table = formatStepTable(
      aggregateByStep([row({ creditsUsedNanos: null, costSource: "none" })]),
    );
    expect(table).toContain("unpriced");
  });

  it("prints nothing at all when there is nothing to say", () => {
    expect(formatFindings([])).toBe("");
  });

  it("puts the fatal findings first and says so", () => {
    const findings = checkCold(
      [row({ scopeKind: "job_step" }), row({ id: "x", runId: "r2" })],
      { mustPay: ["hierarchy"], expectedCalls: { hierarchy: 9 } },
    );
    const text = formatFindings(findings);
    expect(text.indexOf("FATAL")).toBeLessThan(text.indexOf("note"));
  });

  it("puts a paid failure above the ordinary notes, where it cannot be scrolled past", () => {
    /* Not fatal — the run must go on — but the reader has to see that this draw
       was billed and produced nothing before they read a dollar figure. */
    const text = formatFindings([
      { kind: "call-count", step: "hierarchy", fatal: false, message: "an ordinary note" },
      { kind: "explained-absence", step: "labels", fatal: false, message: "PAID FAILURE — labels" },
    ]);
    expect(text.indexOf("PAID FAILURE")).toBeLessThan(text.indexOf("an ordinary note"));
  });
});

/* ============================================================ the harness == */

/**
 * A fabricated `SpendRecord` — **no wire, no key, no money.** The dry pass in
 * evals/cost/feasibility.md used the same trick to prove the attribution
 * round-trip for free, and this is that pass shrunk to a unit test.
 */
function fakeCall(): SpendRecord {
  return {
    job: "hierarchy",
    wire: "messages",
    model: "DRY-PASS/fake-model",
    answeredBy: "DRY-PASS/fake-model",
    cost: { source: "provider", costNanos: 12_345_678 },
    upstreamCostNanos: null,
    providerAccount: "openrouter",
    generationId: null,
    upstream: null,
    credentialFingerprint: null,
    isByok: false,
    inputTokens: 10,
    outputTokens: 2,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    cacheWrite5mTokens: null,
    cacheWrite1hTokens: null,
    reasoningTokens: null,
    webSearches: null,
    serviceTier: null,
    inferenceGeo: null,
    ms: 5,
    outcome: "ok",
  };
}

/** A `fetch` step that buys nothing and records one fabricated call. */
function spendingStub(): PipelineStep<"fetch"> {
  return {
    ...STEPS.fetch,
    async run() {
      recordSpend(fakeCall());
      return {
        parts: {
          raw: {
            kind: "html",
            file: "raw.html",
            contentType: null,
            encoding: null,
            bytes: 0,
            sha256: null,
            fetchedAt: new Date().toISOString(),
          },
        },
        detail: "stub",
      };
    },
  };
}

/** What `runStep` sets before it calls a step — everything but the scope. */
const RUN_STEP_ATTRIBUTION = {
  scopeKind: "job_step",
  ownerId: "00000000-0000-0000-0000-000000000001",
  articleSlug: "evalcost-test",
  jobId: "spya-test01",
  stepName: "fetch",
} as const;

async function rowFrom(step: PipelineStep<"fetch">): Promise<AiCallRow> {
  const written: AiCallRow[] = [];
  await collectSpend(
    /* The three arguments a step's `run` takes are ignored by the stub; the
       wrapper under test only has to pass them through. */
    async () => {
      await step.run(undefined as never, undefined as never, undefined as never);
    },
    {
      attribution: { ...RUN_STEP_ATTRIBUTION },
      sink: async (row) => {
        written.push(row);
      },
    },
  );
  expect(written).toHaveLength(1);
  return written[0]!;
}

describe("the eval attribution overlay", () => {
  it("control arm — an unwrapped step's call is `job_step`, which is Product spend", async () => {
    /* The mutation, and the reason the test below is evidence rather than
       decoration: without the overlay the identical row lands in the bucket
       `scripts/ai-cost.ts` calls Product (`scopeKind !== "eval"`). */
    expect((await rowFrom(spendingStub())).scopeKind).toBe("job_step");
  });

  it("eval arm — the same call inside a wrapped step is `eval`", async () => {
    expect((await rowFrom(evalScoped(spendingStub()))).scopeKind).toBe("eval");
  });

  it("keeps everything else `runStep` set — the owner, slug, job and step", async () => {
    const row = await rowFrom(evalScoped(spendingStub()));
    expect(row.ownerId).toBe(RUN_STEP_ATTRIBUTION.ownerId);
    expect(row.articleSlug).toBe(RUN_STEP_ATTRIBUTION.articleSlug);
    expect(row.jobId).toBe(RUN_STEP_ATTRIBUTION.jobId);
    expect(row.stepName).toBe(RUN_STEP_ATTRIBUTION.stepName);
    /* Same box, so the same collector run: `withSpendAttribution` re-enters
       rather than nesting, and a nested `collectSpend` would have hidden the
       call from the outer report entirely. */
    expect(row.creditsUsedNanos).toBe(12_345_678);
  });

  it("wraps every step in the registry and invents none", () => {
    const overlaid = evalRegistry(STEPS as StepRegistry);
    expect(Object.keys(overlaid).sort()).toEqual(Object.keys(STEPS).sort());
    for (const name of Object.keys(STEPS) as (keyof typeof STEPS)[]) {
      /* Wrapped, not passed through — a registry that quietly returned the
         production steps would report Product spend and look identical. */
      expect(overlaid[name].run).not.toBe(STEPS[name].run);
      expect(overlaid[name].name).toBe(STEPS[name].name);
      expect(overlaid[name].produces).toBe(STEPS[name].produces);
    }
  });
});

describe("localTarget", () => {
  const local = "postgresql://postgres:hunter2@127.0.0.1:54362/postgres";

  it("redacts the password in the line it hands back to be printed", () => {
    expect(localTarget("postgres", local)).toBe(
      "postgresql://postgres:***@127.0.0.1:54362/postgres",
    );
  });

  it("accepts the other spellings of this machine", () => {
    expect(localTarget("postgres", "postgresql://postgres@localhost:5432/postgres")).toContain(
      "localhost",
    );
  });

  it("refuses a remote database", () => {
    expect(() =>
      localTarget("postgres", "postgresql://postgres:pw@db.abcdef.supabase.co:5432/postgres"),
    ).toThrow(/Refusing to run against a non-local database/);
  });

  it("refuses the filesystem store, because the ledger there is not authoritative", () => {
    expect(() => localTarget("files", local)).toThrow(/measures the Postgres pipeline/);
  });

  it("refuses an absent DATABASE_URL rather than guessing one", () => {
    expect(() => localTarget("postgres", undefined)).toThrow(/DATABASE_URL is not set/);
  });
});

describe("withoutTheInProcessPump", () => {
  it("sets VERCEL for the call and puts the environment back", async () => {
    const before = process.env.VERCEL;
    let seen: string | undefined;
    await withoutTheInProcessPump(async () => {
      seen = process.env.VERCEL;
    });
    expect(seen).toBe("1");
    expect(process.env.VERCEL).toBe(before);
  });

  it("puts it back even when the call throws", async () => {
    const before = process.env.VERCEL;
    await expect(
      withoutTheInProcessPump(async () => {
        throw new Error("enqueue failed");
      }),
    ).rejects.toThrow("enqueue failed");
    expect(process.env.VERCEL).toBe(before);
  });
});

describe("reading a finished job back", () => {
  it("reads the block count out of the step's own detail line", () => {
    expect(blocksFromDetail("19 blocks, 19 new ids (0 kept)")).toBe(19);
    expect(blocksFromDetail("186 blocks, 4 new ids (182 kept)")).toBe(186);
  });

  it("answers null rather than guessing when the step said something else", () => {
    expect(blocksFromDetail(undefined)).toBeNull();
    expect(blocksFromDetail("Tufte CSS")).toBeNull();
  });
});

describe("mustPayFor", () => {
  const html = fixtureByName("short-html");
  const pdf = fixtureByName("pdf");

  it("expects hierarchy to pay and extract not to, on an HTML article", () => {
    expect(mustPayFor(html, ["fetch", "extract", "blocks", "hierarchy", "assets"])).toEqual([
      "hierarchy",
    ]);
  });

  it("expects extract to pay on a PDF, where a model reads the pages", () => {
    expect(mustPayFor(pdf, ["fetch", "extract", "blocks", "hierarchy", "assets"])).toEqual([
      "extract",
      "hierarchy",
    ]);
  });

  it("demands nothing of a step the job was never asked to run", () => {
    /* Without this a free pass stopping short of hierarchy would report a fatal
       no-spend for a step that never ran, and the gate would be noise. */
    expect(mustPayFor(html, ["fetch", "extract", "blocks"])).toEqual([]);
  });

  it("covers the mode steps, which each buy a call over the whole article", () => {
    expect(mustPayFor(html, ["arc", "glossary", "sketch"])).toEqual([
      "arc",
      "glossary",
      "sketch",
    ]);
  });
});

describe("the cold check at the AiJob level (real production row shapes)", () => {
  /* **The shape production actually writes.** There is no `labels` step, so
     `runStep` stamps `stepName: "hierarchy"` on the structure call *and* on
     every label batch; only `job` tells them apart. An earlier version of the
     tests above gave label rows `stepName: "labels"`, which production cannot
     produce — and that fixture hid the hole this describe block exists for. */
  const structure = row({
    id: "structure",
    stepName: "hierarchy",
    job: "hierarchy",
    creditsUsedNanos: 40_000_000,
  });
  const labelBatch = row({
    id: "label-1",
    stepName: "hierarchy",
    job: "labels",
    creditsUsedNanos: 5_000_000,
  });

  it("fails a draw where the structure call was paid for and no label call was", () => {
    /* One priced row under stepName=hierarchy is enough to satisfy a step-level
       check, so this is the whole of the gap: every label batch could have been
       skipped or lost and the draw would report a plausible number. */
    const findings = checkCold([structure], {
      mustPay: ["hierarchy"],
      mustPayJobs: ["hierarchy", "labels"],
    });
    expect(findings.map((f) => f.kind)).toEqual(["no-spend"]);
    expect(findings[0]!.step).toBe("labels");
    expect(findings[0]!.fatal).toBe(true);
  });

  it("passes when both the structure call and the labels were paid for", () => {
    expect(
      checkCold([structure, labelBatch], {
        mustPay: ["hierarchy"],
        mustPayJobs: ["hierarchy", "labels"],
      }),
    ).toEqual([]);
  });

  it("still reports the step-level total under one heading", () => {
    const steps = aggregateByStep([structure, labelBatch]);
    expect(steps.map((s) => s.step)).toEqual(["hierarchy"]);
    expect(steps[0]!.calls).toBe(2);
  });
});

describe("an unpriced required step is fatal", () => {
  const unpriced = row({ stepName: "hierarchy", creditsUsedNanos: null, costSource: "none" });

  it("refuses to accept `unknown` as the answer to `what did this cost`", () => {
    const findings = checkCold([unpriced], { mustPay: ["hierarchy"] });
    expect(findings.map((f) => f.kind)).toEqual(["unpriced"]);
    expect(findings[0]!.fatal).toBe(true);
  });

  it("downgrades it to a note only when the run said so deliberately", () => {
    const findings = checkCold([unpriced], { mustPay: ["hierarchy"], allowUnpriced: true });
    expect(findings.map((f) => f.kind)).toEqual(["unpriced"]);
    expect(findings[0]!.fatal).toBe(false);
  });
});

describe("reconciling the ledger against what the steps said they bought", () => {
  it("notices rows that were made and never persisted", () => {
    /* `SpendReport.writeFailures` counts sink rejections and nothing outside
       the log sees them; Postgres `forJob` reports `unreadable: 0` because a
       row that was never inserted is unknowable there. Without this the draw
       under-reports and every other check passes. */
    const findings = checkCold([row({ stepName: "hierarchy" })], {
      mustPay: ["hierarchy"],
      observed: [{ step: "hierarchy", calls: 3, pending: 0, writeFailures: 2 }],
    });
    expect(findings.map((f) => f.kind)).toEqual(["ledger-short"]);
    expect(findings[0]!.fatal).toBe(true);
    expect(findings[0]!.message).toContain("3");
  });

  it("notices a call that was opened and never finished", () => {
    const findings = checkCold([row({ stepName: "hierarchy" })], {
      mustPay: ["hierarchy"],
      observed: [{ step: "hierarchy", calls: 1, pending: 1, writeFailures: 0 }],
    });
    expect(findings.map((f) => f.kind)).toEqual(["ledger-short"]);
  });

  it("is quiet when every call the step made is in the ledger", () => {
    expect(
      checkCold([row({ stepName: "hierarchy" })], {
        mustPay: ["hierarchy"],
        observed: [{ step: "hierarchy", calls: 1, pending: 0, writeFailures: 0 }],
      }),
    ).toEqual([]);
  });
});

/**
 * **An absence the job's own status explains, against a row that was lost.**
 *
 * The run that found this: evals/results/cost/2026-09-03-04-59-07-1bpfhts0-long-html.
 * Draw 2's `hierarchy` failed semantically — "Node range not in blocks.json" —
 * after being billed $0.2124. Labels fan out *inside* `hierarchy` and only after
 * it succeeds, so there were no `labels` rows, and the `no-spend` guard called
 * that fatal and stopped the sweep. Draws 3 and 4 never ran: the eval halted on
 * the very phenomenon it was counting.
 *
 * The absence was explained and the guard could not tell. These fix the telling,
 * and the last one holds the line the guard actually exists for.
 */
describe("a paid failure explains its own missing rows", () => {
  /* Draw 2, in the shape report.ts sees it: the structure call was billed, the
     step errored on its output, the fan-out never happened. */
  const structure = row({ id: "structure", stepName: "hierarchy", job: "hierarchy", creditsUsedNanos: 212_414_000 });
  const failedAtHierarchy = [
    { name: "fetch", status: "done" },
    { name: "extract", status: "done" },
    { name: "blocks", status: "done" },
    { name: "hierarchy", status: "error" },
  ];

  it("does not stop the run when the step that would have bought the rows failed", () => {
    const findings = checkCold([structure], {
      mustPay: ["hierarchy"],
      mustPayJobs: ["hierarchy", "labels"],
      observed: [{ step: "hierarchy", calls: 1, pending: 0, writeFailures: 0 }],
      stepStatuses: failedAtHierarchy,
      aiJobStep: AI_JOB_STEP,
    });
    expect(findings.map((f) => f.kind)).toEqual(["explained-absence"]);
    expect(findings[0]!.step).toBe("labels");
    expect(findings[0]!.fatal).toBe(false);
    expect(drawMustStop(findings)).toEqual([]);
    /* The message has to name the step whose failure explains it, or the reader
       is told an absence is fine without being told why. */
    expect(findings[0]!.message).toContain("hierarchy");
    expect(findings[0]!.message).toContain("error");
  });

  it("still stops when the same job's steps all say done — that is a lost row", () => {
    /* The identical ledger, the identical expectation, and only the step
       statuses differ. `hierarchy` finished, so the fan-out ran and its rows
       are simply not there. */
    const findings = checkCold([structure], {
      mustPay: ["hierarchy"],
      mustPayJobs: ["hierarchy", "labels"],
      observed: [{ step: "hierarchy", calls: 1, pending: 0, writeFailures: 0 }],
      stepStatuses: failedAtHierarchy.map((s) => ({ ...s, status: "done" })),
      aiJobStep: AI_JOB_STEP,
    });
    expect(findings.map((f) => f.kind)).toEqual(["no-spend"]);
    expect(findings[0]!.fatal).toBe(true);
    expect(drawMustStop(findings)).toHaveLength(1);
  });

  it("still stops on a lost row the collector watched being made", () => {
    /* **The case the guard exists for, and it must not regress.** Spend was
       observed by `onStepSpend`, the job says every step is done, and the
       ledger has fewer rows than calls: on 2026-09-02 a run spent $0.0333 into
       a ledger that could not hold it and reported nothing wrong. */
    const findings = checkCold([structure], {
      mustPay: ["hierarchy"],
      mustPayJobs: ["hierarchy"],
      observed: [{ step: "hierarchy", calls: 4, pending: 0, writeFailures: 0 }],
      stepStatuses: failedAtHierarchy.map((s) => ({ ...s, status: "done" })),
      aiJobStep: AI_JOB_STEP,
    });
    expect(findings.map((f) => f.kind)).toEqual(["ledger-short"]);
    expect(findings[0]!.fatal).toBe(true);
    expect(drawMustStop(findings)).toHaveLength(1);
  });

  it("keeps a short ledger fatal even on a draw that failed — a failure is not an alibi", () => {
    /* An explained absence is about rows that were never bought. A row the
       collector *saw bought* and the ledger has not got is lost however the
       step ended, and folding the two together would hand every dropped write
       an excuse. */
    const findings = checkCold([structure], {
      mustPay: ["hierarchy"],
      mustPayJobs: ["hierarchy", "labels"],
      observed: [{ step: "hierarchy", calls: 3, pending: 0, writeFailures: 1 }],
      stepStatuses: failedAtHierarchy,
      aiJobStep: AI_JOB_STEP,
    });
    expect(findings.map((f) => f.kind).sort()).toEqual(["explained-absence", "ledger-short"]);
    expect(drawMustStop(findings).map((f) => f.kind)).toEqual(["ledger-short"]);
  });

  it("does not excuse a step whose own failure came after it should have paid", () => {
    /* `arc` failed; `hierarchy` did not, and its labels are still missing. A
       failure downstream of the absence explains nothing about it. */
    const findings = checkCold([structure], {
      mustPay: ["hierarchy"],
      mustPayJobs: ["hierarchy", "labels"],
      stepStatuses: [
        { name: "blocks", status: "done" },
        { name: "hierarchy", status: "done" },
        { name: "arc", status: "error" },
      ],
      aiJobStep: AI_JOB_STEP,
    });
    expect(findings.map((f) => f.kind)).toEqual(["no-spend"]);
    expect(findings[0]!.fatal).toBe(true);
  });

  it("is fatal as before when the run supplied no step statuses at all", () => {
    /* Nothing to explain the absence with is not the same as an explanation,
       and the older callers pass none. */
    const findings = checkCold([structure], {
      mustPay: ["hierarchy"],
      mustPayJobs: ["hierarchy", "labels"],
    });
    expect(findings.map((f) => f.kind)).toEqual(["no-spend"]);
    expect(findings[0]!.fatal).toBe(true);
  });

  it("explains a step's own absence, not only a fan-out job's", () => {
    /* A per-mode draw whose only paying step errored before buying anything:
       no rows at all, and the step list says why. */
    const findings = checkCold([], {
      mustPay: ["ideas"],
      mustPayJobs: ["ideas"],
      stepStatuses: [{ name: "ideas", status: "error" }],
      aiJobStep: AI_JOB_STEP,
    });
    expect(findings.map((f) => f.kind)).toEqual(["explained-absence", "explained-absence"]);
    expect(findings.every((f) => !f.fatal)).toBe(true);
  });
});

/* ================================================ the guards, added 09-02 == */

describe("verifyFixtures — every fixture hashed before any job exists", () => {
  const short = fixtureByName("short-html");

  it("passes when the bytes are the bytes the manifest names", () => {
    const bytes = readFileSync(short.file);
    expect(verifyFixtures([{ fixture: short, bytes }])).toEqual([]);
  });

  it("reports a mismatch instead of letting the run spend on changed bytes", () => {
    const stale = verifyFixtures([{ fixture: short, bytes: new TextEncoder().encode("nope") }]);
    expect(stale).toHaveLength(1);
    expect(stale[0]!).toContain(short.file);
    expect(stale[0]!).toContain(short.sha256.slice(0, 12));
  });

  it("checks every fixture, not just the first — the later one is the trap", () => {
    /* Per-draw checking would let the short article's ingest be paid for before
       the long one was ever hashed. GPT Sol, 2026-09-02, finding 1. */
    const stale = verifyFixtures([
      { fixture: short, bytes: readFileSync(short.file) },
      { fixture: fixtureByName("long-html"), bytes: new TextEncoder().encode("nope") },
    ]);
    expect(stale).toHaveLength(1);
    expect(stale[0]!).toContain("gwern.html");
  });
});

describe("assertDistinctEvalOwner", () => {
  /* The constants, not literals: `tests/fixture-ids.test.ts` refuses a uuid two
     test files write out longhand, and its own advice is to import the single
     source of truth instead — which is also what stops this test drifting from
     the id the runner actually uses. */
  const evalOwner = EVAL_OWNER_ID;
  const dev = DEV_OWNER_ID;

  it("accepts an eval owner nobody signs in as", () => {
    expect(() => assertDistinctEvalOwner(evalOwner, dev)).not.toThrow();
  });

  it("refuses to run as the owner an open dev tab is signed in as", () => {
    /* src/web/jobEngine.ts drives every queued or running job it can list, and
       `GET /api/jobs` lists by owner — so sharing the owner means an open tab
       can win a claim and run a paid step through the PRODUCTION registry,
       writing `job_step` rows into Product. `VERCEL=1` only silences this
       process's own pump. GPT Sol, 2026-09-02, finding 3. */
    expect(() => assertDistinctEvalOwner(dev, dev)).toThrow(/same owner/);
  });
});

describe("assertOneOnDemandMode", () => {
  it("allows the ingest steps, which mark no article cache", () => {
    expect(() =>
      assertOneOnDemandMode(["fetch", "extract", "blocks", "hierarchy", "assets"]),
    ).not.toThrow();
  });

  it("allows one on-demand mode after an ingest", () => {
    expect(() => assertOneOnDemandMode(["fetch", "extract", "blocks", "hierarchy", "arc"])).not.toThrow();
  });

  it("refuses two compatible modes in one job, which would share a warm prefix", () => {
    /* `sharesArticleCache` marks the article prefix when a later step in the
       SAME job renders identical bytes at identical effort — so the second mode
       reads a cache the first paid to write, and `checkCold` sees positive
       spend and passes. That is not the cost of pressing each mode.
       GPT Sol, 2026-09-02, finding 5. */
    expect(() => assertOneOnDemandMode(["glossary", "quotes"])).toThrow(/one on-demand mode/);
  });

  it("refuses two incompatible modes too — a mixed job is a different scenario", () => {
    expect(() => assertOneOnDemandMode(["arc", "ideas"])).toThrow(/one on-demand mode/);
  });
});

describe("requiredAiJobsFor", () => {
  const html = fixtureByName("short-html");
  const pdf = fixtureByName("pdf");

  it("requires the label fan-out as well as the structure call", () => {
    expect(requiredAiJobsFor(html, ["fetch", "extract", "blocks", "hierarchy", "assets"])).toEqual([
      "hierarchy",
      "labels",
    ]);
  });

  it("requires the PDF transcription job on a PDF", () => {
    expect(requiredAiJobsFor(pdf, ["fetch", "extract", "blocks", "hierarchy"])).toEqual([
      "pdf",
      "hierarchy",
      "labels",
    ]);
  });

  it("does not require the PDF job on an HTML article, where extraction is free", () => {
    expect(requiredAiJobsFor(html, ["fetch", "extract"])).toEqual([]);
  });

  it("maps a mode step onto the AI job of the same name", () => {
    expect(requiredAiJobsFor(html, ["glossary"])).toEqual(["glossary"]);
  });
});

/**
 * The gate written *after* a run spent $0.0333 into a ledger that could not
 * hold it — `ai_calls` was missing columns the code had already declared, so
 * every insert failed and was swallowed into a warning. Every other gate passed,
 * because none of them asked whether the thing the run produces works.
 */
describe("assertLedgerUsable", () => {
  it("lets a run past when the ledger answers", async () => {
    await expect(assertLedgerUsable(async () => ({ rows: [], unreadable: 0 }))).resolves.toBeUndefined();
  });

  it("refuses when the ledger cannot be read, and says what to do", async () => {
    const boom = new Error("column ai_calls.event_kind does not exist");
    await expect(assertLedgerUsable(() => Promise.reject(boom))).rejects.toThrow(
      /spend money and record nothing/,
    );
    await expect(assertLedgerUsable(() => Promise.reject(boom))).rejects.toThrow(/db:migrate/);
  });

  it("keeps the original error as the cause, so the driver detail is not lost", async () => {
    const boom = new Error("42703");
    const caught = await assertLedgerUsable(() => Promise.reject(boom)).catch((e: unknown) => e);
    expect((caught as Error).cause).toBe(boom);
  });
});

/* ============================================ the all-modes sweep, 09-03 == */

describe("ALL_MODES", () => {
  it("is the eight on-demand modes, in pipeline order", () => {
    /* Written out rather than derived, because the *content* of this list is
       what the stage buys — a ninth mode arriving and being silently swept in
       would change what a run costs without anybody choosing it. */
    expect([...ALL_MODES]).toEqual([
      "arc",
      "tweets",
      "glossary",
      "quotes",
      "ideas",
      "timeline",
      "quiz",
      "sketch",
    ]);
  });

  it("holds no ingest step — hierarchy is bought once, by the ingest draw", () => {
    for (const ingest of ["fetch", "extract", "blocks", "hierarchy", "assets"]) {
      expect(ALL_MODES).not.toContain(ingest);
    }
  });
});

describe("parseStepList", () => {
  it("takes a comma-separated list of real step names", () => {
    expect(parseStepList("fetch,extract, blocks", "--steps")).toEqual([
      "fetch",
      "extract",
      "blocks",
    ]);
  });

  it("names the flag and the real steps when one is a typo", () => {
    expect(() => parseStepList("fetch,hierarcy", "--steps")).toThrow(/hierarcy/);
    expect(() => parseStepList("fetch,hierarcy", "--steps")).toThrow(/--steps/);
  });

  it("refuses an empty list rather than running the default five unasked", () => {
    expect(() => parseStepList("", "--modes")).toThrow(/--modes/);
    expect(() => parseStepList(undefined, "--modes")).toThrow(/--modes/);
  });
});

/**
 * The combinations that would spend money measuring something other than what
 * they claim. Each is refused before the first job exists, which is the only
 * place a refusal is worth anything.
 */
describe("assertSweepArgs", () => {
  const base = {
    allModes: false,
    against: null,
    repeat: 1,
    fixtures: ["short-html"],
    steps: ["fetch", "extract", "blocks", "hierarchy", "assets"] as StepName[],
    batchedModes: false,
  };

  it("accepts an ordinary ingest run", () => {
    expect(() => assertSweepArgs(base)).not.toThrow();
  });

  it("accepts a single all-modes sweep", () => {
    expect(() => assertSweepArgs({ ...base, allModes: true })).not.toThrow();
  });

  it("refuses a repeated all-modes sweep, whose second pass would find every mode done", () => {
    /* A mode already generated on an article skips on its `stepIsDone` stamp
       (src/pipeline.ts), which the fatal `no-spend` finding turns into a stop —
       so the second sweep would abort after paying for a second ingest. */
    expect(() => assertSweepArgs({ ...base, allModes: true, repeat: 2 })).toThrow(
      /--repeat/,
    );
  });

  it("refuses --all-modes together with --against, which name two different articles", () => {
    expect(() => assertSweepArgs({ ...base, allModes: true, against: "kept-1" })).toThrow(
      /--against/,
    );
  });

  it("refuses --against without an explicit step list", () => {
    /* The default is the five ingest steps, and stage 1 is a fixture read — so
       an `--against` run that did not say what to run would try to re-fetch an
       article it has no bytes for. */
    expect(() => assertSweepArgs({ ...base, against: "kept-1", steps: null })).toThrow(
      /--steps/,
    );
  });

  it("refuses --against with a fixture, because it runs on a slug and not on bytes", () => {
    expect(() =>
      assertSweepArgs({ ...base, against: "kept-1", steps: ["ideas"], fixtures: ["short-html"] }),
    ).toThrow(/--fixture/);
  });

  it("refuses --all-modes --batched-modes, which turns the cold check off and batches nothing", () => {
    /* The combination still runs one job per mode — `--all-modes` decides that
       — but `--batched-modes` is what tells `checkColdDraw` a warm first call
       is expected, so one stray flag would buy eight per-mode numbers with
       nothing checking they were cold. GPT Sol, 2026-09-03. */
    expect(() => assertSweepArgs({ ...base, allModes: true, batchedModes: true })).toThrow(
      /--batched-modes/,
    );
  });

  it("still accepts --batched-modes on its own, which is a real scenario", () => {
    expect(() =>
      assertSweepArgs({
        ...base,
        against: "kept-1",
        fixtures: [],
        steps: ["arc", "tweets"],
        batchedModes: true,
      }),
    ).not.toThrow();
  });
});

/**
 * **A mode job with no article to adopt is a cold ingest waiting to happen**,
 * and it is refused before the job is advanced rather than diagnosed after.
 */
describe("assertAdoptable", () => {
  it("lets a mode draw past when the article the sweep ingested is there", () => {
    expect(() => assertAdoptable("evalcost-x", "article-1")).not.toThrow();
  });

  it("refuses when there is no such article, which is what a mint looks like early", () => {
    expect(() => assertAdoptable("evalcost-x", null)).toThrow(/evalcost-x/);
    expect(() => assertAdoptable("evalcost-x", null)).toThrow(/adopt/);
  });
});

/**
 * **The check that makes the whole shape of the all-modes stage falsifiable.**
 *
 * The stage ingests once and then runs each mode as its own job against the
 * adopted article, which is only sound if a later job cannot read the cached
 * article prefix an earlier one wrote. The argument for that is in the plan —
 * `sharesArticleCache` marks nothing when the job's `later` list is empty, and
 * Anthropic's cache is explicit-only — and an argument is not a measurement.
 *
 * Two strengths of rule, and the difference is the point. **A per-mode draw
 * sends no breakpoint at all**, so any read is anomalous. **An ingest draw**
 * fans out on purpose, so only the earliest call of each step is asked — and it
 * is asked *per step*, because the version that returned early for every non-
 * mode draw left PDF `extract` and dictation, the two paths where a provider
 * caches implicitly, with no gate whatsoever. GPT Sol, 2026-09-03.
 */
describe("checkColdDraw", () => {
  const cold = row({ id: "cold", startedAt: "2026-09-03T10:00:00.000Z", cacheReadTokens: 0 });
  const warm = row({ id: "warm", startedAt: "2026-09-03T10:00:00.000Z", cacheReadTokens: 4_000 });

  it("refuses a per-mode draw whose earliest call read a warm cache", () => {
    const findings = checkColdDraw([warm], { phase: "mode", batchedModes: false });
    expect(findings.map((f) => f.kind)).toEqual(["warm-mode-call"]);
    expect(findings[0]!.fatal).toBe(true);
  });

  it("refuses a per-mode draw whose LATER call read a cache, which the earliest-call rule allows", () => {
    /* No mode sends a `cache_control` breakpoint when it is the only step in
       its job — every one of the eight gates its single one on
       `opts.cacheArticle` — so there is nothing here that should be readable at
       any point in the draw, not merely nothing readable first. */
    const later = row({ id: "l", startedAt: "2026-09-03T10:00:30.000Z", cacheReadTokens: 9_000 });
    const findings = checkColdDraw([cold, later], { phase: "mode", batchedModes: false });
    expect(findings.map((f) => f.kind)).toEqual(["warm-mode-call"]);
    expect(findings[0]!.message).toContain("9000 cached token(s)");
  });

  it("refuses a call whose cache telemetry is missing, and says it is unknown not warm", () => {
    /* Coercing the absent field to zero is what let a guard with no evidence
       under it pass. */
    const silent = row({ id: "s", cacheReadTokens: null });
    const findings = checkColdDraw([silent], { phase: "mode", batchedModes: false });
    expect(findings.map((f) => f.kind)).toEqual(["unknown-cache-telemetry"]);
    expect(findings[0]!.fatal).toBe(true);
    expect(findings[0]!.message).toContain("no evidence it was cold");
  });

  it("holds an ingest draw's PDF extract to a cold first call, where OpenAI caches implicitly", () => {
    /* `PDF_READER_MODEL` is an OpenAI model and OpenAI caches a repeated prefix
       automatically. The fixture bytes are committed, so a rerun inside the
       cache lifetime would otherwise report a discounted extraction as a cold
       first generation. */
    const extract = row({
      id: "x",
      stepName: "extract",
      job: "pdf",
      requestedModel: "openai/gpt-5.6-luna",
      startedAt: "2026-09-03T10:00:00.000Z",
      cacheReadTokens: 12_000,
    });
    const findings = checkColdDraw([extract], { phase: "ingest", batchedModes: false });
    expect(findings.map((f) => f.kind)).toEqual(["warm-first-call"]);
    expect(findings[0]!.step).toBe("extract");
  });

  it("asks each step separately, so a cold hierarchy does not vouch for a warm extract", () => {
    const extract = row({
      id: "x",
      stepName: "extract",
      startedAt: "2026-09-03T09:59:00.000Z",
      cacheReadTokens: 12_000,
    });
    /* Earlier by the clock and cold, which under a whole-draw rule would be the
       only call asked and would clear the draw. */
    const findings = checkColdDraw([extract, cold], { phase: "ingest", batchedModes: false });
    expect(findings.map((f) => f.step)).toEqual(["extract"]);
  });

  it("allows a later call of an ingest step to read off the first, which is production cost", () => {
    /* Within-run caching is part of what an ingest really costs (Principles):
       hierarchy's label fan-out shares `stepName: "hierarchy"` with the
       structure call and legitimately reads off it. A rule of "no cache read
       anywhere" would fail every fan-out we deliberately pay the write premium
       for. */
    const label = row({
      id: "l",
      job: "labels",
      startedAt: "2026-09-03T10:00:30.000Z",
      cacheReadTokens: 9_000,
    });
    expect(checkColdDraw([cold, label], { phase: "ingest", batchedModes: false })).toEqual([]);
  });

  it("reads the clock, not the array order", () => {
    /* The ledger comes back ordered by `started_at` today. If that ever stops
       being true, "the first row" and "the earliest call" part company and this
       check would quietly start asking about the wrong call. */
    const later = row({ id: "l", startedAt: "2026-09-03T10:00:30.000Z", cacheReadTokens: 0 });
    const findings = checkColdDraw([later, warm], { phase: "ingest", batchedModes: false });
    expect(findings.map((f) => f.kind)).toEqual(["warm-first-call"]);
  });

  it("is silent under --batched-modes, where the warm read is the measurement", () => {
    expect(checkColdDraw([warm], { phase: "batched", batchedModes: true })).toEqual([]);
    expect(checkColdDraw([warm], { phase: "ingest", batchedModes: true })).toEqual([]);
  });

  it("treats a tie on the clock as one earliest call, and a warm one fails it", () => {
    /* Two rows can share a millisecond, and picking whichever arrived first
       would make the verdict depend on the row order the reader cannot see. */
    expect(
      checkColdDraw([cold, warm], { phase: "ingest", batchedModes: false }).map((f) => f.kind),
    ).toEqual(["warm-first-call"]);
  });

  it("has nothing to say about a draw with no rows — that is no-spend's job", () => {
    expect(checkColdDraw([], { phase: "mode", batchedModes: false })).toEqual([]);
  });
});

/**
 * **The batched phase's own rule: did the write premium get collected?**
 *
 * `checkColdDraw` is silent on a batched draw, correctly — a warm read there is
 * the measurement, not a contamination — and that left the one phase where the
 * article cache can pay off with no check at all. The 2026-09-03 sweep computed
 * the numbers that prove
 * docs/postmortems/260903c-…-marks-the-writer-but-never-the-reader.md and printed
 * them unjudged.
 *
 * The rule is stated in money rather than in `sharesArticleCache`, and the first
 * case below is why: the predicate was *right about the group and wrong about the
 * direction*, so a check that asked it who should share would have agreed with
 * the bug and passed. Asking "was this write ever read" needs none of the
 * pipeline's tables and so cannot inherit their mistakes.
 */
describe("checkBatchedDraw", () => {
  const writer = row({
    id: "writer",
    stepName: "arc",
    startedAt: "2026-09-03T05:47:10.000Z",
    cacheWriteTokens: 25_428,
    cacheReadTokens: 0,
  });

  it("refuses the real broken numbers: a writer that paid and a reader that never looked", () => {
    /* Verbatim from evals/results/cost/2026-09-03-05-47-10-e0a1he1b-against-…,
       the job that priced `arc,tweets` before the fix. `tweets` read nothing AND
       wrote nothing, which is only possible if no `cache_control` reached the
       provider — a prefix that merely failed to match would have written its
       own entry. */
    const reader = row({
      id: "reader",
      stepName: "tweets",
      startedAt: "2026-09-03T05:47:40.000Z",
      reportedInputTokens: 27_533,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    const findings = checkBatchedDraw([writer, reader], "batched");
    expect(findings.map((f) => f.kind)).toEqual(["unclaimed-cache-write"]);
    expect(findings[0]!.fatal).toBe(true);
    expect(findings[0]!.step).toBe("arc");
    expect(findings[0]!.message).toContain("25428");
    expect(findings[0]!.message).toContain("the best any of them managed was 0");
  });

  it("accepts the shape the fix produces: the reader reads what the writer wrote", () => {
    const reader = row({
      id: "reader",
      stepName: "tweets",
      startedAt: "2026-09-03T05:47:40.000Z",
      reportedInputTokens: 2_105,
      cacheWriteTokens: 0,
      cacheReadTokens: 25_428,
    });
    expect(checkBatchedDraw([writer, reader], "batched")).toEqual([]);
  });

  it("catches the other failure too: both marked, but the prefixes never matched", () => {
    /* The `ideas`/`ARTICLE_RENDERER` near-miss, which this rule gets for free
       because it never asks *why* the money went missing. Two stages of one
       group that both send a breakpoint but disagree on the bytes each write a
       full entry and neither reads one — two lost bets, two findings. */
    const other = row({
      id: "other",
      stepName: "tweets",
      startedAt: "2026-09-03T05:47:40.000Z",
      cacheWriteTokens: 27_239,
      cacheReadTokens: 0,
    });
    const findings = checkBatchedDraw([writer, other], "batched");
    expect(findings.map((f) => f.step)).toEqual(["arc", "tweets"]);
    expect(findings.every((f) => f.kind === "unclaimed-cache-write")).toBe(true);
  });

  it("will not let one group's read absolve another group's lost write", () => {
    /* **GPT Sol's exploit of the first version of this rule**, which evaluated
       `some()` per writer over every call in the draw. arc writes and is never
       read; ideas writes and timeline reads exactly what ideas wrote; the
       timeline read satisfied arc's writer too and the gate returned nothing.
       arc is `high`+`text` and those two are `high`+`ids` — different prefixes
       entirely, so that read could never have been arc's. */
    const ideas = row({
      id: "ideas",
      stepName: "ideas",
      startedAt: "2026-09-03T05:47:40.000Z",
      cacheWriteTokens: 27_239,
      cacheReadTokens: 0,
    });
    const timeline = row({
      id: "timeline",
      stepName: "timeline",
      startedAt: "2026-09-03T05:48:10.000Z",
      cacheWriteTokens: 0,
      cacheReadTokens: 27_239,
    });
    const findings = checkBatchedDraw([writer, ideas, timeline], "batched");
    expect(findings.map((f) => f.step)).toEqual(["arc"]);
    expect(findings[0]!.kind).toBe("unclaimed-cache-write");
  });

  it("spends each read once, so one read cannot square two writes", () => {
    /* Two writers in one group and a single read. Whichever the read is matched
       to, the other is a real loss and must be reported. */
    const second = row({
      id: "second",
      stepName: "tweets",
      startedAt: "2026-09-03T05:47:40.000Z",
      cacheWriteTokens: 25_428,
      cacheReadTokens: 0,
    });
    const third = row({
      id: "third",
      stepName: "tweets",
      startedAt: "2026-09-03T05:48:10.000Z",
      cacheWriteTokens: 0,
      cacheReadTokens: 25_428,
    });
    expect(checkBatchedDraw([writer, second, third], "batched")).toHaveLength(1);
  });

  it("refuses a same-group pair that cached nothing at all, which is both markers missing", () => {
    /* The silence that looks like success, and the shape a regression switching
       `cacheArticle` off everywhere would produce: no write to be unclaimed, so
       the write rule has nothing to say, and every number in the draw is a cold
       one wearing a batched label. */
    const cold = (id: string, step: string, at: string) =>
      row({ id, stepName: step as never, startedAt: at, cacheWriteTokens: 0, cacheReadTokens: 0 });
    const findings = checkBatchedDraw(
      [
        cold("a", "arc", "2026-09-03T05:47:10.000Z"),
        cold("b", "tweets", "2026-09-03T05:47:40.000Z"),
      ],
      "batched",
    );
    expect(findings.map((f) => f.kind)).toEqual(["unclaimed-cache-write"]);
    expect(findings[0]!.message).toContain("no call wrote or read a single cached token");
  });

  it("says nothing about one lone stage that cached nothing — there was nobody to share with", () => {
    const alone = row({
      id: "alone",
      stepName: "arc",
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    expect(checkBatchedDraw([alone], "batched")).toEqual([]);
  });

  it("will not accept a read that came BEFORE the write it is supposed to claim", () => {
    /* Ordering is the whole content of "was it read": a read earlier in the job
       belongs to some other entry, and counting it would let a writer be
       squared by money that was already spent when it placed its bet. */
    const early = row({
      id: "early",
      stepName: "tweets",
      startedAt: "2026-09-03T05:46:00.000Z",
      cacheWriteTokens: 0,
      cacheReadTokens: 25_428,
    });
    expect(checkBatchedDraw([writer, early], "batched").map((f) => f.kind)).toEqual([
      "unclaimed-cache-write",
    ]);
  });

  it("allows a read that falls a little short, and refuses one that falls a lot", () => {
    const near = (read: number) =>
      row({
        id: "r",
        stepName: "tweets",
        startedAt: "2026-09-03T05:47:40.000Z",
        cacheWriteTokens: 0,
        cacheReadTokens: read,
      });
    expect(checkBatchedDraw([writer, near(24_000)], "batched")).toEqual([]);
    expect(checkBatchedDraw([writer, near(4_000)], "batched")).toHaveLength(1);
  });

  it("has no opinion about a step in no cache group, however its writes end up", () => {
    /* **`hierarchy` and its label fan-out are out of scope, not forgiven.** The
       first version tried to forgive them with a loose matcher, and GPT Sol
       showed that unsafe in both directions: three parallel batches with no
       re-ask — the shape the first three measured label draws actually had —
       drew three fatal findings, while any large later article read would have
       claimed all three writes. Paying for parallel batches that mostly go
       unread is a documented latency choice, so "was this write collected" is
       simply the wrong question to ask it. src/labels.ts, prompt-caching.md § the
       labels row. */
    const batch = (id: string) =>
      row({ id, stepName: "hierarchy", startedAt: "2026-09-03T05:47:10.000Z", cacheWriteTokens: 1_107 });
    expect(checkBatchedDraw([batch("b1"), batch("b2"), batch("b3")], "batched")).toEqual([]);
    expect(checkBatchedDraw([writer, batch("b1"), batch("b2")], "batched")).toHaveLength(1);
  });

  it("stops at unknown telemetry rather than reporting a shortfall that is really an absence", () => {
    /* A missing field could have been the read that squares any of these
       writes, so one unknown poisons the arithmetic for all of them. */
    const silent = row({ id: "s", stepName: "tweets", cacheReadTokens: null });
    const findings = checkBatchedDraw([writer, silent], "batched");
    expect(findings.map((f) => f.kind)).toEqual(["unknown-cache-telemetry"]);
    expect(findings[0]!.fatal).toBe(true);
  });

  it("says nothing on the phases that are not batched, and nothing on an empty draw", () => {
    const reader = row({ id: "reader", stepName: "tweets", cacheWriteTokens: 0, cacheReadTokens: 0 });
    expect(checkBatchedDraw([writer, reader], "mode")).toEqual([]);
    expect(checkBatchedDraw([writer, reader], "ingest")).toEqual([]);
    expect(checkBatchedDraw([], "batched")).toEqual([]);
  });
});

/**
 * **Billed and produced nothing is not a price.**
 *
 * A mode whose response was paid for and then failed parsing or validation was
 * being quoted as "Ideas costs $X" and folded into "whole article". The money is
 * real and has to appear; the number is not a price for anything, so it appears
 * separately. Same treatment `observedVariation` already gives repeated draws.
 */
describe("headlineTotal", () => {
  const draw = (label: string, cost: number, over: Partial<DrawOutcome> = {}): DrawOutcome => ({
    label,
    totalNanos: cost,
    succeeded: true,
    ...over,
  });

  it("keeps a paid failure out of the quoted total and names it beside the money", () => {
    const t = headlineTotal([
      draw("arc", 100),
      draw("ideas", 900, { succeeded: false, failure: "ideas bug" }),
      draw("quotes", 200),
    ]);
    expect(t.nanos).toBe(300);
    expect(t.totalPaidNanos).toBe(1_200);
    expect(t.paidFailures).toEqual([{ label: "ideas", nanos: 900, failure: "ideas bug" }]);
    expect(t.complete).toBe(false);
  });

  it("is complete only when every draw produced what it was billed for", () => {
    const t = headlineTotal([draw("arc", 100), draw("quotes", 200)]);
    expect(t.complete).toBe(true);
    expect(t.nanos).toBe(t.totalPaidNanos);
  });

  it("says a failure's money out loud rather than dropping it", () => {
    const t = headlineTotal([draw("ideas", 900, { succeeded: false, failure: "truncated" })]);
    const printed = formatPaidFailures(t);
    expect(printed).toContain("$0.0000");
    expect(printed).toContain("truncated");
    expect(printed).toContain("no artefact");
  });

  it("prints nothing at all when nothing failed", () => {
    expect(formatPaidFailures(headlineTotal([draw("arc", 100)]))).toBe("");
  });

  it("counts an unknown failure rather than treating it as a success", () => {
    const t = headlineTotal([draw("arc", 100, { succeeded: false })]);
    expect(t.succeeded).toBe(0);
    expect(t.paidFailures[0]!.failure).toBe("unknown");
  });
});

/**
 * **Cold or warm, read off the calls rather than off the round's position.**
 *
 * The interactions runner labelled round 1 cold and round 2 warm and then
 * divided one by the other. Neither label was ever checked, and both can be
 * false: chat's tool loop reads cache on a later call when the first was cold,
 * and chat may invoke passage search before the standalone search task, warming
 * a round still called cold.
 */
describe("roundCache", () => {
  const call = (read: number | null, write: number | null = 0) => ({
    cacheRead: read,
    cacheWrite: write,
  });

  it("is cold when nothing was read", () => {
    expect(roundCache([call(0, 5_000)])).toEqual({ kind: "cold", readWithinRound: 0 });
  });

  it("is still cold when a later call reads what an earlier one wrote", () => {
    /* Chat's tool loop. The round arrived with nothing cached, which is what
       cold means — treating this as warm would suppress the most interesting
       ratio in the set. */
    expect(roundCache([call(0, 5_000), call(5_000, 0)])).toEqual({
      kind: "cold",
      readWithinRound: 5_000,
    });
  });

  it("is warm when the first call read a cache it cannot have written", () => {
    expect(roundCache([call(4_000, 0)])).toEqual({ kind: "warm", read: 4_000 });
  });

  it("is warm when a later call reads while nothing in this round has written", () => {
    /* The case the earliest-call rule alone misses: a cheap first call that
       caches nothing, then a call reading a prefix from an earlier round. */
    expect(roundCache([call(0, 0), call(7_000, 0)])).toEqual({ kind: "warm", read: 7_000 });
  });

  it("is unknown, not cold, when a call reported no cache-read count", () => {
    const verdict = roundCache([call(null, 0)]);
    expect(verdict.kind).toBe("unknown");
  });

  it("does not treat an unknown cache WRITE as a licence to read", () => {
    /* Not knowing whether this round wrote a cache is not evidence that it
       did, so the read that follows is still pre-existing. */
    expect(roundCache([call(0, null), call(3_000, 0)])).toEqual({ kind: "warm", read: 3_000 });
  });

  it("says so when the round made no calls at all", () => {
    expect(roundCache([])).toEqual({ kind: "no-calls" });
  });
});

/**
 * **A missing ratio is a fine outcome; a wrong one is not.** "cache worth 2.5×"
 * was printed from two rounds whose labels nothing had checked, including when
 * one of them had failed or was unpriced.
 */
describe("cacheRatio", () => {
  const round = (over: Partial<RoundForRatio> = {}): RoundForRatio => ({
    expected: "cold",
    nanos: 1_000,
    unpriced: 0,
    failed: false,
    cache: { kind: "cold", readWithinRound: 0 },
    ...over,
  });
  const warm = (over: Partial<RoundForRatio> = {}): RoundForRatio =>
    round({ expected: "warm", nanos: 400, cache: { kind: "warm", read: 9_000 }, ...over });

  it("divides two rounds that were what they were labelled", () => {
    expect(cacheRatio(round(), warm())).toEqual({ kind: "ratio", ratio: 2.5 });
  });

  it("refuses a ratio when the cold round read a pre-existing cache", () => {
    const verdict = cacheRatio(round({ cache: { kind: "warm", read: 9_000 } }), warm());
    expect(verdict.kind).toBe("none");
    expect(verdict.kind === "none" && verdict.why).toContain("labelled cold");
  });

  it("refuses a ratio when the warm round read nothing", () => {
    const verdict = cacheRatio(round(), warm({ cache: { kind: "cold", readWithinRound: 0 } }));
    expect(verdict.kind).toBe("none");
    expect(verdict.kind === "none" && verdict.why).toContain("no pre-existing cache");
  });

  it("refuses a ratio when either round failed", () => {
    expect(cacheRatio(round({ failed: true }), warm()).kind).toBe("none");
    expect(cacheRatio(round(), warm({ failed: true })).kind).toBe("none");
  });

  it("refuses a ratio built on an unpriced round, which is short by an unknown amount", () => {
    expect(cacheRatio(round({ unpriced: 1 }), warm()).kind).toBe("none");
  });

  it("refuses a ratio when a round's cache state is unknown", () => {
    const verdict = cacheRatio(round({ cache: { kind: "unknown", why: "no telemetry" } }), warm());
    expect(verdict.kind).toBe("none");
    expect(verdict.kind === "none" && verdict.why).toContain("unknown");
  });
});

/**
 * **Adoption, checked rather than assumed.** A mode job carrying neither a URL
 * nor an upload is `{kind: "adopted"}` in `enqueue` — but if it ever mints
 * instead, the draw pays for a whole cold ingest and files it under the mode's
 * name, and every other check here would pass.
 */
describe("checkAdoption", () => {
  it("refuses a mode draw whose job minted a fresh article", () => {
    const findings = checkAdoption(
      { kind: "minted", requested: "evalcost-x", got: "evalcost-x-spya-ab12cd", why: "the slug moved" },
      "mode",
    );
    expect(findings.map((f) => f.kind)).toEqual(["not-adopted"]);
    expect(findings[0]!.fatal).toBe(true);
    expect(findings[0]!.message).toContain("evalcost-x-spya-ab12cd");
  });

  it("is quiet when the job adopted the article the sweep ingested", () => {
    expect(checkAdoption({ kind: "adopted", slug: "evalcost-x", articleId: "a1" }, "mode")).toEqual([]);
  });

  it("expects an ingest draw to mint, and says nothing about it", () => {
    expect(
      checkAdoption(
        { kind: "minted", requested: "evalcost-x", got: "evalcost-x", why: "a fresh article" },
        "ingest",
      ),
    ).toEqual([]);
  });

  it("holds a batched draw to the same rule as a mode draw", () => {
    /* `--against` names an article that already exists. A mint there means the
       run measured a fresh empty article rather than the kept one. */
    const findings = checkAdoption(
      { kind: "minted", requested: "kept-1", got: "kept-1-x", why: "the slug moved" },
      "batched",
    );
    expect(findings.map((f) => f.kind)).toEqual(["not-adopted"]);
  });
});

/**
 * **Observed variation, and the two words that are not in it.**
 *
 * Principles forbids a tail probability and a standard deviation: with four
 * draws either would be a number with no evidence under it. What we can honestly
 * say is where the middle is, how far apart the ends are, how many draws failed,
 * what the successful ones cost, and what the whole set was billed.
 */
describe("observedVariation", () => {
  const draw = (cost: number, over: Partial<DrawOutcome> = {}): DrawOutcome => ({
    label: "long-html",
    totalNanos: cost,
    succeeded: true,
    ...over,
  });

  it("takes the median across an even number of draws", () => {
    const v = observedVariation([draw(100), draw(400), draw(200), draw(300)]);
    expect(v.draws).toBe(4);
    expect(v.median).toBe(250);
    expect(v.min).toBe(100);
    expect(v.max).toBe(400);
    expect(v.range).toBe(300);
  });

  it("counts failures from the stage outcome, not from the gateway's", () => {
    /* `outcome: "ok"` only means the gateway returned. A truncated hierarchy is
       a `bug` failure with a perfectly ok row beside it, and counting the
       gateway's word would report zero failures over a run of them. */
    const v = observedVariation([
      draw(100),
      draw(900, { succeeded: false, failure: "truncated" }),
      draw(200),
      draw(300, { succeeded: false, failure: "truncated" }),
    ]);
    expect(v.failures).toBe(2);
    expect(v.failureKinds).toEqual({ truncated: 2 });
  });

  it("reports cost conditional on success beside the total that was actually paid", () => {
    const v = observedVariation([
      draw(100),
      draw(900, { succeeded: false, failure: "truncated" }),
      draw(300),
    ]);
    /* The successful draws are 100 and 300. */
    expect(v.succeeded).toBe(2);
    expect(v.medianGivenSuccess).toBe(200);
    /* And the failed draw was still billed — a stopped run is not a refund. */
    expect(v.totalPaidNanos).toBe(1_300);
  });

  it("says null rather than zero when nothing succeeded", () => {
    const v = observedVariation([draw(500, { succeeded: false, failure: "bug" })]);
    expect(v.medianGivenSuccess).toBeNull();
    expect(v.totalPaidNanos).toBe(500);
  });

  it("has no draws at all without inventing a middle", () => {
    const v = observedVariation([]);
    expect(v).toEqual({
      draws: 0,
      median: null,
      min: null,
      max: null,
      range: null,
      succeeded: 0,
      failures: 0,
      failureKinds: {},
      medianGivenSuccess: null,
      totalPaidNanos: 0,
    });
  });

  /**
   * **The run that prompted the fix, arithmetic first.** Draw 1 of
   * evals/results/cost/2026-09-03-04-59-07-1bpfhts0-long-html succeeded at
   * $0.3260 and draw 2 was billed $0.2124 and failed its range check. The
   * summary was already right about this and the literals are here so it stays
   * right: the quotable number is the successful draw's, and the failed draw's
   * money is reported rather than dropped or averaged in.
   */
  it("quotes the successful draw and counts the failed one, on the real run's numbers", () => {
    const v = observedVariation([
      draw(326_049_500),
      draw(212_414_000, { succeeded: false, failure: "hierarchy error" }),
    ]);
    expect(v.succeeded).toBe(1);
    expect(v.failures).toBe(1);
    expect(v.failureKinds).toEqual({ "hierarchy error": 1 });
    expect(v.medianGivenSuccess).toBe(326_049_500);
    expect(v.totalPaidNanos).toBe(538_463_500);
    /* The median over *every* draw is deliberately not the quotable number, and
       it is printed because the spread is the thing the repeats exist to show. */
    expect(v.median).toBe(269_231_750);
  });

  it("reports no standard deviation and no tail, and this is the check that keeps it that way", () => {
    /* An exact key list rather than two `toBeUndefined`s: the failure mode is
       somebody *adding* a spread statistic, and only an exhaustive assertion
       notices an addition. docs/plans/…260902g § Principles. */
    expect(Object.keys(observedVariation([draw(100), draw(200)])).sort()).toEqual([
      "draws",
      "failureKinds",
      "failures",
      "max",
      "median",
      "medianGivenSuccess",
      "min",
      "range",
      "succeeded",
      "totalPaidNanos",
    ]);
  });
});

/**
 * **The variance paragraph, and the sentence it must not print.**
 *
 * A set where every draw failed still has a median and a range, and the ordinary
 * wording turns them into a confident-looking price for an article nobody got.
 * The run that made this reachable is
 * evals/results/cost/2026-09-03-04-59-07-1bpfhts0-long-html: once a failed draw
 * stops halting the sweep, a run of four failures is a shape this can be handed.
 */
describe("formatVariation", () => {
  const draw = (cost: number, over: Partial<DrawOutcome> = {}): DrawOutcome => ({
    label: "long-html",
    totalNanos: cost,
    succeeded: true,
    ...over,
  });

  it("reads as observed variation when some draws worked", () => {
    const out = formatVariation(
      "long-html",
      observedVariation([
        draw(326_049_500),
        draw(212_414_000, { succeeded: false, failure: "hierarchy error" }),
      ]),
    );
    expect(out).toContain("observed variation");
    expect(out).toContain("1 succeeded, 1 failed (1 hierarchy error)");
    expect(out).toContain("median given success");
  });

  it("refuses to quote a middle for a set where nothing succeeded", () => {
    const out = formatVariation(
      "long-html",
      observedVariation([
        draw(212_414_000, { succeeded: false, failure: "hierarchy error" }),
        draw(198_000_000, { succeeded: false, failure: "hierarchy error" }),
      ]),
    );
    expect(out).toContain("NOT ONE produced its artefact (2 hierarchy error)");
    expect(out).toContain("no cost to quote");
    expect(out).toContain("the price of failing");
    /* The two phrasings that would let a reader take the median as a cost. */
    expect(out).not.toContain("observed variation —");
    expect(out).not.toContain("succeeded, ");
  });

  it("still says what the failures cost, because a stop is not a refund", () => {
    const out = formatVariation(
      "long-html",
      observedVariation([draw(212_414_000, { succeeded: false, failure: "truncated" })]),
    );
    expect(out).toContain("all of them failures: $0.2124");
  });

  it("keeps the two forbidden statistics out of both paragraphs", () => {
    for (const succeeded of [true, false]) {
      const out = formatVariation("long-html", observedVariation([draw(100, { succeeded })]));
      expect(out).toContain("No tail probability and no standard deviation");
    }
  });

  it("says so plainly when there were no draws at all", () => {
    expect(formatVariation("long-html", observedVariation([]))).toBe("  long-html: no draws.");
  });
});
