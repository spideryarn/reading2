#!/usr/bin/env -S npx tsx
/**
 * **Restart the fleet dashboard, deliberately, and say honestly what happened.**
 *
 *     npx tsx scripts/fleet-restart.ts check              # preconditions only; never restarts
 *     npx tsx scripts/fleet-restart.ts restart            # preconditions, restart, verify
 *     npx tsx scripts/fleet-restart.ts restart --discard-queue
 *
 * **There is no default mode**, and the restarting one is spelled `restart`
 * rather than `go`. Both of those are scar tissue from this file's own first
 * hour: its author ran `npm run fleet:restart go` to find out whether npm
 * forwards an argument without `--` — it does — and restarted the live
 * dashboard he had been told not to touch. `go` is a word you type while
 * thinking about something else; `restart` is not, and a bare
 * `npm run fleet:restart` now prints this help and exits non-zero rather than
 * doing the interesting thing to whoever ran it to see what it was.
 *
 * ## Why this exists
 *
 * Every dashboard change lands in the primary checkout and reaches the page only
 * on a restart — there were seven of those on the night of 2026-09-08 and Greg
 * ran each one by hand. `docs/project/overseer.md` § Steering already says the
 * restart is the Overseer's to make, *once it has read the steering queue*,
 * because the queue is in memory and a restart discards it and records nothing.
 * That condition was a thing to remember; here it is a thing that refuses.
 *
 * Greg, 2026-09-09:
 *
 * > work on making this something you can run yourself, e.g. make it a nice
 * > script that you can call, and see if the auto-classifier will accept that.
 *
 * The second half of that sentence is the other reason for the file. `greg` has
 * passwordless sudo and `sudo -n true` succeeds from an agent's shell, so this
 * was never a privilege problem: the Overseer's session runs in auto mode and
 * its command classifier refuses `sudo systemctl restart fleet-dashboard` while
 * allowing `kill -TERM`, `tmux send-keys` and `npx tsx scripts/…`. Whether a
 * script name reads differently to the classifier is an experiment, and it is
 * written up in docs/plans/260909c-a-dashboard-restart-the-overseer-can-run-itself.md.
 *
 * ## What is here and what is next door
 *
 * This file runs commands and hands their bytes to `fleet-restart-plan.ts`,
 * which holds every rule about what counts as a pass and knows nothing about
 * I/O. The four verdicts and why `unknown` blocks are documented there.
 *
 * Nothing in here writes to `infra/` or to a unit file: the unit is
 * `infra/hetzner/systemd/fleet-dashboard.service` and it is Greg's.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  type Check,
  DIST_INDEX,
  EXIT_OK,
  FLEET_BUILD_INPUTS,
  EXIT_REFUSED,
  EXIT_RESTART_FAILED,
  EXIT_UNEXPECTED,
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
  judgeHttp,
  judgeListener,
  judgeOverseerClaim,
  judgePortIsFree,
  judgeQueue,
  judgeReplaced,
  judgeStable,
  parseCgroupProcs,
  parseListeners,
  parseShow,
  readUnit,
  renderQueueItems,
  renderReport,
  resolvePort,
  srcDirtNote,
  summariseQueues,
  type Listener,
  type GitRead,
  type QueueRead,
  type UnitFacts,
} from "./fleet-restart-plan.js";

/* ------------------------------------------------------------------ *
 * The thin layer that actually touches the box
 * ------------------------------------------------------------------ */

export type Ran = { status: number | null; stdout: string; stderr: string };

/** Everything this script can do to the world, in one place so a test can be the world. */
export type Io = {
  /** Never a shell: an argv, so nothing here can be quoted wrong. */
  run(argv: string[], cwd?: string): Ran;
  readFile(file: string): string | null;
  exists(file: string): boolean;
  http(url: string, timeoutMs: number): Promise<{ status: number | null; body: string; why: string }>;
  now(): number;
  sleep(ms: number): Promise<void>;
  out(line: string): void;
};

