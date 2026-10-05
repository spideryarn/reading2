/**
 * The cost analysis — [src/cost-analysis.ts](../src/cost-analysis.ts) — over
 * hand-built ledger rows. No database: the two reads it consumes are held in
 * tests/cost-detail-store.test.ts.
 *
 * Each lead has a fixture built to fire it and one built not to, and the
 * figures a lead reports are worked out by hand beside the fixture.
 */

import { describe, expect, it } from "vitest";

import {
  ARTICLE_OUTLIER_MIN_NANOS,
  CACHE_MIN_CALLS,
  CALL_OUTLIER_MIN_NANOS,
  type CostAnalysis,
  type CostAnalysisInput,
  CostReadsDisagree,
  P95_MIN_CALLS,
  type Lead,
  type UnpricedLookup,
  analyseCosts,
  cacheUseOf,
  detailIsUnpriced,
} from "../src/cost-analysis.js";
import type { CostCubeGroup } from "../src/cost-cube.js";
import type { SpendDetailRow } from "../src/store/ai-calls-spend-pg.js";

const ME = "c057a11a-0000-4000-8000-000000000001";
const THEM = "c057a11b-0000-4000-8000-000000000002";
const DOLLAR = 1_000_000_000;
const CENT = 10_000_000;

let next = 0;

/** One call. Defaults: mine, a priced `glossary` step on the Messages wire, 1 cent. */
function call(over: Partial<SpendDetailRow> = {}): SpendDetailRow {
  next++;
  return {
    id: `call-${String(next).padStart(4, "0")}`,
    runId: `run-${next}`,
    jobId: `job-${next}`,
    generationId: `gen-${next}`,
    startedAt: "2031-03-10T10:00:00.000Z",
    ownerId: ME,
    articleId: "c057a11c-0000-4000-8000-000000000001",
    articleSlug: "my-own-article",
    recordedSlugHash: null,
    scopeKind: "job_step",
    job: "glossary",
    stepName: "glossary",
    wire: "messages",
    requestedModel: "anthropic/claude-sonnet-5",
    answeredModel: "anthropic/claude-sonnet-5",
    upstream: "Anthropic",
    providerAccount: "openrouter",
    costSource: "provider",
    isByok: false,
    outcome: "ok",
    eventKind: null,
    creditsUsedNanos: CENT,
    byokUpstreamNanos: null,
    computedCostNanos: null,
    reportedInputTokens: 1000,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    webSearches: null,
    durationMs: 1000,
    ...over,
  };
}

/** Somebody else's article: an opaque id and no slug, as `spendDetail` returns it. */
function theirs(n: number, over: Partial<SpendDetailRow> = {}): SpendDetailRow {
  return call({
    ownerId: THEM,
    articleId: `${String(n).padStart(8, "0")}-0000-4000-8000-00000000000b`,
    articleSlug: null,
    ...over,
  });
}

/**
 * The cube `spendCube` would return for these calls: grouped by every cube
 * dimension, with `UNPRICED_CALLS`'s rule written out again rather than
 * borrowed from the module under test.
 */
function cubeOf(detail: readonly SpendDetailRow[]): CostCubeGroup[] {
  const groups = new Map<string, CostCubeGroup>();
  for (const r of detail) {
    const dims = {
      day: r.startedAt.slice(0, 10),
      ownerId: r.ownerId,
      articleId: r.articleId,
      articleSlug: r.articleSlug,
      recordedSlugHash: r.recordedSlugHash,
      scopeKind: r.scopeKind,
      job: r.job,
      stepName: r.stepName,
      wire: r.wire,
      requestedModel: r.requestedModel,
      answeredModel: r.answeredModel,
      upstream: r.upstream,
      providerAccount: r.providerAccount,
      costSource: r.costSource,
      isByok: r.isByok,
      outcome: r.outcome,
    };
    const key = JSON.stringify(dims);
    const g =
      groups.get(key) ??
      ({
        ...dims,
        calls: 0,
        creditsNanos: 0,
        byokNanos: 0,
        computedNanos: 0,
        unpricedCalls: 0,
        computedCalls: 0,
        settledCalls: 0,
      } satisfies CostCubeGroup);
    g.calls++;
    g.creditsNanos += r.creditsUsedNanos ?? 0;
    g.byokNanos += r.byokUpstreamNanos ?? 0;
    g.computedNanos += r.computedCostNanos ?? 0;
    if (r.costSource === "computed") g.computedCalls++;
    if (r.costSource === "provider") g.settledCalls++;
    const missing = r.isByok === true ? r.byokUpstreamNanos === null : r.creditsUsedNanos === null;
    if (r.costSource !== "computed" && missing) g.unpricedCalls++;
    groups.set(key, g);
  }
  return [...groups.values()];
}

function analyse(detail: readonly SpendDetailRow[], over: Partial<CostAnalysisInput> = {}): CostAnalysis {
  return analyseCosts({
    target: { kind: "local", description: "a fixture" },
    window: { since: null, until: null, label: "all recorded calls" },
    generatedAt: "2031-04-01T00:00:00.000Z",
    cube: cubeOf(detail),
    detail,
    emails: new Map([[ME, "me@example.test"]]),
    userLabels: "emails from a fixture",
    includeNonProduct: false,
    top: 15,
    lookups: null,
    ...over,
  });
}

function lead(analysis: CostAnalysis, id: string): Lead | undefined {
  return analysis.leads.find((l) => l.id === id);
}

