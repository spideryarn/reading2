/**
 * v0.3 of the fleet dashboard: what each session is doing, and which ones want
 * you first.
 *
 * Direction and constraints: docs/project/overseer-direction.md.
 * Stages: docs/plans/260907e-agent-fleet-dashboard.md § Stage v0.3.
 *
 * THE STATUS IS NOT OURS EITHER, and that is the whole reason this file is so
 * short. `sessionState` in scripts/gjd-remote-tmux.ts already joins the two
 * sources — `claude agents --json` for busy/idle/parked-on-a-question, and the
 * process table for what is actually running — and the long comment above it
 * ("THE ORDER IS THE DESIGN") explains every clause as a pair of states that
 * would otherwise be told apart wrongly. The clause that matters most here is
 * the measured one: on 2026-09-01, twice, a live session went unlisted by
 * `claude agents --json` for 35+ seconds, so **absence from that list is not
 * death**, and a dashboard that renders it as death is a dashboard that says
 * "nothing is happening" about a session mid-refactor. We call that function.
 * We do not write a second one, and we do not paraphrase its clauses here.
 *
 * WHAT IS OURS is two things it does not do, both about display:
 *
 *  - **the box's own excuse**, when the agents call failed. `sessionState` says
 *    "the box could not say what Claude is doing" because it is handed a null
 *    map and nothing else; `parseSessions` separately returns `agentsWhy`, the
 *    reason the box gave. On a page, "could not say: claude: command not found"
 *    is a thing somebody can fix and "could not say" is a shrug.
 *  - **triage order**, which is a question about a screen and not about a
 *    session, so it does not belong in the inventory.
 *
 * NO IMPORT SIDE EFFECTS. Nothing at module scope here does anything — the
 * server is in server.ts and the page is in page.ts, and the reason those are
 * separate is written at the top of page.ts: an earlier version put `esc()`
 * next to `server.listen()`, so importing it from a test bound port 8787.
 */
import { sessionState, type Session, type SessionState } from "../../scripts/gjd-remote-tmux.js";

/**
 * The display status — `sessionState`'s own union, re-exported rather than
 * restated.
 *
 * A second copy of a seven-arm discriminated union is a copy that stops
 * matching the day somebody adds an eighth arm, and the eighth arm is exactly
 * the case this whole area keeps getting wrong: a state nobody could determine,
 * rendered as a state that was determined. Re-exporting means a new arm in
 * gjd-remote-tmux.ts fails `triageRank` here at compile time (see its `never`)
 * rather than being quietly rounded to "the rest".
 */
export type FleetStatus = SessionState;

/** Exactly what `parseSessions` gives back, minus the parts status does not use. */
export type StatusInput = {
  sessions: readonly Session[];
  /** Status by Claude session id, or null when the box could not be asked. */
  agents: Map<string, string> | null;
  /** Why `agents` is null, in the box's own words. Null when it is not null. */
  agentsWhy: string | null;
};

/** One session's status, keyed so the caller can join it to its own row. */
export type StatusedSession = {
  /** tmux's own handle (`$1643`) — the address, and the join key to a `FleetRow`. */
  id: string;
  status: FleetStatus;
  /**
   * When this session last did something, as epoch milliseconds — or rather,
   * the closest thing to it the box can currently tell us, which is when the
   * session was CREATED.
   *
   * **This is a proxy and it is a weak one.** A session started nine hours ago
   * and typing right now sorts below one started ten minutes ago and idle since.
   * There is no last-activity field on `Session` (it has id, name, created,
   * attached, windows, title, provisional, claudeId, proc, meta and nothing
   * else), and inventing one means another probe per session on a box that
   * already pays 13 seconds a collection. Named `activityAt` rather than
   * `startedAt` because that is the question the sort is asking, and the day a
   * real clock exists this is the one field that changes.
   */
  activityAt: number;
};

/**
 * One session's status, with the box's own reason folded in when there is one.
 *
 * The enrichment is deliberately narrow. Two different unknowns arrive here
 * when the agents call has failed — a session whose `CLAUDE_SESSION_ID` was set
 * by hand to something that is not a session id (unknown whatever Claude Code
 * says, because it cannot join to anything) and a session we simply could not
 * ask about — and appending "claude: command not found" to the first blames the
 * wrong thing on a row that is not broken in that way.
 *
 * **They must be told apart by structure, never by wording.** Matching
 * `sessionState`'s sentences would put a copy of them in this file and they
 * would drift; and prose is not a thing to compare in the first place, because
 * a sentence can be reworded while the situation it describes has not changed
 * at all. `cause` is that structure — a stable identifier for the fault, with
 * `why` left as the sentence for the reader — so the test is one field.
 *
 * This used to be cleverer: it asked `sessionState` a second time with an empty
 * map, on the principle that **a reason that survives the box having answered
 * is not the box's silence talking**. That reasoning is right and is why the
 * distinction is drawn at all; the trick is no longer how it is drawn.
 */
