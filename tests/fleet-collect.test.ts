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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const { execFileMock, inventoryRunMock } = vi.hoisted(() => {
  const inventory = vi.fn<() => Promise<{ stdout: string; stderr: string }>>();
  const execFile = vi.fn();
  Object.defineProperty(execFile, Symbol.for("nodejs.util.promisify.custom"), { value: inventory });
  return { execFileMock: execFile, inventoryRunMock: inventory };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: execFileMock };
});

import {
  generationNow,
  generationDrift,
  collect,
  panes,
  panesBySession,
  readPanes,
  sessionScript,
  snapshotFrom,
  tmuxServerPid,
  tmuxSocketPath,
  toRows,
  worktreeOf,
  collectWithDeadline,
  selfCheck,
  type FleetSnapshot,
  type SelfAnchor,
} from "../tools/fleet/collect.js";
import { probeOwner, type OwnedOutcome, type ProbeOwner, type ProbeSpec } from "../tools/fleet/child.js";
import { capturePaneAsync } from "../tools/fleet/pane.js";
import { parseBinds } from "../tools/fleet/config.js";
import { readAttemptClock } from "../tools/fleet/attempt-clock.js";
import { fleetState } from "../tools/fleet/state.js";
import type { AccountUsageFeed, AttentionFeed, OverseerStatusFeed, UsageFeed } from "../tools/fleet/wire.js";
import type { FleetStatus } from "../tools/fleet/status.js";
import { buildSessionScript, ROW_COUNT, SESSION_SENTINEL, type Session } from "../scripts/gjd-remote-tmux.js";
import { report as reportCollectBench } from "../scripts/fleet-collect-bench.js";

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
    role: { kind: "none" },
    ...over,
  };
}

function interactiveRows(n: number): ReturnType<typeof toRows> {
  const sessions = Array.from({ length: n }, (_, index) =>
    session({ id: `$${index + 1}`, name: `session-${index + 1}` }));
  return toRows(
    sessions,
    new Map(sessions.map((item) => [item.id, { kind: "working" } as FleetStatus])),
    new Map(sessions.map((item, index) => [item.id, { paneId: `%${index + 1}`, panePid: index + 100 }])),
  );
}

function ownerReturning(outcomeFor: (spec: ProbeSpec) => OwnedOutcome | Promise<OwnedOutcome>): ProbeOwner {
  return {
    run: async (spec) => outcomeFor(spec),
    live: () => [],
  };
}

function permissionWhy(row: ReturnType<typeof toRows>[number]): string {
  if (row.permissionMode.kind !== "cannot-tell") {
    throw new Error(`expected cannot-tell, got ${row.permissionMode.kind}`);
  }
  return row.permissionMode.why;
}

afterEach(() => {
  vi.unstubAllEnvs();
  inventoryRunMock.mockReset();
});

