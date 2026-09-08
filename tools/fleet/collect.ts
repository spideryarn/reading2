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
import { execFileSync } from "node:child_process";

import { buildSessionScript, parseSessions, type Session } from "../../scripts/gjd-remote-tmux.js";
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
  startedAt: string;
  /**
   * What the session is doing. A union, never a bare string, and `unknown`
   * carries the reason — see status.ts, and the source comments in
   * `sessionState` that explain why "we could not ask" must never collapse into
   * "nothing is happening".
   */
  status: FleetStatus;
};

/** A snapshot, and enough about it to know whether to believe it. */
export type FleetSnapshot = {
  rows: FleetRow[];
  collectedAt: string;
  /** How long the collection took. It is seconds, not milliseconds — see the server. */
  tookMs: number;
};

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
export function toRows(sessions: readonly Session[], status: ReadonlyMap<string, FleetStatus>): FleetRow[] {
  return sessions.map((s) => ({
    id: s.id,
    name: s.name,
    title: s.title.trim() === "" ? null : s.title.trim(),
    repo: s.meta.version === 1 ? s.meta.repo : null,
    worktree: s.meta.version === 1 ? worktreeOf(s.meta.dir) : null,
    startedAt: s.created.toISOString(),
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
 * THE STATUS IS ATTACHED TO EACH ROW HERE, not carried alongside as a Map, and
 * that is not a style choice. `server.ts` serves `/api/agents` by
 * `JSON.stringify`ing this snapshot, and a `Map` stringifies to `{}` — the
 * status would vanish from the JSON with nothing erroring anywhere, which is
 * the exact shape of bug docs/reusable/silent-success.md is about.
 */
export function collect(): FleetSnapshot {
  const startedAt = Date.now();
  const out = execFileSync("bash", ["-c", buildSessionScript({ agents: true })], {
    encoding: "utf8",
    // Transcripts run to tens of megabytes and the script prints a base64 of
    // its own output; the default 1 MB would truncate a busy box silently.
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
  });
  const parsed = parseSessions(out);
  if (parsed.failure) throw new Error(`could not read this box's tmux sessions: ${parsed.failure}`);
  const status = new Map(statusesOf(parsed).map((r) => [r.id, r.status]));
  return {
    rows: toRows(parsed.sessions, status),
    collectedAt: new Date().toISOString(),
    tookMs: Date.now() - startedAt,
  };
}
