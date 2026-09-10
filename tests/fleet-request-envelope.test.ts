/**
 * **THE ENVELOPE, AND EVERY WAY A KEYED WRITE CAN END** — plan 260910d,
 * Stage 4, the three browser clients.
 *
 * A keyed write is `{requestId, body}`, built once. A retry — the person's
 * Check, never an automatic one — resends exactly the same bytes, so the
 * server can answer it with the receipt of the first rather than doing it
 * twice. What this file pins, for each of the three clients:
 *
 *  - a lost response followed by Check resends **the same id and byte-identical
 *    body** to **the same route**;
 *  - a replay is a definitive success, carrying the receipt;
 *  - 409 (conflict, expired) and 503 (`receipt-unavailable`) are definitive
 *    refusals — nothing was done, and the envelope is not for resending;
 *  - an answer that is not one of the server's shapes — an unreadable 200
 *    above all — is `not-confirmed`, never success.
 *
 * Every `fetch` here is a script. Nothing reaches a network, and nothing
 * reaches tmux.
 */
import { describe, expect, it } from "vitest";

import { parseRequestId } from "../tools/fleet/receipt-journal.js";
import {
  httpActionsApi,
  makeActionsApi,
  queueMessageEnvelope,
  runEnvelope,
  type ActionOutcome,
} from "../tools/fleet/web/src/actions-client";
import {
  broadcastEnvelope,
  httpBroadcastApi,
  makeBroadcastApi,
  type BroadcastOutcome,
} from "../tools/fleet/web/src/broadcast-client";
import {
  makeEnvelope,
  mintRequestId,
  parseReceiptSummary,
  type KeyedOutcome,
  type RequestEnvelope,
} from "../tools/fleet/web/src/request-envelope";
import {
  answerEnvelope,
  httpSteerApi,
  makeSteerApi,
  messageEnvelope,
  type SteerOutcome,
} from "../tools/fleet/web/src/steer-client";
import type { FleetRow } from "../tools/fleet/web/src/types";
import type { ReceiptSummary } from "../tools/fleet/wire";

const NOW = 1_800_600_000_000;

function row(over: Partial<FleetRow> & { id: string }): FleetRow {
  const status = over.status ?? { kind: "idle" as const };
  return {
    description: { kind: "not-yet-described", why: "no describe pass in this fixture" },
    paneId: `%${over.id.slice(1)}`,
    name: over.id,
    execution: { kind: "unknown", cause: "not-reported", why: "the fixture carried no execution reading" },
    title: null,
    repo: null,
    worktree: null,
    startedAt: new Date("2026-09-10T00:00:00Z").toISOString(),
    status,
    question: null,
    permissionMode: { kind: "cannot-tell", why: "the fixture did not say" },
    pause: { kind: "cannot-tell", why: "the fixture did not say", cause: "rate-limits-not-collected" },
    meta: { version: "legacy" },
    role: { kind: "none" },
    panePid: 5151,
    claudeSessionId: "conv-envelope-client",
    rawStatus: status,
    rawQuestion: null,
    ...over,
  };
}

/** A receipt as the server sends it — every field, the way `summarizeReceipt` writes one. */
function receiptWire(over: Partial<ReceiptSummary> = {}): ReceiptSummary {
  return {
    receiptId: "f1f1f1f1-r7",
    op: "steer-message",
    origin: "direct-steer",
    pending: false,
    actor: { kind: "client-claimed", id: "greg" },
    speaker: "greg",
    target: { sessionId: "$61", paneId: "%61", claudeSessionId: "conv-envelope-client", tmuxGeneration: null },
    parentReceiptId: null,
    stepsCompleted: null,
    what: "message (9 characters)",
    acceptedAt: NOW - 5_000,
    state: "keys-submitted",
    reason: "transport-ok",
    attemptedAt: NOW - 4_900,
    outcomeAt: NOW - 4_800,
    reconciled: false,
    reconciliation: null,
    queueItemId: null,
    materialDeletionPending: false,
    ...over,
  };
}

type Scripted = "lose" | { status: number; body: unknown } | { status: number; raw: string };

/** A `fetch` that answers from a script and remembers exactly what was posted, byte for byte. */
function scripted(answers: Scripted[]): { impl: typeof fetch; seen: { url: string; body: string }[] } {
  const seen: { url: string; body: string }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), body: String(init?.body) });
    const next = answers.shift();
    if (next === undefined) throw new Error("the script ran out of answers");
    if (next === "lose") throw new TypeError("Failed to fetch");
    const text = "raw" in next ? next.raw : JSON.stringify(next.body);
    return new Response(text, { status: next.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, seen };
}

const REPLAY = { status: 200, body: { ok: true, op: "receipt", replay: true, receipt: receiptWire() } };

/**
 * The three keyed writes a composer makes, each as "build an envelope, send it
 * through a client over this fetch". `ordinary` is what that route says when it
 * did the thing — which must come back as the client's ordinary answer.
 */
