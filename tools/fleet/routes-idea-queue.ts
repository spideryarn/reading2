/**
 * `GET /api/queue` — the queue of ideas, folded, for the Queued ideas tab.
 *
 * A route module rather than lines in `server.ts`, for the reason
 * `routes-health-history.ts` states: importing `server.ts` binds port 8787, so
 * anything living there cannot be driven by a test. `queuePayload` below takes
 * its reader as a parameter and is pure given it, which is the half worth
 * testing.
 *
 * ## READ-ONLY, AND THAT IS A SECURITY DECISION RATHER THAN A STAGING ONE
 *
 * This dashboard has no authentication — reachability is the whole boundary
 * (`server.ts`, and `origin.ts` for the DNS-rebinding half). Every other write
 * route here types into a session, which is bounded by what that agent will
 * agree to do.
 *
 * **The queue is different in kind: it is an authorisation record.**
 * [overseer.md](../../docs/project/overseer.md)'s gate 3 is *"nothing dispatched
 * that Greg did not queue"*, so a write route here would let anything able to
 * reach the port append an item attributed to Greg and have the Overseer act on
 * it. GPT Sol's P0-1, reviewing the plan before any of this was built.
 *
 * So there is no write path in this file, and adding one is not a matter of
 * copying `routes-rename.ts`. It waits on an identity story — the cheap shape
 * being mutations only from allowlisted Greg-device tailnet identities, with
 * loopback read-only — and that is a question for Greg, recorded in
 * [the plan](../../docs/plans/260909b-queued-ideas-mode-the-overseer-queue-as-ndjson.md#needs-greg).
 * **If you are here to add a `POST`, read that first.**
 *
 * ## Three arms, because two of them are silences that mean different things
 *
 * `never-written`, `queue` and `unreadable` are carried through from
 * `readQueue` rather than flattened, and the distinction is the point:
 *
 *  - **`never-written`** — nobody has used this queue. Ordinary; nothing wrong.
 *  - **`queue` with no items** — the file exists and everything in it has been
 *    dispatched or dropped. A different fact.
 *  - **`unreadable`** — the file is there and this build cannot make sense of
 *    it. The Overseer's own store may cold-start because losing it costs only
 *    history; **this file is original human input and is not disposable**, so
 *    rendering a lost one as a healthy empty queue is the one thing this route
 *    must never do.
 *
 * `problems` rides along on the `queue` arm for the same reason: a queue two
 * items short must say so, and nothing in it is dispatchable while it is.
 *
 * ## No gzip, unlike the health chart
 *
 * That route compresses because a day of samples is about a megabyte. This one
 * carries tens of items, and the `content-encoding` branch would be more code
 * than it saves bytes. Worth revisiting if the queue ever holds thousands,
 * which would itself be the more interesting problem.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { isDispatchable, readQueue, spellVersion, whyNotDispatchable, type QueueRead } from "../overseer/idea-queue.js";
import { itemWait, queueDepth, throughput } from "../overseer/idea-queue-wait.js";
import type { QueueFeed, QueueRow } from "./wire.js";

export const QUEUE_PATH = "/api/queue";

/**
 * How many settled items to send.
 *
 * The queue's own history is unbounded and the tab only wants the tail of it —
 * enough to see what has just been finished or dropped. A cap here rather than
 * in the fold, because the fold is the record and this is a view of it.
 */
export const SETTLED_LIMIT = 20;

export type QueueRouteDeps = {
  /** Injected, so a test never touches `~/.overseer/`. */
  read(): QueueRead;
  /**
   * The server's clock, so the throughput windows are measured by the same
   * process that stamped the events. A browser computing "7 days ago" from its
   * own clock would draw a phone in the wrong timezone as a queue that had
   * stopped moving — absence caused by arithmetic, indistinguishable on screen
   * from absence caused by nothing happening.
   */
  nowMs(): number;
};

export function realDeps(): QueueRouteDeps {
  return { read: () => readQueue(), nowMs: () => Date.now() };
}

/**
 * Build the payload. **Pure given its reader** — no request, no response, no
 * clock of its own — so the interesting half of this route is testable directly.
 *
 * The per-row `ready` and `why` are computed HERE rather than in the client,
 * and that is deliberate: `isDispatchable` is gate 3's own test, and a second
 * implementation of it in TypeScript-for-the-browser is a second answer to
 * *"may this go out?"*. The client renders the sentence it is given.
 */
