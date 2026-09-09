/**
 * The per-session hold after a send nobody can account for —
 * tools/fleet/quarantine.ts, and the seams it is consulted at.
 *
 * **NOTHING HERE SENDS A KEYSTROKE.** Every transport is injected and the tmux
 * ids are fictional, the same discipline as tests/fleet-drain.test.ts: there
 * are ~35 live agent sessions on this box doing other people's work.
 *
 * THE ASSERTION THIS FILE EXISTS FOR is that after an ambiguous send **the next
 * item does not go out**, and that it is asserted through `queue.next()` rather
 * than through the book's own bookkeeping — the book agreeing with itself is
 * not evidence that the drain asks it. The three producers each get a test that
 * goes all the way to `next()` for the same reason: a producer that forgets to
 * open a hold must be a red test, not a silent gap.
 *
 * THE CLOCK IS A PARAMETER. Nothing here waits.
 *
 * docs/plans/260908j § Stage 4.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import type { FleetRow, FleetSnapshot } from "../tools/fleet/collect.js";
import { createDrainCursor, drainOnce } from "../tools/fleet/drain.js";
import { classifyGate, type PaneOption } from "../tools/fleet/pane.js";
import {
  QuarantineBook,
  MAX_CLOSED_PER_SESSION,
  type HoldEvidence,
} from "../tools/fleet/quarantine.js";
import { SteeringQueue } from "../tools/fleet/queue.js";
import { makeActionRoutes } from "../tools/fleet/routes-actions.js";
import { createRateLimiter, makeSteerRoutes } from "../tools/fleet/routes-steer.js";
import { makeSendCoordinator, type SendCoordinator, type SendCoordinatorDeps } from "../tools/fleet/send-coordinator.js";
import type { FleetStatus } from "../tools/fleet/status.js";
import type { SeenQuestion, SteerResult } from "../tools/fleet/steer.js";

/**
 * A coordinator over a named book, with a fake transport.
 *
 * **THE BOOK IS PASSED IN RATHER THAN MADE HERE, AND THAT IS THE WHOLE POINT
 * OF THE HELPER.** Every producer's own tests used to inject a book each, which
 * proved that each producer talks to *a* book and nothing about whether they
 * talk to the SAME one. These tests still inject — a module-level singleton
 * written to by every test in a file is the shape that passes alone and fails
 * in a batch — but the injection is now explicit at the seam, and the join
 * between the two real compositions is asserted in
 * tests/fleet-send-composition.test.ts, where it belongs.
 */
function sends(
  book: SendCoordinatorDeps["book"],
  sendMessage: SendCoordinatorDeps["sendMessage"],
  answerQuestion?: SendCoordinatorDeps["answerQuestion"],
): SendCoordinator {
  return makeSendCoordinator({
    book,
    sendMessage,
    answerQuestion:
      answerQuestion ??
      (() => {
        throw new Error("this test does not answer dialogs");
      }),
  });
}

const SESSION = "$97001";
const OTHER_SESSION = "$97002";
const PANE = "%97001";
const CONVO = "5aa1e5a8-9c2e-4c0e-9a51-6b0dc2f3f1aa";
const INSTANCE = "2b3c4d5e";

function makeBook(serverInstanceId = INSTANCE) {
  const clock = { t: 1_700_000_000_000 };
  const book = new QuarantineBook({ now: () => clock.t, serverInstanceId });
  return { book, clock, advance: (ms: number) => (clock.t += ms) };
}

function evidence(over: Partial<HoldEvidence> = {}): HoldEvidence {
  return {
    sessionId: SESSION,
    paneId: PANE,
    claudeSessionId: CONVO,
    reading: "partial",
    origin: "queued-delivery",
    what: "message (42 characters)",
    ...over,
  };
}

describe("opening a hold", () => {
  it("holds the session, with a sentence rather than a code", () => {
    const { book } = makeBook();
    const hold = book.hold(evidence());
    expect(hold.outcome.kind).toBe("holding");
    expect(hold.incidents).toBe(1);
    expect(hold.version).toBe(1);
    expect(hold.sessionId).toBe(SESSION);
    // A SENTENCE, following `QueuedItem.invalidated`. A person decides from it.
    expect(hold.why.length).toBeGreaterThan(40);
    expect(book.holding(SESSION)?.id).toBe(hold.id);
    expect(book.holding(OTHER_SESSION)).toBeNull();
  });

  it("stamps the run of the server, and the id carries it", () => {
    const { book } = makeBook();
    const hold = book.hold(evidence());
    expect(hold.serverInstanceId).toBe(INSTANCE);
    expect(hold.id.startsWith(`${INSTANCE}-`)).toBe(true);
    expect(book.idOrigin(hold.id)).toBe("this-instance");
    expect(book.idOrigin("0badcafe-h1")).toBe("other-instance");
    expect(book.idOrigin("h1")).toBe("not-instance-qualified");
  });

  it("a second uncertain send extends the same hold rather than opening a second", () => {
    const { book, advance } = makeBook();
    const first = book.hold(evidence());
    advance(5_000);
    const second = book.hold(evidence({ reading: "unknown", origin: "direct-steer" }));
    expect(second.id).toBe(first.id);
    expect(second.version).toBe(2);
    expect(second.incidents).toBe(2);
    expect(second.reading).toBe("unknown");
    expect(second.origin).toBe("direct-steer");
    expect(second.openedAt).toBe(first.openedAt);
    expect(second.lastSendAt).toBeGreaterThan(first.openedAt);
  });

  it("each of the four readings produces its own sentence", () => {
    const seen = new Set<string>();
    for (const reading of ["partial", "unknown", "threw", "none-contradicted"] as const) {
      const { book } = makeBook();
      seen.add(book.hold(evidence({ reading })).why);
    }
    expect(seen.size).toBe(4);
  });

  it("never claims the message was not delivered", () => {
    for (const reading of ["partial", "unknown", "threw", "none-contradicted"] as const) {
      const { book } = makeBook();
      const why = book.hold(evidence({ reading })).why;
      expect(why).not.toMatch(/did not arrive|was not delivered|nothing reached/i);
    }
  });
});

