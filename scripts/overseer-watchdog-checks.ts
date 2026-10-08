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
import { GIT_TIMEOUT_MS, gitEnv, primaryCheckout } from "../tools/fleet/readiness-git.js";
import { openReadinessStore, readinessDirExists, readinessDirFromEnv } from "../tools/fleet/readiness-store.js";
import { readinessVerdict } from "../tools/fleet/readiness-verdict.js";
import { readinessRunnerPath, type Reading } from "../tools/fleet/readiness.js";
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
  if (session.kind === "cannot-tell") {
    return check("unknown", `last pacer tick ${ageMin} min ago, but the Overseer session could not be read (${session.why})`);
  }
  if (session.kind === "absent") {
    return check("unhealthy", `last pacer tick ${ageMin} min ago, but no Overseer session is running. Start the Overseer, then: ${RECREATE}`);
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
  const ran = spawnSync("tmux", args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: TMUX_TIMEOUT_MS, killSignal: "SIGKILL" });
  if (ran.error !== undefined) return { ok: false, status: null, err: ran.error.message };
  if (ran.status !== 0) return { ok: false, status: ran.status, err: ran.stderr.trim() };
  return { ok: true, out: ran.stdout };
}

/** Only explicit missing-variable / vanished-session answers prove no claim. */
function readOverseerClaim(id: string, ask: typeof tmux): "claimed" | "unclaimed" | "cannot-tell" {
  const role = ask(["show-environment", "-t", id, SESSION_ROLE_ENV]);
  if (role.ok) {
    const lines = role.out.replace(/\n$/, "").split("\n");
    if (lines.length !== 1) return "cannot-tell";
    const line = lines[0] ?? "";
    if (line === `${SESSION_ROLE_ENV}=${OVERSEER_ROLE}`) return "claimed";
    return line.startsWith(`${SESSION_ROLE_ENV}=`) || line === `-${SESSION_ROLE_ENV}` ? "unclaimed" : "cannot-tell";
  }
  const still = ask(["has-session", "-t", id]);
  const missingVariable = role.status === 1 && role.err === `unknown variable: ${SESSION_ROLE_ENV}`;
  const vanished = !still.ok && still.status === 1 && still.err === `can't find session: ${id}`;
  return (still.ok && missingVariable) || vanished ? "unclaimed" : "cannot-tell";
}

/**
 * Who holds the claim, asked the way `scripts/gjd-remote-tmux.ts` asks it: a
 * by-name read, and when that fails, `has-session` to tell *holds no role* from
 * *has gone*. Exactly one line `GJD_ROLE=overseer` is a claim; anything else
 * that is not a clean miss means this session could not be read.
 */
export function findOverseerSession(ask: typeof tmux = tmux): OverseerSession {
  const listed = ask(["list-sessions", "-F", "#{session_id}\t#{session_name}"]);
  if (!listed.ok) {
    // No server is the ordinary "no sessions" of a box nobody has logged in to.
    if (listed.status === 1 && /^(no server running on .+|error connecting to .+ \(No such file or directory\))$/.test(listed.err)) return { kind: "absent" };
    return { kind: "cannot-tell", why: `tmux list-sessions: ${listed.err || `exit ${String(listed.status)}`}` };
  }
  const unreadable: string[] = [];
  for (const line of listed.out.split("\n")) {
    if (line === "") continue;
    const match = /^(\$\d+)\t(.+)$/.exec(line);
    if (match === null) return { kind: "cannot-tell", why: "tmux list-sessions returned an unrecognized session line" };
    const id = match[1] ?? "";
    const name = match[2] ?? "";
    const claim = readOverseerClaim(id, ask);
    if (claim === "claimed") return { kind: "present", name };
    if (claim === "cannot-tell") unreadable.push(name);
  }
  if (unreadable.length > 0) return { kind: "cannot-tell", why: `the role of ${unreadable.join(", ")} could not be read` };
  return { kind: "absent" };
}

/* ------------------------------------------------------------------ *
 * 2. Production behind dev.
 * ------------------------------------------------------------------ */

/** Production may trail dev by this much before it is an alarm. The 3-hourly check aims for six. */
export const MAX_DEPLOY_LAG_MS = 12 * HOUR;

/** How far back to look for observed failures. The store's retention is 7 days. */
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
    stdio: ["ignore", "pipe", "pipe"],
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
  // Explicit destinations do not depend on remote.origin.fetch mapping both
  // branches. Leave FETCH_HEAD alone; this check only consumes tracking refs.
  const fetchArgs = ["fetch", "--quiet", "--atomic", "--no-write-fetch-head", "origin",
    "+refs/heads/dev:refs/remotes/origin/dev", "+refs/heads/main:refs/remotes/origin/main"];
  let fetched = git(cwd, fetchArgs, FETCH_TIMEOUT_MS);
  if (!fetched.ok) fetched = git(cwd, fetchArgs, FETCH_TIMEOUT_MS);
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

