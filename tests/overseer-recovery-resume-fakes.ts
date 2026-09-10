/**
 * The fakes both resume suites drive: a launch port that keeps the launch
 * protocol's rules, an account port, a per-account usage reading, and a clock.
 * Not a test file.
 *
 * THE PORT COUNTS INVOCATIONS TWICE, independently: its own `invocations`
 * counter, and one line per invocation appended to a marker file on disk. A
 * pass that did nothing cannot satisfy both by accident, and a test reads the
 * marker rather than trusting the object it handed in.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

import type { RecoveryResumeAccount } from "../tools/fleet/wire.js";
import type { AccountUsageSection, StoredAccountUsage } from "../tools/overseer/launch-gate.js";
import type { RecoveryCandidateId } from "../tools/overseer/recovery.js";
import type { AccountRecheck, ResumeAccountPort, ResumeLaunchOutcome, ResumeLaunchRequest, ResumeOccurrence } from "../tools/overseer/recovery-resume.js";

const IN_FLIGHT = new Set(["planned", "waiting-admission", "reserved", "launching", "observed-running", "outcome-unknown"]);

/** What a scripted launch does instead of the default invocation. It may set the occurrence itself. */
export type ScriptedLaunch = (input: { request: ResumeLaunchRequest; occurrenceId: string; attempt: number; port: FakePort }) => ResumeLaunchOutcome;

export type FakePort = {
  kind: "wired";
  inspect(candidateId: RecoveryCandidateId): ResumeOccurrence | null;
  inFlight(): readonly ResumeOccurrence[];
  launch(request: ResumeLaunchRequest): ResumeLaunchOutcome;
  /**
   * The protocol's `resumeOccurrence` semantics (G13): an unknown occurrence
   * is `refused`; only `planned` or `waiting-admission` is driven, anything
   * else is `not-launchable` and nothing is invoked.
   */
  drive(candidateId: RecoveryCandidateId): ResumeLaunchOutcome;
  /** Every `launch` call, in order. */
  calls: ResumeLaunchRequest[];
  /** Every `drive` call, in order — including the ones the protocol answered not-launchable. */
  drives: string[];
  /** The launcher invoked (an `invoked` answer). Also written, one line each, to `markerPath`. */
  invocations: number;
  occurrences: Map<string, ResumeOccurrence>;
  /** Consumed one per call, before the default. */
  script: ScriptedLaunch[];
  markerPath: string;
  /** Change an occurrence as the protocol would have (observed-running, completed, disposed, …). */
  set(candidateId: string, changes: Partial<ResumeOccurrence>): void;
};

export function fakePort(markerPath: string): FakePort {
  const port: FakePort = {
    kind: "wired",
    calls: [],
    drives: [],
    invocations: 0,
    occurrences: new Map(),
    script: [],
    markerPath,
    inspect: (candidateId) => port.occurrences.get(candidateId) ?? null,
    inFlight: () => [...port.occurrences.values()].filter((o) => IN_FLIGHT.has(o.state) || o.reservationHeld),
    set(candidateId, changes) {
      const held = port.occurrences.get(candidateId);
      if (held === undefined) throw new Error(`no occurrence for ${candidateId}`);
      port.occurrences.set(candidateId, { ...held, ...changes });
    },
    launch(request) {
      port.calls.push(request);
      const existing = port.occurrences.get(request.candidateId);
      // THE PROTOCOL'S RULES: one occurrence per candidate, and only a
      // released, undisposed failed-before-launch may try again.
      const retryable = existing !== undefined && existing.state === "failed-before-launch" && !existing.reservationHeld && !existing.disposed;
      if (existing !== undefined && !retryable) {
        return { kind: "not-launchable", occurrenceId: existing.occurrenceId, state: existing.state, why: `${existing.occurrenceId} is ${existing.state}; it is not launched again` };
      }
      const occurrenceId = existing?.occurrenceId ?? `lo-${request.candidateId}`;
      const attempt = (existing?.attempt ?? 0) + 1;
      const scripted = port.script.shift();
      if (scripted !== undefined) return scripted({ request, occurrenceId, attempt, port });
      port.occurrences.set(request.candidateId, {
        candidateId: request.candidateId,
        occurrenceId,
        state: "launching",
        attempt,
        reservationHeld: true,
        disposed: false,
        endedAt: null,
        completion: null,
      });
      port.invocations += 1;
      appendFileSync(markerPath, `${JSON.stringify({ candidateId: request.candidateId, attempt, conversationId: request.conversationId, dir: request.dir })}\n`);
      return { kind: "invoked", occurrenceId, correlationId: `ri-correlation-${attempt}`, launcher: "started", detail: "the fake launcher" };
    },
    drive(candidateId) {
      port.drives.push(candidateId);
      const existing = port.occurrences.get(candidateId);
      if (existing === undefined) return { kind: "refused", why: `no occurrence for ${candidateId} is in the journal` };
      if (existing.state !== "planned" && existing.state !== "waiting-admission") {
        return { kind: "not-launchable", occurrenceId: existing.occurrenceId, state: existing.state, why: `${existing.occurrenceId} is ${existing.state}; only a planned or waiting occurrence is resumed` };
      }
      const attempt = (existing.attempt ?? 0) + 1;
      port.occurrences.set(candidateId, { ...existing, state: "launching", attempt, reservationHeld: true });
      port.invocations += 1;
      appendFileSync(markerPath, `${JSON.stringify({ candidateId, attempt, driven: true })}\n`);
      return { kind: "invoked", occurrenceId: existing.occurrenceId, correlationId: `ri-correlation-${attempt}`, launcher: "started", detail: "the fake launcher, driving a stored occurrence" };
    },
  };
  return port;
}

