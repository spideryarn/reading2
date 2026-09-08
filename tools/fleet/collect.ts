/**
 * v0.1 of the fleet dashboard: what is running on this box, as display rows.
 *
 * READ-ONLY BY CONSTRUCTION. Nothing here can write to a session, and that is
 * the point of the slice — see docs/project/orchestrator-direction.md, which
 * holds the direction and the measured constraints, and
 * docs/plans/260907e-agent-fleet-dashboard.md for the stages.
 *
 * THE INVENTORY IS NOT OURS. `buildSessionScript` and `parseSessions` in
 * scripts/gjd-remote-tmux.ts already know how to ask this box what it is
 * running, and have absorbed a string of accidents in doing so — a strict parse
 * that refuses a short listing rather than reporting an empty box, and a
 * two-source join because `claude agents --json` being silent about a session
 * does not mean the session is not running (measured twice on 2026-09-01). We
 * call it rather than writing a second inventory, and the one thing we do
 * differently is run it through `bash` instead of `ssh`, because we are already
 * on the box it wants to ask.
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

import {
  buildSessionScript,
  parseSessions,
  type Session,
  type SessionMeta,
} from "../../scripts/gjd-remote-tmux.js";
import { capturePane, parsePane, type PaneQuestion } from "./pane.js";
import { statusesOf, type FleetStatus } from "./status.js";

/** One line of the page. Deliberately flat: it is rendered, and it is JSON. */
export type FleetRow = {
  /** tmux's own session handle (`$1643`) — the address, and stable across renames. */
  id: string;
  name: string;
  /** Claude's own title for the conversation, or null when it has not made one yet. */
  title: string | null;
  /** `owner/name`, or null for a session whose metadata predates the convention. */
  repo: string | null;
  /** The worktree directory's own name, when the session is in one. */
  worktree: string | null;
  /**
   * The launcher's metadata, WHOLE and undamaged — the same discriminated union
   * `Session` carries, not a flattened set of nullable fields.
   *
   * `repo` and `worktree` above are for RENDERING and are lossy on purpose: a
   * name for a person to read. This is the record, and it holds `dir` — the
   * full working directory, which nothing else in the payload can reconstruct.
   * `~/.claude/projects/<slug>/` is a slugified cwd and slugification is lossy,
   * and the repo is provably not derivable from the directory either (there is
   * a comment in gjd-remote-log.ts saying so).
   *
   * WITHOUT THIS A REBOOT IS UNRECOVERABLE, which is what put it here. Session
   * identity lives only in the tmux environment, so a reboot erases it — and a
   * history that recorded a tmux handle and some display fields could say what
   * was running and not where, so nothing could be resumed. GPT Sol's P0 on the
   * Overseer's plan (2026-09-08), relayed by that session; the fix belongs in
   * this file because this is where the fields were being dropped.
   *
   * The union rather than `dir: string | null` so that reading `dir` forces the
   * `version === 1` check: a legacy session genuinely does not have one, and a
   * null that the compiler lets you ignore is the shape this project keeps
   * writing comments about.
   */
  meta: SessionMeta;
  startedAt: string;
  /**
   * What the session is doing. A union, never a bare string, and `unknown`
   * carries the reason — see status.ts, and the source comments in
   * `sessionState` that explain why "we could not ask" must never collapse into
   * "nothing is happening".
   */
  status: FleetStatus;
  /**
   * tmux's PANE handle (`%2108`), which is a different thing from `id` (the
   * SESSION handle, `$1643`). Anything that reads or writes the terminal needs
   * this one; anything that names a session needs the other. Null when the
   * session's pane could not be resolved.
   */
  paneId: string | null;
  /**
   * The pane's own pid (its shell), when tmux told us. Not an address — it is
   * the thing that CHANGES when a pane is respawned under the same handle, so
   * `steer.ts` compares it before typing and refuses if the pane you were
   * looking at has been replaced by another one wearing its name.
   */
  panePid: number | null;
  /**
   * The CONVERSATION's uuid — Claude's own `--session-id`, not tmux's `$1643`.
   *
   * Carried because it is the only one of the three ids that identifies the
   * thing a person means by "this agent": a tmux session can be resumed into a
   * different conversation and keep its handle, its name and its pane. Null for
   * a session that is not a Claude, and for a legacy one that never pinned it —
   * and a null here is what makes the steer route refuse rather than guess.
   */
  claudeSessionId: string | null;
  /**
   * What this session is asking, when it is blocked on a dialog — and null
   * otherwise, including for every session that is merely working.
   *
   * Only filled in for rows the status pass already called `needs-you`: a
   * capture per session per refresh is cheap but pointless for a pane nobody is
   * waiting on, and every extra capture is load on a box that fell over today.
   */
  question: PaneQuestion | null;
};