describe("releasing a hold", () => {
  it("records the operator's claim as a claim, and lets the session drain again", () => {
    const { book } = makeBook();
    const hold = book.hold(evidence());
    const r = book.release({ holdId: hold.id, version: hold.version, gesture: "operator-confirmed" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repeat).toBe(false);
    expect(r.hold.outcome.kind).toBe("released");
    if (r.hold.outcome.kind !== "released") return;
    expect(r.hold.outcome.gesture).toBe("operator-confirmed");
    // Operator-claimed, never system-observed. The sentence must say who says so.
    expect(r.hold.outcome.what).toMatch(/looked|said|told/i);
    expect(book.holding(SESSION)).toBeNull();
  });

  it("abandoning claims nothing in either direction", () => {
    const { book } = makeBook();
    const hold = book.hold(evidence());
    const r = book.release({ holdId: hold.id, version: hold.version, gesture: "abandoned-unknown" });
    expect(r.ok).toBe(true);
    if (!r.ok || r.hold.outcome.kind !== "released") return;
    const what = r.hold.outcome.what;
    expect(what).not.toMatch(/was not delivered|did not arrive|nothing was sent|never arrived/i);
    expect(what).toMatch(/still not known|cannot|unknown|no way to know/i);
    expect(book.holding(SESSION)).toBeNull();
  });

  it("is idempotent: the same request again answers the same thing", () => {
    const { book } = makeBook();
    const hold = book.hold(evidence());
    const once = book.release({ holdId: hold.id, version: hold.version, gesture: "abandoned-unknown" });
    const twice = book.release({ holdId: hold.id, version: hold.version, gesture: "abandoned-unknown" });
    expect(once.ok && twice.ok).toBe(true);
    if (!once.ok || !twice.ok) return;
    expect(twice.repeat).toBe(true);
    expect(twice.hold.outcome).toEqual(once.hold.outcome);
  });

  it("refuses a different gesture over one already recorded", () => {
    const { book } = makeBook();
    const hold = book.hold(evidence());
    book.release({ holdId: hold.id, version: hold.version, gesture: "abandoned-unknown" });
    const r = book.release({ holdId: hold.id, version: hold.version, gesture: "operator-confirmed" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.rule).toBe("other-gesture");
  });

  it("a stale phone cannot release a hold that has absorbed another send", () => {
    const { book } = makeBook();
    const first = book.hold(evidence());
    book.hold(evidence({ reading: "unknown" }));
    const r = book.release({ holdId: first.id, version: 1, gesture: "abandoned-unknown" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.rule).toBe("version-mismatch");
    // AND THE SESSION IS STILL HELD. The refusal is the point.
    expect(book.holding(SESSION)?.version).toBe(2);
  });

  it("names a hold this run never minted rather than inventing one", () => {
    const { book } = makeBook();
    const r = book.release({ holdId: `${INSTANCE}-h99`, version: 1, gesture: "abandoned-unknown" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.rule).toBe("no-such-hold");
    expect(r.hold).toBeNull();
  });

  it("works for a session that has gone away — nothing about it is asked of a snapshot", () => {
    // THE FAILURE MODE THIS STAGE CARES MOST ABOUT: a hold that outlives every
    // gesture that could clear it. The book knows about sessions and nothing
    // else, so a session that no longer exists is not a different case.
    const { book } = makeBook();
    const hold = book.hold(evidence({ sessionId: "$97099", paneId: null, claudeSessionId: null }));
    const r = book.release({ holdId: hold.id, version: hold.version, gesture: "abandoned-unknown" });
    expect(r.ok).toBe(true);
    expect(book.holding("$97099")).toBeNull();
  });
});

describe("generations", () => {
  it("a proven tmux restart releases the hold and keeps the record as superseded", () => {
    const { book } = makeBook();
    book.noteGeneration(770_001);
    const hold = book.hold(evidence());
    expect(hold.tmuxGeneration).toBe(770_001);
    const superseded = book.noteGeneration(770_002);
    expect(superseded).toBe(1);
    expect(book.holding(SESSION)).toBeNull();
    const record = book.find(hold.id);
    expect(record?.outcome.kind).toBe("superseded");
    if (record?.outcome.kind !== "superseded") return;
    expect(record.outcome.was).toBe(770_001);
    expect(record.outcome.now).toBe(770_002);
  });

  it("the FIRST observation of a generation is not a change, so it supersedes nothing", () => {
    const { book } = makeBook();
    const hold = book.hold(evidence());
    expect(hold.tmuxGeneration).toBeNull();
    expect(book.noteGeneration(770_001)).toBe(0);
    expect(book.holding(SESSION)?.id).toBe(hold.id);
  });

  it("a hold opened before this server knew the generation is remembered against the first one it sees", () => {
    // THE CONSERVATIVE ARM, AND IT IS DELIBERATE — but only for one
    // observation. A hold opened while this server had not yet been told which
    // tmux server it was reading is bound to no generation, so the FIRST thing
    // heard afterwards proves nothing: it may well be the same server the send
    // went to. It is recorded and nothing else, on a field of its own, because
    // it is not a claim about the moment of the send.
    const { book } = makeBook();
    const hold = book.hold(evidence());
    expect(hold.tmuxGeneration).toBeNull();
    expect(hold.firstSeenGeneration).toBeNull();
    expect(book.noteGeneration(770_001)).toBe(0);
    expect(book.holding(SESSION)?.id).toBe(hold.id);
    // Recorded, and NOT written into `tmuxGeneration`, which would be a claim
    // that this is where the send went.
    expect(book.holding(SESSION)?.firstSeenGeneration).toBe(770_001);
    expect(book.holding(SESSION)?.tmuxGeneration).toBeNull();
    // Hearing the same one again is still not a change.
    expect(book.noteGeneration(770_001)).toBe(0);
    expect(book.holding(SESSION)?.id).toBe(hold.id);
    // …and it is releasable throughout, which is what stops it being a hold
    // nothing can clear.
    expect(book.release({ holdId: hold.id, version: 1, gesture: "abandoned-unknown" }).ok).toBe(true);
  });

  it("and a SECOND, different generation supersedes it — the window is not indefinite", () => {
    // **THE CORRECTION TO THE CONSERVATIVE ARM, AND IT WAS TOO BROAD.** Saying
    // *no later change proves anything about this hold* is true of the first
    // observation and false of the second: two different tmux servers seen
    // after it opened means one replaced the other, whichever of them the send
    // went to — every pane went with it either way. Without this, a hold opened
    // in the seconds before the first collection held its session for ever, and
    // the "one refresh cycle wide" window in the plan was indefinite.
    const { book } = makeBook();
    const hold = book.hold(evidence());
    expect(hold.tmuxGeneration).toBeNull();
    book.noteGeneration(770_001);
    expect(book.noteGeneration(770_002)).toBe(1);
    expect(book.holding(SESSION)).toBeNull();
    const record = book.find(hold.id);
    expect(record?.outcome.kind).toBe("superseded");
    if (record?.outcome.kind !== "superseded") return;
    expect(record.outcome.was).toBe(770_001);
    expect(record.outcome.now).toBe(770_002);
    // AND THE SENTENCE DOES NOT CLAIM THE SEND WENT TO 770_001. It cannot know
    // that, and a superseded record is read by a person deciding whether
    // anything is still owed to that session.
    expect(record.outcome.what).toMatch(/had not been told|cannot say which/i);
  });

  it("a superseded hold cannot be released, and says so rather than dead-ending", () => {
    const { book } = makeBook();
    book.noteGeneration(770_001);
    const hold = book.hold(evidence());
    book.noteGeneration(770_002);
    const r = book.release({ holdId: hold.id, version: hold.version, gesture: "abandoned-unknown" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.rule).toBe("already-superseded");
    expect(r.why).toMatch(/tmux/i);
  });
});

describe("what it remembers, and what it forgets", () => {
  it("keeps a bounded history per session and never drops the open one", () => {
    const { book } = makeBook();
    const ids: string[] = [];
    for (let n = 0; n < MAX_CLOSED_PER_SESSION + 3; n += 1) {
      const hold = book.hold(evidence());
      ids.push(hold.id);
      book.release({ holdId: hold.id, version: hold.version, gesture: "abandoned-unknown" });
    }
    const open = book.hold(evidence());
    expect(book.holding(SESSION)?.id).toBe(open.id);
    const remembered = ids.filter((id) => book.find(id) !== null);
    expect(remembered.length).toBe(MAX_CLOSED_PER_SESSION);
    // The ones it kept are the most recent, not the first it happened to see.
    expect(remembered).toEqual(ids.slice(-MAX_CLOSED_PER_SESSION));
  });

  it("lists every session it is holding, for a page that has to draw them", () => {
    const { book } = makeBook();
    book.hold(evidence());
    const other = book.hold(evidence({ sessionId: OTHER_SESSION }));
    expect(new Set(book.heldSessions())).toEqual(new Set([SESSION, OTHER_SESSION]));
    book.release({ holdId: other.id, version: other.version, gesture: "abandoned-unknown" });
    expect(book.heldSessions()).toEqual([SESSION]);
  });
});

/* ------------------------------------------------------------------ *
 * The seam. Everything above is the book agreeing with itself; these ask
 * `SteeringQueue.next()`, which is what actually decides whether keys go out.
 * ------------------------------------------------------------------ */

const IDLE: FleetStatus = { kind: "idle" };

function makeQueue() {
  const clock = { t: 1_700_000_000_000 };
  const quarantine = new QuarantineBook({ now: () => clock.t, serverInstanceId: INSTANCE });
  const q = new SteeringQueue({ now: () => clock.t, serverInstanceId: INSTANCE, quarantine });
  return { q, quarantine, clock, advance: (ms: number) => (clock.t += ms) };
}

const TARGET = { sessionId: SESSION, claudeSessionId: CONVO };

/** A fictional tmux server, so a generation is something a fixture can name. */
const TMUX = 970_001;

function fleetRow(over: Partial<FleetRow> = {}): FleetRow {
  return {
    /* `not-yet-described` rather than a blank: a row nobody has described
       is a different fact from a session with nothing to say. */
    description: { kind: "not-yet-described", why: "no describe pass in this fixture" },
    id: SESSION,
    name: "wf-quarantine-fixture",
    title: null,
    repo: null,
    worktree: null,
    meta: { version: "legacy" },
    role: { kind: "none" },
    startedAt: "2026-09-09T00:00:00.000Z",
    pause: { kind: "cannot-tell", why: "the fixture did not say", cause: "rate-limits-not-collected" },
    // Required on a row and not what this file is about: a fixture is not a box
    // whose process table anybody probed.
    execution: { kind: "unknown", cause: "not-probed", why: "the fixture did not probe the process table" },
    status: IDLE,
    paneId: PANE,
    panePid: 424242,
    claudeSessionId: CONVO,
    question: null,
    permissionMode: { kind: "cannot-tell", why: "a fixture row, not a pane that was read" },
    ...over,
  };
}

function snapshot(rows: FleetRow[] = [fleetRow()]): FleetSnapshot {
  return { rows, collectedAt: "2026-09-09T00:00:00.000Z", tookMs: 13_000, tmuxServerPid: TMUX };
}

/** The body the page posts to steer one session. */
/**
 * A dialog on screen, for the answer path.
 *
 * `gate` is CALLED rather than written out, matching tests/fleet-steer-route.ts:
 * `parseQuestion` recomputes it, so a literal here would be this file's opinion
 * of the classifier rather than the classifier's.
 */
const SEEN_OPTIONS: PaneOption[] = [
  { label: "Yes, proceed", key: { via: "selected" }, consequence: "once" },
  { label: "No, exit", key: { via: "arrows", key: "Down", presses: 1 }, consequence: "decline" },
];

const SEEN: SeenQuestion = {
  kind: "question",
  prompt: "Do you trust the files in this folder?",
  material: { kind: "no-material" },
  options: SEEN_OPTIONS,
  gate: classifyGate({ kind: "no-material" }, SEEN_OPTIONS),
};

function answerBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    paneId: PANE,
    sessionId: SESSION,
    claudeSessionId: CONVO,
    panePid: 424242,
    status: { kind: "needs-you" },
    question: SEEN,
    optionIndex: 1,
    ...over,
  };
}

function steerBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    paneId: PANE,
    sessionId: SESSION,
    claudeSessionId: CONVO,
    panePid: 424242,
    status: { kind: "idle" },
    text: "have a look at the failing test before you push",
    speaker: "greg",
    ...over,
  };
}

describe("the queue consults the hold", () => {
  it("hands nothing out while the session is held, and says why in the hold's own words", () => {
    const { q, quarantine } = makeQueue();
    expect(q.enqueueMessage(TARGET, "check the logs", "greg").ok).toBe(true);
    const hold = quarantine.hold(evidence());
    const next = q.next(SESSION, { status: IDLE, claudeSessionId: CONVO });
    expect(next.kind).toBe("quarantined");
    if (next.kind !== "quarantined") return;
    expect(next.hold.id).toBe(hold.id);
    expect(next.why).toBe(hold.why);
    // NOTHING WAS LEASED. That is the assertion, not the arm's name.
    expect(q.snapshot(SESSION).items[0]?.leasedAt).toBeNull();
  });

  it("holds even a session whose gate says now, which is the whole point", () => {
    const { q, quarantine } = makeQueue();
    q.enqueueMessage(TARGET, "check the logs", "greg");
    quarantine.hold(evidence());
    expect(q.next(SESSION, { status: IDLE, claudeSessionId: CONVO }).kind).toBe("quarantined");
  });

  it("releasing the hold lets the same item go out", () => {
    const { q, quarantine } = makeQueue();
    q.enqueueMessage(TARGET, "check the logs", "greg");
    const hold = quarantine.hold(evidence());
    q.next(SESSION, { status: IDLE, claudeSessionId: CONVO });
    quarantine.release({ holdId: hold.id, version: hold.version, gesture: "operator-confirmed" });
    expect(q.next(SESSION, { status: IDLE, claudeSessionId: CONVO }).kind).toBe("ready");
  });

  it("settles the leased item and opens the hold in ONE call", () => {
    const { q, quarantine } = makeQueue();
    q.enqueueMessage(TARGET, "first", "greg");
    q.enqueueMessage(TARGET, "second", "greg");
    const leased = q.next(SESSION, { status: IDLE, claudeSessionId: CONVO });
    expect(leased.kind).toBe("ready");
    if (leased.kind !== "ready") return;

    const done = q.quarantineLeased(SESSION, leased.item.id, {
      paneId: PANE,
      claudeSessionId: CONVO,
      reading: "partial",
      origin: "queued-delivery",
      what: "message (5 characters)",
    });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    // `uncertain`, not `refused`: it may well have been delivered.
    expect(done.outcome).toBe("uncertain");
    expect(quarantine.holding(SESSION)?.id).toBe(done.hold.id);
    // The item is gone — settled, never retried — and the SECOND one is held.
    expect(q.snapshot(SESSION).items.map((i) => i.id)).not.toContain(leased.item.id);
    expect(q.next(SESSION, { status: IDLE, claudeSessionId: CONVO }).kind).toBe("quarantined");
  });

  it("refuses to quarantine an item that was never handed out", () => {
    const { q } = makeQueue();
    const enqueued = q.enqueueMessage(TARGET, "first", "greg");
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) return;
    const r = q.quarantineLeased(SESSION, enqueued.item.id, {
      paneId: PANE,
      claudeSessionId: CONVO,
      reading: "partial",
      origin: "queued-delivery",
      what: "message (5 characters)",
    });
    expect(r.ok).toBe(false);
    // AND NO HOLD WAS OPENED. Half of an atomic pair is the failure this
    // method exists to make unrepresentable.
    expect(q.snapshot(SESSION).quarantine).toBeNull();
  });

  it("a queue with a hold and NO items is still a queue the page is told about", () => {
    // THE INVISIBLE HOLD, which is the commonest shape: one message queued, one
    // ambiguous send, the item settled and gone, and nothing left in `items`.
    const { q, quarantine } = makeQueue();
    quarantine.hold(evidence());
    expect(q.size(SESSION)).toBe(0);
    const snapshots = q.snapshots();
    expect(snapshots.map((s) => s.sessionId)).toEqual([SESSION]);
    expect(snapshots[0]?.items).toEqual([]);
    expect(snapshots[0]?.quarantine?.id).toBe(quarantine.holding(SESSION)?.id);
  });

  it("tells the book about a tmux generation change, so one release reaches both", () => {
    const { q, quarantine } = makeQueue();
    q.noteGeneration(770_001);
    quarantine.hold(evidence());
    q.noteGeneration(770_002);
    expect(quarantine.holding(SESSION)).toBeNull();
    expect(q.snapshot(SESSION).quarantine).toBeNull();
  });
});