export const realIo: Io = {
  run(argv, cwd) {
    const [command, ...args] = argv;
    if (command === undefined) return { status: null, stdout: "", stderr: "empty argv" };
    try {
      const stdout = execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      const e = error as { status?: number | null; stdout?: string; stderr?: string; message?: string };
      return { status: e.status ?? null, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? "" };
    }
  },
  readFile(file) {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null;
    }
  },
  exists: (file) => existsSync(file),
  async http(url, timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      return { status: res.status, body: await res.text(), why: "" };
    } catch (error) {
      return { status: null, body: "", why: (error as Error).message };
    }
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  out: (line) => console.log(line),
};

/* ------------------------------------------------------------------ *
 * Waiting
 * ------------------------------------------------------------------ */

/**
 * How long we give it to come back, and **why a fast negative means nothing.**
 *
 * `systemctl restart` returns when systemd considers the unit started, and for
 * `Type=simple` that is the moment `ExecStart` is forked — before the process
 * has bound a socket. So the first connection refused after a restart is the
 * expected state, not a failure, and the shell prototype's `sleep 8` was a guess
 * that happens to be longer than it takes. This box has reached load average
 * 391; the unit itself allows `TimeoutStartSec=600` for its `ExecStartPre` build.
 *
 * Ninety seconds is therefore the poll ceiling rather than an expectation: on a
 * quiet box it is over in two, and the only thing the ceiling changes is how
 * long we wait before saying `unknown` instead of `pass` — never what we claim.
 */
const WAIT_MS = 90_000;
const POLL_MS = 500;

/**
 * The Overseer daemon polls the dashboard on its own clock — measured at
 * roughly every thirty seconds — and its claim view is `cannot-tell` until it
 * has done so once against the new process. So the blast-radius check gets its
 * own, slower wait, and only when there was a claim to lose: `overseer status`
 * costs a `tsx` start each time, and there is nothing to learn from asking again
 * a second later.
 */
const CLAIM_WAIT_MS = 60_000;
const CLAIM_POLL_MS = 5_000;

/**
 * How long the service has to hold still after it first looks healthy, and it
 * is `RestartSec=10` plus a margin on purpose: the failure being ruled out is a
 * process that binds loopback, answers 200, then fails its second bind and is
 * restarted ten seconds later. A window shorter than `RestartSec` would end
 * before the replacement it is looking for. See `judgeStable`.
 */
const STABILITY_MS = 12_000;

/* ------------------------------------------------------------------ *
 * Facts, gathered
 * ------------------------------------------------------------------ */

function showUnit(io: Io): Ran {
  return io.run(["systemctl", "show", UNIT, ...SHOW_PROPERTIES.flatMap((p) => ["-p", p])]);
}

/**
 * **`FETCH_HEAD`, not `origin/dev`, and the difference is a silent pass.**
 *
 * `git fetch origin dev` only updates the remote-tracking ref `origin/dev` if
 * `remote.origin.fetch` maps that source into it; with a changed or missing
 * refspec the fetch succeeds, writes `FETCH_HEAD`, and leaves a stale
 * `origin/dev` for the comparison. Fetch success plus a stale local ref is a
 * green check about a `dev` from yesterday. `FETCH_HEAD` is the sha this run
 * actually fetched. GPT Sol, 2026-09-09.
 */
