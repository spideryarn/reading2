/**
 * **`scripts/fleet-restart.ts`, and the ways a restart tool lies to you.**
 *
 * The shell prototype this replaces had a real bug of a familiar shape: its
 * checks were `[ "$a" = "$b" ] && echo MATCH || echo MISMATCH` lines with no
 * exit status, so a check that could not run printed something reassuring and
 * the script carried on — docs/reusable/silent-success.md, in the one tool
 * whose entire value is telling you the truth about a service you cannot see.
 *
 * So most of what is asserted here is the *negative* half of each check: what
 * it says when it cannot tell, and that it does not say `pass`. Every judgment
 * is tested from both sides, because a test that only ever feeds a check the
 * input it likes cannot tell a check from a `return "pass"`.
 *
 * The last block is the different kind: it runs the REAL `main` against a fake
 * world and asserts the argv that come out of it, because injected fakes cannot
 * see whether the real thing is wired together — two guards in this repo have
 * had imaginary coverage that way.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PORT,
  EXIT_OK,
  EXIT_REFUSED,
  EXIT_RESTART_FAILED,
  EXIT_UNVERIFIED,
  SHOW_PROPERTIES,
  UNIT,
  blocks,
  bundleRef,
  claimState,
  judgeActive,
  judgeBehind,
  judgeBranch,
  judgeBundle,
  judgeDirty,
  judgeFlapping,
  judgeListener,
  judgeOverseerClaim,
  judgePortIsFree,
  judgeQueue,
  judgeReplaced,
  judgeStable,
  type GitRead,
  parseCgroupProcs,
  parseEnvironment,
  parseListeners,
  parseShow,
  readUnit,
  renderReport,
  resolvePort,
  summariseQueues,
} from "../scripts/fleet-restart-plan.js";
import { type Io, main } from "../scripts/fleet-restart.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ *
 * The unit, and what it refuses to guess
 * ------------------------------------------------------------------ */

const SHOW_OK = [
  "LoadState=loaded",
  "ActiveState=active",
  "SubState=running",
  "FragmentPath=/etc/systemd/system/fleet-dashboard.service",
  "WorkingDirectory=/home/greg/code/spideryarn2",
  "ControlGroup=/system.slice/fleet-dashboard.service",
  "MainPID=4095037",
  "NRestarts=0",
  "Environment=HOME=/home/greg FLEET_BIND=127.0.0.1",
].join("\n");

describe("reading the unit", () => {
  it("takes the facts out of real systemctl show output", () => {
    const read = readUnit(parseShow(SHOW_OK));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.facts.workDir).toBe("/home/greg/code/spideryarn2");
    expect(read.facts.mainPid).toBe(4095037);
    expect(read.facts.controlGroup).toBe("/system.slice/fleet-dashboard.service");
  });

  /**
   * `systemctl show` answers for a unit that does not exist, with
   * `LoadState=not-found` and nothing else. A tool that read that as "no
   * WorkingDirectory, use the default" would then compare a bundle in a
   * directory the unit has never served, and say MATCH.
   */
  it("refuses a unit systemd has not loaded", () => {
    const read = readUnit(parseShow("LoadState=not-found\nActiveState=inactive"));
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.why).toContain("not-found");
  });

  it("refuses when there is no WorkingDirectory to measure anything against", () => {
    const read = readUnit(parseShow(SHOW_OK.split("\n").filter((l) => !l.startsWith("WorkingDirectory=")).join("\n")));
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.why).toContain("WorkingDirectory");
  });

  it("refuses a WorkingDirectory that is not an absolute path", () => {
    expect(readUnit(parseShow(SHOW_OK.replace("WorkingDirectory=/home/greg/code/spideryarn2", "WorkingDirectory=code/spideryarn2"))).ok).toBe(false);
  });

  /**
   * NRestarts is not on every systemd, and its absence must not read as zero:
   * that turns "we cannot see a crash loop" into "there is no crash loop".
   */
  it("keeps an absent NRestarts as not-a-number rather than zero", () => {
    const read = readUnit(parseShow(SHOW_OK.split("\n").filter((l) => !l.startsWith("NRestarts=")).join("\n")));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(Number.isNaN(read.facts.restarts)).toBe(true);
    expect(judgeFlapping(read.facts.restarts, read.facts.restarts).verdict).toBe("unknown");
  });
});

describe("the port", () => {
  it("uses the default when the unit declares none", () => {
    const read = resolvePort(parseEnvironment("HOME=/home/greg FLEET_BIND=127.0.0.1"));
    expect(read).toMatchObject({ ok: true, port: DEFAULT_PORT });
  });

  it("prefers what the unit declares", () => {
    expect(resolvePort(parseEnvironment("FLEET_PORT=9999"))).toMatchObject({ ok: true, port: 9999 });
  });

  /** Falling back to 8787 here would check a port the service is not on. */
  it("refuses a declared FLEET_PORT it cannot use, rather than falling back", () => {
    expect(resolvePort(parseEnvironment('FLEET_PORT="not-a-port"')).ok).toBe(false);
  });

  it("unquotes a systemd-quoted value", () => {
    expect(parseEnvironment('A=1 B="two words" C=3')).toEqual({ A: "1", B: "two words", C: "3" });
  });

  /**
   * systemd quotes the WHOLE assignment as readily as the value. The first
   * version split on the `=` inside the quotes and produced the key
   * `"FLEET_PORT` — so a declared port silently became the default, and every
   * check afterwards described a port the service was not on. GPT Sol, 2026-09-09.
   */
  it("reads a port declared as a whole quoted assignment", () => {
    expect(parseEnvironment('HOME=/home/greg "FLEET_PORT=9999"')).toMatchObject({ FLEET_PORT: "9999" });
    expect(resolvePort(parseEnvironment('"FLEET_PORT=9999"'))).toMatchObject({ ok: true, port: 9999 });
  });
});

/* ------------------------------------------------------------------ *
 * The bundle
 * ------------------------------------------------------------------ */

