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
import type { CheckpointFeeds } from "./overseer-status.js";
import { composeQuestions } from "./questions.js";
import type { AttentionFeed, FleetState as FleetStateWire, OverseerStatusFeed, ProducerStamp, UsageFeed, WorkFeed } from "./wire.js";

/**
 * What `/api/state` returns and `/api/live` pushes — the same bytes, by
 * construction, because both call this.
 *
 * **THE SHAPE IS `wire.ts`'s, WITH THIS SIDE'S TWO TYPES POURED INTO IT.** It
 * was declared here and again in `web/src/types.ts`, related by nothing but
 * hope, and by the evening of 2026-09-08 the client had silently dropped
 * `answeringEnabled` and `tmuxServerPid` — `grep -c` found zero of either.
 * Every REQUIRED field the server sends is now in the client's type unless it is
 * NAMED in an `Omit<>` there, which is a line a reviewer can see. An OPTIONAL
 * field would cross unnoticed, which is why the wire type may not have one —
 * wire.ts § `FleetState` has the argument, the narrowing and the mutation
 * proof, and `tests/fleet-compile-guards.test.ts` is what enforces it.
 *
 * The two type arguments are the two fields that cannot cross: `FleetRow`
 * reaches `node:child_process` through collect.ts and `HealthReport` is
 * health.ts's, so `wire.ts` leaves both as holes rather than importing them —
 * which it must not do at all.
 *
 * `collectedAt: null` means NEVER COLLECTED, not "collected and empty". See the
 * module comment; it is the one field a consumer must read first.
 */
export type FleetState = FleetStateWire<FleetSnapshot["rows"][number], HealthReport | null>;

export function fleetState(
  snapshot: FleetSnapshot | null,
  error: string | null,
  health: HealthReport | null,
  refreshMs: number,
  answeringEnabled: boolean,
  attemptedAt: string | null = null,
  /**
   * The inbox. **Required, and it was optional for one review round.**
   *
   * A default of `{ kind: "not-asked" }` would have kept ~12 call sites
   * compiling, and it would also have preserved exactly the escape hatch that
   * produced the bug this stage exists to fix: a production join that can go
   * missing without anything going red. GPT Sol's finding, and it is right —
   * backward compatibility belongs at the HTTP parse boundary, where an older
   * SERVER omits the field, and not in the current server's composition root.
   *
   * A caller with nothing to say passes `{ kind: "not-asked" }` in as many
   * words, which is true of it: it did not look.
   */
  attention: AttentionFeed,
  /**
   * **IS SUPERVISION STILL WORKING?** — required, for the same reason
   * `attention` above is.
   *
   * A default of `{ kind: "not-asked" }` here would let a caller drop the one
   * reading that says whether anything is watching the fleet — and drop it as a
   * quiet line about an old server rather than as anything anybody would chase.
   * A caller with nothing to say passes the arm in as many words.
   */
  overseer: OverseerStatusFeed,
  /**
   * **CAN THIS ACCOUNT AFFORD MORE WORK?** — required, for the reason the two
   * above it are.
   *
   * A default here would let a caller drop the account's headroom silently, and
   * this is the field whose absence is least visible: the card simply is not
   * drawn, and a page with no usage card looks exactly like a page whose
   * account is fine. A caller with nothing to say passes `{ kind: "not-asked" }`
   * in as many words, which is true of it — it did not look.
   */
  usage: UsageFeed,
  /** Live work from the same checkpoint bytes, never reconstructed from the
   * five-minute health-history cadence. Required so a forgotten composition
   * edge is a type error rather than a quietly empty panel. */
  currentWork: WorkFeed,
  /** Which server run composed this payload, and which kept outcome and
   * successful inventory it carries. Required so ordering cannot vanish at a
   * composition edge. */
  producer: ProducerStamp,
  now: number = Date.now(),
): FleetState {
  const publishedProducer = producerForSnapshot(producer, snapshot);
  const rows = snapshot?.rows ?? [];
  return {
    schema: 1,
    producer: publishedProducer,
    attemptedAt,
    attention,
    overseer,
    usage,
    currentWork,
    /* The clock read that makes every age on the page comparable. Unlike
       `collectedAt` above, inventing this one here is not a lie with a clock on
       it — it is the only honest reading of it, because composing the payload
       is answering the request. See `servedAt`. */
    servedAt: new Date(now).toISOString(),
    rows,
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
    /* The pane and inbox projections are composed from the exact values above.
       In particular this is not a second checkpoint read: `statePayload` hands
       the one projection it already holds into this function. */
    questions: composeQuestions({
      rows,
      attentionFeed: attention,
      collectionError: error,
      collectedAt: snapshot?.collectedAt ?? null,
      refreshMs,
      now,
    }),
  };
}

/**
 * Keep a composition defect visible without making the dashboard disappear.
 *
 * The invalid instance makes Stage 2 refuse the stamp rather than believe a
 * repaired-looking ordinal. Normalising only its nullness keeps the payload's
 * safety contract intact for older consumers which do not inspect the stamp.
 */
