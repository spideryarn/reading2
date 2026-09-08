/**
 * v0.5 of the fleet dashboard: the HTTP skin over the action vocabulary.
 *
 * `actions.ts` says WHAT can be done and refuses to let the three kinds be
 * confused; `queue.ts` says WHEN it may happen; `steer.ts` says whether a
 * keystroke may go out. This file adds the four questions a network hop asks —
 * is this body anything, did a person on this dashboard ask for it, is it the
 * session they were LOOKING AT, and is it the fortieth in a second — and it
 * asks them the way `routes-steer.ts` does, by importing that file's checks
 * rather than growing a second copy. Two origin checks written in parallel by
 * two agents disagreed once (origin.ts's header), and the weaker one was on the
 * route that could do more.
 *
 * THE CLIENT'S CLAIMS ARE THE INPUT. `paneId`, `sessionId`, `claudeSessionId`,
 * `panePid` and the declared status all come out of the request body, because
 * they are what the person could see when they tapped. Nothing here re-reads
 * them from live tmux, which is why this file imports no value from
 * `collect.ts` — a route that re-derived the target would make every guard
 * downstream compare the box against itself.
 *
 * THE ONE EXCEPTION IS A KILL, AND IT IS AN EXCEPTION IN BOTH DIRECTIONS. No
 * browser can know what is running on this box, so the candidate list comes
 * from `ps` here. It is then INTERSECTED with the pids the person was shown:
 * a fresh scan authorises, and the stale list bounds. A pid that has stopped
 * matching a rule since the page rendered is not killed, and a pid that started
 * matching one after the person looked is not killed either. `killVerdict`
 * judges a snapshot (its own header says so), and the window between the `ps`
 * and the `kill` is narrowed by re-reading immediately before, never closed.
 *
 * WHAT ACTUALLY HAPPENS WHERE:
 *
 *  - a **spoken** action or a free-text message is ENQUEUED and nothing is
 *    sent from here. The queue drains when the session is at a prompt, and
 *    whoever drains it does the sending.
 *  - an **enacted** action is either enqueued (for order — "push, then remove
 *    the worktree") or run immediately, and running it needs `mode: "run"`,
 *    `confirm: true`, `FLEET_ACT_ENABLED=1`, and an empty queue for that
 *    session. Four independent gates, because there is no undo.
 *  - a **broadcast** is delivered here, one `sendMessage` per recipient, with
 *    `renderBroadcast` called AT THE MOMENT OF EACH SEND. See `runBroadcast`.
 *
 * `console.log` rather than src/log.ts — server.ts's header has the reason.
 * EVERY ATTEMPT AND EVERY OUTCOME IS LOGGED, and no message text ever is:
 * character counts, pane ids, pause minutes and exit codes only. This box's
 * dashboard log must not become a transcript of what people say to their
 * agents.
 *
 * NO IMPORT SIDE EFFECTS: nothing at module scope runs a command, binds
 * anything, or reads the environment.
 */
import { execFile, execFileSync } from "node:child_process";
import { readlinkSync } from "node:fs";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  actionById,
  boxActions,
  planKillProcesses,
  planKillSession,
  planRemoveWorktree,
  renderBroadcast,
  selectForKill,
  sessionActions,
  staggerMinutes,
  type Action,
  type ActionId,
  type BroadcastAction,
  type EnactedAction,
  type KillPolicy,
  type KillRule,
  type Plan,
  type PlanRefusalRule,
  type ProcRecord,
  type Speaker,
  type Step,
} from "./actions.js";
import {
  drainGate,
  SteeringQueue,
  type DrainGate,
  type EnqueueRefusalRule,
  type EnqueueResult,
  type QueuedItem,
} from "./queue.js";
import {
  checkOrigin,
  createRateLimiter,
  MAX_BODY_BYTES,
  parseStatus,
  parseTarget,
  readBody,
  type BodyStream,
  type Parsed,
  type RateLimiter,
  type RouteErrorCode,
} from "./routes-steer.js";
import type { FleetStatus } from "./status.js";
import { sendMessage as realSendMessage, type RefusalCode, type SteerResult, type SteerTarget } from "./steer.js";

/* ------------------------------------------------------------------ *
 * Limits. Exported so a test can drive them rather than sleeping.
 * ------------------------------------------------------------------ */

/**
 * The box route's body is bigger than the steering route's, because a broadcast
 * carries every recipient the page was showing. Thirty-six rows of five
 * identifiers is around 8 KiB, and 16 KiB would have started refusing at about
 * seventy sessions — a cap that fires only on a big fleet is a cap that fires
 * for the first time on the worst night.
 */
export const MAX_BOX_BODY_BYTES = 64 * 1024;

/** A floor between two writes to the same session's queue. */
export const MIN_INTERVAL_MS = 1_000;
/** And a whole-box ceiling, so a script cannot walk every row at once. */
export const BURST_MAX = 12;
export const BURST_WINDOW_MS = 10_000;

/**
 * How long before the fleet may be told to ease off again.
 *
 * A broadcast is thirty-six interruptions and thirty-six pauses. Sent twice in
 * five minutes it is worse than not sent at all: every agent gets two different
 * resume times, the second overwrites the first in whatever order the panes are
 * read, and the stagger — the entire point — is gone. Ten minutes is longer
 * than any plausible double-tap and shorter than the pause it asks for.
 */
export const BROADCAST_COOLDOWN_MS = 10 * 60_000;

/** More recipients than this is a script, not a fleet. */
export const MAX_RECIPIENTS = 80;

/**
 * How long the whole fan-out may take before it stops early.
 *
 * **`sendMessage` is synchronous** — three `execFileSync` tmux calls with
 * ten-second timeouts each — so a broadcast to thirty-six sessions holds this
 * server's single thread for as long as it takes, and while it does, the page,
 * the SSE stream and every other route answer nothing. On a healthy box that is
 * a couple of seconds. On the box this button exists FOR — load 391, tmux calls
 * timing out — thirty-six recipients at ten seconds each is minutes of a
 * dashboard that looks dead, at the moment somebody is staring at it.
 *
 * So the loop hands the event loop back between recipients and gives up at this
 * deadline, naming the rows it never reached. A broadcast that tells thirty of
 * thirty-six is worth having; a dashboard that stops answering is not.
 */
export const BROADCAST_DEADLINE_MS = 90_000;

/**
 * More pids than this in one kill is not a sweep, it is an accident.
 *
 * The batch is REFUSED rather than truncated. A cap that silently kills the
 * first sixty-four is a cap that reports success while doing something other
 * than what was confirmed, and the person's own list is right there to compare
 * against.
 */
export const MAX_KILL_PIDS = 64;

/** Per step. `worktree:sweep` does a fetch; `kill` returns instantly. */
export const STEP_TIMEOUT_MS = 120_000;

/* ------------------------------------------------------------------ *
 * The wire shapes.
 * ------------------------------------------------------------------ */

/**
 * Everything that can go wrong that is not a `RefusalCode` from steer.ts.
 *
 * `RouteErrorCode` is reused whole rather than re-listed, so a code added to
 * the steering route arrives here and the `Record` below stops compiling until
 * somebody gives it a status.
 */
export type ActionErrorCode =
  | RouteErrorCode
  /** No action with that id. */
  | "no-such-action"
  /** A box action posted at the session route, or the other way round. */
  | "wrong-scope"
  /** `mode` and the action's `effect` do not go together — a spoken "run", say. */
  | "wrong-mode"
  /** The catalogue says this action needs a second tap and the body did not carry one. */
  | "confirm-required"
  /** Running enacted actions is switched off. Dry runs are not. */
  | "acting-disabled"
  /** The queue refused it — full, a double tap, an unsendable message. */
  | "queue-refused"
  /** This session cannot be typed into at all, in steer.ts's own words. */
  | "not-steerable"
  /** No queued item with that id in that session's queue. */
  | "no-such-item"
  /** It is out for delivery, so it cannot be taken back. */
  | "in-flight"
  /** Something is queued for this session, and an immediate effect would jump it. */
  | "queue-not-empty"
  /** `plan*` in actions.ts refused to build the commands. */
  | "plan-refused"
  /** The plan ran and a step failed its gate, so the later steps did not run. */
  | "plan-failed"
  /** `ps` could not be read, so nothing about the box may be believed. */
  | "box-unreadable"
  /** Nothing matched the rule, or nothing survived the intersection. */
  | "nothing-to-kill"
  /** The fleet was told to ease off very recently. */
  | "cooldown";

