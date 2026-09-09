/**
 * `GET /api/queue` — tools/fleet/routes-idea-queue.ts.
 *
 * **WHAT THIS FILE IS REALLY DEFENDING.** Two things, and neither is "the JSON
 * has the right keys":
 *
 *  1. **The three read arms survive the boundary.** `never-written`, an
 *     empty-but-real queue, and `unreadable` are three different facts, and the
 *     third is the one that matters: this file is original human input, not a
 *     disposable cache, so a lost one must never reach the page as a healthy
 *     empty queue. A route that flattened them would pass any test that only
 *     checked the happy path.
 *  2. **The route is read-only, deliberately.** It is an authorisation record
 *     served by a process with no authentication, so a `POST` must be refused
 *     with a reason rather than 404'd or quietly handled. That is asserted here
 *     so that adding a write path has to change a test that says why it exists.
 *
 * Driven through `queuePayload` and the mounted handler with an injected reader
 * and clock — no socket, no `~/.overseer/`, no `Date.now()`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

import { QUEUE_PATH, SETTLED_LIMIT, ideaQueueRoute, queuePayload } from "../tools/fleet/routes-idea-queue.js";
import {
  EMPTY_METADATA,
  IDEA_QUEUE_SCHEMA,
  foldQueue,
  type IdeaEvent,
  type Placement,
  type QueueRead,
} from "../tools/overseer/idea-queue.js";
import type { QueueFeed } from "../tools/fleet/wire.js";

const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);

let n = 0;
function env(by: "greg" | "overseer" = "greg", at = "2026-09-19T00:00:00.000Z") {
  n += 1;
  return { schema: IDEA_QUEUE_SCHEMA as typeof IDEA_QUEUE_SCHEMA, eventId: `ev-${n}`, commandId: null, at, by };
}

function added(
  id: string,
  over: { by?: "greg" | "overseer"; needsGreg?: boolean; placement?: Placement; priority?: number | null } = {},
): IdeaEvent {
  return {
    ...env(over.by ?? "greg"),
    kind: "added",
    id,
    text: `the idea called ${id}`,
    title: null,
    metadata: { ...EMPTY_METADATA, waitingOn: "a lull", size: "M" },
    placement: over.placement ?? { at: "back" },
    needsGreg: over.needsGreg ?? false,
    priority: over.priority ?? null,
  };
}

function readerFor(events: readonly IdeaEvent[]): QueueRead {
  return { kind: "queue", view: foldQueue(events), path: "/tmp/fake/queue.jsonl" };
}

function payload(read: QueueRead): QueueFeed {
  return queuePayload({ read: () => read, nowMs: () => NOW });
}

/** A minimal request/response pair, enough for a handler that only writes JSON. */
function call(url: string, method = "GET", read: QueueRead = readerFor([added("qi-aaaaaaaa")])) {
  const chunks: string[] = [];
  let status = 0;
  let headers: Record<string, string> = {};
  const res = {
    writeHead(code: number, h?: Record<string, string>) {
      status = code;
      headers = h ?? {};
      return res;
    },
    end(body?: string) {
      if (body !== undefined) chunks.push(body);
    },
  } as unknown as ServerResponse;
  const handled = ideaQueueRoute({ read: () => read, nowMs: () => NOW }).handle(
    { url, method, headers: {} } as IncomingMessage,
    res,
  );
  return { handled, status, headers, body: chunks.join("") };
}

describe("the three read arms", () => {
  it("never-written says nobody has used the queue, and says it is not the same as empty", () => {
    const feed = payload({ kind: "never-written", path: "/tmp/fake/queue.jsonl" });
    expect(feed.kind).toBe("never-written");
    if (feed.kind !== "never-written") return;
    expect(feed.why).toContain("not the same as a queue");
  });

  it("an empty but REAL queue is the `queue` arm with no rows — a different fact", () => {
    const feed = payload(readerFor([]));
    expect(feed.kind).toBe("queue");
    if (feed.kind !== "queue") return;
    expect(feed.rows).toEqual([]);
    expect(feed.depth.dispatchable).toBe(0);
  });

  it("unreadable carries the reader's own sentence and NO rows to draw", () => {
    /* The one that matters. A page given `rows: []` here would draw an empty
       queue over a lost authorisation record. */
    const feed = payload({ kind: "unreadable", why: "line 4 is not an event", path: "/tmp/fake/queue.jsonl" });
    expect(feed.kind).toBe("unreadable");
    if (feed.kind !== "unreadable") return;
    expect(feed.why).toContain("line 4");
    expect("rows" in feed).toBe(false);
  });
});

