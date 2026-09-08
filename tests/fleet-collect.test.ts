/**
 * The collector, and the configuration that decides whether the server starts.
 *
 * The inventory itself is `scripts/gjd-remote-tmux.ts` and is tested in
 * tests/gjd-remote-tmux.test.ts; there is no point re-testing the parse here.
 *
 * **The rendering tests used to live here and have gone**, with `page.ts`
 * itself — Greg removed the hand-written page on 2026-09-08, so there is one
 * renderer rather than two. What they covered is covered by
 * tests/fleet-web.test.tsx against the React client, which was checked before
 * they were deleted rather than assumed: blocked-above-working, the question
 * and its options, an unknown status showing its reason, the stale banner
 * keeping the last good rows, and agent-authored markup rendering as text.
 */
import { describe, expect, it } from "vitest";

import {
  panesBySession,
  sessionScript,
  snapshotFrom,
  tmuxServerPid,
  toRows,
  worktreeOf,
  type FleetSnapshot,
} from "../tools/fleet/collect.js";
import { parseBinds } from "../tools/fleet/config.js";
import { fleetState } from "../tools/fleet/state.js";
import type { FleetStatus } from "../tools/fleet/status.js";
import { buildSessionScript, type Session } from "../scripts/gjd-remote-tmux.js";

/** No status derived for anyone — the map `toRows` falls back from. */
const NO_STATUS = new Map<string, FleetStatus>();

function session(over: Partial<Session> = {}): Session {
  return {
    id: "$1",
    name: "a-session",
    created: new Date("2026-09-08T00:00:00Z"),
    attached: true,
    windows: 1,
    title: "",
    provisional: false,
    claudeId: "f1ee7000-0000-4000-8000-000000000001",
    proc: { kind: "claude" },
    meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: "/home/greg/code/spideryarn2" },
    ...over,
  };
}

describe("worktreeOf", () => {
  it("names the worktree a session is in", () => {
    expect(worktreeOf("/home/greg/code/spideryarn2/.claude/worktrees/logo-animations")).toBe("logo-animations");
  });

  it("is null in a plain checkout rather than guessing", () => {
    expect(worktreeOf("/home/greg/code/spideryarn2")).toBeNull();
  });

  it("is null, not undefined, for a path ending at `worktrees` with nothing under it", () => {
    // `parts[at + 1]` is undefined here, and undefined would render as the
    // string "undefined". noUncheckedIndexedAccess is what makes this visible.
    expect(worktreeOf("/home/greg/code/spideryarn2/.claude/worktrees")).toBeNull();
  });
});

describe("toRows", () => {
  it("keeps a title, trimmed", () => {
    expect(toRows([session({ title: "  Fleet dashboard  " })], NO_STATUS)[0]?.title).toBe("Fleet dashboard");
  });

  it("gives an untitled session null rather than a placeholder", () => {
    // The page decides how to render "no title yet"; the collector must not,
    // or two callers will disagree about it.
    expect(toRows([session({ title: "   " })], NO_STATUS)[0]?.title).toBeNull();
  });

  it("admits it cannot know the repo of a legacy session", () => {
    const r = toRows([session({ meta: { version: "legacy" } })], NO_STATUS)[0];
    expect(r?.repo).toBeNull();
    expect(r?.worktree).toBeNull();
  });

  it("carries tmux's handle through as the id, not the name", () => {
    // The name is what a person reads; the handle is the address, and it
    // survives the rename `gjd-remote ls` performs. Everything later that acts
    // on a session must use this.
    expect(toRows([session({ id: "$1643", name: "renamed-since" })], NO_STATUS)[0]?.id).toBe("$1643");
  });

  it("carries the conversation uuid, which is a different id from both handles", () => {
    // Three ids, and they are not interchangeable: `$1643` is the tmux session,
    // `%2108` is its pane, and this one is the CONVERSATION. A tmux session can
    // be resumed into a different conversation and keep the first two, so this
    // is the only one that identifies what a person means by "this agent".
    const r = toRows([session({ claudeId: "f1ee7000-0000-4000-8000-0000000000aa" })], NO_STATUS)[0];
    expect(r?.claudeSessionId).toBe("f1ee7000-0000-4000-8000-0000000000aa");
  });

  it("is null about a session with no conversation, rather than borrowing a handle", () => {
    // A shell has no `--session-id`. Null here is what makes the steer route
    // refuse; anything else would have it type into a session it cannot verify.
    expect(toRows([session({ claudeId: null })], NO_STATUS)[0]?.claudeSessionId).toBeNull();
  });

  it("gives a session the status pass missed an unknown with a reason", () => {
    // `cause` says OUR BUG rather than "the box could not tell us", which is
    // what every other unknown means. Nothing else in the union names this one,
    // so anything reading these identifiers can separate a defect of ours from
    // a box that is having a bad day — see `SessionUnknownCause`.
    expect(toRows([session()], NO_STATUS)[0]?.status).toEqual({
      kind: "unknown",
      cause: "no-status-derived",
      why: "no status was derived for this session",
    });
  });
});