/**
 * A refusal's HTTP status.
 *
 * A `Record` keyed by the union rather than a switch with a default, the same
 * trick and the same reason as `REFUSAL_STATUS` next door: a new code stops
 * this file compiling instead of inheriting somebody's guess.
 *
 * Nothing here is a 200, and `internal` is the only 5xx that means we broke —
 * `acting-disabled` is a 503 because the server is deliberately declining, and
 * a client must not retry it.
 */
export const ACTION_ERROR_STATUS: Record<ActionErrorCode, number> = {
  "bad-request": 400,
  "forbidden-origin": 403,
  "unsupported-media-type": 415,
  "body-too-large": 413,
  "rate-limited": 429,
  "method-not-allowed": 405,
  "answering-disabled": 503,
  internal: 500,
  "no-such-action": 400,
  "wrong-scope": 400,
  "wrong-mode": 400,
  "confirm-required": 400,
  "acting-disabled": 503,
  "queue-refused": 409,
  "not-steerable": 409,
  "no-such-item": 404,
  "in-flight": 409,
  "queue-not-empty": 409,
  "plan-refused": 400,
  // The plan ran and a gate said no. That is the system working — `worktree:check`
  // found something that exists nowhere else — so it is a 4xx with the step
  // outcomes in the body, not a 500 that reads as "the dashboard is broken".
  "plan-failed": 409,
  "box-unreadable": 409,
  "nothing-to-kill": 409,
  cooldown: 429,
};

/** What a queued item looks like on the wire, with the queue's own staleness rule applied. */
export type QueuedItemView = QueuedItem & { stale: boolean };

export type QueueView = {
  sessionId: string;
  items: QueuedItemView[];
  volatile: true;
  warning: string;
  since: number;
};

/** One step, after it ran. */
export type StepStatus = "passed" | "failed" | "failed-ignored";

export type StepOutcome = {
  argv: readonly string[];
  cwd: string;
  /** The step's own reason for existing, from the plan. */
  why: string;
  status: StepStatus;
  /** Why it got that status — the gate, in words. */
  verdict: string;
  code: number | null;
  timedOut: boolean;
  spawnError: string | null;
  /** The tail of what it said, bounded, for a person. */
  tail: string;
};

export type PlanRun = {
  action: ActionId;
  steps: StepOutcome[];
  /** True when every step ran and none failed a gate it was not allowed to fail. */
  completed: boolean;
  /** The index of the step that stopped the plan, or null. */
  stoppedAt: number | null;
};

/** One candidate for a kill, with the named rule that licensed it. */
export type KillCandidate = {
  pid: number;
  rule: KillRule;
  why: string;
  /** So the person can see what they are about to kill, not just a number. */
  comm: string;
  args: string;
  rssKiB: number;
  etimeSeconds: number;
};

/** What became of one recipient of a broadcast. */
export type BroadcastOutcome = {
  paneId: string;
  sessionId: string;
  /** The pause this recipient was asked for, or null when nothing was sent. */
  minutes: number | null;
  outcome: "sent" | "refused" | "held" | "blocked" | "not-reached";
  code: RefusalCode | null;
  why: string | null;
};

export type ActionResponse =
  | { ok: true; op: "catalogue"; schema: 1; actions: { session: readonly Action[]; box: readonly Action[] }; queues: QueueView[]; acting: { enabled: boolean; why: string }; now: number }
  | { ok: true; op: "enqueued"; item: QueuedItem; position: number; gate: DrainGate }
  | { ok: true; op: "cancelled"; item: QueuedItem }
  | { ok: true; op: "dry-run"; action: ActionId; steps: readonly Step[]; candidates?: KillCandidate[]; scanned?: number; unreadable?: number }
  | { ok: true; op: "ran"; action: ActionId; run: PlanRun; killed?: number[]; skipped?: { pid: number; why: string }[] }
  | { ok: true; op: "broadcast-preview"; action: ActionId; total: number; recipients: BroadcastOutcome[]; sample: string | null }
  | { ok: true; op: "broadcast"; action: ActionId; total: number; recipients: BroadcastOutcome[] }
  | {
      ok: false;
      code: ActionErrorCode;
      why: string;
      /** Present when a plan ran and stopped, so the page can show which step said no. */
      run?: PlanRun;
    };

/* ------------------------------------------------------------------ *
 * Parsing. Every field of every body, checked.
 * ------------------------------------------------------------------ */