function producerForSnapshot(producer: ProducerStamp, snapshot: FleetSnapshot | null): ProducerStamp {
  if ((producer.inventory === null) === (snapshot === null)) return producer;
  console.error(
    "fleet payload producer defect: inventory nullness disagrees with the snapshot; publishing an unreadable stamp",
  );
  return {
    instance: "invalid",
    publication: producer.publication,
    inventory: snapshot === null ? null : 0,
  };
}

/* ------------------------------------------------------------------ *
 * Composing the payload — the whole of what `/api/state` does.
 * ------------------------------------------------------------------ */

/**
 * Everything `statePayload` needs, as data and one function.
 *
 * `readCheckpoint` is a FUNCTION rather than a value on purpose: composing the
 * payload is what triggers the read, so the inbox is as old as the request and
 * not as old as the last collection. attention.ts § Read per request.
 */
export type PayloadDeps = {
  snapshot: FleetSnapshot | null;
  error: string | null;
  health: HealthReport | null;
  refreshMs: number;
  answeringEnabled: boolean;
  attemptedAt: string | null;
  /** The publication ledger's current stamp. Required so a caller cannot
   * compose an orderless payload without the compiler saying so. */
  producer: ProducerStamp;
  /**
   * **THE COORDINATOR'S CHECKPOINT — THE INBOX AND ITS OWN STATUS, OUT OF ONE
   * READ.** Must not throw; `readCheckpointFeeds` in overseer-status.ts is the
   * production implementation and that is its guarantee.
   *
   * It replaced a `readAttention: () => AttentionFeed` on 2026-09-08, and the
   * pair is deliberate rather than tidy. Two functions here would be two reads
   * of a file that is replaced by atomic rename, and the page's central claim —
   * *the Overseer last wrote 12 minutes ago; its source last updated 15* — puts
   * the inbox's clock and the checkpoint's clock in one sentence. Out of two
   * reads that sentence can be assembled from two different versions of the
   * file, and nothing on screen would say so.
   */
  readCheckpoint: () => CheckpointFeeds;
};

/**
 * **THE BYTES `/api/state` RETURNS AND `/api/live` PUSHES, composed in one
 * testable place.**
 *
 * This used to be four lines inside `server.ts`, and moving it is the fix for a
 * test that could not fail. `server.ts` binds ports at import time, so nothing
 * can import its `statePayload()` — which meant a join test had to hand-wire
 * `readAttention → fleetState → parseFleetState → App` itself, and a test that
 * rebuilds the missing edge inside itself stays green when production stops
 * making it. GPT Sol's sharpest finding on this stage, and it is the fourth
 * shape of a useless green test.
 *
 * So the composition lives here, `statePayload()` in server.ts is one call to
 * it, and the join test drives THIS function — the one production goes through.
 * The same argument `health-wiring.ts` makes about its own composition, for the
 * same reason.
 *
 * `readAttention` being a required field of `PayloadDeps` is the other half:
 * dropping it from server.ts is a compile error rather than a page that quietly
 * goes back to drawing nothing.
 */
export function statePayload(deps: PayloadDeps): string {
  /* ONE READ, ALL THREE FEEDS. Calling `deps.readCheckpoint()` twice would
     reopen the door this type was changed to close. */
  const checkpoint = deps.readCheckpoint();
  return JSON.stringify(
    fleetState(
      deps.snapshot,
      deps.error,
      deps.health,
      deps.refreshMs,
      deps.answeringEnabled,
      deps.attemptedAt,
      checkpoint.attention,
      checkpoint.overseer,
      checkpoint.usage,
      checkpoint.work,
      deps.producer,
      Date.now(),
    ),
  );
}

/** The initial SSE frame after a kept turn; before that, do not even compose one. */
export function initialFramePayload(producer: ProducerStamp, compose: () => string): string | null {
  return producer.publication > 0 ? compose() : null;
}

/* ------------------------------------------------------------------ *
 * Reading the attempt clock, on the consumer's side.
 * ------------------------------------------------------------------ */

/* **THEY ARE IN `attempt-clock.ts` NOW, AND NOT RE-EXPORTED FROM HERE.**
   `AttemptClock` and `readAttemptClock` were declared in this file, which put
   them behind `collect.ts`'s `node:child_process` and out of the browser's
   reach — so the client dropped `attemptedAt` entirely and lost the one reading
   that tells a collector which has stopped from a box which is quiet. The reason
   given for that decline was that a runtime helper cannot be shared, and it was
   wrong: what the client project cannot tolerate is a node dependency, not a
   runtime value.

   Not re-exported, deliberately. A second import path for one function is how
   two of them come to exist, which is the failure this whole area keeps writing
   up. Both sides import the leaf; attempt-clock.ts's header has the correction
   and the measurement. */
