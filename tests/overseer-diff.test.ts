/**
 * The Overseer's differ: the canonical transition key, the identity pair, and
 * the generation rule.
 *
 * The four real pairs in tests/fixtures/overseer-snapshots/ carry a status
 * change, a disappearance, an appearance and a byte-identical duplicate. They
 * carry one tmux generation, no `unknown` status, no `waiting` and no resumed
 * session — so the three rules with the sharpest teeth have no real example and
 * every case below that exercises one says CONSTRUCTED in its name and starts
 * from one of those files.
 */
import { describe, expect, test } from "vitest";

import type { SessionState } from "../scripts/gjd-remote-tmux.js";
import type { AdmissibleSnapshot } from "../tools/overseer/admissible.js";
import {
  diff,
  generationRelation,
  sessionKey,
  statusKey,
  WAIT_DEADLINE_TOLERANCE_MS,
  type OverseerEvent,
} from "../tools/overseer/diff.js";
import type { JsonValue } from "../tools/overseer/observation.js";
import { editableFixture, freshFixture, freshFrom, rowsOf, type FixtureName } from "./overseer-fixtures.js";

/** A fixture with one field edited, back through the real parser. */
function edited(name: FixtureName, edit: (payload: Record<string, JsonValue>) => void) {
  const payload = editableFixture(name);
  edit(payload);
  return freshFrom(payload, `${name} (constructed)`);
}

/**
 * The events, for the cases that expect a comparison to have happened at all.
 *
 * IT THROWS ON A HOLD RATHER THAN RETURNING `[]`, because those two are the
 * pair this stage's P0 was about: an empty event list and a refusal to compare
 * look identical to a caller that only reads events, and every test below that
 * expects silence would go on passing if `diff()` quietly started holding
 * everything.
 */
function diffed(previous: AdmissibleSnapshot | null, next: AdmissibleSnapshot): OverseerEvent[] {
  const outcome = diff(previous, next);
  if (outcome.kind !== "diffed") throw new Error(`expected a diff, got ${outcome.kind}: ${outcome.reason}`);
  return outcome.events;
}

function kinds(events: readonly OverseerEvent[]): string[] {
  return events.map((e) => e.kind);
}

describe("the real pairs", () => {
  test("a status change is one event, and it names both ends of it", () => {
    const before = freshFixture("status-change-before");
    const after = freshFixture("status-change-after");
    const events = diffed(before, after);

    expect(events).toHaveLength(1);
    const [event] = events;
    if (event?.kind !== "session-status") throw new Error(`expected a status event, got ${event?.kind}`);
    expect(event.identity.tmuxId).toBe("$1991");
    expect(event.from).toBe("idle");
    expect(event.to).toBe("working");
    expect(event.at).toBe(after.clock.at);
    expect(event.tmuxServerPid).toBe(132280);
    // The key is the PAIR, so the claimed conversation is in it — and the word
    // `claims` is in the key on purpose, because a human reading the log should
    // not take that half for a verified fact either.
    expect(event.key).toContain("$1991 claims:");
  });

  test("a session that went away, and one that arrived, in the same collection", () => {
    // Churn is constant on this box: every one of the ten transitions in the
    // capture had something appear or disappear, so this is the ordinary case
    // rather than an alarm.
    const events = diffed(freshFixture("session-gone-before"), freshFixture("session-gone-after"));
    expect(kinds(events)).toEqual(["tmux-session-gone", "session-seen"]);

    const [gone, seen] = events;
    if (gone?.kind !== "tmux-session-gone") throw new Error("expected a gone event first");
    expect(gone.identity.tmuxId).toBe("$2225");
    expect(gone.why).toBe("absent-from-snapshot");
    expect(gone.name).not.toBe("");
    if (seen?.kind !== "session-seen") throw new Error("expected a seen event second");
    expect(seen.identity.tmuxId).toBe("$1644");
    // The whole row rides along, because `meta.dir` is the one field nothing
    // downstream can reconstruct.
    expect(seen.row.meta.version === 1 ? seen.row.meta.dir : null).not.toBeNull();
  });

  test("the other real pair, the other way round", () => {
    const events = diffed(freshFixture("session-new-before"), freshFixture("session-new-after"));
    expect(kinds(events)).toEqual(["tmux-session-gone", "session-seen"]);
    expect(events[0]?.identity.tmuxId).toBe("$1992");
    expect(events[1]?.identity.tmuxId).toBe("$2243");
  });

  test("two polls of the same collection produce nothing at all", () => {
    expect(diffed(freshFixture("duplicate-first"), freshFixture("duplicate-second"))).toEqual([]);
  });

  test("the five sessions present in both halves of a status change produce nothing", () => {
    // The steady case. Four of the six rows are untouched between these two
    // collections and none of them should be in the log.
    const events = diffed(freshFixture("status-change-before"), freshFixture("status-change-after"));
    expect(events.filter((e) => e.identity.tmuxId !== "$1991")).toEqual([]);
  });

  test("a cold start announces every row and closes nothing", () => {
    const events = diffed(null, freshFixture("status-change-before"));
    expect(kinds(events)).toEqual(Array(6).fill("session-seen"));
  });
});