type Case = {
  name: string;
  route: string;
  send: (impl: typeof fetch, envelope: RequestEnvelope<object, null>) => Promise<KeyedOutcome<unknown>>;
  envelope: () => RequestEnvelope<object, null>;
  ordinary: { status: number; body: unknown };
  isOrdinarySuccess: (outcome: unknown) => boolean;
};

const ROW = row({ id: "$61" });

const CASES: Case[] = [
  {
    name: "a steer message",
    route: "api/steer/message",
    envelope: () => messageEnvelope(ROW, "carry on", null, { now: NOW }),
    send: (impl, envelope) =>
      makeSteerApi(impl).keyed.message(envelope as ReturnType<typeof messageEnvelope<null>>),
    ordinary: { status: 200, body: { ok: true, op: "message", sent: [["send-keys"]], verified: null, receiptId: "x" } },
    isOrdinarySuccess: (o) => (o as SteerOutcome).ok === true,
  },
  {
    name: "a queued message",
    route: "api/actions/session",
    envelope: () => queueMessageEnvelope(ROW, "carry on", null, { now: NOW }),
    send: (impl, envelope) =>
      makeActionsApi(impl).keyed.queueMessage(envelope as ReturnType<typeof queueMessageEnvelope<null>>),
    ordinary: { status: 200, body: { ok: true, op: "enqueued", item: { id: "q1" }, position: 1, durable: true } },
    isOrdinarySuccess: (o) => (o as ActionOutcome).ok === true && (o as { kind: string }).kind === "queued",
  },
  {
    name: "a broadcast run",
    route: "api/broadcast",
    envelope: () => broadcastEnvelope([ROW, row({ id: "$62" })], "ease off", null, { now: NOW }),
    send: (impl, envelope) =>
      makeBroadcastApi(impl).keyed.run(envelope as ReturnType<typeof broadcastEnvelope<null>>),
    ordinary: {
      status: 200,
      body: {
        ok: true,
        op: "broadcast",
        result: { counts: { asked: 2, submitted: 2, queued: 0, skipped: 0, held: 0, notReached: 0 }, recipients: [] },
      },
    },
    isOrdinarySuccess: (o) => (o as BroadcastOutcome).kind === "ran",
  },
];

describe("the request id", () => {
  it("is minted in the server's own format, carrying its mint time", () => {
    const id = mintRequestId({ now: NOW });
    expect(id).toMatch(/^rq-[0-9a-z]+-[a-z0-9]{24}$/);
    expect(id.split("-")[1]).toBe(NOW.toString(36));
    const parsed = parseRequestId(id, NOW);
    expect(parsed).toEqual({ ok: true, mintedAt: NOW });
  });

  it("is random where it should be", () => {
    const ids = new Set(Array.from({ length: 50 }, () => mintRequestId({ now: NOW })));
    expect(ids.size).toBe(50);
    /* A fill that is all one byte still lands inside the alphabet — the
       mapping, not the randomness, is what keeps the id readable. */
    const flat = mintRequestId({ now: NOW, fill: (bytes) => bytes.fill(255) });
    expect(flat).toMatch(/^rq-[0-9a-z]+-[a-z0-9]{24}$/);
  });
});

describe("the envelope", () => {
  it("is immutable, and its bytes are built once", () => {
    const body = { text: "the original words", nested: { speaker: "greg" } };
    const envelope = makeEnvelope("api/steer/message", body, null, { now: NOW });
    expect(JSON.parse(envelope.json)).toEqual({ ...body, requestId: envelope.requestId });

    // The caller's object changing afterwards changes nothing that will be sent.
    body.text = "different words";
    body.nested.speaker = "overseer";
    expect(JSON.parse(envelope.json).text).toBe("the original words");
    expect(envelope.body).toEqual({ text: "the original words", nested: { speaker: "greg" } });
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.body)).toBe(true);
    expect(() => {
      (envelope as { requestId: string }).requestId = "rq-0-aaaaaaaaaaaaaaaaaaaaaaaa";
    }).toThrow();
  });

  it("refuses a body that already names a request id", () => {
    expect(() => makeEnvelope("api/steer/message", { requestId: "rq-1-abc", text: "x" }, null)).toThrow(/requestId/);
  });

  it("carries the ticket it was given, by reference", () => {
    const ticket = { opaque: true };
    expect(makeEnvelope("api/broadcast", { text: "x" }, ticket).ticket).toBe(ticket);
  });
});