/** A snapshot, and enough about it to know whether to believe it. */
export type FleetSnapshot = {
  rows: FleetRow[];
  collectedAt: string;
  /** How long the collection took. It is seconds, not milliseconds — see the server. */
  tookMs: number;
  /**
   * Which tmux server these handles belong to — see `tmuxServerPid`. Every `$…`
   * and `%…` in `rows` is meaningless without it, and comparing two snapshots
   * across a reboot without checking it silently equates different sessions.
   */
  tmuxServerPid: number | null;
};

/** A pane's address, and the pid that changes when it is respawned under it. */
export type PaneInfo = { paneId: string; panePid: number | null };

/**
 * Session handle → pane handle, for every pane tmux knows about.
 *
 * ONE CALL FOR THE WHOLE BOX rather than one per session. Exported and taking
 * its input as a string so the parse can be tested without tmux.
 *
 * A session can hold several panes; the first wins, which is the one `ls`-style
 * tools mean by "the session's pane". A session with no pane is simply absent —
 * it does not get an empty string, because "" would be accepted as an address
 * somewhere downstream and `%` is what makes an address recognisable.
 */
export function panesBySession(listPanesOutput: string): Map<string, PaneInfo> {
  const out = new Map<string, PaneInfo>();
  for (const line of listPanesOutput.split("\n")) {
    const [session, pane, pid] = line.trim().split(/\s+/);
    if (!session || !pane) continue;
    // A pid we cannot read is null, not a dropped row: the pane handle is still
    // the address, and losing the row because a third field was odd would cost
    // the session its question for no gain. `steer.ts` treats an absent pid as
    // "no respawn check available" and every other guard still applies.
    const panePid = pid !== undefined && /^\d{1,10}$/.test(pid) ? Number(pid) : null;
    if (!out.has(session)) out.set(session, { paneId: pane, panePid });
  }
  return out;
}

/**
 * The tmux SERVER's pid, from the same listing — a generation token.
 *
 * `$1643` is unique within one tmux server and meaningless across two. When the
 * server dies, handles start again at `$0`, so a stored `$1643` from before a
 * reboot and a live `$1643` after one are different sessions wearing one name,
 * and nothing in the row can tell them apart. This is the field that can.
 *
 * `claudeSessionId` covers the same hazard for the CONVERSATION half (a session
 * resumed into a different chat); this covers the runtime half (the same handle
 * in a new tmux server). Neither subsumes the other: a reboot changes this and
 * nothing else, and a resume changes the uuid and nothing else. Sol's finding on
 * the Overseer's plan, 2026-09-08.
 *
 * Free: `#{pid}` is a fourth field on the `list-panes -a` we already run, not
 * another call. Null when the listing is empty or the field is not a number,
 * because a generation we had to guess would defeat the purpose.
 */
export function tmuxServerPid(listPanesOutput: string): number | null {
  for (const line of listPanesOutput.split("\n")) {
    const parts = line.trim().split(/\s+/);
    const pid = parts[3];
    if (pid !== undefined && /^\d{1,10}$/.test(pid)) return Number(pid);
  }
  return null;
}

/**
 * The worktree's directory name, for a session inside one.
 *
 * Worktrees live at `<repo>/.claude/worktrees/<name>`, so the segment after
 * `worktrees` is the name. Returns null for a session sitting in a plain
 * checkout, which is not the same as an unknown — the caller renders it as
 * blank rather than as a guess.
 */
export function worktreeOf(dir: string): string | null {
  const parts = dir.split("/");
  const at = parts.lastIndexOf("worktrees");
  if (at === -1) return null;
  return parts[at + 1] ?? null;
}

/**
 * Sessions to display rows.
 *
 * A session with an empty title keeps null rather than a placeholder, so that
 * the decision about how to render "no title yet" belongs to the page and is
 * made once. `meta.version === "legacy"` means the session predates the
 * metadata convention entirely — its repo is genuinely unknown, and saying so
 * is the whole reason that union has a second arm.
 */