/**
 * THE MEASUREMENT THIS MODULE EXISTS FOR: 51 status comparisons in the capture
 * differed in some field and 2 differed in anything meaningful, almost all of
 * the noise being `waiting.secondsLeft` counting down. The capture contains no
 * `waiting` session at all in its trimmed six-session rows, so the noise itself
 * has to be constructed — which is exactly the case that would have made the
 * event log useless.
 */
describe("the canonical transition key", () => {
  test("CONSTRUCTED: a countdown is not a transition", () => {
    // 900 → 826 across the 74.252 s between these two real clocks: the
    // countdown fell by as much as the clock advanced, which is what a wait
    // parked on one deadline does. The numbers used to be 900 → 840, which is
    // not a countdown at all — it is a deadline shoved 14 s later — and it
    // passed because nothing here looked at the deadline until S2-03.
    const before = edited("status-change-before", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["status"] = { kind: "waiting", secondsLeft: 900 };
    });
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["status"] = { kind: "waiting", secondsLeft: 826 };
    });
    // Structurally these two statuses differ. Meaningfully they do not: the
    // session has been parked on the same wait for the whole minute between
    // collections, and a log that says otherwise buries the events that matter
    // under one per waiting session per collection.
    expect(diffed(before, after)).toEqual([]);
  });

  test("CONSTRUCTED: leaving the wait IS a transition", () => {
    const before = edited("status-change-before", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["status"] = { kind: "waiting", secondsLeft: 900 };
    });
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["status"] = { kind: "needs-you" };
    });
    const events = diffed(before, after);
    expect(kinds(events)).toEqual(["session-status"]);
    if (events[0]?.kind !== "session-status") return;
    expect([events[0].from, events[0].to]).toEqual(["waiting", "needs-you"]);
  });

  test("statusKey drops the countdown and keeps everything a consumer acts on", () => {
    const waiting = (secondsLeft: number): SessionState => ({ kind: "waiting", secondsLeft });
    expect(statusKey(waiting(900))).toBe(statusKey(waiting(1)));

    // `busy` is in: it is the difference between a shell grinding through
    // `npm test` and one sitting at a prompt, and null is a third answer.
    const shell = (busy: boolean | null): SessionState => ({ kind: "shell", busy });
    expect(new Set([statusKey(shell(true)), statusKey(shell(false)), statusKey(shell(null))]).size).toBe(3);
  });

  test("CONSTRUCTED: `why` is our wording and is not in the key", () => {
    const cause = "agents-unavailable" as const;
    const a: SessionState = { kind: "unknown", cause, why: "the box could not say what Claude is doing" };
    const b: SessionState = { kind: "unknown", cause, why: "we could not ask the box" };
    expect(statusKey(a)).toBe(statusKey(b));
  });

  test("CONSTRUCTED: the reported status token IS in the key, and this is S1-1's answer", () => {
    // A future Claude Code reports `compacting` and then `waiting-for-input`.
    // Both are `unrecognised-agent-status`, so a key made of the cause alone
    // loses the intermediate state entirely — and unlike our reworded prose,
    // that token is the box's own observation and moves only when the box does.
    const unknown = (reportedStatus: string): SessionState => ({
      kind: "unknown",
      cause: "unrecognised-agent-status",
      why: `Claude Code calls this '${reportedStatus}', which this version does not know`,
      reportedStatus,
    });
    expect(statusKey(unknown("compacting"))).not.toBe(statusKey(unknown("waiting-for-input")));

    const before = edited("status-change-before", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["status"] = unknown("compacting") as unknown as JsonValue;
    });
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["status"] = unknown("waiting-for-input") as unknown as JsonValue;
    });
    expect(kinds(diffed(before, after))).toEqual(["session-status"]);
  });
});