/** What the readiness loop's records say about dev, or why they could not be read. */
export type ReadinessStreak =
  /** The store could not be read, or holds nothing from the loop: an input failure. */
  | { kind: "unknown"; why: string }
  | {
      kind: "known";
      head: HeadReadiness;
      /**
       * When dev last stopped having a commit the loop had shown ready, and
       * why it stopped; null when the head is ready, or when no commit in the
       * window was ever ready. See {@link lastReadyInterval}.
       */
      lastReady: ReadyInterval | null;
    };

export type ReadyInterval = { sha: string; untilMs: number; how: "failed" | "moved" | "last-seen" };

export type HeadReadiness =
  | { kind: "ready" }
  /**
   * `sinceMs` is the first observation in the head's ongoing red interval: a
   * lower bound, since the store has no record of when origin/dev moved.
   */
  | { kind: "red"; why: string; sinceMs: number }
  /**
   * Not shown either way yet — usually a head the loop has not reached. That
   * is the ordinary state for half an hour after every push, so it is not an
   * input failure and does not make the check unknown.
   */
  | { kind: "unsettled"; why: string };

/**
 * Replay the shared verdict over chronological prefixes, grouping equal times
 * so input order never decides anything, and call `visit` with each prefix's
 * verdict. Sticky failures, whole-check decomposition and unfinished runs keep
 * exactly readinessVerdict's semantics.
 */
function replay(ordered: readonly Reading[], sha: string, visit: (verdict: ReturnType<typeof readinessVerdict>, atMs: number) => void): void {
  for (let end = 0; end < ordered.length; ) {
    const atMs = ordered[end]?.atMs ?? 0;
    do end += 1;
    while (end < ordered.length && ordered[end]?.atMs === atMs);
    visit(readinessVerdict({ readings: ordered.slice(0, end), devSha: sha, caveat: "", unreadable: 0 }), atMs);
  }
}

/**
 * Two facts from the loop's records: where dev's head stands now (and, when
 * red, since when at least), and the last time any dev commit was shown ready.
 * Only runs in the loop's own checkout count — the exact path, which is also
 * the deploy evidence reader's boundary; a pass in some agent's worktree is
 * about a commit that may never have been dev's head.
 */
export function readinessStreak(
  read: { readings: readonly Reading[]; unreadable: number },
  devSha: string,
  nowMs: number,
  windowMs: number,
  runnerCwd: string,
): ReadinessStreak {
  if (read.unreadable > 0) {
    return { kind: "unknown", why: `${read.unreadable} readiness record(s) could not be read, and the newest may be the one that matters` };
  }
  const readings = read.readings.filter((r) => r.record.cwd === runnerCwd);
  if (readings.length === 0) {
    return { kind: "unknown", why: `the readiness loop recorded nothing in the last ${Math.round(windowMs / HOUR)} hours` };
  }
  // A read can race a finishing run; the pacer's clock slack covers that.
  if (readings.some((r) => !Number.isFinite(r.atMs) || r.atMs > nowMs + FUTURE_SLACK_MS)) {
    return { kind: "unknown", why: "the readiness loop has a record with an invalid or future observation time" };
  }
  const ordered = readings.filter((r) => r.atMs >= nowMs - windowMs).sort((a, b) => a.atMs - b.atMs);

  let head: HeadReadiness;
  const now = readinessVerdict({ readings: ordered, devSha, caveat: "", unreadable: 0 });
  if (now.kind === "ready") head = { kind: "ready" };
  else if (now.kind === "unknown") head = { kind: "unsettled", why: now.why };
  else {
    let sinceMs: number | null = null;
    replay(ordered, devSha, (verdict, atMs) => {
      sinceMs = verdict.kind === "not-ready" ? (sinceMs ?? Math.min(atMs, nowMs)) : null;
    });
    head = { kind: "red", why: now.failing.map((e) => `${e.check}: ${e.why}`).join("; "), sinceMs: sinceMs ?? nowMs };
  }

  return { kind: "known", head, lastReady: head.kind === "ready" ? null : lastReadyInterval(ordered) };
}

const shaOf = (r: Reading): string | null => (r.record.treeAtStart.kind === "known" ? r.record.treeAtStart.sha : null);

/**
 * The ready interval that ended most recently, over all commits the loop ran.
 *
 * Each commit's verdict is replayed over its own readings, so a later failure
 * cannot erase the time it was ready. An interval ends when the commit fails
 * again, or when dev moves on — seen as the loop's first run on another commit
 * after it became ready, since the loop only ever tests dev's head. One with
 * no later evidence either way ends at the newest reading: it was still ready
 * then, and nothing says for how much longer.
 */
