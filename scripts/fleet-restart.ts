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
  summariseQueues,
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
  // Tracked modifications only, and only under the directory ExecStartPre
  // builds — see `judgeDirty`. `--` keeps the pathspec unambiguous.
  const dirty = io.run(["git", "-C", workDir, "diff", "--name-only", "HEAD", "--", "tools/fleet"]);
  if (dirty.status !== 0) return { ok: false, why: `could not read uncommitted changes in ${workDir}: ${oneLine(dirty.stderr)}` };
  return {
    ok: true,
    head: head.stdout.trim(),
    fetchedDev,
    behind,
    ahead,
    branch: branch.stdout.trim(),
    dirtyFleetFiles: dirty.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== ""),
  };
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

export async function main(argv: string[], io: Io = realIo): Promise<number> {
  const args = parseArgs(argv);
  if ("say" in args) {
    io.out(args.say);
    return args.code;
  }
  const { mode, discard } = args;

  /* --- the unit, and the two facts everything else is measured against --- */
  const shown = showUnit(io);
  if (shown.status !== 0) {
    io.out(`REFUSED: systemctl show ${UNIT} failed: ${oneLine(shown.stderr)}`);
    return EXIT_REFUSED;
  }
  const unit = readUnit(parseShow(shown.stdout));
  if (!unit.ok) {
    io.out(`REFUSED: ${unit.why}`);
    return EXIT_REFUSED;
  }
  const facts = unit.facts;

  const port = resolvePort(facts.environment);
  if (!port.ok) {
    io.out(`REFUSED: ${port.why}`);
    return EXIT_REFUSED;
  }

  // The bundle PATH, not the bundle: `ExecStartPre` rebuilds `dist/` on every
  // start, so a checkout that has never been built is an ordinary state and not
  // a refusal. What would not be ordinary is a WorkingDirectory that is not a
  // checkout of this repo at all — then every later comparison would be against
  // somebody else's files.
  const webDir = path.join(facts.workDir, "tools/fleet/web");
  if (!io.exists(webDir)) {
    io.out(`REFUSED: ${UNIT}'s WorkingDirectory is ${facts.workDir}, which has no ${path.relative(facts.workDir, webDir)} — cannot confirm which bundle it serves`);
    return EXIT_REFUSED;
  }
  const builtIndex = path.join(facts.workDir, DIST_INDEX);

  // **`inactive` and `failed` are the only two states with no queue to lose.**
  // The first version asked `activeState === "active"` and treated everything
  // else as dead — which would have read `deactivating` and `reloading`, both
  // of which still hold the old process and its queue, as nothing to protect.
  // The safe direction is the other one: anything that is not plainly stopped
  // gets its queue read, and a queue that cannot be read then blocks.
  const serviceUp = facts.activeState !== "inactive" && facts.activeState !== "failed";
  const overseerBefore = readOverseerClaim(io, facts.workDir);
  const git = readGit(io, facts.workDir);
  const listenersBefore = parseListeners(io.run(["ss", "-ltnpH"]).stdout);

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
    judgePortIsFree(listenersBefore, port.port, readCgroupPids(io, facts.controlGroup), serviceUp),
    judgeBranch(git),
    judgeBehind(git),
    judgeDirty(git),
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

  // The stability window: hold still past RestartSec and ask again. See
  // `judgeStable` — one healthy instant is what a crash loop is made of.
  const pidAtStart = after.mainPid;
  const restartsAtStart = after.restarts;
  await io.sleep(STABILITY_MS);
  const settled = readUnit(parseShow(showUnit(io).stdout));
  if (settled.ok) after = settled.facts;
  http = await io.http(`http://127.0.0.1:${ctx.port}/`, 5_000);

  const claim = await settledClaim(io, ctx.before.workDir, ctx.overseerBefore);
  const listeners = parseListeners(io.run(["ss", "-ltnpH"]).stdout);
  return [
    judgeActive(after),
    judgeReplaced(ctx.before.mainPid, after.mainPid),
    judgeFlapping(ctx.before.restarts, after.restarts),
    judgeStable(pidAtStart, restartsAtStart, after.mainPid, after.restarts, STABILITY_MS),
    judgeListener(listeners, ctx.port, readCgroupPids(io, after.controlGroup)),
    judgeHttp(http.status, http.why, ctx.port),
    judgeBundle(bundleRef(io.readFile(ctx.builtIndex) ?? ""), bundleRef(http.body)),
    judgeOverseerClaim(ctx.overseerBefore, claim.line, claim.waitedMs),
    resultLine(after),
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
function resultLine(after: UnitFacts): Check {
  return { name: "systemd says", verdict: "pass", detail: `${after.activeState} (${after.subState}), Result=${after.result || "(none)"}, ExecMainStatus=${after.execMainStatus || "(none)"}, NRestarts=${Number.isNaN(after.restarts) ? "(none)" : after.restarts}` };
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
  return built === null ? `${builtIndex} — not built yet; the unit's ExecStartPre builds it on start` : `${builtIndex} currently names ${built}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.log(`fleet-restart: ${(error as Error).stack ?? String(error)}`);
      process.exit(EXIT_UNEXPECTED);
    });
}