/* ================================================================== *
 * THE THREE PRODUCERS.
 *
 * `sendMessage` is called from three places and every one of them can leave the
 * same half-typed input box. **Each test below goes all the way to
 * `queue.next()`**, not to the book: the book agreeing with itself proves
 * nothing about whether a producer reached it, and "the missing-join half of
 * the same taxonomy" is exactly what these are here to stop. A fourth producer
 * added without a hold should be a red test in this block.
 * ================================================================== */

const PARTIAL: SteerResult = {
  ok: false,
  reason: { code: "send-failed", why: "the second send-keys did not complete" },
  delivery: "partial",
  sent: [["send-keys", "-t", PANE, "-l", "--", "…"]],
};

/** A response that resolves when the route has answered. */
function fakeRes(): { res: ServerResponse; seen: { status: number | null; body: string; done: Promise<void> } } {
  let settle: () => void = () => {};
  const seen = { status: null as number | null, body: "", done: Promise.resolve() };
  seen.done = new Promise<void>((r) => {
    settle = r;
  });
  const res = {
    writeHead(status: number) {
      seen.status = status;
      return res;
    },
    end(chunk?: string) {
      seen.body = chunk ?? "";
      settle();
      return res;
    },
  };
  return { res: res as unknown as ServerResponse, seen };
}