describe("the bundle", () => {
  const html = (name: string) => `<!doctype html><script type="module" crossorigin src="/assets/${name}"></script>`;

  it("passes when the served page names the bundle the build named", () => {
    expect(judgeBundle(bundleRef(html("index-CafjCvVA.js")), bundleRef(html("index-CafjCvVA.js"))).verdict).toBe("pass");
  });

  /** The failure the unit's own comments are about: a newer server, an older page. */
  it("fails when the page is stale", () => {
    const check = judgeBundle(bundleRef(html("index-NEW.js")), bundleRef(html("index-OLD.js")));
    expect(check.verdict).toBe("fail");
    expect(check.detail).toContain("stale");
  });

  it("is unknown, never a pass, when either side names no bundle", () => {
    expect(judgeBundle({ kind: "none" }, bundleRef(html("index-a.js"))).verdict).toBe("unknown");
    expect(judgeBundle(bundleRef(html("index-a.js")), { kind: "none" }).verdict).toBe("unknown");
  });

  /**
   * The first version matched the first `index-*.js` substring ANYWHERE in the
   * body, so a page whose comment named the new bundle and whose script tag
   * loaded the old one passed. Vite's output is too simple for that today,
   * which is exactly why it would have gone unnoticed. GPT Sol, 2026-09-09.
   */
  it("reads the script the page loads, not a mention of one", () => {
    const misleading = '<!-- built from index-NEW.js --><script type="module" src="/assets/index-OLD.js"></script>';
    expect(bundleRef(misleading)).toEqual({ kind: "one", name: "index-OLD.js" });
    expect(judgeBundle(bundleRef(html("index-NEW.js")), bundleRef(misleading)).verdict).toBe("fail");
  });

  /** Two different bundles loaded is not a coin toss between them. */
  it("is unknown when the page loads more than one index-*.js", () => {
    const two = '<script src="/assets/index-a.js"></script><script src="/assets/index-b.js"></script>';
    expect(bundleRef(two).kind).toBe("several");
    expect(judgeBundle(bundleRef(html("index-a.js")), bundleRef(two)).verdict).toBe("unknown");
  });
});

/* ------------------------------------------------------------------ *
 * The listener — the check that a 200 cannot make
 * ------------------------------------------------------------------ */

const SS = [
  'LISTEN 0      511                      127.0.0.1:8787  0.0.0.0:* users:(("node-MainThread",pid=4095050,fd=46))',
  'LISTEN 0      511                 100.92.255.119:8787  0.0.0.0:* users:(("node-MainThread",pid=4095050,fd=48))',
  'LISTEN 0      511                          [::1]:5273  [::]:*    users:(("node",pid=999,fd=20))',
].join("\n");

describe("the listener", () => {
  it("reads ss -ltnpH, including an IPv6 address", () => {
    const listeners = parseListeners(SS);
    expect(listeners.map((l) => l.port)).toEqual([8787, 8787, 5273]);
    expect(listeners[0]?.pids).toEqual([4095050]);
  });

  it("passes when the pid holding the port is in the unit's cgroup", () => {
    expect(judgeListener(parseListeners(SS), 8787, [4095037, 4095050]).verdict).toBe("pass");
  });

  /**
   * THE ONE THIS CHECK EXISTS FOR. On 2026-09-08 a peer's dev server answered
   * 200 on a port another agent believed was its own and sixteen screenshots
   * were taken of the wrong build. Every HTTP-only check passes here.
   */
  it("fails when a stranger holds the port", () => {
    const check = judgeListener(parseListeners(SS), 8787, [123, 456]);
    expect(check.verdict).toBe("fail");
    expect(check.detail).toContain("NOT in");
  });

  it("is unknown, not a pass, when the cgroup could not be read", () => {
    expect(judgeListener(parseListeners(SS), 8787, null).verdict).toBe("unknown");
  });

  it("is unknown, not a pass, when ss showed no pid at all", () => {
    expect(judgeListener(parseListeners("LISTEN 0 511 127.0.0.1:8787 0.0.0.0:*"), 8787, [1]).verdict).toBe("unknown");
  });

  it("fails when nothing is listening", () => {
    expect(judgeListener(parseListeners(SS), 8788, [4095050]).verdict).toBe("fail");
  });

  it("reads cgroup.procs", () => {
    expect(parseCgroupProcs("4095037\n4095050\n\n")).toEqual([4095037, 4095050]);
  });

  /**
   * THE TWO-SERVER PASS. The unit binds loopback *and* a tailnet address, so
   * "some socket on this port is in the cgroup" can be true of the tailnet one
   * while a stranger owns 127.0.0.1 — and then the ownership check and the HTTP
   * check, which only ever asks loopback, are describing two different
   * processes and both pass. GPT Sol, 2026-09-09.
   */
  it("proves ownership of the loopback socket, which is the one HTTP asks", () => {
    const split = [
      'LISTEN 0 511 127.0.0.1:8787 0.0.0.0:* users:(("stranger",pid=777,fd=3))',
      'LISTEN 0 511 100.92.255.119:8787 0.0.0.0:* users:(("node-MainThread",pid=4095050,fd=48))',
    ].join("\n");
    const check = judgeListener(parseListeners(split), 8787, [4095037, 4095050]);
    expect(check.verdict).toBe("fail");
    expect(check.detail).toContain("777");
  });

  it("says so when the unit holds the tailnet address but nothing holds loopback", () => {
    const only = 'LISTEN 0 511 100.92.255.119:8787 0.0.0.0:* users:(("node-MainThread",pid=4095050,fd=48))';
    expect(judgeListener(parseListeners(only), 8787, [4095050]).detail).toContain("nothing is listening on 127.0.0.1");
  });

  /**
   * Before a restart the same reading answers a different question. The unit's
   * own file warns that "two supervisors on one port is a fight where the
   * loser's failure looks like a crash", so a stranger there has to stop us
   * starting a second one.
   */
  it("refuses to start over a stranger already on the port", () => {
    const stranger = 'LISTEN 0 511 127.0.0.1:8787 0.0.0.0:* users:(("stranger",pid=777,fd=3))';
    expect(judgePortIsFree(parseListeners(stranger), 8787, [4095050], false).verdict).toBe("fail");
    expect(judgePortIsFree(parseListeners(""), 8787, [4095050], false).verdict).toBe("pass");
    expect(judgePortIsFree(parseListeners(SS), 8787, [4095050], true).verdict).toBe("pass");
  });

  it("refuses a leftover process of our own when systemd thinks the unit is stopped", () => {
    expect(judgePortIsFree(parseListeners(SS), 8787, [4095050], false).verdict).toBe("fail");
  });

  /**
   * THE SAME BUG ONE LAYER IN. The first fix grouped `127.0.0.1` with `[::1]`
   * and passed if *any* of the group was ours — so the unit on `[::1]:8787`
   * satisfied ownership while a stranger on `127.0.0.1:8787` answered the HTTP
   * check, which only ever asks the IPv4 address. GPT Sol, 2026-09-09.
   */
  it("is not satisfied by our own IPv6 socket while a stranger holds IPv4", () => {
    const split = [
      'LISTEN 0 511 127.0.0.1:8787 0.0.0.0:* users:(("stranger",pid=777,fd=3))',
      'LISTEN 0 511 [::1]:8787 [::]:* users:(("node-MainThread",pid=4095050,fd=48))',
    ].join("\n");
    const check = judgeListener(parseListeners(split), 8787, [4095037, 4095050]);
    expect(check.verdict).toBe("fail");
    expect(check.detail).toContain("777");
  });

  /** If several processes hold the address the HTTP goes to, all of them have to be ours. */
  it("fails when only some of the loopback owners are in the cgroup", () => {
    const both = [
      'LISTEN 0 511 127.0.0.1:8787 0.0.0.0:* users:(("node",pid=4095050,fd=46))',
      'LISTEN 0 511 127.0.0.1:8787 0.0.0.0:* users:(("stranger",pid=777,fd=3))',
    ].join("\n");
    expect(judgeListener(parseListeners(both), 8787, [4095050]).verdict).toBe("fail");
  });

  /** A partial parse that happens to contain the right pid is not evidence. */
  it("reads a damaged cgroup.procs as unreadable, not as the pids it could parse", () => {
    expect(parseCgroupProcs("4095037\nnot-a-pid\n4095050\n")).toBeNull();
    expect(parseCgroupProcs("4095037\n0\n")).toBeNull();
  });
});

