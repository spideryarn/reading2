/**
 * The Overseer's copy of the dashboard's wire contract, parsed from `unknown`.
 *
 * THE OVERSEER OWNS THE PAST TENSE and the dashboard owns the present
 * (docs/project/overseer-direction.md § Two tenses). So this file never
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
 * Strictly BUT WITHOUT A VETO: `attemptedAt`, the only field here that can be
 * malformed without failing the snapshot. It arrived as an addition rather than
 * a schema bump, so every dashboard built before 2026-09-08 omits it, and a
 * parser that refused those would take the Overseer off the air over a field
 * nothing in the history is built from. It is still PARSED rather than shrugged
 * at — see `parseAttempt`, where a junk value has to end up as "this producer
 * cannot say" and not as a positive claim that it never tried.
 *
 * Verbatim, as opaque JSON: `health` and `question`. Neither is diffed and
 * neither is an identity; both belong to another module that is still moving,
 * and re-validating them here would mean this file fails a snapshot because the
 * dashboard added a field to something we do not read. The direction doc
 * already settles `health`: the Overseer "stores that object verbatim per event
 * and does not interpret it a second time, so a change at the source changes
 * the history's shape rather than drifting from it."
 */
import { isRepoValue } from "../../scripts/gjd-remote-repo.js";
import type { SessionKind, SessionMeta, SessionState, SessionUnknownCause } from "../../scripts/gjd-remote-tmux.js";
import { readAttemptClock } from "../fleet/state.js";

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
export type CollectedClock = { readonly collected: true; readonly at: string; readonly atMs: number };
export type CollectionClock = { readonly collected: false } | CollectedClock;

/**
 * When the producer last STARTED a collection — three answers, not two.
 *
 * `collectedAt` says when data last ARRIVED and `error` says why the last
 * attempt failed; NEITHER SAYS WHETHER THE COLLECTOR IS STILL TRYING. Measured
 * on 2026-09-08: `/api/state` served a `collectedAt` thirty minutes stale with
 * `error: null`, because the collector's child took SIGTERM in uninterruptible
 * IO and the chained refresh loop never reached its next iteration. Nothing
 * threw. The thing that would have reported the failure was the thing that had
 * stopped. `attemptedAt` is written BEFORE each attempt precisely so that pair
 * can be read — see `attemptedAt` in tools/fleet/state.ts.
 *
 * THE THIRD ARM IS THE WHOLE DIFFICULTY. A producer that does not report the
 * field looks, to anything reading a two-armed type, exactly like one that has
 * never attempted a collection — which is exactly what a wedged collector looks
 * like. So "this producer cannot say" is a reading of its own, and a consumer
 * that has it can stay silent instead of raising the alarm that is always
 * wrong. Malformed lands here too, with its own sentence: a value the producer
 * could not have printed is a producer we cannot read, never a producer
 * volunteering that it has never tried.
 *
 * NESTED DISCRIMINANTS, `reported` then `attempted`, so the two questions are
 * answered in the order they have to be asked. `{ reported: false }` carries a
 * `why` for the same reason `ParseResult` does: whoever decides to say nothing
 * about the collector has to be able to write down why.
 */
export type ObservedAttemptClock =
  | { readonly reported: false; readonly why: string }
  | { readonly reported: true; readonly attempted: false }
  | { readonly reported: true; readonly attempted: true; readonly at: string; readonly atMs: number };

/**
 * The status union with ONE COMBINATION THE PRODUCER CANNOT EMIT REMOVED.
 *
 * `SessionState`'s `unknown` arm carries `reportedStatus?: string`, optional so
 * that the producer's five other construction sites need not mention a field
 * they have nothing to say about. That optionality is right where it is and
 * wrong here: the token is set at exactly one site, the one whose cause is
 * `unrecognised-agent-status` (scripts/gjd-remote-tmux.ts, `sessionState`), and
 * `statusKey` in diff.ts puts it in the transition key. So a payload claiming
 * `cause: "agents-unavailable"` with a token attached manufactures a status
 * transition out of a row nothing on the box could have produced — GPT Sol's
 * S2-04.
 *
 * A RUNTIME CHECK WOULD NOT BE ENOUGH, which is why this is a type rather than
 * an `if`. Leaving the parser's output typed as `SessionState` means the
 * impossible shape stays constructible everywhere downstream, and the next
 * thing to build a status by hand — a test helper, the store's read-back path —
 * is free to make one. Splitting the arm makes the combination unrepresentable
 * after parsing, which is the only version of this rule that stays true.
 *
 * Both directions are enforced: the token is REQUIRED on that cause and
 * FORBIDDEN on every other. The forbidden direction is the one Sol found; the
 * required direction matches the producer today, and a future producer that set
 * the cause without a token would fail the whole snapshot loudly rather than
 * quietly losing a transition — the trade this module makes everywhere else.
 */
