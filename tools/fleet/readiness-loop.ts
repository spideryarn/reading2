/**
 * The periodic runner's decisions, kept away from the commands that take the
 * readings. `scripts/readiness-loop.ts` owns git, the filesystem, /proc and the
 * database; this module receives their typed answers and decides whether one
 * expensive check would tell the Readiness tab anything new.
 */
import { decideAdmission, type AdmissionDecision } from "../../vitest-admission.js";
import { computeVerdict, type HealthReport } from "./health.js";
import type { DevSnapshot } from "./readiness-git.js";
import type { StoreRead } from "./readiness-store.js";
import { aboutDevTree, readinessVerdict } from "./readiness-verdict.js";
import { WINDOW_HOURS } from "./readiness-wiring.js";
import type { Reading, TreeStamp } from "./readiness.js";

/**
 * Ten minutes between decisions. This is not the run interval: a check takes
 * about 26 minutes, and this number only bounds how soon a new dev head is
 * noticed while the loop is idle.
 */
export const TICK_INTERVAL_MS = 10 * 60 * 1000;

/**
 * A box kill often means transient pressure. Give the same box thirty minutes
 * to clear before asking it to try the same commit again.
 */
export const VOID_RETRY_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * At most three attempts may end without a verdict in one rolling tab window:
 * the initial attempt plus two retries. This is a rate bound, not a lifetime
 * bound; one slot returns when the oldest void ages out of the 24-hour window.
 */
export const MAX_VOIDS_PER_WINDOW = 3;

export type TickDecision =
  | { kind: "run"; sha: string }
  | { kind: "skip"; why: string };

export type AdmissionReadings = Parameters<typeof decideAdmission>[0];

export type HealthReadings = Pick<HealthReport, "load" | "memory" | "swap" | "disk" | "swapActivity">;

export type TickHistory = Pick<StoreRead, "readings" | "unreadable">;

export type PreparationNeeds = {
  dependencies: boolean;
  migrations: boolean;
  fleetClient: boolean;
};

/**
 * Preparation is state convergence, not an edge triggered by one merge.
 * Starting unprepared makes a restarted loop repair an install or migration
 * that the previous process was killed halfway through.
 */
export function initialPreparationNeeds(): PreparationNeeds {
  return { dependencies: true, migrations: true, fleetClient: true };
}

/** Changes that make already-completed preparation stale. */
export function preparationAfterChanges(
  current: PreparationNeeds,
  changedPaths: readonly string[],
): PreparationNeeds {
  return {
    dependencies: current.dependencies || changedPaths.includes("package-lock.json"),
    migrations: current.migrations || changedPaths.some((name) => name.startsWith("drizzle/")),
    fleetClient:
      current.fleetClient ||
      changedPaths.includes("package-lock.json") ||
      changedPaths.includes("vite.fleet.config.ts") ||
      changedPaths.some((name) => name.startsWith("tools/fleet/web/")),
  };
}

export type TickInput = {
  /** Supplied by the caller so this decision takes no clock of its own. */
  nowMs: number;
  /** Why `merge --ff-only` did not happen, or null when it did. */
  fastForwardProblem: string | null;
  dev: DevSnapshot;
  runnerTree: TreeStamp;
  /** Already read over the Readiness tab's own window by the impure caller. */
  history: TickHistory;
  admission: AdmissionReadings;
  health: HealthReadings;
  /** The local database gate's own explanation, or null when it passed. */
  databaseProblem: string | null;
};

const shortSha = (sha: string): string => sha.slice(0, 12);

const oneLine = (text: string): string => text.trim().replace(/\s+/g, " ");

const withPeriod = (text: string): string => (/[^.!?]$/.test(text) ? `${text}.` : text);

function isFullWrapperCheck(reading: Reading, sha: string): boolean {
  const record = reading.record;
  return (
    record.source === "wrapper" &&
    record.check === "check" &&
    record.scope === "full" &&
    record.treeAtStart.kind === "known" &&
    record.treeAtStart.sha === sha &&
    aboutDevTree(reading, sha).ok
  );
}

/**
 * Decide one tick from readings already gathered by the loop. Clause order is
 * deliberate: when several things are wrong, the first sentence is the thing
 * a person has to fix before any later reading can matter.
 */