describe("panesBySession", () => {
  it("maps a session handle to its pane handle", () => {
    // The two handles look alike and are not interchangeable: `$` addresses a
    // session, `%` addresses a pane, and only the second can be read or typed into.
    expect(panesBySession("$1 %10 100\n$2 %20 200\n").get("$2")?.paneId).toBe("%20");
  });

  it("keeps the first pane when a session has several", () => {
    expect(panesBySession("$1 %10 100\n$1 %11 110\n").get("$1")?.paneId).toBe("%10");
  });

  it("omits a malformed line rather than storing half of it", () => {
    // An empty-string pane id would be accepted as an address downstream, and
    // a capture against "" is not obviously wrong until you read the output.
    const m = panesBySession("$1\n\n   \n$2 %20 200\n");
    expect(m.has("$1")).toBe(false);
    expect(m.get("$2")?.paneId).toBe("%20");
  });

  it("reads the tmux SERVER's pid off the same listing", () => {
    // The generation token. `$1643` is unique within one tmux server and
    // meaningless across two, so a stored handle from before a reboot and a
    // live one after it are different sessions wearing one name.
    expect(tmuxServerPid("$1 %10 100 132280\n$2 %20 200 132280\n")).toBe(132280);
  });

  it("is null about the generation rather than guessing one", () => {
    // Empty listing, and a listing with no fourth field. A guessed generation
    // would make two different worlds compare equal, which is the whole hazard.
    expect(tmuxServerPid("")).toBeNull();
    expect(tmuxServerPid("$1 %10 100\n")).toBeNull();
    expect(tmuxServerPid("$1 %10 100 notapid\n")).toBeNull();
  });

  it("carries the pane's pid, which is what catches a respawn", () => {
    // A pane can be respawned and keep its handle, so `%20` alone does not
    // establish that the thing you were looking at is the thing you are about
    // to type into. steer.ts compares this before sending.
    expect(panesBySession("$2 %20 31337\n").get("$2")?.panePid).toBe(31337);
  });

  it("keeps the row when the pid is missing or unreadable, with a null pid", () => {
    // Degrading to "no respawn check available" is right; dropping the row
    // would cost the session its question, and every other guard still applies.
    for (const line of ["$2 %20\n", "$2 %20 notapid\n"]) {
      const info = panesBySession(line).get("$2");
      expect(info?.paneId).toBe("%20");
      expect(info?.panePid).toBeNull();
    }
  });
});

describe("parseBinds", () => {
  it("defaults to loopback", () => {
    expect(parseBinds(undefined)).toEqual({ ok: true, binds: ["127.0.0.1"] });
  });

  it("refuses an empty list rather than listening nowhere", () => {
    // The P0 GPT Sol found. An empty FLEET_BIND gave zero servers, and because
    // the only timer left was unref'd the process collected once, printed lines
    // that all read as success, and exited 0. `FLEET_BIND="$(tailscale ip -4)"`
    // on a box that is not logged in is how it actually happens.
    for (const raw of ["", "   ", ",", " , "]) {
      const r = parseBinds(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.why).toMatch(/listens nowhere/);
    }
  });

  it("refuses a wildcard, because reachability is the only access control", () => {
    for (const raw of ["0.0.0.0", "::", "127.0.0.1,0.0.0.0"]) {
      expect(parseBinds(raw).ok).toBe(false);
    }
  });

  it("keeps several real addresses, trimmed", () => {
    expect(parseBinds(" 127.0.0.1 , 100.92.255.119 ")).toEqual({
      ok: true,
      binds: ["127.0.0.1", "100.92.255.119"],
    });
  });
});