export function toRows(
  sessions: readonly Session[],
  status: ReadonlyMap<string, FleetStatus>,
  panes: ReadonlyMap<string, PaneInfo> = new Map(),
): FleetRow[] {
  return sessions.map((s) => ({
    id: s.id,
    name: s.name,
    title: s.title.trim() === "" ? null : s.title.trim(),
    repo: s.meta.version === 1 ? s.meta.repo : null,
    worktree: s.meta.version === 1 ? worktreeOf(s.meta.dir) : null,
    meta: s.meta,
    startedAt: s.created.toISOString(),
    paneId: panes.get(s.id)?.paneId ?? null,
    panePid: panes.get(s.id)?.panePid ?? null,
    claudeSessionId: s.claudeId,
    // Filled in below, only for the blocked rows. Null here rather than
    // undefined so the field is always present in the JSON.
    question: null as PaneQuestion | null,
    // A session the status pass did not cover is `unknown` with a reason, not a
    // default that reads as calm. There is no legitimate way to get here — the
    // two lists come from one parse — so if it ever shows up on the page, the
    // page is telling you about a real bug rather than about the box.
    status: status.get(s.id) ?? { kind: "unknown", why: "no status was derived for this session" },
  }));
}

/**
 * Ask the box what it is running.
 *
 * Throws rather than returning an empty list when the listing cannot be
 * trusted: `parseSessions` reports a `failure` when the row count does not
 * match the rows, and "no sessions" is the answer least likely to make anyone
 * look. The caller keeps its previous snapshot instead.
 *
 * `agents: true` since v0.3, because the agents list is the only thing that can
 * tell busy from idle from parked-on-a-question. It costs about a second, and
 * the flag exists so that callers which do not need states cannot hang on it.
 *
 * THE STATUS IS ATTACHED TO EACH ROW, not carried alongside as a Map, and that
 * is not a style choice. `server.ts` serves the snapshot by `JSON.stringify` —
 * and a `Map` stringifies to `{}`, so the status would vanish from the JSON
 * with nothing erroring anywhere, which is the exact shape of bug
 * docs/reusable/silent-success.md is about. See `snapshotFrom`, and the JSON
 * round-trip test that pins it.
 */

/**
 * One `list-panes -a` answers two questions, so they travel together: which
 * pane belongs to which session, and which tmux server all of those handles
 * belong to. Grouped rather than passed as two arguments because a caller that
 * can supply the panes and omit the generation is a caller that will.
 */
export type PaneListing = { panes: ReadonlyMap<string, PaneInfo>; tmuxServerPid: number | null };

/**
 * Every pane on the box, keyed by its session, and the server they are on.
 *
 * Empty on failure rather than throwing: not knowing a pane costs a question,
 * while the row itself is still worth showing. A null generation is the same
 * bargain — it says "unverifiable", which is what a consumer needs to hear.
 */
function panes(): PaneListing {
  try {
    const out = execFileSync(
      "tmux",
      // `#{pid}` is the SERVER's pid, not the pane's — a fourth field on a call
      // we were already making, and the only cheap way to tell one tmux server's
      // `$1643` from the next one's.
      ["list-panes", "-a", "-F", "#{session_id} #{pane_id} #{pane_pid} #{pid}"],
      { encoding: "utf8", timeout: 10_000 },
    );
    return { panes: panesBySession(out), tmuxServerPid: tmuxServerPid(out) };
  } catch {
    return { panes: new Map(), tmuxServerPid: null };
  }
}

/**
 * The shell we ask the box, as a function so a test can look at it.
 *
 * `agents: true` is load-bearing and was invisible: flipping it to `false`
 * left every test green while the live dashboard degraded every Claude row to
 * `unknown`, because the status tests inject an agents map directly and never
 * touch this call. GPT Sol's F5. `tests/fleet-collect.test.ts` now asserts this
 * script differs from the agents-free one, so the flag cannot be flipped in
 * silence.
 */
export function sessionScript(): string {
  return buildSessionScript({ agents: true });
}

/**
 * A parse plus the pane map, as a snapshot. Pure, and separate from `collect`
 * so the join can be tested without a box — including the JSON round trip,
 * which is where a `Map` would vanish.
 */
export function snapshotFrom(
  parsed: ReturnType<typeof parseSessions>,
  listing: PaneListing,
  tookMs: number,
  now = new Date(),
): FleetSnapshot {
  const status = new Map(statusesOf(parsed).map((r) => [r.id, r.status]));
  return {
    rows: toRows(parsed.sessions, status, listing.panes),
    collectedAt: now.toISOString(),
    tookMs,
    tmuxServerPid: listing.tmuxServerPid,
  };
}

