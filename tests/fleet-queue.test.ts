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
import {
  deliveryGate,
  drainGate,
  nothingWasSent,
  PERSISTENCE_WARNING,
  SteeringQueue,
  type QueuedItem,
  type QueueLimits,
  type UnsentFailure,
} from "../tools/fleet/queue.js";
import { QuarantineBook } from "../tools/fleet/quarantine.js";
import type { FleetStatus } from "../tools/fleet/status.js";
import { steerableStatus, type SteerFailure } from "../tools/fleet/steer.js";

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
  // `agents-unavailable` rather than `client-declared`: this list stands in for
  // statuses the COLLECTOR produced, which is what the queue actually sees, and
  // `client-declared` is only ever stamped on a status that arrived from a
  // browser. Picking the wrong one here would be a fixture quietly asserting
  // that the queue is fed by the network.
  { kind: "unknown", cause: "agents-unavailable", why: "the box could not be asked" },
];

/**
 * Which run of the server a queue is, when the test does not care.
 *
 * Fixed rather than random, so a failing assertion prints the same id twice.
 * The tests that DO care build two queues with two of these — that pair is what
 * a restart looks like from a phone still holding the old ids.
 */
const INSTANCE = "1a2b3c4d";

/** A queue with a clock you move by hand. Nothing here waits for real time. */
function makeQueue(limits?: Partial<QueueLimits>, serverInstanceId = INSTANCE) {
  const clock = { t: 1_700_000_000_000 };
  // ITS OWN BOOK, sharing this queue's clock and run id. The hold machinery has
  // its own file — tests/fleet-quarantine.test.ts — and nothing in this one
  // opens a hold; what it needs is a real book rather than a stub, so that a
  // `next()` here asks the same question production's does.
  const quarantine = new QuarantineBook({ now: () => clock.t, serverInstanceId });
  const q = new SteeringQueue({ now: () => clock.t, serverInstanceId, quarantine, ...(limits ? { limits } : {}) });
  return { q, quarantine, clock, advance: (ms: number) => (clock.t += ms) };
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
    // `drainGate` answers "may this session be steered at all", which is what
    // the ENQUEUE route needs: an item queued for a session showing a dialog is
    // a perfectly good item, and it goes out once the dialog is dealt with.
    expect(drainGate(IDLE).kind).toBe("now");
    expect(drainGate(NEEDS_YOU).kind).toBe("now");
  });
});