const HOST = "100.90.80.70:8787";

function fakeReq(url: string, body: unknown, method = "POST"): IncomingMessage {
  const stream = new PassThrough();
  const text = JSON.stringify(body);
  if (method !== "GET") stream.write(text);
  stream.end();
  return Object.assign(stream, {
    url,
    method,
    headers: { host: HOST, origin: `http://${HOST}`, "content-type": "application/json" },
    socket: { remoteAddress: "100.90.80.71" },
  }) as unknown as IncomingMessage;
}

async function post(handle: (req: IncomingMessage, res: ServerResponse) => boolean, req: IncomingMessage) {
  const { res, seen } = fakeRes();
  expect(handle(req, res)).toBe(true);
  await seen.done;
  return { status: seen.status, json: seen.body === "" ? {} : (JSON.parse(seen.body) as Record<string, unknown>) };
}

describe("every ambiguous send holds the session — the drain", () => {
  it("stops the SECOND item after the first came back partial", () => {
    const { q, quarantine, clock } = makeQueue();
    q.enqueueMessage(TARGET, "first", "greg");
    q.enqueueMessage(TARGET, "second", "greg");
    const outcome = drainOnce(snapshot(), {
      queue: q,
      cursor: createDrainCursor(),
      send: sends(quarantine, () => PARTIAL),
      log: () => {},
      now: () => clock.t,
    });
    expect(outcome.outcomes.map((o) => o.kind)).toEqual(["uncertain"]);
    expect(outcome.quarantined).toBe(1);
    expect(quarantine.holding(SESSION)).not.toBeNull();
    // THE ASSERTION: the next pass hands nothing out.
    const second = drainOnce(snapshot(), {
      queue: q,
      cursor: createDrainCursor(),
      send: sends(quarantine, () => {
        throw new Error("a second send must not be attempted while the session is held");
      }),
      log: () => {},
      now: () => clock.t,
    });
    expect(second.outcomes[0]).toMatchObject({ kind: "held", reason: "quarantined" });
  });

  it("settles the first item `uncertain`, and does not put it back", () => {
    const { q, quarantine, clock } = makeQueue();
    q.enqueueMessage(TARGET, "first", "greg");
    drainOnce(snapshot(), { queue: q, cursor: createDrainCursor(), send: sends(quarantine, () => PARTIAL), log: () => {}, now: () => clock.t });
    expect(q.size(SESSION)).toBe(0);
  });

  it("holds on `unknown` too, and on a `none` the transport's own list contradicts", () => {
    // **THE READING IS ASSERTED, NOT JUST THE HOLD.** A drain that held every
    // ambiguous send under one word would pass a test that only asked whether
    // something was held, and the sentence a person reads comes from the
    // reading. The third case is the one worth spelling out: `delivery: "none"`
    // with a non-empty `sent` list is a self-contradicting report, and the
    // honest arm for it is not `none`.
    const cases: [SteerResult, string][] = [
      [PARTIAL, "partial"],
      [{ ...PARTIAL, delivery: "unknown" }, "unknown"],
      [{ ...PARTIAL, delivery: "none" }, "none-contradicted"],
    ];
    for (const [result, reading] of cases) {
      const { q, quarantine, clock } = makeQueue();
      q.enqueueMessage(TARGET, "first", "greg");
      drainOnce(snapshot(), { queue: q, cursor: createDrainCursor(), send: sends(quarantine, () => result), log: () => {}, now: () => clock.t });
      expect(quarantine.holding(SESSION)?.reading).toBe(reading);
      expect(quarantine.holding(SESSION)?.origin).toBe("queued-delivery");
    }
  });

  it("a refusal that provably sent NOTHING still puts the item back and holds nothing", () => {
    // THE ARM THAT MUST NOT CHANGE. `pane-is-asking` is the commonest refusal on
    // this box and it fires before any keystroke; holding on it would destroy
    // the person's instruction at the moment they most wanted it delivered.
    const { q, quarantine, clock } = makeQueue();
    q.enqueueMessage(TARGET, "first", "greg");
    const unsent: SteerResult = { ok: false, reason: { code: "pane-is-asking", why: "a dialog is up" }, delivery: "none", sent: [] };
    const r = drainOnce(snapshot(), { queue: q, cursor: createDrainCursor(), send: sends(quarantine, () => unsent), log: () => {}, now: () => clock.t });
    expect(r.outcomes.map((o) => o.kind)).toEqual(["put-back"]);
    expect(r.quarantined).toBe(0);
    expect(quarantine.holding(SESSION)).toBeNull();
    expect(q.size(SESSION)).toBe(1);
  });

  it("a throw leaves the lease open and opens no hold — the stronger block, not the weaker one", () => {
    const { q, quarantine, clock } = makeQueue();
    q.enqueueMessage(TARGET, "first", "greg");
    const r = drainOnce(snapshot(), {
      queue: q,
      cursor: createDrainCursor(),
      send: sends(quarantine, () => {
        throw new Error("tmux went away");
      }),
      log: () => {},
      now: () => clock.t,
    });
    expect(r.outcomes.map((o) => o.kind)).toEqual(["threw"]);
    expect(quarantine.holding(SESSION)).toBeNull();
    expect(q.snapshot(SESSION).items[0]?.leasedAt).not.toBeNull();
  });
});

