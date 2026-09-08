/**
 * The Overseer's copy of the dashboard's wire contract, parsed from `unknown`.
 *
 * THE OVERSEER OWNS THE PAST TENSE and the dashboard owns the present
 * (docs/project/orchestrator-direction.md § Two tenses). So this file never
 * collects: it takes whatever came back from `GET /api/state` or off the
 * `/api/live` SSE stream and decides whether it is a snapshot at all. Nothing
 * here does I/O, and nothing at module scope does anything.
 *
 * ## Why a parser, when the producer already has types
 *
 * The producer is in this repo (`tools/fleet/state.ts`) and its types are right
 * there, so the tempting move is `JSON.parse(body) as FleetState` and get on
 * with it. That cast is the whole hazard: it is a promise about bytes that
 * crossed a socket from a process that may be a week older or a week newer than
 * this one, and the Overseer's job is to write those bytes into a history that
 * outlives both. A shape that quietly stopped matching produces plausible
 * history, which is worse than no history. `tests/overseer-observation.test.ts`
 * pins the two together at compile time, so the day the dashboard changes the
 * contract the build says so rather than the log.
 *
 * ## Strict means the WHOLE snapshot, never the good rows
 *
 * One malformed row fails everything. This is the single rule most likely to
 * look like over-engineering and it is the one with teeth: the consumer of this
 * is a differ, and a differ handed 35 of 36 rows emits `tmux-session-gone` for
 * the row that was dropped. A dropped row is invisible; a manufactured
 * disappearance is a story. Same for a duplicate handle, an unparseable
 * timestamp and a schema nobody here has read. See
 * docs/plans/260908b-overseer-store-and-clock.md § The observation contract.
 *
 * ## What is parsed strictly, and what is carried verbatim
 *
 * Strictly: everything the diff keys on or the register records — the handle,
 * the name, the metadata union, `startedAt`, the claimed conversation id (the
 * wire's `claudeSessionId`, renamed here because it is a claim rather than an
 * identity — see `ObservedRow`), and `status`.
 *
 * Verbatim, as opaque JSON: `health` and `question`. Neither is diffed and
 * neither is an identity; both belong to another module that is still moving,
 * and re-validating them here would mean this file fails a snapshot because the
 * dashboard added a field to something we do not read. The direction doc
 * already settles `health`: the Overseer "stores that object verbatim per event
 * and does not interpret it a second time, so a change at the source changes
 * the history's shape rather than drifting from it."
 */
import type { SessionKind, SessionMeta, SessionState, SessionUnknownCause } from "../../scripts/gjd-remote-tmux.js";

/**
 * Anything `JSON.parse` can return, which is the honest type for a field we
 * keep and do not read. `unknown` would do the same job and say less: this says
 * "it survived JSON, and that is all we claim about it".
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * A result, never an exception and never a bare null.
 *
 * The caller of a strict parser has to write something in a log about WHY it
 * threw the snapshot away — that sentence is the whole value of failing loudly
 * — and a `null` return gives it nothing to write. Thrown strings are worse
 * still: they arrive at a catch that cannot tell them from a bug in this file.
 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * The uuid the tmux environment says is running in a pane.
 *
 * BRANDED SO IT CANNOT BE MISTAKEN FOR AN IDENTITY. All three ids in this
 * system are strings, and this is the one that lies: passing it where a
 * verified conversation id is wanted takes a cast, and the cast is where the
 * next reader meets the doc comment on `ObservedRow.claimedConversationId`.
 * That is the whole point of the brand — there is no second type for it to be
 * confused with yet, and there will be one the moment a later stage can check a
 * transcript's mtime.
 */
export type ClaimedConversationId = string & { readonly __brand: "overseer-claimed-conversation" };

/**
 * When the producer says it looked, or a positive statement that it never has.
 *
 * NOT `string | null`, and that is the point. `collectedAt: null` is the
 * dashboard's startup placeholder — served alongside `rows: []` before the
 * first collection ever runs — and a consumer that reads the rows without
 * reading the clock says "no sessions are running" about a box with thirty-six
 * of them. `tools/fleet/state.ts` says the same thing from the producer's side.
 * A two-armed type makes reading the rows without deciding about the clock
 * impossible rather than merely discouraged.
 */
export type CollectedClock = { collected: true; at: string; atMs: number };
export type CollectionClock = { collected: false } | CollectedClock;

