/**
 * **What a browser is allowed to say a live conversation cost** —
 * `parseRealtimeUsage` and `acceptRealtimeUsage` in
 * [src/live.ts](../src/live.ts), and the price table behind them in
 * [src/pricing.ts](../src/pricing.ts).
 *
 * This is the trust boundary for the one paid feature whose money is spent on a
 * wire this server never touches. Every other cost row in this repo is written
 * by the gateway that made the call, from a response body it read; a realtime
 * row is written from a *report*, and the report arrives from a tab.
 *
 * ## Why these are unit tests and not route tests
 *
 * Because GPT Sol's review made exactly this point about the endpoint: it is the
 * authenticated accounting boundary, and that *"does not mean all parsing,
 * pricing and persistence should become anonymous inline code in the
 * already-large route dispatcher"*. So the parse, the validation and the pricing
 * are one named pure function each, and this file exercises them with a literal
 * and a `Date` — no HTTP, no database, no clock. The route on top does three
 * things these cannot: find the session for the authenticated owner, hand the
 * row to `costStore`, and answer.
 *
 * ## What each refusal is worth
 *
 * Every one of them **rejects rather than clamps**. That is the whole design
 * rule and it is worth the sentence: a clamped number is a plausible number with
 * the evidence removed, and it lands in a table somebody is about to set a price
 * against. docs/reusable/silent-success.md.
 */

import { describe, expect, it } from "vitest";

import {
  acceptRealtimeUsage,
  LIVE_MODEL,
  LIVE_TRANSCRIBER,
  parseRealtimeUsage,
  REALTIME_CONTEXT_TOKENS,
  REALTIME_OUTCOME,
  realtimeCloseReason,
  realtimeRowId,
  REPORT_TOLERANCE_MS,
  REPORT_WINDOW_MS,
} from "../src/live.js";
import { priceRealtimeResponse, priceRealtimeTranscription } from "../src/pricing.js";
import type { RealtimeSession } from "../src/store/contracts.js";

const ISSUED = "2026-09-02T10:00:00.000Z";
/** A moment inside the window, so a test about something else is not about the clock. */
const DURING = new Date("2026-09-02T10:05:00.000Z");

function session(over: Partial<RealtimeSession> = {}): RealtimeSession {
  return {
    id: "00000000-0000-4000-8000-0000000005e1",
    /* Its own owner uuid, claimed by no other suite — tests/fixture-ids.test.ts
       enforces that, because vitest runs files in parallel against one database
       and a shared id means whichever tears down first deletes the other's
       fixture. Nothing here inserts a row at all, and the id is still its own:
       the rule is about the declaration, so that a suite which later starts
       writing does not inherit a collision. */
    ownerId: "00000000-0000-4000-8000-00000000ac0e",
    articleSlug: "why-trees",
    threadId: "spya-vaaaaa",
    model: LIVE_MODEL,
    transcriptionModel: LIVE_TRANSCRIBER,
    issuedAt: ISSUED,
    acceptsUntil: new Date(Date.parse(ISSUED) + REPORT_WINDOW_MS).toISOString(),
    connectedAt: null,
    closedAt: null,
    closeReason: null,
    ...over,
  };
}

/** A well-formed spoken turn: mostly audio in, mostly audio out, some of it cached. */
function response(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "response",
    providerEventId: "resp_abc123",
    status: "completed",
    startedAt: "2026-09-02T10:04:58.000Z",
    finishedAt: "2026-09-02T10:05:00.000Z",
    inputTokens: 1000,
    outputTokens: 200,
    inputTextTokens: 400,
    inputAudioTokens: 600,
    inputImageTokens: 0,
    cachedTokens: 300,
    cachedTextTokens: 250,
    cachedAudioTokens: 50,
    outputTextTokens: 40,
    outputAudioTokens: 160,
    ...over,
  };
}

function transcription(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "transcription",
    providerEventId: "item_xyz789",
    finishedAt: "2026-09-02T10:05:00.000Z",
    audioSeconds: 12.5,
    ...over,
  };
}

/** Parse then accept, which is what the route does. */
function accept(body: Record<string, unknown>, over: Partial<RealtimeSession> = {}) {
  return acceptRealtimeUsage({
    session: session(over),
    usage: parseRealtimeUsage(body),
    receivedAt: DURING,
  });
}

/* --------------------------------------------------------- the shape -- */

