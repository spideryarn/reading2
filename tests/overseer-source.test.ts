/**
 * The source: the dashboard's stream, the poll behind it, and the difference
 * between them being visible.
 *
 * **A fallback that happens silently is the failure, not the fallback.** The
 * Overseer reading `/api/state` every fifteen seconds because the stream died
 * three hours ago is a fact about the box, and if nothing writes it down the
 * only evidence is a history that is slightly coarser than it should be —
 * which nobody notices. So every one of these tests is about the source SAYING
 * what transport it is on and when that changed, not about the payload getting
 * through.
 *
 * A REAL HTTP SERVER, not a mocked `fetch`. The thing being tested is stream
 * framing across chunk boundaries and what happens when a socket goes away
 * mid-body, and a stubbed fetch would be a test of the stub. Each server binds
 * port 0 and is closed in `afterEach`, so nothing here collides with the fleet
 * dashboard on 8787 (which is running on this box and belongs to somebody else).
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, test, vi } from "vitest";

import { fleetSource, sseFrames, type SourceMessage } from "../tools/overseer/source.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

type Fleet = {
  url: string;
  /** Push a snapshot to every live stream subscriber, the way `broadcast()` does. */
  push(body: string): void;
  /** The heartbeat `startHeartbeat()` sends: proof of life carrying no snapshot. */
  ping(): void;
  /** Drop every stream connection, the way a restart or a proxy timeout does. */
  dropStreams(): void;
  streamCount(): number;
};

/** A stand-in for `tools/fleet/server.ts`: the two routes the Overseer reads. */
function fakeFleet(options: {
  state: () => { status: number; body: string };
  stream?: "serve" | "404";
  /** Accept the poll and never answer it — the hang, as opposed to the refusal. */
  hangState?: boolean;
  /** Serve the stream's headers and then never send a byte, heartbeat included. */
  silentStream?: boolean;
  /**
   * Refuse the stream with an error status and then **never finish the body**.
   *
   * The trap: `fetch` resolves on the headers, so the reader sees `!ok` and
   * goes to drain the body — and a body that never ends never drains. This is
   * the shape a reverse proxy in trouble produces, and it parks the Overseer's
   * only loop before the poll fallback has been reached.
   */
  streamErrorHangingBody?: boolean;
  /** The same trap one route over: an error status on the poll, body unfinished. */
  stateErrorHangingBody?: boolean;
  /** Stream bytes for ever without ever terminating a frame. */
  streamNeverTerminatesFrame?: boolean;
}): Promise<Fleet> {
  const subscribers = new Set<ServerResponse>();
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/api/live")) {
      if (options.streamErrorHangingBody === true) {
        res.writeHead(503, { "content-type": "text/plain" });
        res.flushHeaders();
        res.write("upstream is having a bad time");
        return; // and never `end()`
      }
      if (options.streamNeverTerminatesFrame === true) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.flushHeaders();
        res.write("event: snapshot\ndata: ");
        const timer = setInterval(() => res.write("x".repeat(2048)), 1);
        timer.unref();
        req.on("close", () => clearInterval(timer));
        return;
      }
      if (options.silentStream === true) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.flushHeaders();
        return;
      }
      if (options.stream === "404") {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found\n");
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      // As `live.ts` does, and for its stated reason: without a flush, Node
      // holds the headers until the first frame, so `fetch` does not resolve
      // and a subscriber cannot tell "connected, waiting" from "not connected".
      res.flushHeaders();
      subscribers.add(res);
      req.on("close", () => subscribers.delete(res));
      return;
    }
    if (url.startsWith("/api/state")) {
      if (options.hangState === true) return;
      if (options.stateErrorHangingBody === true) {
        res.writeHead(502, { "content-type": "text/html" });
        res.flushHeaders();
        res.write("<html><body>bad gateway");
        return; // and never `end()`
      }
      const { status, body } = options.state();
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body);
      return;
    }
    res.writeHead(404).end();
  });
  servers.push(server);
  return new Promise((resolve, reject) => {
    // WITHOUT THIS THE HELPER HANGS FOR EVER ON A BIND FAILURE, which is what a
    // sandbox that denies loopback binding does (`EPERM`) — the suite then
    // looks like it is running rather than like it cannot run. Found when GPT
    // Sol could not execute these tests, 2026-09-08.
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        push(body) {
          for (const res of subscribers) res.write(`event: snapshot\ndata: ${body}\n\n`);
        },
        ping() {
          for (const res of subscribers) res.write(`event: ping\ndata: ${Date.now()}\n\n`);
        },
        dropStreams() {
          for (const res of subscribers) res.destroy();
          subscribers.clear();
        },
        streamCount: () => subscribers.size,
      });
    });
  });
}