export type ObservedUnknownStatus =
  | { kind: "unknown"; why: string; cause: Exclude<SessionUnknownCause, "unrecognised-agent-status"> }
  | { kind: "unknown"; why: string; cause: "unrecognised-agent-status"; reportedStatus: string };

/** Every `SessionState` arm, with the `unknown` one replaced by the narrower pair above. */
export type ObservedStatus = Exclude<SessionState, { kind: "unknown" }> | ObservedUnknownStatus;

/** One session, as the dashboard reported it. */
export type ObservedRow = {
  /**
   * tmux's own session handle (`$1991`). Half of an identity and never the
   * whole of one: it is stable within one tmux server and handed out again from
   * `$0` by the next.
   */
  readonly id: string;
  readonly name: string;
  readonly title: string | null;
  /** Lossy display fields. `meta` is the record; these two are for reading. */
  readonly repo: string | null;
  readonly worktree: string | null;
  /**
   * The launcher's metadata, whole. `version === 1` gates `dir`, `kind` and
   * `repo` together, which is the reason the dashboard sent the union rather
   * than three nullable fields: `dir` is the only field in the payload that
   * cannot be reconstructed after a reboot, and a null the compiler lets you
   * ignore is how it would come to be dropped.
   */
  readonly meta: SessionMeta;
  readonly startedAt: string;
  readonly paneId: string | null;
  readonly panePid: number | null;
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
   *
   * A PLAIN STRING ON PURPOSE, and it used to be branded. The brand
   * (`ClaimedConversationId`) was deleted on 2026-09-08 on GPT Sol's S2-07: it
   * checked nothing, had no verified counterpart to be confused with, and its
   * only effect was to imply that something had verified the uuid. The
   * verification this type wants does not exist yet, and a brand that stands in
   * for one is the kind of reassurance this module is built to refuse. The one
   * brand the stage does spend is `AdmissibleSnapshot` in admissible.ts, which
   * a function really does mint and really does gate.
   */
  readonly claimedConversationId: string | null;
  /** Volatile prose, kept verbatim and never diffed. */
  readonly question: JsonValue;
  /**
   * The status, narrowed past what `SessionState` can say — see
   * `ObservedStatus`. Assignable to `SessionState`, so everything downstream
   * that takes one still takes this.
   */
  readonly status: ObservedStatus;
};

/** One snapshot, as the dashboard reported it. */
export type ObservedSnapshot = {
  readonly schema: 1;
  readonly rows: readonly ObservedRow[];
  /**
   * The tmux server generation these handles belong to, or null when it could
   * not be read. Two snapshots that disagree here describe different worlds —
   * see diff.ts, where that is a rule about not diffing rather than a change.
   */
  readonly tmuxServerPid: number | null;
  /** The wire's `collectedAt`, as a type that cannot be read without deciding about null. */
  readonly clock: CollectionClock;
  /**
   * The wire's `attemptedAt` — when the producer last STARTED collecting, which
   * is a different fact from `clock` and the only one that can tell a wedged
   * collector from a quiet box. See `ObservedAttemptClock`, and note that this
   * is the one field whose malformation does not fail the snapshot.
   */
  readonly attempt: ObservedAttemptClock;
  readonly tookMs: number;
  /** The last collection's failure. A stale payload keeps its old rows and is broadcast anyway. */
  readonly error: string | null;
  /** How often the producer intends to collect, so a freshness watchdog need not hard-code a deadline. */
  readonly refreshMs: number;
  /** Kept verbatim, interpreted nowhere. */
  readonly health: JsonValue;
};

