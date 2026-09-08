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
import { afterEach, describe, expect, test } from "vitest";

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
}): Promise<Fleet> {
  const subscribers = new Set<ServerResponse>();
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/api/live")) {
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
      const { status, body } = options.state();
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body);
      return;
    }
    res.writeHead(404).end();
  });
  servers.push(server);
  return new Promise((resolve) => {
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