function bad<T>(why: string): Parsed<T> {
  return { ok: false, why };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * What the caller wants done with the action.
 *
 * **`enqueue` is the default and `run` must be spelled out**, which is the
 * first of the four gates in front of an irreversible effect. A body that
 * forgot the field, or a client written against an older shape, queues
 * something visible and cancellable rather than deleting a directory.
 */
export type ActionMode = "enqueue" | "dry-run" | "run";

export function parseMode(v: unknown, fallback: ActionMode): Parsed<ActionMode> {
  if (v === undefined || v === null) return { ok: true, value: fallback };
  const s = asString(v);
  if (s === "enqueue" || s === "dry-run" || s === "run") return { ok: true, value: s };
  return bad(`mode must be 'enqueue', 'dry-run' or 'run', not ${JSON.stringify(v)}`);
}

/**
 * Who is speaking, defaulting to the WEAKER claim.
 *
 * `overseer` rather than `greg` when the field is missing, and the asymmetry is
 * the point: a coordinator that forgets to say who it is gets the prefix that
 * says "weigh this as a peer's suggestion", and a caller that wants Greg's
 * authority has to ask for it in as many words. The other default would let a
 * model mint its own approval by omission — A12 in actions.ts's own header.
 */
export function parseSpeaker(v: unknown): Parsed<Speaker> {
  if (v === undefined || v === null) return { ok: true, value: "overseer" };
  const s = asString(v);
  if (s === "greg" || s === "overseer") return { ok: true, value: s };
  return bad(`speaker must be 'greg' or 'overseer', not ${JSON.stringify(v)}`);
}

export type SessionActionRequest = {
  target: SteerTarget;
  declaredStatus: FleetStatus;
  what: { kind: "action"; action: Action } | { kind: "message"; text: string };
  mode: ActionMode;
  confirm: boolean;
  /** For `remove-worktree`. The row's own directory and branch, as shown. */
  worktreeDir: string | null;
  branch: string | null;
  /** For `kill-session`. The row's name, as shown. */
  sessionName: string | null;
};

/** `POST /api/actions/session`'s body. */
export function parseSessionBody(raw: unknown): Parsed<SessionActionRequest> {
  const o = asRecord(raw);
  if (!o) return bad("the body is not a JSON object");
  const target = parseTarget(o);
  if (!target.ok) return target;
  const declaredStatus = parseStatus(o.status);
  if (declaredStatus === null) {
    return bad("status is missing or is not a status; send the one the row you tapped was showing");
  }

  const actionId = o.actionId === undefined || o.actionId === null ? null : asString(o.actionId);
  const text = o.text === undefined || o.text === null ? null : asString(o.text);
  if (o.actionId !== undefined && o.actionId !== null && actionId === null) return bad("actionId is not a string");
  if (o.text !== undefined && o.text !== null && text === null) return bad("text is not a string");
  if (actionId === null && text === null) return bad("send either an actionId or a text; this body has neither");
  if (actionId !== null && text !== null) {
    // Not tidiness: a body with both has two answers to "what did the person
    // press", and whichever one this file read first would be the one that
    // happened. Refusing is the only reading with no second interpretation.
    return bad("send either an actionId or a text, not both");
  }

  let what: SessionActionRequest["what"];
  if (actionId !== null) {
    const action = actionById(actionId);
    if (action === null) return bad(`there is no action called '${actionId}'`);
    what = { kind: "action", action };
  } else if (text !== null) {
    what = { kind: "message", text };
  } else {
    return bad("send either an actionId or a text; this body has neither");
  }

  const mode = parseMode(o.mode, "enqueue");
  if (!mode.ok) return mode;
  const confirm = o.confirm === true;
  const worktreeDir = asString(o.worktreeDir);
  const branch = asString(o.branch);
  const sessionName = asString(o.sessionName);

  return {
    ok: true,
    value: { target: target.value, declaredStatus, what, mode: mode.value, confirm, worktreeDir, branch, sessionName },
  };
}

export type Recipient = { target: SteerTarget; declaredStatus: FleetStatus };

export type BoxActionRequest = {
  action: Action;
  mode: ActionMode;
  confirm: boolean;
  speaker: Speaker;
  /** For a kill: the pids the person was shown. Empty means "I was shown none". */
  pids: number[];
  /** For a broadcast: the rows the page was showing, verbatim. */
  recipients: Recipient[];
};

/** `POST /api/actions/box`'s body. */
export function parseBoxBody(raw: unknown): Parsed<BoxActionRequest> {
  const o = asRecord(raw);
  if (!o) return bad("the body is not a JSON object");
  const actionId = asString(o.actionId);
  if (actionId === null) return bad("actionId is missing");
  const action = actionById(actionId);
  if (action === null) return bad(`there is no action called '${actionId}'`);
  // DRY RUN BY DEFAULT on the route that can kill things. `enqueue` is
  // meaningless here — there is no single session to be ordered against, which
  // is the same reason `enqueueAction` refuses a box-wide action.
  const mode = parseMode(o.mode, "dry-run");
  if (!mode.ok) return mode;
  if (mode.value === "enqueue") return bad("a box-wide action cannot be queued against one session; use 'dry-run' or 'run'");
  const speaker = parseSpeaker(o.speaker);
  if (!speaker.ok) return speaker;
  const confirm = o.confirm === true;

  const pids: number[] = [];
  if (o.pids !== undefined && o.pids !== null) {
    if (!Array.isArray(o.pids)) return bad("pids is present and is not an array");
    if (o.pids.length > MAX_KILL_PIDS) return bad(`${o.pids.length} pids is more than the ${MAX_KILL_PIDS} this will act on at once`);
    for (const p of o.pids) {
      if (typeof p !== "number" || !Number.isSafeInteger(p) || p <= 1) return bad(`${JSON.stringify(p)} is not a pid`);
      pids.push(p);
    }
  }

  const recipients: Recipient[] = [];
  if (o.recipients !== undefined && o.recipients !== null) {
    if (!Array.isArray(o.recipients)) return bad("recipients is present and is not an array");
    if (o.recipients.length > MAX_RECIPIENTS) {
      return bad(`${o.recipients.length} recipients is more than the ${MAX_RECIPIENTS} this will speak to at once`);
    }
    const seen = new Set<string>();
    for (const item of o.recipients) {
      const r = asRecord(item);
      if (!r) return bad("a recipient is not an object");
      const target = parseTarget(r);
      if (!target.ok) return bad(`a recipient is not addressable: ${target.why}`);
      const status = parseStatus(r.status);
      if (status === null) return bad(`recipient ${target.value.paneId} has no status; send the one its row was showing`);
      // DUPLICATES ARE DROPPED, NOT REFUSED. A page that renders a row twice
      // would otherwise send one agent two different pause times and skew every
      // other agent's share of the window; refusing the whole broadcast for a
      // rendering bug would be worse than quietly speaking to each pane once.
      if (seen.has(target.value.paneId)) continue;
      seen.add(target.value.paneId);
      recipients.push({ target: target.value, declaredStatus: status });
    }
  }

  return { ok: true, value: { action, mode: mode.value, confirm, speaker: speaker.value, pids, recipients } };
}

export type CancelRequest = { sessionId: string; itemId: string };

/** `POST`/`DELETE /api/actions/cancel`'s body. */
export function parseCancelBody(raw: unknown): Parsed<CancelRequest> {
  const o = asRecord(raw);
  if (!o) return bad("the body is not a JSON object");
  const sessionId = asString(o.sessionId);
  const itemId = asString(o.itemId);
  if (sessionId === null) return bad("sessionId is missing, and it says which queue");
  if (itemId === null) return bad("itemId is missing");
  return { ok: true, value: { sessionId, itemId } };
}

/* ------------------------------------------------------------------ *
 * Running a plan. The contract is actions.ts's, and it is load-bearing.
 * ------------------------------------------------------------------ */

/** One finished subprocess, read honestly. */
export type StepRun = {
  /** The exit code, or null when it died on a signal or never ran. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Set when the process could not be run at all (ENOENT and friends). */
  spawnError: string | null;
};

const ANSI = /\[[0-9;?]*[ -/]*[@-~]/g;

/** The tail of a subprocess's noise, for a person, bounded. */
export function tailOf(text: string, lines = 4, max = 400): string {
  const clean = text
    .replace(ANSI, "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");
  const tail = clean.slice(-lines).join(" · ");
  return tail.length > max ? `${tail.slice(0, max)}…` : tail;
}

/**
 * Did this step pass its gate?
 *
 * The `never` on `pass.kind` is doing the same job as the one in
 * `describeAction`: a fourth kind of gate in actions.ts stops this compiling,
 * rather than falling through to whichever branch happened to be last.
 *
 * **A timeout or a spawn failure is never a pass**, including for
 * `stdout-has-line`: a `tmux list-sessions` that was killed at two minutes has
 * told us nothing about whether that name still means that session, and an
 * empty stdout that "does not contain the line" and a stdout we never got are
 * the same absence with very different meanings.
 */
export function judgeStep(step: Step, r: StepRun): { status: StepStatus; verdict: string } {
  const ran = r.spawnError === null && !r.timedOut;
  const exitedZero = ran && r.code === 0;
  const howItEnded = r.spawnError !== null
    ? `it could not be run: ${r.spawnError}`
    : r.timedOut
      ? "it was killed for taking too long"
      : r.code === null
        ? "it died on a signal"
        : `it exited ${r.code}`;

  switch (step.pass.kind) {
    case "exit-zero":
      return exitedZero ? { status: "passed", verdict: "it exited 0" } : { status: "failed", verdict: howItEnded };
    case "stdout-has-line": {
      if (!exitedZero) return { status: "failed", verdict: `${howItEnded}, so its output says nothing` };
      const wanted = step.pass.line.trim();
      const found = r.stdout.split("\n").some((l) => l.trim() === wanted);
      return found
        ? { status: "passed", verdict: `its output contains '${wanted}'` }
        : { status: "failed", verdict: `its output does not contain '${wanted}'` };
    }
    case "best-effort":
      return exitedZero
        ? { status: "passed", verdict: "it exited 0" }
        : { status: "failed-ignored", verdict: `${howItEnded}, which this step is allowed to do` };
    default: {
      const never: never = step.pass;
      return never;
    }
  }
}

/**
 * Run a plan's steps in order, and STOP at the first one that fails.
 *
 * This is the contract written in `Plan`'s doc comment, and it is the reason
 * that comment exists: a runner that carried on would run
 * `worktree:sweep -- remove` after `worktree:check` had said "there is
 * something in here that exists nowhere else", and every guard in actions.ts
 * would have passed on the way to deleting a day's work.
 *
 * `best-effort` is the only kind of failure that does not stop the plan, and it
 * is still RECORDED as `failed-ignored` rather than smoothed into a pass —
 * thirty kills of which eleven found nothing there is a fact worth reading.
 *
 * The steps are sequential and awaited one at a time. Not for tidiness: two
 * `kill`s racing is harmless, but `worktree:check` and `worktree:sweep` in
 * parallel is the whole bug this function exists to prevent, and a runner with
 * two modes would eventually be used in the wrong one.
 */
export async function runPlan(plan: Plan, io: ActionIo, timeoutMs: number = STEP_TIMEOUT_MS): Promise<PlanRun> {
  const steps: StepOutcome[] = [];
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    // `noUncheckedIndexedAccess`. Unreachable, and a `break` rather than a
    // `continue`: if the array is not what we think it is, stopping is the
    // direction to be wrong in.
    if (step === undefined) break;
    const r = await io.runStep(step, timeoutMs);
    const j = judgeStep(step, r);
    steps.push({
      argv: step.argv,
      cwd: step.cwd,
      why: step.why,
      status: j.status,
      verdict: j.verdict,
      code: r.code,
      timedOut: r.timedOut,
      spawnError: r.spawnError,
      tail: tailOf(r.stderr) || tailOf(r.stdout),
    });
    if (j.status === "failed") {
      return { action: plan.action.id, steps, completed: false, stoppedAt: i };
    }
  }
  return { action: plan.action.id, steps, completed: true, stoppedAt: null };
}

/* ------------------------------------------------------------------ *
 * Reading the process table.
 * ------------------------------------------------------------------ */

export type ProcScan = { ok: true; procs: ProcRecord[]; unreadable: number } | { ok: false; why: string };

/**
 * `ps -eo pid=,ppid=,rss=,etimes=,args=` — four numeric columns, then the rest.
 *
 * Unparseable lines are skipped rather than failing the scan; a header we did
 * not ask for or a line with a `?` in a numeric column is not a reason to stop
 * knowing about the other fifteen hundred processes. An output with NO
 * parseable lines is a different thing and the caller treats it as one.
 */
export function parsePsArgs(out: string): { pid: number; ppid: number; rssKiB: number; etimeSeconds: number; args: string }[] {
  const rows: { pid: number; ppid: number; rssKiB: number; etimeSeconds: number; args: string }[] = [];
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s?(.*)$/.exec(line);
    if (!m) continue;
    const [, pid, ppid, rss, etimes, args] = m;
    if (pid === undefined || ppid === undefined || rss === undefined || etimes === undefined) continue;
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      rssKiB: Number(rss),
      etimeSeconds: Number(etimes),
      args: (args ?? "").trim(),
    });
  }
  return rows;
}