function fact(found: Lead | undefined, label: string): unknown {
  const value = found?.evidence.facts.find((f) => f.label === label)?.value;
  if (!value) return undefined;
  return value.kind === "money" ? value.nanos : value.kind === "count" ? value.count : value;
}

function many(n: number, over: Partial<SpendDetailRow> = {}): SpendDetailRow[] {
  return Array.from({ length: n }, () => call(over));
}

let batch = 0;

/** `n` calls, `perJob` of them to each job: a step that makes several calls over one article. */
function inJobs(n: number, perJob: number, over: Partial<SpendDetailRow> = {}): SpendDetailRow[] {
  batch++;
  return Array.from({ length: n }, (_, i) =>
    call({ jobId: `batch-${batch}-job-${Math.floor(i / perJob)}`, ...over }),
  );
}

describe("the totals", () => {
  const detail = [
    call({ creditsUsedNanos: 100 * CENT }),
    call({ creditsUsedNanos: 0, byokUpstreamNanos: 30 * CENT, isByok: true }),
    call({ costSource: "computed", creditsUsedNanos: null, computedCostNanos: 20 * CENT }),
    call({ costSource: "none", creditsUsedNanos: null, outcome: "aborted" }),
    call({ outcome: "error", creditsUsedNanos: 5 * CENT, startedAt: "2031-03-12T23:59:59.000Z" }),
  ];
  const { totals } = analyse(detail);

  it("keeps the three pockets apart and adds them once", () => {
    expect(totals).toMatchObject({
      creditsNanos: 105 * CENT,
      byokNanos: 30 * CENT,
      computedNanos: 20 * CENT,
      recordedNanos: 155 * CENT,
    });
  });

  it("puts the fee on credits only", () => {
    expect(totals.estimatedCashNanos).toBe(Math.round(105 * CENT * 1.055) + 50 * CENT);
  });

  it("counts priced, unpriced and unfinished calls, and the unfinished ones' money", () => {
    expect(totals).toMatchObject({
      calls: 5,
      pricedCalls: 4,
      unpricedCalls: 1,
      failedCalls: 2,
      failedRecordedNanos: 5 * CENT,
      firstDay: "2031-03-10",
      lastDay: "2031-03-12",
    });
  });

  it("reads an unpriced row by which pocket it should have filled", () => {
    expect(detailIsUnpriced(call({ isByok: true, creditsUsedNanos: 0, byokUpstreamNanos: null }))).toBe(true);
    expect(detailIsUnpriced(call({ isByok: null, creditsUsedNanos: null }))).toBe(true);
    expect(detailIsUnpriced(call({ costSource: "computed", creditsUsedNanos: null }))).toBe(false);
    expect(detailIsUnpriced(call({ creditsUsedNanos: 0 }))).toBe(false);
  });
});

describe("the two reads", () => {
  const detail = [call(), call({ creditsUsedNanos: 3 * CENT })];

  it("throws when the cube holds one nano-dollar more than the detail rows", () => {
    const cube = cubeOf(detail);
    (cube[0] as CostCubeGroup).creditsNanos += 1;
    expect(() => analyse(detail, { cube })).toThrow(CostReadsDisagree);
    expect(() => analyse(detail, { cube })).toThrow(/credits pocket/);
  });

  it("throws when a call is in one read and not the other", () => {
    expect(() => analyse(detail, { cube: cubeOf([...detail, call({ creditsUsedNanos: 0 })]) })).toThrow(
      /number of calls/,
    );
  });

  it("throws on a difference in each of the other pockets, and in what counts as unpriced", () => {
    const withByok = cubeOf(detail);
    (withByok[0] as CostCubeGroup).byokNanos += 1;
    expect(() => analyse(detail, { cube: withByok })).toThrow(/BYOK pocket/);
    const withComputed = cubeOf(detail);
    (withComputed[0] as CostCubeGroup).computedNanos += 1;
    expect(() => analyse(detail, { cube: withComputed })).toThrow(/computed pocket/);
    const withUnpriced = cubeOf(detail);
    (withUnpriced[0] as CostCubeGroup).unpricedCalls += 1;
    expect(() => analyse(detail, { cube: withUnpriced })).toThrow(/unpriced calls/);
  });

  it("accepts two reads that agree", () => {
    expect(analyse(detail).totals.calls).toBe(2);
  });

  const groupingChanges = [
    ["UTC day", { startedAt: "2031-03-11T10:00:00.000Z" }],
    ["owner", { ownerId: THEM }],
    ["article id", { articleId: "c057a11c-0000-4000-8000-000000000099" }],
    ["visible slug", { articleSlug: "a-different-own-article" }],
    ["masked slug hash", { articleSlug: null, recordedSlugHash: "e".repeat(64) }],
    ["scope", { scopeKind: "request" }],
    ["job", { job: "chat" }],
    ["step", { stepName: "a-different-step" }],
    ["wire", { wire: "chat" }],
    ["requested model", { requestedModel: "openai/gpt-6-luna" }],
    ["answered model", { answeredModel: "openai/gpt-6-luna" }],
    ["upstream", { upstream: "OpenAI" }],
    ["provider account", { providerAccount: "openai" }],
    ["cost source", { costSource: "other" }],
    ["BYOK status", { isByok: null }],
    ["outcome", { outcome: "error" }],
  ] satisfies [string, Partial<SpendDetailRow>][];

  it.each(groupingChanges)(
    "rejects a different %s population even when the grand totals agree",
    (_name, changed) => {
      const cube = cubeOf(detail);
      const different = detail.map((row, index) => (index === 0 ? { ...row, ...changed } : row));
      expect(() => analyse(different, { cube })).toThrow(/grouped population/);
    },
  );
});