describe("deliveryGate", () => {
  it("differs from drainGate on needs-you, and on nothing else", () => {
    // **THE AGREEMENT TEST, AND THE ONE DISAGREEMENT IS THE POINT.** The two
    // gates answer different questions — "may this be queued for" and "may this
    // be sent to right now" — and confusing them destroyed a person's message
    // in the design review of this stage. Comparing them across every arm makes
    // a future edit to either a visible decision rather than silent drift.
    for (const status of EVERY_STATUS) {
      const drain = drainGate(status);
      const deliver = deliveryGate(status);
      if (status.kind === "needs-you") {
        expect(drain.kind).toBe("now");
        expect(deliver.kind).toBe("later");
        continue;
      }
      expect(deliver, status.kind).toEqual(drain);
    }
  });

  it("holds rather than refuses a session that is asking a question", () => {
    // `later`, not `never`: the agent will stop asking, and the instruction
    // should go then. A permanent refusal loses the item just as surely.
    const gate = deliveryGate(NEEDS_YOU);
    expect(gate.kind).toBe("later");
    if (gate.kind === "later") expect(gate.why).toContain("dialog");
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
    expect(q.enqueueAction(TARGET, "pull", "greg").ok).toBe(true);
    expect(q.enqueueMessage(TARGET, "actually, do the smaller version first", "greg").ok).toBe(true);
    expect(q.enqueueAction(TARGET, "push", "greg").ok).toBe(true);

    const items = q.snapshot(SESSION).items;
    expect(items.map((i) => (i.payload.kind === "action" ? i.payload.action.id : i.payload.text))).toEqual([
      "pull",
      "actually, do the smaller version first",
      "push",
    ]);
  });

  it("refuses an enacted action outright, and says what to do instead", () => {
    // **THIS TEST USED TO ASSERT THE OPPOSITE** — that "push, then remove the
    // worktree" kept its order, which is the argument the module header makes
    // for queuing enacted actions at all. That argument is still right and it
    // has been retreated from (2026-09-08, stage v0.5f): the drain delivers
    // sentences, and delivering an enacted item would mean running `execFile`s
    // that delete a directory from inside the refresh loop. So the promise is
    // not made, rather than made and not kept.
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "push", "greg");
    const out = q.enqueueAction(TARGET, "remove-worktree", "greg");

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.rule).toBe("enacted-not-deliverable");
      // The sentence names the alternative, because a refusal that leaves
      // somebody with no route to the thing they wanted is a dead end.
      expect(out.why).toContain("dry-run");
      expect(out.why).toContain("confirm");
    }
    expect(q.size(SESSION)).toBe(1);

    const first = q.next(SESSION, ctx(IDLE));
    expect(first.kind).toBe("ready");
    if (first.kind === "ready" && first.item.payload.kind === "action") {
      expect(first.item.payload.action.id).toBe("push");
    }
  });

  it("refuses an enacted action whether or not it is a plausible one", () => {
    // Unconditional, and not gated on `FLEET_ACT_ENABLED`: a conditional
    // refusal would re-create the silent promise the day the flag goes on.
    const { q } = makeQueue();
    for (const id of ["remove-worktree", "kill-session"]) {
      const out = q.enqueueAction(TARGET, id, "greg");
      expect(out.ok, id).toBe(false);
      if (!out.ok) expect(out.rule, id).toBe("enacted-not-deliverable");
    }
    expect(q.size(SESSION)).toBe(0);
  });

  it("refuses an action id that is not in the vocabulary", () => {
    const { q } = makeQueue();
    const out = q.enqueueAction(TARGET, "rm-rf-slash", "greg");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.rule).toBe("no-such-action");
    expect(q.size(SESSION)).toBe(0);
    // Paired positive: a real id does go in.
    expect(q.enqueueAction(TARGET, "continue", "greg").ok).toBe(true);
    expect(q.size(SESSION)).toBe(1);
  });

  it("refuses a box-wide action in a session's queue", () => {
    // A broadcast queued per session would go out thirty-six times, and each
    // copy would be staggered against the wrong denominator.
    const { q } = makeQueue();
    for (const id of ["resource-broadcast", "kill-test-suites", "kill-safe-processes"]) {
      const out = q.enqueueAction(TARGET, id, "greg");
      expect(out.ok, id).toBe(false);
      if (!out.ok) expect(out.rule).toBe("wrong-scope");
    }
    expect(q.size(SESSION)).toBe(0);
    // Paired positive, and a session-scoped one: the rule above is about scope,
    // not about the whole vocabulary. (`remove-worktree` used to stand here,
    // and is now refused for a different reason — see the enacted test above.)
    expect(q.enqueueAction(TARGET, "wrap-up", "greg").ok).toBe(true);
  });

  it("refuses a message steer.ts could never send, using steer.ts's own check", () => {
    const { q } = makeQueue();
    const twoLines = q.enqueueMessage(TARGET, "first line\nsecond line", "greg");
    expect(twoLines.ok).toBe(false);
    if (!twoLines.ok) {
      expect(twoLines.rule).toBe("bad-text");
      // The reason is steer.ts's, not a second copy of it.
      expect(twoLines.why).toContain("submit it early");
    }
    expect(q.enqueueMessage(TARGET, "  ", "greg").ok).toBe(false);
    expect(q.enqueueMessage(TARGET, "one good line", "greg").ok).toBe(true);
  });

  it("counts the line naming the speaker against the length limit, here and not at the send", () => {
    // The words that go out are not the words that came in: the prefix is
    // rendered at delivery. A message just under the limit therefore PASSES the
    // raw check and FAILS the one the send makes — which would be an item
    // accepted, drawn as waiting its turn, and refused twenty minutes later for
    // a length nobody could see. The Overseer's line is the long one, so the
    // two speakers do not have the same ceiling.
    const { q } = makeQueue();
    const long = "x".repeat(3990);
    expect(q.enqueueMessage(TARGET, long, "greg").ok).toBe(false);
    const refused = q.enqueueMessage(TARGET, long, "overseer");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.why).toContain("added when it goes out");
    // And a message with room for the prefix still goes.
    expect(q.enqueueMessage(TARGET, "x".repeat(3000), "overseer").ok).toBe(true);
  });

  it("refuses a target that is not a tmux handle and a conversation", () => {
    const { q } = makeQueue();
    expect(q.enqueueAction({ sessionId: "1643", claudeSessionId: CONVO }, "continue", "greg").ok).toBe(false);
    expect(q.enqueueAction({ sessionId: SESSION, claudeSessionId: "not-a-uuid" }, "continue", "greg").ok).toBe(false);
    expect(q.enqueueAction(TARGET, "continue", "greg").ok).toBe(true);
  });

  it("is bounded per session and across the fleet", () => {
    const { q } = makeQueue({ maxPerSession: 3, maxTotal: 5 });
    const ids = ["continue", "pull", "push", "run-checks"];
    for (const id of ids.slice(0, 3)) expect(q.enqueueAction(TARGET, id, "greg").ok).toBe(true);
    const over = q.enqueueAction(TARGET, "run-checks", "greg");
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.rule).toBe("session-queue-full");
    expect(q.size(SESSION)).toBe(3);

    const second = { sessionId: "$99", claudeSessionId: OTHER_CONVO };
    expect(q.enqueueAction(second, "continue", "greg").ok).toBe(true);
    expect(q.enqueueAction(second, "pull", "greg").ok).toBe(true);
    const fleetFull = q.enqueueAction(second, "push", "greg");
    expect(fleetFull.ok).toBe(false);
    if (!fleetFull.ok) expect(fleetFull.rule).toBe("fleet-queue-full");
    expect(q.totalSize()).toBe(5);
  });

  it("treats an instant repeat as a double tap, and a later one as an intention", () => {
    const { q, advance } = makeQueue({ doubleTapMs: 5000 });
    expect(q.enqueueAction(TARGET, "run-checks", "greg").ok).toBe(true);
    const tap = q.enqueueAction(TARGET, "run-checks", "greg");
    expect(tap.ok).toBe(false);
    if (!tap.ok) expect(tap.rule).toBe("double-tap");
    expect(q.size(SESSION)).toBe(1);

    advance(6000);
    // Deliberately queuing the same thing twice — "run the checks, then run
    // them again after the merge" — must still work.
    expect(q.enqueueAction(TARGET, "run-checks", "greg").ok).toBe(true);
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
    q.enqueueAction(TARGET, "pull", "greg");
    q.enqueueAction(TARGET, "run-checks", "greg");
    q.enqueueMessage(TARGET, "and then push", "greg");

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
    q.enqueueAction(TARGET, "pull", "greg");
    q.enqueueAction(TARGET, "run-checks", "greg");

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
    q.enqueueAction(TARGET, "continue", "greg");
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
    q.enqueueAction(TARGET, "pull", "greg");
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
    q.enqueueAction(TARGET, "run-checks", "greg");
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
    q.enqueueAction(TARGET, "continue", "greg");
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
    q.enqueueAction(TARGET, "continue", "greg");
    q.enqueueAction(TARGET, "pull", "greg");
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
    q.enqueueAction(TARGET, "continue", "greg");
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
    const added = q.enqueueAction(TARGET, "continue", "greg");
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const out = q.settle(SESSION, added.item.id, "delivered");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.why).toContain("never handed out");
    expect(q.size(SESSION)).toBe(1);
  });
});