describe("reading a usage report off the wire", () => {
  it("takes a well-formed spoken turn", () => {
    const usage = parseRealtimeUsage(response());
    expect(usage.kind).toBe("response");
    if (usage.kind !== "response") throw new Error("unreachable");
    expect(usage.inputAudioTokens).toBe(600);
    expect(usage.cachedAudioTokens).toBe(50);
  });

  it("takes a transcription, which carries seconds and no tokens at all", () => {
    /* **The whole reason the DTO is a discriminated union.**
       `gpt-live-transcribe` is billed per audio MINUTE, so a token-only shape
       could not have priced half the feature — and the version that forgot to
       read an optional `audioSeconds` beside the token counts would have
       compiled and contributed zero. GPT Sol asked for the union by name. */
    const usage = parseRealtimeUsage(transcription());
    expect(usage.kind).toBe("transcription");
    if (usage.kind !== "transcription") throw new Error("unreachable");
    expect(usage.audioSeconds).toBe(12.5);
    /* There is no token field to read, which is the point: the type makes the
       token-only mistake unwritable rather than merely discouraged. */
    expect(usage).not.toHaveProperty("inputTokens");
  });

  it("refuses a report that is neither kind", () => {
    expect(() => parseRealtimeUsage({ kind: "guess" })).toThrow(/kind must be/);
    expect(() => parseRealtimeUsage({})).toThrow(/kind must be/);
  });

  it("refuses a report with no provider event id, because that is the idempotency key", () => {
    /* Without it the row cannot be de-duplicated, and the browser retries what
       it did not see acknowledged — so a missing id is a double count waiting
       for a dropped response. The database refuses it too
       (`ai_calls_realtime_identified`); this is the same rule one layer up,
       where the message can say what is wrong. */
    expect(() => parseRealtimeUsage(response({ providerEventId: "" }))).toThrow(/event id/);
    expect(() => parseRealtimeUsage(response({ providerEventId: 7 }))).toThrow(/event id/);
    expect(() => parseRealtimeUsage(response({ providerEventId: "x".repeat(201) }))).toThrow(
      /event id/,
    );
  });

  it("refuses a status the provider does not use", () => {
    expect(() => parseRealtimeUsage(response({ status: "finished" }))).toThrow(/status must be/);
  });
});

/* -------------------------------------------------------- the counts -- */