describe("the stability window", () => {
  /**
   * `Type=simple` is `active` when ExecStart forks, before Node has finished
   * its binds — and server.ts treats a bind it cannot take as fatal. So it can
   * bind loopback, answer 200 with the right bundle, then die; ten seconds
   * later Restart=always brings up another. Every other check passes in that
   * window.
   */
  it("fails when a second process replaced the one that answered", () => {
    expect(judgeStable(100, 0, 200, 1, 12_000).verdict).toBe("fail");
    expect(judgeStable(100, 0, 0, 0, 12_000).verdict).toBe("fail");
  });

  it("fails when systemd restarted it behind us, even at the same pid reading", () => {
    expect(judgeStable(100, 0, 100, 2, 12_000).verdict).toBe("fail");
  });

  it("passes only when the same pid is still there with nothing restarted", () => {
    expect(judgeStable(100, 3, 100, 3, 12_000).verdict).toBe("pass");
  });

  it("is unknown when there is no NRestarts to rule a restart out with", () => {
    expect(judgeStable(100, Number.NaN, 100, Number.NaN, 12_000).verdict).toBe("unknown");
  });
});

/* ------------------------------------------------------------------ *
 * The steering queue — the thing a restart destroys
 * ------------------------------------------------------------------ */

const body = (items: unknown[], quarantine: unknown = null) => ({
  ok: true,
  op: "catalogue",
  queues: items.length === 0 && quarantine === null ? [] : [{ sessionId: "$1", items, quarantine }],
});
const item = (id: string) => ({ id, sessionId: "$1", enqueuedAt: 1_000, payload: { kind: "message", text: "please stop and ask" } });

