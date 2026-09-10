/**
 * THE ONE LAUNCH GATE: is the box healthy enough, and is the Claude quota far
 * enough from its limits, to start one more Claude session now?
 *
 * Two Overseer launchers ask it — gradual recovery (`recovery-resume.ts`, which
 * passes `onUnknown: "hold"`) and the scheduler (`scheduled-dispatch`, which
 * passes `"clear"`) — and both IMPORT this rather than writing a second one, so
 * the two cannot drift into disagreeing about what "healthy" means. The plan is
 * docs/plans/260910f-gradual-recovery-resume-selected-interrupted-work-one-at-a-time.md
 * § 2, items 4–5.
 *
 * A pure leaf: no I/O, no clock (`nowMs` is an input), type-only imports. It is
 * fed the accepted snapshot's opaque `health` JSON and a stored usage reading,
 * so it parses both defensively and NEVER THROWS — a shape it cannot read is
 * unknown evidence, never an exception and never "fine".
 *
 * THE RULES, in order of precedence:
 *
 *  1. Positive evidence always holds, whatever `onUnknown` says: usage
 *     `limited` (until the active limit's reset), usage `approaching`, health
 *     `critical`. Several are all named, and `until` is the latest reset,
 *     because that is the moment work can actually resume. A `limited` whose
 *     reset is already past is no longer evidence of anything: it is unknown.
 *  2. `strained` health is clear, with a note.
 *  3. Unknown evidence goes to `onUnknown`. Unknown is: no usage report, a
 *     report older than `usageStaleAfterMs` or undatable or dated more than
 *     five minutes ahead, a usage verdict of `unknown`, and health that is not
 *     an object with a recognised `verdict.level` or whose level is `unknown`.
 *     The same rule `routes-new.ts` applies to a hand-started session: an
 *     unreadable box is what a box too busy to fork looks like.
 *  4. Otherwise clear.
 *
 * `why` and the notes are shown to Greg on a web page, so they are short plain
 * English and never the producer's internal wording.
 */
import type { StoredUsage, UsageLevel } from "../fleet/wire.js";

export type LaunchGate = { kind: "clear"; notes: string[] } | { kind: "held"; why: string; until: string | null };

/**
 * `HealthLevel` from tools/fleet/health.ts, restated rather than imported: this
 * leaf imports types from `wire.ts` only. The four are checked at runtime
 * anyway, because the snapshot carries health as opaque JSON.
 */
type HealthLevel = "ok" | "strained" | "critical" | "unknown";
const HEALTH_LEVELS: readonly HealthLevel[] = ["ok", "strained", "critical", "unknown"];
const USAGE_LEVELS: readonly UsageLevel[] = ["ok", "approaching", "limited", "unknown"];

/** A usage report dated further ahead than this is from a clock we cannot trust. */
const FUTURE_SKEW_MS = 5 * 60_000;

/** What one source says. `untilMs` is only ever a limit's reset instant. */
type Finding =
  | { kind: "fine" }
  | { kind: "hold"; why: string; untilMs: number | null }
  | { kind: "note"; why: string }
  | { kind: "unknown"; why: string };

