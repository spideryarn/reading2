/** Coordinator evidence only; jobs-walk supplies the real Postgres settlement checks. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdvanceParts } from "../src/jobs.js";
import type { PipelineStep, StepContext, StepProduct } from "../src/pipeline.js";
import type { JobEndTransition, StoreSession } from "../src/store/session.js";
import type { Job, OwnerId, StepName } from "../src/types.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";
import { memoryCheckpoints } from "./helpers/memory-checkpoints.js";

let row: Job;
let noteFailure: ((call: number) => void) | undefined;
let beginFailure: Error | undefined;
let skipName: StepName | undefined;
let notes = 0;
let begins = 0;
let pauses = 0;
let commits: StepName[] = [];
let ran: StepName[] = [];
let pauseAnswer: "requeued" | "cancelled" | "stale" | "budget-spent" = "requeued";
const OWNER = "e12df81d-7f2c-4fc2-9b2f-0c27bb2e3462" as OwnerId;

vi.mock("../src/store/pg-jobs.js", () => ({ pgJobStore: {
  settleExpired: async () => [],
  claim: async () => { row.status = "running"; return { kind: "claimed", job: structuredClone(row) }; },
  get: async () => structuredClone(row),
  noteProgress: async (_id: string, _attempt: string, steps: Job["steps"], title?: string) => {
    noteFailure?.(++notes);
    row.steps = structuredClone(steps);
    if (title?.trim()) row.title = title;
    return structuredClone(row);
  },
  requestCancel: async () => { row.cancelling = true; return structuredClone(row); },
  trimFinished: async () => 0,
  pauseForDeadline: async (_id: string, _attempt: string, budget: number) => {
    pauses++;
    if (pauseAnswer !== "requeued") return { kind: pauseAnswer };
    if ((row.requeues ?? 0) >= budget) return { kind: "budget-spent" };
    row.status = "queued";
    row.requeues = (row.requeues ?? 0) + 1;
    row.steps = row.steps.map((s) => s.status === "running" ? { ...s, status: "pending" } : s);
    return { kind: "requeued", job: structuredClone(row) };
  },
} }));
vi.mock("../src/store/ai-calls.js", async (original) => ({
  ...(await original<typeof import("../src/store/ai-calls.js")>()),
  costStore: { record: async () => {}, forJob: async () => ({ rows: [], unreadable: 0 }) },
}));

const { advanceJobWith, cancelJob, DEADLINE_MARGIN_MS, REQUEUE_BUDGET } = await import("../src/jobs.js");
const { STEPS } = await import("../src/pipeline.js");
const { StaleAttemptError } = await import("../src/store/jobs.js");
const { CallDeadlineReached } = await import("../src/call-failure.js");
const { runAsOwner } = await import("../src/owner.js");

function fixture(
  names: StepName[],
  body: (ctx: StepContext, name: StepName) => Promise<StepProduct>,
  hooks: { power?: AdvanceParts["power"]; beforeBegin?: (name: StepName) => Promise<void> } = {},
) {
  row.steps = names.map((name) => ({ name, label: STEPS[name].label, status: "pending", force: true }));
  const settle = async (transition: JobEndTransition) => {
    row = { ...row, ...transition.ending };
    return { kind: "ended" as const, job: structuredClone(row), ending: transition.ending };
  };
  const reads = memoryArtefacts();
  reads.has = async (_slug, name) => name === skipName;
  const session: StoreSession = {
    reads,
    checkpoints: memoryCheckpoints({ articleId: "offline", slug: row.slug }),
    beginStep: async (_slug, name) => {
      begins++;
      if (beginFailure) throw beginFailure;
      await hooks.beforeBegin?.(name);
      return "step-attempt";
    },
    commit: async (_ctx, step, _attempt, _product, transition) => {
      commits.push(step.name);
      if (transition.kind === "end") return settle(transition);
      if (transition.kind !== "keep") throw new Error("unexpected release in offline fixture");
      /* What the Postgres session does with a `keep`: the steps it is handed
         go on the row with the product (`keepStepIn`). */
      row.steps = structuredClone(transition.steps);
      return { kind: "kept" };
    },
    settleJob: settle,
  };
  const steps: Partial<Record<StepName, PipelineStep>> = {};
  for (const name of names) {
    steps[name] = { name, label: STEPS[name].label, produces: [], run: async (ctx: StepContext) => {
      ran.push(name);
      const product = await body(ctx, name);
      return { ...product, parts: product.parts ?? {} };
    } };
  }
  const parts: AdvanceParts = {
    steps: { ...STEPS, ...steps } as AdvanceParts["steps"],
    session: async () => session, power: hooks.power ?? (async () => "standard"),
  };
  return (short = false) => runAsOwner(OWNER, () => advanceJobWith(row.id, {
    ...parts, ...(short && { leaseMs: DEADLINE_MARGIN_MS + 100 }),
  }));
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_800_000_000_000 });
  row = { id: "offline-job", ownerId: OWNER, slug: "offline", status: "queued", steps: [], createdAt: new Date().toISOString() };
  notes = begins = pauses = 0;
  commits = []; ran = [];
  noteFailure = undefined; beginFailure = undefined; skipName = undefined; pauseAnswer = "requeued";
});
afterEach(() => vi.useRealTimers());

