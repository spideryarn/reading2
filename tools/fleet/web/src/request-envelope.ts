/**
 * **ONE INTENTION, ONE REQUEST ID, AND THE SAME BYTES EVERY TIME IT IS ASKED
 * AGAIN** — the browser's half of plan 260910d (Stage 4, and Sol's F11).
 *
 * The server keys a write by `requestId` and answers a repeat of the same id
 * and body with the receipt of the first, doing nothing (tools/fleet/
 * request-key.ts). That promise is only worth anything if the page keeps what
 * it sent. So a keyed write here is an **envelope**: the id, the route, the
 * body, and the JSON built from them **once** — a Check resends `json` itself,
 * not a body rebuilt from state that may have moved.
 *
 * ## What becomes of a keyed write
 *
 * `KeyedOutcome` has five arms, and only one of them keeps the envelope:
 *
 *  - `answered` — the route's ordinary answer, success or refusal, exactly as
 *    the unkeyed client reads it.
 *  - `replay` — the server already had this id and body and did nothing this
 *    time. **A definitive success**: the receipt says what became of the first.
 *  - `request-id-conflict`, `request-id-expired` (409) and `receipt-unavailable`
 *    (503) — definitive: nothing was done. The envelope is finished with.
 *  - `not-confirmed` — the request left and no definitive answer came back: a
 *    network error, an abort, a timeout, or a body that is not one of the
 *    server's shapes. **The only arm that keeps the envelope**, for an explicit
 *    Check by the person. There is never a silent retry.
 *
 * **Parse defensively: a shape this build cannot read is `not-confirmed`, never
 * success.**
 *
 * ## An envelope belongs to one route
 *
 * The route is part of the server's fingerprint, so the same id sent to a
 * different route is refused `409 request-id-conflict`. A fallback from one
 * route to another would be a new intention with a new id. None of the three
 * composers has one today — Send and Queue are two gestures, never one falling
 * back to the other — and `url` is fixed in the envelope so none can grow one
 * by accident.
 *
 * ## A pending envelope is memory-only
 *
 * It lives in the composer's React state. A reload keeps the draft's text
 * (drafts.ts) and loses the envelope, so the next Send is a new intention with
 * a new id and a new ticket — which may deliver the words a second time if the
 * first did arrive. Persisting envelopes is not built. The same limit as
 * docs/postmortems/260910c's F31 applies: a pane unmounted while a request is
 * open (the session composer remounts on a change of execution identity) loses
 * its pending envelope, and with it the Check.
 */
import type { ReceiptSummary } from "../../wire.js";

/** Injected in tests; the browser uses `Date.now()` and `crypto.getRandomValues`. */
export type MintClock = { now?: number; fill?: (bytes: Uint8Array) => unknown };

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
/** The server accepts 16 to 40; 24 characters of 36 is about 124 bits. */
const RANDOM_CHARS = 24;

/**
 * `rq-<Date.now() in base 36>-<24 of [a-z0-9]>` — the format
 * `parseRequestId` in tools/fleet/receipt-journal.ts accepts. The mint time is
 * what lets the server refuse an id too old to check rather than treat it as
 * new (§ Retention).
 *
 * Each character is a byte modulo 36. That favours the first four characters
 * by 1/64 each, which costs a fraction of a bit of an id that has over a
 * hundred; rejection sampling would cost a loop that a constant fill never
 * leaves.
 */
export function mintRequestId(clock: MintClock = {}): string {
  const now = clock.now ?? Date.now();
  const bytes = new Uint8Array(RANDOM_CHARS);
  if (clock.fill === undefined) crypto.getRandomValues(bytes);
  else clock.fill(bytes);
  let tail = "";
  for (const byte of bytes) tail += ALPHABET[byte % ALPHABET.length];
  return `rq-${now.toString(36)}-${tail}`;
}

/**
 * **Immutable, and carrying the composer's draft ticket.** `ticket` is opaque
 * here — the three composers put their `DraftSubmission` in it, taken at Send,
 * so that a Check answered with a replay accepts the words that were SENT and
 * never the words in the box now (docs/postmortems/260910c).
 */