describe("the steering queue", () => {
  it("passes when it is empty", () => {
    const read = summariseQueues(body([]));
    expect(judgeQueue(true, read, false).verdict).toBe("pass");
  });

  it("refuses when anything is queued, and says how to override", () => {
    const check = judgeQueue(true, summariseQueues(body([item("q1"), item("q2")])), false);
    expect(check.verdict).toBe("fail");
    expect(check.detail).toContain("--discard-queue");
  });

  it("goes ahead under --discard-queue, but as an override rather than a pass", () => {
    expect(judgeQueue(true, summariseQueues(body([item("q1")])), true).verdict).toBe("overridden");
  });

  /**
   * A shape it does not recognise has to become "I cannot tell you what you are
   * about to throw away". An empty list would be the same sentence as "nothing
   * is queued", which is the substitution that loses somebody's instruction.
   */
  it("is unknown, not empty, when the dashboard's shape has changed", () => {
    expect(summariseQueues({ ok: true }).ok).toBe(false);
    expect(summariseQueues({ queues: [{}] }).ok).toBe(false);
    expect(judgeQueue(true, summariseQueues({ ok: true }), false).verdict).toBe("unknown");
  });

  /**
   * A REVERSAL, and GPT Sol's argument for it is the one that settles it: the
   * authority the Overseer acts under is *"once you have read the steering
   * queue"*, so an override that fires when the queue could not be read
   * overrides a condition that was never met — and it cannot print what it is
   * throwing away. Known items may be discarded on purpose; unknown ones stay
   * blocking.
   */
  it("does not let --discard-queue through a queue nobody has read", () => {
    const check = judgeQueue(true, summariseQueues({ ok: true }), true);
    expect(check.verdict).toBe("unknown");
    expect(blocks(check)).toBe(true);
  });

  /**
   * THE HALF WITH NO ITEMS BEHIND IT. `wire.ts` says a queue reaches the wire
   * when it has items *or* a quarantine hold, and that the commonest hold has
   * no items at all — so counting `items` reads "nothing queued" over a session
   * that nothing may be sent to, and the restart erases the hold.
   */
  it("refuses for a steering hold with no items behind it", () => {
    const read = summariseQueues(body([], { id: "h1", sessionId: "$1", why: "an uncertain send" }));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.items).toHaveLength(0);
    expect(read.holds).toHaveLength(1);
    const check = judgeQueue(true, read, false);
    expect(check.verdict).toBe("fail");
    expect(check.detail).toContain("hold");
  });

  it("is unknown when the wire carries no quarantine field for it to look at", () => {
    expect(summariseQueues({ ok: true, op: "catalogue", queues: [{ items: [] }] }).ok).toBe(false);
  });

  /**
   * `quarantine: false` fell through the `typeof === "object"` test and was
   * counted as no hold — the exact substitution this parser exists to refuse.
   * GPT Sol, 2026-09-09.
   */
  it("is unknown for a quarantine value that is neither a hold nor null", () => {
    expect(summariseQueues({ ok: true, op: "catalogue", queues: [{ items: [], quarantine: false }] }).ok).toBe(false);
    expect(summariseQueues({ ok: true, op: "catalogue", queues: [{ items: [], quarantine: "held" }] }).ok).toBe(false);
  });

  /**
   * THE ENVELOPE. An error-shaped 200 carrying `queues: []` — a proxy's page, a
   * route that moved, a different server on the port — would otherwise read as
   * "the queue is empty" and clear the way for a restart.
   */
  it("does not read an error-shaped 200 with no queues as an empty queue", () => {
    expect(summariseQueues({ ok: false, error: "nope", queues: [] }).ok).toBe(false);
    expect(summariseQueues({ ok: true, op: "something-else", queues: [] }).ok).toBe(false);
    expect(summariseQueues({ queues: [] }).ok).toBe(false);
  });

  /**
   * A dead service's queue is already gone. Refusing to restart it because the
   * lost queue is unreadable would make the tool useless in the one case
   * docs/project/overseer.md calls unambiguously safe.
   */
  it("has no subject when the service is not running", () => {
    expect(judgeQueue(false, { ok: false, why: "nothing answered" }, false).verdict).toBe("skipped");
  });

  it("summarises what would be discarded, rather than only counting it", () => {
    const read = summariseQueues(body([item("q1")]));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.items[0]?.what).toContain("please stop and ask");
  });

  it("does not print `undefined` for an item shaped in a way it does not know", () => {
    const read = summariseQueues({ ok: true, op: "catalogue", queues: [{ items: [{}], quarantine: null }] });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.items[0]?.what).toContain("unrecognised");
    expect(JSON.stringify(read.items[0])).not.toContain("undefined");
  });
});

/* ------------------------------------------------------------------ *
 * git
 * ------------------------------------------------------------------ */

describe("the primary against dev", () => {
  const at = (over: Partial<Extract<GitRead, { ok: true }>> = {}) =>
    ({ ok: true, head: "aaaaaaaaaa", fetchedDev: "bbbbbbbbbb", behind: 0, ahead: 0, branch: "dev", dirtyFleetFiles: [], ...over }) as GitRead;

  it("refuses when the primary is behind — a restart would deploy backwards", () => {
    const check = judgeBehind(at({ behind: 3 }));
    expect(check.verdict).toBe("fail");
    expect(check.detail).toContain("behind");
  });

  /** Ahead is ordinary in a shared primary; refusing on it would make this unusable. */
  it("passes when it is ahead, but says the unpushed work will go live", () => {
    const check = judgeBehind(at({ ahead: 2 }));
    expect(check.verdict).toBe("pass");
    expect(check.detail).toContain("unpushed");
  });

  /**
   * WHAT "NOT BEHIND" CANNOT SEE, and why it is no longer called *at
   * origin/dev*. On a feature branch that contains dev, `HEAD..dev` is zero, so
   * the old single check passed while `ExecStartPre` would build the feature
   * branch. GPT Sol, 2026-09-09.
   */
  it("refuses a primary sitting on a branch that is not dev, even when it is not behind", () => {
    expect(judgeBehind(at({ branch: "worktree-something" })).verdict).toBe("pass");
    expect(judgeBranch(at({ branch: "worktree-something" })).verdict).toBe("fail");
    expect(judgeBranch(at()).verdict).toBe("pass");
  });

  /** Only the files ExecStartPre builds — this tree is never clean, and a blanket rule would refuse every time. */
  it("refuses uncommitted changes under tools/fleet/, and ignores dirt elsewhere", () => {
    expect(judgeDirty(at({ dirtyFleetFiles: ["tools/fleet/server.ts"] })).verdict).toBe("fail");
    expect(judgeDirty(at()).verdict).toBe("pass");
  });

  it("is unknown, on every git check, when git could not answer", () => {
    const broken: GitRead = { ok: false, why: "git fetch origin dev failed" };
    expect(judgeBehind(broken).verdict).toBe("unknown");
    expect(judgeBranch(broken).verdict).toBe("unknown");
    expect(judgeDirty(broken).verdict).toBe("unknown");
  });
});

/* ------------------------------------------------------------------ *
 * After the restart
 * ------------------------------------------------------------------ */

