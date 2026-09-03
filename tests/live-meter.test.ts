/**
 * **The browser half of the live-conversation meter** — src/web/live/meter.ts,
 * Stage 2B of docs/plans/260902g-cost-tracking-that-can-set-a-price.md.
 *
 * The audio of a live conversation is a WebRTC connection from the tab straight
 * to OpenAI, so the `usage` object that says what a turn cost is delivered to
 * client JavaScript and to nothing else. Until this file's subject existed, the
 * browser received those numbers every turn and dropped them, and the most
 * expensive feature in the app contributed nothing to `npm run cost`.
 *
 * ## The seam is the point, so the seam is what is tested
 *
 * The server's `parseRealtimeUsage` is **imported and run**, not mocked. It is
 * strict on purpose — every detail field required, no defaults for absent
 * counts — so the failure it is designed to produce is a loud 400 rather than a
 * row priced at nothing. A test that asserted against a hand-copied idea of that
 * shape would agree with a client that the real server refuses, which is the
 * whole class of bug the two-sided check exists to catch.
 *
 * ## The three silent failures underneath
 *
 * 1. **A turn whose modality split is missing, reported with zeros in it.** The
 *    parser accepts it — the details are checked as `<=` their parents — and it
 *    prices at approximately nothing. Twenty cents of audio lands in the ledger
 *    as free with nothing going red.
 * 2. **Transcription reported per token when it is billed per minute.**
 *    `gpt-live-transcribe` has one rate and it is per audio minute, so a report
 *    without seconds cannot be priced at all.
 * 3. **A refused report retried for ever.** A 400 is the server saying *stop*;
 *    a queue that treated it as a network failure could never drain.
 */
import { describe, expect, it, vi } from "vitest";

import {
  acceptRealtimeUsage,
  LIVE_MODEL,
  LIVE_TRANSCRIBER,
  parseRealtimeUsage,
  REPORT_WINDOW_MS,
  type RealtimeUsage,
} from "../src/live.js";
import type { RealtimeSession } from "../src/store/contracts.js";
import {
  LiveMeter,
  responseReport,
  transcriptionReport,
  type LiveUsageReport,
  type MeterTransport,
  type PostOutcome,
} from "../src/web/live/meter.js";

const STARTED = "2026-09-02T10:04:58.000Z";
const FINISHED = "2026-09-02T10:05:00.000Z";
const TIMES = { startedAt: STARTED, finishedAt: FINISHED };

/**
 * A `response.done` event as OpenAI sends it — the exact shape from
 * docs/research/realtime-voice-cost-tracking-web.md § 1, `cached_tokens_details`
 * included, because that is the field hand-rolled types tend to drop
 * (openai-node#1600) and it is the one that says how much of the cache saving
 * landed on the expensive modality.
 */
function responseDone(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "response.done",
    response: {
      id: "resp_abc123",
      status: "completed",
      output: [],
      usage: {
        total_tokens: 253,
        input_tokens: 132,
        output_tokens: 121,
        input_token_details: {
          text_tokens: 119,
          audio_tokens: 13,
          image_tokens: 0,
          cached_tokens: 64,
          cached_tokens_details: { text_tokens: 60, audio_tokens: 4 },
        },
        output_token_details: { text_tokens: 30, audio_tokens: 91 },
      },
      ...(over.response as Record<string, unknown> | undefined),
    },
  };
}

/** A session row of the kind the server looks up. Nothing is inserted; the ids are minted per run. */
function session(over: Partial<RealtimeSession> = {}): RealtimeSession {
  const issuedAt = "2026-09-02T10:00:00.000Z";
  return {
    id: crypto.randomUUID(),
    ownerId: crypto.randomUUID(),
    articleSlug: "why-trees",
    threadId: "spya-vaaaaa",
    model: LIVE_MODEL,
    transcriptionModel: LIVE_TRANSCRIBER,
    issuedAt,
    acceptsUntil: new Date(Date.parse(issuedAt) + REPORT_WINDOW_MS).toISOString(),
    connectedAt: null,
    closedAt: null,
    closeReason: null,
    ...over,
  };
}