/**
 * Identity is the pair, and the third of the four ways a session stops being
 * what it was. The capture has no resumed session, so this is constructed.
 */
describe("CONSTRUCTED: a tmux session resumed into a different conversation", () => {
  test("is one replacement, not a disappearance and an arrival", () => {
    const before = freshFixture("status-change-before");
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["claudeSessionId"] = "00000000-1111-2222-3333-444444444444";
    });

    const events = diffed(before, after);
    expect(kinds(events)).toEqual(["session-replaced"]);
    const [event] = events;
    if (event?.kind !== "session-replaced") return;
    expect(event.identity.claimedConversationId).toBe("00000000-1111-2222-3333-444444444444");
    expect(event.previous.claimedConversationId).toBe(before.rows[0]?.claimedConversationId);
    // Same handle, same name, same pane — everything a history keyed on the
    // handle would have used to decide these were one continuous agent.
    expect(event.identity.tmuxId).toBe(event.previous.tmuxId);
    expect(event.key).not.toBe(event.previousKey);
  });

  test("the key of a session with no conversation cannot collide with one that has an empty id", () => {
    const none = sessionKey({ tmuxId: "$7", claimedConversationId: null });
    const empty = sessionKey({ tmuxId: "$7", claimedConversationId: "" });
    expect(none).not.toBe(empty);
  });

  test("KNOWN BLIND SPOT: a replacement the tmux environment did not notice produces nothing", () => {
    // NOT an aspiration and not a bug to fix here. The uuid is pinned into the
    // tmux environment before Claude runs and is never rewritten, so a pane
    // whose Claude exited and restarted goes on reporting the FIRST
    // conversation — measured on the live box, 2026-09-08. This test pins the
    // asymmetry so nobody reads the silence of `session-replaced` as evidence
    // of continuity: only a transcript's mtime can settle that, and this stage
    // does no I/O.
    const before = freshFixture("status-change-before");
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[0];
      // The conversation changed. The claim did not, because nothing updates it.
      if (row) row["status"] = { kind: "idle" };
    });
    expect(diffed(before, after)).toEqual([]);
  });
});

/**
 * THE GENERATION RULE. The capture is one tmux server throughout
 * (`tmuxServerPid: 132280`), so the case a reboot produces — the event this
 * whole stage exists to survive — has no real example and must be constructed.
 */
