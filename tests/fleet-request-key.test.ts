/**
 * The request fingerprint and key reader — plan 260910d § The fingerprint.
 *
 * A genuine retry resubmits the original envelope byte for byte, but a JSON
 * body can be re-serialised with its keys in another order by any client
 * library on the way. So the fingerprint is taken over a canonical form, and
 * these tests pin what "canonical" means: keys sorted at every depth, arrays
 * left in order, `-0` and `0` one number, and non-ASCII text hashed as itself.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalJson, readRequestKey, requestFingerprint } from "../tools/fleet/request-key.js";

const NOW = 1_800_200_000_000;
const GOOD_ID = `rq-${NOW.toString(36)}-${"k".repeat(20)}`;

describe("canonicalJson", () => {
  it("sorts keys, so two serialisations of one object agree", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson(JSON.parse('{"z":true,"m":null,"a":"x"}'))).toBe(canonicalJson(JSON.parse('{"a":"x","m":null,"z":true}')));
  });

  it("sorts keys at every depth, including inside arrays", () => {
    const one = { outer: { y: [{ d: 1, c: 2 }], x: { q: 1, p: 2 } } };
    const two = { outer: { x: { p: 2, q: 1 }, y: [{ c: 2, d: 1 }] } };
    expect(canonicalJson(one)).toBe(canonicalJson(two));
    expect(canonicalJson(one)).toBe('{"outer":{"x":{"p":2,"q":1},"y":[{"c":2,"d":1}]}}');
  });

  it("keeps array order, because order in an array is meaning", () => {
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
    expect(canonicalJson({ recipients: ["$1", "$2"] })).not.toBe(canonicalJson({ recipients: ["$2", "$1"] }));
  });

  it("writes -0 and 0 the same way", () => {
    expect(canonicalJson(-0)).toBe("0");
    expect(canonicalJson({ n: -0 })).toBe(canonicalJson({ n: 0 }));
  });

  it("hashes unicode as itself and distinguishes composed from decomposed forms", () => {
    expect(canonicalJson({ t: "café \u{1F600}" })).toBe('{"t":"café \u{1F600}"}');
    // Not normalised: a client that resubmits byte for byte sends the same form.
    expect(canonicalJson({ t: "café" })).not.toBe(canonicalJson({ t: "café" }));
    expect(canonicalJson(JSON.parse('{"t":"\\u00e9"}'))).toBe(canonicalJson({ t: "é" }));
  });

  it("refuses values JSON cannot carry rather than hashing a guess", () => {
    expect(() => canonicalJson(undefined)).toThrow();
    expect(() => canonicalJson({ n: Number.NaN })).toThrow();
    expect(() => canonicalJson({ n: Number.POSITIVE_INFINITY })).toThrow();
  });
});

describe("requestFingerprint", () => {
  it("is sha256 over the route and the canonical body, with requestId removed", () => {
    const body = { text: "hello", speaker: "greg" };
    const expected = createHash("sha256")
      .update(canonicalJson({ route: "steer-message", body }))
      .digest("hex");
    expect(requestFingerprint("steer-message", { ...body, requestId: GOOD_ID })).toBe(expected);
    expect(requestFingerprint("steer-message", { speaker: "greg", text: "hello" })).toBe(expected);
  });

  /**
   * **THE ROUTE IS THE CLIENT'S OPERATION, NOT SERVER METADATA** — Stage 2
   * review F38 removed it and was overruled on Fable's arbitration (plan
   * § The fingerprint). A message body and an enqueue body can be
   * byte-identical, because the session route defaults `mode` to `enqueue`;
   * without the route, one id posted to both would answer a retried direct
   * steer with a queued message's receipt. A genuine retry always goes to
   * the same route, so including it never breaks a replay.
   */
  it("changes with any field, and with the route", () => {
    const base = requestFingerprint("steer-message", { text: "hello", panePid: 1 });
    expect(requestFingerprint("steer-message", { text: "hello", panePid: 2 })).not.toBe(base);
    expect(requestFingerprint("steer-message", { text: "hello" })).not.toBe(base);
    expect(requestFingerprint("steer-message", { panePid: 1, text: "hello" })).toBe(base);
    expect(requestFingerprint("actions-session", { text: "hello", panePid: 1 })).not.toBe(base);
    const keyed = { requestId: GOOD_ID, text: "hello", panePid: 1 };
    const onSteer = readRequestKey("steer-message", keyed);
    const onSession = readRequestKey("actions-session", keyed);
    if (onSteer.kind !== "keyed" || onSession.kind !== "keyed") throw new Error("both should be keyed");
    expect(onSteer.fingerprint).not.toBe(onSession.fingerprint);
  });
});

describe("readRequestKey", () => {
  it("treats an absent requestId as unkeyed", () => {
    expect(readRequestKey("steer-message", { text: "x" })).toEqual({ kind: "unkeyed" });
    expect(readRequestKey("steer-message", "not an object")).toEqual({ kind: "unkeyed" });
    expect(readRequestKey("steer-message", [1, 2])).toEqual({ kind: "unkeyed" });
  });

  it("refuses a present but malformed id rather than downgrading it to unkeyed", () => {
    for (const bad of [null, 7, "", "rq-", "rq-abc-short", `RQ-${NOW.toString(36)}-${"k".repeat(20)}`, `rq-${NOW.toString(36)}-${"k".repeat(41)}`]) {
      expect(readRequestKey("steer-message", { requestId: bad, text: "x" }).kind).toBe("bad");
    }
  });

  it("returns the id, its mint time and the fingerprint of the rest", () => {
    const key = readRequestKey("steer-answer", { requestId: GOOD_ID, optionIndex: 1 });
    expect(key).toEqual({
      kind: "keyed",
      requestId: GOOD_ID,
      mintedAt: NOW,
      fingerprint: requestFingerprint("steer-answer", { optionIndex: 1 }),
    });
  });
});