export type RequestEnvelope<B extends object, T> = Readonly<{
  requestId: string;
  /** The route. Fixed: an envelope belongs to one route. */
  url: string;
  /** What was sent, without the id. A frozen copy, so nothing can edit it after the fact. */
  body: Readonly<B>;
  /** The exact bytes posted, `{...body, requestId}`, built once. A Check sends these. */
  json: string;
  ticket: T;
}>;

function deepFreeze<V>(value: V): V {
  if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

export function makeEnvelope<B extends object, T>(url: string, body: B, ticket: T, clock?: MintClock): RequestEnvelope<B, T> {
  if (Object.hasOwn(body, "requestId")) {
    throw new TypeError("this body already carries a requestId; an envelope mints its own, once");
  }
  const requestId = mintRequestId(clock);
  /* A JSON copy: the caller's object may be edited later, and what is sent
     must be what was built now. */
  const snapshot = JSON.parse(JSON.stringify(body)) as B;
  const json = JSON.stringify({ ...snapshot, requestId });
  return Object.freeze({ requestId, url, body: deepFreeze(snapshot), json, ticket });
}

export type KeyRefusalCode = "request-id-conflict" | "request-id-expired" | "receipt-unavailable";
const KEY_REFUSALS: readonly string[] = ["request-id-conflict", "request-id-expired", "receipt-unavailable"];

export type KeyedOutcome<T> =
  /** The route's ordinary answer, read exactly as the unkeyed client reads it. */
  | { kind: "answered"; outcome: T }
  /**
   * The server had this id and body already, and did nothing this time. A
   * broadcast's replay carries its recipients' receipts too.
   */
  | { kind: "replay"; receipt: ReceiptSummary; children: ReceiptSummary[] | null }
  /** Definitive, and nothing was done. The server's own sentence. */
  | { kind: KeyRefusalCode; why: string; status: number }
  /** No definitive answer. The only arm that keeps the envelope. */
  | { kind: "not-confirmed"; why: string };

/** Everything but `answered`: what a composer shows in place of the route's own card. */
export type EnvelopeNotice = Exclude<KeyedOutcome<never>, { kind: "answered" }>;

/** The sentence, in one place so all three composers say the same thing. */
export const NOT_CONFIRMED_SENTENCE = "Not confirmed — the dashboard may or may not have acted on it.";

/** A body this build cannot read, as the arm it must be. */
export function unreadableAnswer(status: number): { kind: "not-confirmed"; why: string } {
  return {
    kind: "not-confirmed",
    why: `the server answered ${status} with something that is not this API's answer, so what it did cannot be read off it`,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message === "" ? cause.name : cause.message;
  if (typeof cause === "string" && cause !== "") return cause;
  return "the request failed, and gave no reason";
}

/** What came back from one post: a status and a body, or nothing definite. */
export type Heard = { kind: "heard"; status: number; parsed: unknown } | { kind: "not-confirmed"; why: string };

/**
 * How long a keyed write may take before the page stops waiting and says it
 * cannot tell. The server's slowest honest write is a plan of a few steps; a
 * minute is well past it, and short enough that a phone left with a spinner
 * gets a Check instead.
 */
export const KEYED_DEADLINE_MS = 60_000;

/**
 * Post the envelope's bytes to its route. Every way of not hearing a definite
 * answer — a throw, an abort, the deadline, a body that is not JSON — is
 * `not-confirmed`: the request may well have arrived.
 */
export async function postEnvelope(
  envelope: RequestEnvelope<object, unknown>,
  fetchImpl: typeof fetch,
  deadlineMs: number = KEYED_DEADLINE_MS,
): Promise<Heard> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), deadlineMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(envelope.url, {
        method: "POST",
        // The exact content type is half the CSRF defence, as on every write.
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: envelope.json,
        signal: controller.signal,
      });
    } catch (cause) {
      return {
        kind: "not-confirmed",
        why: controller.signal.aborted
          ? `the dashboard did not answer within ${Math.round(deadlineMs / 1000)}s, so this page stopped waiting`
          : `this browser could not reach the dashboard: ${describe(cause)}`,
      };
    }
    try {
      return { kind: "heard", status: response.status, parsed: await response.json() };
    } catch (cause) {
      return { kind: "not-confirmed", why: `the server answered ${response.status} and the body was not JSON: ${describe(cause)}` };
    }
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * The arms every keyed route shares — a replay and the three key refusals —
 * or null for the route's own answer. A replay whose receipt this build cannot
 * read is `not-confirmed`, not a success with a hole in it.
 */