describe("the scope", () => {
  const detail = [
    call({ creditsUsedNanos: 10 * CENT }),
    call({ scopeKind: "request", job: "chat", stepName: null, creditsUsedNanos: 20 * CENT }),
    call({ scopeKind: "eval", job: "chat", stepName: null, creditsUsedNanos: 400 * CENT }),
    call({ scopeKind: "cli", creditsUsedNanos: 300 * CENT }),
  ];

  it("leaves evals and the CLI out by default, and says how much that was", () => {
    const analysis = analyse(detail);
    expect(analysis.scope).toBe("product");
    expect(analysis.totals).toMatchObject({ calls: 2, recordedNanos: 30 * CENT });
    expect(analysis.excluded).toEqual({ calls: 2, recordedNanos: 700 * CENT });
    expect(analysis.tasks.reduce((n, t) => n + t.calls, 0)).toBe(2);
    expect(analysis.overTime.categories).not.toContain("non-product");
  });

  it("includes them when asked", () => {
    const analysis = analyse(detail, { includeNonProduct: true });
    expect(analysis.scope).toBe("all");
    expect(analysis.totals).toMatchObject({ calls: 4, recordedNanos: 730 * CENT });
    expect(analysis.excluded).toEqual({ calls: 0, recordedNanos: 0 });
    expect(analysis.overTime.categories).toContain("non-product");
  });

  it("keeps a lead to product calls too", () => {
    const stopped = [...detail, call({ scopeKind: "eval", outcome: "error", creditsUsedNanos: 50 * CENT })];
    expect(lead(analyse(stopped), "not-finished")).toBeUndefined();
    expect(lead(analyse(stopped, { includeNonProduct: true }), "not-finished")?.amountNanos).toBe(50 * CENT);
  });
});

describe("the rankings", () => {
  const detail = [
    ...many(3, { creditsUsedNanos: 10 * CENT }),
    call({ job: "structure", stepName: "structure", creditsUsedNanos: 50 * CENT, answeredModel: "anthropic/claude-opus-5" }),
    call({ scopeKind: "request", job: "chat", stepName: null, wire: "chat", creditsUsedNanos: 5 * CENT }),
    call({ scopeKind: "request", job: "dictation", stepName: null, articleId: null, articleSlug: null, creditsUsedNanos: 2 * CENT }),
    theirs(1, { creditsUsedNanos: 13 * CENT }),
    theirs(2, { creditsUsedNanos: 7 * CENT, articleId: null, recordedSlugHash: "f".repeat(64) }),
  ];
  const analysis = analyse(detail);

  it("ranks every user, with a share and their three largest tasks", () => {
    expect(analysis.users.map((u) => [u.label, u.recordedNanos])).toEqual([
      ["me@example.test", 87 * CENT],
      ["user c057a11b", 20 * CENT],
    ]);
    expect(analysis.users[0]?.share).toBeCloseTo(87 / 107);
    expect(analysis.users[0]?.topTasks.map((t) => t.label)).toEqual(["structure", "glossary", "chat"]);
    expect(analysis.users[0]?.topTasks[0]?.share).toBeCloseTo(50 / 87);
  });

  it("explains an article by task and by model, and counts its jobs and calls", () => {
    const mine = analysis.articles.top[0];
    expect(mine).toMatchObject({ label: "my-own-article", owner: "me@example.test", calls: 5, jobs: 5 });
    expect(mine?.recordedNanos).toBe(85 * CENT);
    expect(mine?.byTask.map((t) => [t.label, t.recordedNanos])).toEqual([
      ["structure", 50 * CENT],
      ["glossary", 30 * CENT],
      ["chat", 5 * CENT],
    ]);
    expect(mine?.byModel.map((m) => [m.label, m.recordedNanos])).toEqual([
      ["anthropic/claude-opus-5", 50 * CENT],
      ["anthropic/claude-sonnet-5", 35 * CENT],
    ]);
  });

  it("compares each article with the median article, and leaves 'no article' out of both", () => {
    /* Three articles: 85, 13 and 7 cents. Nearest-rank median: 13. */
    expect(analysis.articles).toMatchObject({ count: 3, medianNanos: 13 * CENT });
    expect(analysis.articles.noArticle).toEqual({ calls: 1, recordedNanos: 2 * CENT });
    expect(analysis.articles.top[0]?.timesMedian).toBeCloseTo(85 / 13);
    expect(analysis.articles.top.map((a) => a.label)).toEqual([
      "my-own-article",
      "article 00000001",
      "recorded article ffffffff",
    ]);
  });

  it("gives --top that many articles their breakdown", () => {
    expect(analyse(detail, { top: 1 }).articles.top).toHaveLength(1);
    expect(analyse(detail, { top: 1 }).articles.count).toBe(3);
  });

  it("ranks every task with its articles, its category and the models that answered", () => {
    const glossary = analysis.tasks.find((t) => t.label === "glossary");
    expect(glossary).toMatchObject({ calls: 5, articles: 3, recordedNanos: 50 * CENT });
    expect(glossary?.categories).toHaveLength(1);
    expect(glossary?.models).toEqual([
      expect.objectContaining({ label: "anthropic/claude-sonnet-5", share: 1 }),
    ]);
    expect(analysis.tasks.map((t) => t.label)).toEqual(["glossary", "structure", "chat", "dictation"]);
    expect(analysis.tasks.find((t) => t.label === "chat")?.categories).toEqual(["interactive request work"]);
  });

  it("ranks every answering model with the tasks that use it", () => {
    expect(analysis.models.map((m) => m.label)).toEqual(["anthropic/claude-sonnet-5", "anthropic/claude-opus-5"]);
    expect(analysis.models[0]?.tasks.map((t) => t.label)).toEqual(["glossary", "chat", "dictation"]);
  });
});