export function statusOf(s: Session, agents: Map<string, string> | null, agentsWhy: string | null): FleetStatus {
  const state = sessionState(s, agents);
  if (state.kind !== "unknown" || state.cause !== "agents-unavailable" || agentsWhy === null) return state;
  return { kind: "unknown", cause: state.cause, why: `${state.why}: ${agentsWhy}` };
}

/**
 * Every session's status, in the order they arrived.
 *
 * Order is the caller's business — `triageSort` is a separate function on
 * purpose, so a caller that wants the list as the box gave it (an API response,
 * a diff between two collections) is not silently handed a reordered one.
 */
export function statusesOf(input: StatusInput): StatusedSession[] {
  return input.sessions.map((s) => ({
    id: s.id,
    status: statusOf(s, input.agents, input.agentsWhy),
    activityAt: s.created.getTime(),
  }));
}

/**
 * Which of the three bands a status belongs to. Lower sorts higher.
 *
 * The bands are Greg's, from overseer-direction.md: the first thing the
 * page must answer is *does anyone need something from me*, and the second is
 * *what is actually moving*. Everything else is one band, because a screen with
 * seven ranks is a screen nobody reads the bottom of.
 *
 * **`shell` is in the last band even when it is busy**, and that is a decision
 * rather than an oversight: a shell grinding through `npm test` is not an agent
 * doing work you asked for, and promoting it would push a real working agent
 * down the page. **`unknown` is in the last band too**, which is the one place
 * this ordering is arguably wrong — an unknown could be a session that needs
 * you and could not be asked. It is not promoted because the agents call
 * failing turns EVERY Claude row unknown at once (see `sessionState`), and a
 * band that is sometimes the whole list is not a band. The page must therefore
 * show the reason, not just the order.
 *
 * The `never` is load-bearing: an eighth `SessionState` arm stops compiling
 * here, so somebody has to decide where it goes instead of inheriting band 2.
 */
export function triageRank(status: FleetStatus): 0 | 1 | 2 {
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
 * Generic over the row so it can sort a `StatusedSession` or a page row that
 * has had a status joined onto it, rather than the caller sorting ids and then
 * reordering its own list to match.
 *
 * **Copies rather than sorting in place.** `Array.prototype.sort` mutates, and
 * the argument here is somebody's snapshot; a background refresh loop handing
 * the same array to two renderers is the shape that turns that into a bug you
 * only see under load.
 *
 * `activityAt` of `NaN` sorts last within its band instead of anywhere. That is
 * not hypothetical: the obvious way to build these rows from a `FleetRow` is
 * `Date.parse(row.startedAt)`, and `Date.parse` answers `NaN` rather than
 * throwing. Every comparison with `NaN` is false, so a comparator that
 * subtracts them returns `NaN`, which sorts as "equal to everything" — the row
 * lands wherever the sort happened to walk, and the page looks fine.
 */
export function triageSort<T extends { status: FleetStatus; activityAt: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const byBand = triageRank(a.status) - triageRank(b.status);
    if (byBand !== 0) return byBand;
    const at = Number.isFinite(a.activityAt) ? a.activityAt : -Infinity;
    const bt = Number.isFinite(b.activityAt) ? b.activityAt : -Infinity;
    return bt - at;
  });
}

/**
 * How many rows are in each band, for the header.
 *
 * `needsYou` is the number worth putting in a page title or a push
 * notification; `unknown` is here beside it because a screen saying "0 need
 * you" while eleven rows are unanswerable is the same lie this file's imports
 * exist to prevent.
 */
export function triageCounts(rows: readonly { status: FleetStatus }[]): {
  needsYou: number;
  working: number;
  other: number;
  unknown: number;
} {
  let needsYou = 0;
  let working = 0;
  let other = 0;
  let unknown = 0;
  for (const r of rows) {
    const band = triageRank(r.status);
    if (band === 0) needsYou += 1;
    else if (band === 1) working += 1;
    else other += 1;
    if (r.status.kind === "unknown") unknown += 1;
  }
  return { needsYou, working, other, unknown };
}
