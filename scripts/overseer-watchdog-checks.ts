/**
 * Two checks `scripts/overseer-watchdog.ts` runs beside its daemon check, both
 * about the Overseer SESSION rather than the daemon: is it still pacing the
 * queue, and is production keeping up with dev?
 *
 * Why they exist: the session's queue pacer is a Claude Code scheduled job, and
 * a recurring one is deleted 7 days after it is made. It expired silently on
 * 2026-10-07 at 23:15 UTC and production went 17 hours undeployed while a red
 * test sat on dev; nothing outside the session noticed. Greg, 2026-10-08:
 * *"Why haven't there been any deploys in 17h? … ideally improve so it's less
 * likely to break going forwards"*. The plan is
 * docs/plans/261008e-watchdog-alarms-for-a-stopped-pacer-and-production-lagging-dev.md;
 * the session side is scripts/overseer-tools/standing-jobs.md.
 *
 * **Three states, and `unknown` is never `ok`** (docs/reusable/silent-success.md).
 * A heartbeat that will not parse, a tmux that cannot be asked, a fetch that
 * failed: each says so, and the watchdog exits non-zero for it, because a check
 * that cannot read its input has not found things healthy.
 *
 * The judging functions are pure and take what was read; the readers beside
 * them do the IO. Same split as `assessWatchdog` / `main` next door.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OVERSEER_ROLE } from "../tools/fleet/overseer-claim.js";
import { GIT_TIMEOUT_MS, gitEnv } from "../tools/fleet/readiness-git.js";
import { openReadinessStore, readinessDirExists, readinessDirFromEnv } from "../tools/fleet/readiness-store.js";
import { readinessVerdict } from "../tools/fleet/readiness-verdict.js";
import { READINESS_RUNNER_WORKTREE, type Reading } from "../tools/fleet/readiness.js";
import { storeRoot } from "../tools/overseer/store.js";
import { SESSION_ROLE_ENV } from "./gjd-remote-tmux.js";

export type CheckState = "ok" | "unhealthy" | "unknown";
export type SessionCheck = { name: "pacer" | "deploy-lag"; state: CheckState; detail: string };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** One line, the way the daemon's verdict is printed: the mark, the name, the state. */
export function formatCheck(check: SessionCheck): string {
  const mark = check.state === "ok" ? "✓" : check.state === "unhealthy" ? "✗" : "?";
  return `${mark} ${check.name} ${check.state} -- ${check.detail}`;
}

/* ------------------------------------------------------------------ *
 * 1. The pacer heartbeat.
 * ------------------------------------------------------------------ */

/**
 * The file each pacer tick writes, `date -u +%FT%TZ > ~/.overseer/pacer-heartbeat`
 * (standing-jobs.md § 1). Read under `storeRoot()`, which is `~/.overseer` on the
 * box: the unit sets `OVERSEER_STORE_DIR` to exactly that, and the pacer's text
 * names the literal path. If either moves, both must.
 */
export const PACER_HEARTBEAT_FILE = "pacer-heartbeat";

/** The pacer runs at :12 and :37, so this is three missed ticks, not one unlucky one. */
export const MAX_PACER_AGE_MS = 90 * MINUTE;

/** How far ahead of this clock a heartbeat may be before it is not believed. */
const FUTURE_SLACK_MS = 5 * MINUTE;

export type HeartbeatRead = { kind: "absent" } | { kind: "unreadable"; why: string } | { kind: "text"; text: string };

/**
 * Whether a tmux session holds the Overseer claim (`GJD_ROLE=overseer`,
 * docs/plans/260908j-mark-one-session-as-the-overseer.md) — by claim rather than
 * by the name "Overseer", since a renamed session is still the Overseer.
 */
export type OverseerSession = { kind: "present"; name: string } | { kind: "absent" } | { kind: "cannot-tell"; why: string };

const RECREATE =
  "Recreate the three jobs in the Overseer session from scripts/overseer-tools/standing-jobs.md, exactly as written, " +
  "and check CronList shows three.";