/**
 * A snapshot the producer has actually collected.
 *
 * The narrowing is carried in the type rather than re-checked downstream, so
 * nothing that reads the rows can forget to decide about the clock.
 *
 * IT IS NOT THE TYPE `diff()` TAKES, and it used to say it was. Its old comment
 * claimed `admissible()` was the only thing that could mint one, which was
 * false: `{...parsed, clock: parsed.clock}` after a narrowing `if` mints one in
 * two lines with no cast, error-nullness and clock monotonicity unchecked (GPT
 * Sol's S2-07). The gate that really is a gate is `AdmissibleSnapshot` in
 * admissible.ts, which carries a brand only that function can attach.
 */
export type FreshSnapshot = ObservedSnapshot & { readonly clock: CollectedClock };

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

/**
 * The numeric domains, because `Number.isFinite` is not one.
 *
 * FINITE IS NOT THE DOMAIN OF ANY NUMBER IN THIS PAYLOAD, and the gap is not
 * cosmetic. `tmuxServerPid: 132280.5` is finite, so the old check passed it —
 * and `generationRelation` then calls the generation CHANGED, which closes out
 * every session in the fleet and re-announces every one of them. A single
 * malformed digit becomes a reboot in the history. GPT Sol's S2-02.
 *
 * Every one of these numbers comes out of a bounded digit string at the source
 * (`/^\d{1,10}$/` for both pids in tools/fleet/collect.ts, `/^wait:[1-9]\d{0,8}$/`
 * for the countdown in scripts/gjd-remote-tmux.ts) or out of arithmetic on
 * `Date.now()` (`tookMs`). So an integer check is not stricter than the
 * producer; it is the producer's own domain, written down on this side of the
 * socket. Ten digits sits far below `MAX_SAFE_INTEGER`, so the safe-integer
 * ceiling is never the binding constraint — it is there to refuse `1e30` and
 * anything else that survived JSON.
 */
function safeInteger(u: unknown, field: string, least: number, what: string): ParseResult<number> {
  if (typeof u !== "number") return { ok: false, reason: `${field} is ${typeName(u)}, not a number` };
  if (!Number.isSafeInteger(u) || u < least) {
    return { ok: false, reason: `${field} is ${JSON.stringify(u)}, which is not ${what}` };
  }
  return { ok: true, value: u };
}

/** A pid, or null when the box could not be asked. Zero is not a pid any process wears. */
function pidOrNull(u: unknown, field: string): ParseResult<number | null> {
  if (u === null) return { ok: true, value: null };
  return safeInteger(u, field, 1, "a process id");
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
function parseStatus(u: unknown, where: string): ParseResult<ObservedStatus> {
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
      // Whole seconds, never negative: the source is `wait:<digits>` off the
      // pane's command line. It is also the number an implied deadline is built
      // from in diff.ts, so a fractional or negative one moves a deadline that
      // nothing on the box moved.
      const secondsLeft = safeInteger(u["secondsLeft"], `${where}.status.secondsLeft`, 0, "a whole number of seconds");
      if (!secondsLeft.ok) return secondsLeft;
      return { ok: true, value: { kind: "waiting", secondsLeft: secondsLeft.value } };
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
      // THE TOKEN AND THE CAUSE TRAVEL TOGETHER OR NOT AT ALL — see
      // `ObservedUnknownStatus` for why this is a type and not only these two
      // ifs. The producer sets the token at one site and that site's cause is
      // this one, so either half without the other is a payload the box cannot
      // have produced, and it is the token that goes into the transition key.
      if (cause === "unrecognised-agent-status") {
        if (typeof reported !== "string") {
          return {
            ok: false,
            reason: `${where}.status.reportedStatus is ${typeName(reported)}, and the cause says the box saw a status token`,
          };
        }
        return { ok: true, value: { kind: "unknown", why, cause, reportedStatus: reported } };
      }
      if (reported !== undefined) {
        return {
          ok: false,
          reason: `${where}.status carries a reportedStatus with cause ${JSON.stringify(cause)}, which the producer never sets it for`,
        };
      }
      // Absent rather than `undefined`, so a round trip through JSON gives back
      // the same object and the canonical key cannot differ between a snapshot
      // read off the wire and the same snapshot read back out of the store.
      return {
        ok: true,
        value: {
          kind: "unknown",
          why,
          cause: cause as Exclude<SessionUnknownCause, "unrecognised-agent-status">,
        },
      };
    }
    default: {
      const never: never = arm;
      return { ok: false, reason: `${where}.status.kind is ${JSON.stringify(never)}, which this version has no arm for` };
    }
  }
}

