#!/usr/bin/env -S npx tsx
/**
 * `box-health` — tells the Overseer when the box's health needs it, every ten
 * minutes from `box-health.timer`. Plan docs/plans/261010d-standing-jobs-survive-a-reboot.md.
 *
 * > They'd probably also report on box health, so hard disk space, RAM, swap,
 * > CPU load. […] if they don't have anything to report, that they don't—maybe
 * > they don't need to actually inject anything into the overseer's context.
 * >
 * > — Greg, 2026-10-09 (`spya-q2qb7q`)
 *
 * **It measures nothing of its own.** The fleet dashboard already collects
 * load, memory, swap, swap movement, `/` and `/home` (tools/fleet/health.ts)
 * against cutoffs kept in one place (tools/fleet/resource-policy.ts). This calls
 * the same `collectHealth` and reads the same verdict. What was missing was
 * delivery: the verdict reached a tile, the Overseer's hand-run tick and the
 * launch gate, and nothing told anybody when it went bad. GPT Sol's plan-review
 * finding 3.
 *
 * ## What counts as worth a message
 *
 * **`critical` or `unknown`, and any disk at `strained`.** Not `strained` in
 * general: measured over the dashboard's own history, 2026-10-02 to 10-10,
 * 7,446 of 9,886 samples were `strained`, almost all "actively swapping", and
 * the level changed 2,586 times — an alarm on that is noise. `critical` was 40
 * samples in eight days. Disk is the exception because a disk fills one way and
 * does not flap; `/home` went from comfortable to 100 % inside a day on
 * 2026-10-05 and took the Overseer daemon down.
 *
 * ## When to say it
 *
 * The alarm is a SET of keys (`critical`, `unknown`, `disk:/`, `disk:/home`).
 * A key that was not in the last message is said at once. A smaller set, or an
 * empty one, is said only after `HOLD_RUNS` runs in a row (half an hour), so a
 * reading that flaps around a cutoff is one message, not twenty. An unchanged
 * set is said again once a day. Nothing alarming and nothing said: silence.
 * The journal gets one line per run regardless — that is free.
 *
 * ## Delivered once
 *
 * The envelope is written into the state file BEFORE it is posted, and an
 * uncertain post is retried with that same envelope on the next run, which the
 * dashboard answers from its receipt rather than typing again
 * (scripts/box-notify.ts). No new message is decided while one is pending.
 *
 * Exit 1 while an alarm holds or a message is undelivered, so `systemctl
 * --failed` and the journal agree; the overseer-watchdog does the same.
 * `console.log`, not src/log.ts: a CLI under systemd (docs/project/logging.md).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { collectHealth, type HealthReport } from "../tools/fleet/health.js";
import { RESOURCE_POLICY } from "../tools/fleet/resource-policy.js";
import {
  describeBoxNotify,
  oneLine,
  postEnvelope,
  prepareEnvelope,
  type BoxEnvelope,
  type BoxNotifyOutcome,
  type NotifyOptions,
} from "./box-notify.js";

/** How many runs in a row a smaller alarm set must hold before it is said. Ten-minute timer: half an hour. */
export const HOLD_RUNS = 3;
/** How often an unchanged alarm is said again. */
export const REMIND_MS = 24 * 3_600_000;

export type AlarmKey = "critical" | "unknown" | "disk:/" | "disk:/home" | "units:cannot-tell" | `failed:${string}`;

/**
 * The box's own units whose `failed` state is an alarm. Each of the oneshot
 * jobs exits nonzero when it could not do its work, so a `failed` here is that job
 * saying so — and this is the one path by which it reaches the Overseer,
 * rather than every job growing its own notifier. It also carries the
 * overseer-watchdog's verdict, which until now reached only the journal
 * (261008g § "No new alert channel"). Not `box-health.service` itself: a
 * failed run of this is a run that could not say anything.
 */
export const WATCHED_UNITS = [
  "overseer.service",
  "fleet-dashboard.service",
  "overseer-watchdog.service",
  "box-tidy.service",
  "worktree-sweep.service",
  "dashboard-refresh.service",
  "feedback-sweep.service",
] as const;

export type UnitsReading = { kind: "read"; failed: string[] } | { kind: "cannot-tell"; why: string };

/**
 * `systemctl is-failed <units…>` prints one state per unit, in order, and exits
 * 0 only when one of them is failed — so the exit status is not the error
 * signal; a line count that does not match is.
 */
