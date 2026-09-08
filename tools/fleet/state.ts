/**
 * The wire shape, in one place, so the poll and the stream cannot disagree.
 *
 * This is a separate module for one reason: `server.ts` binds ports at import
 * time, so anything that lives there cannot be tested without a listening
 * socket. That is the same accident `page.ts` caused — importing one helper
 * from a test bound 8787 and the suite went from 4s to 19s — and it matters
 * more here, because this payload now has THREE consumers that must agree
 * about it: the React client, an SSE subscriber, and the Overseer daemon
 * (`tools/overseer/`, another session) which folds these snapshots into a
 * history of what the fleet did.
 *
 * THE EMPTY-BUT-HONEST CASE IS THE POINT OF THIS FILE. Before the first
 * collection there is no snapshot, and something has to be sent to a poll that
 * arrives in that window. `rows: []` with `collectedAt: null` is that
 * something, and the null is the whole message: **an empty `rows` is only ever
 * a claim about the box when `collectedAt` is non-null.** Read them separately
 * and a freshly restarted dashboard says "no sessions are running" about a box
 * with thirty-six of them — which is the reading least likely to make anyone
 * look, and the one a history would record as thirty-six sessions vanishing at
 * once. Every consumer must branch on `collectedAt` before it believes `rows`.
 */
import type { FleetSnapshot } from "./collect.js";
import type { HealthReport } from "./health.js";

/**
 * What `/api/state` returns and `/api/live` pushes — the same bytes, by
 * construction, because both call this.
 *
 * `collectedAt: null` means NEVER COLLECTED, not "collected and empty". See the
 * module comment; it is the one field a consumer must read first.
 */
export type FleetState = {
  /**
   * The payload's shape, so a stored snapshot can be read back by code that has
   * moved on. Bump it when a consumer that ignored the change would be WRONG
   * rather than merely poorer — a removed field, or one whose meaning changed.
   * Adding a field is not a bump: every consumer here ignores what it does not
   * know, and a version that changes on every addition is one nobody checks.
   */
  schema: 1;
  rows: FleetSnapshot["rows"];
  collectedAt: string | null;
  /**
   * Which tmux server the handles in `rows` belong to. Two snapshots with
   * different values here describe different worlds, however alike `$1643`
   * looks in both. Null when it could not be read — see `tmuxServerPid`.
   */
  tmuxServerPid: number | null;
  tookMs: number;
  /** The last collection's failure, or null. A stale payload keeps its old rows. */
  error: string | null;
  health: HealthReport | null;
  /** How often the server intends to collect, so the page can say when it is genuinely late. */
  refreshMs: number;
  /**
   * Whether `POST /api/steer/answer` will do anything.
   *
   * THE PAGE CANNOT HONESTLY WARN ABOUT A FLAG IT HAS NEVER BEEN TOLD. Without
   * this, the client either hedges ("answering may be held back") or discovers
   * the truth by having somebody tap and get a 503 — and the whole point of the
   * hold is that a person should not tap. Told beats inferred, again.
   *
   * Not a `schema` bump: adding a field is not a change a consumer that ignored
   * it would be *wrong* about, which is this file's own rule.
   */
  answeringEnabled: boolean;
  /**
   * When a collection was last **attempted**, which is a different fact from
   * `collectedAt` and answers a question nothing here could answer before.
   *
   * `collectedAt` says when data last ARRIVED. `error` says why the last attempt
   * failed. Neither says whether the collector is still trying — and on
   * 2026-09-08 the `orchestrator-setup` session caught the gap in the field:
   * `collectedAt` roughly **thirty minutes stale with `error: null`**, which
   * reads as a calm, healthy, slightly-quiet box.
   *
   * The cause is in `refreshLoop`: a collection that never SETTLES throws
   * nothing, so `lastError` stays null and the chained loop simply stops. On a
   * box under memory pressure a `bash` child that has been sent SIGTERM at the
   * 60-second mark can sit in uninterruptible IO for a long time, and
   * `promisify(execFile)` waits for it. Silence, indefinitely, wearing the last
   * good timestamp.
   *
   * Two consumers need the difference and they act on it differently. A person
   * reading the page needs "the box is quiet" told apart from "we stopped
   * looking". The Overseer's freshness watchdog needs **the source is down**
   * told apart from **the source is lying** — and `attemptedAt` fresh with
   * `collectedAt` stale is precisely the second one.
   *
   * Null until the first attempt, for the same reason `collectedAt` is: a
   * timestamp invented here would be a claim nobody made.
   *
   * **DO NOT READ THIS FIELD DIRECTLY FROM A PAYLOAD — use `readAttemptClock`.**
   * It was added without a schema bump, so a server that predates it sends no
   * such field, and a consumer that read "absent" as "never attempted" would
   * report every old server as permanently wedged. That distinction is
   * recoverable and the helper below recovers it.
   */
  attemptedAt: string | null;
};

