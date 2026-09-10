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
import type {
  AccountUsageSection,
  StoredAccountUsage,
  StoredUsage,
  UsageLevel,
  UsageWindowCard,
} from "../fleet/wire.js";

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
  return combine([readUsage(input.usage, input.nowMs, input.usageStaleAfterMs), readHealth(input.health)], input.onUnknown);
}

/**
 * THE HEALTH HALF ALONE — the box, and nothing about any quota. The same
 * rules `launchGate` applies to health (critical holds, strained is clear with
 * a note, unreadable goes to `onUnknown`), factored out so gradual recovery
 * can pair it with `accountQuotaGate` instead of the ambient usage report
 * (plan 260910f, G4 disposition). `launchGate` is unchanged.
 */
export function healthGate(health: unknown, onUnknown: "hold" | "clear"): LaunchGate {
  return combine([readHealth(health)], onUnknown);
}

/*
 * The daemon's per-account usage reading (docs/project/usage-per-account.md),
 * re-exported from wire.ts so the recovery modules and their fakes name one
 * type through this gate. Stage 1 was built against local copies before dev's
 * types reached this branch; the merge replaced them with these.
 */
export type { AccountUsageSection, StoredAccountUsage, UsageWindowCard };

/** At or past this a window holds. */
const QUOTA_APPROACHING_PERCENT = 80;

function windowLabel(window: unknown): string {
  if (window === "five_hour") return "5-hour";
  if (window === "seven_day") return "7-day";
  return typeof window === "string" ? `"${window}"` : "an unnamed";
}

/**
 * One account's section, judged. Every rule is the coordinator's for plan
 * 260910f's G4, and the order within is: positive evidence holds (several
 * joined, `until` the latest), then anything unknown, then fine.
 */
function readAccountSection(section: unknown, nowMs: number, staleAfterMs: number): Finding {
  const s = record(section);
  if (s === null) return { kind: "unknown", why: "no usage reading for the account" };
  const name = typeof s["name"] === "string" ? s["name"] : "the account";
  if (s["family"] !== "claude") return { kind: "unknown", why: `${name} is not a Claude account` };
  const reading = record(s["reading"]);
  if (reading?.["kind"] === "unknown") {
    return { kind: "unknown", why: `${name}'s usage could not be read${typeof reading["why"] === "string" ? `: ${reading["why"]}` : ""}` };
  }
  if (typeof s["providerAccountId"] !== "string") return { kind: "unknown", why: `${name}'s usage reading proves no account identity` };
  // Date.parse, never a canonical-form check: the live endpoint spells reset
  // instants with microseconds and `+00:00` (usage-per-account.md).
  const takenMs = typeof s["takenAt"] === "string" ? Date.parse(s["takenAt"]) : Number.NaN;
  if (!Number.isFinite(takenMs)) return { kind: "unknown", why: `${name}'s usage reading has no readable time` };
  if (takenMs - nowMs > FUTURE_SKEW_MS) return { kind: "unknown", why: `${name}'s usage reading is dated in the future, so its clock cannot be trusted` };
  if (nowMs - takenMs > staleAfterMs) {
    return { kind: "unknown", why: `${name}'s last usage reading is too old to trust (${Math.round((nowMs - takenMs) / 60_000)} min)` };
  }
  if (reading?.["kind"] !== "windows" || !Array.isArray(reading["windows"])) {
    return { kind: "unknown", why: `${name}'s usage reading is in a shape this build does not recognise` };
  }
  const holds: { why: string; untilMs: number | null }[] = [];
  const unknowns: string[] = [];
  const ignored: string[] = [];
  const seenNamed = new Set<string>();
  for (const raw of reading["windows"] as unknown[]) {
    const card = record(raw);
    const window = card?.["window"];
    const label = windowLabel(window);
    // THE TWO NAMED WINDOWS ARE REQUIRED; A CODENAME WINDOW COUNTS ONLY WITH A
    // NUMBER. The live endpoint sends rotating codename windows at 0% with no
    // reset time, which dev's `windowCard` turns into `unknown` cards: judged
    // as unknown evidence they would hold every resume for ever. A number is
    // positive evidence whatever the window is called, so a numbered codename
    // window is still judged below; an unnumbered one is ignored, and named.
    const named = window === "five_hour" || window === "seven_day";
    if (named) seenNamed.add(window);
    const unreadable = (why: string): void => {
      if (named) unknowns.push(why);
      else ignored.push(`${why} (ignored: only the 5-hour and 7-day windows are required)`);
    };
    switch (card?.["kind"]) {
      case "value": {
        const percent = card["utilizationPercent"];
        if (typeof percent !== "number" || !Number.isFinite(percent)) {
          unreadable(`the ${label} window has no readable percentage`);
          break;
        }
        if (percent >= 100) {
          const resetsAtMs = typeof card["resetsAt"] === "string" ? Date.parse(card["resetsAt"]) : Number.NaN;
          // A limit whose reset has passed is no longer evidence of anything.
          if (!Number.isFinite(resetsAtMs) || resetsAtMs <= nowMs) unreadable(`the ${label} window's limit reset has passed and no newer reading confirms it`);
          else holds.push({ why: `${name} has used its ${label} limit`, untilMs: resetsAtMs });
        } else if (percent >= QUOTA_APPROACHING_PERCENT) {
          holds.push({ why: `${name} is at ${Math.round(percent)}% of its ${label} limit`, untilMs: null });
        }
        break;
      }
      case "expired":
        unreadable(`the ${label} window's reading describes a window that has already reset`);
        break;
      default:
        unreadable(`the ${label} window could not be read`);
        break;
    }
  }
  for (const required of ["five_hour", "seven_day"] as const) {
    if (!seenNamed.has(required)) unknowns.push(`${name}'s reading has no ${windowLabel(required)} window`);
  }
  if (holds.length > 0) {
    const resets = holds.map((h) => h.untilMs).filter((ms): ms is number => ms !== null);
    return { kind: "hold", why: holds.map((h) => h.why).join("; "), untilMs: resets.length > 0 ? Math.max(...resets) : null };
  }
  if (unknowns.length > 0) return { kind: "unknown", why: unknowns.join("; ") };
  if (ignored.length > 0) return { kind: "note", why: ignored.join("; ") };
  return { kind: "fine" };
}