describe("Tier 0 queue decisions without Postgres", () => {
  it.each(["extract", "metadata"] as const)("keeps an existing title when %s returns an empty detail", async (name) => {
    row.title = "Stored title";
    const advance = fixture([name], async () => ({ detail: "" }));
    expect((await advance())?.job.title).toBe("Stored title");
  });

  it("rejects every late product before commit and preserves earlier commits", async () => {
    const advance = fixture(["fetch", "metadata"], async (ctx, name) => {
      if (name === "metadata") await vi.advanceTimersByTimeAsync(800_000);
      expect(name === "fetch" || ctx.signal.aborted).toBe(true);
      return { detail: name };
    });
    const result = await advance();
    expect(commits).toEqual(["fetch"]);
    expect(pauses).toBe(1);
    expect(result?.job.status).toBe("queued");
  });

  it.each(["cancelled", "stale", "budget-spent"] as const)("uses the %s pause answer after a late return", async (answer) => {
    pauseAnswer = answer;
    const advance = fixture(["fetch"], async () => {
      await vi.advanceTimersByTimeAsync(200);
      return { detail: "late" };
    });
    const result = await advance(true);
    expect(commits).toEqual([]);
    expect(pauses).toBe(1);
    expect(result?.job.status).toBe(answer === "cancelled" ? "cancelled" : answer === "stale" ? "running" : "error");
    expect(result?.busy).toBe(answer === "stale");
    expect(result?.done).toBe(answer !== "stale");
  });

  it("ends repeated deadline returns after the shared requeue budget is spent", async () => {
    const advance = fixture(["fetch"], async () => {
      await vi.advanceTimersByTimeAsync(200);
      return { detail: "late" };
    });
    for (let n = 0; n < REQUEUE_BUDGET; n++) expect((await advance(true))?.done).toBe(false);
    expect((await advance(true))?.job.status).toBe("error");
    expect(pauses).toBe(REQUEUE_BUDGET + 1);
    expect(commits).toEqual([]);
  });

  it("spends nothing when a swallowed driver failure is followed by a refused beginStep", async () => {
    noteFailure = () => { throw new Error("connection lost"); };
    beginFailure = new StaleAttemptError(row.id);
    const advance = fixture(["fetch"], async () => ({ detail: "spent" }));
    expect((await advance())?.busy).toBe(true);
    expect(begins).toBe(1);
    expect(ran).toEqual([]);
  });

  it("spends nothing when the database remains down at beginStep", async () => {
    noteFailure = () => { throw new Error("connection lost"); };
    beginFailure = new Error("database unavailable");
    const advance = fixture(["fetch"], async () => ({ detail: "spent" }));
    expect((await advance())?.job.status).toBe("error");
    expect(ran).toEqual([]);
  });

  it("honours a Stop returned by the next starting write after a kept progress write failed", async () => {
    noteFailure = (call) => {
      if (call === 2) { row.cancelling = true; throw new Error("progress write lost"); }
    };
    const advance = fixture(["fetch", "metadata"], async (_ctx, name) => ({ detail: name }));
    expect((await advance())?.job.status).toBe("cancelled");
    expect(ran).toEqual(["fetch"]);
    expect(begins).toBe(1);
  });

  /* Greg, 2026-10-07: a Stop during the last step, when the step finishes
     anyway, keeps and publishes the article whichever server it reached.
     docs/plans/261007f-stop-during-the-last-step-keeps-and-publishes.md. */
  it.each(["remote", "local"] as const)("keeps the article when a %s Stop lands during a last step that returns", async (where) => {
    const advance = fixture(["fetch"], async () => {
      if (where === "local") await cancelJob(row.id);
      else row.cancelling = true;
      return { detail: "finished" };
    });
    expect((await advance())?.job.status).toBe("done");
    expect(commits).toEqual(["fetch"]);
  });

  it("still ends the job cancelled when a local Stop lands during an earlier step that returns", async () => {
    const advance = fixture(["fetch", "metadata"], async (_ctx, name) => {
      if (name === "fetch") await cancelJob(row.id);
      return { detail: name };
    });
    expect((await advance())?.job.status).toBe("cancelled");
    expect(ran).toEqual(["fetch"]);
  });

  it("settles a local Stop during an earlier step without relying on another progress write or preflight", async () => {
    let powerReads = 0;
    noteFailure = (call) => { if (call > 1) throw new Error("later writes unavailable"); };
    const advance = fixture(["fetch", "metadata"], async (_ctx, name) => {
      if (name === "fetch") await cancelJob(row.id);
      return { detail: name };
    }, {
      power: async () => { powerReads++; return "standard"; },
    });
    expect((await advance())?.job.status).toBe("cancelled");
    expect(ran).toEqual(["fetch"]);
    expect(powerReads, "the local abort must settle before any more asynchronous preparation").toBe(1);
  });

  it.each(["deadline-first", "stop-first"] as const)("preserves the first abort reason for %s", async (order) => {
    pauseAnswer = "cancelled";
    let firstReason: unknown;
    let finalReason: unknown;
    const advance = fixture(["fetch"], async (ctx) => {
      if (order === "stop-first") await cancelJob(row.id);
      await vi.advanceTimersByTimeAsync(200);
      firstReason = ctx.signal.reason;
      if (order === "deadline-first") await cancelJob(row.id);
      finalReason = ctx.signal.reason;
      return { detail: "finished" };
    });
    expect((await advance(true))?.job.status).toBe(order === "deadline-first" ? "cancelled" : "done");
    /* Assertions belong outside the step: the runner catches its throws. */
    expect(finalReason).toBe(firstReason);
    expect(firstReason).toBeInstanceOf(order === "deadline-first" ? CallDeadlineReached : DOMException);
    expect(commits).toEqual(order === "deadline-first" ? [] : ["fetch"]);
    expect(pauses).toBe(order === "deadline-first" ? 1 : 0);
  });

  it("does not start the last step after a local Stop in its preflight, even if its starting note fails", async () => {
    let powerReads = 0;
    noteFailure = (call) => { if (call === 3) throw new Error("starting write lost"); };
    const advance = fixture(["fetch", "metadata"], async (_ctx, name) => ({ detail: name }), {
      power: async () => {
        if (++powerReads === 2) await cancelJob(row.id);
        return "standard";
      },
    });
    expect((await advance())?.job.status).toBe("cancelled");
    expect(ran).toEqual(["fetch"]);
    expect(commits).toEqual(["fetch"]);
    expect(begins, "a step refused in its preflight never opens a marker").toBe(1);
  });

  it("does not start the last step's work after a local Stop while beginStep is opening", async () => {
    const advance = fixture(["fetch", "metadata"], async (_ctx, name) => ({ detail: name }), {
      beforeBegin: async (name) => { if (name === "metadata") await cancelJob(row.id); },
    });
    expect((await advance())?.job.status).toBe("cancelled");
    expect(ran).toEqual(["fetch"]);
    expect(commits).toEqual(["fetch"]);
  });

  it("rejects a product that forbids retention under abort when Stop lands after run returns", async () => {
    const spend = await import("../src/ai-spend.js");
    const realCollectSpend = spend.collectSpend;
    const spy = vi.spyOn(spend, "collectSpend").mockImplementation(async (...args) => {
      const result = await realCollectSpend(...args);
      /* A completed run can still be awaiting ledger/preview settlement. */
      await cancelJob(row.id);
      return result;
    });
    try {
      const advance = fixture(["fetch"], async () => ({ detail: "partial", discardOnAbort: true }));
      expect((await advance())?.job.status).toBe("cancelled");
      expect(ran).toEqual(["fetch"]);
      expect(commits).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("honours a Stop returned by a final skipped note after a kept progress write failed", async () => {
    noteFailure = (call) => {
      if (call === 2) { row.cancelling = true; throw new Error("progress write lost"); }
    };
    const advance = fixture(["fetch", "metadata"], async (_ctx, name) => ({ detail: name }));
    skipName = "metadata";
    row.steps[1]!.force = false;
    expect((await advance())?.job.status).toBe("cancelled");
    expect(ran).toEqual(["fetch"]);
    expect(notes).toBe(3);
  });

  /* The coordinator's half of the receipt: the steps it hands the commit say
     the forced step is `done`. GPT Sol wrote this as a characterisation of the
     defect (`extract` twice, stored `pending`) when the commit carried nothing;
     the store's half is in tests/jobs-walk.test.ts, against Postgres. */
  it("hands the commit a forced step's done status, so lost progress writes cannot buy it twice", async () => {
    noteFailure = (call) => { if (call === 2 || call === 3) throw new Error("progress write lost"); };
    let late = true;
    const advance = fixture(["extract", "metadata"], async (_ctx, name) => {
      if (name === "metadata" && late) {
        late = false;
        await vi.advanceTimersByTimeAsync(800_000);
      }
      return { detail: name };
    });
    /* The artefact is current, but forcing it must still run it on the first
       claim. Only the job's durable done status can spend that force request. */
    skipName = "extract";
    expect((await advance())?.job.status).toBe("queued");
    expect(commits).toEqual(["extract"]);
    expect(row.steps[0]).toMatchObject({ name: "extract", status: "done", force: true });
    expect((await advance())?.job.status).toBe("done");
    expect(ran).toEqual(["extract", "metadata", "metadata"]);
  });
});