export function assessPacer(
  heartbeat: HeartbeatRead,
  session: OverseerSession,
  nowMs: number,
  maxAgeMs: number = MAX_PACER_AGE_MS,
): SessionCheck {
  const check = (state: CheckState, detail: string): SessionCheck => ({ name: "pacer", state, detail });

  if (heartbeat.kind === "unreadable") {
    return check("unknown", `the pacer heartbeat exists but could not be read (${heartbeat.why}), so whether the queue is being paced is not known`);
  }
  if (heartbeat.kind === "absent") {
    if (session.kind === "present") {
      return check("unhealthy", `the Overseer session (${session.name}) is running but no pacer tick has ever written a heartbeat: its scheduled jobs are missing. ${RECREATE}`);
    }
    if (session.kind === "absent") {
      return check("unhealthy", `no Overseer session is running and there is no pacer heartbeat, so nothing is pacing the queue or deploying. Start the Overseer, then: ${RECREATE}`);
    }
    return check("unknown", `there is no pacer heartbeat, and whether an Overseer session exists could not be asked (${session.why})`);
  }

  const text = heartbeat.text.trim();
  // The exact shape `date -u +%FT%TZ` writes, and nothing looser: Date.parse
  // accepts a great deal that the pacer never writes.
  const atMs = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(text) ? Date.parse(text) : Number.NaN;
  if (Number.isNaN(atMs)) {
    return check("unknown", `the pacer heartbeat does not hold a UTC time (${JSON.stringify(text.slice(0, 60))}), so its age is not known`);
  }
  const ageMs = nowMs - atMs;
  if (ageMs < -FUTURE_SLACK_MS) {
    return check("unknown", `the pacer heartbeat says ${text}, ${Math.round(-ageMs / MINUTE)} min in the future; a clock is wrong, and its age is not known`);
  }
  const ageMin = Math.max(0, Math.round(ageMs / MINUTE));
  if (ageMs > maxAgeMs) {
    const where =
      session.kind === "present"
        ? `the Overseer session (${session.name}) is still there but has stopped pacing the queue`
        : session.kind === "absent"
          ? "no Overseer session is running, so nothing is pacing the queue"
          : "the Overseer session has stopped pacing the queue";
    return check(
      "unhealthy",
      `last pacer tick ${ageMin} min ago (${text}), over the ${Math.round(maxAgeMs / MINUTE)} min threshold: ${where}, ` +
        `so nothing is releasing work or deploying. ${RECREATE}`,
    );
  }
  return check("ok", `last pacer tick ${ageMin} min ago`);
}

export function readPacerHeartbeat(root: string = storeRoot()): HeartbeatRead {
  try {
    return { kind: "text", text: readFileSync(join(root, PACER_HEARTBEAT_FILE), "utf8") };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", why: `${code ?? "error"}: ${(err as Error).message}` };
  }
}

const TMUX_TIMEOUT_MS = 5_000;

function tmux(args: string[]): { ok: true; out: string } | { ok: false; status: number | null; err: string } {
  const ran = spawnSync("tmux", args, { encoding: "utf8", timeout: TMUX_TIMEOUT_MS, killSignal: "SIGKILL" });
  if (ran.error !== undefined) return { ok: false, status: null, err: ran.error.message };
  if (ran.status !== 0) return { ok: false, status: ran.status, err: ran.stderr.trim() };
  return { ok: true, out: ran.stdout };
}

/**
 * Who holds the claim, asked the way `scripts/gjd-remote-tmux.ts` asks it: a
 * by-name read, and when that fails, `has-session` to tell *holds no role* from
 * *has gone*. Exactly one line `GJD_ROLE=overseer` is a claim; anything else
 * that is not a clean miss means this session could not be read.
 */
