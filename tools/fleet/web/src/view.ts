/**
 * Pure display decisions: how old a thing reads, what a status is called, and
 * which rows come first.
 *
 * SEPARATE FROM THE COMPONENTS ON PURPOSE, and for the same reason
 * tools/fleet/page.ts is separate from server.ts: everything here is a function
 * of its arguments, so a test can say what time it is and assert a sentence
 * without mounting anything. `now` is always a parameter and never a call to
 * `Date.now()`.
 *
 * The triage bands are a restatement of `triageRank` in tools/fleet/status.ts,
 * and the duplication is the price of the client not importing node modules
 * (see the header of types.ts). The ordering decisions themselves belong to
 * that file — read its comments before changing one here, especially the two it
 * argues for: a busy shell stays in the last band, and `unknown` is not
 * promoted because one failed agents call turns every Claude row unknown at
 * once.
 */
import type { FleetOptionKey, FleetRow, FleetState, FleetStatus } from "./types";

/** Which colour language a row speaks. */
export type Tone = "needs" | "work" | "idle" | "unknown";

/**
 * A duration in milliseconds, as the shortest sentence that is still true.
 *
 * Rounds towards the coarser unit only once there is a coarser unit worth
 * having: 90 seconds is "1m 30s" rather than "2m", because the difference
 * between one minute and two is the difference between "it just asked" and "it
 * has been sitting there".
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) {
    const rest = secs % 60;
    return mins < 5 && rest !== 0 ? `${mins}m ${rest}s` : `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const restMins = mins % 60;
  if (hours < 24) return restMins === 0 ? `${hours}h` : `${hours}h ${restMins}m`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`;
}

/** Seconds, for the countdown a `waiting` session carries. */
export function formatSeconds(secondsLeft: number): string {
  return formatDuration(Math.max(0, secondsLeft) * 1000);
}

/**
 * How old the snapshot is, in words — or null when there has never been one.
 *
 * **This is the load-bearing sentence on the page.** A dashboard that has
 * stopped updating and looks current is the failure mode this whole tool keeps
 * hitting, so the age is never absent and never inferred from the fact that
 * something is drawn.
 */
export function collectedAge(state: FleetState | null, now: number): number | null {
  if (state === null || state.collectedAt === null) return null;
  const at = Date.parse(state.collectedAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, now - at);
}

/** How long a session has been up, or null when its start time is unreadable. */
export function uptime(row: FleetRow, now: number): number | null {
  const at = Date.parse(row.startedAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, now - at);
}

/**
 * How a status reads, and which band it belongs to.
 *
 * `unknown` shows its reason rather than a shrug — that is the whole point of
 * carrying one. A row nobody could ask about must not look like a quiet one.
 */
export function statusLabel(status: FleetStatus): { text: string; detail: string | null; tone: Tone } {
  switch (status.kind) {
    case "needs-you":
      return { text: "needs you", detail: null, tone: "needs" };
    case "working":
      return { text: "working", detail: null, tone: "work" };
    case "idle":
      return { text: "idle", detail: null, tone: "idle" };
    case "waiting":
      return { text: `waiting ${formatSeconds(status.secondsLeft)}`, detail: null, tone: "idle" };
    case "no-claude":
      return { text: "no agent", detail: null, tone: "idle" };
    case "shell":
      return {
        text: status.busy === null ? "shell" : status.busy ? "shell, busy" : "shell",
        detail: status.busy === null ? "the box could not say whether it is busy" : null,
        tone: "idle",
      };
    case "unknown":
      return { text: "unknown", detail: status.why, tone: "unknown" };
    default: {
      // Unreachable through `parseStatus`, which maps an unrecognised kind onto
      // `unknown` before it gets here. Kept so that adding an eighth arm to the
      // type fails to compile rather than inheriting a band.
      const never: never = status;
      return never;
    }
  }
}

/**
 * Which of the three bands a status belongs to. Lower sorts higher.
 *
 * The bands are Greg's, out of docs/project/orchestrator-direction.md: the
 * first question the page answers is *does anyone need something from me*, and
 * the second is *what is actually moving*. Everything else is one band, because
 * a screen with seven ranks is a screen nobody reads the bottom of.
 */
export function triageBand(status: FleetStatus): 0 | 1 | 2 {
  switch (status.kind) {
    case "needs-you":
      return 0;
    case "working":
      return 1;
    case "idle":
    case "waiting":
    case "no-claude":
    case "shell":
    case "unknown":
      return 2;
    default: {
      const never: never = status;
      return never;
    }
  }
}

/**
 * Triage order: who needs you, then what is moving, then everything else —
 * newest first within each band.
 *
 * **Copies rather than sorting in place**, because the argument is somebody's
 * snapshot and a poll handing the same array to two renderers is how that turns
 * into a bug you only see under load.
 *
 * A `startedAt` that will not parse sorts LAST within its band rather than
 * anywhere. `Date.parse` answers `NaN` instead of throwing, every comparison
 * with `NaN` is false, and a comparator that subtracts them returns `NaN` —
 * which sorts as "equal to everything", so the row lands wherever the sort
 * happened to walk and the page looks fine. tools/fleet/status.ts hit exactly
 * this and its comment is the longer version.
 */
export function triageSort(rows: readonly FleetRow[]): FleetRow[] {
  return [...rows].sort((a, b) => {
    const byBand = triageBand(a.status) - triageBand(b.status);
    if (byBand !== 0) return byBand;
    const at = Date.parse(a.startedAt);
    const bt = Date.parse(b.startedAt);
    return (Number.isFinite(bt) ? bt : -Infinity) - (Number.isFinite(at) ? at : -Infinity);
  });
}

/** How many rows are in each band, for the header. */
export type Tally = { needsYou: number; working: number; other: number; unknown: number };

/**
 * The counts the header shows.
 *
 * `unknown` is counted separately and shown BESIDE the others whenever it is
 * non-zero, rather than folded into "idle". One failed agents call turns every
 * Claude row unknown at once, and a header reading "0 need you" over eleven
 * unanswerable rows is the lie the status module exists to prevent.
 */
export function tally(rows: readonly FleetRow[]): Tally {
  const out: Tally = { needsYou: 0, working: 0, other: 0, unknown: 0 };
  for (const row of rows) {
    const band = triageBand(row.status);
    if (band === 0) out.needsYou += 1;
    else if (band === 1) out.working += 1;
    else out.other += 1;
    if (row.status.kind === "unknown") out.unknown += 1;
  }
  return out;
}

/** `repo · worktree`, with the parts that are genuinely unknown simply absent. */
export function whereLine(row: FleetRow): string | null {
  const parts = [row.repo, row.worktree].filter((p): p is string => p !== null && p !== "");
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * What to press to choose an option, said in one short phrase.
 *
 * **This page sends nothing.** The phrase is here so a person reading the
 * dashboard on a phone knows what they would have to do at the terminal, not
 * because anything on this page will do it — steering is tools/fleet/steer.ts.
 */
export function optionHint(key: FleetOptionKey): string {
  switch (key.via) {
    case "digit":
      return `press ${key.digit}`;
    case "arrows":
      return `${key.key} ×${key.presses}, then Enter`;
    case "selected":
      return "already selected — Enter";
    case "unrecognised":
      return "keystroke unknown";
    default: {
      const never: never = key;
      return never;
    }
  }
}
