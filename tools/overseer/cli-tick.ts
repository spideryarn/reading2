/** One read-only screen for the Overseer's half-hourly deterministic check. */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { escapeName } from "../../scripts/gjd-remote-tmux.js";
import { collectHealth as collectBoxHealth, type HealthReport } from "../fleet/health.js";
import { claimFromSnapshot, type OverseerClaim } from "../fleet/overseer-claim.js";
import { readCliState } from "./cli-state.js";
import {
  fetchDashboardSnapshot,
  fetchRecentMessages,
  recentLines,
  type DashboardSnapshotRead,
} from "./cli-messages.js";
import { describeAge, statusLines } from "./status-cli.js";
import { KNOWN_USAGE_WINDOWS, parseUsageCache } from "./usage.js";

const FIVE_HOUR_THRESHOLDS = [
  "55 = pause the rest of anything new",
  "70 = pause peers and roadmap work",
  "85 = ease off everything",
] as const;

function reason(cause: unknown): string {
  return cause instanceof Error ? (cause.message === "" ? cause.name : cause.message) : String(cause);
}

function gib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

export function healthLines(report: HealthReport): string[] {
  const load =
    report.load.kind === "value"
      ? `${report.load.load1.toFixed(2)} ${report.load.load5.toFixed(2)} ${report.load.load15.toFixed(2)} (${report.load.cores} cores, 1m ratio ${report.load.ratio1.toFixed(2)})`
      : `unknown — ${report.load.why}`;
  const memory =
    report.memory.kind === "value"
      ? `${(100 - report.memory.availableFraction * 100).toFixed(1)}% used · ${gib(
          report.memory.totalBytes - report.memory.availableBytes,
        )} of ${gib(report.memory.totalBytes)} in use`
      : `unknown — ${report.memory.why}`;
  const swap =
    report.swap.kind === "value"
      ? `${gib(report.swap.usedBytes)} used of ${gib(report.swap.totalBytes)} across ${report.swap.areas} area(s)`
      : report.swap.kind === "none"
        ? "none configured"
        : `unknown — ${report.swap.why}`;
  return [
    `box health  ${report.verdict.level.toUpperCase()} — ${report.verdict.reasons.join("; ")}`,
    `load        ${load}`,
    `memory      ${memory}`,
    `swap        ${swap}`,
  ];
}

function thresholdBand(percent: number): string {
  if (percent >= 85) return "85+: ease off everything";
  if (percent >= 70) return "70–84: pause peers and roadmap work";
  if (percent >= 55) return "55–69: pause the rest of anything new";
  return "below 55: below the pause thresholds";
}

/** The cheap direct cache read; it never turns an absent or expired value into zero. */
export function directUsageLines(claudeJson: unknown, nowMs: number): string[] {
  const reading = parseUsageCache(claudeJson, nowMs);
  const lines = [`thresholds  ${FIVE_HOUR_THRESHOLDS.join(" / ")}`];
  if (reading.kind === "unknown") {
    // The parser explains its refusal with "not 0%". On the operational
    // screen even a negated percentage is a number beside the window, so keep
    // the reason and remove the visually confusable value.
    const why = reading.why.replace("This is not 0% used.", "No utilization percentage is available.");
    lines.push(`usage cache unknown — ${why}`, "five_hour: unknown — threshold band unknown", "seven_day: unknown");
    return lines;
  }
  const age = describeAge(reading.ageMs);
  for (const windowName of KNOWN_USAGE_WINDOWS) {
    const window = reading.windows.find((candidate) => candidate.window === windowName);
    if (window === undefined) {
      lines.push(`${windowName}: unknown (cache ${age} old) — the cache did not carry this window`);
    } else if (window.kind === "value") {
      lines.push(
        `${windowName}: ${window.utilizationPercent}% used (cache ${age} old), resets ${window.resetsAt}` +
          (windowName === "five_hour" ? ` — band ${thresholdBand(window.utilizationPercent)}` : ""),
      );
    } else if (window.kind === "expired") {
      lines.push(
        `${windowName}: unknown (cache ${age} old) — its cached window expired ${describeAge(window.msSinceReset)} ago at ${window.resetsAt}; no current percentage` +
          (windowName === "five_hour" ? " — threshold band unknown" : ""),
      );
    } else {
      lines.push(
        `${windowName}: unknown (cache ${age} old) — ${window.why}` +
          (windowName === "five_hour" ? " — threshold band unknown" : ""),
      );
    }
  }
  return lines;
}

function claimBanner(claim: OverseerClaim): string {
  switch (claim.kind) {
    case "one":
      return `== OVERSEER CLAIM: HELD BY ${escapeName(claim.name)} (${claim.id}) — if that is not this session, STOP AND TELL GREG`;
    case "none":
      return "== OVERSEER CLAIM: NO ONE HOLDS IT — take the claim before acting";
    case "contested":
      return `== OVERSEER CLAIM: CONTESTED BY ${claim.names.map(escapeName).join(", ")} — stop and tell Greg`;
    case "cannot-tell":
      return `== OVERSEER CLAIM: COULD NOT TELL — ${claim.why}`;
    default: {
      const never: never = claim;
      throw new Error(String(never));
    }
  }
}

