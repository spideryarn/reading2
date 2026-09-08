/**
 * The per-session steering queue — tools/fleet/queue.ts.
 *
 * THE ONE ASSERTION THIS FILE EXISTS FOR is that a queue never drains into a
 * session that is *working*. Everything else here is a way that a queued item
 * could be delivered at a moment that makes it wrong — the pane was resumed
 * into another conversation, the item has waited half an hour, a delivery was
 * started and never finished — and each of those has a test whose real content
 * is that **nothing was handed out**.
 *
 * THE CLOCK IS A PARAMETER, so no test waits for anything: `at()` moves time
 * forward by assignment. There is no timer in the module and none here.
 *
 * NOTHING IS DELIVERED. The queue is asked what may go and is told what
 * happened; it holds no transport, and this file imports none.
 *
 * On negative assertions: "nothing was handed out" is checked as
 * `result.kind === "held"` (or orphaned, or stale) with the item still at the
 * head of the snapshot — never as the absence of a call, which is satisfied by
 * the queue being empty for some unrelated reason.
 */
import { describe, expect, it } from "vitest";

import { ACTIONS } from "../tools/fleet/actions.js";
import { drainGate, PERSISTENCE_WARNING, SteeringQueue, type QueuedItem, type QueueLimits } from "../tools/fleet/queue.js";
import type { FleetStatus } from "../tools/fleet/status.js";
import { steerableStatus } from "../tools/fleet/steer.js";

const SESSION = "$1643";
const CONVO = "117e181a-155b-435a-b95b-e74220678d1a";
const OTHER_CONVO = "76667309-a22a-477c-af3b-4f16d1ce0cf0";
const TARGET = { sessionId: SESSION, claudeSessionId: CONVO };

const WORKING: FleetStatus = { kind: "working" };
const IDLE: FleetStatus = { kind: "idle" };
const NEEDS_YOU: FleetStatus = { kind: "needs-you" };
const SHELL: FleetStatus = { kind: "shell", busy: false };

/** Every arm of the status union, so the agreement test cannot miss one. */
const EVERY_STATUS: readonly FleetStatus[] = [
  { kind: "needs-you" },
  { kind: "working" },
  { kind: "idle" },
  { kind: "waiting", secondsLeft: 600 },
  { kind: "no-claude" },
  { kind: "shell", busy: false },
  { kind: "shell", busy: true },
  { kind: "shell", busy: null },
  { kind: "unknown", why: "the box could not be asked" },
];

/** A queue with a clock you move by hand. Nothing here waits for real time. */
function makeQueue(limits?: Partial<QueueLimits>) {
  const clock = { t: 1_700_000_000_000 };
  const q = new SteeringQueue({ now: () => clock.t, ...(limits ? { limits } : {}) });
  return { q, clock, advance: (ms: number) => (clock.t += ms) };
}

function ctx(status: FleetStatus, claudeSessionId = CONVO) {
  return { status, claudeSessionId };
}

function headId(items: readonly QueuedItem[]): string | undefined {
  return items[0]?.id;
}

/* ---------------------------------------------------------------- *
 * The gate.
 * ---------------------------------------------------------------- */

describe("drainGate", () => {
  it("agrees with steer.ts about which sessions may be typed into at all", () => {
    // The drift test. `steerableStatus` owns that decision; this file must not
    // make it a second time differently, so the two are compared across every
    // arm of the union rather than trusted to stay in step.
    for (const status of EVERY_STATUS) {
      const gate = drainGate(status);
      const refusal = steerableStatus(status);
      expect(gate.kind === "never", status.kind).toBe(refusal !== null);
      if (gate.kind === "never") expect(gate.reason).toEqual(refusal);
    }
    // Paired positive, so this is not passing because both said "no" to
    // everything: at least one status is drainable and at least one is not.
    expect(EVERY_STATUS.filter((s) => drainGate(s).kind === "never").length).toBeGreaterThan(0);
    expect(EVERY_STATUS.filter((s) => drainGate(s).kind === "now").length).toBeGreaterThan(0);
  });

  it("holds a working session rather than refusing it", () => {
    // The distinction the whole queue rests on: `working` is steerable in
    // principle — it is a live Claude at a live pane — and is exactly the state
    // in which keystrokes go somewhere useless.
    const gate = drainGate(WORKING);
    expect(gate.kind).toBe("later");
    expect(steerableStatus(WORKING)).toBeNull();
  });

  it("drains at a prompt, whether or not there is a question on screen", () => {
    expect(drainGate(IDLE).kind).toBe("now");
    expect(drainGate(NEEDS_YOU).kind).toBe("now");
  });

  it("refuses a shell in steer.ts's own words, because the text would be executed", () => {
    const gate = drainGate(SHELL);
    expect(gate.kind).toBe("never");
    if (gate.kind === "never") expect(gate.reason.why).toContain("EXECUTE");
  });
});