export function parseIsFailed(stdout: string, units: readonly string[]): UnitsReading {
  const lines = stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length !== units.length) return { kind: "cannot-tell", why: `systemctl is-failed printed ${lines.length} states for ${units.length} units` };
  const known = new Set(["active", "reloading", "inactive", "failed", "activating", "deactivating", "maintenance"]);
  const unknown = lines.find((line) => !known.has(line));
  if (unknown !== undefined) return { kind: "cannot-tell", why: `systemctl is-failed printed an unknown state: ${unknown}` };
  return { kind: "read", failed: units.filter((_, i) => lines[i] === "failed") };
}

/** The alarm in one report: its keys, sorted, and the sentences to say about it. */
export function alarmOf(report: Pick<HealthReport, "verdict" | "disk" | "homeDisk">, units: UnitsReading): { keys: AlarmKey[]; reasons: string[] } {
  const keys = new Set<AlarmKey>();
  const reasons = [...report.verdict.reasons];
  if (report.verdict.level === "critical") keys.add("critical");
  if (report.verdict.level === "unknown") keys.add("unknown");
  // At or above, as computeVerdict compares it.
  if (report.disk.kind === "value" && report.disk.usePercent >= RESOURCE_POLICY.diskUsed.strained) keys.add("disk:/");
  const home = report.homeDisk;
  if (home !== undefined && home.kind === "value" && home.usePercent >= RESOURCE_POLICY.diskUsed.strained) keys.add("disk:/home");
  if (units.kind === "cannot-tell") {
    keys.add("units:cannot-tell");
    reasons.push(`cannot tell which of the box's units have failed: ${units.why}`);
  } else {
    for (const u of units.failed) {
      keys.add(`failed:${u}`);
      reasons.push(`${u} failed its last run — journalctl -u ${u} -n 20`);
    }
  }
  return { keys: [...keys].sort(), reasons };
}

function readUnits(): UnitsReading {
  const r = spawnSync("systemctl", ["is-failed", ...WATCHED_UNITS], { encoding: "utf8", timeout: 20_000 });
  if (r.error !== undefined) return { kind: "cannot-tell", why: r.error.message };
  return parseIsFailed(r.stdout, WATCHED_UNITS);
}

/** What was last DELIVERED to the Overseer — not what was last measured. */
export type Said = { keys: AlarmKey[]; at: string };

export type Pending =
  | { phase: "waiting"; text: string; says: Said }
  | { phase: "ready"; text: string; envelope: BoxEnvelope; to: string; says: Said };
export type ReadyPending = Extract<Pending, { phase: "ready" }>;

export type BoxHealthState = {
  said: Said;
  /** Consecutive runs whose alarm set was a strict subset of `said.keys`. */
  shrinkRuns: number;
  pending: Pending | null;
};

export const EMPTY_STATE: BoxHealthState = { said: { keys: [], at: new Date(0).toISOString() }, shrinkRuns: 0, pending: null };

export type Decision = { kind: "silent" } | { kind: "alarm" | "reminder" | "clear" | "narrower"; keys: AlarmKey[]; text: string };

/**
 * Whether to say anything, given what was last said, and the new `shrinkRuns`.
 * Pure: the clock and the reasons come in.
 */
export function decide(
  alarm: { keys: AlarmKey[]; reasons: string[] },
  level: string,
  state: Pick<BoxHealthState, "said" | "shrinkRuns">,
  nowMs: number,
): { decision: Decision; shrinkRuns: number } {
  const now = new Set(alarm.keys);
  const before = new Set(state.said.keys);
  const gained = alarm.keys.filter((k) => !before.has(k));
  const lost = state.said.keys.filter((k) => !now.has(k));
  const why = `${level}: ${alarm.reasons.join("; ")}`;

  if (gained.length > 0) {
    return { decision: { kind: "alarm", keys: alarm.keys, text: `box health ALARM (${alarm.keys.join(", ")}) — ${why}. Runbook: docs/project/hetzner-remote-server-box.md; history: journalctl -u box-health.` }, shrinkRuns: 0 };
  }
  if (lost.length > 0) {
    const runs = state.shrinkRuns + 1;
    if (runs < HOLD_RUNS) return { decision: { kind: "silent" }, shrinkRuns: runs };
    if (alarm.keys.length === 0) {
      return { decision: { kind: "clear", keys: [], text: `box health: all clear again for ${HOLD_RUNS} checks in a row (was ${state.said.keys.join(", ")}) — ${why}.` }, shrinkRuns: 0 };
    }
    return { decision: { kind: "narrower", keys: alarm.keys, text: `box health: ${lost.join(", ")} cleared; still ${alarm.keys.join(", ")} — ${why}.` }, shrinkRuns: 0 };
  }
  if (alarm.keys.length > 0 && nowMs - Date.parse(state.said.at) >= REMIND_MS) {
    return { decision: { kind: "reminder", keys: alarm.keys, text: `box health, still (since ${state.said.at}): ${alarm.keys.join(", ")} — ${why}.` }, shrinkRuns: 0 };
  }
  return { decision: { kind: "silent" }, shrinkRuns: 0 };
}