describe("the counts, rejected rather than clamped", () => {
  it("refuses a negative count", () => {
    expect(() => parseRealtimeUsage(response({ outputAudioTokens: -1 }))).toThrow(
      /outputAudioTokens/,
    );
  });

  it("refuses a fractional token count", () => {
    /* Tokens are counted, not measured. A `12.5` here is a report built by
       arithmetic somewhere rather than read off an event. */
    expect(() => parseRealtimeUsage(response({ inputTokens: 1000.5 }))).toThrow(/inputTokens/);
  });

  it("refuses a count that is not a number at all", () => {
    expect(() => parseRealtimeUsage(response({ inputTokens: "1000" }))).toThrow(/inputTokens/);
    expect(() => parseRealtimeUsage(response({ inputTokens: Number.NaN }))).toThrow(/inputTokens/);
  });

  it("refuses a turn that claims more input than the model's context", () => {
    expect(() =>
      parseRealtimeUsage(response({ inputTokens: REALTIME_CONTEXT_TOKENS + 1 })),
    ).toThrow(/this model cannot produce/);
  });

  it("refuses a turn that claims more output than the configured maximum", () => {
    expect(() => parseRealtimeUsage(response({ outputTokens: 40_000 }))).toThrow(
      /this model cannot produce/,
    );
  });

  it("refuses a detail bigger than its own parent", () => {
    expect(() => parseRealtimeUsage(response({ inputAudioTokens: 2000 }))).toThrow(
      /inputAudioTokens/,
    );
    expect(() => parseRealtimeUsage(response({ cachedTextTokens: 400 }))).toThrow(
      /cachedTextTokens/,
    );
  });

  it("refuses details that individually fit and together do not", () => {
    /* The one a per-field bound cannot catch, and the shape a fabricated report
       takes: three numbers each inside the parent, adding to twice it. */
    expect(() =>
      parseRealtimeUsage(response({ inputTextTokens: 700, inputAudioTokens: 700 })),
    ).toThrow(/add up to more than inputTokens/);
    expect(() =>
      parseRealtimeUsage(response({ outputTextTokens: 150, outputAudioTokens: 150 })),
    ).toThrow(/add up to more than outputTokens/);
  });

  it("accepts details that add to LESS than their parent — and does not PRICE them", () => {
    /* Deliberately `<=` rather than `===` **at the parse**. OpenAI's own
       responses sometimes arrive with the nested breakdown absent or partial
       (openai/openai-agents-js#538), and refusing a true-but-incomplete report
       to be pedantic about arithmetic would throw away the evidence that the
       turn happened at all.

       But the parse is only half the rule, and the other half was missing until
       2026-09-03: `priceResponseRow` prices the *details* and nothing else, so a
       report whose splits are a lower bound was priced as if the lower bound
       were the whole thing. The row is kept, and it is kept **unpriced** — see
       the incomplete-split cases below. */
    const usage = parseRealtimeUsage(
      response({ inputTextTokens: 10, inputAudioTokens: 10, cachedTokens: 0, cachedTextTokens: 0, cachedAudioTokens: 0 }),
    );
    expect(usage.kind).toBe("response");
  });

  it("refuses more cached text than there was text to cache", () => {
    /* **The bound a per-parent check cannot make.** `cachedTextTokens` is
       checked against `cachedTokens`, and `cachedTokens` against `inputTokens`,
       so nothing in that chain stops a report claiming 1,000 cached text tokens
       against 100 text tokens of input. `priceResponseRow` then subtracts one
       from the other and prices a NEGATIVE quantity of fresh text: GPT Sol
       produced exactly this and got `computedCostNanos = -3,200,000`, which
       would have subtracted $0.0032 from a total somebody is about to set a
       price against. A cached token is a token that was already in the input;
       there cannot be more of them than there were. */
    expect(() =>
      parseRealtimeUsage(
        response({
          inputTextTokens: 100,
          inputAudioTokens: 0,
          cachedTokens: 1000,
          cachedTextTokens: 1000,
          cachedAudioTokens: 0,
        }),
      ),
    ).toThrow(/cachedTextTokens/);
    expect(() =>
      parseRealtimeUsage(
        response({
          inputTextTokens: 0,
          inputAudioTokens: 100,
          cachedTokens: 1000,
          cachedTextTokens: 0,
          cachedAudioTokens: 1000,
        }),
      ),
    ).toThrow(/cachedAudioTokens/);
  });

  it("refuses image tokens, because there is no price for them", () => {
    /* `liveSession` configures no image input, so this can only fire if the
       session builder changed or the report is wrong. Pricing them as text would
       be inventing a rate — src/pricing.ts is emphatic that a model with no
       price is an error and not a zero, and the same is true of a modality. */
    expect(() =>
      /* The other counts come down to leave room, so that this refusal is about
         the image tokens rather than about the details out-summing their
         parent. */
      parseRealtimeUsage(
        response({ inputTextTokens: 395, inputAudioTokens: 600, inputImageTokens: 5 }),
      ),
    ).toThrow(/no price for them/);
  });

  it("refuses negative or non-finite audio seconds", () => {
    expect(() => parseRealtimeUsage(transcription({ audioSeconds: -1 }))).toThrow(/audioSeconds/);
    expect(() => parseRealtimeUsage(transcription({ audioSeconds: Number.POSITIVE_INFINITY }))).toThrow(
      /audioSeconds/,
    );
  });
});

/* --------------------------------------------------------- the clock -- */