describe("amount per priced call", () => {
  it("is the median, p95 and max of the calls themselves, not a group average", () => {
    /* Twenty priced calls of 1..20 cents, and one unpriced that must not count. */
    const detail = [
      ...Array.from({ length: 20 }, (_, i) => call({ creditsUsedNanos: (i + 1) * CENT })),
      call({ costSource: "none", creditsUsedNanos: null }),
    ];
    const glossary = analyse(detail).tasks[0];
    expect(glossary).toMatchObject({ calls: 21, pricedCalls: 20, unpricedCalls: 1 });
    /* Nearest rank: the 10th, the 19th and the 20th of twenty. */
    expect(glossary?.perCall).toEqual({ medianNanos: 10 * CENT, p95Nanos: 19 * CENT, maxNanos: 20 * CENT, calls: 20 });
  });

  it("says how many priced calls the figures rest on, so a p95 of a few calls can be withheld", () => {
    const few = analyse(many(P95_MIN_CALLS - 1)).tasks[0]?.perCall;
    expect(few?.calls).toBe(P95_MIN_CALLS - 1);
    /* The number stays in the data. */
    expect(few?.p95Nanos).toBe(CENT);
    expect(P95_MIN_CALLS).toBe(20);
  });

  it("is absent when no call was priced", () => {
    const detail = many(2, { costSource: "none", creditsUsedNanos: null });
    expect(analyse(detail).tasks[0]?.perCall).toBeNull();
  });
});

describe("over time", () => {
  it("has every UTC day from the first call to the last, by category", () => {
    const analysis = analyse([
      call({ startedAt: "2031-03-10T23:59:59.000Z", creditsUsedNanos: 4 * CENT }),
      call({ startedAt: "2031-03-13T00:00:00.000Z", scopeKind: "request", job: "chat", stepName: null, creditsUsedNanos: 6 * CENT }),
    ]);
    expect(analysis.overTime.days).toEqual(["2031-03-10", "2031-03-11", "2031-03-12", "2031-03-13"]);
    expect(analysis.overTime.categories[0]).toBe("interactive request work");
    expect(analysis.overTime.nanos["2031-03-13"]).toEqual({ "interactive request work": 6 * CENT });
    expect(Object.values(analysis.overTime.nanos["2031-03-10"] ?? {})).toEqual([4 * CENT]);
    expect(analysis.overTime.nanos["2031-03-11"]).toBeUndefined();
  });
});