/* ---------------------------------------------------------------- *
 * Putting one back — the one hole in "nothing is ever retried".
 * ---------------------------------------------------------------- */

const NOTHING_SENT: SteerFailure = {
  ok: false,
  reason: { code: "pane-is-asking", why: "the pane is asking a question" },
  delivery: "none",
  sent: [],
};

describe("releasing", () => {
  it("puts an item back at the head when the transport says it sent nothing", () => {
    // NOT A RETRY: there was no attempt. The refusal fired before the two
    // `send-keys` calls, and `sent` is empty, so nothing reached the pane —
    // which is exactly the knowledge the never-retry rule says a retry cannot
    // have. Without this, the commonest refusal on this box destroys the item.
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "continue", "greg");
    q.enqueueAction(TARGET, "pull", "greg");
    const first = q.next(SESSION, ctx(IDLE));
    if (first.kind !== "ready") throw new Error("expected a lease");

    const unsent = nothingWasSent(NOTHING_SENT);
    expect(unsent).not.toBeNull();
    if (!unsent) return;
    const back = q.release(SESSION, first.item.id, unsent);
    expect(back.ok).toBe(true);

    expect(q.size(SESSION)).toBe(2);
    expect(headId(q.snapshot(SESSION).items)).toBe(first.item.id);
    expect(q.snapshot(SESSION).items[0]?.leasedAt).toBe(null);
    // And the SAME item is next, not the one behind it: the order the person
    // pressed the buttons in is what the queue is for.
    const again = q.next(SESSION, ctx(IDLE));
    expect(again.kind === "ready" && again.item.id).toBe(first.item.id);
  });

  it("will not take evidence that something may have been sent", () => {
    for (const failure of [
      { ...NOTHING_SENT, delivery: "partial" as const },
      { ...NOTHING_SENT, delivery: "unknown" as const },
      // The dishonest one: the summary says nothing was sent and the record of
      // completed calls says otherwise. Believed in the safe direction.
      { ...NOTHING_SENT, sent: [["send-keys", "-t", "%99001", "-l", "--", "…"]] },
    ]) {
      expect(nothingWasSent(failure)).toBeNull();
    }
  });

  it("cannot be given evidence a caller wrote for themselves", () => {
    // GPT Sol's D5, 2026-09-08. `UnsentFailure`'s doc comment claims the type
    // "can only be obtained from `nothingWasSent`"; as a plain structural
    // intersection that was false — any object literal with the two right
    // fields satisfied it, so the audited constructor could be walked past.
    //
    // **THE ASSERTION IS THE `@ts-expect-error`, and `npm run typecheck` is
    // what checks it — vitest never type-checks.** Delete the brand from
    // `UnsentFailure` and this line stops being an error, which makes the
    // `@ts-expect-error` itself the error. The runtime half below is not the
    // point: `release` re-checks the two fields, so it would accept a forgery
    // that got this far, which is exactly why the compile-time guard has to
    // hold.
    // @ts-expect-error a hand-written refusal is not the transport's word for it
    const forged: UnsentFailure = { ok: false, reason: { code: "not-at-input", why: "made up" }, delivery: "none", sent: [] };
    expect(forged.delivery).toBe("none");
  });

  it("refuses to put back something that was never handed out", () => {
    const { q } = makeQueue();
    const added = q.enqueueAction(TARGET, "continue", "greg");
    if (!added.ok) throw new Error("expected an item");
    const unsent = nothingWasSent(NOTHING_SENT);
    if (!unsent) throw new Error("expected evidence");
    const out = q.release(SESSION, added.item.id, unsent);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.why).toContain("never handed out");
  });

  it("does not re-arm the clock, so a released item still goes stale", () => {
    // Deliberate: `release` is about WHERE the item is, not about how old it
    // is. An instruction that cannot be delivered for half an hour is one
    // somebody should look at again before it lands in a conversation that has
    // moved on, and that is `revive`'s job and a person's decision.
    const { q, advance } = makeQueue();
    q.enqueueAction(TARGET, "continue", "greg");
    const first = q.next(SESSION, ctx(IDLE));
    if (first.kind !== "ready") throw new Error("expected a lease");
    const unsent = nothingWasSent(NOTHING_SENT);
    if (!unsent) throw new Error("expected evidence");
    q.release(SESSION, first.item.id, unsent);

    advance(31 * 60_000);
    expect(q.next(SESSION, ctx(IDLE)).kind).toBe("stale");
  });
});