describe("the acceptance window, which is the server's clock and not the token's", () => {
  it("accepts a report inside the session's own window", () => {
    expect(accept(response()).computedCostNanos).toBeGreaterThan(0);
  });

  it("accepts a report well after the client secret would have expired", () => {
    /* **The check this whole distinction exists for.** `TOKEN_SECONDS` is ten
       minutes and admits the browser to one connection; the conversation runs
       for twenty. A window built on the token's expiry would have silently
       dropped the second half of every long conversation — which is to say every
       expensive one — and the ledger would have looked healthy. */
    const at = new Date(Date.parse(ISSUED) + 19 * 60_000);
    const row = acceptRealtimeUsage({
      session: session(),
      usage: parseRealtimeUsage(response({ startedAt: null, finishedAt: at.toISOString() })),
      receivedAt: at,
    });
    expect(row.computedCostNanos).toBeGreaterThan(0);
  });

  it("refuses a report after the window plus its tolerance", () => {
    const at = new Date(Date.parse(ISSUED) + REPORT_WINDOW_MS + REPORT_TOLERANCE_MS + 1000);
    expect(() =>
      acceptRealtimeUsage({
        session: session(),
        usage: parseRealtimeUsage(response({ finishedAt: at.toISOString() })),
        receivedAt: at,
      }),
    ).toThrow(/stopped accepting/);
  });

  it("keeps a session's own deadline when the constant changes under it", () => {
    /* `accepts_until` is stored on the row rather than recomputed, so a session
       issued under a tighter rule keeps that rule. This is the readable half of
       that: a session whose stored deadline has passed is refused even though
       the current constant would have allowed it. */
    const at = new Date(Date.parse(ISSUED) + 10 * 60_000);
    const body = response({ startedAt: null, finishedAt: at.toISOString() });
    /* Ten minutes in, and the current twenty-minute constant would allow this. */
    expect(
      acceptRealtimeUsage({ session: session(), usage: parseRealtimeUsage(body), receivedAt: at })
        .computedCostNanos,
    ).toBeGreaterThan(0);
    /* The same report against a session whose stored deadline was one minute is
       refused, because the row's rule outlives the constant. */
    expect(() =>
      acceptRealtimeUsage({
        session: session({ acceptsUntil: new Date(Date.parse(ISSUED) + 60_000).toISOString() }),
        usage: parseRealtimeUsage(body),
        receivedAt: at,
      }),
    ).toThrow(/stopped accepting/);
  });

  it("refuses an event dated before the session that would have made it", () => {
    expect(() =>
      accept(response({ finishedAt: "2026-09-02T09:00:00.000Z", startedAt: null })),
    ).toThrow(/dated before the session/);
  });

  it("refuses an event dated in the future", () => {
    expect(() =>
      accept(response({ finishedAt: "2026-09-02T12:00:00.000Z", startedAt: null })),
    ).toThrow(/dated in the future/);
  });

  it("refuses an event that finished before it started", () => {
    expect(() =>
      accept(
        response({ startedAt: "2026-09-02T10:04:59.000Z", finishedAt: "2026-09-02T10:04:58.000Z" }),
      ),
    ).toThrow(/finished before it started/);
  });

  it("refuses a transcription claiming more audio than the session has been open for", () => {
    /* The one check a server can make on a duration it did not observe: a
       conversation five minutes old cannot contain forty minutes of audio. */
    expect(() => accept(transcription({ audioSeconds: 40 * 60 }))).toThrow(
      /more audio than the session has been open for/,
    );
  });

  it("does NOT impose a cumulative tokens-per-minute ceiling", () => {
    /* **The check deliberately not written**, and the reason is specific to this
       API: the Realtime API rebills the whole conversation context on every
       turn, so cumulative input legitimately outgrows wall-clock by a large
       factor. A rate ceiling would start refusing true reports exactly as a
       conversation got long — which is exactly when it got expensive. GPT Sol
       named this as the check not to write.

       Six seconds into a session, a turn near the model's whole context is
       accepted. */
    const at = new Date(Date.parse(ISSUED) + 6_000);
    const row = acceptRealtimeUsage({
      session: session(),
      usage: parseRealtimeUsage(
        response({
          startedAt: null,
          finishedAt: at.toISOString(),
          inputTokens: 120_000,
          inputTextTokens: 60_000,
          inputAudioTokens: 60_000,
          cachedTokens: 100_000,
          cachedTextTokens: 50_000,
          cachedAudioTokens: 50_000,
        }),
      ),
      receivedAt: at,
    });
    expect(row.reportedInputTokens).toBe(120_000);
  });
});

/* ---------------------------------------------------------- the row -- */