describe("the payload", () => {
  it("carries the queue in order, with the server's own readiness verdict", () => {
    const feed = payload(readerFor([added("qi-aaaaaaaa"), added("qi-bbbbbbbb", { by: "overseer" })]));
    expect(feed.kind).toBe("queue");
    if (feed.kind !== "queue") return;
    expect(feed.rows.map((r) => r.id)).toEqual(["qi-aaaaaaaa", "qi-bbbbbbbb"]);
    /* Greg's is ready; the Overseer's proposal is not, and the row says why in
       words rather than in a code the client re-interprets. */
    expect(feed.rows[0]).toMatchObject({ ready: true, why: null, authority: "authorized", authorizedRevision: 0 });
    expect(feed.rows[1]?.ready).toBe(false);
    expect(feed.rows[1]?.why).toContain("nobody has authorised");
    expect(feed.rows[1]?.authorizedRevision).toBeNull();
  });

  it("`why` is null exactly when `ready` — the two cannot disagree", () => {
    const feed = payload(
      readerFor([
        added("qi-aaaaaaaa"),
        added("qi-bbbbbbbb", { by: "overseer" }),
        added("qi-cccccccc", { needsGreg: true }),
      ]),
    );
    if (feed.kind !== "queue") return;
    for (const row of feed.rows) expect(row.ready).toBe(row.why === null);
  });

  it("shows a lapsed approval as a revision mismatch the page can explain", () => {
    const feed = payload(
      readerFor([
        added("qi-aaaaaaaa"),
        { ...env("overseer"), kind: "edited", id: "qi-aaaaaaaa", text: "enlarged by an agent" },
      ]),
    );
    if (feed.kind !== "queue") return;
    expect(feed.rows[0]).toMatchObject({ ready: false, revision: 1, authorizedRevision: 0 });
    expect(feed.rows[0]?.why).toContain("no longer names what this says");
    expect(feed.rows[0]?.wait.kind).toBe("not-authorized");
  });

  it("puts settled items in their own list, and says how many it withheld", () => {
    /* **The ids are generated from the queue's own alphabet, one character at a
       time**, and that is not fussiness: the first version of this test built
       them with `String(i).padStart(8, "2")`, which reuses digits — `i` of 0 and
       20 both spell `22222220` — so three of the twenty-three were duplicates,
       the fold correctly ignored them, and the test failed for a reason that had
       nothing to do with the cap it was testing. */
    const AB = "23456789abcdefghjkmnpqrstvwxyz";
    const idFor = (i: number): string => `qi-aaaaaa${AB[i % AB.length] ?? "a"}${AB[Math.floor(i / AB.length)] ?? "a"}`;
    const count = SETTLED_LIMIT + 3;
    const ids = Array.from({ length: count }, (_, i) => idFor(i));
    expect(new Set(ids).size).toBe(count); // the guard the first version lacked

    const events: IdeaEvent[] = [];
    ids.forEach((id, i) => {
      events.push(added(id));
      events.push({
        ...env("overseer", `2026-09-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00.000Z`),
        kind: "done",
        id,
      });
    });

    const feed = payload(readerFor(events));
    if (feed.kind !== "queue") return;
    expect(feed.problems).toEqual([]);
    expect(feed.rows).toEqual([]);
    expect(feed.settled).toHaveLength(SETTLED_LIMIT);
    /* **Says so rather than implying that is all of them.** */
    expect(feed.settledWithheld).toBe(3);
  });

  it("carries problems, and they are what makes every row unready", () => {
    const feed = payload(
      readerFor([added("qi-aaaaaaaa"), { ...env(), kind: "done", id: "qi-nosuchid" }]),
    );
    if (feed.kind !== "queue") return;
    expect(feed.problems.map((p) => p.kind)).toEqual(["unknown-item"]);
    /* A perfectly good item sits beside a bad event and must not go out. */
    expect(feed.rows[0]?.ready).toBe(false);
    expect(feed.rows[0]?.why).toContain("unresolved problem");
  });

  it("reports depth whose parts add up to the rows", () => {
    const feed = payload(
      readerFor([
        added("qi-aaaaaaaa"),
        added("qi-bbbbbbbb", { needsGreg: true }),
        added("qi-cccccccc", { by: "overseer" }),
        added("qi-dddddddd"),
        { ...env("overseer"), kind: "dispatched", id: "qi-dddddddd", session: "s", plan: null },
      ]),
    );
    if (feed.kind !== "queue") return;
    const d = feed.depth;
    expect(d).toMatchObject({ dispatchable: 1, needsGreg: 1, unauthorized: 1, dispatched: 1 });
    expect(d.dispatchable + d.needsGreg + d.unauthorized + d.dispatched).toBe(feed.rows.length);
  });

  it("offers throughput and NEVER a duration", () => {
    /* The type has one arm so this cannot regress silently, and the assertion
       is here so that adding a second arm has to come past a test. */
    const feed = payload(readerFor([added("qi-aaaaaaaa")]));
    if (feed.kind !== "queue") return;
    expect(feed.throughput.windows.map((w) => w.days)).toEqual([7, 30]);
    expect(feed.throughput.duration.kind).toBe("not-enough");
    expect(JSON.stringify(feed.throughput)).not.toMatch(/lowMs|highMs|etaMs|perDay/);
  });

  it("names the file, so a person can go and look at it", () => {
    const feed = payload(readerFor([]));
    if (feed.kind !== "queue") return;
    expect(feed.path).toBe("/tmp/fake/queue.jsonl");
  });

  it("measures its windows on the SERVER's clock", () => {
    /* A browser computing "7 days ago" from a phone in another timezone would
       draw a queue that had stopped moving. */
    const id = "qi-aaaaaaaa";
    const events: IdeaEvent[] = [
      added(id),
      { ...env("overseer", new Date(NOW - 3 * 86_400_000).toISOString()), kind: "dispatched", id, session: "s", plan: null },
    ];
    const feed = payload(readerFor(events));
    if (feed.kind !== "queue") return;
    expect(feed.throughput.windows.find((w) => w.days === 7)?.dispatched).toBe(1);
  });
});