/** One session, as the dashboard reported it. */
export type ObservedRow = {
  /**
   * tmux's own session handle (`$1991`). Half of an identity and never the
   * whole of one: it is stable within one tmux server and handed out again from
   * `$0` by the next.
   */
  id: string;
  name: string;
  title: string | null;
  /** Lossy display fields. `meta` is the record; these two are for reading. */
  repo: string | null;
  worktree: string | null;
  /**
   * The launcher's metadata, whole. `version === 1` gates `dir`, `kind` and
   * `repo` together, which is the reason the dashboard sent the union rather
   * than three nullable fields: `dir` is the only field in the payload that
   * cannot be reconstructed after a reboot, and a null the compiler lets you
   * ignore is how it would come to be dropped.
   */
  meta: SessionMeta;
  startedAt: string;
  paneId: string | null;
  panePid: number | null;
  /**
   * **A CLAIM about which conversation is in this pane, not a fact.** The wire
   * calls it `claudeSessionId`; it is renamed here because the wire name reads
   * as an identity and this is a hint that decays. Measured on the live box,
   * 2026-09-08, by the agent who owns the producer.
   *
   * Two things are true of it and neither is obvious:
   *
   *  - **It is set before Claude runs.** `CLAUDE_SESSION_ID` is pinned into the
   *    tmux environment by `tmux new-session -e …`, so a session launched with
   *    `--wait 6h` wears a conversation uuid for six hours while its pane runs
   *    `sleep`. Thirty of thirty-five live rows carried a uuid, and five of
   *    those were `waiting` with no Claude process at all. **A uuid on a row
   *    does not mean a conversation exists.**
   *  - **It outlives the conversation.** The tmux environment is written once
   *    and never updated, so when a pane's Claude exits and a fresh one starts
   *    in that pane, the row still names the FIRST conversation.
   *
   * So a uuid that CHANGES is real evidence that the pane's conversation
   * changed, and a uuid that stays the same is evidence of nothing. See the
   * comment on `session-replaced` in diff.ts, which is the event that asymmetry
   * makes untrustworthy in one direction.
   *
   * Nothing in this stage can resolve it: the only signal that can is a
   * transcript's `lastModified`, which is filesystem I/O and belongs to a later
   * stage.
   */
  claimedConversationId: ClaimedConversationId | null;
  /** Volatile prose, kept verbatim and never diffed. */
  question: JsonValue;
  status: SessionState;
};

/** One snapshot, as the dashboard reported it. */
export type ObservedSnapshot = {
  schema: 1;
  rows: readonly ObservedRow[];
  /**
   * The tmux server generation these handles belong to, or null when it could
   * not be read. Two snapshots that disagree here describe different worlds —
   * see diff.ts, where that is a rule about not diffing rather than a change.
   */
  tmuxServerPid: number | null;
  /** The wire's `collectedAt`, as a type that cannot be read without deciding about null. */
  clock: CollectionClock;
  tookMs: number;
  /** The last collection's failure. A stale payload keeps its old rows and is broadcast anyway. */
  error: string | null;
  /** How often the producer intends to collect, so a freshness watchdog need not hard-code a deadline. */
  refreshMs: number;
  /** Kept verbatim, interpreted nowhere. */
  health: JsonValue;
};

/**
 * A snapshot the producer has actually collected — the only kind worth diffing.
 *
 * The narrowing is carried in the type rather than re-checked downstream, so
 * `diff()` cannot be handed the startup placeholder however the call is
 * written. `admissible()` is the only thing that mints one.
 */
export type FreshSnapshot = ObservedSnapshot & { clock: CollectedClock };

/** The one schema this reader was written against. */
export const OBSERVATION_SCHEMA = 1;

function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === "object" && u !== null && !Array.isArray(u);
}

/**
 * A timestamp, or a sentence saying why it is not one.
 *
 * `new Date(x).getTime()` on junk gives NaN, which becomes a date somewhere
 * downstream and renders as `NaNd` — the same accident `parseSessionLine`
 * absorbed for tmux's own stamps.
 *
 * THE ROUND TRIP IS THE REAL CHECK, not the NaN. Every timestamp in this
 * payload is a `Date.toISOString()` at the source, so anything that is not
 * byte-identical to what `toISOString` would print did not come from there —
 * `"2026-09-08"` parses perfectly and means midnight UTC, which is a fact
 * nobody measured. The clock these snapshots are ordered by is the one thing in
 * the history that must not be approximate.
 */