export function findOverseerSession(): OverseerSession {
  const listed = tmux(["list-sessions", "-F", "#{session_id}\t#{session_name}"]);
  if (!listed.ok) {
    // No server is the ordinary "no sessions" of a box nobody has logged in to.
    if (/no server running|error connecting to/i.test(listed.err)) return { kind: "absent" };
    return { kind: "cannot-tell", why: `tmux list-sessions: ${listed.err || `exit ${String(listed.status)}`}` };
  }
  const unreadable: string[] = [];
  for (const line of listed.out.split("\n")) {
    if (line === "") continue;
    const [id = "", name = ""] = line.split("\t");
    const role = tmux(["show-environment", "-t", id, SESSION_ROLE_ENV]);
    if (role.ok) {
      const lines = role.out.replace(/\n$/, "").split("\n");
      if (lines.length === 1 && lines[0] === `${SESSION_ROLE_ENV}=${OVERSEER_ROLE}`) return { kind: "present", name };
      if (lines.length !== 1 || !lines[0]?.startsWith(`${SESSION_ROLE_ENV}=`)) unreadable.push(name);
      continue;
    }
    // Not set, or the session went away between the two calls; only a session
    // still there and still unaskable is a hole.
    const still = tmux(["has-session", "-t", id]);
    if (still.ok && role.status === null) unreadable.push(name);
  }
  if (unreadable.length > 0) return { kind: "cannot-tell", why: `the role of ${unreadable.join(", ")} could not be read` };
  return { kind: "absent" };
}

/* ------------------------------------------------------------------ *
 * 2. Production behind dev.
 * ------------------------------------------------------------------ */

/** Production may trail dev by this much before it is an alarm. The 3-hourly check aims for six. */
export const MAX_DEPLOY_LAG_MS = 12 * HOUR;

/** How far back the readiness store is read for the last ready commit. Its retention is 7 days. */
export const READINESS_WINDOW_MS = 72 * HOUR;

/** A fetch goes to GitHub, so it gets longer than the local questions. */
const FETCH_TIMEOUT_MS = 60_000;

export type TrunkRead =
  | { kind: "unknown"; why: string }
  | {
      kind: "known";
      mainSha: string;
      devSha: string;
      /** How many commits `origin/main..origin/dev` holds. */
      undeployed: number;
      /** The one with the oldest committer time, or null when there are none. */
      oldestUndeployed: { sha: string; committedAtMs: number } | null;
    };

function git(cwd: string, args: string[], timeoutMs = GIT_TIMEOUT_MS): { ok: true; out: string } | { ok: false; why: string } {
  const ran = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    // gitEnv strips inherited redirects; no prompt, so a missing credential
    // fails rather than waiting for a terminal a systemd unit does not have.
    env: { ...gitEnv(), GIT_TERMINAL_PROMPT: "0" },
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (ran.error !== undefined) return { ok: false, why: `git ${args[0]}: ${ran.error.message}` };
  if (ran.status !== 0) return { ok: false, why: `git ${args[0]}: ${ran.stderr.trim().split("\n").slice(-1)[0] ?? `exit ${String(ran.status)}`}` };
  return { ok: true, out: ran.stdout.trim() };
}

/**
 * Fetch, then compare. **The fetch is not optional**: the readiness loop is the
 * only other thing on the box that fetches `dev`, so if it has stopped, the
 * local `origin/dev` freezes and the lag would read as nothing. One retry,
 * because the loop's own fetch can hold the ref lock for a moment.
 */