function readGit(io: Io, workDir: string): GitRead {
  const fetched = io.run(["git", "-C", workDir, "fetch", "--quiet", "origin", "dev"]);
  if (fetched.status !== 0) return { ok: false, why: `git fetch origin dev failed in ${workDir}: ${oneLine(fetched.stderr)}` };
  const head = io.run(["git", "-C", workDir, "rev-parse", "HEAD"]);
  const dev = io.run(["git", "-C", workDir, "rev-parse", "FETCH_HEAD"]);
  if (head.status !== 0 || dev.status !== 0) return { ok: false, why: `could not resolve HEAD or FETCH_HEAD in ${workDir}: ${oneLine(head.stderr || dev.stderr)}` };
  const fetchedDev = dev.stdout.trim();
  // One command for both sides, so "behind" and "ahead" cannot be counted
  // against two different readings.
  const counts = io.run(["git", "-C", workDir, "rev-list", "--left-right", "--count", `HEAD...${fetchedDev}`]);
  if (counts.status !== 0) return { ok: false, why: `git rev-list failed in ${workDir}: ${oneLine(counts.stderr)}` };
  const parts = counts.stdout.trim().split(/\s+/).map(Number);
  const ahead = parts[0];
  const behind = parts[1];
  if (parts.length !== 2 || ahead === undefined || behind === undefined || !Number.isInteger(ahead) || !Number.isInteger(behind)) {
    return { ok: false, why: `git rev-list printed ${JSON.stringify(counts.stdout.trim())}, which is not two counts` };
  }
  const branch = io.run(["git", "-C", workDir, "rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch.status !== 0) return { ok: false, why: `could not read the branch in ${workDir}: ${oneLine(branch.stderr)}` };
  // **`status --porcelain`, not `diff --name-only`.** A diff sees tracked
  // modifications only, so a brand-new untracked `tools/fleet/whatever.ts` —
  // exactly what a half-finished feature looks like — was invisible to the check
  // meant to catch half-finished features. GPT Sol, 2026-09-09.
  const dirty = io.run(["git", "-C", workDir, "status", "--porcelain", "--", ...FLEET_BUILD_INPUTS]);
  if (dirty.status !== 0) return { ok: false, why: `could not read uncommitted changes in ${workDir}: ${oneLine(dirty.stderr)}` };
  const dirtySrc = io.run(["git", "-C", workDir, "status", "--porcelain", "--", "src"]);
  if (dirtySrc.status !== 0) return { ok: false, why: `could not read uncommitted changes under src/ in ${workDir}: ${oneLine(dirtySrc.stderr)}` };
  return {
    ok: true,
    head: head.stdout.trim(),
    fetchedDev,
    behind,
    ahead,
    branch: branch.stdout.trim(),
    dirtyFleetFiles: porcelainPaths(dirty.stdout),
    dirtySrcFiles: porcelainPaths(dirtySrc.stdout),
  };
}

/** `XY <path>`, or `XY <old> -> <new>` for a rename; we want the path it is now. */
function porcelainPaths(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter((path) => path !== "")
    .map((path) => path.split(" -> ").at(-1) as string);
}

async function readQueue(io: Io, port: number): Promise<QueueRead> {
  const res = await io.http(`http://127.0.0.1:${port}/api/actions`, 10_000);
  if (res.status === null) return { ok: false, why: `GET /api/actions did not answer: ${res.why}` };
  if (res.status !== 200) return { ok: false, why: `GET /api/actions returned ${res.status}` };
  try {
    return summariseQueues(JSON.parse(res.body));
  } catch {
    return { ok: false, why: "GET /api/actions did not return JSON" };
  }
}

/**
 * The `overseer` line of `overseer status`, or null.
 *
 * The checkout's own `tsx`, the way the systemd units do it: `npx tsx` with no
 * local install goes to the network and fetches *some* tsx, and a check that
 * quietly installs a package is not a check.
 */
function readOverseerClaim(io: Io, workDir: string): string | null {
  const tsx = path.join(workDir, "node_modules/.bin/tsx");
  if (!io.exists(tsx)) return null;
  const ran = io.run([tsx, "scripts/overseer.ts", "status"], workDir);
  if (ran.status !== 0) return null;
  return ran.stdout.split("\n").find((l) => l.startsWith("overseer ")) ?? null;
}

function readCgroupPids(io: Io, controlGroup: string): number[] | null {
  if (controlGroup === "") return null;
  const text = io.readFile(path.join("/sys/fs/cgroup", controlGroup, "cgroup.procs"));
  return text === null ? null : parseCgroupProcs(text);
}

/**
 * The listening sockets, or null if `ss` did not succeed.
 *
 * Null rather than the partial stdout: a non-zero `ss` that printed some of its
 * table would otherwise be enough to prove ownership, and — worse, before a
 * restart — an `ss` that failed and printed nothing read as *"nothing else
 * holds the port"*. That is a refusal turned into a pass by a command that did
 * not run. GPT Sol, 2026-09-09.
 */
function readListeners(io: Io): { listeners: Listener[] | null; why: string } {
  const ran = io.run(["ss", "-ltnpH"]);
  if (ran.status !== 0) return { listeners: null, why: oneLine(ran.stderr) || `ss exited ${ran.status}` };
  return { listeners: parseListeners(ran.stdout), why: "" };
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

const HELP = [
  "fleet-restart — restart the fleet dashboard, with the checks that make it safe",
  "",
  "  npx tsx scripts/fleet-restart.ts check                   preconditions only; never restarts",
  "  npx tsx scripts/fleet-restart.ts restart                 preconditions, restart, then verify",
  "  npx tsx scripts/fleet-restart.ts restart --discard-queue restart even with steering items",
  "                                                           queued, printing every one it discards",
  "",
  `  The unit is fixed (${UNIT}) and there is no flag to change it.`,
  "",
  "  exit 0 all clear · 2 a precondition refused, nothing was restarted",
  "       3 the restart COMMAND failed (the postflight still ran and is printed)",
  "       4 restart accepted, but a healthy replacement was not established · 1 unexpected",
].join("\n");

type Args = { mode: "check" | "restart"; discard: boolean };

/** Every unrecognised argument is an error rather than something ignored: a misspelled `--discard-queue` must not become a refusal nobody expected, and a misspelled mode must not become a restart. */
function parseArgs(argv: string[]): Args | { say: string; code: number } {
  let mode: "check" | "restart" | null = null;
  let discard = false;
  for (const arg of argv) {
    if (arg === "check" || arg === "restart") mode = arg;
    else if (arg === "--discard-queue") discard = true;
    else if (arg === "--help" || arg === "-h") return { say: HELP, code: EXIT_OK };
    else return { say: `fleet-restart: unrecognised argument ${JSON.stringify(arg)}\n\n${HELP}`, code: EXIT_UNEXPECTED };
  }
  if (mode === null) return { say: `fleet-restart: say 'check' or 'restart'.\n\n${HELP}`, code: EXIT_UNEXPECTED };
  return { mode, discard };
}

/**
 * The facts nothing else can be measured without, or a sentence saying why the
 * run stops here.
 *
 * These are separated from the checks below because they are not verdicts: a
 * `WorkingDirectory` this cannot read is not a *failing* check, it is the
 * absence of the thing every later check would be about — and the alternative
 * to refusing is a confident BUNDLE MATCH concerning a directory the unit does
 * not serve.
 */
type Ground = { facts: UnitFacts; port: number; portSource: string; builtIndex: string };

function ground(io: Io): Ground | { refuse: string } {
  const shown = showUnit(io);
  if (shown.status !== 0) return { refuse: `systemctl show ${UNIT} failed: ${oneLine(shown.stderr)}` };
  const unit = readUnit(parseShow(shown.stdout));
  if (!unit.ok) return { refuse: unit.why };

  const port = resolvePort(unit.facts.environment);
  if (!port.ok) return { refuse: port.why };

  // The bundle PATH, not the bundle: `ExecStartPre` rebuilds `dist/` on every
  // start, so a checkout that has never been built is an ordinary state and not
  // a refusal. What would not be ordinary is a WorkingDirectory that is not a
  // checkout of this repo at all — then every later comparison would be against
  // somebody else's files.
  const webDir = path.join(unit.facts.workDir, "tools/fleet/web");
  if (!io.exists(webDir)) return { refuse: `${UNIT}'s WorkingDirectory is ${unit.facts.workDir}, which has no tools/fleet/web — cannot confirm which bundle it serves` };

  return { facts: unit.facts, port: port.port, portSource: port.source, builtIndex: path.join(unit.facts.workDir, DIST_INDEX) };
}

export async function main(argv: string[], io: Io = realIo): Promise<number> {
  const args = parseArgs(argv);
  if ("say" in args) {
    io.out(args.say);
    return args.code;
  }
  const { mode, discard } = args;

  const base = ground(io);
  if ("refuse" in base) {
    io.out(`REFUSED: ${base.refuse}`);
    return EXIT_REFUSED;
  }
  const { facts, builtIndex } = base;
  const port = { port: base.port, source: base.portSource };

  // **`inactive` and `failed` are the only two states with no queue to lose.**
  // The first version asked `activeState === "active"` and treated everything
  // else as dead — which would have read `deactivating` and `reloading`, both
  // of which still hold the old process and its queue, as nothing to protect.
  // The safe direction is the other one: anything that is not plainly stopped
  // gets its queue read, and a queue that cannot be read then blocks.
  const serviceUp = facts.activeState !== "inactive" && facts.activeState !== "failed";
  const overseerBefore = readOverseerClaim(io, facts.workDir);
  const git = readGit(io, facts.workDir);
  const before = readListeners(io);

  // LAST, deliberately. This is a snapshot of something another process is
  // free to change, and everything above it takes seconds — a `git fetch` over
  // the network and a `tsx` start. Reading it here shrinks the window between
  // "the queue was empty" and the restart from seconds to milliseconds. It does
  // not close it, and nothing here can: the real fix is an atomic quiesce in
  // the dashboard itself, which belongs to tools/fleet/ and is noted in the
  // plan as a follow-up for its owner. GPT Sol, 2026-09-09.
  const queue = serviceUp ? await readQueue(io, port.port) : ({ ok: true, items: [], holds: [] } as QueueRead);

  const preconditions: Check[] = [
    { name: "unit", verdict: "pass", detail: `${UNIT} loaded from ${facts.fragmentPath}, ${facts.activeState} (${facts.subState}), WorkingDirectory ${facts.workDir}` },
    { name: "port", verdict: "pass", detail: `${port.port}, from ${port.source}` },
    { name: "bundle path", verdict: "pass", detail: builtBundleNote(io, builtIndex) },
    before.listeners === null
      ? { name: "port not a stranger's", verdict: "unknown", detail: `ss failed (${before.why}), so it cannot be shown that nothing else holds ${port.port}` }
      : judgePortIsFree(before.listeners, port.port, readCgroupPids(io, facts.controlGroup), serviceUp),
    judgeBranch(git),
    judgeBehind(git),
    judgeDirty(git),
    srcDirtNote(git),
    judgeQueue(serviceUp, queue, discard),
  ];

  for (const line of renderQueueItems(queue, io.now())) io.out(line);
  for (const line of renderReport(mode === "check" ? `fleet-restart check — ${UNIT}` : `fleet-restart restart — ${UNIT}, before`, preconditions)) io.out(line);
  io.out(`  overseer before: ${overseerBefore ?? "(overseer status could not be read)"}`);

  if (preconditions.some(blocks)) {
    io.out("");
    io.out("REFUSED — nothing was restarted.");
    return EXIT_REFUSED;
  }
  if (mode === "check") {
    io.out("");
    io.out(serviceUp ? "Preconditions pass and the service is up. Nothing was restarted; say 'restart' instead of 'check' to do it." : `Preconditions pass, but ${UNIT} is ${facts.activeState} — this says it is safe to attempt a restart, not that the service is healthy.`);
    return EXIT_OK;
  }

  /* --- the one thing this script is for --- */

  // **THE SECOND LOOK, WITH NOTHING BETWEEN IT AND THE `sudo`.** The queue is a
  // snapshot of something other processes write to, and everything above —
  // rendering the report, printing it — takes time. This re-reads it as the last
  // act before the restart and refuses if anything arrived in the meantime.
  //
  // It does not close the race and is not claimed to: an instruction enqueued in
  // the microseconds after this response is still lost silently. Nothing a
  // *restarter* can do from outside closes it; that needs an atomic quiesce in
  // the dashboard — one call that stops accepting steering, returns the state,
  // and lets the caller restart knowing nothing arrived. That is `tools/fleet/`
  // and is written up in the plan as a follow-up for its owner. Raised twice by
  // GPT Sol, 2026-09-09, and it was right both times.
  if (serviceUp && !discard && (await somethingArrived(io, port.port))) return EXIT_REFUSED;

  io.out("");
  io.out(`restarting ${UNIT} …`);
  const restarted = io.run(["sudo", "-n", "systemctl", "restart", UNIT]);
  const failed = restarted.status !== 0;
  if (failed) io.out(`RESTART COMMAND FAILED (exit ${restarted.status}): ${oneLine(restarted.stderr) || "(no stderr)"}`);

  // **The postflight runs either way**, because the command's outcome and the
  // service's outcome are two different facts. `systemctl restart` can fail
  // having already stopped the old process, and returning here would leave the
  // operator with a non-zero exit and no idea whether anything is serving. GPT
  // Sol, 2026-09-09.
  const checks = await verify(io, { before: facts, port: port.port, builtIndex, overseerBefore });
  io.out("");
  for (const line of renderReport(`fleet-restart restart — ${UNIT}, after`, checks)) io.out(line);
  if (failed) return EXIT_RESTART_FAILED;
  return checks.some(blocks) ? EXIT_UNVERIFIED : EXIT_OK;
}

/** The second queue read's verdict, printed here so the caller stays one decision wide. */
async function somethingArrived(io: Io, port: number): Promise<boolean> {
  const again = await readQueue(io, port);
  const arrived = judgeQueue(true, again, false);
  if (!blocks(arrived)) return false;
  for (const line of renderQueueItems(again, io.now())) io.out(line);
  io.out("");
  io.out(`REFUSED — nothing was restarted. The steering queue changed between the check above and the restart: ${arrived.detail}`);
  return true;
}

/**
 * Wait for it to come back, then say what came back.
 *
 * The waiting is the part that is easy to get wrong: `systemctl restart` returns
 * when `ExecStart` is forked, so the first connection refused after it is the
 * expected state and not a failure — see `WAIT_MS`.
 */
async function verify(io: Io, ctx: { before: UnitFacts; port: number; builtIndex: string; overseerBefore: string | null }): Promise<Check[]> {
  const deadline = io.now() + WAIT_MS;
  let after = ctx.before;
  let http = await io.http(`http://127.0.0.1:${ctx.port}/`, 5_000);
  while (io.now() < deadline) {
    const again = readUnit(parseShow(showUnit(io).stdout));
    if (again.ok) after = again.facts;
    http = await io.http(`http://127.0.0.1:${ctx.port}/`, 5_000);
    if (http.status === 200 && after.activeState === "active") break;
    // **`failed` IS NOT TERMINAL HERE, and the first version breaking on it was
    // wrong.** Under `Restart=always` a failed start is followed by another
    // `activating` after `RestartSec=10`, so stopping at the first `failed`
    // reports a verdict about an attempt rather than about the service. Only a
    // healthy sample or the deadline ends this loop. GPT Sol, 2026-09-09.
    await io.sleep(POLL_MS);
  }

  // The first healthy sample, kept as the baseline for the stability window.
  const firstSeenAt = io.now();
  const pidAtStart = after.mainPid;
  const restartsAtStart = after.restarts;

  // **EVERY WAIT HAPPENS BEFORE THE FINAL SAMPLE, and the ordering is the whole
  // point.** The first version sampled systemd and HTTP, then waited up to sixty
  // seconds for the Overseer daemon, then read `ss` — so the process could die
  // and be replaced during that wait, and ownership would describe the new pid
  // while every other judgment described the old one. All passing. That is the
  // "observations from two different servers" class the stability window was
  // added to remove, reintroduced by the check that came after it. GPT Sol,
  // 2026-09-09.
  //
  // The window is therefore at least STABILITY_MS and, when the claim is being
  // waited on, considerably more — which only makes the check stronger, so it
  // reports the time it actually measured rather than the constant.
  await io.sleep(STABILITY_MS);
  const claim = await settledClaim(io, ctx.before.workDir, ctx.overseerBefore);

  const settledShow = showUnit(io);
  const settled = settledShow.status === 0 ? readUnit(parseShow(settledShow.stdout)) : ({ ok: false, why: `systemctl show failed: ${oneLine(settledShow.stderr)}` } as const);
  // **A FAILED FINAL READ IS NOT THE EARLIER READING.** Leaving `after` at the
  // first sample made `judgeStable(200, 0, 200, 0)` pass on an observation that
  // never happened — the second look is the entire check. GPT Sol, 2026-09-09.
  if (settled.ok) after = settled.facts;
  http = await io.http(`http://127.0.0.1:${ctx.port}/`, 5_000);
  const windowMs = io.now() - firstSeenAt;

  const { listeners, why: ssWhy } = readListeners(io);

  return [
    settled.ok ? judgeActive(after) : { name: "active", verdict: "unknown", detail: `the unit could not be read after the wait — ${settled.why}` },
    settled.ok ? judgeReplaced(ctx.before.mainPid, after.mainPid) : { name: "process replaced", verdict: "unknown", detail: "the unit could not be read after the wait" },
    settled.ok ? judgeFlapping(ctx.before.restarts, after.restarts) : { name: "not crash-looping", verdict: "unknown", detail: "the unit could not be read after the wait" },
    settled.ok
      ? judgeStable(pidAtStart, restartsAtStart, after.mainPid, after.restarts, windowMs)
      : { name: "stable", verdict: "unknown", detail: `nothing was observed after the ${Math.round(windowMs / 1000)}s window — the second look is the whole of this check, and it did not happen` },
    listeners === null
      ? { name: "listener", verdict: "unknown", detail: `ss failed (${ssWhy}), so nothing can be shown to own the port` }
      : judgeListener(listeners, ctx.port, readCgroupPids(io, after.controlGroup)),
    judgeHttp(http.status, http.why, ctx.port),
    judgeBundle(bundleRef(io.readFile(ctx.builtIndex) ?? ""), bundleRef(http.body)),
    judgeOverseerClaim(ctx.overseerBefore, claim.line, claim.waitedMs),
    resultLine(after, settled.ok),
  ];
}

/**
 * systemd's own account of the last run, carried into the report as an
 * always-passing line rather than a verdict.
 *
 * It judges nothing — it is the evidence an operator needs to tell a failed
 * `ExecStartPre` build from a port collision from a missing tailnet address,
 * none of which "HTTP never answered" distinguishes.
 */
function resultLine(after: UnitFacts, fresh: boolean): Check {
  const facts = `${after.activeState} (${after.subState}), Result=${after.result || "(none)"}, ExecMainStatus=${after.execMainStatus || "(none)"}, NRestarts=${Number.isNaN(after.restarts) ? "(none)" : after.restarts}`;
  // Dated, because a stale reading presented as a current one is the failure
  // this whole file is about — the judgments above go `unknown` when the final
  // read fails, and this line must not quietly go on sounding current.
  return { name: "systemd says", verdict: "pass", detail: fresh ? facts : `${facts} — BUT THIS IS THE READING FROM BEFORE THE WAIT; the final systemctl show failed` };
}

/**
 * Wait for the Overseer daemon to have looked at the restarted dashboard once,
 * so the claim check reads a settled answer rather than the tick of blindness
 * every restart causes. Skipped entirely when there was no claim before, since
 * there is then nothing this could conclude.
 */
async function settledClaim(io: Io, workDir: string, before: string | null): Promise<{ line: string | null; waitedMs: number }> {
  if (claimState(before) !== "holder") return { line: before, waitedMs: 0 };
  const started = io.now();
  let line = readOverseerClaim(io, workDir);
  while (claimState(line) === "cannot-tell" && io.now() - started < CLAIM_WAIT_MS) {
    await io.sleep(CLAIM_POLL_MS);
    line = readOverseerClaim(io, workDir);
  }
  return { line, waitedMs: io.now() - started };
}

function builtBundleNote(io: Io, builtIndex: string): string {
  const built = bundleRef(io.readFile(builtIndex) ?? "");
  if (built.kind === "one") return `${builtIndex} currently loads ${built.name}`;
  if (built.kind === "several") return `${builtIndex} loads ${built.names.join(" and ")}`;
  return `${builtIndex} — not built yet; the unit's ExecStartPre builds it on start`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.log(`fleet-restart: ${(error as Error).stack ?? String(error)}`);
      process.exit(EXIT_UNEXPECTED);
    });
}