describe("what the browser builds from response.done", () => {
  it("is a report the server's own parser accepts, field for field", () => {
    /* **The seam.** `parseRealtimeUsage` is the real one, and it requires every
       detail explicitly — a client that guessed a field name would be a 400 on
       every turn of every conversation, which is the failure this asserts
       against rather than describes. */
    const built = responseReport(responseDone(), TIMES);
    expect(built).not.toBeNull();
    const parsed = parseRealtimeUsage(built);

    expect(parsed).toEqual({
      kind: "response",
      providerEventId: "resp_abc123",
      status: "completed",
      startedAt: STARTED,
      finishedAt: FINISHED,
      inputTokens: 132,
      outputTokens: 121,
      inputTextTokens: 119,
      inputAudioTokens: 13,
      inputImageTokens: 0,
      cachedTokens: 64,
      /* The split that openai-node dropped for a while. Audio in is $32/Mtok
         against $4 for text, so which modality the cache saving landed on is
         most of the arithmetic. */
      cachedTextTokens: 60,
      cachedAudioTokens: 4,
      outputTextTokens: 30,
      outputAudioTokens: 91,
    });
  });

  it("prices to something, through the server's own acceptance", () => {
    /* Not a re-test of the pricing — that is tests/realtime-usage.test.ts. This
       is the end of the client's own claim: the numbers it collected survive
       into a row with money on it. A report that parsed and priced at zero
       would pass every assertion above. */
    const row = acceptRealtimeUsage({
      session: session(),
      usage: parseRealtimeUsage(responseReport(responseDone(), TIMES)),
      receivedAt: new Date(FINISHED),
    });
    expect(row.costSource).toBe("computed");
    expect(row.computedCostNanos ?? 0).toBeGreaterThan(0);
    expect(row.durationMs).toBe(2_000);
  });

  it("keeps the four statuses, so a turn the reader talked over is still billed", () => {
    /* A cancelled response is the reader interrupting, which is normal in a
       spoken conversation and is **not** free: OpenAI reports the usage it
       billed on the terminal event whatever the status. A meter that only
       reported `completed` would lose exactly the turns that a lively
       conversation is made of. */
    for (const status of ["completed", "cancelled", "failed", "incomplete"] as const) {
      const built = responseReport(responseDone({ response: { status } }), TIMES);
      expect(parseRealtimeUsage(built)).toMatchObject({ status });
    }
  });

  it("reports nothing at all when the modality split is missing", () => {
    /* **The silent one.** openai/openai-agents-js#538: `response.done` arriving
       with the totals and no `input_token_details`. Filling the gaps with zeros
       produces a report the parser accepts — the details are checked as `<=`
       their parents — and every rate is then applied to zero, so a turn that
       cost real money lands in the ledger as free. Not reporting it is the
       honest answer; the hook counts it and says so in the console. */
    const stripped = responseDone();
    const usage = (stripped.response as Record<string, unknown>).usage as Record<string, unknown>;
    delete usage.input_token_details;
    expect(responseReport(stripped, TIMES)).toBeNull();

    /* And the proof of what happens if one is built anyway — by a future edit
       here, or by anything else that can reach the endpoint. A zero-filled
       report is still *accepted*: the turn happened and the totals are true, so
       refusing the row would throw the evidence away. What it is not is
       **priced**. Until 2026-09-03 it was, at exactly `$0`, and a twenty-cent
       turn sat in the ledger as free with nothing red anywhere — GPT Sol's
       finding. The defence is now in both places, which is the right number of
       places for it: this file decides what a browser sends, and src/live.ts
       decides what the ledger will claim. */
    const zeroFilled = {
      kind: "response",
      providerEventId: "resp_abc123",
      status: "completed",
      startedAt: STARTED,
      finishedAt: FINISHED,
      inputTokens: 132,
      outputTokens: 121,
      inputTextTokens: 0,
      inputAudioTokens: 0,
      inputImageTokens: 0,
      cachedTokens: 0,
      cachedTextTokens: 0,
      cachedAudioTokens: 0,
      outputTextTokens: 0,
      outputAudioTokens: 0,
    };
    const row = acceptRealtimeUsage({
      session: session(),
      usage: parseRealtimeUsage(zeroFilled),
      receivedAt: new Date(FINISHED),
    });
    expect(row.costSource).toBe("none");
    expect(row.computedCostNanos).toBeNull();
    /* The counts survive, so the row can be priced later from the totals or
       taken to OpenAI — which is the whole reason it is kept. */
    expect(row.reportedInputTokens).toBe(132);
    expect(row.outputTokens).toBe(121);
  });

  it("treats an absent cache split as no cache, which can only overcharge us", () => {
    /* The one place a missing count is filled in, and the argument is the
       direction of the error: cached input is a tenth of the fresh rate, so
       reading an absent cached count as zero prices that input *up*. The parent
       count still travels on the row for anyone auditing it. */
    const noSplit = responseDone();
    const details = (
      (noSplit.response as Record<string, unknown>).usage as Record<string, unknown>
    ).input_token_details as Record<string, unknown>;
    delete details.cached_tokens_details;

    const built = parseRealtimeUsage(responseReport(noSplit, TIMES));
    expect(built).toMatchObject({ cachedTokens: 64, cachedTextTokens: 0, cachedAudioTokens: 0 });

    const dearer = acceptRealtimeUsage({
      session: session(),
      usage: built,
      receivedAt: new Date(FINISHED),
    });
    const withSplit = acceptRealtimeUsage({
      session: session(),
      usage: parseRealtimeUsage(responseReport(responseDone(), TIMES)),
      receivedAt: new Date(FINISHED),
    });
    expect(dearer.computedCostNanos ?? 0).toBeGreaterThan(withSplit.computedCostNanos ?? 0);
  });

  it("says nothing rather than guessing when the event is not a priceable turn", () => {
    for (const broken of [
      responseDone({ response: { usage: undefined } }),
      responseDone({ response: { id: "" } }),
      responseDone({ response: { status: "in_progress" } }),
      { type: "response.done" },
    ]) {
      expect(responseReport(broken, TIMES)).toBeNull();
    }
  });

  it("carries the start time it observed, and null when it observed none", () => {
    /* Realtime events have no timestamps of their own, so `response.created` is
       the only start there is. Null rather than a substitute: `duration_ms` is
       nullable on the row precisely so that an unobserved start is not recorded
       as an instant call or as the length of the whole conversation. */
    const built = parseRealtimeUsage(
      responseReport(responseDone(), { startedAt: null, finishedAt: FINISHED }),
    );
    expect(built.startedAt).toBeNull();
    const row = acceptRealtimeUsage({
      session: session(),
      usage: built,
      receivedAt: new Date(FINISHED),
    });
    expect(row.durationMs).toBeNull();
  });
});