describe("CONSTRUCTED: a different tmux generation", () => {
  test("closes every session from the old world and starts the new one fresh", () => {
    const before = freshFixture("status-change-before");
    const after = edited("status-change-after", (p) => {
      p["tmuxServerPid"] = 999_111;
    });

    const events = diffed(before, after);
    // Six closed, six opened. NOT one status change and five silences: the
    // handles match up perfectly and mean nothing, because `$1991` in a new
    // tmux server is a fresh allocation that happens to wear the same number.
    expect(kinds(events)).toEqual([...Array(6).fill("tmux-session-gone"), ...Array(6).fill("session-seen")]);
    expect(events.some((e) => e.kind === "session-replaced")).toBe(false);
    expect(events.some((e) => e.kind === "session-status")).toBe(false);

    for (const event of events.slice(0, 6)) {
      if (event.kind !== "tmux-session-gone") throw new Error("expected closures first");
      // The reason distinguishes "this session went away" from "the world did",
      // and the generation on the event is the world it belonged to.
      expect(event.why).toBe("tmux-server-changed");
      expect(event.tmuxServerPid).toBe(132280);
    }
    for (const event of events.slice(6)) expect(event.tmuxServerPid).toBe(999_111);
  });

  test("a generation nobody could read is not a change", () => {
    // A tmux busy enough to time out a listing is exactly the box this tooling
    // is for, so "I could not tell" must not close out the entire fleet at the
    // moment it is least true.
    expect(generationRelation(132280, null)).toBe("unverifiable");
    expect(generationRelation(null, 132280)).toBe("unverifiable");
    expect(generationRelation(null, null)).toBe("unverifiable");
    expect(generationRelation(132280, 132280)).toBe("same");
    expect(generationRelation(132280, 1)).toBe("changed");
  });

  /**
   * THIS TEST USED TO ASSERT THE OPPOSITE, and it passed for as long as it was
   * wrong. Its old name was "an unreadable generation diffs normally rather
   * than closing the fleet" and it pinned the unsafe default GPT Sol found as
   * S2-01: a snapshot whose world nobody could identify was compared to the
   * last one anyway, and the baseline moved on to it. Both halves of that were
   * wrong, and neither was visible in an event log. Changed deliberately,
   * 2026-09-08.
   *
   * The rule it was defending is still here and is still right — an unreadable
   * generation must NOT be read as a reboot and must not close the fleet. What
   * changed is what happens instead: nothing is recorded, nothing is compared,
   * and the baseline stays where it was.
   */
  test("S2-01: an unreadable generation neither closes the fleet nor is diffed — THIS TEST ASSERTED THE OPPOSITE UNTIL 2026-09-08", () => {
    const before = freshFixture("status-change-before");
    const after = edited("status-change-after", (p) => {
      p["tmuxServerPid"] = null;
    });
    const outcome = diff(before, after);
    expect(outcome.kind).toBe("held");
    if (outcome.kind !== "held") return;
    expect(outcome.why).toBe("generation-unreadable");
    // The sentence is the whole point of holding rather than dropping: S3 has
    // to be able to write down that the history stopped, and why.
    expect(outcome.reason).toContain("no tmux generation");
    expect(outcome.reason).toContain(after.clock.at);
  });

  test("S2-01: an EMPTY fleet with an unreadable generation is still diffed, because there is nothing to equate", () => {
    const before = freshFixture("status-change-before");
    const drained = edited("status-change-after", (p) => {
      p["tmuxServerPid"] = null;
      p["rows"] = [];
    });
    const outcome = diff(before, drained);
    expect(outcome.kind).toBe("diffed");
    // Six sessions were there and are not. That is evidence, and refusing it
    // would be refusing the truth at the moment it is most interesting.
    expect(kinds(diffed(before, drained))).toEqual(Array(6).fill("tmux-session-gone"));
  });

  test("S2-01: 100 → null → 200 reads as a reboot rather than as one continuous world", () => {
    // THE SEQUENCE THE P0 IS ABOUT. tmux restarts during the middle collection
    // and the generation cannot be read; the handles in it are fresh
    // allocations wearing the old numbers. Diffing the middle one — which is
    // what this module used to do — attributes $1991's status change across a
    // reboot and then advances the baseline, so by the time a readable
    // generation arrives there is nothing left to notice.
    const a = freshFixture("status-change-before");
    const b = edited("status-change-after", (p) => {
      p["tmuxServerPid"] = null;
    });
    const c = edited("session-new-after", (p) => {
      p["tmuxServerPid"] = 999111;
    });

    // The daemon's loop, as S3 will write it: the baseline moves only on a
    // `diffed`, and the compiler is what stops it moving on a `held`.
    let baseline = a;
    const events: OverseerEvent[] = [];
    const holds: string[] = [];
    for (const next of [b, c]) {
      const outcome = diff(baseline, next);
      if (outcome.kind === "diffed") {
        events.push(...outcome.events);
        baseline = outcome.baseline;
      } else {
        holds.push(outcome.why);
      }
    }

    expect(holds).toEqual(["generation-unreadable"]);
    // The reboot is found against the LAST KNOWN WORLD rather than against the
    // one nobody could read: six sessions from generation 132280 closed, and
    // the new world's rows announced.
    expect(kinds(events)).toEqual([...Array(6).fill("tmux-session-gone"), ...Array(6).fill("session-seen")]);
    for (const event of events.slice(0, 6)) {
      if (event.kind !== "tmux-session-gone") throw new Error("expected closures first");
      expect(event.why).toBe("tmux-server-changed");
      expect(event.tmuxServerPid).toBe(132280);
    }
    // And nothing is attributed across the boundary — the fabricated history
    // this rule exists to prevent.
    expect(events.some((e) => e.kind === "session-status")).toBe(false);
    expect(events.some((e) => e.kind === "session-replaced")).toBe(false);
  });
});