function isoTimestamp(u: unknown, field: string): ParseResult<{ iso: string; ms: number }> {
  if (typeof u !== "string") return { ok: false, reason: `${field} is ${typeName(u)}, not a timestamp string` };
  const ms = new Date(u).getTime();
  if (!Number.isFinite(ms)) return { ok: false, reason: `${field} is ${JSON.stringify(u)}, which is not a date` };
  if (new Date(ms).toISOString() !== u) {
    return { ok: false, reason: `${field} is ${JSON.stringify(u)}, which is not an ISO timestamp` };
  }
  return { ok: true, value: { iso: u, ms } };
}

/** For refusal sentences: what arrived, in one word a person can act on. */
function typeName(u: unknown): string {
  if (u === null) return "null";
  if (Array.isArray(u)) return "an array";
  return `a ${typeof u}`;
}

function stringOrNull(u: unknown, field: string): ParseResult<string | null> {
  if (u === null || typeof u === "string") return { ok: true, value: u };
  return { ok: false, reason: `${field} is ${typeName(u)}, not a string or null` };
}

function numberOrNull(u: unknown, field: string): ParseResult<number | null> {
  if (u === null) return { ok: true, value: null };
  if (typeof u === "number" && Number.isFinite(u)) return { ok: true, value: u };
  return { ok: false, reason: `${field} is ${typeName(u)}, not a finite number or null` };
}

/**
 * The two closed string unions this parser has to check membership against,
 * **as `Record`s keyed by the union rather than as arrays of strings**.
 *
 * That is the whole guard, and it is worth the odd-looking `true` values. An
 * array typed `readonly SessionKind[]` checks that everything in it is a kind;
 * it does not check that every kind is in it — so a cause added upstream would
 * arrive here as "which this version has no arm for" and take down a whole
 * snapshot in production, for a value the box was perfectly right to send. A
 * `Record` over the union is missing-key-is-an-error in both directions.
 *
 * It fires only under `npm run typecheck`; vitest strips types without looking
 * at them, so no test can go red for this.
 */
const SESSION_KINDS: Record<SessionKind, true> = { claude: true, shell: true, setup: true };

const UNKNOWN_CAUSES: Record<SessionUnknownCause, true> = {
  "not-a-session-id": true,
  "agents-unavailable": true,
  "unrecognised-agent-status": true,
  "running-but-unlisted": true,
  "process-probe-unavailable": true,
  "no-status-derived": true,
  "client-declared": true,
};

/**
 * The status union, parsed arm by arm.
 *
 * A SWITCH WITH A `never` DEFAULT rather than a lookup table, because the
 * `never` is what breaks the build when `SessionState` grows an arm. The whole
 * reason the Overseer parses this strictly rather than casting is that a status
 * it does not understand must stop the snapshot instead of becoming a shape the
 * canonical key silently maps onto something else.
 */
function parseStatus(u: unknown, where: string): ParseResult<SessionState> {
  if (!isRecord(u)) return { ok: false, reason: `${where}.status is ${typeName(u)}, not an object` };
  const kind = u["kind"];
  if (typeof kind !== "string") return { ok: false, reason: `${where}.status.kind is ${typeName(kind)}, not a string` };
  // The cast is confined to this one line and is immediately narrowed by the
  // switch; the `never` arm is what proves the narrowing covers the union.
  const arm = kind as SessionState["kind"];
  switch (arm) {
    case "needs-you":
    case "working":
    case "idle":
    case "no-claude":
      return { ok: true, value: { kind: arm } };
    case "waiting": {
      const secondsLeft = u["secondsLeft"];
      if (typeof secondsLeft !== "number" || !Number.isFinite(secondsLeft)) {
        return { ok: false, reason: `${where}.status.secondsLeft is ${typeName(secondsLeft)}, not a number` };
      }
      return { ok: true, value: { kind: "waiting", secondsLeft } };
    }
    case "shell": {
      const busy = u["busy"];
      if (busy !== true && busy !== false && busy !== null) {
        return { ok: false, reason: `${where}.status.busy is ${typeName(busy)}, not true, false or null` };
      }
      return { ok: true, value: { kind: "shell", busy } };
    }
    case "unknown": {
      const why = u["why"];
      const cause = u["cause"];
      if (typeof why !== "string") return { ok: false, reason: `${where}.status.why is ${typeName(why)}, not a string` };
      if (typeof cause !== "string" || !Object.hasOwn(UNKNOWN_CAUSES, cause)) {
        return { ok: false, reason: `${where}.status.cause is ${JSON.stringify(cause)}, which this version has no arm for` };
      }
      const reported = u["reportedStatus"];
      if (reported !== undefined && typeof reported !== "string") {
        return { ok: false, reason: `${where}.status.reportedStatus is ${typeName(reported)}, not a string` };
      }
      const status: SessionState = { kind: "unknown", why, cause: cause as SessionUnknownCause };
      // Absent rather than `undefined`, so a round trip through JSON gives back
      // the same object and the canonical key cannot differ between a snapshot
      // read off the wire and the same snapshot read back out of the store.
      return { ok: true, value: reported === undefined ? status : { ...status, reportedStatus: reported } };
    }
    default: {
      const never: never = arm;
      return { ok: false, reason: `${where}.status.kind is ${JSON.stringify(never)}, which this version has no arm for` };
    }
  }
}

