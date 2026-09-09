/**
 * The queue of ideas — `GET /api/queue`.
 *
 * ## FOUR ARMS, BECAUSE THE SERVER HAS THREE AND THE WIRE CAN FAIL TOO
 *
 * The discipline `health-history-client.ts` states at length, and it matters
 * more here than anywhere else on this page: every arm is a different kind of
 * *nothing*, and collapsing any two produces an empty list — which reads as
 * **"nothing is queued"** over a file that is the record of what Greg has
 * authorised.
 *
 *  - **`queue`** — we read it. `rows` may be empty, and that is a claim about
 *    the queue rather than a failure.
 *  - **`never-written`** — no queue file exists yet. Ordinary, and *not* the
 *    same as an emptied queue.
 *  - **`unreadable`** — the SERVER could not make sense of the file. Its `why`,
 *    in its voice. The Overseer's own store may cold-start because losing it
 *    costs only history; this file is original human input and is not
 *    disposable, so this arm is the loud one.
 *  - **`no-answer`** — THIS BROWSER never got an answer it could read. Our
 *    sentence, and it says so, because the phone's own network trouble must not
 *    appear on screen wearing the server's voice.
 *  - **`loading`** — the panel's own, and not a claim about anything.
 *
 * ## The seam
 *
 * `QueueApi` is injectable so `QueuePanel` can be driven by a test without
 * stubbing `fetch` — the rule
 * [fleet-dashboard-modes.md](../../../../docs/project/fleet-dashboard-modes.md)
 * § Writing back states: bind `fetch` at import time and it is unstubbable in
 * any suite that imports the module first, and the failure looks like a real
 * network call in a test that has none.
 *
 * ## What this file deliberately does NOT contain
 *
 * **No re-implementation of `isDispatchable`.** Whether an item may go out is
 * gate 3's own test and it is computed on the server; each row arrives with
 * `ready` and a `why` sentence. A copy of that logic here would be a second
 * answer to *"may this go out?"*, and the two would disagree the first time one
 * of them moved.
 *
 * **And no write path**, which is not an omission — see `routes-idea-queue.ts`.
 */
import type { QueueDepth, QueueFeed, QueueRow } from "../../wire";

export const QUEUE_URL = "api/queue";

/** What the panel holds. `loading` and `no-answer` are ours; the rest are the server's. */
export type QueueView =
  | { kind: "loading" }
  | { kind: "no-answer"; why: string }
  | Extract<QueueFeed, { kind: "queue" | "never-written" | "unreadable" }>;

export type QueueApi = { fetch(): Promise<QueueView> };

/**
 * A payload this build can use, or null.
 *
 * **Checks the arm as well as the schema**, because a body that parsed as JSON
 * is not yet an answer: a proxy error page, a 405 from a stricter build, or a
 * payload from a later schema all arrive as valid JSON. Anything unrecognised
 * becomes `no-answer` rather than being coerced, so the page never draws an
 * empty queue out of a shape it did not understand.
 */
export function readPayload(body: unknown): QueueView | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (record["schema"] !== 1) return null;
  const kind = record["kind"];
  if (kind === "never-written" || kind === "unreadable") {
    return typeof record["why"] === "string" ? (body as QueueView) : null;
  }
  if (kind !== "queue") return null;
  if (!Array.isArray(record["rows"]) || !Array.isArray(record["settled"])) return null;
  if (typeof record["version"] !== "string") return null;
  /* Schema 1 is intentionally additive. Older servers omit `priority`, and
     treating that as unstated is the honest backward-compatible reading;
     rejecting the whole payload would turn one absent display field into no
     queue at all. Provenance arrived additively too, so it follows the same
     null-on-absence rule rather than ever reaching the panel as `undefined`. */
  const normalizeRow = (row: unknown): unknown => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return row;
    const raw = row as Record<string, unknown>;
    return {
      ...raw,
      priority: typeof raw.priority === "number" ? raw.priority : null,
      priorityBy: raw.priorityBy === "greg" || raw.priorityBy === "overseer" ? raw.priorityBy : null,
      priorityAt: typeof raw.priorityAt === "string" ? raw.priorityAt : null,
    };
  };
  return {
    ...record,
    rows: record.rows.map(normalizeRow),
    settled: record.settled.map(normalizeRow),
  } as QueueView;
}