/**
 * S2-03: a wait that was RESTARTED between two collections, which the canonical
 * key cannot see because every wait keys as `waiting`.
 *
 * The tolerance this rests on is an empirical claim about the producer, so the
 * first test here is a MEASUREMENT of the real `waiting-{first,second}` pair
 * rather than an assertion about our own code. The rest are constructed on top
 * of that real envelope.
 */
describe("a wait, and the deadline that tells a restarted one from a countdown", () => {
  test("REAL: the implied deadline does not move, even across a missed collection", () => {
    // THIS IS THE MEASUREMENT THE TOLERANCE IS SIZED FROM, and it is here
    // rather than only in a comment because it is a claim about somebody else's
    // code. If the producer ever starts sampling `secondsLeft` independently of
    // the deadline it derives it from, this goes red and
    // `WAIT_DEADLINE_TOLERANCE_MS` is wrong rather than merely stale.
    //
    // These two collections are 129.9 s apart — a collection was missed between
    // them, twice the ordinary 65 s cadence — and that is why this pair was
    // captured rather than a consecutive one: the tempting reasoning is that
    // the tolerance must cover the interval, and the interval doubling here
    // moves the deadline by nothing at all, because both halves of the sum move
    // together.
    const first = freshFixture("waiting-first");
    const second = freshFixture("waiting-second");
    expect(second.clock.atMs - first.clock.atMs).toBe(129_937);

    const deadlines = (s: typeof first): Map<string, number> =>
      new Map(
        s.rows
          .filter((r) => r.status.kind === "waiting")
          .map((r) => [r.id, s.clock.atMs + (r.status.kind === "waiting" ? r.status.secondsLeft : 0) * 1000]),
      );
    const before = deadlines(first);
    const after = deadlines(second);
    expect(before.size).toBe(3);
    for (const [id, deadline] of before) {
      // Whole-second countdowns, so the residue is sub-second rounding.
      expect(Math.abs((after.get(id) ?? 0) - deadline)).toBeLessThan(1000);
    }
  });

  test("REAL: three sessions counting down across a missed collection produce nothing at all", () => {
    // The noise case, at last with real data. Every one of the three waits has
    // a different `secondsLeft` in the two snapshots, and a differ comparing
    // status objects structurally writes three events here.
    expect(diffed(freshFixture("waiting-first"), freshFixture("waiting-second"))).toEqual([]);
  });
});

/**
 * The restart itself, constructed — on the REAL waiting pair above, so only the
 * one countdown under test is synthetic and the 129.937 s between the two
 * clocks is the real thing.
 *
 * `$2082` is the first row of both files and is `waiting` in both, so replacing
 * its `secondsLeft` leaves the other two waits counting down honestly beside
 * it. Their silence is part of every assertion here.
 */
