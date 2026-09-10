/**
 * The idempotency key a client may put on a write, and what it is checked against.
 *
 * Plan 260910d § The fingerprint, § Retention. A `requestId` is minted by the
 * client once per intention and reused, byte for byte with its body, for every
 * retry of that intention. This file answers the three questions a route asks
 * of one, **before anything about executing now** — before the body is parsed
 * against today's catalogue, before the rate limiter, before the queue:
 *
 *  1. is the key there, and is it a key (`readRequestKey`);
 *  2. what request does it name (`requestFingerprint` — the client's fields as
 *     sent, never anything the server derived, so a deploy or a restart cannot
 *     make an identical retry conflict with itself);
 *  3. has this dashboard seen it (`lookupRequest`).
 *
 * **THE ROUTE IS PART OF THE FINGERPRINT.** A message body and an enqueue body
 * can be identical field for field (the session route defaults `mode` to
 * `enqueue`), and without the route in the hash one id could replay a direct
 * steer's receipt as the answer to an enqueue. Hashing the route makes that a
 * conflict, which is the honest reading of one key used for two intentions.
 */
import { createHash } from "node:crypto";

import {
  admitUnknownRequestId,
  parseRequestId,
  type ReceiptJournal,
  type ReceiptState,
} from "./receipt-journal.js";

/** Which write the key was sent to. */
export type RequestRoute = "steer-message" | "steer-answer" | "actions-session";

/**
 * JSON with its object keys sorted at every depth.
 *
 * Arrays keep their order — the order of broadcast recipients or dialog
 * options is meaning. `-0` is written `0`, as `JSON.stringify` does. Strings
 * are not Unicode-normalised: a genuine retry resends the same bytes, and two
 * spellings of one word are two bodies. Anything JSON cannot carry exactly is
 * refused rather than hashed as a guess.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`${value} cannot be carried by JSON`);
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`a ${typeof value} cannot be carried by JSON`);
  }
}

/** sha256 over the route and the body as sent, with `requestId` removed. */
export function requestFingerprint(route: RequestRoute, body: Record<string, unknown>): string {
  const { requestId: _requestId, ...rest } = body;
  return createHash("sha256").update(canonicalJson({ route, body: rest })).digest("hex");
}

export type RequestKey =
  /** No `requestId` field: the request cannot be deduplicated, and is otherwise unchanged. */
  | { kind: "unkeyed" }
  /** A `requestId` field that is not a request id. **Never downgraded to unkeyed.** */
  | { kind: "bad"; why: string }
  | { kind: "keyed"; requestId: string; mintedAt: number; fingerprint: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The key, read off the raw JSON body before anything else looks at it.
 *
 * A body that is not an object is unkeyed here and refused by the route's own
 * parse a line later. `requestId: null` is present, so it is malformed: the
 * way to send an unkeyed request is to leave the field out.
 */
export function readRequestKey(route: RequestRoute, raw: unknown): RequestKey {
  if (!isObject(raw) || !Object.hasOwn(raw, "requestId")) return { kind: "unkeyed" };
  const requestId = raw["requestId"];
  const parsed = parseRequestId(requestId, 0);
  if (!parsed.ok || typeof requestId !== "string") {
    return {
      kind: "bad",
      why:
        "requestId is present and is not a request id: it must be rq-<mint time in ms, base 36>-<16 to 40 of a-z0-9>. " +
        "Send it correctly, or leave the field out to send an unkeyed request.",
    };
  }
  let fingerprint: string;
  try {
    fingerprint = requestFingerprint(route, raw);
  } catch (err) {
    return {
      kind: "bad",
      why: `this body cannot be fingerprinted exactly (${err instanceof Error ? err.message : String(err)}), so its requestId could not be honoured`,
    };
  }
  return { kind: "keyed", requestId, mintedAt: parsed.mintedAt, fingerprint };
}

export type RequestLookup =
  /** Never seen, and young enough that "never seen" is provable. Go on to today's checks. */
  | { kind: "fresh" }
  /** The same id and the same body: answer with this receipt and do nothing else. */
  | { kind: "replay"; receipt: ReceiptState }
  | { kind: "conflict"; why: string }
  | { kind: "expired"; why: string };

/**
 * Has this dashboard seen this key?
 *
 * Synchronous, and the caller's `accept` must follow it with no `await`
 * between: the process is single-threaded, so nothing can accept the same id
 * in the gap. The journal refuses a duplicate id in any case.
 */
export function lookupRequest(
  receipts: ReceiptJournal,
  key: { requestId: string; mintedAt: number; fingerprint: string },
  now: number,
): RequestLookup {
  const found = receipts.byRequestId(key.requestId);
  if (found !== null) {
    if (found.accepted.fingerprint === key.fingerprint) return { kind: "replay", receipt: found };
    return {
      kind: "conflict",
      why:
        `request id ${key.requestId} was already used for a different request. A retry must resend the original ` +
        "body exactly; a new intention needs a new id. Nothing was done.",
    };
  }
  if (!admitUnknownRequestId(key.mintedAt, now)) {
    return {
      kind: "expired",
      why:
        `request id ${key.requestId} is too old (or too far in the future) for this dashboard to check: a request ` +
        "carrying it may already have been acted on, and that can no longer be told. Nothing was done — look at " +
        "the session before sending again with a new id.",
    };
  }
  return { kind: "fresh" };
}