describe("lead: a step bought in more than one job for one article", () => {
  const one = { jobId: "job-A" };
  const two = { jobId: "job-B" };
  const three = { jobId: "job-C" };

  it("fires on distinct jobs for one article and step, and reports all but the most expensive", () => {
    const detail = [
      /* glossary on my article: jobs of 30 (two calls), 50 and 20 cents. */
      call({ ...one, creditsUsedNanos: 10 * CENT }),
      call({ ...one, creditsUsedNanos: 20 * CENT }),
      call({ ...two, creditsUsedNanos: 50 * CENT }),
      call({ ...three, creditsUsedNanos: 20 * CENT }),
      /* structure on it: one job. */
      call({ ...one, job: "structure", stepName: "structure", creditsUsedNanos: 99 * CENT }),
      /* glossary on somebody else's: one job. */
      theirs(1, { ...one, creditsUsedNanos: 40 * CENT }),
    ];
    const found = lead(analyse(detail), "step-in-several-jobs");
    expect(found?.confidence).toBe("measured");
    expect(found?.amountNanos).toBe(50 * CENT);
    expect(fact(found, "Article-steps bought in more than one job")).toBe(1);
    expect(fact(found, "Article-steps with a job at all")).toBe(3);
    expect(fact(found, "Extra jobs")).toBe(2);
    expect(fact(found, "Recorded on those article-steps, every job")).toBe(100 * CENT);
    expect(found?.detail).toMatch(/bought in more than one job/);
    expect(`${found?.title} ${found?.detail}`).not.toMatch(/re-?run|wasted/i);
    expect(found?.detail).toMatch(/does not show/);
  });

  it("stays silent when every article-step has one job, however many calls or collectors", () => {
    const detail = [
      call({ ...one, runId: "run-x" }),
      call({ ...one, runId: "run-y" }),
      call({ ...two, job: "structure", stepName: "structure" }),
      theirs(1, { ...two }),
    ];
    expect(lead(analyse(detail), "step-in-several-jobs")).toBeUndefined();
  });

  it("does not count request work, a call with no job, or a call with no article", () => {
    const detail = [
      call({ ...one, scopeKind: "request", job: "chat", stepName: null }),
      call({ ...two, scopeKind: "request", job: "chat", stepName: null }),
      call({ jobId: null }),
      call({ jobId: null }),
      call({ ...one, articleId: null, articleSlug: null }),
      call({ ...two, articleId: null, articleSlug: null }),
    ];
    expect(lead(analyse(detail), "step-in-several-jobs")).toBeUndefined();
  });

  it("tells two articles under one slug apart: the opaque key, and the first and last day of the jobs", () => {
    const afternoon = { articleSlug: "same-slug", creditsUsedNanos: 10 * CENT };
    const detail = [
      /* The live article: two jobs an hour apart. */
      call({ ...afternoon, jobId: "job-A", startedAt: "2031-03-10T10:00:00.000Z" }),
      call({ ...afternoon, jobId: "job-B", startedAt: "2031-03-10T11:00:00.000Z" }),
      /* A recorded name with no id, same slug: two jobs three weeks apart. */
      call({ ...afternoon, articleId: null, recordedSlugHash: "b7c1".repeat(16), jobId: "job-C", startedAt: "2031-02-01T23:59:00.000Z" }),
      call({ ...afternoon, articleId: null, recordedSlugHash: "b7c1".repeat(16), jobId: "job-D", startedAt: "2031-02-22T00:00:00.000Z", creditsUsedNanos: 20 * CENT }),
    ];
    const found = lead(analyse(detail), "step-in-several-jobs");
    expect(found?.evidence.table?.columns).toEqual([
      "Article",
      "Article key",
      "Step",
      "Jobs",
      "First job (UTC day)",
      "Last job (UTC day)",
      "Every job",
      "All but the most expensive",
    ]);
    const rows = found?.evidence.table?.rows.map((r) => r.slice(0, 6).map((c) => (c.kind === "text" ? c.text : c.kind === "count" ? c.count : c)));
    expect(rows).toEqual([
      ["same-slug", "recorded article b7c1b7c1", "glossary", 2, "2031-02-01", "2031-02-22"],
      ["same-slug", "article c057a11c", "glossary", 2, "2031-03-10", "2031-03-10"],
    ]);
  });

  it("gives somebody else's article its opaque key in both columns", () => {
    const detail = [theirs(7, { jobId: "job-A" }), theirs(7, { jobId: "job-B" })];
    const row = lead(analyse(detail), "step-in-several-jobs")?.evidence.table?.rows[0];
    expect(row?.slice(0, 2)).toEqual([
      { kind: "text", text: "article 00000007" },
      { kind: "text", text: "article 00000007" },
    ]);
  });

  it("keeps two owners' recorded articles apart", () => {
    const detail = [
      call({ ...one, articleId: null, recordedSlugHash: "c".repeat(64) }),
      theirs(1, { ...two, articleId: null, recordedSlugHash: "c".repeat(64) }),
    ];
    expect(lead(analyse(detail), "step-in-several-jobs")).toBeUndefined();
  });
});

describe("lead: money on calls that did not finish", () => {
  it("fires with the recorded amount and count, by task, and says it is under-recorded", () => {
    const detail = [
      call(),
      call({ outcome: "error", creditsUsedNanos: 7 * CENT }),
      call({ outcome: "aborted", costSource: "none", creditsUsedNanos: null, scopeKind: "request", job: "chat", stepName: null }),
    ];
    const found = lead(analyse(detail), "not-finished");
    expect(found?.amountNanos).toBe(7 * CENT);
    expect(fact(found, "Calls that did not finish")).toBe(2);
    expect(fact(found, "Of them, reporting no money")).toBe(1);
    expect(found?.evidence.table?.rows.map((r) => r[0])).toEqual([
      { kind: "text", text: "glossary" },
      { kind: "text", text: "chat" },
    ]);
    expect(found?.detail).toMatch(/floor/);
    expect(found?.detail).toMatch(/does not show/);
  });

  it("stays silent when every call finished", () => {
    expect(lead(analyse(many(3)), "not-finished")).toBeUndefined();
  });
});