describe.each(CASES)("$name, sent as an envelope", (c) => {
  it("a lost response, then Check, resends the same id and byte-identical body to the same route", async () => {
    const { impl, seen } = scripted(["lose", REPLAY]);
    const envelope = c.envelope();

    const first = await c.send(impl, envelope);
    expect(first.kind).toBe("not-confirmed");

    const check = await c.send(impl, envelope);
    expect(check.kind).toBe("replay");

    expect(seen).toHaveLength(2);
    expect(seen[0]?.url).toBe(c.route);
    expect(seen[1]?.url).toBe(c.route);
    expect(seen[1]?.body).toBe(seen[0]?.body);
    expect(JSON.parse(seen[0]?.body ?? "{}").requestId).toBe(envelope.requestId);
  });

  it("a replay is a definitive success carrying the receipt", async () => {
    const { impl } = scripted([REPLAY]);
    const answer = await c.send(impl, c.envelope());
    expect(answer.kind).toBe("replay");
    expect(answer.kind === "replay" && answer.receipt.receiptId).toBe("f1f1f1f1-r7");
  });

  it.each([
    [409, "request-id-conflict"],
    [409, "request-id-expired"],
    [503, "receipt-unavailable"],
  ] as const)("a %i %s is definitive, in the server's own words", async (status, code) => {
    const why = `the server's sentence about ${code}`;
    const { impl } = scripted([{ status, body: { ok: false, code, why } }]);
    const answer = await c.send(impl, c.envelope());
    expect(answer).toEqual({ kind: code, why, status });
  });

  it.each([
    ["a 200 that is not JSON", { status: 200, raw: "<html>proxy</html>" }],
    ["a 200 that is not an answer", { status: 200, body: { hello: "there" } }],
    ["a 200 array", { status: 200, body: [1, 2, 3] }],
    ["a replay whose receipt cannot be read", { status: 200, body: { ok: true, op: "receipt", replay: true, receipt: { receiptId: 1 } } }],
    ["a 502 from something in between", { status: 502, body: {} }],
  ] as const)("%s is not-confirmed, never success", async (_label, answer) => {
    const { impl } = scripted([answer]);
    const outcome = await c.send(impl, c.envelope());
    expect(outcome.kind).toBe("not-confirmed");
  });

  it("an ordinary success is the client's ordinary answer", async () => {
    const { impl } = scripted([c.ordinary]);
    const outcome = await c.send(impl, c.envelope());
    expect(outcome.kind).toBe("answered");
    expect(outcome.kind === "answered" && c.isOrdinarySuccess(outcome.outcome)).toBe(true);
  });

  it("an ordinary refusal is the client's ordinary answer, with the server's sentence", async () => {
    const { impl } = scripted([{ status: 409, body: { ok: false, code: "not-steerable", why: "it is a shell" } }]);
    const outcome = await c.send(impl, c.envelope());
    expect(outcome.kind).toBe("answered");
    expect(JSON.stringify(outcome)).toContain("it is a shell");
  });
});

describe("the other keyed writes", () => {
  it("an answer to a dialog and a session action go out as envelopes too", async () => {
    const answerFetch = scripted([REPLAY]);
    const answer = await makeSteerApi(answerFetch.impl).keyed.answer(answerEnvelope(ROW, 1, null, { now: NOW }));
    expect(answer.kind).toBe("replay");
    expect(answerFetch.seen[0]?.url).toBe("api/steer/answer");
    expect(JSON.parse(answerFetch.seen[0]?.body ?? "{}")).toMatchObject({ optionIndex: 1, requestId: expect.stringMatching(/^rq-/) });

    const runFetch = scripted([REPLAY]);
    const run = await makeActionsApi(runFetch.impl).keyed.run(runEnvelope(ROW, "continue", null, { now: NOW }));
    expect(run.kind).toBe("replay");
    expect(runFetch.seen[0]?.url).toBe("api/actions/session");
    expect(JSON.parse(runFetch.seen[0]?.body ?? "{}")).toMatchObject({ actionId: "continue", requestId: expect.stringMatching(/^rq-/) });
  });

  it("the browser's own instances can send envelopes, so no composer silently falls back to an unkeyed send", () => {
    expect(typeof httpSteerApi.keyed?.message).toBe("function");
    expect(typeof httpSteerApi.keyed?.answer).toBe("function");
    expect(typeof httpActionsApi.keyed?.queueMessage).toBe("function");
    expect(typeof httpActionsApi.keyed?.run).toBe("function");
    expect(typeof httpActionsApi.keyed?.boxConfirm).toBe("function");
    expect(typeof httpBroadcastApi.keyed?.run).toBe("function");
  });

  it("the unkeyed methods are unchanged, and carry no request id", async () => {
    const { impl, seen } = scripted([{ status: 200, body: { ok: true, op: "message", sent: [], verified: null } }]);
    await makeSteerApi(impl).message(ROW, "carry on");
    expect(JSON.parse(seen[0]?.body ?? "{}")).not.toHaveProperty("requestId");
  });
});

describe("reading a receipt off the wire", () => {
  it("reads a whole receipt, and refuses a partial one rather than guessing", () => {
    expect(parseReceiptSummary(receiptWire())).toEqual(receiptWire());
    expect(parseReceiptSummary({ ...receiptWire(), state: "delivered" })).toBeNull();
    const { acceptedAt: _gone, ...partial } = receiptWire();
    expect(parseReceiptSummary(partial)).toBeNull();
  });

  it("reads a server from before reconciliation carried a statement as having none", () => {
    const { reconciliation: _absent, ...older } = receiptWire();
    expect(parseReceiptSummary(older)?.reconciliation).toBeNull();
  });
});
