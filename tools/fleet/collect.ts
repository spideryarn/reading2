/**
 * v0.1 of the fleet dashboard: what is running on this box, as display rows.
 *
 * READ-ONLY BY CONSTRUCTION. Nothing here can write to a session, and that is
 * the point of the slice — see docs/project/overseer-direction.md, which
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
  type SessionRole,
} from "../../scripts/gjd-remote-tmux.js";
import { capturePane, parsePane, readPaneMode, type PaneAutoMode, type PaneQuestion } from "./pane.js";
import { statusesOf, type FleetStatus } from "./status.js";
import type { ExecutionReading, Pause } from "./wire.js";
import {
  readBootIdentity,
  readExecutionIdentity,
  readProcessStart,
  readUptime,
  type BootIdentity,
  type ProcessStartTicks,
  type UptimeReading,
} from "./execution-identity.js";
import { readPause, readSessionStore, type StoreIndex } from "./pause.js";
import { probeProcessTable } from "../overseer/work-probe.js";
import type { ProcessTableReading } from "../overseer/work.js";

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
  /**
   * **WHETHER THIS SESSION IS THE OVERSEER**, and the box must have exactly one
   * (docs/project/overseer.md). See `SessionRole` in tools/fleet/overseer-claim.ts:
   * it is a union rather than a nullable string because *nobody holds it* and
   * *we could not look* are different facts, and this payload is read by things
   * that decide whether to prod the Overseer.
   *
   * The claim lives in the session's own tmux environment, so it dies with the
   * session and with the tmux server: after a reboot, no row carries it, which
   * is the honest answer rather than a stale one.
   */
  role: SessionRole;
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
  /**
   * **WHICH PERMISSION MODE THIS SESSION LAUNCHED IN** — the other fact that
   * comes off the pane, and the one nothing on this box noticed until now.
   *
   * A session that came up in default rather than auto mode stops at its first
   * unapproved command and waits for somebody asleep: **34.9 agent-hours lost
   * since 2026-09-06, 20% of launches, longest single stall 7.38 hours.**
   * `gjd-remote log` calls such a session `running`, identical to a healthy
   * one. The measurement and the detection rule are in `PaneAutoMode` and
   * `readPaneMode` in pane.ts.
   *
   * **A UNION, NEVER A BOOLEAN, AND NEVER OPTIONAL.** `question` above may be
   * null because "not asking anything" is a real answer; there is no
   * corresponding null here, because every one of the three ways this can be
   * unanswerable — no Claude in the session, no status bar on screen, a mode
   * name we do not know — is a different thing to draw. A `boolean | null`
   * would render the fleet's most expensive defect and a shell as the same
   * pixel.
   *
   * Populated in two places, deliberately: `toRows` settles the arms that
   * follow from the status alone, and `readPanes` reads the rest off the pane.
   * See `modeApplicability`.
   */
  permissionMode: PaneAutoMode;
  /**
   * Why this session is not doing anything — an added fact beside the status,
   * never a replacement for it. `pause.ts` reads it; `readPauses` below fills
   * it in; `Pause` in `wire.ts` carries the reasoning.
   *
   * Starts at `cannot-tell` for the same reason `permissionMode` does: a caller
   * that never runs the pass produces rows saying *we did not look*, not rows
   * saying every session is waiting for nothing. `none` is a positive claim and
   * only the reader is in a position to make it.
   */
  pause: Pause;
  /**
   * **WHICH RUN IS IN THIS PANE — the one identity none of the fields above can
   * carry.**
   *
   * `paneId`, `panePid` and `claudeSessionId` are all unchanged when a pane's
   * claude exits and another starts in the same shell, so a consumer holding
   * any of them cannot tell yesterday's conversation from this morning's. This
   * carries a durable token for the harness process itself, and a separate
   * verdict on whether the conversation the launcher claimed is the one that
   * process is actually running. `ExecutionReading` in `wire.ts` has the
   * argument; `execution-identity.ts` derives it; `readExecutions` below fills
   * it in.
   *
   * Starts at `unknown`/`not-probed` on the same rule as `pause` and
   * `permissionMode`: a collection that never ran the pass says so.
   */
  execution: ExecutionReading;
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
 * Whether a session's permission mode is a question worth asking of its pane,
 * or one the status has already answered.
 *
 * **THE STATUS DECIDES, NOT THE PANE TEXT**, and that is the whole reason this
 * function exists rather than `readPaneMode` guessing. A shell and a Claude
 * whose status bar has scrolled off produce the same bytes — no status bar —
 * and they are opposite claims: one HAS no permission mode, the other has one
 * we could not see. Rendering the first as the second would put a shrug on
 * every shell on the box; rendering the second as the first would quietly
 * declare a real Claude exempt from the check. `status.ts` already knows which
 * is which, so it is asked rather than re-derived.
 *
 * **`unknown` IS `cannot-tell`, NOT `not-applicable`.** The box could not say
 * what is running, and one failed `claude agents --json` turns EVERY Claude row
 * unknown at once (status.ts says so at length) — so the alternative would
 * declare the whole fleet exempt in a single bad second, silently.
 *
 * **The three interactive arms all get read, `working` and `idle` included, and
 * that is the point of the whole stage.** Only `needs-you` rows were captured
 * before, and a blocked session is exactly the one whose mode CANNOT be read:
 * Claude Code's modal takes the whole screenful, and not one of the eleven
 * dialogs captured on 2026-09-08 has a status bar under it. The value is in
 * saying so within a minute of the session starting — while it is still
 * working — rather than five hours after it stopped.
 *
 * **The extra captures are affordable, measured rather than assumed.** All 19
 * panes on the box at 09:40 on 2026-09-08 took **176ms in total, median 9ms**,
 * against a collection that costs 5–13 seconds. That is under 2% of a
 * collection for the whole box, and `needs-you` rows pay nothing extra because
 * their capture is reused.
 *
 * The `never` is load-bearing: an eighth `SessionState` arm stops compiling
 * here, so somebody decides whether it has a permission mode instead of
 * inheriting an answer.
 */