describe("the transcription, which is a second bill on its own event", () => {
  /** The completed event, with the `duration` shape of `usage`. */
  const completed = (usage: unknown): Record<string, unknown> => ({
    type: "conversation.item.input_audio_transcription.completed",
    event_id: "event_delivered_now",
    item_id: "item_xyz789",
    transcript: "what did the author mean by that",
    usage,
  });

  it("is reported in seconds, and the server prices it per minute", () => {
    /* `gpt-live-transcribe` is billed per audio minute — $0.017 of it — and it
       is reported on this event, not on `response.done`. A meter that watched
       only the answer would price half of live conversation at nothing, which
       is why the report is a discriminated union rather than tokens with an
       optional `seconds` beside them. */
    const built = transcriptionReport(completed({ type: "duration", seconds: 3.5 }), {
      startedAt: null,
      finishedAt: FINISHED,
    });
    const parsed = parseRealtimeUsage(built);
    expect(parsed).toEqual({
      kind: "transcription",
      providerEventId: "item_xyz789",
      startedAt: null,
      finishedAt: FINISHED,
      audioSeconds: 3.5,
    });

    const row = acceptRealtimeUsage({
      session: session(),
      usage: parsed,
      receivedAt: new Date(FINISHED),
    });
    expect(row.requestedModel).toBe(LIVE_TRANSCRIBER);
    expect(row.transcriptionSeconds).toBe(3.5);
    expect(row.computedCostNanos ?? 0).toBeGreaterThan(0);
  });

  it("uses the item id, not the per-delivery event id", () => {
    /* The server derives the row's primary key from `(session, kind, provider
       event id)` so that a retry of a report whose 200 was lost collides rather
       than doubling. `event_id` is minted per delivery, so keying on it would
       write a second row for one cost. */
    const built = transcriptionReport(completed({ type: "duration", seconds: 1 }), {
      startedAt: null,
      finishedAt: FINISHED,
    });
    expect(built).toMatchObject({ providerEventId: "item_xyz789" });
  });

  it("reports nothing when the usage arrives as tokens rather than seconds", () => {
    /* The other shape this event can take. There is no per-token rate for the
       transcriber anywhere in src/pricing.ts, so converting by an invented
       tokens-per-second factor would be a made-up number in a table built to
       hold settled ones. Nothing is sent, the hook counts it, and the console
       line is how we would find out that this is what real sessions send. */
    expect(
      transcriptionReport(completed({ type: "tokens", input_tokens: 40, output_tokens: 8 }), {
        startedAt: null,
        finishedAt: FINISHED,
      }),
    ).toBeNull();
    expect(
      transcriptionReport(completed(undefined), { startedAt: null, finishedAt: FINISHED }),
    ).toBeNull();
  });
});