describe("every ambiguous send holds the session — the direct steer route", () => {
  it("a partial send from the page stops the queue draining into the same input box", async () => {
    const { q, quarantine } = makeQueue();
    q.enqueueMessage(TARGET, "queued behind it", "greg");
    const routes = makeSteerRoutes({
      send: sends(quarantine, () => PARTIAL),
      log: () => {},
      limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
    });
    const r = await post(routes.handle, fakeReq("/api/steer/message", steerBody()));
    expect(r.json.delivery).toBe("partial");
    expect(q.next(SESSION, { status: IDLE, claudeSessionId: CONVO }).kind).toBe("quarantined");
    expect(quarantine.holding(SESSION)?.reading).toBe("partial");
    expect(quarantine.holding(SESSION)?.origin).toBe("direct-steer");
  });

  it("a throw out of the delivery module holds it too — the exception says nothing either way", async () => {
    const { q, quarantine } = makeQueue();
    q.enqueueMessage(TARGET, "queued behind it", "greg");
    const routes = makeSteerRoutes({
      send: sends(quarantine, () => {
        throw new Error("tmux went away");
      }),
      log: () => {},
      limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
    });
    const r = await post(routes.handle, fakeReq("/api/steer/message", steerBody()));
    expect(r.status).toBe(500);
    expect(q.next(SESSION, { status: IDLE, claudeSessionId: CONVO }).kind).toBe("quarantined");
    expect(quarantine.holding(SESSION)?.reading).toBe("threw");
  });

  it("a refusal that sent nothing holds nothing", async () => {
    const { q, quarantine } = makeQueue();
    q.enqueueMessage(TARGET, "queued behind it", "greg");
    const routes = makeSteerRoutes({
      send: sends(quarantine, () => ({ ok: false, reason: { code: "pane-is-asking", why: "a dialog is up" }, delivery: "none", sent: [] })),
      log: () => {},
      limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
    });
    await post(routes.handle, fakeReq("/api/steer/message", steerBody()));
    expect(quarantine.holding(SESSION)).toBeNull();
    expect(q.next(SESSION, { status: IDLE, claudeSessionId: CONVO }).kind).toBe("ready");
  });

  it("a send that worked holds nothing", async () => {
    const { q, quarantine } = makeQueue();
    q.enqueueMessage(TARGET, "queued behind it", "greg");
    const routes = makeSteerRoutes({
      send: sends(quarantine, () => ({
        ok: true,
        verified: { paneId: PANE, sessionId: SESSION, panePid: 424242, claudePid: 424299 },
        sent: [["send-keys", "-t", PANE, "-l", "--", "…"]],
      })),
      log: () => {},
      limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
    });
    await post(routes.handle, fakeReq("/api/steer/message", steerBody()));
    expect(quarantine.holding(SESSION)).toBeNull();
    expect(q.next(SESSION, { status: IDLE, claudeSessionId: CONVO }).kind).toBe("ready");
  });
});