/**
 * The longest `dir` the producer will mint, from `parseMeta` in
 * scripts/gjd-remote-tmux.ts. A path longer than this did not come from there.
 */
const MAX_META_DIR = 4096;

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
  // THE TWO REGISTER FIELDS, VALIDATED AS THE PRODUCER VALIDATES THEM. These
  // are not display strings — `row.repo` and `row.worktree` are, and they stay
  // loose. These two are the only things kept for REBOOT RECOVERY, so the
  // question they have to answer is "could a later resumer act on this?", and a
  // value the producer would have refused is one nothing can act on. GPT Sol's
  // S2-06.
  if (typeof repo !== "string") return { ok: false, reason: `${where}.meta.repo is ${typeName(repo)}, not a string` };
  // THE PRODUCER'S OWN VALIDATOR, IMPORTED — the only line in this module that
  // executes another module's code, and it earns the exception. A copy of the
  // grammar was here for a few hours and was wrong for a reason no test could
  // catch: when the producer changes what a repo value may be, a copy goes on
  // agreeing with the old rule, typecheck stays green, and the Overseer either
  // refuses every newly valid snapshot or records one the producer has begun
  // refusing. `isRepoValue` validates `GJD_REPO` at the launcher, the log's
  // `repo` field, and now this — one grammar for the recovery identity rather
  // than three that agree today. GPT Sol's S2-06A, 2026-09-08.
  //
  // It costs nothing at import: scripts/gjd-remote-repo.ts runs nothing at
  // module scope, and its one impurity (`git`) is injected per call.
  if (!isRepoValue(repo)) {
    return { ok: false, reason: `${where}.meta.repo is ${JSON.stringify(repo)}, which is neither an owner/name slug nor 'unknown'` };
  }
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
  // ABSOLUTE, AND BOUNDED, because the producer refuses anything else and
  // because of what a relative one would DO: a resumer reading `worktrees/foo`
  // out of the history resumes a real conversation in whatever directory the
  // daemon happens to be standing in. That is not a crash — it is a session
  // started in the wrong tree, which is the plausible-looking wrong answer this
  // whole module is written to refuse.
  if (!dir.startsWith("/") || dir.length > MAX_META_DIR) {
    return { ok: false, reason: `${where}.meta.dir is ${JSON.stringify(dir)}, which is not an absolute path on the box` };
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
  const panePid = pidOrNull(u["panePid"], `${where}.panePid`);
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
      claimedConversationId: claimed.value,
      question: u["question"] as JsonValue,
      status: status.value,
    },
  };
}

/**
 * The attempt clock, read off a whole payload — see `ObservedAttemptClock`.
 *
 * TAKES THE PAYLOAD RATHER THAN THE FIELD, because the field alone cannot
 * answer the question: `attemptedAt` absent means "never attempted" or "older
 * producer", and only `collectedAt` separates them.
 *
 * THE INFERENCE IS NOT MADE HERE. `readAttemptClock` in tools/fleet/state.ts
 * owns it and this delegates the whole decision to it, for the reason
 * `parseMeta` imports `isRepoValue` a few lines up: the rule is the producer's
 * — `attemptedAt` is written BEFORE each attempt, so a non-null `collectedAt`
 * with no attempt clock is provably a producer that does not REPORT trying
 * rather than one that never tried — and a copy of it here would go on agreeing
 * with today's producer for ever, with typecheck green either way. One grammar,
 * not two that match this afternoon.
 *
 * WHAT THIS FILE ADDS IS THE SHAPE CHECK, and it is the half the helper cannot
 * do. Its parameter is `string | null | undefined`, so a payload carrying
 * `attemptedAt: 17` — or `""`, or a date string `toISOString()` could not have
 * printed — arrives there as "nothing here" and comes back as a POSITIVE claim
 * that the collector has never started, on a payload full of live rows. That is
 * a fact manufactured out of junk, and the watchdog would act on it. So
 * anything present-but-unreadable is refused here first, as "cannot say".
 *
 * EXPORTED BECAUSE THE DAEMON READS THIS OFF PAYLOADS THE GATE REFUSED. A
 * collector that keeps attempting while its snapshots are rejected is a source
 * that is FAILING, which is a different condition from one that has STOPPED,
 * and the difference is only visible on payloads with no parsed snapshot to
 * read the field from. `parseObservation` fills its own field with this same
 * function, so the two can never disagree about one payload.
 *
 * NEVER FAILS THE SNAPSHOT: every arm returns a reading, and the unreadable
 * ones return a sentence rather than a `ParseResult`. See the module comment.
 */