export function readKeyedArms(status: number, parsed: unknown): EnvelopeNotice | null {
  if (!isRecord(parsed)) return null;
  if (parsed["ok"] === true && parsed["op"] === "receipt") {
    if (status !== 200) return unreadableAnswer(status);
    if (parsed["replay"] !== true) return unreadableAnswer(status);
    const receipt = parseReceiptSummary(parsed["receipt"]);
    if (receipt === null) {
      return {
        kind: "not-confirmed",
        why: "the server said it already had this request, and this build could not read its receipt",
      };
    }
    const raw = parsed["children"];
    if (raw === undefined) return { kind: "replay", receipt, children: null };
    if (!Array.isArray(raw)) return unreadableAnswer(status);
    const children: ReceiptSummary[] = [];
    for (const child of raw) {
      const read = parseReceiptSummary(child);
      if (read === null) {
        return {
          kind: "not-confirmed",
          why: "the server said it already had this broadcast, and this build could not read one of its recipients' receipts",
        };
      }
      children.push(read);
    }
    return { kind: "replay", receipt, children };
  }
  const code = parsed["code"];
  const why = parsed["why"];
  if (parsed["ok"] === false && typeof code === "string" && typeof why === "string" && KEY_REFUSALS.includes(code)) {
    const expectedStatus = code === "receipt-unavailable" ? 503 : 409;
    if (status !== expectedStatus) return unreadableAnswer(status);
    return { kind: code as KeyRefusalCode, why, status };
  }
  return null;
}

/**
 * Whether a replay proves enough to consume the draft that produced it.
 * "Replay" proves only that the request id is known; the receipt says whether
 * the original action happened. Queued work is consumed once it entered the
 * queue, including its non-terminal states. A refusal, withdrawal or unknown
 * outcome keeps the words available to the person.
 */
export function replayConsumesDraft(receipt: ReceiptSummary, queued: boolean): boolean {
  if (receipt.state === "keys-submitted" || receipt.state === "completed") return true;
  return queued && (receipt.state === "accepted" || receipt.state === "attempted" || receipt.state === "returned");
}

/* ------------------------------------------------------------------ *
 * A receipt off the wire — all or nothing.
 * ------------------------------------------------------------------ */

const OPS: readonly ReceiptSummary["op"][] = [
  "queued-message",
  "queued-action",
  "steer-message",
  "steer-answer",
  "enacted-session",
  "broadcast-recipient",
  "enacted-box",
  "broadcast",
];
const ORIGINS: readonly ReceiptSummary["origin"][] = ["enqueue", "broadcast", "direct-steer", "enacted"];
const STATES: readonly ReceiptSummary["state"][] = [
  "accepted",
  "attempted",
  "returned",
  "withdrawn",
  "keys-submitted",
  "not-sent",
  "outcome-unknown",
  "completed",
  "plan-stopped",
];
const ACTOR_KINDS: readonly ReceiptSummary["actor"]["kind"][] = ["client-claimed", "unattributed-http", "system"];
const SPEAKERS: readonly string[] = ["greg", "overseer", "dashboard"];
const DISPOSITIONS: readonly string[] = ["lease-abandoned", "operator-confirmed", "abandoned-unknown"];

function stringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}
function numberOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isFinite(v));
}
function actorOf(v: unknown): ReceiptSummary["actor"] | null {
  if (!isRecord(v) || !ACTOR_KINDS.includes(v["kind"] as ReceiptSummary["actor"]["kind"]) || !stringOrNull(v["id"])) return null;
  return { kind: v["kind"] as ReceiptSummary["actor"]["kind"], id: v["id"] };
}