/**
 * What a post's outcome does to the state. `sent` and `abandoned` count as said
 * (an abandoned envelope may have been typed, and must not be typed again);
 * `not-sent` drops only the envelope so the same intent can be addressed
 * afresh; `uncertain` keeps the exact envelope for the next run to resend.
 */
export function settle(state: BoxHealthState, pending: ReadyPending, outcome: BoxNotifyOutcome, nowMs = Date.parse(pending.says.at)): BoxHealthState {
  switch (outcome.kind) {
    case "sent":
    case "abandoned":
      return { ...state, said: { ...pending.says, at: new Date(nowMs).toISOString() }, pending: null };
    case "not-sent":
      return { ...state, pending: { phase: "waiting", text: pending.text, says: pending.says } };
    case "uncertain":
      return { ...state, pending };
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

/* ------------------------------------------------------------------ */
/* State file                                                          */
/* ------------------------------------------------------------------ */

/**
 * Where what was said is recorded. Under systemd, `StateDirectory=box-health`
 * — /var/lib/box-health, on the ROOT disk. Not ~/.overseer: that is on /home,
 * and since nothing is posted that cannot first be recorded, a full /home would
 * silence exactly the alarm about /home filling (2026-10-05). Run by hand, the
 * old place.
 */
export function statePath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env["BOX_HEALTH_STATE"];
  if (explicit !== undefined) return explicit;
  const dir = env["STATE_DIRECTORY"];
  if (dir !== undefined && dir !== "") return path.join(dir.split(":")[0] ?? dir, "box-health.json");
  return path.join(homedir(), ".overseer", "box-health.json");
}

function parseState(v: unknown): BoxHealthState | null {
  if (typeof v !== "object" || v === null) return null;
  const s = v as Record<string, unknown>;
  const said = s["said"] as Partial<Said> | null;
  if (typeof said !== "object" || said === null || !Array.isArray(said.keys) || typeof said.at !== "string" || typeof s["shrinkRuns"] !== "number") return null;
  const cleanSaid: Said = { keys: said.keys as AlarmKey[], at: said.at };
  const base = { said: cleanSaid, shrinkRuns: s["shrinkRuns"] as number };
  const raw = s["pending"];
  if (raw === null) return { ...base, pending: null };
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  const pendingSaid = p["says"] as Partial<Said> | null;
  if (typeof pendingSaid !== "object" || pendingSaid === null || !Array.isArray(pendingSaid.keys) || typeof pendingSaid.at !== "string") return null;
  const says: Said = { keys: pendingSaid.keys as AlarmKey[], at: pendingSaid.at };
  if (p["phase"] === "waiting" && typeof p["text"] === "string") return { ...base, pending: { phase: "waiting", text: p["text"], says } };
  if (p["phase"] === "ready" && typeof p["text"] === "string" && typeof p["to"] === "string" && typeof p["envelope"] === "object" && p["envelope"] !== null) {
    return { ...base, pending: { phase: "ready", text: p["text"], to: p["to"], envelope: p["envelope"] as BoxEnvelope, says } };
  }
  // Compatibility with the first build of this change, before the durable
  // intent gained an explicit phase. Its envelope is already safe to replay.
  const oldEnvelope = p["envelope"] as Partial<BoxEnvelope> | null;
  if (typeof p["to"] === "string" && typeof oldEnvelope === "object" && oldEnvelope !== null && typeof oldEnvelope.text === "string") {
    return { ...base, pending: { phase: "ready", text: oldEnvelope.text, to: p["to"], envelope: oldEnvelope as BoxEnvelope, says } };
  }
  return null;
}

/** The state, or `EMPTY_STATE` with a sentence when there is none or it will not parse. */
export function readState(file: string): { state: BoxHealthState; note: string | null; usable: boolean } {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { state: EMPTY_STATE, note: null, usable: true };
    return { state: EMPTY_STATE, note: `cannot read ${file} (${(e as Error).message}); refusing to guess what was sent`, usable: false };
  }
  try {
    const parsed = parseState(JSON.parse(raw) as unknown);
    if (parsed !== null) return { state: parsed, note: null, usable: true };
  } catch {
    /* below */
  }
  return { state: EMPTY_STATE, note: `${file} is not a box-health state file; refusing to guess what was sent`, usable: false };
}