/* ---------------------------------------------------------------- *
 * Which tmux server these handles belong to.
 * ---------------------------------------------------------------- */

describe("noteGeneration", () => {
  it("learns the generation once and says nothing changed", () => {
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "continue", "greg");
    expect(q.knownGeneration()).toBe(null);
    expect(q.noteGeneration(132_280)).toBe(0);
    expect(q.knownGeneration()).toBe(132_280);
    expect(q.noteGeneration(132_280)).toBe(0);
    expect(q.next(SESSION, ctx(IDLE)).kind).toBe("ready");
  });

  it("invalidates every waiting item when the tmux server has been replaced", () => {
    // One reboot takes the tmux server, the dashboard and all ~36 sessions in a
    // single stroke, and the handles are then re-issued: `$1643` afterwards is
    // somebody else's session, so an item queued for the old one names a
    // stranger.
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "continue", "greg");
    q.enqueueAction(TARGET, "pull", "greg");
    q.noteGeneration(132_280);

    expect(q.noteGeneration(400_100)).toBe(2);

    // Visible rather than dropped, and reported as orphaned rather than sent.
    expect(q.size(SESSION)).toBe(2);
    const items = q.snapshot(SESSION).items;
    expect(items.every((i) => i.invalidated !== null)).toBe(true);
    expect(items[0]?.invalidated).toContain("132280");
    const out = q.next(SESSION, ctx(IDLE));
    expect(out.kind).toBe("orphaned");
    if (out.kind === "orphaned") expect(out.why).toContain("re-issued");
  });

  it("offers a fresh item queued after the restart rather than stopping at the dead one", () => {
    // GPT Sol's D3, 2026-09-08. `invalidated` is PERMANENT — the handles were
    // re-issued and no later observation can un-re-issue them — and nothing
    // settles an item reported `orphaned`. So a `next()` that stops at the head
    // blocks a perfectly deliverable item queued after the restart for thirty
    // minutes, while the page marks only the dead one and gives no hint that it
    // has to be cancelled first. An item that can never be delivered must not
    // be a gate on one that can.
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "continue", "greg");
    q.noteGeneration(132_280);
    expect(q.noteGeneration(400_100)).toBe(1);
    q.enqueueAction(TARGET, "pull", "greg");
    const items = q.snapshot(SESSION).items;
    expect(items[0]?.invalidated).not.toBe(null);
    expect(items[1]?.invalidated).toBe(null);

    const out = q.next(SESSION, ctx(IDLE));

    expect(out.kind).toBe("ready");
    if (out.kind === "ready") expect(out.item.id).toBe(items[1]?.id);
    // And the dead one is STILL THERE with its sentence on it: the page draws
    // it so a person can read why, and cancelling it is their decision rather
    // than a precondition for anything.
    expect(q.size(SESSION)).toBe(2);
    expect(q.snapshot(SESSION).items[0]?.invalidated).not.toBe(null);
  });

  it("still says orphaned when every waiting item is dead, rather than empty", () => {
    // The other end of the same change. Skipping past the invalidated items
    // must not turn "everything here is undeliverable" into "there is nothing
    // here" — the drain would then report nothing and the page would draw two
    // items nobody was talking about.
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "continue", "greg");
    q.enqueueAction(TARGET, "pull", "greg");
    q.noteGeneration(132_280);
    q.noteGeneration(400_100);

    const out = q.next(SESSION, ctx(IDLE));

    expect(out.kind).toBe("orphaned");
    if (out.kind === "orphaned") expect(out.head.id).toBe(headId(q.snapshot(SESSION).items));
  });

  it("leaves a leased item alone, because it is already out of reach", () => {
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "continue", "greg");
    q.noteGeneration(132_280);
    const out = q.next(SESSION, ctx(IDLE));
    if (out.kind !== "ready") throw new Error("expected a lease");
    expect(q.noteGeneration(400_100)).toBe(0);
    expect(q.snapshot(SESSION).items[0]?.invalidated).toBe(null);
    expect(q.next(SESSION, ctx(IDLE)).kind).toBe("in-flight");
  });
});