/* ---------------------------------------------------------------- *
 * Enqueueing.
 * ---------------------------------------------------------------- */

describe("enqueueing", () => {
  it("keeps actions and messages in one list, in the order they were pressed", () => {
    const { q } = makeQueue();
    expect(q.enqueueAction(TARGET, "pull").ok).toBe(true);
    expect(q.enqueueMessage(TARGET, "actually, do the smaller version first").ok).toBe(true);
    expect(q.enqueueAction(TARGET, "push").ok).toBe(true);

    const items = q.snapshot(SESSION).items;
    expect(items.map((i) => (i.payload.kind === "action" ? i.payload.action.id : i.payload.text))).toEqual([
      "pull",
      "actually, do the smaller version first",
      "push",
    ]);
  });

  it("makes an enacted action wait its turn behind the spoken ones", () => {
    // The reason enacted actions queue at all. "Push, then remove the worktree"
    // must not become "remove the worktree, then try to push" — the removal
    // could have run immediately, and running it immediately would delete work
    // the queued push had not yet saved.
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "push");
    q.enqueueAction(TARGET, "remove-worktree");

    const first = q.next(SESSION, ctx(IDLE));
    expect(first.kind).toBe("ready");
    if (first.kind === "ready") {
      expect(first.item.payload.kind).toBe("action");
      if (first.item.payload.kind === "action") expect(first.item.payload.action.id).toBe("push");
    }
  });

  it("refuses an action id that is not in the vocabulary", () => {
    const { q } = makeQueue();
    const out = q.enqueueAction(TARGET, "rm-rf-slash");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.rule).toBe("no-such-action");
    expect(q.size(SESSION)).toBe(0);
    // Paired positive: a real id does go in.
    expect(q.enqueueAction(TARGET, "continue").ok).toBe(true);
    expect(q.size(SESSION)).toBe(1);
  });

  it("refuses a box-wide action in a session's queue", () => {
    // A broadcast queued per session would go out thirty-six times, and each
    // copy would be staggered against the wrong denominator.
    const { q } = makeQueue();
    for (const id of ["resource-broadcast", "kill-test-suites", "kill-safe-processes"]) {
      const out = q.enqueueAction(TARGET, id);
      expect(out.ok, id).toBe(false);
      if (!out.ok) expect(out.rule).toBe("wrong-scope");
    }
    expect(q.size(SESSION)).toBe(0);
    expect(q.enqueueAction(TARGET, "remove-worktree").ok).toBe(true);
  });

  it("refuses a message steer.ts could never send, using steer.ts's own check", () => {
    const { q } = makeQueue();
    const twoLines = q.enqueueMessage(TARGET, "first line\nsecond line");
    expect(twoLines.ok).toBe(false);
    if (!twoLines.ok) {
      expect(twoLines.rule).toBe("bad-text");
      // The reason is steer.ts's, not a second copy of it.
      expect(twoLines.why).toContain("submit it early");
    }
    expect(q.enqueueMessage(TARGET, "  ").ok).toBe(false);
    expect(q.enqueueMessage(TARGET, "one good line").ok).toBe(true);
  });

  it("refuses a target that is not a tmux handle and a conversation", () => {
    const { q } = makeQueue();
    expect(q.enqueueAction({ sessionId: "1643", claudeSessionId: CONVO }, "continue").ok).toBe(false);
    expect(q.enqueueAction({ sessionId: SESSION, claudeSessionId: "not-a-uuid" }, "continue").ok).toBe(false);
    expect(q.enqueueAction(TARGET, "continue").ok).toBe(true);
  });

  it("is bounded per session and across the fleet", () => {
    const { q } = makeQueue({ maxPerSession: 3, maxTotal: 5 });
    const ids = ["continue", "pull", "push", "run-checks"];
    for (const id of ids.slice(0, 3)) expect(q.enqueueAction(TARGET, id).ok).toBe(true);
    const over = q.enqueueAction(TARGET, "run-checks");
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.rule).toBe("session-queue-full");
    expect(q.size(SESSION)).toBe(3);

    const second = { sessionId: "$99", claudeSessionId: OTHER_CONVO };
    expect(q.enqueueAction(second, "continue").ok).toBe(true);
    expect(q.enqueueAction(second, "pull").ok).toBe(true);
    const fleetFull = q.enqueueAction(second, "push");
    expect(fleetFull.ok).toBe(false);
    if (!fleetFull.ok) expect(fleetFull.rule).toBe("fleet-queue-full");
    expect(q.totalSize()).toBe(5);
  });

  it("treats an instant repeat as a double tap, and a later one as an intention", () => {
    const { q, advance } = makeQueue({ doubleTapMs: 5000 });
    expect(q.enqueueAction(TARGET, "run-checks").ok).toBe(true);
    const tap = q.enqueueAction(TARGET, "run-checks");
    expect(tap.ok).toBe(false);
    if (!tap.ok) expect(tap.rule).toBe("double-tap");
    expect(q.size(SESSION)).toBe(1);

    advance(6000);
    // Deliberately queuing the same thing twice — "run the checks, then run
    // them again after the merge" — must still work.
    expect(q.enqueueAction(TARGET, "run-checks").ok).toBe(true);
    expect(q.size(SESSION)).toBe(2);
  });
});