/**
 * `ps -eo pid=,comm=` — the pid, then everything else on the line.
 *
 * A SECOND CALL rather than another column on the first, because **`comm` can
 * contain a space** (measured on this box: the tmux server's is `tmux: server`)
 * and a column in the middle of a whitespace-split line would take half of it
 * and shift everything after. Put last it is unambiguous, and `args` needs that
 * position too — so there are two calls and neither has to guess.
 */
export function parsePsComm(out: string): Map<number, string> {
  const byPid = new Map<number, string>();
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = m[1];
    const comm = m[2];
    if (pid === undefined || comm === undefined || comm.trim() === "") continue;
    byPid.set(Number(pid), comm.trim());
  }
  return byPid;
}

/**
 * Join the two listings, and DROP anything whose `comm` we could not read.
 *
 * The dropping is the safety property. `isProtected` matches a prefix of
 * `comm`, so a record with an empty one matches nothing on the protected list —
 * a `claude` we failed to name would arrive at `killVerdict` looking exactly
 * like an ordinary process, and a rule it matched would kill it. Unreadable
 * must not arrive disguised as ordinary; the count is returned so the page can
 * say how many we refused to have an opinion about.
 */
export function mergeProcs(
  rows: readonly { pid: number; ppid: number; rssKiB: number; etimeSeconds: number; args: string }[],
  comms: ReadonlyMap<number, string>,
  cwdOf: (pid: number) => string | null,
): { procs: ProcRecord[]; unreadable: number } {
  const procs: ProcRecord[] = [];
  let unreadable = 0;
  for (const r of rows) {
    const comm = comms.get(r.pid);
    if (comm === undefined || comm === "") {
      unreadable += 1;
      continue;
    }
    procs.push({ pid: r.pid, ppid: r.ppid, comm, args: r.args, cwd: cwdOf(r.pid), rssKiB: r.rssKiB, etimeSeconds: r.etimeSeconds });
  }
  return { procs, unreadable };
}

/* ------------------------------------------------------------------ *
 * The io seam. Everything that touches the box is behind this.
 * ------------------------------------------------------------------ */

export type ActionIo = {
  /** Run one step of a plan. Never a shell — `execFile` with the plan's argv. */
  runStep(step: Step, timeoutMs: number): Promise<StepRun>;
  /** Every process on the box, or why not. */
  listProcesses(): Promise<ProcScan>;
  /** This process, so `killVerdict` can refuse to cut its own branch. */
  selfPid(): number;
};

/** The repo this file is in — `tools/fleet/` is two levels down from its root. */
export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** How long a killed process group gets to die politely before SIGKILL. */
const GRACE_MS = 5_000;

/**
 * The real thing.
 *
 * `execFile` with the plan's argv ARRAY, never a shell string, so a directory
 * with a space or a semicolon in it stays a directory. Nothing about the
 * command comes from the request: `plan*` in actions.ts built it, and the only
 * caller-supplied fragments in it went through that file's own validation.
 *
 * **The timeout kills a process GROUP.** `npm run worktree:sweep` is npm, which
 * is a node, which spawns tsx, which runs git; signalling npm alone leaves the
 * git holding a lock in a directory we were about to remove. So the child is
 * `detached`, and the deadline signals `-pid`.
 */
export function realActionIo(): ActionIo {
  return {
    runStep: (step, timeoutMs) =>
      new Promise<StepRun>((resolve) => {
        const bin = step.argv[0];
        if (bin === undefined) {
          resolve({ code: null, stdout: "", stderr: "", timedOut: false, spawnError: "the step has no command in it" });
          return;
        }
        let settled = false;
        const done = (r: StepRun): void => {
          if (settled) return;
          settled = true;
          resolve(r);
        };
        // OUR OWN FLAG, not `err.killed`: the callback cannot tell a deadline we
        // enforced from a SIGTERM somebody else sent, and reporting an outside
        // kill as "timed out" is a sentence about the wrong thing.
        let deadlinePassed = false;
        const options = {
          cwd: step.cwd,
          killSignal: "SIGTERM" as const,
          encoding: "utf8" as const,
          maxBuffer: 8 * 1024 * 1024,
          detached: true,
        };
        const child = execFile(bin, [...step.argv.slice(1)], options, (err, stdout, stderr) => {
          clearTimeout(deadline);
          clearTimeout(hardStop);
          const e = err as (Error & { code?: number | string }) | null;
          done({
            code: e === null ? 0 : typeof e.code === "number" ? e.code : null,
            stdout,
            stderr,
            timedOut: deadlinePassed,
            spawnError: e !== null && typeof e.code === "string" ? `${e.code}: ${e.message}` : null,
          });
        });
        const pid = child.pid;
        const killGroup = (signal: NodeJS.Signals): void => {
          try {
            if (pid === undefined) throw new Error("no pid");
            // The MINUS is the point: a bare pid signals npm and leaves the git.
            process.kill(-pid, signal);
          } catch {
            try {
              child.kill(signal);
            } catch {
              /* already gone, which is the outcome we wanted */
            }
          }
        };
        let hardStop: NodeJS.Timeout | undefined;
        const deadline = setTimeout(() => {
          deadlinePassed = true;
          killGroup("SIGTERM");
          hardStop = setTimeout(() => killGroup("SIGKILL"), GRACE_MS);
          hardStop.unref();
        }, timeoutMs);
        // Neither timer may hold the process open.
        deadline.unref();
      }),

    listProcesses: () =>
      Promise.resolve().then((): ProcScan => {
        try {
          const args = execFileSync("ps", ["-eo", "pid=,ppid=,rss=,etimes=,args="], {
            encoding: "utf8",
            timeout: 10_000,
            maxBuffer: 32 * 1024 * 1024,
          });
          const comm = execFileSync("ps", ["-eo", "pid=,comm="], {
            encoding: "utf8",
            timeout: 10_000,
            maxBuffer: 8 * 1024 * 1024,
          });
          const rows = parsePsArgs(args);
          // AN EMPTY PARSE IS AN ERROR, NOT AN EMPTY BOX. `ps` exiting 0 with
          // nothing we could read means we do not know what is running, and
          // "nothing matched the rule" is the reading that makes the page say
          // the box is clean. config.ts makes the same distinction about binds.
          if (rows.length === 0) return { ok: false, why: "ps returned nothing this could parse, so nothing about the box may be believed" };
          const merged = mergeProcs(rows, parsePsComm(comm), (pid) => {
            try {
              return readlinkSync(`/proc/${pid}/cwd`);
            } catch {
              // Gone between the two reads, or not ours to look at. Null means
              // "we could not tell", and `hasDeletedCwd` refuses to guess.
              return null;
            }
          });
          return { ok: true, procs: merged.procs, unreadable: merged.unreadable };
        } catch (e) {
          return { ok: false, why: `ps could not be read: ${(e as Error).message}` };
        }
      }),

    selfPid: () => process.pid,
  };
}

/* ------------------------------------------------------------------ *
 * The routes.
 * ------------------------------------------------------------------ */