export function queuePayload(deps: QueueRouteDeps): QueueFeed {
  const read = deps.read();
  if (read.kind === "never-written") {
    return {
      schema: 1,
      kind: "never-written",
      why:
        "no queue file has been written yet, so nothing has ever been queued here. That is the " +
        "ordinary state before the first item, not a fault — and it is not the same as a queue " +
        "that has been emptied.",
    };
  }
  if (read.kind === "unreadable") {
    return { schema: 1, kind: "unreadable", why: read.why };
  }

  const view = read.view;
  const rows: QueueRow[] = view.items.map((item) => ({
    id: item.id,
    title: item.title,
    text: item.text,
    lifecycle: item.lifecycle,
    authority: item.authority.kind,
    authorizedRevision: item.authority.kind === "authorized" ? item.authority.revision : null,
    revision: item.revision,
    needsGreg: item.needsGreg,
    ready: isDispatchable(view, item),
    /* The server's own sentence, not a code the client re-interprets. */
    why: whyNotDispatchable(view, item),
    wait: itemWait(view, item),
    waitingOn: item.metadata.waitingOn,
    size: item.metadata.size,
    source: item.metadata.source,
    runs: item.metadata.runs,
    areas: [...item.metadata.areas],
    addedBy: item.addedBy,
    addedAt: item.addedAt,
    lastTouchedAt: item.lastTouchedAt,
    dispatchedTo: item.dispatchedTo,
    dispatchedAt: item.dispatchedAt,
    plan: item.plan,
    droppedWhy: item.droppedWhy,
    history: item.history.map((touch) => ({ kind: touch.kind, at: touch.at, by: touch.by, what: touch.what })),
    priority: item.priority,
  }));

  const settled: QueueRow[] = view.settled.slice(0, SETTLED_LIMIT).map((item) => ({
    id: item.id,
    title: item.title,
    text: item.text,
    lifecycle: item.lifecycle,
    authority: item.authority.kind,
    authorizedRevision: item.authority.kind === "authorized" ? item.authority.revision : null,
    revision: item.revision,
    needsGreg: item.needsGreg,
    ready: false,
    why: whyNotDispatchable(view, item),
    wait: itemWait(view, item),
    waitingOn: item.metadata.waitingOn,
    size: item.metadata.size,
    source: item.metadata.source,
    runs: item.metadata.runs,
    areas: [...item.metadata.areas],
    addedBy: item.addedBy,
    addedAt: item.addedAt,
    lastTouchedAt: item.lastTouchedAt,
    dispatchedTo: item.dispatchedTo,
    dispatchedAt: item.dispatchedAt,
    plan: item.plan,
    droppedWhy: item.droppedWhy,
    history: item.history.map((touch) => ({ kind: touch.kind, at: touch.at, by: touch.by, what: touch.what })),
    priority: item.priority,
  }));

  return {
    schema: 1,
    kind: "queue",
    version: spellVersion(view.version),
    rows,
    settled,
    /** How many were withheld by `SETTLED_LIMIT`, so the page can say "and N more" rather than imply that is all of them. */
    settledWithheld: Math.max(0, view.settled.length - settled.length),
    depth: queueDepth(view),
    throughput: throughput(view, deps.nowMs()),
    problems: view.problems.map((problem) => ({ kind: problem.kind, why: problem.why })),
    path: read.path,
  };
}

/** Mount it. Returns false when the request is not this route's. */
export function ideaQueueRoute(deps: QueueRouteDeps = realDeps()): {
  handle(req: IncomingMessage, res: ServerResponse): boolean;
} {
  return {
    handle(req, res): boolean {
      const url = req.url ?? "/";
      if (!url.startsWith(QUEUE_PATH)) return false;
      /* An exact path, so the `startsWith` that mounts it cannot quietly widen
         into `/api/queue/../something`. Same rule the other routes state. */
      const bare = url.split("?")[0] ?? "";
      if (bare !== QUEUE_PATH) {
        res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ schema: 1, kind: "unreadable", why: `no such route: ${bare}` }));
        return true;
      }
      /* **GET ONLY, AND THE REFUSAL NAMES THE REASON.** A `POST` here is not an
         oversight to be fixed by adding a handler — see the header. */
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "content-type": "application/json", "cache-control": "no-store", allow: "GET, HEAD" });
        res.end(
          JSON.stringify({
            schema: 1,
            kind: "unreadable",
            why:
              "this route is read-only on purpose: the queue is an authorisation record and this " +
              "server has no authentication. Use `npx tsx scripts/overseer-queue.ts` to write.",
          }),
        );
        return true;
      }

      let body: string;
      try {
        body = JSON.stringify(queuePayload(deps));
      } catch (err) {
        /* The reader is built not to throw — every failure of it is an arm — so
           this is for the case where that is itself wrong. A hung request is
           indistinguishable from a dead box on a phone. */
        res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(
          JSON.stringify({
            schema: 1,
            kind: "unreadable",
            why: `building the queue answer threw: ${err instanceof Error ? err.message : String(err)}`,
          }),
        );
        return true;
      }

      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : body);
      return true;
    },
  };
}