/** Lines in the marker file: the independent count of launcher invocations. */
export function markerLines(path: string): { candidateId: string; attempt: number }[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { candidateId: string; attempt: number });
}

export type FakeAccounts = ResumeAccountPort & { resolveCalls: number; rechecks: number };

/**
 * An account port that pins every conversation to one pool account (or answers
 * `account`). Its evidence is unchanged unless `recheck` says otherwise (G11).
 */
export function fakeAccounts(options: { account?: RecoveryResumeAccount; recheck?: () => AccountRecheck } = {}): FakeAccounts {
  const accounts: FakeAccounts = {
    resolveCalls: 0,
    rechecks: 0,
    async resolve() {
      accounts.resolveCalls += 1;
      return {
        account: options.account ?? { kind: "pinned", name: "ri-pool", configDir: "/nonexistent/ri-pool-config" },
        recheck: () => {
          accounts.rechecks += 1;
          return options.recheck?.() ?? { kind: "same" };
        },
      };
    },
  };
  return accounts;
}

/**
 * One Claude account's section of the per-account usage reading, dev's shape
 * (launch-gate.ts § `AccountUsageSection`), read at `takenAtMs`. The reset is
 * spelled the way the live endpoint spells it — microseconds and `+00:00` —
 * so nothing here only works in the canonical form.
 */
export function usageSection(name: string, percent: number, takenAtMs: number, resetsAtMs = takenAtMs + 3 * 60 * 60_000): AccountUsageSection {
  return {
    name,
    role: "pool",
    origin: "registered",
    displayEmail: null,
    takenAt: new Date(takenAtMs).toISOString(),
    family: "claude",
    providerAccountId: "ri-provider-account",
    // Both named windows: `accountQuotaGate` requires five_hour AND seven_day (a
    // missing one is unknown). seven_day sits well under any threshold.
    reading: {
      kind: "windows",
      windows: [
        { kind: "value", window: "five_hour", utilizationPercent: percent, resetsAt: liveSpelling(resetsAtMs) },
        { kind: "value", window: "seven_day", utilizationPercent: 10, resetsAt: liveSpelling(resetsAtMs) },
      ],
    },
  };
}

/** `2026-09-10T08:50:00.391562+00:00`: the live endpoint's spelling of an instant. */
export function liveSpelling(ms: number): string {
  return new Date(ms).toISOString().replace(/\.(\d{3})Z$/, ".$1562+00:00");
}

export function storedUsage(sections: readonly AccountUsageSection[], collectedAtMs: number, problems: readonly string[] = []): StoredAccountUsage {
  return { kind: "reading", collectedAt: new Date(collectedAtMs).toISOString(), accounts: sections, problems };
}

/** A clock a test moves by hand. */
export function mutableClock(startIso: string): { now: () => Date; advance: (ms: number) => void; ms: () => number } {
  let ms = Date.parse(startIso);
  return { now: () => new Date(ms), advance: (by) => (ms += by), ms: () => ms };
}