/**
 * How long to wait before calling it a failure.
 *
 * **A read with no deadline is the failure mode GPT Sol found** (its answer 4):
 * the panel keeps the view it had while a new read is in flight, so a request
 * that never resolves leaves the last answer on screen indefinitely — and if
 * that answer was a healthy empty queue, the page goes on quietly asserting it
 * while the queue may be anything at all.
 */
export const FETCH_TIMEOUT_MS = 10_000;

export const httpQueueApi: QueueApi = {
  async fetch(): Promise<QueueView> {
    let response: Response;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
    try {
      response = await fetch(QUEUE_URL, { headers: { accept: "application/json" }, signal: abort.signal });
    } catch (cause) {
      return {
        kind: "no-answer",
        why:
          abort.signal.aborted
            ? `the dashboard did not answer within ${FETCH_TIMEOUT_MS / 1000}s, so what is on screen may be stale`
            : `this browser could not reach the dashboard: ${String(cause)}`,
      };
    } finally {
      clearTimeout(timer);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        kind: "no-answer",
        why: `the dashboard answered ${response.status} with something that was not JSON`,
      };
    }
    const payload = readPayload(body);
    if (payload === null) {
      return {
        kind: "no-answer",
        why:
          `the dashboard answered ${response.status} with a shape this page does not understand — ` +
          `it may be running a newer build than this tab`,
      };
    }
    return payload;
  },
};

/* ------------------------------------------------------------------ *
 * Presentation helpers. Pure, so a test can drive them directly.
 * ------------------------------------------------------------------ */

/**
 * The one-word badge for a row, and its tone.
 *
 * **Derived from the row's three axes rather than from `ready` alone**, because
 * *needs you* and *nobody has approved this* are different calls to action:
 * the first wants an answer from Greg, the second wants a yes. A single
 * "blocked" badge would flatten them and make the tab's most useful
 * distinction invisible.
 */
export type Badge = { label: string; tone: "ready" | "you" | "unapproved" | "running" | "settled" | "broken" };

export function badgeFor(row: QueueRow, queueHasProblems: boolean): Badge {
  if (row.lifecycle === "dispatched") return { label: "running", tone: "running" };
  if (row.lifecycle === "done") return { label: "done", tone: "settled" };
  if (row.lifecycle === "dropped") return { label: "dropped", tone: "settled" };
  /* **Before the item's own reasons**, because while the queue has a hole in it
     nothing is dispatchable and a per-item verdict would be beside the point. */
  if (queueHasProblems) return { label: "on hold", tone: "broken" };
  if (row.needsGreg) return { label: "needs you", tone: "you" };
  if (row.authority === "proposed") return { label: "proposal", tone: "unapproved" };
  if (row.authorizedRevision !== row.revision) return { label: "approval lapsed", tone: "unapproved" };
  return { label: "ready", tone: "ready" };
}

/**
 * The depth line, as clauses — only the non-zero ones.
 *
 * *"12 ready · 4 need you"* rather than *"12 ready, 4 need you, 0 unauthorised,
 * 0 running"*: a row of zeroes is noise, and it makes the number that is not
 * zero harder to find. An entirely empty queue returns an empty array, and the
 * panel says something else instead.
 */
export function depthClauses(depth: QueueDepth): string[] {
  const clauses: string[] = [];
  if (depth.dispatchable > 0) clauses.push(`${depth.dispatchable} ready`);
  if (depth.needsGreg > 0) clauses.push(`${depth.needsGreg} need you`);
  if (depth.unauthorized > 0) clauses.push(`${depth.unauthorized} not approved`);
  /* **First in the sentence when it is non-zero**, because it is a fact about
     the file rather than about the rows, and it makes the other counts moot. */
  if (depth.queueHeld > 0) clauses.unshift(`${depth.queueHeld} held by a broken queue file`);
  if (depth.dispatched > 0) clauses.push(`${depth.dispatched} running`);
  return clauses;
}

/** `qi-a3k9mq2p` → `a3k9mq2p`. The prefix is the same on every row, so it is noise on screen. */
export function shortId(id: string): string {
  return id.startsWith("qi-") ? id.slice(3) : id;
}