describe("worktreeOf", () => {
  it("names the worktree a session is in", () => {
    expect(worktreeOf("/home/greg/code/spideryarn2/.claude/worktrees/logo-animations")).toBe("logo-animations");
  });

  it("names one under the external root, where every new tree on the box has been since 2026-10-05", () => {
    // It looked for a segment called `worktrees`, so these rows showed the bare repo.
    expect(worktreeOf("/var/tmp/spideryarn-worktrees/bar-reads-profile", {})).toBe("bar-reads-profile");
    expect(worktreeOf("/var/tmp/spideryarn-worktrees/bar-reads-profile/tools/fleet", {})).toBe("bar-reads-profile");
    expect(worktreeOf("/var/tmp/spideryarn-worktrees", {})).toBeNull();
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

  /** The pane anchor reads no file, so a `realpath` that throws is the proof it did not. */
  const realpathMustNotRun = vi.fn((p: string): string => {
    throw new Error(`the pane anchor resolved ${p}`);
  });
  const inPane = (
    panes: typeof PANES,
    tmuxServerPid: number | null,
    env: SelfAnchor["env"],
    socketPath: string | null = null,
  ) => selfCheck({ panes, tmuxServerPid, socketPath }, { env, uid: 1000, realpath: realpathMustNotRun });

  /** A `realpath` over a table: a path that is not in it does not resolve. */
  const resolving = (table: Record<string, string>) =>
    vi.fn((p: string): string => {
      const to = table[p];
      if (to === undefined) throw new Error(`ENOENT: no such file or directory, realpath '${p}'`);
      return to;
    });
  const DEFAULT_SOCKET = "/tmp/tmux-1000/default";
  const outside = (socketPath: string | null, anchor: Partial<SelfAnchor> = {}) =>
    selfCheck(
      { panes: PANES, tmuxServerPid: 132280, socketPath },
      { env: {}, uid: 1000, realpath: resolving({ [DEFAULT_SOCKET]: DEFAULT_SOCKET }), ...anchor },
    );

  it("recognises this box by finding its own pane in the listing", () => {
    expect(inPane(PANES, 132280, { TMUX: "/tmp/tmux-1000/default,132280,2279", TMUX_PANE: "%2282" })).toEqual({
      kind: "present",
      paneId: "%2282",
    });
  });

  it("refuses a listing that does not contain us", () => {
    // The realistic shape: a second tmux server, or a `-S` in a wrapper. Every
    // handle in it is real and belongs to somebody else.
    const out = inPane(PANES, 132280, { TMUX: "/tmp/tmux-1000/default,132280,2279", TMUX_PANE: "%9999" });
    expect(out.kind).toBe("absent");
    expect(out.kind === "absent" ? out.why : "").toContain("%9999");
  });

  it("refuses a listing of a different tmux server even when a pane matches", () => {
    // The two checks fail differently and this is why both exist: pane handles
    // come round again across servers, so `%2282` can be genuinely present in a
    // listing that is nonetheless of another world.
    const out = inPane(PANES, 999999, { TMUX: "/tmp/tmux-1000/default,132280,2279", TMUX_PANE: "%2282" });
    expect(out.kind).toBe("absent");
    expect(out.kind === "absent" ? out.why : "").toContain("different world");
  });

  it("says it cannot check rather than failing when not under tmux", () => {
    // Every test in this file runs outside tmux, and so does anyone running the
    // collector from a shell. An alarm nobody can clear is one somebody deletes
    // — the `/logs/` lesson from worktree-check.ts.
    for (const env of [{}, { TMUX: "x" }, { TMUX_PANE: "%1" }, { TMUX: "", TMUX_PANE: "" }]) {
      expect(inPane(PANES, 132280, env).kind, JSON.stringify(env)).toBe("cannot-check");
    }
  });

  it("does not compare against a server pid it could not read", () => {
    // `tmuxServerPid` is null on a busy box (the `display-message` times out),
    // and a null must not become "your server does not match". Falls through to
    // the pane check, which still passes.
    expect(inPane(PANES, null, { TMUX: "/tmp/tmux-1000/default,132280,2279", TMUX_PANE: "%2282" }).kind).toBe(
      "present",
    );
  });

  it("reads the SERVER pid out of TMUX, not the socket or the session index", () => {
    // `TMUX` is `<socket>,<server pid>,<session index>`, and picking the wrong
    // field is the mutation this control would otherwise survive — the peer's
    // probe had exactly this shape of bug, matching `ppid` where it meant `pid`.
    // Field 0 is a path and field 2 is a session index that is also a plausible
    // small number, so both would compare unequal and refuse everything.
    expect(inPane(PANES, 2279, { TMUX: "/tmp/tmux-1000/default,132280,2279", TMUX_PANE: "%2282" }).kind).toBe(
      "absent",
    );
    expect(inPane(PANES, 132280, { TMUX: "/tmp/tmux-1000/default,132280,2279", TMUX_PANE: "%2282" }).kind).toBe(
      "present",
    );
  });

  it("touches no file when both TMUX and TMUX_PANE are set, whatever socket the listing names", () => {
    realpathMustNotRun.mockClear();
    const env = { TMUX: "/tmp/tmux-1000/default,132280,2279", TMUX_PANE: "%2282" };
    expect(inPane(PANES, 132280, env, "/tmp/tmux-1000/some-other-sock")).toEqual({ kind: "present", paneId: "%2282" });
    expect(realpathMustNotRun).not.toHaveBeenCalled();
  });

  it("keeps cannot-check for TMUX without TMUX_PANE, and does not fall back to the default socket", () => {
    // tmux picks its socket from `TMUX` alone, so a process with a named
    // server in `TMUX` and no pane is correctly reading that server. Comparing
    // it with `default` would refuse it. Sol's F2 on plan 261006h.
    realpathMustNotRun.mockClear();
    const out = inPane(PANES, 1234, { TMUX: "/tmp/tmux-1000/s3a-sock,1234,0" }, "/tmp/tmux-1000/s3a-sock");
    expect(out.kind).toBe("cannot-check");
    expect(out.kind === "cannot-check" ? out.why : "").toContain("TMUX_PANE");
    expect(realpathMustNotRun).not.toHaveBeenCalled();
  });

  /**
   * THE ANCHOR FOR A PROCESS THAT IS NOT IN A PANE — the systemd service, which
   * answered `cannot-check` on every collection for four weeks (postmortem
   * 260910b, plan 261006h). Used only when `TMUX` is absent or empty.
   */
  it("recognises this box by the default socket when not under tmux", () => {
    expect(outside(DEFAULT_SOCKET)).toEqual({ kind: "socket-matches", socketPath: DEFAULT_SOCKET });
    // An empty `TMUX` is an absent one.
    expect(outside(DEFAULT_SOCKET, { env: { TMUX: "" } }).kind).toBe("socket-matches");
  });

  it("refuses a listing read from another socket, naming both", () => {
    const realpath = resolving({ [DEFAULT_SOCKET]: DEFAULT_SOCKET, "/tmp/tmux-1000/s3a-sock": "/tmp/tmux-1000/s3a-sock" });
    const out = outside("/tmp/tmux-1000/s3a-sock", { realpath });
    expect(out.kind).toBe("absent");
    const why = out.kind === "absent" ? out.why : "";
    expect(why).toContain("/tmp/tmux-1000/s3a-sock");
    expect(why).toContain(DEFAULT_SOCKET);
  });

  it("cannot check a listing that carried no socket path", () => {
    const out = outside(null);
    expect(out.kind).toBe("cannot-check");
    expect(out.kind === "cannot-check" ? out.why : "").toContain("socket");
  });

  it("cannot check when the uid cannot be read", () => {
    const out = outside(DEFAULT_SOCKET, { uid: undefined });
    expect(out.kind).toBe("cannot-check");
    expect(out.kind === "cannot-check" ? out.why : "").toContain("uid");
  });

  it("cannot check, rather than refusing, when either path does not resolve", () => {
    // A socket removed after the listing was read must not become a wrong-box
    // refusal: `absent` is for two resolved paths that differ. Sol's F3.
    const listedGone = outside("/tmp/tmux-1000/gone");
    expect(listedGone.kind).toBe("cannot-check");
    expect(listedGone.kind === "cannot-check" ? listedGone.why : "").toContain("/tmp/tmux-1000/gone");

    const expectedGone = outside("/elsewhere/sock", { realpath: resolving({ "/elsewhere/sock": "/elsewhere/sock" }) });
    expect(expectedGone.kind).toBe("cannot-check");
    expect(expectedGone.kind === "cannot-check" ? expectedGone.why : "").toContain(DEFAULT_SOCKET);
  });

  it("treats two names for one socket as the same socket", () => {
    // macOS reports `/private/tmp/…` for what the environment calls `/tmp/…`.
    const realpath = resolving({
      [DEFAULT_SOCKET]: "/private/tmp/tmux-1000/default",
      "/private/tmp/tmux-1000/default": "/private/tmp/tmux-1000/default",
    });
    expect(outside("/private/tmp/tmux-1000/default", { realpath })).toEqual({
      kind: "socket-matches",
      socketPath: "/private/tmp/tmux-1000/default",
    });
  });

  it("looks for the default socket under TMUX_TMPDIR when that is set", () => {
    const realpath = resolving({
      "/run/user/1000/tmux-1000/default": "/run/user/1000/tmux-1000/default",
      [DEFAULT_SOCKET]: DEFAULT_SOCKET,
    });
    const env = { TMUX_TMPDIR: "/run/user/1000" };
    expect(outside("/run/user/1000/tmux-1000/default", { env, realpath }).kind).toBe("socket-matches");
    // And the `/tmp` one is then the wrong socket, not the right one.
    expect(outside(DEFAULT_SOCKET, { env, realpath }).kind).toBe("absent");
    // tmux ignores an empty TMUX_TMPDIR, so we do too.
    expect(outside(DEFAULT_SOCKET, { env: { TMUX_TMPDIR: "" }, realpath }).kind).toBe("socket-matches");
  });

  it("uses this user's socket directory, not somebody else's", () => {
    const realpath = resolving({ "/tmp/tmux-1001/default": "/tmp/tmux-1001/default", [DEFAULT_SOCKET]: DEFAULT_SOCKET });
    expect(outside("/tmp/tmux-1001/default", { uid: 1001, realpath }).kind).toBe("socket-matches");
    expect(outside(DEFAULT_SOCKET, { uid: 1001, realpath }).kind).toBe("absent");
  });

  it("reads the socket path off the same listing, as the fifth and last field", () => {
    expect(
      tmuxSocketPath("$1 %10 100 132280 /tmp/tmux-1000/default\n$2 %20 200 132280 /tmp/tmux-1000/default\n"),
    ).toBe("/tmp/tmux-1000/default");
    // The fifth field does not disturb the four before it.
    const withSocket = "$1 %10 100 132280 /tmp/tmux-1000/default\n";
    expect(tmuxServerPid(withSocket)).toBe(132280);
    expect(panesBySession(withSocket).get("$1")).toEqual({ paneId: "%10", panePid: 100 });
  });

  it("keeps a socket path with a space in it whole", () => {
    expect(tmuxSocketPath("$1 %10 100 132280 /tmp/my tmp/tmux-1000/default\n")).toBe("/tmp/my tmp/tmux-1000/default");
  });

  it("is null about the socket rather than taking another field for it", () => {
    expect(tmuxSocketPath("")).toBeNull();
    expect(tmuxSocketPath("$1 %10 100 132280\n")).toBeNull();
    expect(tmuxSocketPath("$1 %10 100 132280 \n")).toBeNull();
    // The pid field is what a swapped index would return.
    expect(tmuxSocketPath("$1 %10 100\n")).toBeNull();
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

describe("owned tmux probes", () => {
  it("no longer says the systemd dashboard cannot be checked", () => {
    // It could not, from 2026-09-08 until the socket anchor (plan 261006h), and
    // two comments went on saying so after that stopped being the plan.
    const src = readFileSync(path.join(import.meta.dirname, "..", "tools", "fleet", "collect.ts"), "utf8");

    expect(src).not.toContain("`selfCheck` returns `cannot-check`");
    expect(src).not.toContain("is a separate decision");
    expect(src).not.toContain("runs under `tmux-job.ts` in\n * production");
  });

  it("wires collect through the asynchronous tmux probes", () => {
    const src = readFileSync(path.join(import.meta.dirname, "..", "tools", "fleet", "collect.ts"), "utf8");

    expect(src).not.toMatch(/^import .*\b(?:execFileSync|spawnSync)\b.*from "node:child_process";/m);
    expect(src).toContain("const generationBefore = await generationNow(owner)");
    expect(src).toContain("const listing = await panes(owner)");
    expect(src).toContain("await readPanes(rows, (paneId) => capturePaneAsync(owner, paneId))");
    expect(src).toContain("await readExecutions(rows, { probe: () => probeProcessTableAsync(owner) })");
  });

  it("finishes the other captures when one owner call reports a bounded timeout", async () => {
    const rows = interactiveRows(6);
    const completedBeforeSlow: string[] = [];
    let slowFinished = false;
    const owner = ownerReturning(async (spec) => {
      if (spec.key !== "capture-pane:%1") {
        if (!slowFinished) completedBeforeSlow.push(spec.key);
        return { kind: "ok", stdout: "", stderr: "", tookMs: 1 };
      }

      /* The child-side operation never settles; the owner is the boundary that
         releases its caller. This is the failure a real SIGKILL cannot arrange
         reliably in a test, and the same seam child.test.ts uses for it. */
      const never = new Promise<OwnedOutcome>(() => {});
      const bound = new Promise<OwnedOutcome>((resolve) => {
        setTimeout(() => {
          slowFinished = true;
          resolve({
            kind: "timed-out",
            why: `probe "${spec.key}" reached its 10ms deadline`,
            tookMs: 12,
            pid: 4312,
            exitObserved: false,
          });
        }, 10);
      });
      return Promise.race([never, bound]);
    });

    const startedAt = Date.now();
    await readPanes(rows, (paneId) => capturePaneAsync(owner, paneId));

    expect(slowFinished).toBe(true);
    expect(completedBeforeSlow).toHaveLength(5);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(rows[0]?.permissionMode).toMatchObject({ kind: "cannot-tell" });
    expect(permissionWhy(rows[0] as ReturnType<typeof toRows>[number])).toContain("timed-out");
    expect(permissionWhy(rows[0] as ReturnType<typeof toRows>[number])).toContain("4312");
    expect(rows.slice(1).every((row) => permissionWhy(row) !== "this session's pane has not been read yet")).toBe(true);
  });

  it("drives a slow capture through the real owner and releases the other panes", async () => {
    const rows = interactiveRows(6);
    const realOwner = probeOwner();
    const completed: string[] = [];
    const owner: ProbeOwner = {
      run: async (spec) => {
        const slow = spec.key === "capture-pane:%1";
        const outcome = await realOwner.run({
          ...spec,
          cmd: slow ? "sleep" : "true",
          args: slow ? ["10"] : [],
          timeoutMs: slow ? 20 : 1_000,
          graceMs: 20,
        });
        if (!slow && outcome.kind === "ok") completed.push(spec.key);
        return outcome;
      },
      live: realOwner.live,
    };

    const startedAt = Date.now();
    await readPanes(rows, (paneId) => capturePaneAsync(owner, paneId));

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(completed).toHaveLength(5);
    expect(permissionWhy(rows[0] as ReturnType<typeof toRows>[number])).toMatch(/timed-out.*child pid/);
    await vi.waitFor(() => expect(realOwner.live()).toHaveLength(0), { timeout: 2_000 });
  });

  it("puts a refused child's pid and age in a different reason from an ordinary failure", async () => {
    const rows = interactiveRows(2);
    const owner = ownerReturning((spec) =>
      spec.key === "capture-pane:%1"
        ? {
            kind: "refused",
            why: `probe "${spec.key}" was refused because its previous child is still live`,
            pid: 8123,
            liveForMs: 7_500,
          }
        : {
            kind: "failed",
            why: "tmux exited with code 1: no such pane",
            tookMs: 3,
            exitCode: 1,
            signal: null,
          });

    await readPanes(rows, (paneId) => capturePaneAsync(owner, paneId));

    expect(permissionWhy(rows[0] as ReturnType<typeof toRows>[number])).toMatch(/refused.*8123.*7500ms/);
    expect(permissionWhy(rows[1] as ReturnType<typeof toRows>[number])).toContain("tmux exited with code 1");
    expect(permissionWhy(rows[1] as ReturnType<typeof toRows>[number])).not.toContain("8123");
  });

  it("runs at most four captures at once and still reads all rows", async () => {
    const rows = interactiveRows(11);
    const seen: string[] = [];
    let active = 0;
    let highWater = 0;

    await readPanes(rows, async (paneId) => {
      seen.push(paneId);
      active += 1;
      highWater = Math.max(highWater, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return "";
    });

    expect(highWater).toBe(4);
    expect(seen).toHaveLength(11);
    expect(new Set(seen).size).toBe(11);
    expect(rows.every((row) => permissionWhy(row) !== "this session's pane has not been read yet")).toBe(true);
  });

  it("distinguishes a timed-out pane listing from one that was read and empty", async () => {
    const specs: ProbeSpec[] = [];
    const owner = ownerReturning((spec) => {
      specs.push(spec);
      return {
        kind: "timed-out",
        why: `probe "${spec.key}" reached its deadline`,
        tookMs: spec.timeoutMs + 1_000,
        pid: 9911,
        exitObserved: false,
      };
    });

    const [listing, generation] = await Promise.all([panes(owner), generationNow(owner)]);

    expect(listing).toEqual({ kind: "unread", why: 'probe "tmux:list-panes" reached its deadline' });
    expect(generation).toBeNull();
    expect(generationDrift(generation, 132280)).toBeNull();
    expect(specs).toEqual(expect.arrayContaining([
      {
        key: "tmux:list-panes",
        cmd: "tmux",
        args: ["list-panes", "-a", "-F", "#{session_id} #{pane_id} #{pane_pid} #{pid} #{socket_path}"],
        timeoutMs: 10_000,
      },
      {
        key: "tmux:generation",
        cmd: "tmux",
        args: ["display-message", "-p", "#{pid}"],
        timeoutMs: 5_000,
      },
    ]));
  });

  it("distinguishes a refused pane listing from one that was read and empty", async () => {
    const asked: string[] = [];
    const owner = ownerReturning((spec) => {
      asked.push(spec.key);
      return {
        kind: "refused",
        why: `probe "${spec.key}" still has an unaccounted child`,
        pid: 9_912,
        liveForMs: 14_000,
      };
    });

    const [listing, generation] = await Promise.all([panes(owner), generationNow(owner)]);

    expect(asked.sort()).toEqual(["tmux:generation", "tmux:list-panes"]);
    expect(listing).toEqual({ kind: "unread", why: 'probe "tmux:list-panes" still has an unaccounted child' });
    expect(generation).toBeNull();
    expect(generationDrift(132_280, generation)).toBeNull();
  });

  it("reports why an unread pane listing failed instead of calling it another box", async () => {
    inventoryRunMock.mockResolvedValue({ stdout: `${ROW_COUNT} 0\n${SESSION_SENTINEL}`, stderr: "" });
    vi.stubEnv("TMUX", "/tmp/tmux-1000/default,132280,1");
    vi.stubEnv("TMUX_PANE", "%9999");

    const failures: Array<Exclude<OwnedOutcome, { kind: "ok" }>> = [
      {
        kind: "refused",
        why: 'probe "tmux:list-panes" still has child pid 8123 unaccounted for after 7500ms; no second child was started',
        pid: 8123,
        liveForMs: 7_500,
      },
      {
        kind: "timed-out",
        why: 'probe "tmux:list-panes" reached its 10000ms deadline; child pid 8124 did not exit',
        tookMs: 11_000,
        pid: 8124,
        exitObserved: false,
      },
      {
        kind: "failed",
        why: "tmux exited with code 1: server busy",
        tookMs: 4,
        exitCode: 1,
        signal: null,
      },
    ];

    for (const failure of failures) {
      const owner = ownerReturning((spec) =>
        spec.key === "tmux:generation"
          ? { kind: "ok", stdout: "132280\n", stderr: "", tookMs: 1 }
          : failure);
      const error = await collect(owner).then(
        () => null,
        (cause: unknown) => cause instanceof Error ? cause : new Error(String(cause)),
      );
      expect(error?.message).toContain("pane listing");
      expect(error?.message).toContain(failure.why);
      expect(error?.message).not.toContain("not a listing of this box");
    }
  });

  it("still lets selfCheck refuse a pane listing that was read but does not contain us", async () => {
    inventoryRunMock.mockResolvedValue({ stdout: `${ROW_COUNT} 0\n${SESSION_SENTINEL}`, stderr: "" });
    vi.stubEnv("TMUX", "/tmp/tmux-1000/default,132280,1");
    vi.stubEnv("TMUX_PANE", "%9999");
    const owner = ownerReturning((spec) => ({
      kind: "ok",
      stdout: spec.key === "tmux:generation" ? "132280\n" : "$1 %1 100 132280\n",
      stderr: "",
      tookMs: 1,
    }));

    await expect(collect(owner)).rejects.toThrow("not a listing of this box");
  });

  /**
   * `collect()` WIRED TO THE CHECK, BY CALLING IT. This replaced a test that
   * grepped collect.ts for the call, which was the strongest thing available
   * while `collect()` read `process.env` itself — postmortem 260910b, item 2.
   */
  const emptyBox = (listPanes: string): ProbeOwner => {
    inventoryRunMock.mockResolvedValue({ stdout: `${ROW_COUNT} 0\n${SESSION_SENTINEL}`, stderr: "" });
    return ownerReturning((spec) => ({
      kind: "ok",
      stdout: spec.key === "tmux:generation" ? "132280\n" : spec.key === "tmux:list-panes" ? listPanes : "",
      stderr: "",
      tookMs: 1,
    }));
  };
  const sameFile = (p: string): string => p;

  it("publishes the verdict it reached, on the snapshot", async () => {
    const snap = await collect(emptyBox("$1 %1 100 132280 /tmp/tmux-1000/default\n"), {
      env: {},
      uid: 1000,
      realpath: sameFile,
    });
    expect(snap.selfCheck).toEqual({ kind: "socket-matches", socketPath: "/tmp/tmux-1000/default" });
  });

  it("refuses a listing from another socket when it is not under tmux", async () => {
    await expect(
      collect(emptyBox("$1 %1 100 132280 /tmp/tmux-1000/s3a-sock\n"), { env: {}, uid: 1000, realpath: sameFile }),
    ).rejects.toThrow(/not a listing of this box.*s3a-sock/);
  });

  it("uses the anchor it was handed, not the process's own", async () => {
    // The anchor says pane %9999, so that is what is looked for, whatever pane this test runs in.
    await expect(
      collect(emptyBox("$1 %1 100 132280 /tmp/tmux-1000/default\n"), {
        env: { TMUX: "/tmp/tmux-1000/default,132280,1", TMUX_PANE: "%9999" },
        uid: 1000,
        realpath: sameFile,
      }),
    ).rejects.toThrow("not a listing of this box");
  });

  describe("with its production defaults", () => {
    let dir = "";
    afterEach(() => {
      if (dir !== "") rmSync(dir, { recursive: true, force: true });
      dir = "";
    });

    /** A stand-in default socket for this uid under a temp `TMUX_TMPDIR` that is a symlink. */
    function standInSockets(): { real: string; other: string } {
      dir = mkdtempSync(path.join(os.tmpdir(), "fleet-selfcheck-"));
      const uid = process.getuid?.();
      if (uid === undefined) throw new Error("this test needs a uid");
      const real = path.join(dir, "real dir");
      mkdirSync(path.join(real, `tmux-${uid}`), { recursive: true });
      writeFileSync(path.join(real, `tmux-${uid}`, "default"), "");
      writeFileSync(path.join(real, `tmux-${uid}`, "other"), "");
      symlinkSync(real, path.join(dir, "link"));
      vi.stubEnv("TMUX", "");
      vi.stubEnv("TMUX_TMPDIR", path.join(dir, "link"));
      return {
        real: path.join(real, `tmux-${uid}`, "default"),
        other: path.join(real, `tmux-${uid}`, "other"),
      };
    }

    it("reads the real environment, uid and filesystem", async () => {
      // The expected path goes through the symlink and the listed one does not,
      // so only a real `realpath` on the real uid's directory makes them equal.
      const { real } = standInSockets();
      const snap = await collect(emptyBox(`$1 %1 100 132280 ${real}\n`));
      expect(snap.selfCheck.kind).toBe("socket-matches");
    });

    it("and refuses on them", async () => {
      const { other } = standInSockets();
      await expect(collect(emptyBox(`$1 %1 100 132280 ${other}\n`))).rejects.toThrow("not a listing of this box");
    });
  });
});

describe("the collection bench refuses flattering HTTP evidence", () => {
  it("fails a balanced run with no samples or with failed requests", () => {
    const previousExitCode = process.exitCode;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      for (const http of [
        { latencies: [], failures: 0, pending: [], issued: 0 },
        { latencies: [4, 5], failures: 1, pending: [], issued: 3 },
        { latencies: [4, 5], failures: 0, pending: [], issued: 3 },
      ]) {
        process.exitCode = undefined;
        reportCollectBench("test", [], http, []);
        expect(process.exitCode).toBe(3);
      }

      // The positive control: complete, non-empty evidence must remain usable.
      process.exitCode = undefined;
      reportCollectBench("test", [], { latencies: [4, 5, 6], failures: 0, pending: [], issued: 3 }, []);
      expect(process.exitCode).toBeUndefined();
    } finally {
      log.mockRestore();
      process.exitCode = previousExitCode;
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
    selfCheck: { kind: "socket-matches", socketPath: "/tmp/tmux-1000/default" },
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

/** The same, for the Overseer's own status: none of these tests read a checkpoint either. */
const NO_OVERSEER: OverseerStatusFeed = { kind: "not-asked" };

/** And the same for the account's usage, the third projection out of that same unread checkpoint. */
const NO_USAGE: UsageFeed = { kind: "not-asked" };

/** The fourth: one section per account-subscription, which these tests also do not read. */
const NO_ACCOUNT_USAGE: AccountUsageFeed = { kind: "not-asked" };

describe("fleetState — the one wire shape", () => {
  const snap: FleetSnapshot = {
    rows: [],
    collectedAt: "2026-09-08T03:00:00.000Z",
    tookMs: 12_000,
    tmuxServerPid: 132280,
    selfCheck: { kind: "socket-matches", socketPath: "/tmp/tmux-1000/default" },
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
    const stalled = fleetState({ ...snap, collectedAt: stale }, null, null, 60_000, true, null, NOT_ASKED, NO_OVERSEER, NO_USAGE, NO_ACCOUNT_USAGE, { kind: "checkpoint-absent" }, { instance: "1a2b3c4d", publication: 1, inventory: 1 });
    expect(stalled.attemptedAt).toBeNull();

    // The same data, with the loop still going round. Same rows, same clock,
    // same null error — and now a reader can tell which of the two it is.
    const trying = fleetState({ ...snap, collectedAt: stale }, null, null, 60_000, true, now, NOT_ASKED, NO_OVERSEER, NO_USAGE, NO_ACCOUNT_USAGE, { kind: "checkpoint-absent" }, { instance: "1a2b3c4d", publication: 1, inventory: 1 });
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
      JSON.stringify(fleetState(snap, null, null, 60_000, true, "2026-09-08T03:31:00.000Z", NOT_ASKED, NO_OVERSEER, NO_USAGE, NO_ACCOUNT_USAGE, { kind: "checkpoint-absent" }, { instance: "1a2b3c4d", publication: 1, inventory: 1 })),
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
    const s = fleetState(null, null, null, 60_000, false, null, NOT_ASKED, NO_OVERSEER, NO_USAGE, NO_ACCOUNT_USAGE, { kind: "checkpoint-absent" }, { instance: "1a2b3c4d", publication: 0, inventory: null });
    expect(s.collectedAt).toBeNull();
    expect(s.rows).toEqual([]);
    expect(s.error).toBeNull();
  });

  it("serves the this-box verdict the snapshot carries, through JSON", () => {
    // Computed and dropped for four weeks: nothing said the check was answering
    // `cannot-check` on every collection. Postmortem 260910b, item 3.
    const s = fleetState(snap, null, null, 60_000, false, null, NOT_ASKED, NO_OVERSEER, NO_USAGE, NO_ACCOUNT_USAGE, { kind: "checkpoint-absent" }, { instance: "1a2b3c4d", publication: 1, inventory: 1 });
    expect((JSON.parse(JSON.stringify(s)) as { selfCheck: unknown }).selfCheck).toEqual({
      kind: "socket-matches",
      socketPath: "/tmp/tmux-1000/default",
    });
  });

  it("says not-collected, not a verdict, before the first collection", () => {
    const s = fleetState(null, null, null, 60_000, false, null, NOT_ASKED, NO_OVERSEER, NO_USAGE, NO_ACCOUNT_USAGE, { kind: "checkpoint-absent" }, { instance: "1a2b3c4d", publication: 0, inventory: null });
    expect(s.selfCheck).toEqual({ kind: "not-collected" });
  });

  it("keeps the retained rows' verdict when a later collection was refused", () => {
    // The verdict describes the rows on the page; the refused attempt is `error`.
    const s = fleetState(snap, "this is not a listing of this box: …", null, 60_000, false, null, NOT_ASKED, NO_OVERSEER, NO_USAGE, NO_ACCOUNT_USAGE, { kind: "checkpoint-absent" }, { instance: "1a2b3c4d", publication: 2, inventory: 1 });
    expect(s.selfCheck.kind).toBe("socket-matches");
    expect(s.error).toContain("not a listing of this box");
  });

  it("never invents a timestamp for a collection that did not happen", () => {
    // `?? new Date().toISOString()` is the tempting version, for a caller that
    // wants a string. It is a lie with a clock on it: it says "we looked just
    // now and found nothing".
    // Asserted as `toBeNull`, not as `not.toBeString`: a negative assertion is
    // satisfied by undefined, by 0, and by the field disappearing altogether,
    // so it would go on passing through exactly the change it is meant to catch.
    expect(fleetState(null, null, null, 60_000, false, null, NOT_ASKED, NO_OVERSEER, NO_USAGE, NO_ACCOUNT_USAGE, { kind: "checkpoint-absent" }, { instance: "1a2b3c4d", publication: 0, inventory: null }).collectedAt).toBeNull();
  });

  it("keeps the previous rows and clock when a refresh failed", () => {
    // Stale-and-labelled beats blank. The page shows the age; a blank page is
    // the one reading nobody investigates.
    const s = fleetState(snap, "tmux: connection refused", null, 60_000, false, null, NOT_ASKED, NO_OVERSEER, NO_USAGE, NO_ACCOUNT_USAGE, { kind: "checkpoint-absent" }, { instance: "1a2b3c4d", publication: 2, inventory: 1 });
    expect(s.collectedAt).toBe(snap.collectedAt);
    expect(s.error).toBe("tmux: connection refused");
  });

  it("carries the refresh interval, so nothing has to guess when it is late", () => {
    // The page flipped to STALE at 30s while the server collected every 60s, so
    // it cried wolf for most of every cycle. A threshold derived from the
    // server's own interval cannot drift away from it.
    expect(fleetState(snap, null, null, 60_000, false, null, NOT_ASKED, NO_OVERSEER, NO_USAGE, NO_ACCOUNT_USAGE, { kind: "checkpoint-absent" }, { instance: "1a2b3c4d", publication: 1, inventory: 1 }).refreshMs).toBe(60_000);
  });

  it("tells the page whether answering is switched on, rather than leaving it to guess", () => {
    // The page cannot honestly warn about a server flag it has never been told
    // about: without this it either hedges, or somebody finds out by tapping —
    // and the whole point of the hold is that nobody should tap.
    expect(fleetState(snap, null, null, 60_000, false, null, NOT_ASKED, NO_OVERSEER, NO_USAGE, NO_ACCOUNT_USAGE, { kind: "checkpoint-absent" }, { instance: "1a2b3c4d", publication: 1, inventory: 1 }).answeringEnabled).toBe(false);
    expect(fleetState(snap, null, null, 60_000, true, null, NOT_ASKED, NO_OVERSEER, NO_USAGE, NO_ACCOUNT_USAGE, { kind: "checkpoint-absent" }, { instance: "1a2b3c4d", publication: 1, inventory: 1 }).answeringEnabled).toBe(true);
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
      { kind: "read", panes: new Map([["$7", { paneId: "%70", panePid: 700 }]]), tmuxServerPid: 132280, socketPath: null },
      { kind: "present", paneId: "%70" },
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
    expect(round.selfCheck).toEqual({ kind: "present", paneId: "%70" });
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
      snapshotFrom(
        parsed,
        { kind: "read", panes: new Map(), tmuxServerPid: null, socketPath: null },
        { kind: "cannot-check", why: "a fixture" },
        5,
      ).rows[0]?.status.kind,
    ).toBe("unknown");
  });
});