export type ModeApplicability =
  /** Ask the pane. */
  | { kind: "read-the-pane" }
  /** The status already answers it; this is the answer. */
  | { kind: "settled"; mode: PaneAutoMode };

export function modeApplicability(status: FleetStatus): ModeApplicability {
  switch (status.kind) {
    case "needs-you":
    case "working":
    case "idle":
      return { kind: "read-the-pane" };
    case "shell":
      return {
        kind: "settled",
        mode: { kind: "not-applicable", why: "this is a shell, not an agent — there is no permission mode to be in" },
      };
    case "waiting":
      return {
        kind: "settled",
        mode: { kind: "not-applicable", why: "this session is in a timed wait of its own, not at a Claude prompt" },
      };
    case "no-claude":
      return {
        kind: "settled",
        mode: { kind: "not-applicable", why: "there is no Claude running in this session" },
      };
    case "unknown":
      return {
        kind: "settled",
        mode: {
          kind: "cannot-tell",
          why: `the box could not say what this session is running (${status.cause}), so its pane was not read`,
        },
      };
    default: {
      const never: never = status;
      return never;
    }
  }
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
  return sessions.map((s) => {
    // Resolved once and used twice, so the status a row is stamped with is the
    // same one its mode was decided from. Two lookups of the same map is how
    // those quietly stop being the same status.
    const rowStatus: FleetStatus = status.get(s.id) ?? {
      kind: "unknown",
      cause: "no-status-derived",
      why: "no status was derived for this session",
    };
    const applies = modeApplicability(rowStatus);
    return {
      id: s.id,
      name: s.name,
      title: s.title.trim() === "" ? null : s.title.trim(),
      repo: s.meta.version === 1 ? s.meta.repo : null,
      worktree: s.meta.version === 1 ? worktreeOf(s.meta.dir) : null,
      meta: s.meta,
      role: s.role,
      startedAt: s.created.toISOString(),
      paneId: panes.get(s.id)?.paneId ?? null,
      panePid: panes.get(s.id)?.panePid ?? null,
      claudeSessionId: s.claudeId,
      // Filled in below, only for the blocked rows. Null here rather than
      // undefined so the field is always present in the JSON.
      question: null as PaneQuestion | null,
      /* THE ARMS THE STATUS SETTLES ARE SETTLED HERE, and the rest starts at
         `cannot-tell` — never at `auto`. `readPanes` fills those in from the
         pane, and a caller that never runs it (`snapshotFrom` on its own, the
         JSON round-trip test) then produces rows that say "we did not look"
         rather than rows that say every session is fine. */
      permissionMode:
        applies.kind === "settled"
          ? applies.mode
          : ({ kind: "cannot-tell", why: "this session's pane has not been read yet" } as PaneAutoMode),
      pause: {
        kind: "cannot-tell",
        why: "nothing has looked at whether this session is waiting for something yet",
        cause: "rate-limits-not-collected",
      } as Pause,
      /* AND THE SAME RULE AGAIN, for the same reason: a row that nobody has
         probed says *nobody looked*, with the cause that says which kind of
         not-looking it was. `readExecutions` fills it in. `not-probed` and
         `not-reported` are deliberately different arms — see
         `ExecutionUnknownCause` — and this is the first of them. */
      execution: {
        kind: "unknown",
        cause: "not-probed",
        why: "this collection did not probe the process table, so nothing has looked at what is executing in this pane",
      } as ExecutionReading,
      // A session the status pass did not cover is `unknown` with a reason, not a
      // default that reads as calm. There is no legitimate way to get here — the
      // two lists come from one parse — so if it ever shows up on the page, the
      // page is telling you about a real bug rather than about the box.
      status: rowStatus,
    };
  });
}