export function readTrunk(cwd: string = process.cwd()): TrunkRead {
  let fetched = git(cwd, ["fetch", "--quiet", "origin", "dev", "main"], FETCH_TIMEOUT_MS);
  if (!fetched.ok) fetched = git(cwd, ["fetch", "--quiet", "origin", "dev", "main"], FETCH_TIMEOUT_MS);
  if (!fetched.ok) return { kind: "unknown", why: `${fetched.why}, so origin/main and origin/dev may be stale` };

  const main = git(cwd, ["rev-parse", "--verify", "origin/main^{commit}"]);
  if (!main.ok) return { kind: "unknown", why: main.why };
  const dev = git(cwd, ["rev-parse", "--verify", "origin/dev^{commit}"]);
  if (!dev.ok) return { kind: "unknown", why: dev.why };
  const log = git(cwd, ["log", "--format=%H %ct", `${main.out}..${dev.out}`]);
  if (!log.ok) return { kind: "unknown", why: log.why };

  let oldest: { sha: string; committedAtMs: number } | null = null;
  let undeployed = 0;
  for (const line of log.out.split("\n")) {
    if (line === "") continue;
    const match = /^([0-9a-f]{40}) (\d+)$/.exec(line);
    if (match === null) return { kind: "unknown", why: `git log printed a line this does not understand: ${JSON.stringify(line.slice(0, 80))}` };
    undeployed += 1;
    const committedAtMs = Number(match[2]) * 1000;
    if (oldest === null || committedAtMs < oldest.committedAtMs) oldest = { sha: match[1] ?? "", committedAtMs };
  }
  return { kind: "known", mainSha: main.out, devSha: dev.out, undeployed, oldestUndeployed: oldest };
}

export type ReadinessStreak =
  | { kind: "unknown"; why: string }
  /** dev's head is ready to deploy. */
  | { kind: "ready"; sha: string }
  | {
      kind: "not-ready";
      /** What `readinessVerdict` says about dev's head: failed, or not yet shown either way. */
      headVerdict: "not-ready" | "unknown";
      why: string;
      /** The newest dev commit the loop showed ready in the window, or null for none. */
      lastReady: { sha: string; atMs: number } | null;
    };

/** A run in the readiness loop's own checkout, the one that only ever tests dev's head. */
function byTheLoop(reading: Reading): boolean {
  return reading.record.cwd.endsWith(`/${READINESS_RUNNER_WORKTREE}`);
}

/**
 * How long dev has gone without a commit the readiness loop showed ready.
 *
 * **Ready means what `readinessVerdict` says it means** — the conjunction of
 * the required checks on one sha, with a known failure sticky — computed once
 * per sha the loop has tested. When dev's head is ready this is `ready`;
 * otherwise "undeployable since" is the newest instant any earlier commit
 * became ready. A loop that has stopped reads as undeployable too, which is
 * true: nobody has shown any commit fit to ship.
 *
 * Only the loop's runs count. A pass in some agent's worktree is about a
 * commit that may never have been dev's head.
 */
export function readinessStreak(
  read: { readings: readonly Reading[]; unreadable: number },
  devSha: string,
  nowMs: number,
  windowMs: number,
): ReadinessStreak {
  if (read.unreadable > 0) {
    return { kind: "unknown", why: `${read.unreadable} readiness record(s) could not be read, and the newest may be the one that matters` };
  }
  const readings = read.readings.filter(byTheLoop);
  if (readings.length === 0) {
    return { kind: "unknown", why: `the readiness loop recorded nothing in the last ${Math.round(windowMs / HOUR)} hours` };
  }

  const verdictOn = (sha: string) => readinessVerdict({ readings, devSha: sha, caveat: "", unreadable: 0 });
  const head = verdictOn(devSha);
  if (head.kind === "ready") return { kind: "ready", sha: devSha };

  let lastReady: { sha: string; atMs: number } | null = null;
  const shas = new Set<string>();
  for (const r of readings) if (r.record.treeAtStart.kind === "known") shas.add(r.record.treeAtStart.sha);
  for (const sha of shas) {
    const v = verdictOn(sha);
    if (v.kind !== "ready") continue;
    // Ready from the moment the last of its required passes landed.
    let atMs = 0;
    for (const e of v.evidence) {
      const at = e.record?.state === "finished" ? Date.parse(e.record.at) : Number.NaN;
      if (!Number.isNaN(at)) atMs = Math.max(atMs, at);
    }
    if (atMs > 0 && atMs <= nowMs && (lastReady === null || atMs > lastReady.atMs)) lastReady = { sha, atMs };
  }

  const why = head.kind === "not-ready" ? head.failing.map((e) => `${e.check}: ${e.why}`).join("; ") : head.why;
  return { kind: "not-ready", headVerdict: head.kind, why, lastReady };
}