export function writeState(file: string, s: BoxHealthState): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(s)}\n`);
  renameSync(tmp, file);
}

/* ------------------------------------------------------------------ */
/* One run                                                             */
/* ------------------------------------------------------------------ */

export type RunDeps = {
  collect: () => Pick<HealthReport, "verdict" | "disk" | "homeDisk">;
  units: () => UnitsReading;
  file: string;
  now: () => number;
  notify: NotifyOptions;
  notifyEnabled: boolean;
  log: (line: string) => void;
};

/** Persist, or say why not. /home full is one of the alarms, so a failed write is expected sometimes. */
function persist(deps: RunDeps, s: BoxHealthState): boolean {
  try {
    writeState(deps.file, s);
    return true;
  } catch (e) {
    deps.log(`state: could not write ${deps.file} (${(e as Error).message}); refusing to post without durable state`);
    return false;
  }
}

async function post(deps: RunDeps, state: BoxHealthState, pending: ReadyPending, label: string): Promise<{ state: BoxHealthState; outcome: BoxNotifyOutcome; persisted: boolean }> {
  const outcome = await postEnvelope(pending.envelope, pending.to, deps.notify);
  deps.log(`${label}: ${describeBoxNotify(outcome)}`);
  const next = settle(state, pending, outcome, deps.now());
  return { state: next, outcome, persisted: persist(deps, next) };
}

/** Advance one durable intent. Every network attempt is preceded by a state write. */
async function deliverPending(
  deps: RunDeps,
  state: BoxHealthState,
  label: string,
): Promise<{ state: BoxHealthState; outcome: BoxNotifyOutcome; persisted: boolean }> {
  let pending = state.pending;
  if (pending === null) throw new Error("deliverPending called without a pending message");
  if (pending.phase === "waiting") {
    const prepared = await prepareEnvelope(pending.text, deps.notify);
    if (prepared.kind !== "ready") {
      deps.log(`${label}: NOT told the Overseer, nothing typed — ${prepared.why}`);
      return { state, outcome: prepared, persisted: true };
    }
    pending = { ...pending, phase: "ready", envelope: prepared.envelope, to: prepared.to };
    state = { ...state, pending };
    if (!persist(deps, state)) return { state, outcome: { kind: "not-sent", why: "could not persist the prepared envelope" }, persisted: false };
  }
  return post(deps, state, pending, label);
}

/** One timer tick. Returns the exit code. */
export async function runOnce(deps: RunDeps): Promise<number> {
  const report = deps.collect();
  const alarm = alarmOf(report, deps.units());
  deps.log(`${report.verdict.level}${alarm.keys.length > 0 ? ` — ALARM ${alarm.keys.join(", ")}` : ""}: ${alarm.reasons.join("; ")}`);
  const unhealthy = alarm.keys.length > 0;

  const read = readState(deps.file);
  if (read.note !== null) deps.log(`state: ${read.note}`);
  if (!read.usable) return 1;
  let state = read.state;

  // A message from an earlier run whose delivery was uncertain goes first, as
  // the SAME envelope, and nothing new is decided while it is unsettled.
  if (state.pending !== null) {
    if (!deps.notifyEnabled) {
      deps.log("an earlier message is pending and --no-notify was given; not resending");
      return 1;
    }
    const r = await deliverPending(deps, state, "pending message from an earlier run");
    state = r.state;
    if (!r.persisted || state.pending !== null) return 1;
  }

  const { decision, shrinkRuns } = decide(alarm, report.verdict.level, state, deps.now());
  state = { ...state, shrinkRuns };
  if (decision.kind === "silent") {
    return persist(deps, state) ? (unhealthy ? 1 : 0) : 1;
  }
  if (!deps.notifyEnabled) {
    deps.log(`would tell the Overseer (${decision.kind}), --no-notify given: ${oneLine(decision.text)}`);
    return unhealthy ? 1 : 0;
  }

  const pending: Pending = {
    phase: "waiting",
    text: oneLine(decision.text),
    says: { keys: decision.keys, at: new Date(deps.now()).toISOString() },
  };
  state = {
    ...state,
    shrinkRuns: decision.kind === "clear" || decision.kind === "narrower" ? HOLD_RUNS - 1 : state.shrinkRuns,
    pending,
  };
  // The intent itself is durable before target lookup. Otherwise a dashboard
  // outage followed by a healthy reading silently loses a transient alarm.
  if (!persist(deps, state)) return 1;
  const r = await deliverPending(deps, state, decision.kind);
  return !r.persisted || unhealthy || r.outcome.kind !== "sent" ? 1 : 0;
}

function isMain(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && path.resolve(entry).endsWith(path.join("scripts", "box-health.ts"));
}

if (isMain()) {
  runOnce({
    collect: () => collectHealth(),
    units: readUnits,
    file: statePath(),
    now: Date.now,
    notify: {},
    notifyEnabled: !process.argv.includes("--no-notify"),
    log: (line) => console.log(line),
  }).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(`box-health crashed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      process.exit(2);
    },
  );
}