/**
 * **A RECEIPT IS READ WHOLE OR NOT AT ALL.** A state this build has never heard
 * of, or a missing field, is null — the list counts it as unreadable, and a
 * replay carrying it is `not-confirmed` — rather than a receipt drawn with a
 * guess in it. The one field read leniently is `reconciliation`, which a server
 * from before Stage 4 does not send: absent is null, and `reconciled` still
 * says whether anything was recorded.
 */
export function parseReceiptSummary(v: unknown): ReceiptSummary | null {
  if (!isRecord(v)) return null;
  const receiptId = v["receiptId"];
  if (typeof receiptId !== "string" || receiptId === "") return null;
  const op = v["op"] as ReceiptSummary["op"];
  const origin = v["origin"] as ReceiptSummary["origin"];
  const state = v["state"] as ReceiptSummary["state"];
  if (!OPS.includes(op) || !ORIGINS.includes(origin) || !STATES.includes(state)) return null;
  const actor = actorOf(v["actor"]);
  if (actor === null) return null;
  const speaker = v["speaker"];
  if (speaker !== null && !(typeof speaker === "string" && SPEAKERS.includes(speaker))) return null;
  const rawTarget = v["target"];
  let target: ReceiptSummary["target"] = null;
  if (rawTarget !== null) {
    if (
      !isRecord(rawTarget) ||
      typeof rawTarget["sessionId"] !== "string" ||
      !stringOrNull(rawTarget["paneId"]) ||
      !stringOrNull(rawTarget["claudeSessionId"]) ||
      !numberOrNull(rawTarget["tmuxGeneration"])
    ) {
      return null;
    }
    target = {
      sessionId: rawTarget["sessionId"],
      paneId: rawTarget["paneId"],
      claudeSessionId: rawTarget["claudeSessionId"],
      tmuxGeneration: rawTarget["tmuxGeneration"],
    };
  }
  const { parentReceiptId, stepsCompleted, what, acceptedAt, reason, attemptedAt, outcomeAt, reconciled, queueItemId } = v;
  const pending = v["pending"];
  const materialDeletionPending = v["materialDeletionPending"];
  if (
    typeof pending !== "boolean" ||
    !stringOrNull(parentReceiptId) ||
    !numberOrNull(stepsCompleted) ||
    typeof what !== "string" ||
    typeof acceptedAt !== "number" ||
    !Number.isFinite(acceptedAt) ||
    !stringOrNull(reason) ||
    !numberOrNull(attemptedAt) ||
    !numberOrNull(outcomeAt) ||
    typeof reconciled !== "boolean" ||
    !stringOrNull(queueItemId) ||
    typeof materialDeletionPending !== "boolean"
  ) {
    return null;
  }
  let reconciliation: ReceiptSummary["reconciliation"] = null;
  const rawReconciliation = v["reconciliation"];
  if (rawReconciliation !== undefined && rawReconciliation !== null) {
    if (!isRecord(rawReconciliation)) return null;
    const by = actorOf(rawReconciliation["actor"]);
    const at = rawReconciliation["at"];
    const disposition = rawReconciliation["disposition"];
    if (by === null || typeof at !== "number" || !Number.isFinite(at) || typeof disposition !== "string" || !DISPOSITIONS.includes(disposition)) {
      return null;
    }
    reconciliation = { disposition: disposition as NonNullable<ReceiptSummary["reconciliation"]>["disposition"], actor: by, at };
  }
  return {
    receiptId,
    op,
    origin,
    pending,
    actor,
    speaker: speaker as ReceiptSummary["speaker"],
    target,
    parentReceiptId,
    stepsCompleted,
    what,
    acceptedAt,
    state,
    reason,
    attemptedAt,
    outcomeAt,
    reconciled,
    reconciliation,
    queueItemId,
    materialDeletionPending,
  };
}