/** The store's own reader over the window. Never creates the directory. */
export function readReadinessStreak(devSha: string, nowMs: number, windowMs: number = READINESS_WINDOW_MS): ReadinessStreak {
  const dir = readinessDirFromEnv();
  if (!readinessDirExists(dir)) return { kind: "unknown", why: `there is no readiness store at ${dir}` };
  const opened = openReadinessStore(dir);
  if (opened.kind === "refused") return { kind: "unknown", why: opened.why };
  const read = opened.store.read({ sinceMs: nowMs - windowMs, nowMs });
  return readinessStreak({ readings: read.readings, unreadable: read.unreadable.length }, devSha, nowMs, windowMs);
}

function hours(ms: number): string {
  const h = ms / HOUR;
  return h < 10 ? h.toFixed(1) : String(Math.round(h));
}

function describeStreak(streak: ReadinessStreak, nowMs: number, windowMs: number): string {
  if (streak.kind === "unknown") return `how long dev has been undeployable is not known: ${streak.why}`;
  if (streak.kind === "ready") return `dev's head ${streak.sha.slice(0, 9)} is ready to deploy`;
  const since =
    streak.lastReady === null
      ? `dev has been undeployable for at least ${hours(windowMs)} hours (no commit the readiness loop passed in that window)`
      : `dev has been undeployable for ${hours(nowMs - streak.lastReady.atMs)} hours (the last commit the readiness loop passed was ${streak.lastReady.sha.slice(0, 9)} at ${new Date(streak.lastReady.atMs).toISOString()})`;
  return `${since}; dev's head is ${streak.headVerdict === "not-ready" ? "red" : "not yet shown ready"}: ${streak.why}`;
}

export function assessDeployLag(
  trunk: TrunkRead,
  streak: ReadinessStreak,
  nowMs: number,
  maxLagMs: number = MAX_DEPLOY_LAG_MS,
  windowMs: number = READINESS_WINDOW_MS,
): SessionCheck {
  const check = (state: CheckState, detail: string): SessionCheck => ({ name: "deploy-lag", state, detail });
  if (trunk.kind === "unknown") {
    return check("unknown", `how far production is behind dev could not be read: ${trunk.why}`);
  }
  const readiness = describeStreak(streak, nowMs, windowMs);
  if (trunk.oldestUndeployed === null) {
    return check("ok", `production (origin/main ${trunk.mainSha.slice(0, 9)}) has everything on dev`);
  }
  const lagMs = nowMs - trunk.oldestUndeployed.committedAtMs;
  const behind =
    `production is ${hours(lagMs)} hours behind dev: ${trunk.undeployed} commit(s) on origin/dev are not on origin/main, ` +
    `the oldest ${trunk.oldestUndeployed.sha.slice(0, 9)} committed ${new Date(trunk.oldestUndeployed.committedAtMs).toISOString()}`;
  if (lagMs <= maxLagMs) return check("ok", `${behind}. ${readiness}`);
  return check(
    "unhealthy",
    `${behind}, over the ${hours(maxLagMs)} hour threshold. ${readiness}. ` +
      "Deploy if dev is ready (docs/project/overseer.md § Deploying); if it is red, fix that first. " +
      "If nothing has tried, check the pacer line above.",
  );
}

/* ------------------------------------------------------------------ */

/** Both checks, read from the box. What `main()` in the watchdog calls. */
export function runSessionChecks(nowMs: number = Date.now()): SessionCheck[] {
  const pacer = assessPacer(readPacerHeartbeat(), findOverseerSession(), nowMs);
  const trunk = readTrunk();
  const streak: ReadinessStreak =
    trunk.kind === "known" ? readReadinessStreak(trunk.devSha, nowMs) : { kind: "unknown", why: "origin/dev could not be read" };
  return [pacer, assessDeployLag(trunk, streak, nowMs)];
}
