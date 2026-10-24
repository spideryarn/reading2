/**
 * **The loader behind a citation's automatic *Does it say that?*, and the
 * refusals `runTurn` now reports with their details** — plan
 * docs/plans/261024m-citation-card-streams-a-note-on-what-this-paragraph-cites-the-work-for.md,
 * GPT Sol's C2 and the two-in-flight guard. tests/cite-check-card.test.tsx
 * drives the card; this pins the two pieces it rests on, with `apiFetch` the
 * only thing replaced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "../src/types.js";

const server = vi.hoisted(() => ({
  posts: 0,
  /** The next POST's answer; `null` holds the request open. */
  reply: null as null | { status: number; body: unknown },
}));

vi.mock("../src/web/lib/api.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/lib/api.js")>();
  return {
    ...real,
    apiFetch: (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return Promise.resolve(Response.json({ threads: [] }));
      server.posts++;
      if (server.reply === null) return new Promise<Response>(() => {});
      return Promise.resolve(
        new Response(JSON.stringify(server.reply.body), {
          status: server.reply.status,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  };
});

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      refreshSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));

const { runTurn } = await import("../src/web/chat/effects.js");
type TurnSink = import("../src/web/chat/effects.js").TurnSink;
const { forgetCiteChecks, startCiteCheck, MAX_IN_FLIGHT } = await import("../src/web/cite-check.js");

const THREAD = "spya-th7ead";

/** A sink that records how the turn ended. */
function recorder() {
  const seen: { refused?: [string, unknown]; failed?: string } = {};
  const sink: TurnSink = {
    began() {},
    delta() {},
    tool() {},
    done() {},
    failed: (error) => {
      seen.failed = error;
    },
    refused: (error, refusal) => {
      seen.refused = [error, refusal];
    },
    disconnected() {},
  };
  return { sink, seen };
}

beforeEach(() => {
  server.posts = 0;
  server.reply = null;
  forgetCiteChecks();
});

afterEach(() => forgetCiteChecks());

describe("runTurn's refusals carry their status and declared details (C2)", () => {
  it("a 409 naming an existing chat hands back its thread id", async () => {
    server.reply = { status: 409, body: { error: "Exists.", threadId: THREAD } };
    const { sink, seen } = recorder();
    await runTurn("a", "spya-new001", {}, sink);
    expect(seen.refused).toEqual(["Exists.", { status: 409, threadId: THREAD }]);
  });

  it("a cap's 429 and the global 503 are refusals with their reason, not failures", async () => {
    for (const [status, reason] of [
      [429, "hour"],
      [429, "day"],
      [429, "busy"],
      [503, "global"],
    ] as const) {
      server.reply = { status, body: { error: "Capped.", reason } };
      const { sink, seen } = recorder();
      await runTurn("a", "spya-new001", {}, sink);
      expect(seen.failed, `${status} ${reason} was reported as a failure`).toBeUndefined();
      expect(seen.refused).toEqual(["Capped.", { status, reason }]);
    }
  });

  it("drops a declared field that is not one it knows, and a bare 503 stays an uncertain failure", async () => {
    server.reply = { status: 409, body: { error: "No.", threadId: "not an id", reason: "whenever" } };
    const first = recorder();
    await runTurn("a", "spya-new001", {}, first.sink);
    expect(first.seen.refused).toEqual(["No.", { status: 409 }]);

    server.reply = { status: 503, body: { error: "Service unavailable." } };
    const second = recorder();
    await runTurn("a", "spya-new001", {}, second.sink);
    expect(second.seen.refused).toBeUndefined();
    expect(second.seen.failed).toBeDefined();
  });
});

describe("the loader", () => {
  const work = (id: string) => ({ id, title: `Work ${id}`, authors: "A", year: "2001" });
  const key = (workId: string) => ({ slug: "a", workId, blockId: "spya-k3m9qt" as BlockId });
  const settle = () => new Promise<void>((go) => setTimeout(go, 0));

  it(`keeps at most ${MAX_IN_FLIGHT} of its own checks in flight`, async () => {
    startCiteCheck(key("spya-w00001"), work("spya-w00001"), { auto: true });
    startCiteCheck(key("spya-w00002"), work("spya-w00002"), { auto: true });
    startCiteCheck(key("spya-w00003"), work("spya-w00003"), { auto: true });
    await settle();
    expect(server.posts).toBe(2);
  });

  it("is single-flight per key", async () => {
    startCiteCheck(key("spya-w00001"), work("spya-w00001"), { auto: true });
    startCiteCheck(key("spya-w00001"), work("spya-w00001"), { auto: true });
    await settle();
    expect(server.posts).toBe(1);
  });
});