export function decideTick(input: TickInput): TickDecision {
  if (input.fastForwardProblem !== null) {
    return {
      kind: "skip",
      why: `The runner worktree was not advanced: ${withPeriod(oneLine(input.fastForwardProblem))}`,
    };
  }

  if (input.dev.kind !== "known") {
    return {
      kind: "skip",
      why: `This box could not read origin/dev: ${withPeriod(oneLine(input.dev.why))} No check will run against a guessed commit.`,
    };
  }
  const sha = input.dev.devSha;

  if (input.runnerTree.kind !== "known") {
    return {
      kind: "skip",
      why: `The runner worktree could not be stamped: ${withPeriod(oneLine(input.runnerTree.why))} Look at the worktree before running a check from it.`,
    };
  }

  if (input.runnerTree.sha !== sha) {
    return {
      kind: "skip",
      why:
        `The runner worktree is at ${shortSha(input.runnerTree.sha)} while origin/dev is ${shortSha(sha)}; ` +
        "a check there would answer for the wrong commit.",
    };
  }

  if (input.runnerTree.dirty) {
    return {
      kind: "skip",
      why:
        `The runner worktree at ${shortSha(sha)} has uncommitted changes. Look at it rather than erasing them; ` +
        "it is not the dev tree a record would claim.",
    };
  }

  const verdict = readinessVerdict({
    readings: input.history.readings,
    devSha: sha,
    caveat: input.dev.caveat,
    unreadable: input.history.unreadable.length,
  });
  if (verdict.kind !== "unknown") {
    return {
      kind: "skip",
      why:
        `Readiness already says ${verdict.kind === "ready" ? "ready" : "not ready"} for ${shortSha(sha)}. ` +
        "This loop only turns unknown into an answer, so there is nothing to run.",
    };
  }

  const relevant = input.history.readings.filter((reading) => isFullWrapperCheck(reading, sha));
  const failed = relevant.filter((reading) => reading.state === "fail").sort((a, b) => b.atMs - a.atMs)[0];
  const passed = relevant.filter((reading) => reading.state === "pass").sort((a, b) => b.atMs - a.atMs)[0];
  const settled = failed ?? passed;
  /* A pass is settled only until a later attempt reaches no verdict. The
     verdict above applies that rule too; repeating it here matters when an
     unreadable record has conservatively forced the verdict to unknown. A
     failure is ordinarily caught by the verdict first, but this arm also
     keeps an outer failure sticky when its summary table was incomplete. */
  const laterUnsettled =
    settled === undefined || settled.state === "fail"
      ? undefined
      : relevant.find(
          (reading) =>
            (reading.state === "running" || reading.state === "void") && reading.atMs >= settled.atMs,
        );
  if (settled !== undefined && laterUnsettled === undefined) {
    return {
      kind: "skip",
      why:
        `A full wrapper check already ${settled.state === "pass" ? "passed" : "failed"} on ${shortSha(sha)} ` +
        `in the Readiness tab's ${WINDOW_HOURS}-hour window. That ${settled.state === "pass" ? "pass" : "failure"} ` +
        `is settled, so retrying it would only fish for a different answer.`,
    };
  }

  const running = relevant.filter((reading) => reading.state === "running").sort((a, b) => b.atMs - a.atMs)[0];
  if (running !== undefined) {
    return {
      kind: "skip",
      why:
        `A full wrapper check for ${shortSha(sha)} is already running. That observes a manual run; ` +
        "the process lock, not this record, is what keeps loops exclusive.",
    };
  }

  const voids = relevant.filter((reading) => reading.state === "void").sort((a, b) => b.atMs - a.atMs);
  if (voids.length >= MAX_VOIDS_PER_WINDOW) {
    return {
      kind: "skip",
      why:
        `This commit's full check ended without a verdict ${voids.length} times in the Readiness tab's ` +
        `${WINDOW_HOURS}-hour window. Stop for this window and inspect the recorded reasons.`,
    };
  }
  const newestVoid = voids[0];
  if (newestVoid !== undefined && input.nowMs - newestVoid.atMs < VOID_RETRY_COOLDOWN_MS) {
    return {
      kind: "skip",
      why:
        `The latest full check for ${shortSha(sha)} ended without a verdict less than ` +
        `${VOID_RETRY_COOLDOWN_MS / 60_000} minutes after its recorded instant. Wait for that spacing before trying again.`,
    };
  }

  const admission: AdmissionDecision = decideAdmission(input.admission);
  if (admission.kind === "refuse") {
    return {
      kind: "skip",
      why: `Memory admission refused this check: ${withPeriod(oneLine(admission.message))}`,
    };
  }

  const health = computeVerdict(input.health);
  if (health.level !== "ok") {
    return {
      kind: "skip",
      why: `Box health is ${health.level}: ${withPeriod(oneLine(health.reasons.join("; ")))}`,
    };
  }

  if (input.databaseProblem !== null) {
    return {
      kind: "skip",
      why:
        `The database gate did not pass: ${withPeriod(oneLine(input.databaseProblem))} ` +
        "This is a problem with the box, not a red dev commit.",
    };
  }

  return { kind: "run", sha };
}