export type ActionDeps = {
  /** The one queue per server. Shared with whatever drains it. */
  queue: SteeringQueue;
  /**
   * The delivery module, injected so this file's own tests can prove what it
   * passes DOWN without a single keystroke going out. There are ~35 live agent
   * sessions on this box doing other people's work.
   */
  sendMessage: typeof realSendMessage;
  io: ActionIo;
  now: () => number;
  limiter: RateLimiter;
  log: (line: string) => void;
  /**
   * Whether an enacted action may actually RUN, and whether a broadcast may
   * actually go out. Dry runs are never gated by it.
   *
   * Off unless `FLEET_ACT_ENABLED=1`, and read per request rather than captured
   * at construction, so turning it on is a restart rather than a rebuild. The
   * precedent is `answeringEnabled` in routes-steer.ts and so is the reasoning:
   * the route stays built, tested and reachable, and refuses with a sentence
   * saying why — better than deleting it, and much better than a dashboard on a
   * phone that kills thirty processes because a pocket pressed something.
   */
  actEnabled: () => boolean;
  /**
   * Hand the event loop back between two sends of a broadcast.
   *
   * A dep rather than a bare `setImmediate` so a test can drive a fan-out
   * without depending on the scheduler, and so `BROADCAST_DEADLINE_MS` can be
   * measured against the injected clock rather than against a real wait.
   */
  yieldToLoop: () => Promise<void>;
  /**
   * The checkout `worktree:sweep` and `gjd-remote` are run from, and the root
   * every removable worktree must be under.
   *
   * DECIDED HERE, NOT SENT BY THE CLIENT. It is the one input to a plan that a
   * browser has no business naming: `dir` and `branch` describe the row the
   * person tapped, but the directory we run npm in is ours.
   */
  primaryDir: () => string;
};

export function realActionDeps(): ActionDeps {
  return {
    queue: new SteeringQueue({ now: () => Date.now() }),
    sendMessage: realSendMessage,
    io: realActionIo(),
    now: () => Date.now(),
    limiter: createRateLimiter({ minIntervalMs: MIN_INTERVAL_MS, burstMax: BURST_MAX, burstWindowMs: BURST_WINDOW_MS }),
    log: (line) => console.log(line),
    actEnabled: () => process.env["FLEET_ACT_ENABLED"] === "1",
    yieldToLoop: () => new Promise<void>((r) => setImmediate(r)),
    primaryDir: () => repoRoot(),
  };
}

export type ActionRoutes = {
  /** True when this request was ours — mounted the way `serveStatic` is. */
  handle(req: IncomingMessage, res: ServerResponse): boolean;
};

function respond(res: ServerResponse, status: number, body: ActionResponse, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...extra });
  res.end(JSON.stringify(body));
}

function refuse(res: ServerResponse, code: ActionErrorCode, why: string, run?: PlanRun, extra: Record<string, string> = {}): void {
  respond(res, ACTION_ERROR_STATUS[code], run === undefined ? { ok: false, code, why } : { ok: false, code, why, run }, extra);
}

function header(headers: IncomingHttpHeaders, name: string): string | null {
  const v = headers[name];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0] ?? null;
  return null;
}

/** The bit of a request that identifies the caller, for the log. Never the body. */
function who(req: IncomingMessage): string {
  return `from=${req.socket?.remoteAddress ?? "-"} origin=${header(req.headers, "origin") ?? "-"}`;
}

const ACTING_DISABLED_WHY =
  "running an enacted action is disabled on this server: set FLEET_ACT_ENABLED=1 and restart it. " +
  "Dry runs work either way — ask what it would do, and do it in the terminal if that is what you want.";

/**
 * The map of enqueue refusals onto HTTP-visible codes.
 *
 * Keyed by the union so a new refusal rule in queue.ts stops this compiling.
 * They are nearly all `queue-refused`, and the exceptions are the two the page
 * must be able to tell apart: an action that does not belong here at all, and a
 * target that is not an address.
 */
const ENQUEUE_CODE: Record<EnqueueRefusalRule, ActionErrorCode> = {
  "bad-target": "bad-request",
  "bad-text": "bad-request",
  "no-such-action": "no-such-action",
  "wrong-scope": "wrong-scope",
  "session-queue-full": "queue-refused",
  "fleet-queue-full": "queue-refused",
  "double-tap": "queue-refused",
};

/** Every reason `plan*` can refuse, as one code. They are all "your input was wrong". */
const PLAN_REFUSAL_CODE: Record<PlanRefusalRule, ActionErrorCode> = {
  "bad-input": "plan-refused",
  "not-a-worktree": "plan-refused",
  "never-the-primary-checkout": "plan-refused",
  "no-pids": "nothing-to-kill",
};