/* ---------------------------------------------------------------- *
 * Draining.
 * ---------------------------------------------------------------- */

describe("draining", () => {
  it("hands out NOTHING while the session is working, however many buttons were pressed", () => {
    // This is the test the whole file is for. Pressing three buttons on a
    // working session must not race, must not interrupt, and must not lose
    // anything.
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "pull");
    q.enqueueAction(TARGET, "run-checks");
    q.enqueueMessage(TARGET, "and then push");

    for (let i = 0; i < 3; i++) {
      const out = q.next(SESSION, ctx(WORKING));
      expect(out.kind).toBe("held");
      if (out.kind === "held") {
        expect(out.head.payload.kind === "action" && out.head.payload.action.id).toBe("pull");
        expect(out.why).toContain("working");
      }
    }
    // Nothing was leased and nothing was lost.
    expect(q.size(SESSION)).toBe(3);
    expect(q.snapshot(SESSION).items.every((i) => i.leasedAt === null)).toBe(true);
  });

  it("drains one at a time, in order, once the session reaches a prompt", () => {
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "pull");
    q.enqueueAction(TARGET, "run-checks");

    const first = q.next(SESSION, ctx(IDLE));
    expect(first.kind).toBe("ready");
    if (first.kind !== "ready") return;

    // A second ask before the first is settled must not hand out the second
    // item: two messages in the same input box in the same second is one
    // message with the halves interleaved.
    const again = q.next(SESSION, ctx(IDLE));
    expect(again.kind).toBe("in-flight");
    if (again.kind === "in-flight") expect(again.item.id).toBe(first.item.id);

    expect(q.settle(SESSION, first.item.id, "delivered").ok).toBe(true);
    const second = q.next(SESSION, ctx(IDLE));
    expect(second.kind).toBe("ready");
    if (second.kind === "ready") {
      expect(second.item.payload.kind === "action" && second.item.payload.action.id).toBe("run-checks");
    }
  });

  it("says the queue is empty rather than inventing something to send", () => {
    const { q } = makeQueue();
    expect(q.next(SESSION, ctx(IDLE)).kind).toBe("empty");
  });

  it("refuses a session that cannot be typed into, in steer.ts's words", () => {
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "continue");
    const out = q.next(SESSION, ctx(SHELL));
    expect(out.kind).toBe("blocked");
    if (out.kind === "blocked") {
      expect(out.reason.code).toBe("declared-not-steerable");
      expect(out.reason.why).toContain("EXECUTE");
      expect(out.head.id).toBe(headId(q.snapshot(SESSION).items));
    }
    // Still there, so a status that clears later can still deliver it.
    expect(q.size(SESSION)).toBe(1);
  });

  it("never delivers into a conversation the pane was resumed into", () => {
    // `gjd-remote resume` keeps the pane and the tmux session and starts a NEW
    // conversation. Everything else about the target still matches, so without
    // this check "pull the latest" lands in a conversation that has never heard
    // of the task.
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "pull");
    const out = q.next(SESSION, ctx(IDLE, OTHER_CONVO));
    expect(out.kind).toBe("orphaned");
    if (out.kind === "orphaned") {
      expect(out.why).toContain(CONVO);
      expect(out.why).toContain(OTHER_CONVO);
    }
    expect(q.size(SESSION)).toBe(1);
    expect(q.snapshot(SESSION).items[0]?.leasedAt).toBeNull();

    // Paired positive: the same item goes out for the conversation it was
    // queued against, so this is about identity and not about the queue being
    // broken.
    expect(q.next(SESSION, ctx(IDLE, CONVO)).kind).toBe("ready");
  });

  it("stops delivering an instruction that has waited too long, without deleting it", () => {
    const { q, advance } = makeQueue({ maxAgeMs: 30 * 60_000 });
    q.enqueueAction(TARGET, "run-checks");
    advance(29 * 60_000);
    expect(q.next(SESSION, ctx(WORKING)).kind).toBe("held");

    advance(2 * 60_000);
    const stale = q.next(SESSION, ctx(IDLE));
    expect(stale.kind).toBe("stale");
    if (stale.kind === "stale") expect(stale.why).toContain("moved on");
    // Not lost — still visible, still cancellable, and re-armable by hand.
    expect(q.size(SESSION)).toBe(1);

    const item = q.snapshot(SESSION).items[0];
    expect(item).toBeDefined();
    if (!item) return;
    expect(q.isStale(item)).toBe(true);
    const revived = q.revive(SESSION, item.id);
    expect(revived.ok).toBe(true);
    if (revived.ok) expect(q.isStale(revived.item)).toBe(false);
    expect(q.next(SESSION, ctx(IDLE)).kind).toBe("ready");
  });
});