function lastReadyInterval(ordered: readonly Reading[]): ReadyInterval | null {
  const bySha = new Map<string, Reading[]>();
  for (const r of ordered) {
    const sha = shaOf(r);
    if (sha === null) continue;
    bySha.set(sha, [...(bySha.get(sha) ?? []), r]);
  }
  const newestMs = ordered.at(-1)?.atMs ?? 0;
  let best: ReadyInterval | null = null;
  for (const [sha, list] of bySha) {
    let fromMs: number | null = null;
    let end: { untilMs: number; how: "failed" | "moved" | "last-seen" } | null = null;
    replay(list, sha, (verdict, atMs) => {
      if (verdict.kind === "ready") {
        if (fromMs === null) fromMs = atMs;
        end = null;
      } else if (fromMs !== null) {
        end = { untilMs: atMs, how: "failed" };
        fromMs = null;
      }
    });
    if (fromMs !== null) {
      const readyFrom: number = fromMs;
      const next = ordered.find((r) => shaOf(r) !== null && shaOf(r) !== sha && Date.parse(r.record.startedAt) >= readyFrom);
      end = next !== undefined ? { untilMs: Date.parse(next.record.startedAt), how: "moved" } : { untilMs: newestMs, how: "last-seen" };
    }
    const ended: { untilMs: number; how: "failed" | "moved" | "last-seen" } | null = end;
    if (ended !== null && (best === null || ended.untilMs > best.untilMs)) best = { sha, ...ended };
  }
  return best;
}

/** The store's own reader over the window. Never creates the directory. */
export function readReadinessStreak(devSha: string, nowMs: number, windowMs: number = READINESS_WINDOW_MS): ReadinessStreak {
  const dir = readinessDirFromEnv();
  if (!readinessDirExists(dir)) return { kind: "unknown", why: `there is no readiness store at ${dir}` };
  const opened = openReadinessStore(dir);
  if (opened.kind === "refused") return { kind: "unknown", why: opened.why };
  const read = opened.store.read({ sinceMs: nowMs - windowMs, nowMs });
  const primary = primaryCheckout(process.cwd());
  if ("why" in primary) return { kind: "unknown", why: primary.why };
  return readinessStreak({ readings: read.readings, unreadable: read.unreadable.length }, devSha, nowMs, windowMs, readinessRunnerPath(primary.path));
}

/** Hours to print; a lower bound rounds down so it never overstates the evidence. */
function hours(ms: number, lowerBound = false): string {
  const h = Math.max(0, ms / HOUR);
  if (lowerBound) return h < 10 ? (Math.floor(h * 10) / 10).toFixed(1) : String(Math.floor(h));
  return h < 10 ? h.toFixed(1) : String(Math.round(h));
}

function describeStreak(streak: ReadinessStreak, nowMs: number, windowMs: number): string {
  if (streak.kind === "unknown") return `whether dev is deployable is unknown: ${streak.why}`;
  const { head, lastReady } = streak;
  if (head.kind === "ready") return "dev's head is ready to deploy";
  const headLine =
    head.kind === "red"
      ? `dev's head has been red for at least ${hours(nowMs - head.sinceMs, true)} hours (${head.why})`
      : `dev's head is not yet shown ready (${head.why})`;
  const ended = { failed: "when it failed a rerun", moved: "when dev moved past it", "last-seen": "when it was last seen" } as const;
  const passLine =
    lastReady === null
      ? `the readiness loop has passed no dev commit in the last ${hours(windowMs)} hours`
      : `dev has been undeployable for about ${hours(nowMs - lastReady.untilMs)} hours: the last commit the readiness loop ` +
        `passed, ${lastReady.sha.slice(0, 9)}, stopped counting at ${new Date(lastReady.untilMs).toISOString()}, ${ended[lastReady.how]}`;
  return `${passLine}; ${headLine}`;
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
  // Within the threshold, an unreadable readiness store still stops this
  // reading as ok; a head the loop has not reached yet does not.
  const quiet: CheckState = streak.kind === "unknown" ? "unknown" : "ok";
  if (trunk.oldestUndeployed === null) {
    return check(quiet, `production (origin/main ${trunk.mainSha.slice(0, 9)}) has everything on dev. ${readiness}`);
  }
  const lagMs = nowMs - trunk.oldestUndeployed.committedAtMs;
  const behind =
    `production is ${hours(lagMs)} hours behind dev: ${trunk.undeployed} commit(s) on origin/dev are not on origin/main, ` +
    `the oldest ${trunk.oldestUndeployed.sha.slice(0, 9)} committed ${new Date(trunk.oldestUndeployed.committedAtMs).toISOString()}`;
  if (lagMs <= maxLagMs) return check(quiet, `${behind}. ${readiness}`);
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