describe("the row it builds", () => {
  it("takes the owner, the article and the model from the session, never the report", () => {
    /* A report that could name its own model could name the cheap one, and one
       that could name its own owner could bill somebody else. All four come from
       the row this server wrote when it minted the token. */
    const row = accept({ ...response(), model: "gpt-realtime-2.1-mini", ownerId: "someone-else" });
    expect(row.ownerId).toBe(session().ownerId);
    expect(row.articleSlug).toBe("why-trees");
    expect(row.requestedModel).toBe(LIVE_MODEL);
  });

  it("never takes a dollar amount from the caller", () => {
    /* The server prices it, from a table it owns. A client-supplied cost is a
       client-supplied invoice, and `costNanos: 0` would be the cheapest lie
       available. The field is not read, so a report carrying one is priced
       exactly as if it had not. */
    const honest = accept(response());
    const claiming = accept({ ...response(), computedCostNanos: 1, costNanos: 0, cost: 0 });
    expect(claiming.computedCostNanos).toBe(honest.computedCostNanos);
    expect(claiming.creditsUsedNanos).toBeNull();
  });

  it("lands on the OpenAI account, which is outside the OpenRouter spend cap", () => {
    const row = accept(response());
    expect(row.providerAccount).toBe("openai");
    expect(row.wire).toBe("realtime");
    expect(row.job).toBe("live_conversation");
  });

  it("is `computed`, never `provider` — nobody settled this figure", () => {
    const row = accept(response());
    expect(row.costSource).toBe("computed");
    expect(row.creditsUsedNanos).toBeNull();
    expect(row.byokUpstreamNanos).toBeNull();
    expect(row.priceVersion).toBe(`${LIVE_MODEL}@1970-01-01`);
  });

  it("keeps the modality splits, which is the whole point of the row shape", () => {
    /* Audio in is $32/Mtok against $4 for text, and audio out $64 against $24. A
       row holding only the totals could be priced once, by whoever wrote it, and
       never repriced or audited. */
    const row = accept(response());
    expect(row.reportedInputTokens).toBe(1000);
    expect(row.inputAudioTokens).toBe(600);
    expect(row.inputTextTokens).toBe(400);
    expect(row.cacheReadTokens).toBe(300);
    expect(row.cachedAudioTokens).toBe(50);
    expect(row.outputAudioTokens).toBe(160);
  });

  it("keeps event time and receipt time apart", () => {
    /* `started_at`/`finished_at` are the event's own times; `created_at` defaults
       to now in the database and is when the report arrived. A late report that
       crossed a billing period boundary has to be countable in the period it
       belongs to, which is the case the Stripe work was warned about. */
    const row = accept(response());
    expect(row.startedAt).toBe("2026-09-02T10:04:58.000Z");
    expect(row.finishedAt).toBe("2026-09-02T10:05:00.000Z");
    expect(row.durationMs).toBe(2000);
  });

  it("leaves duration null rather than zero when the start was not observed", () => {
    /* **Never a zero and never the session's wall-clock.** A zero reads as an
       instant call and drags a latency figure down; the session's own duration
       is the length of a conversation rather than of a call, which is the
       substitution GPT Sol's review named. A transcription has no start event at
       all, which is why the column had to become nullable. */
    const row = accept(transcription());
    expect(row.durationMs).toBeNull();
    expect(row.startedAt).toBe(row.finishedAt);
    expect(row.transcriptionSeconds).toBe(12.5);
    expect(row.requestedModel).toBe(LIVE_TRANSCRIBER);
  });

  it("maps the four provider statuses onto three outcomes, keeping the original", () => {
    /* Lossy on purpose: `outcome` has to mean the same thing on every wire, so
       the realtime vocabulary is kept verbatim beside it rather than widening a
       union that nine thousand other rows can never take. */
    expect(REALTIME_OUTCOME).toEqual({
      completed: "ok",
      failed: "error",
      cancelled: "aborted",
      incomplete: "aborted",
    });
    for (const status of ["completed", "cancelled", "failed", "incomplete"] as const) {
      const row = accept(response({ status }));
      expect(row.providerStatus).toBe(status);
      expect(row.outcome).toBe(REALTIME_OUTCOME[status]);
      /* **And the cost is still recorded**, which is the part that is easy to get
         wrong: OpenAI reports the usage it billed on the terminal event whatever
         the status, so a cancelled turn's figure is complete even though its
         answer was not. */
      expect(row.computedCostNanos).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------- a split that cannot be priced -- */

describe("a report the price table cannot fully account for", () => {
  /**
   * **The failure this whole workstream exists to prevent, found in its newest
   * code.** GPT Sol's review, 2026-09-03: the parse permits the modality details
   * to sum to *less* than their parent totals, and `priceResponseRow` prices
   * only the details — so a turn whose splits are missing is priced at
   * approximately nothing and lands in the ledger as a real, settled, cheap row.
   *
   * A zero cost and a free call are the same row, which is the exact confusion
   * src/pricing.ts spends four paragraphs refusing. So the row is kept — the
   * turn happened and the evidence should survive — and it is marked
   * `cost_source: 'none'`, which `npm run cost` already counts and prints as
   * "short by an unknown amount".
   */
  it("does not price a turn whose input splits do not account for the input", () => {
    /* Sol's first case verbatim: `inputTokens=1000`, `outputTokens=200`, every
       modality detail zero. It was accepted with `computedCostNanos = 0`. */
    const row = accept(
      response({
        inputTokens: 1000,
        outputTokens: 200,
        inputTextTokens: 0,
        inputAudioTokens: 0,
        cachedTokens: 0,
        cachedTextTokens: 0,
        cachedAudioTokens: 0,
        outputTextTokens: 0,
        outputAudioTokens: 0,
      }),
    );
    expect(row.costSource).toBe("none");
    expect(row.computedCostNanos).toBeNull();
    expect(row.priceVersion).toBeNull();
    /* **And the counts still travel**, which is what makes the row worth
       keeping: somebody can price it later from the totals, or ask OpenAI. */
    expect(row.reportedInputTokens).toBe(1000);
    expect(row.outputTokens).toBe(200);
  });

  it("does not price a turn whose output splits do not account for the output", () => {
    const row = accept(response({ outputTextTokens: 0, outputAudioTokens: 0 }));
    expect(row.costSource).toBe("none");
    expect(row.computedCostNanos).toBeNull();
  });

  it("still prices a turn whose CACHED split is short, because that errs upward", () => {
    /* The one incompleteness that is safe, and the reason this is not a blanket
       "every split must be exact" rule. An absent cached split prices that input
       at the FRESH rate, which is ten times the cached one — so the error is
       against us, and `cached_tokens` is still on the row for anyone auditing
       it. src/web/live/meter.ts argues the same case from the browser's end. */
    const row = accept(
      response({ cachedTokens: 300, cachedTextTokens: 0, cachedAudioTokens: 0 }),
    );
    expect(row.costSource).toBe("computed");
    /* 400 text in at $4/Mtok + 600 audio in at $32/Mtok + 40 text out at $24
       + 160 audio out at $64 = $0.0016 + $0.0192 + $0.00096 + $0.01024. */
    expect(row.computedCostNanos).toBe(32_000_000);
  });

  it("never lets a priced row carry a negative figure", () => {
    /* The property rather than a case: whatever the report says, a row that
       reaches the ledger claiming a cost claims a non-negative one. The database
       holds the same rule as `ai_calls_costs_not_negative`, because a negative
       here is subtracted from a total somebody sets a price against. */
    for (const over of [
      {},
      { cachedTokens: 1000, cachedTextTokens: 400, cachedAudioTokens: 600 },
      { inputTextTokens: 0, inputAudioTokens: 1000, cachedTokens: 0, cachedTextTokens: 0, cachedAudioTokens: 0 },
    ]) {
      const row = accept(response(over));
      expect(row.computedCostNanos ?? 0).toBeGreaterThanOrEqual(0);
    }
  });
});

/* -------------------------------------------------- idempotency -- */

describe("the derived row id", () => {
  it("is the same for the same event, so a retry cannot double-count", () => {
    /* The browser retries whatever it did not see acknowledged, so a request
       that succeeded and whose 200 was lost is the ordinary case. The row's
       primary key is derived from the event, so the repeat lands on
       `on conflict do nothing` rather than becoming a second row. */
    expect(accept(response()).id).toBe(accept(response()).id);
  });

  it("differs per session, per kind and per event", () => {
    const base = accept(response()).id;
    expect(accept(response({ providerEventId: "resp_other" })).id).not.toBe(base);
    expect(accept(transcription({ providerEventId: "resp_abc123" })).id).not.toBe(base);
    expect(
      accept(response(), { id: "00000000-0000-4000-8000-0000000005e2" }).id,
    ).not.toBe(base);
  });

  it("cannot be confused by a component that contains the separator", () => {
    /* A separator that can appear inside either part is not a separator. These
       two differ only in where the boundary falls, and must not collide. */
    expect(realtimeRowId("a", "response", "b-c")).not.toBe(realtimeRowId("a-b", "response", "c"));
  });

  it("is a syntactically valid UUID, because the column is `uuid`", () => {
    /* Version 8 — the one RFC 9562 reserves for application-defined bits. Not
       v4, which would claim a randomness these bits do not have. */
    expect(accept(response()).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

/* ------------------------------------------------------- the prices -- */

describe("what the price table says", () => {
  it("prices a minute of generated speech at the published audio rate", () => {
    /* 1,200,000 audio output tokens at $64/Mtok is $76.80 — the arithmetic
       checked against the number rather than against itself. (A minute of
       generated speech is roughly 1,200 tokens, so this is a thousand minutes.) */
    const priced = priceRealtimeResponse(
      LIVE_MODEL,
      {
        freshTextTokens: 0,
        freshAudioTokens: 0,
        cachedTextTokens: 0,
        cachedAudioTokens: 0,
        outputTextTokens: 0,
        outputAudioTokens: 1_200_000,
      },
      DURING,
    );
    expect(priced?.totalNanos).toBe(76_800_000_000);
  });

  it("prices cached audio eighty times cheaper than fresh, which is why the split exists", () => {
    const fresh = priceRealtimeResponse(
      LIVE_MODEL,
      { freshTextTokens: 0, freshAudioTokens: 1_000_000, cachedTextTokens: 0, cachedAudioTokens: 0, outputTextTokens: 0, outputAudioTokens: 0 },
      DURING,
    );
    const cached = priceRealtimeResponse(
      LIVE_MODEL,
      { freshTextTokens: 0, freshAudioTokens: 0, cachedTextTokens: 0, cachedAudioTokens: 1_000_000, outputTextTokens: 0, outputAudioTokens: 0 },
      DURING,
    );
    expect(fresh?.totalNanos).toBe(32_000_000_000);
    expect(cached?.totalNanos).toBe(400_000_000);
  });

  it("splits into parts that sum to the total", () => {
    /* `PricedCall` promises this, and the promise is what stops the cached
       tokens being counted twice — once as input and once as a cache read. */
    const priced = priceRealtimeResponse(
      LIVE_MODEL,
      { freshTextTokens: 150, freshAudioTokens: 550, cachedTextTokens: 250, cachedAudioTokens: 50, outputTextTokens: 40, outputAudioTokens: 160 },
      DURING,
    );
    if (!priced) throw new Error("unpriced");
    expect(priced.inputNanos + priced.outputNanos + priced.cacheWriteNanos + priced.cacheReadNanos).toBe(
      priced.totalNanos,
    );
  });

  it("prices transcription by the minute, which no token count could have done", () => {
    /* $0.017 per audio minute. Sixty seconds is exactly that. */
    expect(priceRealtimeTranscription(LIVE_TRANSCRIBER, 60, DURING)?.totalNanos).toBe(17_000_000);
    expect(priceRealtimeTranscription(LIVE_TRANSCRIBER, 30, DURING)?.totalNanos).toBe(8_500_000);
  });

  it("says `none` rather than zero for a model it has no row for", () => {
    /* A missing price must never be able to look like a cheap call — the failure
       src/pricing.ts's header spends four paragraphs on, with `voyage-4` as the
       worked example. */
    expect(priceRealtimeResponse("gpt-realtime-99", { freshTextTokens: 1, freshAudioTokens: 0, cachedTextTokens: 0, cachedAudioTokens: 0, outputTextTokens: 0, outputAudioTokens: 0 }, DURING)).toBeNull();
    const row = accept(response(), { model: "gpt-realtime-99" });
    expect(row.costSource).toBe("none");
    expect(row.computedCostNanos).toBeNull();
    expect(row.priceVersion).toBeNull();
    /* And the token counts survive, so the row can be priced later when somebody
       extends the table — which is the difference between "unpriced" and "lost". */
    expect(row.outputAudioTokens).toBe(160);
  });
});

/* -------------------------------------------------------- the close -- */

describe("the close reason", () => {
  it("takes the browser's own word for it", () => {
    expect(realtimeCloseReason("session_cap")).toBe("session_cap");
  });

  it("treats nothing as nothing", () => {
    expect(realtimeCloseReason(undefined)).toBeNull();
    expect(realtimeCloseReason("")).toBeNull();
  });

  it("refuses anything long enough to be a payload rather than a reason", () => {
    /* The bound matches the CHECK on the column, so the two cannot disagree
       about what fits. A closed union was the alternative and was rejected: the
       list of reasons belongs to useLiveConversation.ts, and a server-side copy
       that lagged it would refuse a true report about how a conversation ended. */
    expect(() => realtimeCloseReason("x".repeat(65))).toThrow(/short string/);
    expect(() => realtimeCloseReason({ why: "no" })).toThrow(/short string/);
  });
});
