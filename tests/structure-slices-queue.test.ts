/** Offline queue wiring: real walk, pipeline and structure; fake storage protocols and model. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessagesBody } from "../src/messages-stream.js";
import type { StepContext, StepProduct } from "../src/pipeline.js";
import type { JobEndTransition, StoreSession } from "../src/store/session.js";
import type { Job, OwnerId } from "../src/types.js";
import { askedIds, isRootCall, messageOf, ROOT_ANSWER, sectionsAnswer } from "./helpers/slice-model.js";
import { paragraphs } from "./helpers/bounded-tree.js";
import { memoryCheckpoints } from "./helpers/memory-checkpoints.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";

let job: Job;
let product: StepProduct | undefined;
let context: StepContext | undefined;
let modelCalls = 0;
let hang = false;
/** What each hanging call's signal was aborted with, in order. */
let stops: unknown[] = [];
vi.mock("../src/store/pg-jobs.js", () => ({ pgJobStore: {
  settleExpired: async () => [],
  claim: async () => { job.status = "running"; return { kind: "claimed", job }; },
  noteProgress: async () => job,
  get: async () => job,
  requestCancel: async () => { job.cancelling = true; return job; },
  trimFinished: async () => {},
} }));
vi.mock("../src/store/ai-calls.js", async (original) => ({
  ...(await original<typeof import("../src/store/ai-calls.js")>()),
  costStore: { record: async () => {}, forJob: async () => ({ rows: [], unreadable: 0 }) },
}));
vi.mock("../src/messages-stream.js", async (original) => ({
  ...(await original<typeof import("../src/messages-stream.js")>()),
  streamMessage: (_task: string, params: MessagesBody, opts: { signal: AbortSignal }) => {
    modelCalls++;
    return {
      attempts: () => 1,
      finalMessage: async () => {
        if (hang && !isRootCall(params)) {
          await new Promise<never>((_, reject) => {
            opts.signal.addEventListener("abort", () => {
              stops.push(opts.signal.reason);
              reject(new Error("aborted"));
            }, { once: true });
          });
        }
        return messageOf(isRootCall(params) ? ROOT_ANSWER : sectionsAnswer(askedIds(params)));
      },
    };
  },
}));

const { advanceJobWith, cancelJob, DEADLINE_MARGIN_MS, STEP_BUDGET_MS } = await import("../src/jobs.js");
const { STEPS } = await import("../src/pipeline.js");
const { runAsOwner } = await import("../src/owner.js");
const { SLICE_CALL_CAP_MS } = await import("../src/structure-slices.js");
const { CallDeadlineReached, abortClass } = await import("../src/call-failure.js");
const OWNER = "51ce5e0e-0000-4000-8000-0000000000e1" as OwnerId;
const blocks = paragraphs(3000);

const settle = async (transition: JobEndTransition) => {
  job.status = transition.ending.status;
  return { kind: "ended" as const, job, ending: transition.ending };
};
const session = (): StoreSession => {
  const reads = memoryArtefacts();
  reads.read = async (_slug, _step, kind) => {
    if (kind === "blocks") return { blocks } as never;
    if (kind === "meta") return { title: "Queue book" } as never;
    return null;
  };
  return {
    reads,
    checkpoints: memoryCheckpoints({ articleId: "queue", slug: "queue" }),
    beginStep: async () => "step-attempt",
    commit: async (ctx, _step, _attempt, made, transition) => {
      context = ctx;
      product = made;
      if (transition.kind !== "end") throw new Error("expected terminal structure-only job");
      return settle(transition);
    },
    settleJob: settle,
  };
};
const advance = (leaseMs: number) => runAsOwner(OWNER, () => advanceJobWith(job.id, {
  session: async () => session(),
  steps: { ...STEPS, structure: { ...STEPS.structure, run: async (ctx, reads, checkpoints) => {
    context = ctx;
    return STEPS.structure.run(ctx, reads, checkpoints);
  } } },
  leaseMs,
  power: async () => "standard",
}));

beforeEach(() => {
  vi.useFakeTimers({ now: 1_800_000_000_000 });
  product = undefined;
  context = undefined;
  modelCalls = 0;
  hang = false;
  stops = [];
  job = { id: "queue-job", ownerId: OWNER, slug: "queue", status: "queued", createdAt: new Date().toISOString(),
    steps: [{ name: "structure", label: STEPS.structure.label, status: "pending", force: true }] };
});
afterEach(() => { vi.useRealTimers(); });

describe("stage E through the queue without a database", () => {
  it("passes the structure budget and returns D before a short queue deadline", async () => {
    const out = await advance(DEADLINE_MARGIN_MS + 300_000);
    expect(context!.stepBudgetMs).toBe(STEP_BUDGET_MS.structure);
    expect(out).toMatchObject({ done: true, job: { status: "done" } });
    expect(modelCalls).toBe(0);
    expect(product!.detail).toContain("from its headings (too long for one answer; there was not time to read it in parts)");
    expect(product!.parts!.tree!.provisional).toBe("headings");
    expect(context!.signal!.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a capped call returns D and commits before the queue aborts", async () => {
    hang = true;
    const going = advance(DEADLINE_MARGIN_MS + 340_000);
    await vi.advanceTimersByTimeAsync(SLICE_CALL_CAP_MS);
    const out = await going;
    expect(out).toMatchObject({ done: true, job: { status: "done" } });
    expect(product!.parts!.tree!.provisional).toBe("headings");
    expect(context!.signal!.aborted).toBe(false);
    expect(Date.now()).toBeLessThan(context!.deadlineAt!);
    expect(vi.getTimerCount()).toBe(0);
    /* Plan 261006d, F15: the per-call cap is our deadline, and the gateway can
       only know that from the reason the call's signal carries. */
    expect(stops.length).toBeGreaterThan(0);
    expect(stops.map((reason) => reason instanceof CallDeadlineReached)).toEqual(stops.map(() => true));
    expect(stops.map(abortClass)).toEqual(stops.map(() => "deadline"));
  });

  it("a reader Stop cancels the queue and commits no structure product", async () => {
    hang = true;
    const going = advance(DEADLINE_MARGIN_MS + 340_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(modelCalls).toBe(3);
    await runAsOwner(OWNER, () => cancelJob(job.id));
    const out = await going;
    expect(out).toMatchObject({ done: true, job: { status: "cancelled" } });
    expect(product).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    /* The caller's own reason reaches each call, not a fresh one made here:
       whoever stopped the queue is who the call's row should name. */
    expect(stops.length).toBe(3);
    expect(context!.signal!.aborted).toBe(true);
    expect(stops.map((reason) => reason === context!.signal!.reason)).toEqual([true, true, true]);
    expect(stops.map(abortClass)).toEqual(["abort", "abort", "abort"]);
  });
});