describe("the mount", () => {
  it("answers its own path and declines everything else", () => {
    expect(call(QUEUE_PATH).handled).toBe(true);
    expect(call(`${QUEUE_PATH}?x=1`).handled).toBe(true);
    expect(call("/api/state").handled).toBe(false);
    expect(call("/").handled).toBe(false);
  });

  it("404s a path the prefix would otherwise widen into", () => {
    /* `startsWith` mounts it, so this is the guard that stops
       `/api/queue/../something` being this route's business. */
    const answer = call(`${QUEUE_PATH}/../secrets`);
    expect(answer.handled).toBe(true);
    expect(answer.status).toBe(404);
  });

  it("REFUSES A WRITE WITH A REASON, rather than 404ing or handling it", () => {
    /* The queue is an authorisation record and this server has no
       authentication, so read-only is a security decision. If you are changing
       this test to add a `POST`, the plan's § Needs Greg is the thing to read
       first. */
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const answer = call(QUEUE_PATH, method);
      expect(answer.status).toBe(405);
      expect(answer.headers["allow"]).toBe("GET, HEAD");
      expect(answer.body).toContain("read-only on purpose");
      /* And it points at the way to actually write. */
      expect(answer.body).toContain("scripts/overseer-queue.ts");
    }
  });

  it("sends no body for HEAD but the same status", () => {
    const answer = call(QUEUE_PATH, "HEAD");
    expect(answer.status).toBe(200);
    expect(answer.body).toBe("");
  });

  it("never caches — the queue changes and a stale one is a wrong authorisation", () => {
    expect(call(QUEUE_PATH).headers["cache-control"]).toBe("no-store");
  });

  it("serves the payload as JSON", () => {
    const answer = call(QUEUE_PATH);
    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe("application/json");
    const parsed = JSON.parse(answer.body) as QueueFeed;
    expect(parsed.kind).toBe("queue");
  });

  it("answers 500 rather than hanging when the reader throws", () => {
    /* The reader is built not to throw — every failure of it is an arm — so
       this is for the case where that is itself wrong. A hung request is
       indistinguishable from a dead box on a phone. */
    const res = (() => {
      const chunks: string[] = [];
      let status = 0;
      const r = {
        writeHead(code: number) {
          status = code;
          return r;
        },
        end(body?: string) {
          if (body !== undefined) chunks.push(body);
        },
        get status() {
          return status;
        },
        get body() {
          return chunks.join("");
        },
      };
      return r;
    })();
    const handled = ideaQueueRoute({
      read: () => {
        throw new Error("the disk fell over");
      },
      nowMs: () => NOW,
    }).handle({ url: QUEUE_PATH, method: "GET", headers: {} } as IncomingMessage, res as unknown as ServerResponse);
    expect(handled).toBe(true);
    expect(res.status).toBe(500);
    expect(res.body).toContain("the disk fell over");
  });
});