export function parseAttempt(u: unknown): ObservedAttemptClock {
  if (!isRecord(u)) return { reported: false, why: `the payload is ${typeName(u)}, so it carries no attempt clock` };

  const raw = u["attemptedAt"];
  let stamp: { iso: string; ms: number } | null = null;
  if (raw !== undefined && raw !== null) {
    const parsed = isoTimestamp(raw, "attemptedAt");
    if (!parsed.ok) return { reported: false, why: parsed.reason };
    stamp = parsed.value;
  }

  // Only the SHAPE of `collectedAt` matters to the inference — whether the
  // producer has ever collected — and a malformed one fails the whole snapshot
  // in `parseObservation` anyway, where the history really does depend on it.
  const collectedAt = u["collectedAt"];
  const clock = readAttemptClock({
    attemptedAt: stamp?.iso ?? null,
    collectedAt: typeof collectedAt === "string" ? collectedAt : null,
  });
  switch (clock.kind) {
    case "attempted":
      // THE COUPLING, CHECKED RATHER THAN ASSERTED. The only string handed to
      // the helper is one this function validated, so `stamp` is non-null and
      // `clock.at` is that same string; a `!` here would be a claim about
      // another module's future. If it ever normalised or substituted the
      // value, the milliseconds below would belong to a different instant than
      // the string beside them — so the honest answer is that we cannot say.
      // UNREACHABLE TODAY, and knowingly so: a mutation that deletes it passes
      // the whole suite, because no payload can reach it while the helper
      // returns what it was given. It is here instead of a `!`, not instead of
      // a test.
      if (stamp === null || stamp.iso !== clock.at) {
        return { reported: false, why: `attemptedAt is ${JSON.stringify(clock.at)}, which is not the timestamp this reader validated` };
      }
      return { reported: true, attempted: true, at: stamp.iso, atMs: stamp.ms };
    case "never-attempted":
      // Both-absent is merged into this arm at the source, on purpose: a
      // producer that has never attempted and an old one that has never
      // collected have told us the same nothing, and there is one action.
      return { reported: true, attempted: false };
    case "not-reported":
      return { reported: false, why: clock.why };
    default: {
      const never: never = clock;
      return { reported: false, why: `the attempt clock is ${JSON.stringify(never)}, which this version has no arm for` };
    }
  }
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

  // THE GENERATION IS THE FIELD A BAD NUMBER DOES THE MOST DAMAGE TO: an
  // impossible one that parsed would read as a different tmux server and close
  // out the entire fleet. See `safeInteger`.
  const tmuxServerPid = pidOrNull(u["tmuxServerPid"], "tmuxServerPid");
  if (!tmuxServerPid.ok) return tmuxServerPid;
  const error = stringOrNull(u["error"], "error");
  if (!error.ok) return error;

  // Zero is legitimate: `fleetState()` substitutes it when there is no
  // collection to report a duration for.
  const tookMs = safeInteger(u["tookMs"], "tookMs", 0, "a whole number of milliseconds");
  if (!tookMs.ok) return tookMs;
  // POSITIVE, not merely finite. This is the cadence a freshness watchdog
  // divides and compares against — S4's job — and a zero or negative one there
  // is either a deadline that is always missed or one that never is. Neither
  // failure would say anything about itself; both would be read as facts about
  // the box.
  const refreshMs = safeInteger(u["refreshMs"], "refreshMs", 1, "a positive collection interval in milliseconds");
  if (!refreshMs.ok) return refreshMs;
  if (!("health" in u)) return { ok: false, reason: "health is missing" };

  return {
    ok: true,
    value: {
      schema: OBSERVATION_SCHEMA,
      rows,
      tmuxServerPid: tmuxServerPid.value,
      clock,
      // DELIBERATELY NOT ABLE TO FAIL THIS PARSE. Every other field above can
      // refuse the snapshot; this one always returns a reading, because a
      // dashboard built before the field existed is an old producer rather than
      // a broken one and the Overseer has to go on watching it.
      attempt: parseAttempt(u),
      tookMs: tookMs.value,
      error: error.value,
      refreshMs: refreshMs.value,
      health: u["health"] as JsonValue,
    },
  };
}