describe("after the restart", () => {
  /** The check that catches this script lying about its own central act. */
  it("fails when the process was not actually replaced", () => {
    expect(judgeReplaced(100, 100).verdict).toBe("fail");
    expect(judgeReplaced(100, 0).verdict).toBe("fail");
    expect(judgeReplaced(100, 200).verdict).toBe("pass");
    expect(judgeReplaced(0, 200).verdict).toBe("pass");
  });

  /** Restart=always + RestartSec=10 makes a crash loop look healthy every ten seconds. */
  it("fails when systemd has had to restart it again on its own", () => {
    const check = judgeFlapping(4, 6);
    expect(check.verdict).toBe("fail");
    expect(check.detail).toContain("crash-looping");
    expect(judgeFlapping(4, 4).verdict).toBe("pass");
  });

  it("treats `activating` as unknown rather than either answer", () => {
    const facts = { activeState: "activating", subState: "start-pre" } as never;
    expect(judgeActive(facts).verdict).toBe("unknown");
  });

  /**
   * There is legitimately no Overseer session at four in the morning, so this
   * compares before with after rather than judging `after` alone — otherwise it
   * cries wolf every night.
   */
  it("only blames the restart for an Overseer claim that existed before it", () => {
    expect(judgeOverseerClaim("overseer    no Overseer session", "overseer    no Overseer session", 0).verdict).toBe("skipped");
    expect(judgeOverseerClaim("overseer    Overseer: Overseer", "overseer    no Overseer session", 0).verdict).toBe("fail");
    expect(judgeOverseerClaim("overseer    Overseer: Overseer", "overseer    Overseer: Overseer", 0).verdict).toBe("pass");
    expect(judgeOverseerClaim(null, "overseer    Overseer: Overseer", 0).verdict).toBe("unknown");
  });

  /**
   * THE FALSE ALARM THIS SCRIPT'S OWN FIRST REAL RUN PRODUCED, 2026-09-09. The
   * claim is the daemon's folded view of its polls, so for one tick after any
   * restart it honestly says it cannot tell — and the check called that a lost
   * claim, in red, seconds after a restart that had gone perfectly.
   *
   * It is `unknown` rather than `pass` because a daemon *permanently* unable to
   * see the dashboard is what a genuinely bad restart looks like; the waiting
   * that makes this rare lives in the executor, not here.
   */
  it("does not read the daemon's first blind tick after a restart as a lost claim", () => {
    const after = "overseer    Overseer unknown — the dashboard has never completed a collection";
    const check = judgeOverseerClaim("overseer    Overseer: Overseer", after, 60_000);
    expect(check.verdict).not.toBe("fail");
    expect(check.verdict).toBe("unknown");
    expect(check.detail).toContain("re-collected");
  });

  /**
   * `cannot-tell` BEFORE is not "no claim to lose". The first version returned
   * `skipped` for every pre-state except `holder`, so a stale snapshot read as
   * an absence, no post-restart reading was taken at all, and a claim that
   * really existed could be lost at exit 0 — contradicting the rule directly
   * beside it that a `cannot-tell` after is blocking. GPT Sol, 2026-09-09.
   */
  it("does not read an unestablished claim before the restart as nothing to lose", () => {
    const stale = "overseer    Overseer unknown — the snapshot is stale";
    const check = judgeOverseerClaim(stale, "overseer    no Overseer session", 0);
    expect(check.verdict).not.toBe("skipped");
    expect(check.verdict).toBe("unknown");
    expect(check.detail).toContain("BEFORE");
  });

  it("names the four things the overseer line can be saying", () => {
    expect(claimState("overseer    Overseer: Overseer")).toBe("holder");
    expect(claimState("overseer    no Overseer session")).toBe("none");
    expect(claimState("overseer    Overseer unknown — the dashboard has never completed a collection")).toBe("cannot-tell");
    expect(claimState("overseer    not asked — this reading did not query the dashboard")).toBe("cannot-tell");
    expect(claimState(null)).toBe("unreadable");
  });

  /**
   * The `holder` / `cannot-tell` split is read off `describeClaim`'s own
   * sentences, so this fails if that function stops producing them rather than
   * letting this script quietly classify every claim as `cannot-tell`.
   */
  it("reads the sentences tools/fleet/overseer-claim.ts actually produces", () => {
    const source = readFileSync(path.join(REPO, "tools/fleet/overseer-claim.ts"), "utf8");
    expect(source, "describeClaim no longer builds an `Overseer: <name>` line, so claimState would read every claim as cannot-tell").toMatch(/Overseer: \$\{safe\(claim\.name\)\}/);
    expect(source).toContain('"no Overseer session"');
  });
});

describe("the report", () => {
  it("repeats every blocking check at the bottom, so a long list cannot hide one", () => {
    const lines = renderReport("t", [
      { name: "a", verdict: "pass", detail: "fine" },
      { name: "b", verdict: "unknown", detail: "could not read the cgroup" },
    ]).join("\n");
    expect(lines).toContain("UNKNOWN: b");
    expect(lines).not.toContain("all clear");
  });

  it("says all clear only when nothing blocks", () => {
    const lines = renderReport("t", [
      { name: "a", verdict: "pass", detail: "fine" },
      { name: "b", verdict: "skipped", detail: "no subject" },
      { name: "c", verdict: "overridden", detail: "accepted" },
    ]).join("\n");
    expect(lines).toContain("all clear");
  });
});

/* ------------------------------------------------------------------ *
 * Two copies of a fact, kept honest
 * ------------------------------------------------------------------ */

describe("facts that live somewhere else", () => {
  it("uses the port default that tools/fleet/server.ts compiles in", () => {
    const source = readFileSync(path.join(REPO, "tools/fleet/server.ts"), "utf8");
    const found = source.match(/FLEET_PORT\s*\?\?\s*(\d+)/)?.[1];
    expect(found, "tools/fleet/server.ts no longer has a `FLEET_PORT ?? <number>` default for this to track").toBeDefined();
    expect(Number(found)).toBe(DEFAULT_PORT);
  });

  it("names a unit that exists in infra/hetzner/systemd/", () => {
    expect(readFileSync(path.join(REPO, "infra/hetzner/systemd", UNIT), "utf8")).toContain("[Service]");
  });
});

/* ------------------------------------------------------------------ *
 * The composition root, run for real against a fake world
 * ------------------------------------------------------------------ */

type World = {
  show: string[];
  restartStatus?: number;
  ss?: string;
  httpStatus?: number | null;
  httpBody?: string;
  actionsBody?: string;
  gitCounts?: string;
  builtHtml?: string | null;
  /** The `overseer` line, once per `overseer status` call; the last one repeats. */
  claimLines?: string[];
  branch?: string;
  /** `git status --porcelain` lines, so `XY path`. */
  dirtyFleet?: string[];
  dirtySrc?: string[];
  /** Non-zero makes `ss` fail, the way it does with no permission. */
  ssStatus?: number;
  /** From this `systemctl show` call onwards (1-based), the command fails. */
  showFailsAfter?: number;
};