/** The launcher metadata union. A record that is neither arm fails the listing, as it does at the source. */
function parseMeta(u: unknown, where: string): ParseResult<SessionMeta> {
  if (!isRecord(u)) return { ok: false, reason: `${where}.meta is ${typeName(u)}, not an object` };
  const version = u["version"];
  if (version === "legacy") return { ok: true, value: { version: "legacy" } };
  if (version !== 1) {
    return { ok: false, reason: `${where}.meta.version is ${JSON.stringify(version)}, not 1 or "legacy"` };
  }
  const kind = u["kind"];
  const repo = u["repo"];
  const dir = u["dir"];
  if (typeof kind !== "string" || !Object.hasOwn(SESSION_KINDS, kind)) {
    return { ok: false, reason: `${where}.meta.kind is ${JSON.stringify(kind)}, which is not a session kind` };
  }
  if (typeof repo !== "string") return { ok: false, reason: `${where}.meta.repo is ${typeName(repo)}, not a string` };
  // A REBOOT IS UNRECOVERABLE WITHOUT THIS FIELD, so an empty one is a refusal
  // rather than a shrug: `~/.claude/projects/<slug>` is a lossy slugified cwd,
  // so nothing downstream can reconstruct where the session was.
  //
  // WHAT IT IS NOT: a way to find the session's transcript. Measured on the box
  // 2026-09-08, building a transcript path out of it locates the file for 7 of
  // 30 sessions — not because slugification is lossy, but because
  // `EnterWorktree` MOVES the transcript to the worktree's slug while this field
  // goes on naming the primary checkout. It is where the session was launched,
  // and that is the whole of what it says.
  if (typeof dir !== "string" || dir === "") {
    return { ok: false, reason: `${where}.meta.dir is ${typeName(dir)}, and nothing else in the payload can replace it` };
  }
  return { ok: true, value: { version: 1, kind: kind as SessionKind, repo, dir } };
}

/**
 * tmux's own session handle.
 *
 * The shape is checked because the producer checks it: `parseSessionLine`
 * refuses a record whose id is not `$` and digits, on the grounds that a record
 * of any other shape did not come from tmux. Accepting one here would put an
 * address in the history that nothing can act on.
 */
const TMUX_SESSION_HANDLE = /^\$\d{1,10}$/;

function parseRow(u: unknown, index: number): ParseResult<ObservedRow> {
  const where = `rows[${index}]`;
  if (!isRecord(u)) return { ok: false, reason: `${where} is ${typeName(u)}, not an object` };

  const id = u["id"];
  if (typeof id !== "string" || !TMUX_SESSION_HANDLE.test(id)) {
    return { ok: false, reason: `${where}.id is ${JSON.stringify(id)}, which is not a tmux session handle` };
  }
  const name = u["name"];
  if (typeof name !== "string" || name === "") {
    return { ok: false, reason: `${where}.name is ${typeName(name)}, and every session has one` };
  }

  const title = stringOrNull(u["title"], `${where}.title`);
  if (!title.ok) return title;
  const repo = stringOrNull(u["repo"], `${where}.repo`);
  if (!repo.ok) return repo;
  const worktree = stringOrNull(u["worktree"], `${where}.worktree`);
  if (!worktree.ok) return worktree;
  // The wire's name on the left, ours on the right. This is the ONLY place a
  // raw string becomes a claim, so it is the only place the brand has to be
  // asserted — and the only place worth reading its doc comment from.
  const claimed = stringOrNull(u["claudeSessionId"], `${where}.claudeSessionId`);
  if (!claimed.ok) return claimed;
  const paneId = stringOrNull(u["paneId"], `${where}.paneId`);
  if (!paneId.ok) return paneId;
  const panePid = numberOrNull(u["panePid"], `${where}.panePid`);
  if (!panePid.ok) return panePid;

  const meta = parseMeta(u["meta"], where);
  if (!meta.ok) return meta;
  const startedAt = isoTimestamp(u["startedAt"], `${where}.startedAt`);
  if (!startedAt.ok) return startedAt;
  const status = parseStatus(u["status"], where);
  if (!status.ok) return status;

  // `question` is the one field that may be anything: it is prose plus a
  // fingerprint, it is not diffed, and pinning its shape here would fail whole
  // snapshots the day tools/fleet/pane.ts grows a `truncated` flag.
  if (!("question" in u)) return { ok: false, reason: `${where}.question is missing` };

  return {
    ok: true,
    value: {
      id,
      name,
      title: title.value,
      repo: repo.value,
      worktree: worktree.value,
      meta: meta.value,
      startedAt: startedAt.value.iso,
      paneId: paneId.value,
      panePid: panePid.value,
      claimedConversationId: claimed.value as ClaimedConversationId | null,
      question: u["question"] as JsonValue,
      status: status.value,
    },
  };
}