export function fleetState(
  snapshot: FleetSnapshot | null,
  error: string | null,
  health: HealthReport | null,
  refreshMs: number,
  answeringEnabled: boolean,
  attemptedAt: string | null = null,
): FleetState {
  return {
    schema: 1,
    attemptedAt,
    rows: snapshot?.rows ?? [],
    tmuxServerPid: snapshot?.tmuxServerPid ?? null,
    // NOT `snapshot?.collectedAt ?? new Date().toISOString()`, however tempting
    // it looks to a caller that wants a string. A timestamp invented here says
    // "we looked just now and found nothing", which is a lie with a clock on it.
    collectedAt: snapshot?.collectedAt ?? null,
    tookMs: snapshot?.tookMs ?? 0,
    error,
    health,
    refreshMs,
    answeringEnabled,
  };
}

/* ------------------------------------------------------------------ *
 * Reading the attempt clock, on the consumer's side.
 * ------------------------------------------------------------------ */

/**
 * What a payload can tell you about whether the collector is still trying.
 *
 * Three arms because there are three genuinely different situations, and the
 * one that would otherwise be lost is the third.
 */
export type AttemptClock =
  /** The producer said when it last started a collection. */
  | { kind: "attempted"; at: string }
  /** The producer tracks this and has not started one yet — a fresh process. */
  | { kind: "never-attempted" }
  /**
   * The producer does not report this at all, so nothing can be concluded about
   * whether it is still trying. **Not a fault, and not a wedge.**
   */
  | { kind: "not-reported"; why: string };

/**
 * Read `attemptedAt` without mistaking an old server for a wedged one.
 *
 * `attemptedAt` landed on 2026-09-08 as an added field rather than a schema
 * bump — state.ts's own rule, since a consumer that ignores it is poorer rather
 * than wrong. But that leaves an ambiguity for anyone who *does* use it: a
 * payload with no `attemptedAt` is either a producer that has never attempted a
 * collection, or one built before the field existed. Read naively, the second
 * looks exactly like a collector that has stopped trying — which is the very
 * fault the field was added to detect. Raised by the `orchestrator-setup`
 * session, whose freshness watchdog consumes this.
 *
 * **The ambiguity is recoverable, and `collectedAt` is what recovers it.**
 * `attemptedAt` is set BEFORE every attempt, so on any producer that reports it,
 * a non-null `collectedAt` implies a non-null `attemptedAt` — a collection
 * cannot have succeeded without having been started. So a payload carrying data
 * but no attempt clock is not a producer that never tried; it is a producer that
 * does not report trying. That is an inference from the field's own ordering
 * rather than a convention two programs have agreed to, which is why it belongs
 * here as code rather than in a message between us.
 *
 * When BOTH are absent the two cases stay merged — never attempted, or an old
 * server that has never collected — and that is fine: no data has ever arrived
 * either way, and a consumer does the same thing about it.
 *
 * Deliberately does not look at `undefined` versus `null`. A producer that has
 * the field and has not attempted sends `null`, and one without it sends
 * nothing, so in raw JSON the two ARE distinguishable — but that distinction
 * dies in the first parser, ORM or round trip that normalises one to the other,
 * and a guard that survives only until somebody reasonable touches the pipe is
 * not a guard.
 */
export function readAttemptClock(state: {
  attemptedAt?: string | null;
  collectedAt?: string | null;
}): AttemptClock {
  if (typeof state.attemptedAt === "string" && state.attemptedAt !== "") {
    return { kind: "attempted", at: state.attemptedAt };
  }
  if (typeof state.collectedAt === "string" && state.collectedAt !== "") {
    return {
      kind: "not-reported",
      why:
        "this payload has rows and a collection time but no attempt clock, so it comes from a " +
        "server built before that field — whether it is still collecting cannot be told from here",
    };
  }
  return { kind: "never-attempted" };
}