describe("every ambiguous send holds the session — the broadcast", () => {
  it("holds each recipient whose send came back ambiguous, and no others", async () => {
    const { q, quarantine, clock } = makeQueue();
    q.enqueueMessage(TARGET, "queued behind it", "greg");
    const routes = makeActionRoutes({
      queue: q,
      send: sends(quarantine, (target) =>
        target.sessionId === SESSION
          ? PARTIAL
          : { ok: true, verified: { paneId: target.paneId, sessionId: target.sessionId, panePid: 1, claudePid: 2 }, sent: [] }),
      now: () => clock.t,
      limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
      log: () => {},
      actEnabled: () => true,
      yieldToLoop: () => Promise.resolve(),
    });
    const r = await post(routes.handle, fakeReq("/api/actions/box", {
      actionId: "resource-broadcast",
      mode: "run",
      confirm: true,
      speaker: "greg",
      recipients: [
        { paneId: PANE, sessionId: SESSION, claudeSessionId: CONVO, status: { kind: "idle" } },
        { paneId: "%97009", sessionId: OTHER_SESSION, claudeSessionId: CONVO, status: { kind: "idle" } },
      ],
    }));
    expect(r.status).toBe(200);
    expect(quarantine.holding(SESSION)?.origin).toBe("broadcast");
    expect(quarantine.holding(OTHER_SESSION)).toBeNull();
    expect(q.next(SESSION, { status: IDLE, claudeSessionId: CONVO }).kind).toBe("quarantined");
  });

  it("holds a recipient the delivery module threw on", async () => {
    const { q, quarantine, clock } = makeQueue();
    const routes = makeActionRoutes({
      queue: q,
      send: sends(quarantine, () => {
        throw new Error("tmux went away");
      }),
      now: () => clock.t,
      limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
      log: () => {},
      actEnabled: () => true,
      yieldToLoop: () => Promise.resolve(),
    });
    await post(routes.handle, fakeReq("/api/actions/box", {
      actionId: "resource-broadcast",
      mode: "run",
      confirm: true,
      speaker: "greg",
      recipients: [{ paneId: PANE, sessionId: SESSION, claudeSessionId: CONVO, status: { kind: "idle" } }],
    }));
    expect(quarantine.holding(SESSION)?.reading).toBe("threw");
  });

  it("a dry run holds nothing, because it sends nothing", async () => {
    const { q, quarantine, clock } = makeQueue();
    const routes = makeActionRoutes({
      queue: q,
      send: sends(quarantine, () => PARTIAL),
      now: () => clock.t,
      limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
      log: () => {},
      actEnabled: () => true,
      yieldToLoop: () => Promise.resolve(),
    });
    await post(routes.handle, fakeReq("/api/actions/box", {
      actionId: "resource-broadcast",
      mode: "dry-run",
      speaker: "greg",
      recipients: [{ paneId: PANE, sessionId: SESSION, claudeSessionId: CONVO, status: { kind: "idle" } }],
    }));
    expect(quarantine.holding(SESSION)).toBeNull();
  });
});

/* ================================================================== *
 * THE OTHER HALF, AND IT WAS MISSING.
 *
 * Recording the hold is not the guarantee. **The guarantee is that a held
 * session is not typed into**, and for a stage of this file's life exactly one
 * of the four paths kept it: `SteeringQueue.next()`. The direct steer route
 * never asked, and the broadcast chose its recipients on `drainGate` alone — so
 * a session the page was drawing as HELD could still be sent a message from the
 * phone, or a fan-out sentence, landing behind half of somebody else's.
 *
 * **EACH TEST BELOW ASSERTS THE TRANSPORT WAS NOT REACHED**, not that a refusal
 * came back. A route that answered 409 and typed anyway would pass the weaker
 * assertion, and typing anyway is the whole failure.
 * ================================================================== */

/** A recorder that fails the test loudly if anything reaches it. */
function transportThatMustNotBeReached(typedAt: string[]) {
  return (target: { sessionId: string }): SteerResult => {
    typedAt.push(target.sessionId);
    return PARTIAL;
  };
}