/**
 * A `/api/state` body, or a sentence saying why it is not one.
 *
 * Takes `unknown` on purpose: the caller has done `JSON.parse` and holds
 * nothing more than that. A caller that has an `any` and a hope should be made
 * to come through here.
 */
export function parseObservation(u: unknown): ParseResult<ObservedSnapshot> {
  if (!isRecord(u)) return { ok: false, reason: `the payload is ${typeName(u)}, not an object` };

  // SCHEMA FIRST, because every refusal below it is only meaningful if the
  // producer and this reader agree about what the fields mean. The dashboard's
  // bump rule is "bump when a consumer that ignored the change would be WRONG",
  // so a number we have not read is exactly the case where guessing is wrong.
  const schema = u["schema"];
  if (schema !== OBSERVATION_SCHEMA) {
    return {
      ok: false,
      reason: `the payload says schema ${JSON.stringify(schema)} and this reader only understands ${OBSERVATION_SCHEMA}`,
    };
  }

  const rowsRaw = u["rows"];
  if (!Array.isArray(rowsRaw)) return { ok: false, reason: `rows is ${typeName(rowsRaw)}, not an array` };

  const rows: ObservedRow[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of rowsRaw.entries()) {
    const row = parseRow(raw, index);
    // ONE BAD ROW FAILS EVERYTHING. Keeping the rest and diffing the remainder
    // is what manufactures `tmux-session-gone` for a session that is running
    // fine — see the module comment.
    if (!row.ok) return row;
    // tmux handles are unique within one server by construction, so two rows
    // wearing one handle is a payload that did not come from one tmux. Left to
    // run, the second would overwrite the first in every map built from this.
    if (seen.has(row.value.id)) {
      return { ok: false, reason: `rows[${index}] repeats the session handle ${row.value.id}` };
    }
    seen.add(row.value.id);
    rows.push(row.value);
  }

  const collectedAtRaw = u["collectedAt"];
  let clock: CollectionClock;
  if (collectedAtRaw === null) {
    clock = { collected: false };
  } else {
    const parsed = isoTimestamp(collectedAtRaw, "collectedAt");
    if (!parsed.ok) return parsed;
    clock = { collected: true, at: parsed.value.iso, atMs: parsed.value.ms };
  }

  const tmuxServerPid = numberOrNull(u["tmuxServerPid"], "tmuxServerPid");
  if (!tmuxServerPid.ok) return tmuxServerPid;
  const error = stringOrNull(u["error"], "error");
  if (!error.ok) return error;

  const tookMs = u["tookMs"];
  if (typeof tookMs !== "number" || !Number.isFinite(tookMs)) {
    return { ok: false, reason: `tookMs is ${typeName(tookMs)}, not a number` };
  }
  const refreshMs = u["refreshMs"];
  if (typeof refreshMs !== "number" || !Number.isFinite(refreshMs)) {
    return { ok: false, reason: `refreshMs is ${typeName(refreshMs)}, not a number` };
  }
  if (!("health" in u)) return { ok: false, reason: "health is missing" };

  return {
    ok: true,
    value: {
      schema: OBSERVATION_SCHEMA,
      rows,
      tmuxServerPid: tmuxServerPid.value,
      clock,
      tookMs,
      error: error.value,
      refreshMs,
      health: u["health"] as JsonValue,
    },
  };
}
