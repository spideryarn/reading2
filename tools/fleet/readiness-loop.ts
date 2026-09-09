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
 * Three kills in the tab's window are evidence about the box rather than bad
 * luck. Bound the retries there instead of burning another 26 minutes forever.
 */
export const MAX_VOID_RETRIES = 3;

export type TickDecision =
  | { kind: "run"; sha: string }
  | { kind: "skip"; why: string };

export type AdmissionReadings = Parameters<typeof decideAdmission>[0];

export type HealthReadings = Pick<HealthReport, "load" | "memory" | "swap" | "disk" | "swapActivity">;

export type TickHistory = Pick<StoreRead, "readings" | "unreadable">;

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
  const settled = relevant
    .filter((reading) => reading.state === "pass" || reading.state === "fail")
    .sort((a, b) => b.atMs - a.atMs)[0];
  if (settled !== undefined) {
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
  if (voids.length >= MAX_VOID_RETRIES) {
    return {
      kind: "skip",
      why:
        `The box has killed this commit's full check ${voids.length} times in the Readiness tab's ` +
        `${WINDOW_HOURS}-hour window. Stop retrying ${shortSha(sha)} and inspect the box.`,
    };
  }
  const newestVoid = voids[0];
  if (newestVoid !== undefined && input.nowMs - newestVoid.atMs < VOID_RETRY_COOLDOWN_MS) {
    return {
      kind: "skip",
      why:
        `The box killed the latest full check for ${shortSha(sha)} less than ` +
        `${VOID_RETRY_COOLDOWN_MS / 60_000} minutes ago. Wait for that cooldown before asking the same box again.`,
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