/* ---------------------------------------------------------------- *
 * Which run of the server minted an id.
 *
 * `q1` came round again on every restart, and nothing noticed. The queue is
 * volatile, so a restart empties it — but the counter restarts too, and the
 * very next enqueue re-issues `q1` to somebody else's instruction. A phone left
 * open across a restart is holding ids that now name different work.
 * ---------------------------------------------------------------- */

describe("instance-qualified ids", () => {
  it("mints different ids in two runs of the server for the same first item", () => {
    const a = makeQueue(undefined, "deadbeef");
    const b = makeQueue(undefined, "0badcafe");
    a.q.enqueueAction(TARGET, "pull", "greg");
    b.q.enqueueAction(TARGET, "pull", "greg");
    const first = a.q.snapshot(SESSION).items[0]?.id ?? "";
    const second = b.q.snapshot(SESSION).items[0]?.id ?? "";
    // Without the prefix both of these are `q1`, and every route that matches
    // an id by string equality resolves one to the other.
    expect(first).not.toBe(second);
    expect(first).toContain("deadbeef");
    expect(second).toContain("0badcafe");
  });

  it("keeps counting within one run, so ids stay distinct and ordered", () => {
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "pull", "greg");
    q.enqueueAction(TARGET, "push", "greg");
    const ids = q.snapshot(SESSION).items.map((i) => i.id);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(q.idOrigin(id)).toBe("this-instance");
  });

  it("tells its own ids from another run's, and both from a string that names no run", () => {
    const a = makeQueue(undefined, "deadbeef");
    const b = makeQueue(undefined, "0badcafe");
    a.q.enqueueAction(TARGET, "pull", "greg");
    const mine = a.q.snapshot(SESSION).items[0]?.id ?? "";

    expect(a.q.idOrigin(mine)).toBe("this-instance");
    expect(b.q.idOrigin(mine)).toBe("other-instance");
    // A hand-typed or garbled id is NOT evidence of a previous server, and
    // claiming it was would swap one false statement for another. The routes
    // let this fall through to their existing "no such item".
    expect(a.q.idOrigin("q1")).toBe("not-instance-qualified");
    expect(a.q.idOrigin("")).toBe("not-instance-qualified");
  });

  it("splits at the first separator, so nothing about the suffix can confuse it", () => {
    // The instance token is lowercase hex, so the separator cannot occur inside
    // it and the FIRST one is always the boundary. Asserted rather than
    // assumed, because the parse is what makes the refusal trustworthy.
    const { q } = makeQueue(undefined, "deadbeef");
    expect(q.idOrigin("deadbeef-q1-q2")).toBe("this-instance");
    expect(q.idOrigin("0badcafe-q1-q2")).toBe("other-instance");
    // An empty or non-hex token is not a run of anything, so it is not an
    // instance either. Same reason as the garbled id above.
    expect(q.idOrigin("-q1")).toBe("not-instance-qualified");
    expect(q.idOrigin("zzzzzzzz-q1")).toBe("not-instance-qualified");
  });
});

