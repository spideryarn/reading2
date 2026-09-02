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
import { DEV_OWNER_ID, EVAL_OWNER_ID } from "../src/owner.js";
import { fixtureByName } from "../evals/cost/fixtures.js";
import {
  assertDistinctEvalOwner,
  assertOneOnDemandMode,
  blocksFromDetail,
  evalRegistry,
  evalScoped,
  localTarget,
  mustPayFor,
  requiredAiJobsFor,
  verifyFixtures,
  withoutTheInProcessPump,
} from "../evals/cost/harness.js";
import {
  aggregateByStep,
  checkCold,
  formatFindings,
  formatStepTable,
  jobWallClockMs,
  naiveTotal,
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
    costNanos: 12_345_678,
    upstreamCostNanos: null,
    providerAccount: "openrouter",
    computedCostNanos: null,
    priceVersion: null,
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