export function makeActionRoutes(overrides: Partial<ActionDeps> = {}): ActionRoutes {
  const deps: ActionDeps = { ...realActionDeps(), ...overrides };
  /** When the fleet was last told to ease off. Server-lifetime, like the queue. */
  let lastBroadcastAt: number | null = null;

  /* ---------------- GET /api/actions ---------------- */

  function catalogue(res: ServerResponse): void {
    const queues: QueueView[] = deps.queue.snapshots().map((s) => ({
      sessionId: s.sessionId,
      // `stale` is the QUEUE's rule, asked rather than recomputed. A page that
      // decided staleness for itself would be a second opinion about when an
      // instruction is too old to deliver, and the two would drift.
      items: s.items.map((i) => ({ ...i, stale: deps.queue.isStale(i) })),
      volatile: true,
      warning: s.warning,
      since: s.since,
    }));
    respond(res, 200, {
      ok: true,
      op: "catalogue",
      schema: 1,
      actions: { session: sessionActions(), box: boxActions() },
      queues,
      // TOLD, NOT INFERRED — state.ts's `answeringEnabled` and its reasoning:
      // the page cannot honestly warn about a flag it has never been told, and
      // the alternative is a person discovering it by tapping and getting a 503.
      acting: { enabled: deps.actEnabled(), why: deps.actEnabled() ? "" : ACTING_DISABLED_WHY },
      now: deps.now(),
    });
  }

  /* ---------------- POST /api/actions/session ---------------- */

  /**
   * Build the plan for a session-scoped enacted action.
   *
   * The two plan functions get their `primaryDir` from us and everything else
   * from the row the person tapped. `worktreeDir` gets one bound this file adds
   * on top of `planRemoveWorktree`'s: it must be under THIS checkout's
   * `.claude/worktrees/`. `isUnderWorktreesDir` accepts that shape anywhere on
   * the filesystem, which is right for a general-purpose guard and too loose
   * for a route — step 2 runs `worktree:sweep` in our own checkout, so a
   * worktree belonging to some other repo could never have been removed by it
   * anyway, and refusing here says so instead of failing halfway.
   */
  function planFor(req: SessionActionRequest, action: EnactedAction): { ok: true; plan: Plan } | { ok: false; code: ActionErrorCode; why: string } {
    const primaryDir = deps.primaryDir();
    if (action.id === "remove-worktree") {
      if (req.worktreeDir === null || req.branch === null) {
        return { ok: false, code: "bad-request", why: "removing a worktree needs worktreeDir and branch, from the row you tapped" };
      }
      const root = `${primaryDir.replace(/\/+$/, "")}/.claude/worktrees/`;
      if (!req.worktreeDir.startsWith(root)) {
        return {
          ok: false,
          code: "plan-refused",
          why: `'${req.worktreeDir}' is not under ${root}, and this server only removes worktrees of the checkout it is running from`,
        };
      }
      const p = planRemoveWorktree(action, { dir: req.worktreeDir, branch: req.branch, primaryDir });
      return p.ok ? { ok: true, plan: p.plan } : { ok: false, code: PLAN_REFUSAL_CODE[p.rule], why: p.why };
    }
    if (action.id === "kill-session") {
      if (req.sessionName === null) {
        return { ok: false, code: "bad-request", why: "killing a session needs sessionName, from the row you tapped" };
      }
      const p = planKillSession(action, { name: req.sessionName, sessionId: req.target.sessionId, primaryDir });
      return p.ok ? { ok: true, plan: p.plan } : { ok: false, code: PLAN_REFUSAL_CODE[p.rule], why: p.why };
    }
    // kill-test-suites and kill-safe-processes are box-scoped and never reach
    // here; the scope check above refuses them first.
    return { ok: false, code: "wrong-scope", why: `'${action.id}' is not an action one session can be asked for` };
  }

  async function sessionRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = await parsedBody(req, res, MAX_BODY_BYTES);
    if (parsed === null) return;
    const body = parseSessionBody(parsed);
    if (!body.ok) {
      deps.log(`action session: refused code=bad-request why=${body.why}`);
      refuse(res, "bad-request", body.why);
      return;
    }
    const r = body.value;
    const target = r.target;
    // Note what is NOT in this line: the message, and the action's words.
    const shape = r.what.kind === "action" ? `action=${r.what.action.id}` : `chars=${r.what.text.length}`;
    deps.log(
      `action session: pane=${target.paneId} session=${target.sessionId} claude=${target.claudeSessionId} ` +
        `declared=${r.declaredStatus.kind} mode=${r.mode} ${shape}`,
    );

    if (r.what.kind === "action" && r.what.action.scope !== "session") {
      refuse(res, "wrong-scope", `'${r.what.action.id}' is a box-wide action; post it to /api/actions/box`);
      return;
    }
    // THE SECOND TAP, DERIVED FROM THE CATALOGUE rather than from a list here.
    // `needsConfirm` is `true` as a literal type on every enacted action, so a
    // new one is covered the day it is added and nobody has to remember this
    // line. A spoken action that Greg later marks as needing a confirm gets the
    // same treatment for free.
    if (r.what.kind === "action" && r.what.action.needsConfirm && !r.confirm) {
      refuse(res, "confirm-required", `'${r.what.action.id}' needs confirming: ${describeConfirm(r.what.action)}`);
      return;
    }

    if (r.mode === "enqueue") {
      await enqueue(r, res);
      return;
    }

    // From here down it is an enacted action being planned or run.
    if (r.what.kind !== "action") {
      refuse(res, "wrong-mode", "a free-text message can only be enqueued; it is delivered when the session is at a prompt");
      return;
    }
    const action = r.what.action;
    if (action.effect !== "enacted") {
      refuse(res, "wrong-mode", `'${action.id}' is a ${action.effect} action: enqueue it, and it goes out when the session is at a prompt`);
      return;
    }

    const built = planFor(r, action);
    if (!built.ok) {
      deps.log(`action session: refused code=${built.code} action=${action.id} why=${built.why}`);
      refuse(res, built.code, built.why);
      return;
    }

    if (r.mode === "dry-run") {
      respond(res, 200, { ok: true, op: "dry-run", action: action.id, steps: built.plan.steps });
      return;
    }

    if (!deps.actEnabled()) {
      deps.log(`action session: refused code=acting-disabled action=${action.id} pane=${target.paneId}`);
      refuse(res, "acting-disabled", ACTING_DISABLED_WHY);
      return;
    }
    // NOTHING MAY JUMP THE QUEUE. queue.ts's header: "Push, then remove the
    // worktree" must not become "remove the worktree, then try to push", and
    // its own instruction for doing something right now is to cancel the queue
    // first. So an immediate enacted run against a session with anything
    // waiting is refused, and the person is told what is in the way.
    const waiting = deps.queue.size(target.sessionId);
    if (waiting > 0) {
      refuse(
        res,
        "queue-not-empty",
        `${waiting} item(s) are queued for ${target.sessionId}, and this would happen before them — cancel them first if that is what you want`,
      );
      return;
    }

    const rate = deps.limiter.check(target.sessionId, deps.now());
    if (!rate.ok) {
      refuse(res, "rate-limited", rate.why, undefined, { "retry-after": String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))) });
      return;
    }
    deps.limiter.record(target.sessionId, deps.now());

    deps.log(`action session: RUNNING action=${action.id} steps=${built.plan.steps.length} session=${target.sessionId}`);
    const run = await runPlan(built.plan, deps.io);
    deps.log(
      `action session: ${run.completed ? "DONE" : "STOPPED"} action=${action.id} ` +
        `ran=${run.steps.length}/${built.plan.steps.length} stoppedAt=${run.stoppedAt ?? "-"}`,
    );
    if (!run.completed) {
      const stopped = run.stoppedAt === null ? null : run.steps[run.stoppedAt];
      refuse(res, "plan-failed", `step ${(run.stoppedAt ?? 0) + 1} did not pass its gate: ${stopped?.verdict ?? "unknown"}`, run);
      return;
    }
    respond(res, 200, { ok: true, op: "ran", action: action.id, run });
  }

  async function enqueue(r: SessionActionRequest, res: ServerResponse): Promise<void> {
    // REFUSE NOW WHAT COULD NEVER DRAIN. `drainGate` asks `steerableStatus`, so
    // the sentence a person reads is steer.ts's own — "it is a shell, which
    // would EXECUTE the message" rather than "queued". Without this, an item
    // aimed at a shell or a dead Claude sits in the queue looking like
    // something that is going to happen, until it goes stale half an hour
    // later. `later` (the session is working) is exactly what the queue is for
    // and is NOT refused.
    const gate = drainGate(r.declaredStatus);
    if (gate.kind === "never") {
      deps.log(`action session: refused code=not-steerable pane=${r.target.paneId} why=${gate.reason.code}`);
      refuse(res, "not-steerable", gate.reason.why);
      return;
    }

    const rate = deps.limiter.check(r.target.sessionId, deps.now());
    if (!rate.ok) {
      refuse(res, "rate-limited", rate.why, undefined, { "retry-after": String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))) });
      return;
    }

    const t = { sessionId: r.target.sessionId, claudeSessionId: r.target.claudeSessionId };
    const result: EnqueueResult = r.what.kind === "action" ? deps.queue.enqueueAction(t, r.what.action.id) : deps.queue.enqueueMessage(t, r.what.text);
    if (!result.ok) {
      deps.log(`action session: refused code=${ENQUEUE_CODE[result.rule]} rule=${result.rule}`);
      refuse(res, ENQUEUE_CODE[result.rule], result.why);
      return;
    }
    // SPENT ONLY ONCE SOMETHING HAPPENED, which is Sol's F18 next door: a
    // refused request must not push the person's own next legitimate press
    // further away.
    deps.limiter.record(r.target.sessionId, deps.now());
    deps.log(`action session: QUEUED id=${result.item.id} session=${r.target.sessionId} position=${result.position} gate=${gate.kind}`);
    respond(res, 200, { ok: true, op: "enqueued", item: result.item, position: result.position, gate });
  }

  /* ---------------- POST/DELETE /api/actions/cancel ---------------- */

  async function cancelRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = await parsedBody(req, res, MAX_BODY_BYTES);
    if (parsed === null) return;
    const body = parseCancelBody(parsed);
    if (!body.ok) {
      refuse(res, "bad-request", body.why);
      return;
    }
    const { sessionId, itemId } = body.value;
    const result = deps.queue.cancel(sessionId, itemId);
    if (!result.ok) {
      // The queue returns one sentence for both failures, and the page needs to
      // tell them apart: "there is nothing there" and "it is going out right
      // now" call for different words on the button. Classified by asking the
      // snapshot, so the SENTENCE still comes from the queue and only the
      // status code is decided here.
      const present = deps.queue.snapshot(sessionId).items.some((i) => i.id === itemId);
      const code: ActionErrorCode = present ? "in-flight" : "no-such-item";
      deps.log(`action cancel: refused code=${code} session=${sessionId} item=${itemId}`);
      refuse(res, code, result.why);
      return;
    }
    deps.log(`action cancel: REMOVED id=${itemId} session=${sessionId}`);
    respond(res, 200, { ok: true, op: "cancelled", item: result.item });
  }

  /* ---------------- POST /api/actions/box ---------------- */

  async function boxRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = await parsedBody(req, res, MAX_BOX_BODY_BYTES);
    if (parsed === null) return;
    const body = parseBoxBody(parsed);
    if (!body.ok) {
      deps.log(`action box: refused code=bad-request why=${body.why}`);
      refuse(res, "bad-request", body.why);
      return;
    }
    const r = body.value;
    deps.log(`action box: action=${r.action.id} mode=${r.mode} confirm=${r.confirm} pids=${r.pids.length} recipients=${r.recipients.length}`);

    if (r.action.scope !== "box") {
      refuse(res, "wrong-scope", `'${r.action.id}' is a session action; post it to /api/actions/session`);
      return;
    }
    if (r.mode === "run" && r.action.needsConfirm && !r.confirm) {
      refuse(res, "confirm-required", `'${r.action.id}' needs confirming: ${describeConfirm(r.action)}`);
      return;
    }
    if (r.mode === "run" && !deps.actEnabled()) {
      deps.log(`action box: refused code=acting-disabled action=${r.action.id}`);
      refuse(res, "acting-disabled", ACTING_DISABLED_WHY);
      return;
    }

    switch (r.action.effect) {
      case "enacted":
        await killRoute(r, r.action, res);
        return;
      case "broadcast":
        await broadcastRoute(r, r.action, res);
        return;
      // No `spoken` arm, and that is the type system rather than an omission:
      // every spoken action is `scope: "session"` as a literal, so the check
      // above has already narrowed it away. The day a box-scoped spoken action
      // is added, this switch stops compiling and somebody decides what it does.
      default: {
        const never: never = r.action;
        return never;
      }
    }
  }

  /**
   * Kill what a named rule licenses, bounded by what the person was shown.
   *
   * **THE FRESH SCAN AUTHORISES AND THE SHOWN LIST BOUNDS**, and both halves
   * matter. Without the scan, a page from ten minutes ago decides what dies,
   * and `killVerdict`'s own header says it judges a snapshot. Without the
   * intersection, confirming "kill 3 test suites" kills the eleven that started
   * while the dialog was open — which is a different, larger action than the
   * one anybody agreed to.
   */
  async function killRoute(r: BoxActionRequest, action: EnactedAction, res: ServerResponse): Promise<void> {
    const policy: KillPolicy | null =
      action.id === "kill-test-suites" ? "test-suites" : action.id === "kill-safe-processes" ? "safe-to-kill" : null;
    if (policy === null) {
      refuse(res, "wrong-scope", `'${action.id}' is not a box-wide kill`);
      return;
    }

    const scan = await deps.io.listProcesses();
    if (!scan.ok) {
      deps.log(`action box: refused code=box-unreadable action=${action.id} why=${scan.why}`);
      refuse(res, "box-unreadable", scan.why);
      return;
    }
    const parents = new Map<number, number>(scan.procs.map((p) => [p.pid, p.ppid]));
    const chosen = selectForKill(scan.procs, policy, { selfPid: deps.io.selfPid(), parents });
    const byPid = new Map(scan.procs.map((p) => [p.pid, p]));
    const candidates: KillCandidate[] = chosen.map((c) => {
      const p = byPid.get(c.pid);
      return {
        pid: c.pid,
        rule: c.rule,
        why: c.why,
        comm: p?.comm ?? "",
        // Bounded: a command line can be a kilobyte of arguments, and the page
        // is a phone.
        args: (p?.args ?? "").slice(0, 200),
        rssKiB: p?.rssKiB ?? 0,
        etimeSeconds: p?.etimeSeconds ?? 0,
      };
    });

    if (r.mode === "dry-run") {
      const preview = planKillProcesses(action, { pids: candidates.map((c) => c.pid), cwd: deps.primaryDir() });
      deps.log(`action box: DRY-RUN action=${action.id} candidates=${candidates.length} scanned=${scan.procs.length}`);
      respond(res, 200, {
        ok: true,
        op: "dry-run",
        action: action.id,
        steps: preview.ok ? preview.plan.steps : [],
        candidates,
        scanned: scan.procs.length,
        unreadable: scan.unreadable,
      });
      return;
    }

    const shown = new Set(r.pids);
    const pids = candidates.map((c) => c.pid).filter((pid) => shown.has(pid));
    const skipped: { pid: number; why: string }[] = [];
    for (const c of candidates) {
      if (!shown.has(c.pid)) skipped.push({ pid: c.pid, why: "it matches the rule now and was not on the list you confirmed" });
    }
    for (const pid of r.pids) {
      if (!candidates.some((c) => c.pid === pid)) skipped.push({ pid, why: "it was on the list you confirmed and no longer matches the rule" });
    }
    if (pids.length === 0) {
      deps.log(`action box: refused code=nothing-to-kill action=${action.id} shown=${r.pids.length} matched=${candidates.length}`);
      refuse(
        res,
        "nothing-to-kill",
        `nothing on the list you confirmed still matches the rule (${candidates.length} process(es) match it now) — look again and confirm the new list`,
      );
      return;
    }

    const built = planKillProcesses(action, { pids, cwd: deps.primaryDir() });
    if (!built.ok) {
      refuse(res, PLAN_REFUSAL_CODE[built.rule], built.why);
      return;
    }
    const rate = deps.limiter.check("box", deps.now());
    if (!rate.ok) {
      refuse(res, "rate-limited", rate.why, undefined, { "retry-after": String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))) });
      return;
    }
    deps.limiter.record("box", deps.now());

    deps.log(`action box: KILLING action=${action.id} pids=${pids.join(",")}`);
    const run = await runPlan(built.plan, deps.io);
    deps.log(`action box: ${run.completed ? "DONE" : "STOPPED"} action=${action.id} steps=${run.steps.length}`);
    respond(res, 200, { ok: true, op: "ran", action: action.id, run, killed: pids, skipped });
  }

  /**
   * Tell every steerable session the box is loaded, each with its own resume
   * time.
   *
   * **THE STAGGER IS COMPUTED HERE, ONE SENTENCE AT A TIME, AT THE MOMENT OF
   * THE SEND.** `renderBroadcast` takes the recipient's index and the total and
   * produces the minutes; nothing is rendered in advance and nothing is stored.
   * A pre-rendered list would decay the moment anything slowed down — thirty-six
   * sentences written in one instant and delivered over four minutes are
   * thirty-six agents resuming from a clock that stopped.
   *
   * **THE DENOMINATOR IS WHO WE ARE ACTUALLY SPEAKING TO**, not how many rows
   * the page sent. Counting the sessions we skip would leave gaps at both ends
   * of the window and hand somebody the far end for no reason.
   */
  async function broadcastRoute(r: BoxActionRequest, action: BroadcastAction, res: ServerResponse): Promise<void> {
    if (r.recipients.length === 0) {
      refuse(res, "bad-request", "a broadcast needs recipients: send the rows the page is showing, with the status each one had");
      return;
    }

    // Who can actually be spoken to, in the page's order. `drainGate` is the
    // queue's rule and it asks `steerableStatus`, so a shell — where the text
    // would be EXECUTED — and a session that is working are both left out here
    // rather than being refused one at a time by the delivery module.
    const deliverable: Recipient[] = [];
    const outcomes: BroadcastOutcome[] = [];
    const gates = new Map<string, DrainGate>();
    for (const rec of r.recipients) {
      const gate = drainGate(rec.declaredStatus);
      gates.set(rec.target.paneId, gate);
      if (gate.kind === "now") deliverable.push(rec);
    }
    const total = deliverable.length;
    if (total === 0) {
      refuse(res, "not-steerable", `none of the ${r.recipients.length} rows you sent is at a prompt right now, so there is nobody to tell`);
      return;
    }

    if (r.mode === "dry-run") {
      let index = 0;
      for (const rec of r.recipients) {
        const gate = gates.get(rec.target.paneId);
        if (gate?.kind === "now") {
          outcomes.push({
            paneId: rec.target.paneId,
            sessionId: rec.target.sessionId,
            // The SAME function the send will call, with the same arguments, so
            // the preview cannot promise a spread the delivery does not keep.
            minutes: staggerMinutes(index, total, action.stagger),
            outcome: "sent",
            code: null,
            why: "it is at a prompt and would be told to pause for this long",
          });
          index += 1;
        } else {
          outcomes.push(skippedOutcome(rec, gate));
        }
      }
      const first = deliverable[0];
      respond(res, 200, {
        ok: true,
        op: "broadcast-preview",
        action: action.id,
        total,
        recipients: outcomes,
        // One recipient's exact words, so the person can read what is about to
        // be said to thirty-six agents before it is said.
        sample: first === undefined ? null : renderBroadcast(action, { index: 0, total }, r.speaker),
      });
      return;
    }

    const at = deps.now();
    if (lastBroadcastAt !== null && at - lastBroadcastAt < BROADCAST_COOLDOWN_MS) {
      const left = BROADCAST_COOLDOWN_MS - (at - lastBroadcastAt);
      deps.log(`action box: refused code=cooldown action=${action.id} leftMs=${left}`);
      refuse(
        res,
        "cooldown",
        `the fleet was told to ease off ${Math.round((at - lastBroadcastAt) / 60_000)} minutes ago; a second one now would give every agent two different resume times`,
        undefined,
        { "retry-after": String(Math.max(1, Math.ceil(left / 1000))) },
      );
      return;
    }
    // Taken BEFORE the sends, not after. A broadcast of thirty-six takes a
    // while, and a second request arriving halfway through must find the
    // cooldown already spent — otherwise the two interleave, which is the exact
    // failure the cooldown exists to prevent.
    lastBroadcastAt = at;

    let index = 0;
    let sent = 0;
    for (const rec of r.recipients) {
      const gate = gates.get(rec.target.paneId);
      if (gate?.kind !== "now") {
        outcomes.push(skippedOutcome(rec, gate));
        continue;
      }
      if (deps.now() - at > BROADCAST_DEADLINE_MS) {
        // Out of time. NOT an error, and not a silent stop: the rows we never
        // reached are named one by one, so nobody reads "broadcast sent" over
        // the top of sixteen agents who were told nothing.
        outcomes.push({
          paneId: rec.target.paneId,
          sessionId: rec.target.sessionId,
          minutes: null,
          outcome: "not-reached",
          code: null,
          why: `the broadcast ran out of time after ${Math.round((deps.now() - at) / 1000)}s and stopped before this row`,
        });
        continue;
      }
      const minutes = staggerMinutes(index, total, action.stagger);
      // RENDERED HERE, ONE LINE ABOVE THE SEND. Not above the loop, not in the
      // parse, not in the queue.
      const text = renderBroadcast(action, { index, total }, r.speaker);
      index += 1;
      let result: SteerResult;
      try {
        result = deps.sendMessage(rec.target, text, rec.declaredStatus);
      } catch (e) {
        outcomes.push({
          paneId: rec.target.paneId,
          sessionId: rec.target.sessionId,
          minutes,
          outcome: "refused",
          code: null,
          why: `the delivery module threw: ${(e as Error).message}`,
        });
        continue;
      }
      if (result.ok) {
        sent += 1;
        outcomes.push({ paneId: rec.target.paneId, sessionId: rec.target.sessionId, minutes, outcome: "sent", code: null, why: null });
      } else {
        outcomes.push({
          paneId: rec.target.paneId,
          sessionId: rec.target.sessionId,
          minutes,
          outcome: "refused",
          code: result.reason.code,
          why: result.reason.why,
        });
      }
      // BETWEEN EVERY SEND, not at the end. Each one blocks this thread for as
      // long as tmux takes, and this is the only chance the poll, the stream and
      // every other route get while a fan-out is in progress.
      await deps.yieldToLoop();
    }
    // Counts and minutes, never a word of what was said.
    const unreached = outcomes.filter((x) => x.outcome === "not-reached").length;
    deps.log(
      `action box: BROADCAST action=${action.id} speaker=${r.speaker} told=${sent}/${total} of ${r.recipients.length} rows` +
        (unreached > 0 ? ` (ran out of time before ${unreached})` : ""),
    );
    respond(res, 200, { ok: true, op: "broadcast", action: action.id, total, recipients: outcomes });
  }

  function skippedOutcome(rec: Recipient, gate: DrainGate | undefined): BroadcastOutcome {
    if (gate?.kind === "later") {
      return { paneId: rec.target.paneId, sessionId: rec.target.sessionId, minutes: null, outcome: "held", code: null, why: gate.why };
    }
    if (gate?.kind === "never") {
      return {
        paneId: rec.target.paneId,
        sessionId: rec.target.sessionId,
        minutes: null,
        outcome: "blocked",
        code: gate.reason.code,
        why: gate.reason.why,
      };
    }
    return {
      paneId: rec.target.paneId,
      sessionId: rec.target.sessionId,
      minutes: null,
      outcome: "blocked",
      code: null,
      why: "this row was not classified, so nothing was sent to it",
    };
  }

  /* ---------------- shared plumbing ---------------- */

  /**
   * The CSRF triple, the body cap and the JSON parse, or a response already
   * sent. `null` means "answered, stop".
   */
  async function parsedBody(req: IncomingMessage, res: ServerResponse, limit: number): Promise<unknown | null> {
    const headerCheck = checkOrigin(req.headers);
    if (!headerCheck.ok) {
      deps.log(`action: refused code=${headerCheck.code} why=${headerCheck.why} ${who(req)}`);
      refuse(res, headerCheck.code, headerCheck.why);
      return null;
    }
    const body = await readBody(req as unknown as BodyStream, limit);
    if (!body.ok) {
      deps.log(`action: refused code=${body.code} bytes=${body.bytesRead}`);
      refuse(res, body.code, body.why);
      return null;
    }
    try {
      return JSON.parse(body.text) as unknown;
    } catch (e) {
      deps.log("action: refused code=bad-request why=not-json");
      refuse(res, "bad-request", `the body is not JSON: ${(e as Error).message}`);
      return null;
    }
  }

  return {
    handle(req, res) {
      const pathname = (req.url ?? "/").split("?")[0] ?? "/";
      if (pathname !== "/api/actions" && !pathname.startsWith("/api/actions/")) return false;
      const method = req.method ?? "GET";
      // Logged BEFORE anything can refuse it, so an attempt turned away at the
      // door still leaves a trace — a write path whose log records only the
      // successes is one you cannot investigate. Reads are NOT logged: the page
      // polls the catalogue, and a line per poll per phone would bury the write
      // lines this file exists to leave behind.
      if (method !== "GET" && method !== "HEAD") deps.log(`action ${method} ${pathname}: attempt ${who(req)}`);

      if (pathname === "/api/actions") {
        if (method !== "GET" && method !== "HEAD") {
          refuse(res, "method-not-allowed", "the catalogue and the queues are a GET", undefined, { allow: "GET" });
          return true;
        }
        catalogue(res);
        return true;
      }
      // Every write is a POST (cancel also takes DELETE, because that is what a
      // client naturally reaches for). A GET at any of these is a link somebody
      // sent or a browser prefetching, and neither may act.
      if (pathname === "/api/actions/session" || pathname === "/api/actions/box") {
        if (method !== "POST") {
          refuse(res, "method-not-allowed", "acting is POST only", undefined, { allow: "POST" });
          return true;
        }
        // Floating on purpose: `handler` in server.ts is synchronous, and these
        // cannot reject — every path inside them is caught below.
        void guard(pathname === "/api/actions/session" ? sessionRoute(req, res) : boxRoute(req, res), res);
        return true;
      }
      if (pathname === "/api/actions/cancel") {
        if (method !== "POST" && method !== "DELETE") {
          refuse(res, "method-not-allowed", "cancelling is POST or DELETE", undefined, { allow: "POST, DELETE" });
          return true;
        }
        void guard(cancelRoute(req, res), res);
        return true;
      }
      // Ours by prefix and not a route. Claimed rather than returned false, so
      // nothing under web/dist/ can ever answer for a path in this namespace.
      refuse(res, "bad-request", `there is no action route at ${pathname}`);
      return true;
    },
  };

  /**
   * The one 5xx in the file. Only a bug reaches here — every expected failure
   * is a refusal with a code — and the response says `internal` so a client can
   * tell a broken server from a stale view.
   */
  async function guard(work: Promise<void>, res: ServerResponse): Promise<void> {
    try {
      await work;
    } catch (e) {
      const why = `the action route threw: ${(e as Error).message}`;
      deps.log(`action: FAILED ${why}`);
      try {
        refuse(res, "internal", why);
      } catch {
        /* the response was already sent; the log line is the record */
      }
    }
  }
}

/** What the confirmation dialog should say, from the catalogue rather than from here. */
function describeConfirm(action: Action): string {
  switch (action.effect) {
    case "enacted":
      return action.gate;
    case "broadcast":
      return `it speaks to every steerable session, each with its own resume time across ${action.stagger.windowMinutes} minutes`;
    case "spoken":
      return action.summary;
    default: {
      const never: never = action;
      return never;
    }
  }
}

/**
 * The mounted routes, built once, on first use rather than at import.
 *
 * Lazy because the queue and the rate limiter are STATE, and a module-scope one
 * would be built by anything that so much as imports a type from here — the
 * same reason `handleSteerRequest` is lazy next door.
 *
 * **The queue this builds is this module's own.** Anything that drains it must
 * be handed the same `SteeringQueue`; two instances would be two queues, and
 * the one the page can see would be the one nothing delivers from.
 */
let shared: ActionRoutes | null = null;

export function handleActionRequest(req: IncomingMessage, res: ServerResponse): boolean {
  shared ??= makeActionRoutes();
  return shared.handle(req, res);
}