/* ---------------------------------------------------------------- *
 * Seeing it, and taking it back.
 * ---------------------------------------------------------------- */

describe("visibility and cancellation", () => {
  it("cancels a waiting item", () => {
    const { q } = makeQueue();
    const a = q.enqueueAction(TARGET, "continue", "greg");
    const b = q.enqueueAction(TARGET, "pull", "greg");
    if (!a.ok || !b.ok) throw new Error("setup");
    expect(q.cancel(SESSION, a.item.id).ok).toBe(true);
    expect(q.snapshot(SESSION).items.map((i) => i.id)).toEqual([b.item.id]);
  });

  it("refuses to cancel one that is already going out", () => {
    // Pretending otherwise would be the dishonest option: the keys may already
    // be on their way to the pane, and removing the row tells somebody it did
    // not happen.
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "continue", "greg");
    const out = q.next(SESSION, ctx(IDLE));
    if (out.kind !== "ready") throw new Error("expected a lease");
    const cancelled = q.cancel(SESSION, out.item.id);
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) expect(cancelled.why).toContain("cannot be taken back");
    expect(q.size(SESSION)).toBe(1);
  });

  it("clears the waiting items and keeps the one in flight", () => {
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "continue", "greg");
    q.enqueueAction(TARGET, "pull", "greg");
    q.enqueueAction(TARGET, "push", "greg");
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
    q.enqueueAction(TARGET, "continue", "greg");
    const snap = q.snapshot(SESSION);
    expect(snap.volatile).toBe(true);
    expect(snap.warning).toBe(PERSISTENCE_WARNING);
    expect(snap.warning).toContain("Restarting it discards");
    expect(snap.since).toBeLessThanOrEqual(snap.items[0]?.enqueuedAt ?? 0);
  });

  it("lists only the sessions that have something waiting", () => {
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "continue", "greg");
    q.enqueueAction({ sessionId: "$99", claudeSessionId: OTHER_CONVO }, "pull", "greg");
    expect(q.snapshots().map((s) => s.sessionId).sort()).toEqual(["$1643", "$99"]);
    q.clear("$99");
    expect(q.snapshots().map((s) => s.sessionId)).toEqual(["$1643"]);
  });

  it("keeps one session's queue out of another's", () => {
    const { q } = makeQueue();
    q.enqueueAction(TARGET, "continue", "greg");
    expect(q.size("$99")).toBe(0);
    expect(q.next("$99", ctx(IDLE, OTHER_CONVO)).kind).toBe("empty");
    expect(q.size(SESSION)).toBe(1);
  });
});

/* ---------------------------------------------------------------- *
 * The vocabulary and the queue agree.
 * ---------------------------------------------------------------- */

describe("every spoken session action can actually be queued", () => {
  it("accepts each one, and rejects everything the drain would not deliver", () => {
    // Driven off the catalogue rather than off a list here, so an action added
    // to actions.ts is covered the day it is added. The rule is BOTH halves:
    // session-scoped (a box-wide one has no single session to be ordered
    // against) and spoken (nothing delivers a queued enacted action).
    for (const action of ACTIONS) {
      const { q } = makeQueue();
      const out = q.enqueueAction(TARGET, action.id, "greg");
      expect(out.ok, action.id).toBe(action.scope === "session" && action.effect === "spoken");
    }
  });
});