/**
 * Drive the source until it has said `count` things, then stop it.
 *
 * The timeout is a real one rather than a fake clock: this is an integration
 * test of sockets, and a fake clock would prove the loop is shaped the way the
 * test thinks it is rather than that it works.
 */
async function take(
  fleet: { url: string },
  count: number,
  options: {
    onMessage?: (message: SourceMessage) => void;
    pollIntervalMs?: number;
    streamRetryAfterMs?: number;
    pollTimeoutMs?: number;
    streamSilenceMs?: number;
    maxPollBytes?: number;
    maxFrameChars?: number;
  } = {},
): Promise<SourceMessage[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  const got: SourceMessage[] = [];
  try {
    for await (const message of fleetSource({
      baseUrl: fleet.url,
      signal: controller.signal,
      pollIntervalMs: options.pollIntervalMs ?? 25,
      streamRetryAfterMs: options.streamRetryAfterMs ?? 80,
      pollTimeoutMs: options.pollTimeoutMs ?? 2_000,
      streamSilenceMs: options.streamSilenceMs ?? 2_000,
      // Spread rather than assigned: `exactOptionalPropertyTypes` is on, so an
      // explicit `undefined` is not the same as an absent key — which is the
      // point, since absent is what makes the module use its own default.
      ...(options.maxPollBytes === undefined ? {} : { maxPollBytes: options.maxPollBytes }),
      ...(options.maxFrameChars === undefined ? {} : { maxFrameChars: options.maxFrameChars }),
    })) {
      got.push(message);
      options.onMessage?.(message);
      if (got.length >= count) break;
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return got;
}

const STATE_BODY = JSON.stringify({ schema: 1, rows: [], collectedAt: "2026-09-08T07:00:00.000Z" });

describe("SSE framing", () => {
  test("a frame split across chunk boundaries is one frame, not two halves", () => {
    const parser = sseFrames();
    expect(parser.push("event: snap")).toEqual([]);
    expect(parser.push("shot\ndata: {\"a\":")).toEqual([]);
    expect(parser.push("1}\n\nevent: ping\ndata: 12345\n\n")).toEqual([
      { event: "snapshot", data: '{"a":1}' },
      { event: "ping", data: "12345" },
    ]);
  });

  test("multi-line data is rejoined, and a stray carriage return is not part of the JSON", () => {
    const parser = sseFrames();
    // `live.ts` folds a multi-line payload into several `data:` lines, per the
    // SSE spec, and rejoining them with newlines is the spec's rule.
    expect(parser.push("event: snapshot\ndata: {\ndata: \"a\": 1}\n\n")).toEqual([
      { event: "snapshot", data: '{\n"a": 1}' },
    ]);
    expect(parser.push("event: snapshot\r\ndata: {\"b\":2}\r\n\r\n")).toEqual([
      { event: "snapshot", data: '{"b":2}' },
    ]);
  });

  test("a frame with no event name defaults to `message`, so it is never mistaken for a snapshot", () => {
    expect(sseFrames().push("data: hello\n\n")).toEqual([{ event: "message", data: "hello" }]);
  });
});

describe("the stream", () => {
  test("opening it is announced before any payload is", async () => {
    const fleet = await fakeFleet({ state: () => ({ status: 200, body: STATE_BODY }) });
    const got = await take(fleet, 2, {
      onMessage: (message) => {
        if (message.kind === "stream-opened") setTimeout(() => fleet.push(STATE_BODY), 5);
      },
    });
    expect(got[0]?.kind).toBe("stream-opened");
    expect(got[1]).toMatchObject({ kind: "payload", via: "sse" });
    if (got[1]?.kind !== "payload") throw new Error("expected a payload");
    expect(got[1].json).toEqual(JSON.parse(STATE_BODY));
  });

  test("a frame that is not JSON is reported rather than thrown or dropped", async () => {
    const fleet = await fakeFleet({ state: () => ({ status: 200, body: STATE_BODY }) });
    const got = await take(fleet, 2, {
      onMessage: (message) => {
        if (message.kind === "stream-opened") setTimeout(() => fleet.push("<html>a proxy said no</html>"), 5);
      },
    });
    expect(got[1]).toMatchObject({ kind: "unreadable", via: "sse" });
  });

  test("a heartbeat keeps the stream alive and is never mistaken for a snapshot", async () => {
    // TWO THINGS AT ONCE, because they are the same rule from both ends: a
    // `ping` carries no snapshot, so passing it on would put a timestamp
    // through the strict parser and manufacture a rejected payload every
    // fifteen seconds; and it is the evidence the socket is alive, so ignoring
    // it entirely would have the silence deadline close a perfectly healthy
    // stream on a quiet fleet.
    const fleet = await fakeFleet({ state: () => ({ status: 200, body: STATE_BODY }) });
    const got = await take(fleet, 2, {
      streamSilenceMs: 220,
      onMessage: (message) => {
        if (message.kind !== "stream-opened") return;
        for (const at of [40, 120, 200, 280, 360]) setTimeout(() => fleet.ping(), at);
        // Well past the silence deadline, and reached only because the pings
        // kept pushing it forward.
        setTimeout(() => fleet.push(STATE_BODY), 430);
      },
    });
    expect(got.map((m) => m.kind)).toEqual(["stream-opened", "payload"]);
    // THE CONTENT, not just the shape. A heartbeat's data is a millisecond
    // count, which is valid JSON — so a source that stopped filtering by event
    // name would yield a NUMBER as a payload, and `["stream-opened","payload"]`
    // would still be the answer. Found by mutation while writing this.
    if (got[1]?.kind !== "payload") throw new Error("expected a payload");
    expect(got[1].json).toEqual(JSON.parse(STATE_BODY));
  });

  test("a dropped stream is announced, and the poll takes over", async () => {
    const fleet = await fakeFleet({ state: () => ({ status: 200, body: STATE_BODY }) });
    const got = await take(fleet, 3, {
      onMessage: (message) => {
        if (message.kind === "stream-opened") setTimeout(() => fleet.dropStreams(), 5);
      },
    });
    expect(got.map((m) => m.kind)).toEqual(["stream-opened", "stream-closed", "payload"]);
    // THE FALLBACK IS LABELLED. Without `via`, a history collected by polling
    // for three hours is indistinguishable from one collected live.
    expect(got[2]).toMatchObject({ kind: "payload", via: "poll" });
  });

  test("a stream endpoint that 404s is a closed stream, not a hang", async () => {
    const fleet = await fakeFleet({ state: () => ({ status: 200, body: STATE_BODY }), stream: "404" });
    const got = await take(fleet, 1);
    expect(got[0]?.kind).toBe("stream-closed");
    if (got[0]?.kind !== "stream-closed") throw new Error("expected a closure");
    expect(got[0].why).toContain("404");
  });

  test("the stream is retried after the fallback has run for a while", async () => {
    const fleet = await fakeFleet({ state: () => ({ status: 200, body: STATE_BODY }) });
    const got = await take(fleet, 6, {
      pollIntervalMs: 15,
      streamRetryAfterMs: 40,
      onMessage: (message) => {
        if (message.kind === "stream-opened") setTimeout(() => fleet.dropStreams(), 5);
      },
    });
    // opened → closed → some polling → opened again. The daemon needs the
    // second `stream-opened`, because that is the restoration event.
    expect(got.filter((m) => m.kind === "stream-opened").length).toBeGreaterThanOrEqual(2);
  });
});

/* ------------------------------------------------------------------ *
 * A consumer that walks away.
 *
 * The daemon `break`s out of `for await` on shutdown and on a restart, with the
 * socket still open — which runs `readStream`'s `finally`, which cancels the
 * body reader. `source.ts` argues twice, at length, that this module must never
 * *await* a peer that has stopped answering; that `finally` awaited one.
 *
 * **This block is a negative control as much as a test.** A claim that the
 * await hangs is a claim that has to be shown, and against a real socket it
 * does not: undici destroys the connection and the promise settles. So what is
 * asserted here is the property that actually matters — a consumer that leaves
 * is gone promptly and owns nothing on the other end — and it holds for the
 * awaited version too. It is here so that a future change to the cancel path
 * has something to fail.
 * ------------------------------------------------------------------ */
describe("a consumer that walks away mid-stream", () => {
  test("breaking out of the loop releases the connection promptly, while the body is still open", async () => {
    const fleet = await fakeFleet({ state: () => ({ status: 200, body: STATE_BODY }) });
    const controller = new AbortController();
    const guard = setTimeout(() => controller.abort(), 5_000);

    let leftAfterMs = Number.NaN;
    try {
      const startedAt = Date.now();
      for await (const message of fleetSource({
        baseUrl: fleet.url,
        signal: controller.signal,
        pollIntervalMs: 25,
        streamRetryAfterMs: 5_000,
        streamSilenceMs: 2_000,
      })) {
        if (message.kind === "stream-opened") {
          setTimeout(() => fleet.push(STATE_BODY), 5);
          continue;
        }
        // A payload arrived, the server is holding the stream open, and the
        // consumer walks off mid-body — the daemon's shutdown, exactly.
        expect(message).toMatchObject({ kind: "payload", via: "sse" });
        break;
      }
      leftAfterMs = Date.now() - startedAt;
    } finally {
      clearTimeout(guard);
      controller.abort();
    }

    // It settled at all — the `finally`'s cancel did not park on a body the
    // server was never going to end.
    expect(Number.isFinite(leftAfterMs)).toBe(true);
    expect(leftAfterMs).toBeLessThan(2_000);

    // AND THE OTHER END KNOWS. A consumer that leaves without releasing the
    // socket is invisible from here and shows up on the dashboard as
    // `subscriberCount()` climbing by one per daemon restart, for ever.
    await waitFor(() => fleet.streamCount() === 0, 2_000);
    expect(fleet.streamCount()).toBe(0);
  });

  test("a body that refuses to be cancelled does not hold the poll fallback hostage", async () => {
    /* **THE REAL BOUND, and the one the plan first proposed to establish with
       a test that could not fail.** `readStream`'s `finally` runs on every exit
       — a parser refusal included, which is this one — and while it awaited the
       cancel, an underlying source that never finished shutting down would stop
       `yield*` from ever returning. The daemon would see `stream-closed`, so
       the log would say the right thing, and then it would sit there for ever
       with the poll fallback three lines away and unreachable. */
    const fleet = await fakeFleet({ state: () => ({ status: 200, body: STATE_BODY }), stream: "404" });
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (!url.includes("/api/live")) return realFetch(input as string, init);
      // Enough of a `Response` for `readStream`: it reads `ok` and `body`.
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        body: uncancellableStream(),
      } as unknown as Response);
    });
    try {
      const got = await take(fleet, 3, { pollIntervalMs: 10, streamRetryAfterMs: 5_000, maxFrameChars: 20_000 });
      expect(got[0]).toMatchObject({ kind: "stream-opened" });
      expect(got[1]).toMatchObject({ kind: "stream-closed" });
      expect((got[1] as { why: string }).why).toMatch(/20000 characters/);
      // THE POINT: the fallback was reached at all.
      expect(got[2]).toMatchObject({ kind: "payload", via: "poll" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * A body that streams for ever and **whose `cancel()` never settles.**
 *
 * No HTTP peer can arrange this: undici destroys the socket and resolves, which
 * is why the test above is a negative control rather than a reproduction. But
 * the streams standard permits a cancel promise to reflect an underlying source
 * shutting down asynchronously, so *nothing structural* bounded the wait — GPT
 * Sol's review of the plan, 2026-09-10. This is that permission, exercised.
 */
function uncancellableStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // An SSE frame that opens and never closes: `sseFrames` will refuse it
      // once it passes the bound, which is the path that reaches `cancel()`
      // with the body still readable. (A stream that ENDS or ERRORS does not:
      // cancelling one of those resolves without consulting the source.)
      controller.enqueue(encoder.encode(`event: snapshot\ndata: ${"x".repeat(30_000)}`));
    },
    pull(controller) {
      controller.enqueue(encoder.encode("x".repeat(30_000)));
    },
    cancel() {
      return new Promise<void>(() => {});
    },
  });
}

/** Poll a condition on a real clock. For a socket closing, which is not synchronous. */
async function waitFor(ready: () => boolean, withinMs: number): Promise<void> {
  const until = Date.now() + withinMs;
  while (!ready() && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("a source that hangs rather than fails", () => {
  // THE FAILURE THE PRODUCER JUST HAD, pointed the other way. On 2026-09-08
  // `collect()`'s child took SIGTERM while in uninterruptible IO and
  // `execFile` waited for a process that was never coming back: nothing threw,
  // nothing timed out, and the loop simply stopped. `fetch` has no default
  // timeout either, so a socket that accepts and never answers would park this
  // daemon's only loop for ever — and the ticker would go on writing a
  // heartbeat, so the checkpoint would look alive while the source was gone.
  // A hang is arrangeable here — a server that never replies — so it is tested
  // rather than reasoned about.
  test("a poll that is accepted and never answered times out and is a failure", async () => {
    const fleet = await fakeFleet({ state: () => ({ status: 200, body: STATE_BODY }), stream: "404", hangState: true });
    const got = await take(fleet, 2, { pollIntervalMs: 10, pollTimeoutMs: 120 });
    const failed = got.find((m) => m.kind === "poll-failed");
    expect(failed).toBeDefined();
    if (failed?.kind !== "poll-failed") throw new Error("expected a poll failure");
    expect(failed.why).toContain("120ms");
  });

  test("a stream that goes silent is closed and reported, not waited on for ever", async () => {
    // Not a dropped socket: the connection is open and healthy and no bytes are
    // coming, which is what a wedged collector behind a live server looks like
    // once its heartbeat stops too.
    const fleet = await fakeFleet({ state: () => ({ status: 200, body: STATE_BODY }), silentStream: true });
    const got = await take(fleet, 2, { streamSilenceMs: 150, pollIntervalMs: 20 });
    expect(got[0]?.kind).toBe("stream-opened");
    expect(got[1]?.kind).toBe("stream-closed");
    if (got[1]?.kind !== "stream-closed") throw new Error("expected a closure");
    expect(got[1].why).toContain("no bytes");
  });
});

describe("when the dashboard is not there at all", () => {
  test("a dead port gives a closed stream and failing polls, and keeps trying", async () => {
    // Port 1 is reserved and nothing on this box listens on it. Connecting is
    // refused immediately, which is the case the daemon meets when the fleet
    // dashboard's tmux job has gone.
    const got = await take({ url: "http://127.0.0.1:1" }, 4, { pollIntervalMs: 10, streamRetryAfterMs: 40 });
    expect(got[0]?.kind).toBe("stream-closed");
    expect(got.filter((m) => m.kind === "poll-failed").length).toBeGreaterThanOrEqual(1);
    // AND IT DOES NOT GIVE UP. A source that stopped after the first failure
    // would leave the daemon alive, quiet, and permanently deaf.
    expect(got.length).toBe(4);
  });

  test("a 500 from the poll is a failure that names the status", async () => {
    const fleet = await fakeFleet({ state: () => ({ status: 500, body: "boom" }), stream: "404" });
    const got = await take(fleet, 2, { pollIntervalMs: 10 });
    const failed = got.find((m) => m.kind === "poll-failed");
    expect(failed).toBeDefined();
    if (failed?.kind !== "poll-failed") throw new Error("expected a poll failure");
    expect(failed.why).toContain("500");
  });

  test("a poll body that is not JSON is unreadable rather than a payload", async () => {
    const fleet = await fakeFleet({ state: () => ({ status: 200, body: "<html>login</html>" }), stream: "404" });
    const got = await take(fleet, 2, { pollIntervalMs: 10 });
    expect(got.some((m) => m.kind === "unreadable" && m.via === "poll")).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Bounded bodies.
 *
 * **The Overseer has one loop and no local fallback** (overseer-direction.md
 * § Two tenses: when the dashboard is down it has nothing at all), so anything
 * that can park this generator indefinitely is the difference between *a dead
 * dashboard is a fact we record* and *a silence we sit in*. Every test here is
 * about a server that answers enough to get past `fetch` and then stops.
 * E-stream in docs/plans/260908f-….
 * ------------------------------------------------------------------ */
describe("bounded bodies — a body that never ends must not trap the loop", () => {
  test("an error status on the stream with an unfinished body does not block the poll fallback", async () => {
    const fleet = await fakeFleet({ state: () => ({ status: 200, body: STATE_BODY }), streamErrorHangingBody: true });

    const startedAt = Date.now();
    const got = await take(fleet, 2, { pollIntervalMs: 10, streamRetryAfterMs: 5_000 });
    const elapsed = Date.now() - startedAt;

    expect(got[0]).toMatchObject({ kind: "stream-closed" });
    expect((got[0] as { why: string }).why).toContain("503");
    // THE POINT: the fallback was reached at all. Before the fix this sat in
    // `response.text()` on a body nobody was going to finish, and the only
    // thing that ever came back was the test's own abort.
    expect(got[1]).toMatchObject({ kind: "payload", via: "poll" });
    expect(elapsed).toBeLessThan(2_000);
  });

  test("an error status on the poll with an unfinished body fails fast rather than burning the whole timeout", async () => {
    const fleet = await fakeFleet({
      state: () => ({ status: 502, body: "" }),
      stream: "404",
      stateErrorHangingBody: true,
    });

    const startedAt = Date.now();
    const got = await take(fleet, 2, { pollIntervalMs: 10, pollTimeoutMs: 3_000 });
    const elapsed = Date.now() - startedAt;

    expect(got[1]).toMatchObject({ kind: "poll-failed" });
    expect((got[1] as { why: string }).why).toContain("502");
    // The status line is the whole answer; there is no reason to wait 3s for a
    // body we are not going to read.
    expect(elapsed).toBeLessThan(1_500);
  });

  test("a poll body larger than the bound is refused rather than buffered", async () => {
    const huge = `{"rows":[],"filler":"${"x".repeat(200_000)}"}`;
    const fleet = await fakeFleet({ state: () => ({ status: 200, body: huge }), stream: "404" });

    const got = await take(fleet, 2, { pollIntervalMs: 10, maxPollBytes: 50_000 });

    expect(got[1]).toMatchObject({ kind: "poll-failed" });
    expect((got[1] as { why: string }).why).toMatch(/50000 bytes/);
  });

  test("a poll body under the bound still arrives intact", async () => {
    const fleet = await fakeFleet({ state: () => ({ status: 200, body: STATE_BODY }), stream: "404" });
    const got = await take(fleet, 2, { pollIntervalMs: 10, maxPollBytes: 50_000 });
    expect(got[1]).toMatchObject({ kind: "payload", via: "poll", json: JSON.parse(STATE_BODY) });
  });

  test("a stream that never terminates a frame is closed instead of growing a buffer", async () => {
    const fleet = await fakeFleet({
      state: () => ({ status: 200, body: STATE_BODY }),
      streamNeverTerminatesFrame: true,
    });

    const got = await take(fleet, 2, { pollIntervalMs: 10, streamRetryAfterMs: 5_000, maxFrameChars: 20_000 });

    expect(got[0]).toMatchObject({ kind: "stream-opened" });
    expect(got[1]).toMatchObject({ kind: "stream-closed" });
    expect((got[1] as { why: string }).why).toMatch(/20000 characters/);
  });
});

describe("sseFrames — the incomplete-frame bound", () => {
  test("keeps a partial frame until it is closed, and refuses one that never closes", () => {
    const parser = sseFrames(64);
    expect(parser.push("event: snapshot\ndata: ")).toEqual([]);
    // Still under the bound, still patiently waiting.
    expect(parser.push("{\"a\":1}")).toEqual([]);
    expect(parser.push("\n\n")).toEqual([{ event: "snapshot", data: '{"a":1}' }]);

    // And now one that never closes.
    expect(() => parser.push(`data: ${"x".repeat(200)}`)).toThrow(/64 characters/);
  });

  test("the bound is on the INCOMPLETE tail, not on the traffic through it", () => {
    const parser = sseFrames(64);
    for (let i = 0; i < 500; i += 1) {
      expect(parser.push(`event: ping\ndata: ${i}\n\n`)).toHaveLength(1);
    }
  });

  test("several complete frames in ONE chunk are not an overflow, however many there are", () => {
    /* **THE TEST THE FIRST DRAFT DID NOT HAVE, and the reason it was wrong.**
       Every other test here pushes one frame per `push`, so a bound checked
       against the whole appended chunk looked correct. A real stream does not
       do that: a heartbeat and a snapshot land in one TCP segment all the time.
       GPT Sol, 2026-09-08 — four small valid frames, 136 characters, under a
       64-character limit, and the parser threw. */
    const parser = sseFrames(64);
    const chunk = [0, 1, 2, 3].map((i) => `event: ping\ndata: ${i}\n\n`).join("");
    expect(chunk.length).toBeGreaterThan(64);
    expect(parser.push(chunk)).toHaveLength(4);

    // And the parser is still usable afterwards, with its bound intact.
    expect(() => parser.push(`data: ${"x".repeat(200)}`)).toThrow(/64 characters/);
  });

  test("one frame longer than the bound is refused even though it is complete", () => {
    const parser = sseFrames(64);
    expect(() => parser.push(`data: ${"x".repeat(200)}\n\n`)).toThrow(/64 characters/);
  });

  test("the SAME BYTES are judged the same however TCP splits them", () => {
    /* **PACKETIZATION IS NOT SOMETHING A PRODUCER CONTROLS**, so it must not
       decide whether a stream is called broken. A frame whose body is exactly
       the limit passed when its terminator arrived in the same chunk and threw
       when the first `\n` arrived without the second, because the half-received
       terminator counted against the body. GPT Sol probed it at an
       eight-character limit, 2026-09-08. */
    const body = "data: xx"; // exactly 8 characters
    expect(body.length).toBe(8);

    // All in one chunk: accepted.
    expect(sseFrames(8).push(`${body}\n\n`)).toEqual([{ event: "message", data: "xx" }]);

    // Split across the terminator: must also be accepted.
    const split = sseFrames(8);
    expect(split.push(`${body}\n`)).toEqual([]);
    expect(split.push("\n")).toEqual([{ event: "message", data: "xx" }]);

    // And the same for CRLF, where three of the four characters can be pending.
    const crlf = sseFrames(8);
    expect(crlf.push(`${body}\r\n\r`)).toEqual([]);
    expect(crlf.push("\n")).toEqual([{ event: "message", data: "xx" }]);
  });

  test("bare CR line endings are a stream, not a frame that never closes", () => {
    /* **THE SPEC ALLOWS ALL THREE**: CR, LF and CRLF end a line in an event
       stream (HTML Standard § event stream interpretation). This parser knew
       two of them, so a producer — or, far likelier, a proxy that rewrote line
       endings, which is the reason CRLF is tolerated in the first place — using
       bare CR would have every frame retained as an incomplete one, growing the
       tail until the bound refused a perfectly valid stream. Bounded, and
       wrong. GPT Sol's review of plan 260910c, 2026-09-10. */
    /* Two frames, so the first one's terminator is followed by a byte that
       proves it was a bare CR. **The second is deliberately still pending**:
       a chunk ending in `\r` cannot be resolved until the next byte says
       whether it was a line ending or the first half of a CRLF, which is what
       every conforming event-stream parser does and what the `heldCr` in
       `sseFrames` is. */
    const parser = sseFrames(64);
    expect(parser.push('event: snapshot\rdata: {"a":1}\r\revent: ping\rdata: 2\r\r')).toEqual([
      { event: "snapshot", data: '{"a":1}' },
    ]);
    // And the held one lands as soon as anything at all follows it.
    expect(parser.push("event: ping\r")).toEqual([{ event: "ping", data: "2" }]);

    // Mixed, because a proxy rewriting one direction does not tidy the rest.
    expect(sseFrames(64).push("event: ping\r\ndata: 1\rdata: 2\n\n")).toEqual([
      { event: "ping", data: "1\n2" },
    ]);
  });

  test("a CRLF split across chunks is one line ending, not two", () => {
    /* The trap that comes with accepting bare CR: `\r` at the end of a chunk
       and `\n` at the start of the next is ONE line ending, and a parser that
       decided as soon as it saw the `\r` would manufacture a blank line and
       close the frame early — which is the packetization class above, wearing
       different clothes. */
    const parser = sseFrames(64);
    expect(parser.push("event: snapshot\rdata: {\"a\":1}\r")).toEqual([]);
    expect(parser.push("\n")).toEqual([]); // still just the one line ending
    expect(parser.push("\n")).toEqual([{ event: "snapshot", data: '{"a":1}' }]);
  });

  test("a body genuinely over the bound is still refused, terminator or not", () => {
    // One character past the limit, with nothing that could be a terminator.
    expect(() => sseFrames(8).push("data: xxx")).toThrow(/8 characters/);
    // And with a full terminator's worth of slack claimed, still refused.
    expect(() => sseFrames(8).push("data: xxxxx\r\n\r")).toThrow(/8 characters/);
  });
});
