/**
 * **One write chain per process, not one per copy of the module** — for the two
 * filesystem stores that keep one: the ledger
 * ([ai-calls-fs.ts](../src/store/ai-calls-fs.ts)) and the live-conversation
 * journal ([realtime-sessions-fs.ts](../src/store/realtime-sessions-fs.ts)).
 *
 * Each chain is a **lock**, and src/process-state.ts says what happens to a
 * lock kept at module scope: a second copy of it is not a slower lock, it is no
 * lock at all. A dev-server restart makes exactly that second copy —
 * vite.config.ts imports the API, so every server module is a config dependency
 * and saving one re-evaluates all of them, while the request already in flight
 * keeps running against the old one.
 * docs/postmortems/260902c-the-truncation-retry-cost-storm.md.
 *
 * ## Why this is its own file
 *
 * `vi.mock` hoists to the top of the file and applies to the whole of it, and
 * the mock here is `node:fs/promises` — which the sibling suites
 * (store-ai-calls.test.ts, and anything driving a real request) need to be
 * real. So the two cannot share a file.
 *
 * ## How the second copy is made, and why the assertion is on the write call
 *
 * `import("…?copy=2")` is a different module id, so the runtime builds a second
 * live instance rather than handing back the first — the same duplication the
 * dev server causes, on demand. What tells the two apart is not a corrupted
 * file: `appendFile` of a short string does not interleave often enough to be a
 * test, and the journal's lost update needs two reads to land between two
 * writes. It is **whether the second copy's write waits**. So the mocked
 * `appendFile` and `writeFile` each block on their first call and count the
 * rest: one chain means the second write has not started while the first is
 * still held, two chains means it has.
 *
 * Both cases went red on the module-scope version — the ledger's with
 * `expected [ …(2) ] to have a length of 1` — before either was converted.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AiCallRow } from "../src/ai-spend.js";
import type { RealtimeSession } from "../src/store/contracts.js";

/** Every line handed to `appendFile`, in the order the store asked for it. */
const appended: string[] = [];
/** Every payload handed to `writeFile`, likewise. */
const written: string[] = [];
/** Resolves the first call of each kind, which is held so the second is visible. */
const gates: { append?: () => void; write?: () => void } = {};

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    appendFile: async (file: Parameters<typeof actual.appendFile>[0], data: string) => {
      appended.push(data);
      /* The first caller is held until the test lets go, so "did the second one
         start?" has a stable answer. Everything after runs straight through. */
      if (appended.length === 1) await new Promise<void>((r) => (gates.append = r));
      await actual.appendFile(file, data, "utf8");
    },
    writeFile: async (file: Parameters<typeof actual.writeFile>[0], data: string) => {
      written.push(data);
      if (written.length === 1) await new Promise<void>((r) => (gates.write = r));
      await actual.writeFile(file, data, "utf8");
    },
  };
});

/**
 * Long enough that a second, independent chain would certainly have reached its
 * write — the chain does a `mkdir`, and the journal a `readFile`, before it.
 */
const SETTLE_MS = 150;
const settle = () => new Promise((r) => setTimeout(r, SETTLE_MS));

/**
 * A **second live instance** of a module, made the way a dev-server restart
 * makes one.
 *
 * The specifier is assembled rather than written out, and that is not style:
 * TypeScript resolves a literal one against the filesystem, where there is no
 * `ai-calls-fs.js?copy=2` to find, so a literal fails `npm run typecheck` with
 * `TS2307`. Built from a variable it is an ordinary runtime import, and the
 * type argument puts back what the cast took away — so the callers below still
 * get a checked `fsCostStore` rather than an `any`.
 */
async function copyOf<T>(path: string, copy: number): Promise<T> {
  const specifier = `${path}?copy=${copy}`;
  return (await import(specifier)) as T;
}

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "spya-write-chain-"));
  process.env.SPIDERYARN_LEDGER = path.join(dir, "ai-calls.jsonl");
  process.env.SPIDERYARN_REALTIME_JOURNAL = path.join(dir, "realtime-sessions.json");
});