describe("lead: calls that reported no money", () => {
  const unpriced = [
    call({ id: "u-found-credits", costSource: "none", creditsUsedNanos: null, outcome: "aborted" }),
    call({ id: "u-found-byok", scopeKind: "request", job: "dictation", stepName: null, wire: "transcription", answeredModel: "openai/gpt-transcribe", creditsUsedNanos: null }),
    call({ id: "u-no-record", costSource: "none", creditsUsedNanos: null }),
    call({ id: "u-failed", costSource: "none", creditsUsedNanos: null }),
    call({ id: "u-not-asked", costSource: "none", creditsUsedNanos: null }),
    call({ id: "u-no-id", costSource: "none", creditsUsedNanos: null, generationId: null }),
  ];
  const detail = [call(), ...unpriced];

  it("fires by task and model, and says the shortfall is unknown when nobody asked", () => {
    const analysis = analyse(detail);
    const found = lead(analysis, "unpriced");
    expect(fact(found, "Calls reporting no money")).toBe(6);
    expect(fact(found, "Of them, with a generation id")).toBe(5);
    expect(found?.amountNanos).toBe(0);
    expect(found?.detail).toMatch(/unknown, not zero/);
    expect(analysis.lookup).toBeNull();
    expect(found?.evidence.table?.columns).not.toContain("Known shortfall");
    expect(found?.evidence.table?.rows).toHaveLength(2);
  });

  it("totals what OpenRouter's records say, and never reads a failed lookup as zero", () => {
    const lookups = new Map<string, UnpricedLookup>([
      ["u-found-credits", { kind: "found", creditsNanos: 40 * CENT, upstreamNanos: 0 }],
      ["u-found-byok", { kind: "found", creditsNanos: 0, upstreamNanos: 3 * CENT }],
      ["u-no-record", { kind: "no-record" }],
      ["u-failed", { kind: "failed" }],
    ]);
    const analysis = analyse(detail, { lookups });
    expect(analysis.lookup).toEqual({
      unpricedCalls: 6,
      noGenerationId: 1,
      notAsked: 1,
      asked: 4,
      found: 2,
      noRecord: 1,
      failed: 1,
      creditsNanos: 40 * CENT,
      upstreamNanos: 3 * CENT,
      knownShortfallNanos: 43 * CENT,
    });
    const found = lead(analysis, "unpriced");
    expect(found?.amountNanos).toBe(43 * CENT);
    expect(fact(found, "Could not check")).toBe(1);
    expect(fact(found, "Known shortfall")).toBe(43 * CENT);
    expect(found?.detail).toMatch(/1 could not be checked/);
    /* The dictation group's own shortfall is in its row. */
    const dictation = found?.evidence.table?.rows.find((r) => r[0]?.kind === "text" && r[0].text === "dictation");
    expect(dictation?.[4]).toEqual({ kind: "money", nanos: 3 * CENT });
  });

  it("ignores a lookup for a call that was priced after all", () => {
    const priced = call({ id: "priced" });
    const lookups = new Map<string, UnpricedLookup>([["priced", { kind: "found", creditsNanos: DOLLAR, upstreamNanos: 0 }]]);
    const analysis = analyse([priced], { lookups });
    expect(lead(analysis, "unpriced")).toBeUndefined();
    expect(analysis.lookup?.knownShortfallNanos).toBe(0);
  });

  it("stays silent when every call was priced", () => {
    expect(lead(analyse(many(3)), "unpriced")).toBeUndefined();
  });
});

describe("lead: articles far above the median article", () => {
  /* Four of somebody's articles at 20 cents each; the median is 20 cents. */
  const ordinary = [1, 2, 3, 4].map((n) => theirs(n, { creditsUsedNanos: 20 * CENT }));

  it("fires at five times the median and half a dollar, naming the task responsible", () => {
    const detail = [
      ...ordinary,
      call({ creditsUsedNanos: 30 * CENT }),
      call({ job: "illustrate", stepName: "illustrated", creditsUsedNanos: 70 * CENT }),
    ];
    const found = lead(analyse(detail), "article-outliers");
    expect(fact(found, "Articles far above the median")).toBe(1);
    expect(fact(found, "Median article")).toBe(20 * CENT);
    /* 100 cents against a 20-cent median. */
    expect(found?.amountNanos).toBe(80 * CENT);
    expect(found?.evidence.table?.rows[0]).toEqual([
      { kind: "text", text: "my-own-article" },
      { kind: "money", nanos: 100 * CENT },
      { kind: "times", times: 5 },
      { kind: "text", text: "illustrated" },
      { kind: "money", nanos: 70 * CENT },
      { kind: "share", share: 0.7 },
    ]);
    expect(found?.detail).toMatch(/does not show/);
  });

  it("stays silent just under five times the median", () => {
    const detail = [...ordinary, call({ creditsUsedNanos: 100 * CENT - 1 })];
    expect(lead(analyse(detail), "article-outliers")).toBeUndefined();
  });

  it("stays silent under half a dollar, however many times the median", () => {
    const cheap = [1, 2, 3, 4].map((n) => theirs(n, { creditsUsedNanos: CENT }));
    const detail = [...cheap, call({ creditsUsedNanos: ARTICLE_OUTLIER_MIN_NANOS - 1 })];
    expect(lead(analyse(detail), "article-outliers")).toBeUndefined();
    const at = [...cheap, call({ creditsUsedNanos: ARTICLE_OUTLIER_MIN_NANOS })];
    expect(fact(lead(analyse(at), "article-outliers"), "Articles far above the median")).toBe(1);
  });
});

describe("lead: single calls far above their task's median call", () => {
  /* Nine glossary calls at 3 cents: the task's median stays 3 cents with a tenth. */
  const ordinary = many(9, { creditsUsedNanos: 3 * CENT });

  it("fires at ten times the task's median and a quarter of a dollar, naming the call", () => {
    const big = call({ id: "the-big-call", creditsUsedNanos: 30 * CENT, answeredModel: "anthropic/claude-opus-5" });
    const found = lead(analyse([...ordinary, big]), "call-outliers");
    expect(found?.amountNanos).toBe(27 * CENT);
    expect(found?.evidence.table?.rows).toEqual([
      [
        { kind: "text", text: "glossary" },
        { kind: "text", text: "anthropic/claude-opus-5" },
        { kind: "text", text: "my-own-article" },
        { kind: "text", text: "the-big-call" },
        { kind: "money", nanos: 30 * CENT },
        { kind: "times", times: 10 },
      ],
    ]);
  });

  it("stays silent just under ten times the median", () => {
    expect(lead(analyse([...ordinary, call({ creditsUsedNanos: 30 * CENT - 1 })]), "call-outliers")).toBeUndefined();
  });

  it("stays silent under a quarter of a dollar, however many times the median", () => {
    const cheap = many(9, { creditsUsedNanos: CENT });
    expect(lead(analyse([...cheap, call({ creditsUsedNanos: CALL_OUTLIER_MIN_NANOS - 1 })]), "call-outliers")).toBeUndefined();
    expect(lead(analyse([...cheap, call({ creditsUsedNanos: CALL_OUTLIER_MIN_NANOS })]), "call-outliers")).toBeDefined();
  });

  it("measures a call against its own task, not another's", () => {
    /* An expensive task whose every call is 40 cents is not ten times itself. */
    const detail = [...ordinary, ...many(3, { job: "structure", stepName: "structure", creditsUsedNanos: 40 * CENT })];
    expect(lead(analyse(detail), "call-outliers")).toBeUndefined();
  });
});