function fakeIo(world: World): { io: Io; argv: string[][]; lines: string[] } {
  const argv: string[][] = [];
  const lines: string[] = [];
  const shows = [...world.show];
  const claims = [...(world.claimLines ?? ["overseer    Overseer: Overseer"])];
  let clock = 1_000_000;
  let showCalls = 0;
  const io: Io = {
    run(command) {
      argv.push(command);
      const [head, ...rest] = command;
      if (head === "systemctl" && rest[0] === "show") {
        showCalls += 1;
        if (world.showFailsAfter !== undefined && showCalls > world.showFailsAfter) return { status: 1, stdout: "", stderr: "Failed to get properties: Connection timed out" };
        return { status: 0, stdout: shows.length > 1 ? (shows.shift() as string) : (shows[0] as string), stderr: "" };
      }
      if (head === "sudo") return { status: world.restartStatus ?? 0, stdout: "", stderr: world.restartStatus ? "sudo: a password is required" : "" };
      if (head === "ss") return { status: world.ssStatus ?? 0, stdout: world.ssStatus ? "" : (world.ss ?? SS), stderr: world.ssStatus ? "ss: no permission" : "" };
      if (head === "git" && rest[2] === "fetch") return { status: 0, stdout: "", stderr: "" };
      if (head === "git" && rest[2] === "rev-parse" && rest[3] === "--abbrev-ref") return { status: 0, stdout: `${world.branch ?? "dev"}\n`, stderr: "" };
      if (head === "git" && rest[2] === "rev-parse") return { status: 0, stdout: `${rest[3]}-sha\n`, stderr: "" };
      if (head === "git" && rest[2] === "rev-list") return { status: 0, stdout: `${world.gitCounts ?? "0\t0"}\n`, stderr: "" };
      if (head === "git" && rest[2] === "status") return { status: 0, stdout: ((rest.includes("src") ? world.dirtySrc : world.dirtyFleet) ?? []).join("\n"), stderr: "" };
      if (head?.endsWith("tsx")) return { status: 0, stdout: `${claims.length > 1 ? (claims.shift() as string) : (claims[0] as string)}\n`, stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    },
    readFile: (file) => (file.endsWith("cgroup.procs") ? "4095037\n4095050\n" : world.builtHtml === undefined ? '<script src="/assets/index-CafjCvVA.js">' : world.builtHtml),
    exists: () => true,
    async http(url) {
      if (url.endsWith("/api/actions")) return { status: 200, body: world.actionsBody ?? JSON.stringify(body([])), why: "" };
      return { status: world.httpStatus === undefined ? 200 : world.httpStatus, body: world.httpBody ?? '<script src="/assets/index-CafjCvVA.js">', why: "refused" };
    },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    out: (line) => lines.push(line),
  };
  return { io, argv, lines };
}

const SHOW_AFTER = SHOW_OK.replace("MainPID=4095037", "MainPID=4200000");

describe("the real main against a fake world", () => {
  /**
   * MUTATE THE COMPOSITION ROOT. Every test above drives a pure judgment with
   * output somebody typed into this file; none of them can see whether `main`
   * asks systemd the right question or runs the right command. So this one runs
   * the real `main` and asserts the argv that came out of the other end.
   */
  it("asks systemctl show for exactly the properties the parser reads", () => {
    const { io, argv } = fakeIo({ show: [SHOW_OK] });
    return main(["check"], io).then(() => {
      const show = argv.find((a) => a[0] === "systemctl" && a[1] === "show");
      expect(show?.slice(0, 3)).toEqual(["systemctl", "show", UNIT]);
      for (const property of SHOW_PROPERTIES) expect(show).toContain(property);
    });
  });

  it("restarts with the one command it is meant to, and no other", async () => {
    const { io, argv } = fakeIo({ show: [SHOW_OK, SHOW_AFTER] });
    await main(["restart"], io);
    const sudo = argv.filter((a) => a[0] === "sudo");
    expect(sudo).toEqual([["sudo", "-n", "systemctl", "restart", UNIT]]);
    expect(argv.some((a) => a.includes("kill") || a.includes("pkill"))).toBe(false);
  });

  /** The property that makes `check` safe to run from anywhere, at any time. */
  it("never runs sudo in check mode", async () => {
    const { io, argv } = fakeIo({ show: [SHOW_OK] });
    expect(await main(["check"], io)).toBe(EXIT_OK);
    expect(argv.some((a) => a[0] === "sudo")).toBe(false);
  });

  it("does not restart when a precondition refused", async () => {
    const { io, argv, lines } = fakeIo({ show: [SHOW_OK], actionsBody: JSON.stringify(body([item("q1")])) });
    expect(await main(["restart"], io)).toBe(EXIT_REFUSED);
    expect(argv.some((a) => a[0] === "sudo")).toBe(false);
    expect(lines.join("\n")).toContain("REFUSED");
  });

  it("prints every queued item before --discard-queue throws it away", async () => {
    const { io, lines } = fakeIo({ show: [SHOW_OK, SHOW_AFTER], actionsBody: JSON.stringify(body([item("q1")])) });
    expect(await main(["restart", "--discard-queue"], io)).toBe(EXIT_OK);
    expect(lines.join("\n")).toContain("please stop and ask");
  });

  it("refuses a primary sitting on somebody's feature branch", async () => {
    const { io, argv } = fakeIo({ show: [SHOW_OK], branch: "worktree-readiness-tab" });
    expect(await main(["restart"], io)).toBe(EXIT_REFUSED);
    expect(argv.some((a) => a[0] === "sudo")).toBe(false);
  });

  it("refuses half-edited files the build reads, which ExecStartPre would compile", async () => {
    const { io, lines } = fakeIo({ show: [SHOW_OK], dirtyFleet: [" M tools/fleet/server.ts"] });
    expect(await main(["restart"], io)).toBe(EXIT_REFUSED);
    expect(lines.join("\n")).toContain("tools/fleet/server.ts");
  });

  /**
   * The queue is read TWICE, and the second read is the last act before the
   * `sudo`. It does not close the race — an instruction arriving in the
   * microseconds after that response is still lost — but everything between the
   * two reads is time somebody's instruction could have gone missing without
   * being printed, and that used to include rendering and printing the whole
   * report. GPT Sol raised this twice; closing it properly needs an atomic
   * quiesce in the dashboard.
   */
  it("refuses when an instruction arrives between the check and the restart", async () => {
    let calls = 0;
    const { io, argv, lines } = fakeIo({ show: [SHOW_OK, SHOW_AFTER] });
    const wrapped: Io = {
      ...io,
      http: async (url, ms) => {
        if (url.endsWith("/api/actions")) {
          calls += 1;
          return { status: 200, body: JSON.stringify(body(calls === 1 ? [] : [item("q9")])), why: "" };
        }
        return io.http(url, ms);
      },
    };
    expect(await main(["restart"], wrapped)).toBe(EXIT_REFUSED);
    expect(argv.some((a) => a[0] === "sudo")).toBe(false);
    const out = lines.join("\n");
    expect(out).toContain("changed between the check above and the restart");
    expect(out).toContain("q9");
  });

  /** The queue is a snapshot of something another process may change; read it as late as possible. */
  it("reads the steering queue after the slow checks, not before them", async () => {
    const seen: string[] = [];
    const { io } = fakeIo({ show: [SHOW_OK] });
    const wrapped: Io = {
      ...io,
      run: (argvIn, cwd) => {
        seen.push(argvIn.join(" "));
        return io.run(argvIn, cwd);
      },
      http: async (url, ms) => {
        if (url.endsWith("/api/actions")) seen.push("GET /api/actions");
        return io.http(url, ms);
      },
    };
    await main(["check"], wrapped);
    const queueAt = seen.indexOf("GET /api/actions");
    const fetchAt = seen.findIndex((c) => c.includes("fetch"));
    expect(queueAt).toBeGreaterThan(fetchAt);
    expect(fetchAt).toBeGreaterThanOrEqual(0);
  });

  /**
   * The postflight is evidence, not a reward for the command exiting zero:
   * `systemctl restart` can fail having already stopped the old process, and
   * returning at that point leaves the operator with a number and no idea
   * whether anything is serving.
   */
  it("still reports what is serving when the restart command failed", async () => {
    const { io, lines } = fakeIo({ show: [SHOW_OK, SHOW_AFTER], restartStatus: 1 });
    expect(await main(["restart"], io)).toBe(EXIT_RESTART_FAILED);
    const out = lines.join("\n");
    expect(out).toContain("RESTART COMMAND FAILED");
    expect(out).toContain("after");
    expect(out).toContain("systemd says");
  });

  it("refuses a primary that is behind origin/dev", async () => {
    const { io } = fakeIo({ show: [SHOW_OK], gitCounts: "0\t4" });
    expect(await main(["restart"], io)).toBe(EXIT_REFUSED);
  });

  it("exits 3, distinctly, when the restart command itself fails", async () => {
    const { io, lines } = fakeIo({ show: [SHOW_OK, SHOW_AFTER], restartStatus: 1 });
    expect(await main(["restart"], io)).toBe(EXIT_RESTART_FAILED);
    expect(lines.join("\n")).toContain("a password is required");
  });

  /**
   * TWO WAYS TO PRINT `all clear` WITHOUT HAVING LOOKED, both from discarding a
   * command's exit status. The final `systemctl show` failing left `after` at
   * the first sample, so `judgeStable(200, 0, 200, 0)` passed on an observation
   * that never happened — and the second look is the entire check. GPT Sol,
   * 2026-09-09.
   */
  it("does not pass the stability check on an observation that never happened", async () => {
    const { io, lines } = fakeIo({ show: [SHOW_OK, SHOW_AFTER], showFailsAfter: 2 });
    expect(await main(["restart"], io)).toBe(EXIT_UNVERIFIED);
    const out = lines.join("\n");
    // The PREFLIGHT legitimately says "all clear" — the postflight must not.
    const postflight = out.slice(out.indexOf(", after"));
    expect(postflight).not.toContain("all clear");
    expect(postflight).toContain("the second look is the whole of this check");
    expect(postflight).toContain("THIS IS THE READING FROM BEFORE THE WAIT");
    // EVERY judgment that reads the unit, not only the stability one. A first
    // pass at this test asserted the stability line alone, and a deliberate
    // mutation showed that `active`, `process replaced` and `not crash-looping`
    // could all go on reporting the stale sample with the test still green.
    for (const check of ["active", "process replaced", "not crash-looping", "stable"]) {
      expect(postflight, `${check} should be unknown when the final systemctl show failed`).toMatch(new RegExp(`\\?\\s+${check}\\b`));
    }
  });

  /** And an `ss` that failed and printed nothing must not read as "nothing else holds the port". */
  it("does not read a failed ss as a free port or as proof of ownership", async () => {
    const { io, lines } = fakeIo({ show: [SHOW_OK, SHOW_AFTER], ssStatus: 1 });
    expect(await main(["restart"], io)).toBe(EXIT_REFUSED);
    expect(lines.join("\n")).toContain("ss failed");
  });

  /** A crash loop that has come back up once looks exactly like a healthy service. */
  it("exits 4 when the process is replaced again during the stability window", async () => {
    const flapped = SHOW_OK.replace("MainPID=4095037", "MainPID=4300000").replace("NRestarts=0", "NRestarts=1");
    const { io, lines } = fakeIo({ show: [SHOW_OK, SHOW_AFTER, flapped] });
    expect(await main(["restart"], io)).toBe(EXIT_UNVERIFIED);
    expect(lines.join("\n")).toContain("came up and was replaced");
  });

  /** Restarted, still serving the bundle it had before: the failure the unit's comments are about. */
  it("exits 4 when it restarted but the page is stale", async () => {
    const { io, lines } = fakeIo({
      show: [SHOW_OK, SHOW_AFTER],
      builtHtml: '<script src="/assets/index-NEW.js">',
      httpBody: '<script src="/assets/index-OLD.js">',
    });
    expect(await main(["restart"], io)).toBe(EXIT_UNVERIFIED);
    expect(lines.join("\n")).toContain("stale");
  });

  it("exits 4 when the process was never replaced, however healthy everything else looks", async () => {
    const { io, lines } = fakeIo({ show: [SHOW_OK, SHOW_OK] });
    expect(await main(["restart"], io)).toBe(EXIT_UNVERIFIED);
    expect(lines.join("\n")).toContain("did not replace the process");
  });

  /**
   * The executor half of the false alarm above: the daemon's blind tick has to
   * be waited out, not judged. Without the wait this run ends `unknown` on a
   * restart that went perfectly.
   */
  it("waits for the Overseer daemon to re-collect before judging its claim", async () => {
    const blind = "overseer    Overseer unknown — the dashboard has never completed a collection";
    const { io, lines } = fakeIo({
      show: [SHOW_OK, SHOW_AFTER],
      claimLines: ["overseer    Overseer: Overseer", blind, blind, "overseer    Overseer: Overseer"],
    });
    expect(await main(["restart"], io)).toBe(EXIT_OK);
    expect(lines.join("\n")).not.toContain("does not now");
  });

  /**
   * THE WAIT THAT UNDID THE STABILITY WINDOW. Systemd and HTTP used to be
   * sampled *before* the claim wait, which can be sixty seconds — so the
   * process could die and be replaced during it, and the ownership check would
   * describe the new pid while every other judgment described the old one, all
   * passing. Every wait now happens before the final sample. GPT Sol, 2026-09-09.
   */
  it("takes its final readings after the claim wait, not before it", async () => {
    const seen: string[] = [];
    const blind = "overseer    Overseer unknown — the dashboard has never completed a collection";
    const { io } = fakeIo({
      show: [SHOW_OK, SHOW_AFTER],
      claimLines: ["overseer    Overseer: Overseer", blind, "overseer    Overseer: Overseer"],
    });
    const wrapped: Io = {
      ...io,
      run: (argvIn, cwd) => {
        seen.push(argvIn[0]?.endsWith("tsx") ? "overseer-status" : (argvIn[0] as string));
        return io.run(argvIn, cwd);
      },
    };
    await main(["restart"], wrapped);
    // The last `overseer-status` must come before the last `ss`, which is the
    // reading ownership is judged on.
    expect(seen.lastIndexOf("overseer-status")).toBeLessThan(seen.lastIndexOf("ss"));
    expect(seen.lastIndexOf("overseer-status")).toBeLessThan(seen.lastIndexOf("systemctl"));
  });

  /** And a claim that never comes back is `unknown`, so a permanently blinded daemon still shows. */
  it("gives up on a claim that never settles, without calling it a loss", async () => {
    const blind = "overseer    Overseer unknown — the dashboard has never completed a collection";
    const { io, lines } = fakeIo({ show: [SHOW_OK, SHOW_AFTER], claimLines: ["overseer    Overseer: Overseer", blind] });
    expect(await main(["restart"], io)).toBe(EXIT_UNVERIFIED);
    expect(lines.join("\n")).toContain("re-collected");
  });

  /**
   * `npm run fleet:restart` with nothing after it lands here, and it must be
   * the boring outcome. The author of this file restarted the live dashboard by
   * typing a mode word without thinking about it; a default mode would have
   * made that possible with no word at all.
   */
  it("says what to do rather than doing something, when told nothing", async () => {
    const { io, argv, lines } = fakeIo({ show: [SHOW_OK] });
    expect(await main([], io)).toBe(1);
    expect(argv.some((a) => a[0] === "sudo")).toBe(false);
    expect(lines.join("\n")).toContain("say 'check' or 'restart'");
  });

  /** And `go` is not a hidden alias for it — the word that restarts says "restart". */
  it("does not answer to `go`", async () => {
    const { io, argv } = fakeIo({ show: [SHOW_OK] });
    expect(await main(["go"], io)).toBe(1);
    expect(argv.some((a) => a[0] === "sudo")).toBe(false);
  });

  it("refuses an argument it does not recognise instead of ignoring it", async () => {
    const { io } = fakeIo({ show: [SHOW_OK] });
    expect(await main(["restart", "--force"], io)).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * The CLI itself, as a subprocess
 * ------------------------------------------------------------------ */

/**
 * **What the recorder tests above cannot prove.** Running `main` with a fake
 * `Io` shows that `main` emits certain argv to whatever object it was handed —
 * it says nothing about whether the file's entry point calls `main` at all,
 * which `Io` it hands it, or whether the process exits with what `main`
 * returned. A production line reading `main(argv, noOpIo)` would pass every one
 * of them. GPT Sol, 2026-09-09.
 *
 * So these run the real file in a real process — but only the paths that touch
 * nothing. This suite must never restart a service; the modes that would are
 * covered by the fakes above and by the stage 2 experiment.
 */
describe("the CLI as a subprocess", () => {
  const cli = (args: string[]) => {
    try {
      const stdout = execFileSync(path.join(REPO, "node_modules/.bin/tsx"), [path.join(REPO, "scripts/fleet-restart.ts"), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { status: 0, stdout };
    } catch (error) {
      const e = error as { status?: number; stdout?: string };
      return { status: e.status ?? -1, stdout: e.stdout ?? "" };
    }
  };

  it("prints its help and exits 0", () => {
    const ran = cli(["--help"]);
    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain("npx tsx scripts/fleet-restart.ts restart");
  });

  /** The entry point returns `main`'s code rather than always zero — the half a fake cannot see. */
  it("exits non-zero, and does nothing, when given no mode", () => {
    const ran = cli([]);
    expect(ran.status).toBe(1);
    expect(ran.stdout).toContain("say 'check' or 'restart'");
  });

  it("exits non-zero on an argument it does not recognise", () => {
    expect(cli(["--force"]).status).toBe(1);
  });
});