/* ---------------------------------------------------------------- *
 * Settling: there is no retry, anywhere.
 * ---------------------------------------------------------------- */

describe("settling", () => {
  it("removes a delivered item and moves on", () => {
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "continue");
    const out = q.next(SESSION, ctx(IDLE));
    expect(out.kind).toBe("ready");
    if (out.kind !== "ready") return;
    const settled = q.settle(SESSION, out.item.id, "delivered");
    expect(settled.ok).toBe(true);
    expect(q.size(SESSION)).toBe(0);
  });

  it("removes a REFUSED item too, rather than firing the same keys again", () => {
    // From the wide review: never auto-retry keystrokes. A retry cannot know
    // whether the first attempt's keys arrived, and the refusals steer.ts
    // returns are about the box being different from the page — trying again a
    // moment later is how a message ends up in the wrong session.
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "continue");
    q.enqueueAction(TARGET, "pull");
    const first = q.next(SESSION, ctx(IDLE));
    if (first.kind !== "ready") throw new Error("expected a lease");
    expect(q.settle(SESSION, first.item.id, "refused").ok).toBe(true);

    const second = q.next(SESSION, ctx(IDLE));
    expect(second.kind).toBe("ready");
    if (second.kind === "ready") {
      // The NEXT item, not the refused one again.
      expect(second.item.id).not.toBe(first.item.id);
      expect(second.item.payload.kind === "action" && second.item.payload.action.id).toBe("pull");
    }
    expect(q.size(SESSION)).toBe(1);
  });

  it("calls an unsettled lease stuck, and waits for a person rather than retrying", () => {
    const { q, advance } = makeQueue({ leaseMs: 60_000 });
    q.enqueueAction(TARGET, "continue");
    const out = q.next(SESSION, ctx(IDLE));
    if (out.kind !== "ready") throw new Error("expected a lease");

    advance(30_000);
    expect(q.next(SESSION, ctx(IDLE)).kind).toBe("in-flight");

    advance(40_000);
    const stuck = q.next(SESSION, ctx(IDLE));
    expect(stuck.kind).toBe("stuck");
    if (stuck.kind === "stuck") {
      expect(stuck.item.id).toBe(out.item.id);
      expect(stuck.why).toContain("not be retried automatically");
    }
    // It stays stuck until somebody says what happened.
    expect(q.next(SESSION, ctx(IDLE)).kind).toBe("stuck");
    expect(q.settle(SESSION, out.item.id, "abandoned").ok).toBe(true);
    expect(q.next(SESSION, ctx(IDLE)).kind).toBe("empty");
  });

  it("refuses to settle something that was never handed out", () => {
    const { q } = makeQueue();
    const added = q.enqueueAction(TARGET, "continue");
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const out = q.settle(SESSION, added.item.id, "delivered");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.why).toContain("never handed out");
    expect(q.size(SESSION)).toBe(1);
  });
});