afterAll(async () => {
  gates.append?.();
  gates.write?.();
  await rm(dir, { recursive: true, force: true });
  delete process.env.SPIDERYARN_LEDGER;
  delete process.env.SPIDERYARN_REALTIME_JOURNAL;
});

describe("the ledger", () => {
  /** A plausible finished call. Nothing here is what the test is about. */
  const row = (over: Partial<AiCallRow>): AiCallRow =>
    ({
      id: "00000000-0000-4000-8000-00000000f701",
      runId: "00000000-0000-4000-8000-00000000f711",
      generationId: null,
      scopeKind: "job_step",
      ownerId: "00000000-0000-4000-8000-00000000f7a0",
      articleSlug: "a-slug",
      jobId: "job-7",
      stepName: "hierarchy",
      wire: "messages",
      job: "hierarchy",
      requestedModel: "anthropic/claude-sonnet-5",
      answeredModel: "anthropic/claude-sonnet-5",
      upstream: "Anthropic",
      providerAccount: "openrouter",
      costSource: "provider",
      computedCostNanos: null,
      priceVersion: null,
      credentialFingerprint: "abcdef012345",
      startedAt: "2026-08-15T10:00:00.000Z",
      finishedAt: "2026-08-15T10:00:01.200Z",
      durationMs: 1200,
      outcome: "ok",
      creditsUsedNanos: 21_523_500,
      byokUpstreamNanos: null,
      isByok: false,
      ...over,
    }) as AiCallRow;

  it("serialises appends across two live copies of the module", async () => {
    /* Two module instances in one process, which is what a dev-server restart
       leaves behind. The query string is the whole trick: a different specifier
       is a different module id, so this is a real second evaluation and not the
       cached first one. */
    type Ledger = typeof import("../src/store/ai-calls-fs.js");
    const at = "../src/store/ai-calls-fs.js";
    const first = (await copyOf<Ledger>(at, 1)).fsCostStore;
    const second = (await copyOf<Ledger>(at, 2)).fsCostStore;
    expect(first).not.toBe(second);

    const a = first.record(row({ id: "00000000-0000-4000-8000-00000000f7a1" }));
    const b = second.record(row({ id: "00000000-0000-4000-8000-00000000f7a2" }));

    await settle();
    expect(appended).toHaveLength(1);

    gates.append?.();
    await Promise.all([a, b]);
    expect(appended).toHaveLength(2);
  });
});

describe("the live-conversation journal", () => {
  /** A session as `issue` stores it. */
  const session = (id: string): RealtimeSession => ({
    id,
    ownerId: "00000000-0000-4000-8000-00000000f7a0",
    articleSlug: "a-slug",
    threadId: null,
    model: "gpt-realtime",
    transcriptionModel: null,
    issuedAt: "2026-09-03T10:00:00.000Z",
    acceptsUntil: "2026-09-03T11:00:00.000Z",
    connectedAt: null,
    closedAt: null,
    closeReason: null,
  });

  it("serialises updates across two live copies of the module", async () => {
    /* **The lost update this prevents is worse than the ledger's.** That store
       appends; this one reads a whole JSON object, changes it and writes it
       back. Two chains means both copies read the same map and the second
       `writeFile` erases the first session entirely — a live token with nowhere
       to record what it spends. */
    type Journal = typeof import("../src/store/realtime-sessions-fs.js");
    const at = "../src/store/realtime-sessions-fs.js";
    const first = (await copyOf<Journal>(at, 1)).fsRealtimeSessionStore;
    const second = (await copyOf<Journal>(at, 2)).fsRealtimeSessionStore;
    expect(first).not.toBe(second);

    const a = first.issue(session("sess-a"));
    const b = second.issue(session("sess-b"));

    await settle();
    expect(written).toHaveLength(1);

    gates.write?.();
    await Promise.all([a, b]);
    expect(written).toHaveLength(2);
    /* And the point of serialising it: the second write carries both sessions,
       because it read the map the first one had already saved. */
    expect(written[1]).toContain("sess-a");
    expect(written[1]).toContain("sess-b");
  });
});
