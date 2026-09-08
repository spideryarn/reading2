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
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  generationDrift,
  panesBySession,
  sessionScript,
  snapshotFrom,
  tmuxServerPid,
  toRows,
  worktreeOf,
  collectWithDeadline,
  selfCheck,
  type FleetSnapshot,
} from "../tools/fleet/collect.js";
import { parseBinds } from "../tools/fleet/config.js";
import { fleetState, readAttemptClock } from "../tools/fleet/state.js";
import type { AttentionFeed } from "../tools/fleet/wire.js";
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
    /* Its own id, not the shared `1111…` one. That belongs to `db-schema.test.ts`,
       which inserts a row under it — and vitest runs files in parallel against one
       database, so whichever tore down first would delete the other's fixture.
       Nothing here inserts anything; this is an in-memory `Session` and the value
       is opaque. `tests/fixture-ids.test.ts` is what noticed, on two branches at
       once: dev picked this value and a worktree picked another, within an hour. */
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

  /**
   * IS THIS A LISTING OF THIS BOX? — the control `generationDrift` does not
   * provide, taken from the `orchestrator-setup` session's process probe.
   *
   * Their form of it: do not ask whether the output *looks* like a process
   * table, ask whether it is a table **of this machine** — and the cheapest
   * proof is that we are in it. The same exposure is here: a `tmux ls` pointed
   * at another socket succeeds, every row parses, nothing errors, and the page
   * shows a calm and entirely wrong fleet.
   */
  const PANES = panesBySession("$1 %10 100\n$2 %2282 200\n");

  it("recognises this box by finding its own pane in the listing", () => {
    expect(selfCheck(PANES, 132280, { TMUX: "/tmp/tmux-1000/default,132280,2279", TMUX_PANE: "%2282" })).toEqual({
      kind: "present",
      paneId: "%2282",
    });
  });

  it("refuses a listing that does not contain us", () => {
    // The realistic shape: a second tmux server, or a `-S` in a wrapper. Every
    // handle in it is real and belongs to somebody else.
    const out = selfCheck(PANES, 132280, { TMUX: "/tmp/tmux-1000/default,132280,2279", TMUX_PANE: "%9999" });
    expect(out.kind).toBe("absent");
    expect(out.kind === "absent" ? out.why : "").toContain("%9999");
  });

  it("refuses a listing of a different tmux server even when a pane matches", () => {
    // The two checks fail differently and this is why both exist: pane handles
    // come round again across servers, so `%2282` can be genuinely present in a
    // listing that is nonetheless of another world.
    const out = selfCheck(PANES, 999999, { TMUX: "/tmp/tmux-1000/default,132280,2279", TMUX_PANE: "%2282" });
    expect(out.kind).toBe("absent");
    expect(out.kind === "absent" ? out.why : "").toContain("different world");
  });

  it("says it cannot check rather than failing when not under tmux", () => {
    // Every test in this file runs outside tmux, and so does anyone running the
    // collector from a shell. An alarm nobody can clear is one somebody deletes
    // — the `/logs/` lesson from worktree-check.ts.
    for (const env of [{}, { TMUX: "x" }, { TMUX_PANE: "%1" }, { TMUX: "", TMUX_PANE: "" }]) {
      expect(selfCheck(PANES, 132280, env).kind, JSON.stringify(env)).toBe("cannot-check");
    }
  });

  it("does not compare against a server pid it could not read", () => {
    // `tmuxServerPid` is null on a busy box (the `display-message` times out),
    // and a null must not become "your server does not match". Falls through to
    // the pane check, which still passes.
    expect(selfCheck(PANES, null, { TMUX: "/tmp/tmux-1000/default,132280,2279", TMUX_PANE: "%2282" }).kind).toBe(
      "present",
    );
  });

  it("reads the SERVER pid out of TMUX, not the socket or the session index", () => {
    // `TMUX` is `<socket>,<server pid>,<session index>`, and picking the wrong
    // field is the mutation this control would otherwise survive — the peer's
    // probe had exactly this shape of bug, matching `ppid` where it meant `pid`.
    // Field 0 is a path and field 2 is a session index that is also a plausible
    // small number, so both would compare unequal and refuse everything.
    expect(selfCheck(PANES, 2279, { TMUX: "/tmp/tmux-1000/default,132280,2279", TMUX_PANE: "%2282" }).kind).toBe(
      "absent",
    );
    expect(selfCheck(PANES, 132280, { TMUX: "/tmp/tmux-1000/default,132280,2279", TMUX_PANE: "%2282" }).kind).toBe(
      "present",
    );
  });

  /**
   * A CONTROL ON THE CONTROL, and the reason it exists is the peer's second
   * mutation rather than my own thinking.
   *
   * Their probe's control had a default that could silently become `1`, because
   * every test passed the pid explicitly and so the default could rot while the
   * suite stayed green. **Every test above passes `selfCheck` an explicit
   * env**, which means all six of them would keep passing if `collect()` were
   * changed to hand it `{}` — the check would then answer `cannot-check`
   * forever, in production only, and the tests would say it worked.
   *
   * There is no seam to inject here: the wiring IS the thing under test. So this
   * reads the source, which is the same trick `tests/fleet-rename-route.test.ts`
   * uses for the half of a tmux invocation a fake cannot see. It is a weaker
   * assertion than a behavioural one and it is the strongest available.
   */
  it("wires the real environment into the check, not an empty one", () => {
    const src = readFileSync(path.join(import.meta.dirname, "..", "tools", "fleet", "collect.ts"), "utf8");
    expect(src).toContain("selfCheck(listing.panes, listing.tmuxServerPid, process.env)");
    // And that its verdict is acted on rather than computed and dropped — the
    // failure this whole family of checks keeps having.
    expect(src).toMatch(/if \(self\.kind === "absent"\) throw new Error/);
  });

  it("refuses a collection the tmux server restarted through — Sol's F16", () => {
    // A collection is not one command: the sessions come from a bash script
    // that takes 8–12s, the panes and the generation from a `list-panes`
    // afterwards. A tmux restart in between joins old sessions to new pane
    // handles — `$1643` and `%1646` come round again — and stamps the result
    // with the NEW generation, which is the very label that claims the handles
    // are consistent. Every row looks ordinary; nothing errors.
    const why = generationDrift(132280, 999999);
    expect(why).not.toBeNull();
    expect(String(why)).toMatch(/tmux server restarted during this collection/);
    // The positive half: the same generation is not drift, so this cannot pass
    // by the function having become "always refuse".
    expect(generationDrift(132280, 132280)).toBeNull();
  });

  it("treats a generation it could not read as unverifiable, not as drift", () => {
    // A tmux busy enough to time out a `display-message` is exactly the box
    // this tool is for, so "I could not tell" must not blank the dashboard at
    // the moment it is most wanted. The snapshot carries a null
    // `tmuxServerPid`, which already says unverifiable to anything reading it.
    expect(generationDrift(null, 132280)).toBeNull();
    expect(generationDrift(132280, null)).toBeNull();
    expect(generationDrift(null, null)).toBeNull();
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

describe("collectWithDeadline — a collection that never comes back", () => {
  const snap: FleetSnapshot = {
    rows: [],
    collectedAt: "2026-09-08T03:00:00.000Z",
    tookMs: 12,
    tmuxServerPid: 132280,
  };

  /**
   * THE ONE BEHAVIOUR NO REAL TMUX CAN ARRANGE, and the reason `run` is a
   * parameter. A promise that never settles is what a SIGTERM'd `bash` stuck in
   * uninterruptible IO looks like from here, and it is what stopped the server's
   * refresh loop dead on 2026-09-08 — silently, because nothing threw.
   */
  it("gives up on a promise that never settles, instead of waiting for it", async () => {
    let settled = false;
    const never = () => new Promise<FleetSnapshot>(() => {});
    const caught = await collectWithDeadline(never, 10).then(
      () => {
        settled = true;
        return null;
      },
      (e: unknown) => e as Error,
    );
    expect(settled).toBe(false);
    expect(caught?.message).toContain("has been abandoned");
    // The sentence names the likely cause and warns that any rows on screen are
    // old, because it is what a person reads on a phone at 3am.
    expect(caught?.message).toContain("wedged");
    expect(caught?.message).toContain("previous one");
  });

  it("returns the snapshot untouched when the collection is in time", async () => {
    // The positive half. Without it this passes on a build where the deadline
    // is zero and every collection is abandoned.
    await expect(collectWithDeadline(() => Promise.resolve(snap), 5_000)).resolves.toEqual(snap);
  });

  it("lets the collection's own error through rather than reporting a timeout", async () => {
    // A failure and a hang are different events and the sentence must not blur
    // them: "tmux is not running" is actionable, "abandoned after 120s" is not.
    await expect(collectWithDeadline(() => Promise.reject(new Error("no server running")), 5_000)).rejects.toThrow(
      "no server running",
    );
  });

  it("waits the whole deadline before giving up", async () => {
    // The assertion that stops the deadline being decorative: a race that
    // rejects immediately would pass every test above.
    const began = Date.now();
    await collectWithDeadline(() => new Promise<FleetSnapshot>(() => {}), 60).catch(() => {});
    expect(Date.now() - began).toBeGreaterThanOrEqual(50);
  });
});

/**
 * What a caller that did not look at the attention inbox passes, in as many
 * words.
 *
 * `fleetState`'s attention parameter is REQUIRED rather than defaulted, and
 * this constant is the whole cost of that. The default would have kept these
 * lines shorter and would have preserved the escape hatch that produced the bug
 * v0.6f fixed: a production join that can go missing with nothing going red.
 * state.ts says it at the parameter. Here it is also simply true — none of the
 * tests below reads a checkpoint.
 */
const NOT_ASKED: AttentionFeed = { kind: "not-asked" };

describe("fleetState — the one wire shape", () => {
  const snap: FleetSnapshot = {
    rows: [],
    collectedAt: "2026-09-08T03:00:00.000Z",
    tookMs: 12_000,
    tmuxServerPid: 132280,
  };

  /**
   * A COLLECTOR THAT HAS STOPPED TRYING, TOLD APART FROM A BOX WITH NOTHING TO
   * SAY — the distinction the payload could not make until 2026-09-08.
   *
   * Found in the field, not here: the `orchestrator-setup` session saw
   * `collectedAt` roughly thirty minutes stale with `error: null`. `refreshLoop`
   * chains from the end of each run, so a `collect()` that never SETTLES stops
   * the loop for good and throws nothing on the way out — no error to report,
   * and the last good timestamp left standing. It reads as a calm box.
   *
   * `attemptedAt` is the fact that keeps moving. Fresh with a stale
   * `collectedAt` means *the source is failing*; both stale means *the collector
   * is down*. Those are different events and the Overseer's watchdog acts
   * differently on them.
   */
  it("distinguishes a stalled collector from a quiet box", () => {
    const stale = "2026-09-08T03:00:00.000Z";
    const now = "2026-09-08T03:31:00.000Z";

    // The shape that was indistinguishable from healthy: old data, no error.
    const stalled = fleetState({ ...snap, collectedAt: stale }, null, null, 60_000, true, null, NOT_ASKED);
    expect(stalled.attemptedAt).toBeNull();

    // The same data, with the loop still going round. Same rows, same clock,
    // same null error — and now a reader can tell which of the two it is.
    const trying = fleetState({ ...snap, collectedAt: stale }, null, null, 60_000, true, now, NOT_ASKED);
    expect(trying.collectedAt).toBe(stale);
    expect(trying.error).toBeNull();
    expect(trying.attemptedAt).toBe(now);
    expect(trying.attemptedAt).not.toBe(trying.collectedAt);
  });

  /**
   * THE OLD SERVER MUST NOT LOOK WEDGED, which is the trap that comes with
   * adding a field rather than bumping the schema.
   *
   * Raised by the `orchestrator-setup` session as soon as `attemptedAt` landed,
   * and it is right: their watchdog reads this payload, a server predating the
   * field sends no such key, and "absent" read as "never attempted" reports
   * every old server as permanently stopped — the exact fault the field exists
   * to detect, manufactured by the detector.
   *
   * The ambiguity is recoverable rather than merely declared, and that is the
   * point of the helper. `attemptedAt` is written BEFORE each attempt, so a
   * collection cannot have succeeded without one — data plus no attempt clock
   * therefore means *this producer does not report it*, never *this producer
   * never tried*.
   */
  it("does not mistake a server too old to report attempts for a stopped one", () => {
    const old = {
      collectedAt: "2026-09-08T03:00:00.000Z",
      rows: [],
      // No `attemptedAt` key at all, which is what a pre-2026-09-08 server sends.
    };
    const read = readAttemptClock(old);
    expect(read.kind).toBe("not-reported");
    expect(read.kind === "not-reported" ? read.why : "").toContain("before that field");

    // The three that must NOT collapse into it.
    expect(readAttemptClock({ attemptedAt: "2026-09-08T03:31:00.000Z", collectedAt: "2026-09-08T03:00:00.000Z" })).toEqual({
      kind: "attempted",
      at: "2026-09-08T03:31:00.000Z",
    });
    // A new server, up but not yet round the loop: reports the field as null and
    // has no data. "Never attempted" is the true reading and is not a fault.
    expect(readAttemptClock({ attemptedAt: null, collectedAt: null })).toEqual({ kind: "never-attempted" });
    // A new server whose first attempt failed: attempted, no data. This is the
    // arm that would be lost if the helper keyed off `collectedAt` first.
    expect(readAttemptClock({ attemptedAt: "2026-09-08T03:31:00.000Z", collectedAt: null }).kind).toBe("attempted");
  });

  it("reads a payload this file actually produced, rather than a hand-built one", () => {
    // The round trip, because the helper's whole inference rests on the ORDER
    // `fleetState` writes these in — and a test that only ever saw hand-written
    // objects would keep passing if that ordering assumption stopped holding.
    const live = JSON.parse(
      JSON.stringify(fleetState(snap, null, null, 60_000, true, "2026-09-08T03:31:00.000Z", NOT_ASKED)),
    ) as Record<string, unknown>;
    expect(readAttemptClock(live).kind).toBe("attempted");

    // And the same payload with the field stripped, which is the old server's
    // bytes exactly.
    const { attemptedAt: _dropped, ...withoutField } = live;
    expect(readAttemptClock(withoutField).kind).toBe("not-reported");
  });

  it("says NEVER COLLECTED with a null clock rather than an empty box", () => {
    // The window that matters: a just-restarted dashboard, before the first
    // collection has finished. `rows: []` on its own reads as "nothing is
    // running" — and the Overseer, which folds these into a history, would
    // record thirty-six sessions vanishing at once. The null is the message.
    const s = fleetState(null, null, null, 60_000, false, null, NOT_ASKED);
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
    expect(fleetState(null, null, null, 60_000, false, null, NOT_ASKED).collectedAt).toBeNull();
  });

  it("keeps the previous rows and clock when a refresh failed", () => {
    // Stale-and-labelled beats blank. The page shows the age; a blank page is
    // the one reading nobody investigates.
    const s = fleetState(snap, "tmux: connection refused", null, 60_000, false, null, NOT_ASKED);
    expect(s.collectedAt).toBe(snap.collectedAt);
    expect(s.error).toBe("tmux: connection refused");
  });

  it("carries the refresh interval, so nothing has to guess when it is late", () => {
    // The page flipped to STALE at 30s while the server collected every 60s, so
    // it cried wolf for most of every cycle. A threshold derived from the
    // server's own interval cannot drift away from it.
    expect(fleetState(snap, null, null, 60_000, false, null, NOT_ASKED).refreshMs).toBe(60_000);
  });

  it("tells the page whether answering is switched on, rather than leaving it to guess", () => {
    // The page cannot honestly warn about a server flag it has never been told
    // about: without this it either hedges, or somebody finds out by tapping —
    // and the whole point of the hold is that nobody should tap.
    expect(fleetState(snap, null, null, 60_000, false, null, NOT_ASKED).answeringEnabled).toBe(false);
    expect(fleetState(snap, null, null, 60_000, true, null, NOT_ASKED).answeringEnabled).toBe(true);
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