/**
 * **READ EVERY PANE THAT HAS SOMETHING TO SAY**, and put both facts on its row.
 *
 * Extracted from `collect` rather than left inline, for two reasons and the
 * second is the one that matters. It is the seam a test can drive without tmux,
 * the same shape steer.ts uses. And until it existed **the capture loop had no
 * test at all** — a loop that populated nothing would have left the whole suite
 * green, which is the shape of bug docs/reusable/silent-success.md is about.
 *
 * **ONE CAPTURE PER PANE, ANSWERING BOTH QUESTIONS.** A blocked row's pane was
 * already being read for its dialog. Taking a second `capture-pane` of it here
 * would not merely cost another 9ms — it would read a screen that may have
 * redrawn in between, so the question on the card and the mode beside it would
 * be facts about two different frames.
 *
 * **A FAILURE LEAVES BOTH UNREAD RATHER THAN INVENTING EITHER.** The row still
 * shows its status, which is true and useful; the page says it could not read
 * the pane rather than pretending there was nothing on it.
 */
export function readPanes(rows: FleetRow[], capture: (paneId: string) => string = capturePane): void {
  for (const row of rows) {
    if (modeApplicability(row.status).kind !== "read-the-pane") continue;
    if (row.paneId === null) {
      row.permissionMode = {
        kind: "cannot-tell",
        why: "tmux gave this session no pane, so there is no screen to read it off",
      };
      continue;
    }
    let text: string | null = null;
    try {
      text = capture(row.paneId);
    } catch {
      text = null;
    }
    if (text === null) {
      row.permissionMode = { kind: "cannot-tell", why: "this session's pane could not be captured" };
      continue;
    }
    row.permissionMode = readPaneMode(text);
    // ONLY THE BLOCKED ROWS GET A QUESTION. Parsing every pane would be free
    // now that the capture is taken anyway, and it would still be wrong: a
    // `question` on a row nobody is waiting on is a card the page draws about a
    // session that is not asking, and `parsePane`'s whole bias is calibrated
    // against being generous on panes that are merely working.
    if (row.status.kind !== "needs-you") continue;
    try {
      row.question = parsePane(text);
    } catch {
      row.question = null;
    }
  }
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
 * **Is this a listing of the box we are standing on?**
 *
 * `generationDrift` below asks whether the world changed mid-collection. This
 * asks something more basic that nothing here asked before: whether the tmux we
 * just interrogated is the tmux this process lives in. A `tmux ls` pointed at
 * another socket — `TMUX` unset in a child, a `-S` somewhere in a wrapper, a
 * second server started by hand — **succeeds**, and returns a thousand entirely
 * plausible sessions belonging to nobody we know. Every row parses. Nothing
 * errors. The page shows a calm, populated, wrong fleet.
 *
 * The idea is the `orchestrator-setup` session's, from their process probe:
 * do not ask whether the output *looks* like the right kind of thing, ask
 * whether it is a reading **of this machine** — and the cheapest way to know is
 * that we are in it. It costs one lookup in data already in hand.
 *
 * TWO CHECKS, BECAUSE THEY FAIL DIFFERENTLY. `TMUX` carries the server's pid, so
 * comparing it to the listing's catches the wrong *server*; `TMUX_PANE` catches
 * a listing of the right server that has somehow lost us, which is a listing
 * that may have lost others.
 *
 * NOT BEING UNDER TMUX IS NOT A FAULT. The collector runs under `tmux-job.ts` in
 * production and from a shell in every test, so an absent `TMUX` means "cannot
 * check" and must not block — the `/logs/` lesson in `worktree-check.ts`, which
 * is that an alarm nobody can clear is one somebody deletes.
 */
export type SelfCheck =
  /** We are in the listing, so it is ours. */
  | { kind: "present"; paneId: string }
  /** Not running under tmux, so there is nothing to look for. Not a fault. */
  | { kind: "cannot-check"; why: string }
  /** We ARE under tmux and are not in this listing. The listing is not of our box. */
  | { kind: "absent"; why: string };

export function selfCheck(
  panes: ReadonlyMap<string, PaneInfo>,
  listedServerPid: number | null,
  env: { TMUX?: string | undefined; TMUX_PANE?: string | undefined },
): SelfCheck {
  const pane = env.TMUX_PANE;
  const tmux = env.TMUX;
  if (typeof pane !== "string" || pane === "" || typeof tmux !== "string" || tmux === "") {
    return { kind: "cannot-check", why: "this process is not running under tmux, so it cannot look for itself" };
  }
  // `TMUX` is `<socket>,<server pid>,<session index>`.
  const ourServer = Number(tmux.split(",")[1]);
  if (Number.isInteger(ourServer) && listedServerPid !== null && ourServer !== listedServerPid) {
    return {
      kind: "absent",
      why:
        `this listing is of tmux server ${listedServerPid} and this process lives in server ${ourServer} — ` +
        `every handle in it belongs to a different world`,
    };
  }
  for (const info of panes.values()) {
    if (info.paneId === pane) return { kind: "present", paneId: pane };
  }
  return {
    kind: "absent",
    why:
      `this process runs in pane ${pane} and that pane is not in the listing — ` +
      `so the listing is not of this box, or it is missing rows`,
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

/**
 * How long one collection gets before a caller stops waiting for it.
 *
 * Generous on purpose: a collection takes 8–12 seconds normally, the child
 * below already has its own 60-second timeout, and this box has hit load
 * average 391. This is the backstop behind that timeout rather than a second
 * copy of it.
 */
export const COLLECT_DEADLINE_MS = 120_000;

/**
 * Wait for a collection, or give up on it — but never wait forever.
 *
 * **`collect()` CAN FAIL TO SETTLE, AND THAT STOPPED THE SERVER'S LOOP FOR
 * GOOD.** Its child gets `timeout: 60_000`, which sends SIGTERM, and a `bash`
 * in uninterruptible IO on a swapping box does not die on SIGTERM.
 * `promisify(execFile)`'s promise then waits for a process that is not coming
 * back. In `server.ts` the refresh loop chains from the END of each run, so it
 * never reached its next iteration — and nothing threw, so `lastError` stayed
 * `null` while `collectedAt` sat at the last success.
 *
 * Observed in the field on 2026-09-08 by the `orchestrator-setup` session:
 * roughly **thirty minutes stale with `error: null`**, self-healing when the
 * child finally died. That is `silent-success.md` in its purest form — the
 * thing that would have reported the fault was the thing that stopped — and it
 * had no test because there was nothing to call.
 *
 * The abandoned promise is NOT cancelled, because there is nothing to cancel it
 * with; its eventual result is ignored. What matters is that the CALLER is
 * freed, so the next attempt happens and `attemptedAt` keeps moving even while
 * `collectedAt` does not.
 *
 * `run` is a parameter so a test can hand it a promise that never settles,
 * which is the one behaviour that cannot be arranged with a real tmux.
 */
export async function collectWithDeadline(
  run: () => Promise<FleetSnapshot> = collect,
  ms: number = COLLECT_DEADLINE_MS,
): Promise<FleetSnapshot> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(collectionAbandoned(ms))), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([run(), deadline]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** The sentence a person reads when a collection was abandoned. Exported so a test can hold it. */
export function collectionAbandoned(ms: number): string {
  return (
    `the collection did not finish within ${Math.round(ms / 1000)}s and has been abandoned — ` +
    `a tmux or bash child is probably wedged; any rows shown are from the previous one`
  );
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
  // Before anything is derived from the listing, not after: a listing of the
  // wrong box produces rows that are individually perfect.
  const self = selfCheck(listing.panes, listing.tmuxServerPid, process.env);
  if (self.kind === "absent") throw new Error(`this is not a listing of this box: ${self.why}`);
  const snapshot = snapshotFrom(parsed, listing, 0);
  const rows = snapshot.rows;

  /* ONE PASS OVER THE PANES, for the two facts that only the terminal has: what
     a blocked session is asking, and which permission mode any interactive
     Claude launched in. It used to read only the blocked rows, and that was
     right while the question was the only thing wanted from a pane — but the
     mode of a blocked session is the one thing its screen CANNOT tell us (the
     modal covers the status bar), so a check that ran only there would never
     have fired. See `readPanes` and `modeApplicability`; the cost of the extra
     captures is measured on the latter. */
  readPanes(rows);

  /* AND ONE PASS FOR WHICH RUN IS IN EACH PANE. One `ps` for the whole fleet
     and one small `/proc` read per pane, so this is the third pass rather than
     a probe per row — see `readExecutions`. */
  readExecutions(rows);

  /* AND ONE PASS FOR WHY A QUIET SESSION IS QUIET. Separate from `readPanes`
     because it reads files rather than terminals, and because it is allowed to
     fail without costing us the board — see `readPauses`. */
  await readPauses(rows);

  return { ...snapshot, collectedAt: new Date().toISOString(), tookMs: Date.now() - startedAt };
}

/**
 * Fill in `pause` on every row, from `pause.ts`.
 *
 * **THE STORE IS READ ONCE FOR THE WHOLE FLEET, NOT ONCE PER ROW.**
 * `~/.claude/sessions` is keyed by the `claude` process's pid while a row
 * carries the *pane's* pid, so the join is on the conversation uuid and the
 * whole directory has to be indexed anyway — 18 small files, 41ms cold. Doing
 * that per row would be twenty times the syscalls for one answer.
 *
 * **A FAILURE HERE MUST NOT COST THE BOARD.** This is the last thing a
 * collection does and it is the least important: a row with no `pause` is a row
 * that says *we did not look*, which is honest and readable. A row that never
 * arrives is a session missing from the page. So each row is wrapped
 * individually — one unreadable transcript must not take out the other
 * seventeen — and the whole pass is wrapped again for the store read.
 *
 * **NO RATE-LIMIT READING IS PASSED YET**, so every row will carry
 * `cannot-tell` with `rate-limits-not-collected` unless it is positively parked
 * or in a shell call. That is the honest state of the world: the scan costs
 * seconds on a loaded box, `w2-usage-limits` owns it, and the moment it
 * publishes a reading this is where it plugs in. It is emphatically not `none`.
 */
/** What {@link readExecutions} touches, so a test can drive it without a box. */
export type ExecutionIo = {
  probe: () => ProcessTableReading;
  boot: () => BootIdentity;
  uptime: () => UptimeReading;
  readStart: (pid: number) => ProcessStartTicks;
};

/**
 * **FILL IN `execution` ON EVERY ROW, FROM ONE READING OF THE PROCESS TABLE.**
 *
 * **ONE `ps` FOR THE WHOLE FLEET, NOT ONE PER ROW**, and the same for the boot
 * id. That is the collector contract the roadmap states — *"Bounded
 * process/transcript probes have one owner/cadence"* — and it is also the only
 * way the answers can be consistent with each other: thirty separate `ps` runs
 * would describe thirty slightly different boxes, so two rows could disagree
 * about a process they share. The per-row cost after that is one
 * `/proc/<pid>/stat` read, which is a few hundred bytes.
 *
 * **IT REUSES THE PROBE THAT ALREADY EXISTS.** `probeProcessTable` was written
 * for this box, carries its own positive control (a `ps` that does not contain
 * this process is refused as not being a reading of this machine), and until
 * this call site had no production caller at all. `classifyPaneHarness` is the
 * same story. Nothing here re-walks a tree or re-reads a `claude` command line.
 *
 * **COST, MEASURED RATHER THAN ASSUMED.** `probeProcessTable` uses `spawnSync`,
 * which blocks the event loop; work-probe.ts measures it at ~40 ms over ~1000
 * processes here. That is against a collection that already takes 8–12 seconds,
 * so it is noise — but it is a NEW synchronous spawn on the request process, and
 * the Responsive collection stage should take it with the two `execFileSync`
 * calls it is already going after rather than leave it as the one nobody
 * remembered. Named here so it is found.
 *
 * **A FAILURE COSTS NOTHING BUT THE READING.** Every arm of `ExecutionReading`
 * is a value, including all the failures, so a box whose `ps` will not run
 * produces rows that say why rather than rows that are missing.
 */
export function readExecutions(rows: FleetRow[], io: Partial<ExecutionIo> = {}): void {
  const probe = io.probe ?? probeProcessTable;
  const bootOf = io.boot ?? (() => readBootIdentity());
  const uptimeOf = io.uptime ?? (() => readUptime());
  const readStart = io.readStart ?? ((pid: number) => readProcessStart(pid));

  let table: ProcessTableReading;
  try {
    table = probe();
  } catch (cause) {
    table = { read: false, why: `the process table probe threw: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  const boot = bootOf();
  // READ AFTER THE PROBE, not before. It is the clock the table's elapsed times
  // are compared against, and taking it after `ps` means the derived start of a
  // process cannot land in the future.
  const uptime = uptimeOf();

  for (const row of rows) {
    try {
      row.execution = readExecutionIdentity({
        panePid: row.panePid,
        claimedConversationId: row.claudeSessionId,
        table,
        boot,
        uptime,
        readStart,
      });
    } catch (cause) {
      // `readExecutionIdentity` returns values for every failure it knows
      // about, so a throw here is a bug rather than a condition — and the cause
      // is the nearest arm rather than an accurate one. THE `why` IS THE
      // ANSWER; the cause is what a switch has to have. Same shape as
      // `readPauses` below, which maps a throw onto `transcript-unreadable`.
      row.execution = {
        kind: "unknown",
        cause: "process-table-unreadable",
        why: `deriving this session's execution identity threw: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
  }
}

export async function readPauses(rows: FleetRow[]): Promise<void> {
  let index: StoreIndex | undefined;
  try {
    const store = await readSessionStore();
    if (store.kind === "read") index = store.index;
  } catch {
    /* Left undefined, so `readPause` reads the store itself per row and reports
       its own failure in the `why`. Slower and still correct, which is the
       right way round for a pass that must not throw. */
  }

  for (const row of rows) {
    try {
      row.pause = await readPause({
        claudeSessionId: row.claudeSessionId,
        dir: row.meta.version === 1 ? row.meta.dir : null,
        ...(index === undefined ? {} : { storeIndex: index }),
      });
    } catch (cause) {
      row.pause = {
        kind: "cannot-tell",
        why: `reading this session's pause threw: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause: "transcript-unreadable",
      };
    }
  }
}