/**
 * Did the tmux server change under us mid-collection? The message if so, null if not.
 *
 * Pure and exported so the decision can be tested without a box, because it is
 * a decision with three arms and only one of them is obvious.
 *
 * A NULL ON EITHER SIDE IS NOT DRIFT. Not being able to read the generation is
 * common enough — a tmux busy enough to time out a `display-message` is exactly
 * the box this tool is for — and treating "I could not tell" as "it changed"
 * would blank the dashboard at the moment it is most wanted. The snapshot then
 * carries a null `tmuxServerPid`, which already says "unverifiable" to anything
 * that reads it. Only two numbers that DISAGREE are evidence of a restart.
 */
export function generationDrift(before: number | null, after: number | null): string | null {
  if (before === null || after === null) return null;
  if (before === after) return null;
  return (
    `the tmux server restarted during this collection (was pid ${before}, now ${after}) — ` +
    `session and pane handles from two different servers cannot be joined`
  );
}

/**
 * The tmux server's pid, asked directly. Null when it cannot be read.
 *
 * A second way to get the same number as `tmuxServerPid(listPanesOutput)`, and
 * that is the point: it is read once BEFORE the inventory and once WITH the
 * panes, and the two must agree. See `collect`.
 */
function generationNow(): number | null {
  try {
    const out = execFileSync("tmux", ["display-message", "-p", "#{pid}"], { encoding: "utf8", timeout: 5_000 });
    return /^\d{1,10}$/.test(out.trim()) ? Number(out.trim()) : null;
  } catch {
    return null;
  }
}

export async function collect(): Promise<FleetSnapshot> {
  const startedAt = Date.now();
  /**
   * THE GENERATION, READ BEFORE THE INVENTORY AND CHECKED AFTER IT.
   *
   * A collection is not one command. The sessions come from a bash script that
   * takes eight to twelve seconds; the panes and the generation come from a
   * separate `tmux list-panes` afterwards. If the tmux server dies and restarts
   * in between, the sessions from the old server get joined to pane handles from
   * the new one — `$1643` and `%1646` come round again — and the whole thing is
   * stamped with the new generation, which is the label that says "these handles
   * are consistent". The result is a snapshot that is internally wrong and
   * carries a token asserting that it is not. GPT Sol's F16, 2026-09-08.
   *
   * A restart mid-collection is rare and a reboot is not, and the failure is
   * invisible: every row looks ordinary. So bracket it. A change means the
   * snapshot is thrown away and the caller keeps its previous one and marks it
   * stale, which is the honest outcome — a twelve-second gap in the history
   * beats twelve seconds of confident nonsense.
   */
  const generationBefore = generationNow();
  // ASYNC, AND THAT IS NOT TIDINESS. This was `execFileSync`, which blocks the
  // whole event loop — so for the eight to twelve seconds a collection takes,
  // the server answered nothing at all. The cache made the *data* instant and
  // left every request queued behind the collector anyway, which is a page that
  // hangs exactly when you refresh it during a refresh. GPT Sol's F3.
  const { stdout: out } = await run("bash", ["-c", sessionScript()], {
    encoding: "utf8",
    // Transcripts run to tens of megabytes and the script prints a base64 of
    // its own output; the default 1 MB would truncate a busy box silently.
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
  });
  const parsed = parseSessions(out);
  if (parsed.failure) throw new Error(`could not read this box's tmux sessions: ${parsed.failure}`);
  const listing = panes();
  const drift = generationDrift(generationBefore, listing.tmuxServerPid);
  if (drift) throw new Error(drift);
  const snapshot = snapshotFrom(parsed, listing, 0);
  const rows = snapshot.rows;

  // ASK ONLY THE BLOCKED ONES what they are asking. A capture is cheap, but a
  // capture per session per refresh is ~35 of them on a box that fell over
  // today, and the answer is meaningless for a pane nobody is waiting on.
  //
  // A capture or parse that fails leaves `question` null: the row still shows
  // as needs-you, which is true and useful, and the page says it could not read
  // the question rather than pretending there is not one.
  for (const row of rows) {
    if (row.status.kind !== "needs-you" || row.paneId === null) continue;
    try {
      row.question = parsePane(capturePane(row.paneId));
    } catch {
      row.question = null;
    }
  }

  return { ...snapshot, collectedAt: new Date().toISOString(), tookMs: Date.now() - startedAt };
}
