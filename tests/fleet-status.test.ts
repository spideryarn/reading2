/**
 * v0.3 of the fleet dashboard — the status band, and the ways it could lie.
 *
 * The two-source join itself is `sessionState` in scripts/gjd-remote-tmux.ts
 * and is tested in tests/gjd-remote-tmux.test.ts; re-testing it here would be a
 * second copy of its clauses that stops matching. What is tested here is what
 * tools/fleet/status.ts adds, plus the two collapses the whole area exists to
 * prevent — **absent from `claude agents --json` read as dead**, and **could
 * not ask read as nothing happening** — because those are properties of what
 * this module HANDS THE PAGE, and a page is where they would be seen.
 */
import { describe, expect, it } from "vitest";

import type { Session } from "../scripts/gjd-remote-tmux.js";
import { statusOf, statusesOf, triageCounts, triageRank, triageSort } from "../tools/fleet/status.js";
import type { FleetStatus, StatusedSession } from "../tools/fleet/status.js";

const CLAUDE_ID = "11111111-1111-1111-1111-111111111111";

function session(over: Partial<Session> = {}): Session {
  return {
    id: "$1",
    name: "a-session",
    created: new Date("2026-09-08T00:00:00Z"),
    attached: true,
    windows: 1,
    title: "",
    provisional: false,
    claudeId: CLAUDE_ID,
    proc: { kind: "claude" },
    meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: "/home/greg/code/spideryarn2" },
    ...over,
  };
}

function row(status: FleetStatus, activityAt = 0, id = "$1"): StatusedSession {
  return { id, status, activityAt };
}

describe("statusOf: the collapses this module exists to prevent", () => {
  it("does not report an unlisted-but-running session as dead", () => {
    // The measured case, twice on 2026-09-01: a live `claude --session-id` that
    // `claude agents --json` did not mention for 35+ seconds. The box ANSWERED
    // here — an empty map, not null — and the process table says Claude is
    // running, so the honest answer is "I cannot reconcile these", never
    // `no-claude` and never `idle`.
    const s = session({ proc: { kind: "claude" } });
    const status = statusOf(s, new Map(), null);

    expect(status.kind).toBe("unknown");
    expect(status.kind).not.toBe("no-claude");
    expect(status.kind).not.toBe("idle");
    if (status.kind !== "unknown") throw new Error("unreachable");
    expect(status.why).toContain("did not list it");
  });

  it("says no-claude only when the process table agrees nothing is running", () => {
    // The control for the test above. Without this one, a `statusOf` that
    // returned `unknown` unconditionally would pass it — and would be useless.
    expect(statusOf(session({ proc: { kind: "none" } }), new Map(), null).kind).toBe("no-claude");
  });

  it("turns a failed agents call into unknown-with-a-reason on every Claude row", () => {
    // Not one confident "no claude" anywhere. `agents: null` is the box saying
    // it could not ask, and the difference between that and an empty answer is
    // the difference between a screen of guesses and a screen that says so.
    const sessions = [
      session({ id: "$1", claudeId: CLAUDE_ID, proc: { kind: "claude" } }),
      session({ id: "$2", claudeId: "22222222-2222-2222-2222-222222222222", proc: { kind: "none" } }),
      session({ id: "$3", claudeId: "33333333-3333-3333-3333-333333333333", proc: { kind: "unknown" } }),
    ];
    const rows = statusesOf({ sessions, agents: null, agentsWhy: "claude: command not found" });

    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.status.kind).toBe("unknown");
      if (r.status.kind !== "unknown") throw new Error("unreachable");
      // The box's own words, not just a shrug: this is the half somebody can act on.
      expect(r.status.why).toContain("claude: command not found");
    }
    // And the header must not be able to say "nothing needs you" while every
    // row is a shrug.
    expect(triageCounts(rows).unknown).toBe(3);
  });

  it("leaves a shell alone when the agents call fails, because it was never in that list", () => {
    // A `new-shell` has no Claude in it, so `claude agents --json` was never
    // going to mention it and its failure says nothing about this row. Marking
    // it unknown would put a question mark on the one kind of session we can
    // still answer for.
    const s = session({ claudeId: null, proc: { kind: "busy" } });
    expect(statusOf(s, null, "claude: command not found")).toEqual({ kind: "shell", busy: true });
  });

  it("does not blame the agents call for a hand-set CLAUDE_SESSION_ID", () => {
    // Both unknowns arrive together when the box is broken, and only one of
    // them is the box's fault. Appending "command not found" to a session whose
    // id simply cannot join to anything sends whoever reads it to fix the wrong
    // machine.
    const s = session({ claudeId: "not-a-uuid" });
    const status = statusOf(s, null, "claude: command not found");

    expect(status.kind).toBe("unknown");
    if (status.kind !== "unknown") throw new Error("unreachable");
    expect(status.why).toContain("CLAUDE_SESSION_ID");
    expect(status.why).not.toContain("command not found");
  });

  it("keeps a scheduled sleep's countdown even when Claude Code cannot be asked", () => {
    // `sessionState` decides `waiting` from our own job script and its live
    // `sleep` child, before the agents list is consulted. The dashboard is the
    // caller most likely to be looking at a box where `claude` is broken, so
    // this is the arm worth pinning: a countdown survives, it does not become a
    // shrug.
    const s = session({ proc: { kind: "wait", secondsLeft: 900 } });
    expect(statusOf(s, null, "claude: command not found")).toEqual({ kind: "waiting", secondsLeft: 900 });
  });

  it("says busy: null for a shell the box could not look inside", () => {
    // `false` would be a claim ("at rest"), and null is the admission. Same
    // emptiness, different meaning.
    expect(statusOf(session({ claudeId: null, proc: { kind: "unknown" } }), new Map(), null)).toEqual({
      kind: "shell",
      busy: null,
    });
  });

  it("passes the three live states through", () => {
    const live = (status: string): FleetStatus =>
      statusOf(session(), new Map([[CLAUDE_ID, status]]), null);
    expect(live("waiting").kind).toBe("needs-you");
    expect(live("busy").kind).toBe("working");
    expect(live("idle").kind).toBe("idle");
  });
});