/* ---------------------------------------------------------------- *
 * Seeing it, and taking it back.
 * ---------------------------------------------------------------- */

describe("visibility and cancellation", () => {
  it("cancels a waiting item", () => {
    const { q } = makeQueue();
    const a = q.enqueueAction(TARGET, "continue");
    const b = q.enqueueAction(TARGET, "pull");
    if (!a.ok || !b.ok) throw new Error("setup");
    expect(q.cancel(SESSION, a.item.id).ok).toBe(true);
    expect(q.snapshot(SESSION).items.map((i) => i.id)).toEqual([b.item.id]);
  });

  it("refuses to cancel one that is already going out", () => {
    // Pretending otherwise would be the dishonest option: the keys may already
    // be on their way to the pane, and removing the row tells somebody it did
    // not happen.
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "continue");
    const out = q.next(SESSION, ctx(IDLE));
    if (out.kind !== "ready") throw new Error("expected a lease");
    const cancelled = q.cancel(SESSION, out.item.id);
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) expect(cancelled.why).toContain("cannot be taken back");
    expect(q.size(SESSION)).toBe(1);
  });

  it("clears the waiting items and keeps the one in flight", () => {
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "continue");
    q.enqueueAction(TARGET, "pull");
    q.enqueueAction(TARGET, "push");
    const out = q.next(SESSION, ctx(IDLE));
    if (out.kind !== "ready") throw new Error("expected a lease");

    const cleared = q.clear(SESSION);
    expect(cleared.removed).toHaveLength(2);
    expect(cleared.keptInFlight?.id).toBe(out.item.id);
    expect(q.size(SESSION)).toBe(1);
  });

  it("says on every snapshot that a restart discards the queue", () => {
    // A queue that quietly lost its items on a restart would be the same
    // failure as everything else in this area: an absence reported as success.
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "continue");
    const snap = q.snapshot(SESSION);
    expect(snap.volatile).toBe(true);
    expect(snap.warning).toBe(PERSISTENCE_WARNING);
    expect(snap.warning).toContain("Restarting it discards");
    expect(snap.since).toBeLessThanOrEqual(snap.items[0]?.enqueuedAt ?? 0);
  });

  it("lists only the sessions that have something waiting", () => {
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "continue");
    q.enqueueAction({ sessionId: "$99", claudeSessionId: OTHER_CONVO }, "pull");
    expect(q.snapshots().map((s) => s.sessionId).sort()).toEqual(["$1643", "$99"]);
    q.clear("$99");
    expect(q.snapshots().map((s) => s.sessionId)).toEqual(["$1643"]);
  });

  it("keeps one session's queue out of another's", () => {
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "continue");
    expect(q.size("$99")).toBe(0);
    expect(q.next("$99", ctx(IDLE, OTHER_CONVO)).kind).toBe("empty");
    expect(q.size(SESSION)).toBe(1);
  });
});

/* ---------------------------------------------------------------- *
 * The vocabulary and the queue agree.
 * ---------------------------------------------------------------- */

describe("every session action can actually be queued", () => {
  it("accepts each one, and rejects each box-wide one", () => {
    for (const action of ACTIONS) {
      const { q } = makeQueue();
      const out = q.enqueueAction(TARGET, action.id);
      expect(out.ok, action.id).toBe(action.scope === "session");
    }
  });
});