/**
 * **The client's shape and the server's are the same shape**, checked by the
 * compiler rather than by reading.
 *
 * `LiveUsageReport` is declared in the client because nothing under `src/web/`
 * may import a server module — src/live.ts reaches `node:crypto` and the system
 * prompts, and tests/client-imports.test.ts has the 24KB bundle that proved it.
 * A second declaration is a second thing to keep in step, so both directions of
 * assignability are asserted here: a field added on either side and forgotten on
 * the other fails this file rather than a live session.
 */
const _clientIsServer: RealtimeUsage = {} as LiveUsageReport;
const _serverIsClient: LiveUsageReport = {} as RealtimeUsage;
void _clientIsServer;
void _serverIsClient;

/* ---------- the queue ---------- */

interface Posted {
  kind: "connected" | "usage" | "close";
  sessionId: string;
  keepalive: boolean;
  report?: LiveUsageReport;
  reason?: string | null;
}

/**
 * A transport that answers from a script, so a retry, a refusal and a success
 * can each be arranged rather than waited for.
 */
function fake(script: PostOutcome[] = []) {
  const posted: Posted[] = [];
  const answer = (): PostOutcome => script.shift() ?? "accepted";
  const transport: MeterTransport = {
    async liveConnected(sessionId, keepalive) {
      posted.push({ kind: "connected", sessionId, keepalive });
      return answer();
    },
    async liveUsage(sessionId, report, keepalive) {
      posted.push({ kind: "usage", sessionId, report, keepalive });
      return answer();
    },
    async liveClose(sessionId, reason, keepalive) {
      posted.push({ kind: "close", sessionId, reason, keepalive });
      return answer();
    },
  };
  return { posted, transport };
}

/** Let the queue's promises and its zero-length backoff timers run. */
const settle = () => new Promise((r) => setTimeout(r, 5));

/**
 * Wait until the queue has nothing left, rather than for a fixed few
 * milliseconds.
 *
 * A retry goes through `setTimeout`, so "long enough" depends on how loaded the
 * machine is — and a fixed wait that is usually long enough is a test that fails
 * in somebody else's run, which is the worst kind. This one is bounded so a
 * queue that never drains still fails rather than hanging.
 */
async function quiet(meter: LiveMeter, ms = 2_000): Promise<void> {
  const until = Date.now() + ms;
  while (meter.status.pending > 0 && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2));
  }
  await settle();
}

const REPORT: LiveUsageReport = {
  kind: "transcription",
  providerEventId: "item_1",
  startedAt: null,
  finishedAt: FINISHED,
  audioSeconds: 2,
};

