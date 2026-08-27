/**
 * `/api/health` — **the one route a stranger can reach**, so the only one whose
 * cost and whose candour are anybody's business but ours.
 *
 * GPT Sol's review of the built auth code, 2026-08-27, item 2:
 *
 * > The application handlers are gated, but `vercel.ts` handles `/api/health`
 * > before the gate. GET and HEAD call `listArticles()` … That is not a cheap
 * > health query … An anonymous caller can repeatedly cause an expanding N+1
 * > workload.
 *
 * and item 10, on the tests that existed at the time:
 *
 * > There are no health endpoint tests covering public cost, raw diagnostics,
 * > HEAD, method behavior or oversized bodies.
 *
 * There are now. Four properties, and each of them was a real hole rather than
 * a hypothetical: the store check is cached so a flood costs one query per
 * window; the body probe answers 413 rather than a cheerful truncated 200; a
 * verb nobody implemented is 405 rather than a surprise; and a database error
 * reaches the caller trimmed, with the full text going to the server's own log
 * where it belongs.
 *
 * ## What is deliberately not asserted
 *
 * That the endpoint is *fast*. It is allowed to be slow the first time — it
 * talks to Postgres. What it is not allowed to be is slow *every* time, which
 * is what the cache test is about, and that is a count of calls rather than a
 * clock. A timing assertion here would be flaky on a loaded laptop and would
 * teach whoever hit it to raise the number.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { beforeEach, describe, expect, it, vi } from "vitest";

/** What `listArticles` was asked, and how often. The whole point of the cache. */
const listArticles = vi.fn(async () => [] as unknown[]);

vi.mock("../src/store/index.js", () => ({
  listArticles,
  STORE: "postgres",
}));

const { health } = await import("../src/vercel-health.js");

/** A request the handler can consume, body and all. */
function request(method: string, body?: string): IncomingMessage {
  const payload = body === undefined ? [] : [Buffer.from(body)];
  return Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url: "/api/health", headers: {}, destroy: vi.fn() },
  ) as unknown as IncomingMessage;
}

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  raw: string;
}

function reply(): { res: ServerResponse; read(): Reply } {
  let status = 200;
  let raw = "";
  const headers: Record<string, string> = {};
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    end(chunk?: string) {
      raw = chunk ?? "";
    },
  } as unknown as ServerResponse;
  return {
    res,
    read: () => ({
      status,
      headers,
      raw,
      body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
    }),
  };
}

async function call(method: string, body?: string): Promise<Reply> {
  const { res, read } = reply();
  await health(request(method, body), res);
  return read();
}

/**
 * **The cache lives in the module, so it outlives the test.**
 *
 * `beforeEach` clearing the spy is not enough: the second test would see a
 * warm cache from the first, call nothing, and "0 calls" would read as the
 * cache working when it is really the fixture leaking. So the clock walks
 * forward ten minutes between tests, which expires it for real — and every
 * test below can then assume a cold start without saying so.
 */
let clock = Date.UTC(2026, 7, 27, 12, 0, 0);

beforeEach(() => {
  listArticles.mockClear();
  listArticles.mockResolvedValue([]);
  clock += 10 * 60_000;
  vi.useFakeTimers();
  vi.setSystemTime(clock);
});

describe("what an anonymous caller can make the server do", () => {
  /**
   * **The amplifier.** `listArticles()` is not one query — it walks every
   * article, then does per-article block and comment work. Ungated and
   * uncached, a loop over `curl` is a database load generator that costs the
   * caller nothing.
   *
   * The fix is a 30-second window, so the answer to "how expensive is a flood"
   * stops being "linear in the flood".
   */
  it("does not run the store check once per request", async () => {
    await call("GET");
    await call("GET");
    await call("GET");
    expect(listArticles).toHaveBeenCalledTimes(1);
  });

  /** And it is a cache rather than a one-shot: it does refresh eventually. */
  it("does run it again once the window has passed", async () => {
    await call("GET");
    expect(listArticles).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(31_000);
    await call("GET");
    expect(listArticles).toHaveBeenCalledTimes(2);
  });

  /**
   * HEAD used to be exactly as expensive as GET while returning no body — the
   * cheapest possible way to spend somebody else's database.
   */
  it("costs no more for a HEAD than for a GET", async () => {
    await call("HEAD");
    await call("GET");
    expect(listArticles).toHaveBeenCalledTimes(1);
  });
});

describe("what it says back", () => {
  /**
   * A database error is a connection string, a hostname, sometimes an SSL
   * certificate subject. The operator needs all of it; a stranger needs to know
   * that something is wrong and nothing else.
   */
  it("does not hand a stranger the whole database error", async () => {
    const secret =
      "connect ECONNREFUSED 10.1.2.3:5432 — password authentication failed for user " +
      "postgres.abcdefghijklmnop ".repeat(20);
    listArticles.mockRejectedValue(new Error(secret));
    const seen = vi.spyOn(console, "error").mockImplementation(() => {});

    const answer = await call("GET");

    /* The whole thing must not be in there, and what IS in there is bounded.
       Asserted on the error field rather than on the whole response, because
       the rest of the body is runtime, region and commit — real diagnostics
       that are meant to be there, and folding them into one length budget
       makes this test fail the next time somebody adds a field. */
    expect(answer.raw).not.toContain(secret);
    const reported = JSON.stringify((answer.body.store as { error?: string }).error ?? "");
    expect(reported.length).toBeLessThanOrEqual(220);
    /* The operator still gets it — trimming the response is only safe if the
       full text is somewhere. If this ever stops being true the trim above
       becomes data loss rather than discretion. */
    expect(seen).toHaveBeenCalled();
    /* `JSON.stringify` rather than `join`, because it is logged as
       ("[health] …", { message }) and an object joins to "[object Object]" —
       which contains none of the words this asserts on and would have made the
       test pass for the wrong reason the moment the shape changed. */
    const logged = seen.mock.calls.map((args) => args.map((a) => JSON.stringify(a)).join(" ")).join(" ");
    expect(logged).toContain("ECONNREFUSED");
    seen.mockRestore();
  });

  it("says which store is live, because that is the first question", async () => {
    const answer = await call("GET");
    expect((answer.body.store as { name: string }).name).toBe("postgres");
  });

  it("is not cached by anything in between", async () => {
    const answer = await call("GET");
    expect(answer.headers["cache-control"]).toContain("no-store");
  });
});

describe("verbs and bodies", () => {
  it("turns away a verb it does not implement", async () => {
    const answer = await call("DELETE");
    expect(answer.status).toBe(405);
  });

  /**
   * **413, not a cheerful truncated 200.**
   *
   * The first version read the whole chunk, noticed it was over the cap, and
   * answered 200 with `truncated: true` — a storage cap wearing a transport
   * cap's name. It accepted everything and told the sender they had succeeded.
   * GPT Sol, 2026-08-27.
   */
  it("refuses a body larger than it is willing to read", async () => {
    const answer = await call("POST", "x".repeat(9 * 1024));
    expect(answer.status).toBe(413);
    expect(answer.body.ok).toBe(false);
  });

  /** And an ordinary body still works, or the cap above proves nothing. */
  it("accepts one that fits", async () => {
    const answer = await call("POST", JSON.stringify({ hello: "world" }));
    expect(answer.status).toBe(200);
    expect(answer.body.bytes).toBeGreaterThan(0);
  });
});
