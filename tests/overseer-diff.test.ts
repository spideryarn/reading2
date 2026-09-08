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
import { diff, generationRelation, sessionKey, statusKey, type OverseerEvent } from "../tools/overseer/diff.js";
import type { ClaimedConversationId, JsonValue } from "../tools/overseer/observation.js";
import { editableFixture, freshFixture, freshFrom, rowsOf, type FixtureName } from "./overseer-fixtures.js";

/** A fixture with one field edited, back through the real parser. */
function edited(name: FixtureName, edit: (payload: Record<string, JsonValue>) => void) {
  const payload = editableFixture(name);
  edit(payload);
  return freshFrom(payload, `${name} (constructed)`);
}

function kinds(events: readonly OverseerEvent[]): string[] {
  return events.map((e) => e.kind);
}

describe("the real pairs", () => {
  test("a status change is one event, and it names both ends of it", () => {
    const before = freshFixture("status-change-before");
    const after = freshFixture("status-change-after");
    const events = diff(before, after);

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
    const events = diff(freshFixture("session-gone-before"), freshFixture("session-gone-after"));
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
    const events = diff(freshFixture("session-new-before"), freshFixture("session-new-after"));
    expect(kinds(events)).toEqual(["tmux-session-gone", "session-seen"]);
    expect(events[0]?.identity.tmuxId).toBe("$1992");
    expect(events[1]?.identity.tmuxId).toBe("$2243");
  });

  test("two polls of the same collection produce nothing at all", () => {
    expect(diff(freshFixture("duplicate-first"), freshFixture("duplicate-second"))).toEqual([]);
  });

  test("the five sessions present in both halves of a status change produce nothing", () => {
    // The steady case. Four of the six rows are untouched between these two
    // collections and none of them should be in the log.
    const events = diff(freshFixture("status-change-before"), freshFixture("status-change-after"));
    expect(events.filter((e) => e.identity.tmuxId !== "$1991")).toEqual([]);
  });

  test("a cold start announces every row and closes nothing", () => {
    const events = diff(null, freshFixture("status-change-before"));
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
    const before = edited("status-change-before", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["status"] = { kind: "waiting", secondsLeft: 900 };
    });
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["status"] = { kind: "waiting", secondsLeft: 840 };
    });
    // Structurally these two statuses differ. Meaningfully they do not: the
    // session has been parked on the same wait for the whole minute between
    // collections, and a log that says otherwise buries the events that matter
    // under one per waiting session per collection.
    expect(diff(before, after)).toEqual([]);
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
    const events = diff(before, after);
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
    expect(kinds(diff(before, after))).toEqual(["session-status"]);
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

    const events = diff(before, after);
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
    const empty = sessionKey({ tmuxId: "$7", claimedConversationId: "" as ClaimedConversationId });
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
    expect(diff(before, after)).toEqual([]);
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

    const events = diff(before, after);
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

  test("an unreadable generation diffs normally rather than closing the fleet", () => {
    const before = freshFixture("status-change-before");
    const after = edited("status-change-after", (p) => {
      p["tmuxServerPid"] = null;
    });
    expect(kinds(diff(before, after))).toEqual(["session-status"]);
  });
});