describe("lead: cache use, inside one wire", () => {
  const dear = { creditsUsedNanos: 10 * CENT };

  it("divides by the Messages wire's own prompt total: input plus cache read plus cache write", () => {
    const [use] = cacheUseOf([
      call({ reportedInputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 600 }),
      call({ reportedInputTokens: 500, cacheReadTokens: 500, cacheWriteTokens: 0 }),
    ]);
    expect(use).toMatchObject({ task: "glossary", wire: "messages", calls: 2 });
    expect(use?.cacheReadShare).toBeCloseTo(800 / 2000);
  });

  it("divides by the chat wire's reported input, which already includes the cached tokens", () => {
    const [use] = cacheUseOf([
      call({ wire: "chat", reportedInputTokens: 1000, cacheReadTokens: 250, cacheWriteTokens: 600 }),
    ]);
    expect(use?.cacheReadShare).toBeCloseTo(0.25);
  });

  it("gives a task on both wires two figures, never one", () => {
    const uses = cacheUseOf([
      call({ wire: "messages", reportedInputTokens: 100, cacheReadTokens: 900 }),
      call({ wire: "chat", reportedInputTokens: 1000, cacheReadTokens: 100 }),
    ]);
    expect(uses).toHaveLength(2);
    expect(uses.map((u) => [u.wire, u.cacheReadShare]).sort()).toEqual([
      ["chat", 0.1],
      ["messages", 0.9],
    ]);
  });

  it("has no figure for a wire that reports no such tokens, or when there were none", () => {
    expect(cacheUseOf([call({ wire: "embeddings" }), call({ wire: "realtime" })])).toEqual([]);
    expect(cacheUseOf([call({ reportedInputTokens: null, cacheReadTokens: null })])[0]?.cacheReadShare).toBeNull();
  });

  it("flags twenty calls, a dollar and under a tenth read from cache, as suggestive", () => {
    const detail = inJobs(CACHE_MIN_CALLS, 4, { ...dear, reportedInputTokens: 950, cacheReadTokens: 50 });
    const found = lead(analyse(detail), "low-cache-reuse");
    expect(found?.confidence).toBe("suggestive");
    expect(found?.amountNanos).toBe(200 * CENT);
    expect(found?.evidence.table?.rows[0]?.slice(0, 3)).toEqual([
      { kind: "text", text: "glossary" },
      { kind: "text", text: "messages" },
      { kind: "count", count: 20 },
    ]);
    expect(found?.detail).toMatch(/does not show/);
  });

  it("stays silent at a tenth, at nineteen calls, and under a dollar", () => {
    const reused = inJobs(CACHE_MIN_CALLS, 4, { ...dear, reportedInputTokens: 900, cacheReadTokens: 100 });
    expect(lead(analyse(reused), "low-cache-reuse")).toBeUndefined();
    const few = inJobs(CACHE_MIN_CALLS - 1, 4, { ...dear, reportedInputTokens: 1000, cacheReadTokens: 0 });
    expect(lead(analyse(few), "low-cache-reuse")).toBeUndefined();
    const cheap = inJobs(CACHE_MIN_CALLS, 4, { creditsUsedNanos: 5 * CENT - 1, reportedInputTokens: 1000, cacheReadTokens: 0 });
    expect(lead(analyse(cheap), "low-cache-reuse")).toBeUndefined();
  });

  it("does not flag a task that makes one call per job, however little it reads from cache", () => {
    /* Twenty jobs of one call each: nothing inside a job to reuse. */
    const single = many(CACHE_MIN_CALLS, { ...dear, reportedInputTokens: 1000, cacheReadTokens: 0 });
    const analysis = analyse(single);
    expect(analysis.cacheUse).toEqual([
      expect.objectContaining({ task: "glossary", calls: 20, medianCallsPerJob: 1, cacheReadShare: 0, flagged: false }),
    ]);
    expect(lead(analysis, "low-cache-reuse")).toBeUndefined();
  });

  it("flags one that makes several calls per job, and its table carries every pair, flagged or not", () => {
    const detail = [
      ...inJobs(CACHE_MIN_CALLS, 4, { ...dear, reportedInputTokens: 1000, cacheReadTokens: 0 }),
      ...many(CACHE_MIN_CALLS, { ...dear, job: "structure", stepName: "structure", reportedInputTokens: 1000, cacheReadTokens: 0 }),
      /* Three calls only: under every threshold, and still listed. */
      ...many(3, { job: "arc", stepName: "arc", reportedInputTokens: 1000, cacheReadTokens: 500 }),
    ];
    const analysis = analyse(detail);
    const found = lead(analysis, "low-cache-reuse");
    expect(fact(found, "Flagged")).toBe(1);
    expect(fact(found, "Pairs of mode or task and wire, all listed")).toBe(3);
    expect(found?.amountNanos).toBe(200 * CENT);
    expect(found?.evidence.table?.columns).toEqual([
      "Mode or task",
      "Wire",
      "Calls",
      "Calls per job (median)",
      "Articles",
      "Recorded",
      "Cache-read share of prompt tokens",
      "Flagged",
    ]);
    expect(found?.evidence.table?.omitted).toBe(0);
    expect(found?.evidence.table?.rows.map((r) => [r[0], r[3], r[7]])).toEqual([
      [{ kind: "text", text: "glossary" }, { kind: "count", count: 4 }, { kind: "text", text: "flagged" }],
      [{ kind: "text", text: "structure" }, { kind: "count", count: 1 }, { kind: "text", text: "" }],
      [{ kind: "text", text: "arc" }, { kind: "count", count: 1 }, { kind: "text", text: "" }],
    ]);
    expect(found?.detail).toMatch(/several calls/);
    expect(found?.detail).toMatch(/one call per job has nothing to reuse/);
  });

  it("counts calls per job by job id, by run for request work with none, and alone with neither", () => {
    const uses = cacheUseOf([
      /* Jobs of 3 and 1; runs of 2 and 2: sizes 1, 2, 2, 3. Nearest-rank median 2. */
      ...inJobs(3, 3),
      call(),
      ...["run-a", "run-a", "run-b", "run-b"].map((runId) => call({ jobId: null, runId })),
    ]);
    expect(uses[0]?.medianCallsPerJob).toBe(2);
    /* A job id and a run id that happen to be spelled alike are two groups. */
    expect(cacheUseOf([call({ jobId: "same" }), call({ jobId: null, runId: "same" })])[0]?.medianCallsPerJob).toBe(1);
    expect(cacheUseOf([call({ jobId: null, runId: "" }), call({ jobId: null, runId: "" })])[0]?.medianCallsPerJob).toBe(1);
  });

  it("does not let one wire's reuse hide the other's lack of it", () => {
    const detail = [
      ...inJobs(CACHE_MIN_CALLS, 4, { ...dear, wire: "messages", reportedInputTokens: 1000, cacheReadTokens: 0 }),
      ...inJobs(CACHE_MIN_CALLS, 4, { ...dear, wire: "chat", reportedInputTokens: 1000, cacheReadTokens: 990 }),
    ];
    const analysis = analyse(detail);
    expect(analysis.cacheUse.map((u) => [u.wire, u.flagged]).sort()).toEqual([
      ["chat", false],
      ["messages", true],
    ]);
    expect(fact(lead(analysis, "low-cache-reuse"), "Flagged")).toBe(1);
  });
});