describe("a held session is not typed into — every path", () => {
  it("the direct message route does not reach the transport", async () => {
    const { q, quarantine } = makeQueue();
    const typedAt: string[] = [];
    quarantine.hold(evidence());
    const routes = makeSteerRoutes({
      send: sends(quarantine, transportThatMustNotBeReached(typedAt)),
      log: () => {},
      limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
    });
    const r = await post(routes.handle, fakeReq("/api/steer/message", steerBody()));

    expect(typedAt).toEqual([]);
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("session-held");
    // `delivery: "none"` is the one claim this arm can make, and it is true:
    // no keystroke left this process for THIS request.
    expect(r.json.delivery).toBe("none");
    // The hold is unchanged — a refused send is not a second incident.
    expect(quarantine.holding(SESSION)?.version).toBe(1);
    expect(quarantine.holding(SESSION)?.incidents).toBe(1);
    // And nothing was queued behind it either: this route sends or refuses.
    expect(q.size(SESSION)).toBe(0);
  });

  it("the direct answer route does not reach the transport", async () => {
    // A DIALOG ANSWER IS A KEYSTROKE TOO — a digit, or a Down and a Return —
    // and it lands in the same input box as the half-typed sentence. The path
    // is separate in the route, so it is separate here.
    const { quarantine } = makeQueue();
    const typedAt: string[] = [];
    quarantine.hold(evidence());
    const routes = makeSteerRoutes({
      send: makeSendCoordinator({
        book: quarantine,
        sendMessage: transportThatMustNotBeReached(typedAt),
        answerQuestion: (target) => {
          typedAt.push(target.sessionId);
          return PARTIAL;
        },
      }),
      log: () => {},
      answeringEnabled: () => true,
      limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
    });
    const r = await post(routes.handle, fakeReq("/api/steer/answer", answerBody()));

    expect(typedAt).toEqual([]);
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("session-held");
  });

  it("a broadcast skips a held recipient and reaches the transport for the others", async () => {
    // BOTH HALVES IN ONE TEST, deliberately. A fan-out that refused everybody
    // the moment one session was held would also pass "the transport was not
    // reached for the held one", and would be a different bug of the same size:
    // thirty-five agents told nothing because one was holding half a sentence.
    const { quarantine, q, clock } = makeQueue();
    const typedAt: string[] = [];
    quarantine.hold(evidence());
    const routes = makeActionRoutes({
      queue: q,
      send: sends(quarantine, (target) => {
        typedAt.push(target.sessionId);
        return { ok: true, verified: { paneId: target.paneId, sessionId: target.sessionId, panePid: 1, claudePid: 2 }, sent: [] };
      }),
      now: () => clock.t,
      limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
      log: () => {},
      actEnabled: () => true,
      yieldToLoop: () => Promise.resolve(),
    });
    const r = await post(routes.handle, fakeReq("/api/actions/box", {
      actionId: "resource-broadcast",
      mode: "run",
      confirm: true,
      speaker: "greg",
      recipients: [
        { paneId: PANE, sessionId: SESSION, claudeSessionId: CONVO, status: { kind: "idle" } },
        { paneId: "%97009", sessionId: OTHER_SESSION, claudeSessionId: CONVO, status: { kind: "idle" } },
      ],
    }));

    expect(r.status).toBe(200);
    expect(typedAt).toEqual([OTHER_SESSION]);
    const rows = (r.json.result as { recipients: { sessionId: string; outcome: string; why: string | null }[] }).recipients;
    const held = rows.find((x) => x.sessionId === SESSION);
    expect(held?.outcome).toBe("held");
    // The hold's own sentence, not one this route made up about it.
    expect(held?.why ?? "").toContain("held");
    expect(rows.find((x) => x.sessionId === OTHER_SESSION)?.outcome).toBe("keys-submitted");
  });

  it("the drain does not reach the transport, and stops at `next()` rather than at the send", () => {
    // THE PATH THAT ALREADY KEPT THE PROMISE, asserted the same way as the
    // three that did not — and asserted at BOTH depths, because the two are
    // different guarantees. `next()` refusing is what stops the item being
    // leased at all; the coordinator refusing is the floor under it.
    const { q, quarantine, clock } = makeQueue();
    q.enqueueMessage(TARGET, "queued behind the hold", "greg");
    quarantine.hold(evidence());
    const typedAt: string[] = [];
    const r = drainOnce(snapshot(), {
      queue: q,
      cursor: createDrainCursor(),
      send: sends(quarantine, transportThatMustNotBeReached(typedAt)),
      log: () => {},
      now: () => clock.t,
    });

    expect(typedAt).toEqual([]);
    expect(r.outcomes[0]).toMatchObject({ kind: "held", reason: "quarantined" });
    // AND THE ITEM IS STILL THERE, unleased. Nothing about a hold destroys what
    // somebody queued; it waits for the person who has to say what is in that
    // input box.
    expect(q.size(SESSION)).toBe(1);
    expect(q.snapshot(SESSION).items[0]?.leasedAt).toBeNull();
  });
});

/* ================================================================== *
 * THE WAY OUT. A hold that outlives every gesture that could clear it is the
 * worst thing in this design, so these tests try to build one.
 * ================================================================== */

function releaseHarness() {
  const { q, quarantine, clock } = makeQueue();
  const logs: string[] = [];
  const routes = makeActionRoutes({
    queue: q,
    send: sends(quarantine, () => PARTIAL),
    now: () => clock.t,
    limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
    log: (line) => logs.push(line),
    actEnabled: () => true,
    yieldToLoop: () => Promise.resolve(),
  });
  return { q, quarantine, clock, routes, logs };
}

function release(routes: ReturnType<typeof makeActionRoutes>, body: Record<string, unknown>) {
  return post(routes.handle, fakeReq("/api/actions/hold/release", body));
}