/**
 * THE PINNED ACCOUNT'S OWN QUOTA — the gate gradual recovery pairs with
 * `healthGate`, because a resumed conversation runs under the account whose
 * config directory holds its transcript, and the ambient usage report is about
 * the default login (plan 260910f, G4 disposition). It judges one section of
 * the daemon's per-account usage reading.
 *
 *  - a `value` window at 100% or more holds until its `resetsAt` — unknown if
 *    that is already past; at 80% or more it holds with no `until`;
 *  - `five_hour` and `seven_day` are REQUIRED: either one missing, unreadable,
 *    `expired` or `unknown` makes the section unknown;
 *  - any other (codename) window is judged only when it carries a number; an
 *    `expired` or `unknown` codename window is ignored with a note, because the
 *    live endpoint sends them at 0% with no reset time as a matter of course;
 *  - the section is unknown when it is null, its reading is `unknown`, it is
 *    not a Claude account, its `providerAccountId` is null, or its `takenAt`
 *    is unparseable, older than `staleAfterMs`, or over five minutes ahead.
 *
 * Unknown goes to `onUnknown`. Never throws.
 */
export function accountQuotaGate(section: AccountUsageSection | null, nowMs: number, onUnknown: "hold" | "clear", staleAfterMs: number): LaunchGate {
  return combine([readAccountSection(section, nowMs, staleAfterMs)], onUnknown);
}

/** Two gates' verdicts as one: any hold holds (the latest `until`), otherwise clear with every note. */
export function bothGates(a: LaunchGate, b: LaunchGate): LaunchGate {
  if (a.kind === "held" || b.kind === "held") {
    const held = [a, b].filter((g): g is Extract<LaunchGate, { kind: "held" }> => g.kind === "held");
    const untils = held.map((g) => g.until).filter((u): u is string => u !== null);
    return {
      kind: "held",
      why: held.map((g) => g.why).join("; "),
      until: untils.length > 0 ? untils.reduce((x, y) => (Date.parse(x) >= Date.parse(y) ? x : y)) : null,
    };
  }
  return { kind: "clear", notes: [...a.notes, ...b.notes] };
}

function combine(findings: readonly Finding[], onUnknown: "hold" | "clear"): LaunchGate {
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

  switch (onUnknown) {
    case "hold":
      return { kind: "held", why: unknowns.join("; "), until: null };
    case "clear":
      return { kind: "clear", notes: [...notes, ...unknowns] };
    default: {
      const never: never = onUnknown;
      return never;
    }
  }
}