describe("fleetState — the one wire shape", () => {
  const snap: FleetSnapshot = {
    rows: [],
    collectedAt: "2026-09-08T03:00:00.000Z",
    tookMs: 12_000,
    tmuxServerPid: 132280,
  };

  it("says NEVER COLLECTED with a null clock rather than an empty box", () => {
    // The window that matters: a just-restarted dashboard, before the first
    // collection has finished. `rows: []` on its own reads as "nothing is
    // running" — and the Overseer, which folds these into a history, would
    // record thirty-six sessions vanishing at once. The null is the message.
    const s = fleetState(null, null, null, 60_000);
    expect(s.collectedAt).toBeNull();
    expect(s.rows).toEqual([]);
    expect(s.error).toBeNull();
  });

  it("never invents a timestamp for a collection that did not happen", () => {
    // `?? new Date().toISOString()` is the tempting version, for a caller that
    // wants a string. It is a lie with a clock on it: it says "we looked just
    // now and found nothing".
    // Asserted as `toBeNull`, not as `not.toBeString`: a negative assertion is
    // satisfied by undefined, by 0, and by the field disappearing altogether,
    // so it would go on passing through exactly the change it is meant to catch.
    expect(fleetState(null, null, null, 60_000).collectedAt).toBeNull();
  });

  it("keeps the previous rows and clock when a refresh failed", () => {
    // Stale-and-labelled beats blank. The page shows the age; a blank page is
    // the one reading nobody investigates.
    const s = fleetState(snap, "tmux: connection refused", null, 60_000);
    expect(s.collectedAt).toBe(snap.collectedAt);
    expect(s.error).toBe("tmux: connection refused");
  });

  it("carries the refresh interval, so nothing has to guess when it is late", () => {
    // The page flipped to STALE at 30s while the server collected every 60s, so
    // it cried wolf for most of every cycle. A threshold derived from the
    // server's own interval cannot drift away from it.
    expect(fleetState(snap, null, null, 60_000).refreshMs).toBe(60_000);
  });
});

describe("the collector's wiring", () => {
  it("asks for agent states, and would notice if that flag were flipped", () => {
    // Sol's F5: `agents: true` is load-bearing and was invisible. Flipping it to
    // false left every test green while the live dashboard degraded every
    // Claude row to unknown, because the status tests inject an agents map and
    // never reach this call.
    expect(sessionScript()).not.toBe(buildSessionScript({ agents: false }));
    expect(sessionScript()).toBe(buildSessionScript({ agents: true }));
  });

  it("survives a JSON round trip with every row's status intact", () => {
    // The Map-stringifies-to-{} trap, pinned. If status is ever carried
    // alongside the rows again, this goes red rather than the page going quiet.
    //
    // The agents map is keyed off THIS session's own claudeId rather than a
    // repeated literal: the literal was here first, and a merge that changed
    // the fixture's uuid turned the join into a miss, so the row came out
    // `unknown` and the test failed for a reason that had nothing to do with
    // JSON. A fixture that states a value twice will state it twice differently.
    const s = session({ id: "$7", proc: { kind: "claude" } as const });
    const parsed = {
      sessions: [s],
      unreadable: [],
      failure: null,
      agents: new Map([[s.claudeId ?? "", "busy"]]),
      agentsWhy: null,
    };
    const snap = snapshotFrom(
      parsed,
      { panes: new Map([["$7", { paneId: "%70", panePid: 700 }]]), tmuxServerPid: 132280 },
      5,
    );
    const round = JSON.parse(JSON.stringify(snap)) as FleetSnapshot;
    expect(round.rows[0]?.status.kind).toBe("working");
    expect(round.rows[0]?.paneId).toBe("%70");
    // The three ids the steer route needs, all the way through a JSON hop. A
    // row missing any of them is a row whose Send button refuses with a 400,
    // and the refusal would look like a bug in the route rather than a gap here.
    expect(round.rows[0]?.panePid).toBe(700);
    expect(round.rows[0]?.claudeSessionId).toBe(s.claudeId);
    // And the two the Overseer needs to survive a reboot: the full working
    // directory (the row's `worktree` is only a name, and a slugified cwd
    // cannot be un-slugified) and which tmux server these handles are from.
    expect(round.rows[0]?.meta).toEqual(s.meta);
    expect(round.tmuxServerPid).toBe(132280);
  });

  it("reports unknown, not idle, when the box could not be asked", () => {
    const parsed = {
      sessions: [session({ id: "$7", proc: { kind: "claude" } as const })],
      unreadable: [],
      failure: null,
      agents: null,
      agentsWhy: "claude: command not found",
    };
    expect(
      snapshotFrom(parsed, { panes: new Map(), tmuxServerPid: null }, 5).rows[0]?.status.kind,
    ).toBe("unknown");
  });
});