function claimFrom(read: DashboardSnapshotRead, nowMs: number): OverseerClaim {
  return read.kind === "snapshot"
    ? claimFromSnapshot(read.snapshot.raw, { nowMs, maxAgeMs: 5 * 60_000 })
    : { kind: "cannot-tell", why: read.why };
}

export type TickOptions = {
  readonly root: string;
  readonly baseUrl: string;
  readonly nowMs?: number;
  /** Tests pass captured bytes; production reads ~/.claude.json. */
  readonly claudeJson?: string;
  readonly collectHealth?: () => HealthReport;
  readonly fetchImpl?: typeof fetch;
};

/**
 * Each section owns its failure. The command's contract is a readable screen,
 * so a broken collector is one loud line and never an exception that erases
 * the independent evidence below it.
 */
export async function tickLines(options: TickOptions): Promise<string[]> {
  const nowMs = options.nowMs ?? Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  const lines: string[] = [`== ${new Date(nowMs).toISOString()}`];

  let dashboard: DashboardSnapshotRead;
  try {
    dashboard = await fetchDashboardSnapshot(options.baseUrl, fetchImpl);
  } catch (cause) {
    dashboard = { kind: "no-answer", why: reason(cause) };
  }
  const claim = claimFrom(dashboard, nowMs);
  lines.push(claimBanner(claim), "", "== direct usage");

  try {
    const raw = options.claudeJson ?? readFileSync(join(homedir(), ".claude.json"), "utf8");
    lines.push(...directUsageLines(JSON.parse(raw) as unknown, nowMs));
  } catch (cause) {
    lines.push(`usage cache unknown — ~/.claude.json could not be read (${reason(cause)})`, "five_hour: unknown", "seven_day: unknown");
  }

  lines.push("", "== load, memory, swap");
  try {
    // The tick needs fullness, not a live vmstat sample. Skipping it removes
    // the collector's one deliberate one-second wait on an already sick box.
    const collect = options.collectHealth ?? (() => collectBoxHealth({ includeSwapActivity: false }));
    lines.push(...healthLines(collect()));
  } catch (cause) {
    lines.push(`box health  COULD NOT TELL — ${reason(cause)}`);
  }

  lines.push("", "== daemon, scheduler, checkpoint usage, register, inbox");
  try {
    lines.push(...statusLines(options.root, nowMs, claim));
  } catch (cause) {
    lines.push(`status       COULD NOT TELL — ${reason(cause)}`);
  }

  lines.push("", "== fleet sessions and last assistant turns");
  let mine: readonly string[] | null = null;
  try {
    const read = readCliState(options.root);
    if (read.kind === "unusable") lines.push(`mine         COULD NOT TELL — ${read.why}`);
    else mine = read.kind === "absent" ? [] : read.state.mine;
  } catch (cause) {
    lines.push(`mine         COULD NOT TELL — ${reason(cause)}`);
  }

  if (dashboard.kind === "no-answer") {
    lines.push(`sessions     COULD NOT TELL — ${dashboard.why}`);
    if (mine !== null) {
      for (const name of mine) lines.push(`${escapeName(name)} — snapshot unavailable; last turn not fetched`);
    }
    return lines;
  }

  const snapshotNames = new Set(dashboard.snapshot.rows.map((row) => row.name));
  // THE OMISSION STAYS VISIBLE, ON ONE LINE INSTEAD OF FOURTEEN.
  //
  // A line each was the first shape and it was honest and unreadable: on a box
  // with fifteen sessions and two of them `mine`, thirteen lines of "not in
  // mine; last turn not fetched" pushed the register, the inbox and the usage
  // band off a screen the Overseer reads under time pressure. Collapsing them
  // loses nothing — every skipped name is still printed, and still counted —
  // and what it buys is that the lines which say something are on the screen.
  const skipped: string[] = [];
  for (const row of dashboard.snapshot.rows) {
    if (mine === null) {
      skipped.push(`${escapeName(row.name)} (${row.id})`);
      continue;
    }
    if (!mine.includes(row.name)) {
      skipped.push(`${escapeName(row.name)} (${row.id})`);
      continue;
    }
    try {
      const recent = await fetchRecentMessages(options.baseUrl, row.id, fetchImpl);
      for (const line of recentLines(recent, 1, "assistant")) {
        lines.push(`${escapeName(row.name)} (${row.id})  ${line}`);
      }
    } catch (cause) {
      lines.push(`${escapeName(row.name)} (${row.id}) — messages COULD NOT BE READ — ${reason(cause)}`);
    }
  }
  if (skipped.length > 0) {
    // The REASON differs between the two ways a name lands here, and it matters:
    // an unreadable list means nothing was fetched for anybody, which is a
    // broken tick wearing the same clothes as a quiet one.
    const why = mine === null ? "mine list unreadable, so nothing was fetched for anybody" : "not in mine";
    lines.push(`not fetched  ${skipped.length} session(s), ${why}:`);
    lines.push(`             ${skipped.join(", ")}`);
  }
  if (mine !== null) {
    // THESE ARE NOT COLLAPSED, and that is the point of the section. A name the
    // Overseer is looking after that the dashboard cannot see is usually a
    // session that died, which is the single most actionable line on the screen.
    for (const name of mine) {
      if (!snapshotNames.has(name)) lines.push(`${escapeName(name)} — NOT IN THE FLEET SNAPSHOT; last turn not fetched`);
    }
  }
  return lines;
}