describe("CONSTRUCTED: a wait that was replaced by a longer one", () => {
  /** The gap between the two real collections. Every number below is derived from it. */
  const GAP_MS = 129_937;

  function waits(beforeSeconds: number, afterSeconds: number): OverseerEvent[] {
    const before = edited("waiting-first", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["status"] = { kind: "waiting", secondsLeft: beforeSeconds };
    });
    const after = edited("waiting-second", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["status"] = { kind: "waiting", secondsLeft: afterSeconds };
    });
    return diffed(before, after);
  }

  test("S2-03: 60 → 3600 is a new wait and says so", () => {
    // Sol's sequence. The first wait ended and an hour-long one began, and
    // until 2026-09-08 the history showed one uninterrupted wait, because both
    // statuses key as `waiting`.
    const events = waits(60, 3600);
    expect(kinds(events)).toEqual(["session-wait-restarted"]);
    const [event] = events;
    if (event?.kind !== "session-wait-restarted") return;
    expect(event.identity.tmuxId).toBe("$2082");
    expect(Date.parse(event.deadline) - Date.parse(event.previousDeadline)).toBeGreaterThan(
      WAIT_DEADLINE_TOLERANCE_MS,
    );
    // The status rides along so the log can say how long the new wait is.
    expect(event.status).toEqual({ kind: "waiting", secondsLeft: 3600 });
  });

  test("S2-03: a deadline that moved fifteen seconds is a restart, and this is what pins the tolerance", () => {
    // THE TEST THAT KILLS THE OBVIOUS WRONG CONSTANT. Everything else in this
    // block passes just as well with a two-minute tolerance, because the gap
    // between these two real collections is 130 s and every restart
    // constructed above moves the deadline by minutes. This one moves it by
    // 14.9 s — a wait counted down 115 s while 130 s of clock passed — which a
    // tolerance sized for collection jitter would call jitter and this one
    // calls what it is.
    //
    // Found by mutation: replacing 10 s with 120 s left the whole suite green
    // until this case existed.
    expect(WAIT_DEADLINE_TOLERANCE_MS).toBeLessThan(30_000);
    const events = waits(900, 785);
    expect(kinds(events)).toEqual(["session-wait-restarted"]);
    const [event] = events;
    if (event?.kind !== "session-wait-restarted") return;
    const moved = Date.parse(event.deadline) - Date.parse(event.previousDeadline);
    expect(moved).toBeGreaterThan(WAIT_DEADLINE_TOLERANCE_MS);
    expect(moved).toBeLessThan(15_000);
  });

  test("S2-03: an ordinary countdown is silent", () => {
    // A countdown consistent with the interval: the deadline does not move, so
    // there is nothing to say. This is what the real rows either side of it do.
    expect(waits(900, 900 - Math.round(GAP_MS / 1000))).toEqual([]);
  });

  test("S2-03: a countdown that did NOT advance is a restart, not jitter", () => {
    // The same `secondsLeft` twice across 130 s means the deadline moved 130 s
    // later, and under this producer that only happens if the wait was re-armed
    // — measured, not assumed: five consecutive collections held three implied
    // deadlines still to within a second, one of those intervals being this
    // doubled one. An earlier draft of this test asserted the opposite, on the
    // wrong theory that collection jitter moves the deadline. It does not: both
    // halves of the sum move together.
    expect(kinds(waits(900, 900))).toEqual(["session-wait-restarted"]);
  });

  test("S2-03: a wait shortened by hand stays silent, because a deadline that comes closer is not a new wait", () => {
    expect(waits(3600, 60)).toEqual([]);
  });

  test("S2-03: the boundary is exactly where the tolerance says it is", () => {
    // Derived from the constant rather than hard-coded, so changing the
    // tolerance moves this test's boundary with it instead of leaving it
    // quietly checking a number that used to matter.
    const before = freshFixture("waiting-first");
    const after = freshFixture("waiting-second");
    const gapMs = after.clock.atMs - before.clock.atMs;
    expect(gapMs).toBe(GAP_MS);
    // The largest countdown that still keeps the deadline inside the tolerance.
    const stillWithin = 900 - Math.ceil((gapMs - WAIT_DEADLINE_TOLERANCE_MS) / 1000);
    expect(waits(900, stillWithin)).toEqual([]);
    expect(kinds(waits(900, stillWithin + 1))).toEqual(["session-wait-restarted"]);
  });
});