describe("lead: where each model is used", () => {
  it("is the task-by-model table with each model's share of its task, and claims no amount", () => {
    const detail = [
      call({ creditsUsedNanos: 30 * CENT, answeredModel: "anthropic/claude-opus-5" }),
      call({ creditsUsedNanos: 10 * CENT }),
      call({ scopeKind: "request", job: "chat", stepName: null, creditsUsedNanos: 5 * CENT }),
    ];
    const found = lead(analyse(detail), "model-by-task");
    expect(found?.amountNanos).toBe(0);
    expect(found?.evidence.table?.rows).toEqual([
      [
        { kind: "text", text: "glossary" },
        { kind: "text", text: "anthropic/claude-opus-5" },
        { kind: "count", count: 1 },
        { kind: "money", nanos: 30 * CENT },
        { kind: "share", share: 0.75 },
        { kind: "text", text: "largest share of this task" },
      ],
      [
        { kind: "text", text: "glossary" },
        { kind: "text", text: "anthropic/claude-sonnet-5" },
        { kind: "count", count: 1 },
        { kind: "money", nanos: 10 * CENT },
        { kind: "share", share: 0.25 },
        { kind: "text", text: "" },
      ],
      [
        { kind: "text", text: "chat" },
        { kind: "text", text: "anthropic/claude-sonnet-5" },
        { kind: "count", count: 1 },
        { kind: "money", nanos: 5 * CENT },
        { kind: "share", share: 1 },
        { kind: "text", text: "largest share of this task" },
      ],
    ]);
    expect(found?.detail).toMatch(/does not show/);
  });

  it("is absent from an empty ledger, like every other lead", () => {
    expect(analyse([]).leads).toEqual([]);
    expect(analyse([]).totals).toMatchObject({ calls: 0, recordedNanos: 0, firstDay: null, lastDay: null });
  });
});

describe("the leads together", () => {
  it("are sorted by the amount at stake, and each says what it does not show", () => {
    const detail = [
      call({ jobId: "job-A", creditsUsedNanos: 60 * CENT }),
      call({ jobId: "job-B", creditsUsedNanos: 90 * CENT }),
      call({ outcome: "error", creditsUsedNanos: 5 * CENT, jobId: "job-A" }),
      call({ costSource: "none", creditsUsedNanos: null, jobId: "job-A" }),
    ];
    const { leads } = analyse(detail);
    expect(leads.map((l) => l.id)).toEqual(["step-in-several-jobs", "not-finished", "unpriced", "model-by-task"]);
    const amounts = leads.map((l) => l.amountNanos);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    for (const l of leads) expect(l.detail, l.id).toMatch(/does not show/);
  });

  it("is plain data: it survives JSON unchanged", () => {
    const analysis = analyse([call(), theirs(1, { outcome: "error" })]);
    expect(JSON.parse(JSON.stringify(analysis))).toEqual(analysis);
  });
});