function record(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/** ISO for a millisecond instant, or null — `toISOString` throws past year 275760. */
function iso(ms: number): string | null {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function readUsage(usage: unknown, nowMs: number, staleAfterMs: number): Finding {
  const stored = record(usage);
  if (stored === null || stored["kind"] === "none") return { kind: "unknown", why: "no usage reading yet" };
  if (stored["kind"] !== "report") return { kind: "unknown", why: "the stored usage reading is in a shape this build does not recognise" };

  const report = record(stored["report"]);
  if (report === null) return { kind: "unknown", why: "the usage report could not be read" };

  // Dated before judged: a stale `limited` is not a limit we know is in force.
  const collectedMs = typeof report["collectedAt"] === "string" ? Date.parse(report["collectedAt"]) : Number.NaN;
  if (!Number.isFinite(collectedMs)) return { kind: "unknown", why: "the usage reading has no readable time" };
  const ageMs = nowMs - collectedMs;
  if (-ageMs > FUTURE_SKEW_MS) {
    return { kind: "unknown", why: "the usage reading is dated in the future, so its clock cannot be trusted" };
  }
  if (ageMs > staleAfterMs) {
    return { kind: "unknown", why: `the last usage reading is too old to trust (${Math.round(ageMs / 60_000)} min)` };
  }

  const verdict = record(report["verdict"]);
  const level = oneOf(verdict?.["level"], USAGE_LEVELS);
  if (verdict === null || level === null) return { kind: "unknown", why: "the usage reading has no readable verdict" };

  switch (level) {
    case "ok":
      return { kind: "fine" };
    case "approaching":
      return { kind: "hold", why: "the Claude account is approaching its usage limit", untilMs: null };
    case "limited": {
      const resetsAtMs = record(verdict["activeLimit"])?.["resetsAtMs"];
      // No readable reset instant: still a limit in force, just without a time.
      if (typeof resetsAtMs !== "number" || !Number.isFinite(resetsAtMs)) {
        return { kind: "hold", why: "the Claude account has hit its usage limit", untilMs: null };
      }
      if (resetsAtMs <= nowMs) {
        return { kind: "unknown", why: "the usage limit's reset time has passed but no newer reading confirms it" };
      }
      return { kind: "hold", why: "the Claude account has hit its usage limit", untilMs: resetsAtMs };
    }
    case "unknown":
      return { kind: "unknown", why: "the usage reading could not tell how close the account is to its limit" };
    default: {
      const never: never = level;
      return never;
    }
  }
}

function readHealth(health: unknown): Finding {
  const report = record(health);
  if (report === null) return { kind: "unknown", why: "no box health reading" };
  const level = oneOf(record(report["verdict"])?.["level"], HEALTH_LEVELS);
  if (level === null) return { kind: "unknown", why: "the box health reading has no recognisable level" };

  switch (level) {
    case "ok":
      return { kind: "fine" };
    case "strained":
      return { kind: "note", why: "the box is strained (load, memory or swap), but not critical" };
    case "critical":
      return { kind: "hold", why: "the box is critical (load, memory or swap)", untilMs: null };
    case "unknown":
      return { kind: "unknown", why: "the box health reading could not read load, memory or swap" };
    default: {
      const never: never = level;
      return never;
    }
  }
}

export function launchGate(input: {
  usage: StoredUsage | null;
  /** The accepted snapshot's opaque `health` JSON (`ObservedSnapshot.health`); parsed here to a level. */
  health: unknown;
  nowMs: number;
  onUnknown: "hold" | "clear";
  /** A usage report whose `collectedAt` is older than this counts as unknown. */
  usageStaleAfterMs: number;
}): LaunchGate {
  const findings = [readUsage(input.usage, input.nowMs, input.usageStaleAfterMs), readHealth(input.health)];

  const holds = findings.filter((f): f is Extract<Finding, { kind: "hold" }> => f.kind === "hold");
  if (holds.length > 0) {
    const resets = holds.map((h) => h.untilMs).filter((ms): ms is number => ms !== null);
    return {
      kind: "held",
      why: holds.map((h) => h.why).join("; "),
      until: resets.length > 0 ? iso(Math.max(...resets)) : null,
    };
  }

  const notes = findings.filter((f) => f.kind === "note").map((f) => f.why);
  const unknowns = findings.filter((f) => f.kind === "unknown").map((f) => f.why);
  if (unknowns.length === 0) return { kind: "clear", notes };

  switch (input.onUnknown) {
    case "hold":
      return { kind: "held", why: unknowns.join("; "), until: null };
    case "clear":
      return { kind: "clear", notes: [...notes, ...unknowns] };
    default: {
      const never: never = input.onUnknown;
      return never;
    }
  }
}