describe("posting, and the retry queue that lives as long as the tab", () => {
  it("posts each event as it happens rather than one total at the end", async () => {
    /* The failure this design actually has is the tab closing, not a reader
       lying about their token count — docs/project/security-map.md is explicit
       that a signed-in reader is not one of the untrusted parties. Every turn
       posted as it happens is every turn but the last. */
    const { posted, transport } = fake();
    const meter = new LiveMeter({ sessionId: "s1", transport });
    meter.connected();
    meter.report(REPORT);
    await quiet(meter);
    expect(posted.map((p) => p.kind)).toEqual(["connected", "usage"]);
    expect(posted.every((p) => p.keepalive)).toBe(false);
    expect(meter.status).toMatchObject({ accepted: 2, pending: 0 });
  });

  it("retries what did not arrive, and stops retrying what was refused", async () => {
    /* The distinction is the whole decision table. A 5xx or a dead network is
       the request not having arrived; a 400 is the server having read the
       report and said no — `badReport` in src/live.ts is explicit that such a
       report *must* stop being retried, because a queue that kept it could
       never drain. */
    const { posted, transport } = fake(["retry", "accepted", "refused"]);
    const meter = new LiveMeter({ sessionId: "s1", transport, delays: [0, 0] });
    meter.report(REPORT);
    await quiet(meter);
    expect(posted).toHaveLength(2);
    expect(meter.status).toMatchObject({ accepted: 1, pending: 0 });

    meter.report({ ...REPORT, providerEventId: "item_2" });
    await quiet(meter);
    expect(posted).toHaveLength(3);
    expect(meter.status).toMatchObject({ refused: 1, pending: 0 });
  });

  it("gives up on an event that will not go, rather than blocking the ones behind it", async () => {
    /* One outstanding request at a time is what makes a dead server cost one
       request rather than one per turn — but head-of-line means an item that
       can never succeed would hold every later report for the rest of the
       session. So the attempts run out, it is dropped and counted. */
    const { posted, transport } = fake(["retry", "retry", "retry"]);
    const meter = new LiveMeter({ sessionId: "s1", transport, delays: [0, 0] });
    meter.report(REPORT);
    meter.report({ ...REPORT, providerEventId: "item_2" });
    await quiet(meter);
    expect(meter.status).toMatchObject({ dropped: 1, accepted: 1, pending: 0 });
    expect(posted.at(-1)?.report).toMatchObject({ providerEventId: "item_2" });
  });

  it("holds a new report behind a pending backoff instead of hammering", async () => {
    /* Reports keep arriving while the server is down, and a queue that started
       a fresh attempt on each one would post as fast as the conversation
       spoke — which is the traffic the backoff exists to prevent. */
    const { posted, transport } = fake(["retry"]);
    const meter = new LiveMeter({ sessionId: "s1", transport, delays: [60_000] });
    meter.report(REPORT);
    await settle();
    expect(posted).toHaveLength(1);
    meter.report({ ...REPORT, providerEventId: "item_2" });
    await settle();
    expect(posted, "a new report jumped the backoff").toHaveLength(1);
    expect(meter.status.pending).toBe(2);
  });

  it("makes one last keepalive attempt on teardown, and then stops for good", async () => {
    /* `keepalive` is a hint and never the path: a browser allows a small budget
       during unload and says nothing about whether any of it arrived. What
       makes the meter work is that every earlier turn was already posted. */
    const { posted, transport } = fake(["retry", "accepted", "accepted"]);
    const meter = new LiveMeter({ sessionId: "s1", transport, delays: [60_000] });
    meter.report(REPORT);
    await settle();
    expect(posted).toHaveLength(1);

    meter.end("reader");
    await meter.flush();
    expect(posted.slice(1).map((p) => p.kind)).toEqual(["usage", "close"]);
    expect(posted.slice(1).every((p) => p.keepalive)).toBe(true);

    /* Nothing after the flush: there is no tab left to retry in, and a report
       accepted into a queue that will never drain is worse than one refused. */
    meter.report({ ...REPORT, providerEventId: "item_after" });
    await settle();
    expect(posted).toHaveLength(3);
  });

  it("keeps a bounded amount of a broken session in memory", async () => {
    /* A queue this long means the server has been unreachable for minutes. The
       oldest goes, because the newest is the one still arriving — and it is
       counted rather than silent. */
    const { transport } = fake([]);
    const stuck: MeterTransport = { ...transport, liveUsage: async () => "retry" };
    const meter = new LiveMeter({ sessionId: "s1", transport: stuck, delays: [60_000] });
    for (let i = 0; i < 260; i += 1) meter.report({ ...REPORT, providerEventId: `item_${i}` });
    await settle();
    expect(meter.status.pending).toBeLessThanOrEqual(200);
    expect(meter.status.dropped).toBeGreaterThan(0);
  });

  it("counts an event it could not price, so silence and illegibility differ", async () => {
    const { transport } = fake();
    const meter = new LiveMeter({ sessionId: "s1", transport });
    meter.couldNotRead();
    expect(meter.status.unreportable).toBe(1);
  });

  it("never lets an accounting failure reach the conversation", async () => {
    /* The queue is driven from `void drain()` inside a data-channel event
       handler, so a transport that threw would surface as an unhandled
       rejection in the middle of a conversation — a page error the reader can
       see, caused by the ledger. A throw is a `retry` and nothing more. */
    const boom = async (): Promise<PostOutcome> => {
      throw new Error("the network went away");
    };
    const angry: MeterTransport = { liveConnected: boom, liveUsage: boom, liveClose: boom };
    const rejected = vi.fn();
    process.on("unhandledRejection", rejected);
    const meter = new LiveMeter({ sessionId: "s1", transport: angry, delays: [] });
    meter.report(REPORT);
    meter.end("reader");
    await quiet(meter);
    await meter.flush();
    await settle();
    process.off("unhandledRejection", rejected);
    expect(rejected).not.toHaveBeenCalled();
    expect(meter.status.dropped).toBeGreaterThan(0);
  });
});