describe("POST /api/actions/hold/release", () => {
  it("records that a person looked, and lets the queue move again", async () => {
    const { q, quarantine, routes } = releaseHarness();
    q.enqueueMessage(TARGET, "queued behind it", "greg");
    const hold = quarantine.hold(evidence());
    const r = await release(routes, { holdId: hold.id, version: 1, gesture: "operator-confirmed" });
    expect(r.status).toBe(200);
    expect(r.json.op).toBe("hold-released");
    expect(r.json.repeat).toBe(false);
    expect(q.next(SESSION, { status: IDLE, claudeSessionId: CONVO }).kind).toBe("ready");
  });

  it("neither gesture sends anything — the property the whole protocol turns on", async () => {
    for (const gesture of ["operator-confirmed", "abandoned-unknown"] as const) {
      const { q, quarantine, clock } = makeQueue();
      const typedAt: string[] = [];
      const routes = makeActionRoutes({
        queue: q,
        send: sends(quarantine, (target) => {
          typedAt.push(target.sessionId);
          return PARTIAL;
        }),
        now: () => clock.t,
        limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
        log: () => {},
        actEnabled: () => true,
        yieldToLoop: () => Promise.resolve(),
      });
      // Something IS queued, so a release that decided to "flush" it would show.
      q.enqueueMessage(TARGET, "queued behind it", "greg");
      const hold = quarantine.hold(evidence());
      const r = await release(routes, { holdId: hold.id, version: 1, gesture });
      expect(r.status).toBe(200);
      expect(typedAt).toEqual([]);
    }
  });

  it("is idempotent — a lost response is recoverable by pressing again", async () => {
    const { quarantine, routes } = releaseHarness();
    const hold = quarantine.hold(evidence());
    const body = { holdId: hold.id, version: 1, gesture: "abandoned-unknown" };
    const first = await release(routes, body);
    const second = await release(routes, body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.json.repeat).toBe(true);
    expect((second.json.hold as { outcome: unknown }).outcome).toEqual((first.json.hold as { outcome: unknown }).outcome);
  });

  it("refuses a stale reading, so a phone in a pocket cannot clear what it has not seen", async () => {
    const { quarantine, routes } = releaseHarness();
    const hold = quarantine.hold(evidence());
    quarantine.hold(evidence({ reading: "unknown" }));
    const r = await release(routes, { holdId: hold.id, version: 1, gesture: "abandoned-unknown" });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("hold-version-mismatch");
    expect(quarantine.holding(SESSION)).not.toBeNull();
    // AND THE NEW READING IS RELEASABLE. The refusal must not be a dead end.
    const ok = await release(routes, { holdId: hold.id, version: 2, gesture: "abandoned-unknown" });
    expect(ok.status).toBe(200);
    expect(quarantine.holding(SESSION)).toBeNull();
  });

  it("refuses a second, different answer over one already recorded", async () => {
    const { quarantine, routes } = releaseHarness();
    const hold = quarantine.hold(evidence());
    await release(routes, { holdId: hold.id, version: 1, gesture: "abandoned-unknown" });
    const r = await release(routes, { holdId: hold.id, version: 1, gesture: "operator-confirmed" });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("hold-other-gesture");
  });

  it("names an id from a dead run rather than saying there is no such hold", async () => {
    const { routes } = releaseHarness();
    const r = await release(routes, { holdId: "0badcafe-h1", version: 1, gesture: "abandoned-unknown" });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("other-instance");
  });

  it("says there is no such hold for an id nothing ever minted", async () => {
    const { routes } = releaseHarness();
    const r = await release(routes, { holdId: `${INSTANCE}-h404`, version: 1, gesture: "abandoned-unknown" });
    expect(r.status).toBe(404);
    expect(r.json.code).toBe("no-such-hold");
  });

  it("refuses a body that names no version, rather than inventing one", async () => {
    const { quarantine, routes } = releaseHarness();
    const hold = quarantine.hold(evidence());
    const r = await release(routes, { holdId: hold.id, gesture: "abandoned-unknown" });
    expect(r.status).toBe(400);
    expect(quarantine.holding(SESSION)).not.toBeNull();
  });

  it("refuses a gesture it does not know, and names both of the ones it does", async () => {
    const { quarantine, routes } = releaseHarness();
    const hold = quarantine.hold(evidence());
    const r = await release(routes, { holdId: hold.id, version: 1, gesture: "delivered" });
    expect(r.status).toBe(400);
    expect(String(r.json.why)).toContain("operator-confirmed");
    expect(String(r.json.why)).toContain("abandoned-unknown");
  });

  it("works when the session has gone away entirely", async () => {
    // The row is not in any snapshot, the queue for it is empty, the pane is
    // gone. This is the hold somebody most needs to clear.
    const { quarantine, routes } = releaseHarness();
    const hold = quarantine.hold(evidence({ sessionId: "$97099", paneId: null, claudeSessionId: null }));
    const r = await release(routes, { holdId: hold.id, version: 1, gesture: "abandoned-unknown" });
    expect(r.status).toBe(200);
  });

  it("works when the hold has no queue items left behind it — the commonest shape", async () => {
    const { q, quarantine, clock, routes } = releaseHarness();
    q.enqueueMessage(TARGET, "the only thing queued", "greg");
    drainOnce(snapshot(), { queue: q, cursor: createDrainCursor(), send: sends(quarantine, () => PARTIAL), log: () => {}, now: () => clock.t });
    expect(q.size(SESSION)).toBe(0);
    const hold = quarantine.holding(SESSION);
    expect(hold).not.toBeNull();
    if (hold === null) return;
    // AND THE PAGE IS TOLD ABOUT IT, which is the half that used to be missing:
    // `snapshots()` filtered to `items.length > 0`.
    const cat = await post(routes.handle, fakeReq("/api/actions", null, "GET"));
    const queues = cat.json.queues as { sessionId: string; items: unknown[]; quarantine: { id: string } | null }[];
    expect(queues.map((x) => x.sessionId)).toContain(SESSION);
    expect(queues.find((x) => x.sessionId === SESSION)?.items).toEqual([]);
    expect(queues.find((x) => x.sessionId === SESSION)?.quarantine?.id).toBe(hold.id);

    const r = await release(routes, { holdId: hold.id, version: hold.version, gesture: "operator-confirmed" });
    expect(r.status).toBe(200);
  });

  it("logs that nothing was sent, because that is the thing somebody will doubt later", async () => {
    const { quarantine, routes, logs } = releaseHarness();
    const hold = quarantine.hold(evidence());
    await release(routes, { holdId: hold.id, version: 1, gesture: "operator-confirmed" });
    expect(logs.join("\n")).toContain("nothing was sent");
  });

  it("is POST only — a link somebody sent may not clear a hold", async () => {
    const { routes } = releaseHarness();
    const r = await post(routes.handle, fakeReq("/api/actions/hold/release", null, "GET"));
    expect(r.status).toBe(405);
  });
});