describe("triageRank", () => {
  it("puts needs-you above working, and working above the rest", () => {
    expect(triageRank({ kind: "needs-you" })).toBe(0);
    expect(triageRank({ kind: "working" })).toBe(1);
    expect(triageRank({ kind: "idle" })).toBe(2);
    expect(triageRank({ kind: "unknown", why: "x" })).toBe(2);
    expect(triageRank({ kind: "shell", busy: true })).toBe(2);
    expect(triageRank({ kind: "waiting", secondsLeft: 10 })).toBe(2);
    expect(triageRank({ kind: "no-claude" })).toBe(2);
  });
});

describe("triageSort", () => {
  it("puts a blocked session above a working one, whatever order they arrive in", () => {
    const working = row({ kind: "working" }, 2_000, "$working");
    const blocked = row({ kind: "needs-you" }, 1_000, "$blocked");
    // Newer AND first in the list, and it still sorts below: the band wins over
    // the clock, which is the whole point of triage.
    expect(triageSort([working, blocked]).map((r) => r.id)).toEqual(["$blocked", "$working"]);
    expect(triageSort([blocked, working]).map((r) => r.id)).toEqual(["$blocked", "$working"]);
  });

  it("orders newest first inside a band", () => {
    const older = row({ kind: "working" }, 1_000, "$older");
    const newer = row({ kind: "working" }, 5_000, "$newer");
    expect(triageSort([older, newer]).map((r) => r.id)).toEqual(["$newer", "$older"]);
  });

  it("sorts an unparseable activity time last in its band rather than anywhere", () => {
    // `Date.parse` answers NaN instead of throwing, and every comparison with
    // NaN is false, so a subtracting comparator returns NaN and the row lands
    // wherever the sort happened to walk. The page would look fine.
    const nan = row({ kind: "working" }, Number.NaN, "$nan");
    const a = row({ kind: "working" }, 1_000, "$a");
    const b = row({ kind: "working" }, 5_000, "$b");
    expect(triageSort([nan, a, b]).map((r) => r.id)).toEqual(["$b", "$a", "$nan"]);
    expect(triageSort([a, nan, b]).map((r) => r.id)).toEqual(["$b", "$a", "$nan"]);
  });

  it("does not reorder the caller's array", () => {
    // A background refresh loop hands the same snapshot to two renderers.
    const rows = [row({ kind: "working" }, 1, "$w"), row({ kind: "needs-you" }, 2, "$n")];
    triageSort(rows);
    expect(rows.map((r) => r.id)).toEqual(["$w", "$n"]);
  });

  it("sorts a row that has other fields joined onto it", () => {
    // The shape the page will actually pass: a display row with a status added.
    const joined = [
      { id: "$1", title: "one", status: { kind: "idle" } as const, activityAt: 9 },
      { id: "$2", title: "two", status: { kind: "needs-you" } as const, activityAt: 1 },
    ];
    expect(triageSort(joined)[0]?.title).toBe("two");
  });
});

describe("statusesOf", () => {
  it("keeps the box's order and carries the join key and the clock", () => {
    const sessions = [
      session({ id: "$7", created: new Date("2026-09-08T01:00:00Z") }),
      session({ id: "$2", claudeId: null, created: new Date("2026-09-08T02:00:00Z") }),
    ];
    const rows = statusesOf({ sessions, agents: new Map([[CLAUDE_ID, "busy"]]), agentsWhy: null });

    expect(rows.map((r) => r.id)).toEqual(["$7", "$2"]);
    expect(rows[0]?.status.kind).toBe("working");
    expect(rows[1]?.status.kind).toBe("shell");
    expect(rows[0]?.activityAt).toBe(Date.parse("2026-09-08T01:00:00Z"));
  });
});

describe("triageCounts", () => {
  it("counts each band, and unknown alongside them rather than instead", () => {
    const rows = [
      { status: { kind: "needs-you" } as const },
      { status: { kind: "working" } as const },
      { status: { kind: "unknown", why: "x" } as const },
      { status: { kind: "shell", busy: false } as const },
    ];
    expect(triageCounts(rows)).toEqual({ needsYou: 1, working: 1, other: 2, unknown: 1 });
  });
});
