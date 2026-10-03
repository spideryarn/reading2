/**
 * **The three endpoints a live conversation reports itself through** —
 * `POST /api/live/:sessionId/connected`, `/usage` and `/close`, and the session
 * row `POST /api/chat/:slug/:threadId/live` writes before it hands over a token.
 *
 * The arithmetic and the validation are unit-tested in
 * [realtime-usage.test.ts](realtime-usage.test.ts), against pure functions. What
 * is left for this file is everything only the route can be wrong about:
 *
 * - **the order at the ticket** — OpenAI mints, we journal, and only then does
 *   the token go out. A token released without a row is money that can be spent
 *   on a wire this server never sees, with nothing anywhere that could later say
 *   a conversation had happened;
 * - **the session is looked up for the authenticated owner**, so a session id
 *   that leaked cannot be reported against by somebody else;
 * - **a retried report does not become a second row**, which is the direction a
 *   ledger is wrong in that looks exactly like the thing being measured;
 * - **and the deployable end state of this stage**: an issued session that never
 *   reports is a session that reported nothing, rather than an error or an
 *   absence.
 *
 * ## The journal moved to Postgres on 2026-09-04
 *
 * This file used to say *"No database. `SPIDERYARN_STORE` is unset here"*, and
 * pointed `SPIDERYARN_REALTIME_JOURNAL` at a JSON file in a temp directory. So
 * the sentence at the top of this header — *the ticket writes the row before the
 * token goes out* — was being asserted about **a file nothing in production
 * reads**, on the store that does not deploy
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § B).
 * One article is now seeded under this slug, and every read-back goes through
 * `realtimeSessionStore` — the same object `src/routes.ts` holds.
 *
 * **What the move bought, and it is more than tidiness.** The Postgres `issue`
 * resolves `article_slug` to an `article_id` and writes a row under a real
 * `auth.users` owner; `find` filters on the owner *in the query*; `markConnected`
 * and `close` are conditional `UPDATE`s with `is null` guards doing the
 * earliest-wins and first-close-wins work that the filesystem adapter did in
 * JavaScript over an object it had just read. Every one of those can now be
 * wrong in a way a file could not be.
 *
 * **The ledger moved too, on 2026-09-05, and this file was one of two that
 * noticed.** Until stage C `selected()` in src/store/ai-calls.ts returned the
 * *filesystem* ledger whenever `NODE_ENV === "test"`, whatever the flag said,
 * because Postgres-mode route suites had once written 4,714 fixture rows into
 * the development ledger. Stage T replaced that defence with a database minted
 * per run, so the redirect went — and with it the JSONL that `ledger()` used to
 * read. It now reads `costStore`, which is the same object `src/routes.ts`
 * holds, and the rows land in this run's private database.
 *
 * That is not a rename. The two-lines-collapse-to-one assertion below was about
 * an append-only file with no unique key, and Postgres has no such half; the
 * comment on it says what survived, what did not, and where the other half is
 * covered now.
 *
 * ## The mutation, watched red on 2026-09-04
 *
 * **Mutation.** `isNull(realtimeSessions.connectedAt)` deleted from
 * `markConnected`'s `where` in src/store/realtime-sessions-pg.ts — the
 * earliest-wins predicate, which is SQL the filesystem adapter has no
 * counterpart for. The run went red on *records the data channel opening, and
 * keeps the first time*, with the two timestamps 14ms apart instead of equal.
 *
 * **Blind to.** One predicate of one statement. The owner condition beside it
 * in the same `where` is untouched — nothing in this file is cross-owner, so
 * deleting `eq(ownerId)` from `markConnected`, from
 * `close` or from `find` leaves every case green, and the second bullet at the
 * top of this header (*the session is looked up for the authenticated owner*) is
 * therefore a claim this file states and does not test.
 *
 * `tests/owner-isolation.test.ts` greps this directory for the unsanctioned
 * spelling, which is a different and weaker guarantee. Nor does the mutation
 * touch `close`'s `is null` first-close-wins guard, its `coalesce` backfill, or
 * `issue`'s slug-to-`article_id` resolution.
 *
 * `fetch` is stubbed, so nothing reaches OpenAI and no key is needed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { IncomingMessage, ServerResponse } from "node:http";

import { and, count, desc, eq } from "drizzle-orm";

import type { AiCallRow } from "../src/ai-spend.js";
import { closeDb, getDb } from "../src/db/client.js";
import { realtimeSessions } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import {
  GPT_LIVE_BACKEND_MODEL,
  GPT_LIVE_CREATE_SECONDS,
  GPT_LIVE_MODEL,
  LIVE_MODEL,
  LIVE_TRANSCRIBER,
} from "../src/live.js";
import { responseReport, transcriptionReport } from "../src/web/live/meter.js";
import { handleApi } from "../src/routes.js";
import { costStore } from "../src/store/ai-calls.js";
import { realtimeSessionStore } from "../src/store/index.js";
import type { RealtimeSession } from "../src/store/contracts.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-live-session-routes";

await pgReady({
  suite: "tests/live-session-routes.test.ts",
  tables: ["spideryarn.articles", "spideryarn.realtime_sessions"],
});

let article: ScratchArticle | undefined;
const realKey = process.env.OPENAI_API_KEY;

/* **No `SPIDERYARN_LEDGER` here since stage C**, and the temp directory that
   held it has gone with it. That variable redirected the *filesystem* adapter,
   which is what `selected()` used to hand back under `NODE_ENV === "test"`; the
   flag is pinned to `postgres` above, so the rows go to the run's own private
   database and the redirect had nothing left to redirect. */
beforeAll(async () => {
  /* `TEST_OWNER`, because `acceptAny` authenticates as that reader and the
     Postgres journal resolves `article_slug` through `ownedSlug` — an article
     seeded as anybody else would leave `article_id` null on every row, which is
     a legitimate state (`articleIdFor` never throws) and so would go unnoticed.
     Seeded **before** the `fetch` stub below is installed: `scratchArticleInPg`
     puts the raw document in the Supabase bucket over HTTP, and a stub that
     catches model calls catches that too. */
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
}, 120_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
}, 60_000);

/** Whether OpenAI answers at all, so a test can drive the failure path. */
let mintFails = false;

/**
 * **OpenAI's GPT-Live create endpoint, stubbed** — and the one place the order
 * of the route's steps can be seen. `seen` records, for each create call, the
 * request body and **the journal row as it stood while the call was in flight**.
 */
const liveCreate: {
  status: number;
  answer: unknown;
  throws: boolean;
  seen: { body: unknown; rowAtCreate: Record<string, unknown> | null }[];
} = { status: 201, answer: null, throws: false, seen: [] };

beforeEach(() => {
  mintFails = false;
  liveCreate.status = 201;
  liveCreate.answer = { session: { id: "live_test_session" }, transport: { type: "webrtc", sdp: "v=0 the answer" } };
  liveCreate.throws = false;
  liveCreate.seen = [];
  process.env.OPENAI_API_KEY = "sk-test";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      if (String(input) === "https://api.openai.com/v1/live/sessions") {
        /* The newest row for this article: the one the route has just
           journalled, if it journalled before asking. */
        const rows = await getDb()
          .select()
          .from(realtimeSessions)
          .where(and(eq(realtimeSessions.ownerId, TEST_OWNER), eq(realtimeSessions.articleSlug, SLUG)))
          .orderBy(desc(realtimeSessions.createdAt))
          .limit(1);
        const newest = rows[0];
        liveCreate.seen.push({
          body: JSON.parse(String(init?.body)),
          /* Only a row not yet touched by a create counts as "this call's". */
          rowAtCreate:
            newest && newest.model === GPT_LIVE_MODEL && newest.providerSessionId === null && newest.closedAt === null
              ? (newest as unknown as Record<string, unknown>)
              : null,
        });
        if (liveCreate.throws) throw new TypeError("fetch failed");
        const ok = liveCreate.status >= 200 && liveCreate.status < 300;
        return {
          ok,
          status: liveCreate.status,
          text: async () => JSON.stringify(liveCreate.answer),
          json: async () => liveCreate.answer,
        } as unknown as Response;
      }
      if (mintFails) {
        return { ok: false, status: 500, text: async () => "nope" } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          value: "ek_test",
          expires_at: 123,
          session: { model: LIVE_MODEL },
        }),
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (realKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = realKey;
});

async function post(
  at: string,
  body: unknown,
  headers: Record<string, string> = AUTHED_HEADERS,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: at, headers },
  ) as unknown as IncomingMessage;

  let written = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    flushHeaders() {},
    on() {},
    write(chunk: string) {
      written += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk) written += chunk;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, acceptAny);
  return {
    status: res.statusCode,
    body: (written ? JSON.parse(written) : {}) as Record<string, unknown>,
  };
}

/** Ask for a ticket, and hand back the session id it journalled. */
async function ticket(threadId: string): Promise<string> {
  const out = await post(`/api/chat/${SLUG}/${threadId}/live`, {});
  expect(out.status).toBe(200);
  return out.body.sessionId as string;
}

/**
 * One session out of the journal, **through the store**.
 *
 * Not a read of `realtime_sessions` with drizzle, and not the JSON file this
 * used to parse: `find` is what the three routes below call, and it carries the
 * owner in the `where` rather than checking it afterwards. Reading the table
 * directly would assert about rows nobody can reach.
 */
const session = (id: string): Promise<RealtimeSession | null> =>
  realtimeSessionStore.find(id, TEST_OWNER);

/**
 * How many rows this article has journalled.
 *
 * A count is the wrong shape for most assertions here — this plan has three
 * separate records of a length standing in for a list — but it is the right one
 * for *nothing was written*, which is the only thing it is used for.
 */
async function journalled(): Promise<number> {
  const rows = await getDb()
    .select({ n: count() })
    .from(realtimeSessions)
    .where(and(eq(realtimeSessions.ownerId, TEST_OWNER), eq(realtimeSessions.articleSlug, SLUG)));
  return rows[0]?.n ?? 0;
}

/**
 * **The ledger rows this session has written, out of the store the route used.**
 *
 * `costStore` and not a file: stage C removed the `NODE_ENV === "test"` redirect
 * from `selected()` in src/store/ai-calls.ts, so a suite that pins the flag to
 * `postgres` — this one does, at the top — now records into the run's private
 * test database. Reading a JSONL here would have found an empty file and the
 * four assertions below would have been asserting about nothing.
 *
 * **Scoped by session id in this helper, not separately by each caller.** The
 * private lane mints one database for the whole run and every earlier file's
 * rows are still in it. `read()` has **no default window** — omitting both
 * bounds means every row in the table (src/store/ai-calls-pg.ts § `read`) — so
 * this fetches the run's whole ledger and filters it in JavaScript. Every
 * question this file asks is about one session, and asking it here keeps all six
 * call sites' answers statements about this suite rather than about whatever ran
 * first.
 *
 * **JavaScript rather than SQL, deliberately for now.** The population is the
 * one run's ledger — 16 rows when stage C measured it — and a `where` here would
 * be a second way of asking a question `read()` already answers. If a lane ever
 * grows a ledger big enough for this to matter, the fix is a bound on `read()`,
 * not a filter that silently reads less than it claims to.
 */
async function ledger(sessionId: string): Promise<AiCallRow[]> {
  const { rows } = await costStore.read();
  return rows.filter((r) => r.realtimeSessionId === sessionId);
}

/** A plausible spoken turn, dated now so the window checks pass. */
function turn(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "response",
    providerEventId: "resp_1",
    status: "completed",
    startedAt: new Date(Date.now() - 2000).toISOString(),
    finishedAt: new Date().toISOString(),
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

/* ------------------------------------------------------- the ticket -- */

describe("the ticket writes the journal row before it releases the token", () => {
  it("hands back a session id, and there is a row behind it", () => {
    return (async () => {
      const id = await ticket("spya-laaaaa");
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      const row = await session(id);
      expect(row).not.toBeNull();
      /* **The model OpenAI created, not the one we asked for.** They agree only
         when the request was honoured, and the price is looked up by this
         string — a row naming a model the session was not on would be priced
         against the wrong rate card for ever. */
      expect(row?.model).toBe(LIVE_MODEL);
      expect(row?.articleSlug).toBe(SLUG);
      /* Issued is not connected. A reader can press the button and change their
         mind, and a denominator built on tickets printed would understate what a
         real conversation costs. */
      expect(row?.connectedAt).toBeNull();
      expect(row?.closedAt).toBeNull();
    })();
  });

  it("accepts reports for longer than the client secret lives", () => {
    /* `TOKEN_SECONDS` is ten minutes and admits the browser to one connection;
       the conversation runs for twenty. The deadline on the row is the server's
       own, and this is the assertion that the two clocks were not confused. */
    return (async () => {
      const id = await ticket("spya-laaaab");
      const row = await session(id);
      const window = Date.parse(String(row?.acceptsUntil)) - Date.parse(String(row?.issuedAt));
      expect(window).toBe(20 * 60_000);
    })();
  });

  it("releases no token when the journal write fails", async () => {
    /* **The order is the rule.** A usable token with no row behind it is spend
       nothing can ever see, so a failure here has to reach the reader as "the
       session could not start" rather than as a working conversation nobody can
       account for.

       **How the failure is provoked changed with the store, and the substitute
       is narrower than what it replaces.** It used to point
       `SPIDERYARN_REALTIME_JOURNAL` at a *directory*, so the real filesystem
       write really did fail — no mock anywhere, the failure travelling the whole
       path. Postgres has no such env var and no equivalent trick that is not
       either destructive (drop the table, in a database other cases are using)
       or a lie (a bad `DATABASE_URL`, which would take the seed down with it).
       So the store's own `issue` is made to reject instead.

       What that costs, said out loud: this is now a test of the *caller's* order
       rather than of an end-to-end failure. It cannot catch an `issue` that
       fails silently — one that swallows its own error and returns — which is
       exactly what the old shape would have caught. `tests/store-realtime-sessions.test.ts`
       is where that half lives now, and it asserts the row is really there.

       The token is genuinely wasted when this happens, and that is the cheaper
       of the two outcomes. */
    const issue = vi
      .spyOn(realtimeSessionStore, "issue")
      .mockRejectedValue(new Error("the journal refused this row"));
    try {
      const out = await post(`/api/chat/${SLUG}/spya-laaaac/live`, {});
      expect(out.status).toBeGreaterThanOrEqual(500);
      expect(out.body).not.toHaveProperty("token");
      /* And the refusal really was the journal's, rather than the route failing
         earlier for a reason of its own and never reaching it. */
      expect(issue).toHaveBeenCalledTimes(1);
    } finally {
      issue.mockRestore();
    }
  });

  it("refuses nothing and journals nothing when OpenAI will not mint", async () => {
    /* The other order check: the session row must not exist for a conversation
       that could never have started. */
    mintFails = true;
    const before = await journalled();
    const out = await post(`/api/chat/${SLUG}/spya-laaaad/live`, {});
    expect(out.status).toBeGreaterThanOrEqual(400);
    expect(await journalled()).toBe(before);
  });
});

/* ------------------------------------------------------- the events -- */

describe("the acceptance endpoints", () => {
  it("records the data channel opening, and keeps the first time", async () => {
    const id = await ticket("spya-lbaaaa");
    expect((await post(`/api/live/${id}/connected`, {})).status).toBe(200);
    const first = (await session(id))?.connectedAt;
    expect(first).toBeTruthy();
    /* Idempotent, and earliest-wins: a usage report backfills this too, in case
       the connected event was lost, and it arrives later by definition. An
       unconditional overwrite would replace the moment the channel opened with
       the moment somebody stopped talking. */
    await post(`/api/live/${id}/connected`, {});
    expect((await session(id))?.connectedAt).toBe(first);
  });

  it("turns a usage report into a priced ledger row", async () => {
    const id = await ticket("spya-lbaaab");
    expect((await post(`/api/live/${id}/usage`, turn())).status).toBe(200);
    const row = (await ledger(id))[0];
    expect(row).toBeDefined();
    expect(row?.wire).toBe("realtime");
    expect(row?.job).toBe("live_conversation");
    expect(row?.providerAccount).toBe("openai");
    expect(row?.costSource).toBe("computed");
    expect(row?.computedCostNanos).toBeGreaterThan(0);
    /* The article comes off the session row rather than off the request, which
       is what makes "what has this piece cost me" include the talking. */
    expect(row?.articleSlug).toBe(SLUG);
    /* And it counts as a connection, because the `connected` event is the one
       thing here that nothing retries. */
    expect((await session(id))?.connectedAt).toBeTruthy();
  });

  it("does not write a second row when the same turn is reported twice", async () => {
    /* The browser retries whatever it did not see acknowledged, so a request
       that succeeded and whose 200 was lost is the ordinary case. Two identical
       posts, one row. */
    const id = await ticket("spya-lbaaac");
    await post(`/api/live/${id}/usage`, turn({ providerEventId: "resp_dup" }));
    await post(`/api/live/${id}/usage`, turn({ providerEventId: "resp_dup" }));
    /* **One row, and now it is the database saying so.** The row's id is derived
       from the event, so the retry collides and Postgres absorbs it on
       `on conflict do nothing`.

       Until stage C this suite wrote to a JSONL, where the same assertion had
       two halves: both lines really were on disk, because that file is
       append-only and has no unique key, and `fsCostStore.read` collapsed them
       by id on the way out. The append-only half has no counterpart here — the
       second insert reaches the unique index and stops. That half is still
       covered, on the store it is a fact about, by *counts a call once however
       many times its line was appended* in tests/store-ai-calls.test.ts.

       The history is worth keeping because of what it caught: until 2026-09-03
       this asserted only that the two copies shared an id, which was true and
       was not enough — `totalRows()` added both, and the test was green through
       it. GPT Sol. */
    expect(await ledger(id)).toHaveLength(1);
  });

  it("refuses a report the server cannot believe, and writes nothing", async () => {
    const id = await ticket("spya-lbaaad");
    /* **This session's rows, not the ledger's length.** Counting the whole
       ledger would have been a statement about the run rather than about the
       refusal, and it would pass on a database nothing had written to. `before`
       is zero here and is read rather than asserted, so the claim stays *this
       request added nothing* rather than *the table is empty*. */
    const before = (await ledger(id)).length;
    const out = await post(`/api/live/${id}/usage`, turn({ outputAudioTokens: 999_999 }));
    expect(out.status).toBe(400);
    expect(await ledger(id)).toHaveLength(before);
  });

  it("refuses a session that does not exist, with a 404 rather than a 403", async () => {
    /* This repo's rule for a thing you may not see — docs/project/auth.md § Whose
       data is it. A 403 would confirm the session is real. */
    const out = await post("/api/live/00000000-0000-4000-8000-00000000dead/usage", turn());
    expect(out.status).toBe(404);
  });

  it("records the close, with the browser's own word for why", async () => {
    const id = await ticket("spya-lbaaae");
    expect((await post(`/api/live/${id}/close`, { reason: "session_cap" })).status).toBe(200);
    const row = await session(id);
    expect(row?.closedAt).toBeTruthy();
    expect(row?.closeReason).toBe("session_cap");
    /* Closing is also evidence the channel opened — a session that reached its
       own end certainly connected. */
    expect(row?.connectedAt).toBeTruthy();
  });

  it("refuses a close reason long enough to be a payload", async () => {
    const id = await ticket("spya-lbaaaf");
    const out = await post(`/api/live/${id}/close`, { reason: "x".repeat(200) });
    expect(out.status).toBe(400);
    expect((await session(id))?.closedAt).toBeNull();
  });
});

describe("what the browser actually posts, end to end", () => {
  /**
   * **The closest thing to a real session this box can run.** A raw provider
   * event goes through the client's own projection (src/web/live/meter.ts),
   * over the HTTP route as JSON, through `parseRealtimeUsage` and
   * `acceptRealtimeUsage`, and out as a priced row.
   *
   * Everything else in this file posts a body written by hand, which proves the
   * server and nothing about the client. A hand-written body is exactly what a
   * client-side field-name mistake would agree with: the server would go on
   * accepting the shape the test made up while refusing every real report with
   * a 400, and both files would stay green.
   *
   * What is still not proved here is the browser itself and Postgres — see
   * docs/project/live-conversation.md § The meter.
   */
  const at = () => new Date().toISOString();

  it("prices a spoken turn the client built from a real response.done", async () => {
    const id = await ticket("spya-lcaaaa");
    const report = responseReport(
      {
        type: "response.done",
        response: {
          id: "resp_browser_1",
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
        },
      },
      { startedAt: new Date(Date.now() - 2000).toISOString(), finishedAt: at() },
    );
    /* Through `JSON.parse(JSON.stringify(…))` rather than as the object, because
       that is what actually crosses the wire — a `undefined` that survives an
       in-process call disappears in serialisation, and the server requires every
       field explicitly. */
    const out = await post(`/api/live/${id}/usage`, JSON.parse(JSON.stringify(report)));
    expect(out.status, JSON.stringify(out.body)).toBe(200);

    const row = (await ledger(id)).find((r) => r.providerEventId === "resp_browser_1");
    expect(row?.requestedModel).toBe(LIVE_MODEL);
    expect(row?.costSource).toBe("computed");
    expect(row?.computedCostNanos).toBeGreaterThan(0);
    /* The splits survive the whole trip, which is what makes the row repriceable
       — audio in is $32/Mtok against $4 for text, so a row with only totals is a
       number nobody can check. */
    expect(row?.inputAudioTokens).toBe(13);
    expect(row?.cachedAudioTokens).toBe(4);
    expect(row?.outputAudioTokens).toBe(91);
  });

  it("prices the transcription, which is the other half of the bill", async () => {
    /* Two models, two rate cards, two events. A meter built on `response.done`
       alone would have left this one at nothing, and the row would not exist to
       notice. */
    const id = await ticket("spya-lcaaab");
    const report = transcriptionReport(
      {
        type: "conversation.item.input_audio_transcription.completed",
        event_id: "event_1",
        item_id: "item_browser_1",
        transcript: "what did the author mean by that",
        usage: { type: "duration", seconds: 4 },
      },
      { startedAt: null, finishedAt: at() },
    );
    const out = await post(`/api/live/${id}/usage`, JSON.parse(JSON.stringify(report)));
    expect(out.status, JSON.stringify(out.body)).toBe(200);

    const row = (await ledger(id)).find((r) => r.providerEventId === "item_browser_1");
    expect(row?.requestedModel).toBe(LIVE_TRANSCRIBER);
    expect(row?.transcriptionSeconds).toBe(4);
    expect(row?.computedCostNanos).toBeGreaterThan(0);
    /* No matching start event exists, so the duration is null rather than a
       zero that would read as an instant call. */
    expect(row?.durationMs).toBeNull();
  });
});

describe("the gate", () => {
  it("refuses all three to a request with no session", async () => {
    /* **They are under `/api/live/`, not `/api/public/`**, so they are behind
       `requireUser` like everything else — and this is the assertion that says
       so rather than assuming it. A usage endpoint outside the gate would let
       anybody write rows against a session id, and the failure would look
       exactly like a working meter. The header is what the gate reads first,
       before any verifier is consulted (tests/helpers/authed.ts). */
    for (const at of ["connected", "usage", "close"]) {
      const out = await post(`/api/live/00000000-0000-4000-8000-00000000beef/${at}`, {}, {});
      expect(out.status, at).toBe(401);
    }
  });
});

/* ------------------------------------- what this stage looks like alone -- */

describe("deployed on its own, before the browser posts anything", () => {
  it("shows an issued session that reported nothing, rather than an absence", async () => {
    /* **The whole point of Stage 2A.** Until the browser half lands, every
       session will look exactly like this — and that is the honest state rather
       than a failure. Without the row there would be no gap to see, only a
       ledger that looked healthy while missing the most expensive thing the app
       does. docs/reusable/silent-success.md. */
    const id = await ticket("spya-lcaaaa");
    expect(await session(id)).not.toBeNull();
    expect(await ledger(id)).toHaveLength(0);
  });
});

/* ---------------------------------------------- GPT-Live, the second engine -- */

/**
 * **`POST /api/chat/:slug/:threadId/live-session`, and its two usage kinds
 * through the route** — docs/plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md.
 *
 * What only the route can get wrong here is **order**, and it is the reverse
 * of the ticket's above. Creating a GPT-Live session bills fifteen seconds, so:
 * the journal row first, then OpenAI, then the charge. Each step is checked at
 * the moment it matters — the row is read back *from inside the stubbed create
 * call*, which is the only place "before" can be observed.
 *
 * Seen red on 2026-10-03, each by its own mutation of `liveChatSession` in
 * src/routes.ts: the create moved ahead of `issue` (the row was not there at
 * create time); the `closeUnopened` call removed (the failed session stayed
 * open); `advanceVoiceSeconds` after the create removed (no fifteen-second
 * row, and the browser's first report then billed it instead); `GPT_LIVE_MODEL`
 * on the row swapped for `LIVE_MODEL` (the voice report was refused as the
 * wrong engine's).
 */
describe("a GPT-Live session", () => {
  const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n";

  /** The session row for a thread, read straight from the table: a failed create returns no id. */
  async function rowForThread(threadId: string) {
    const rows = await getDb()
      .select()
      .from(realtimeSessions)
      .where(and(eq(realtimeSessions.ownerId, TEST_OWNER), eq(realtimeSessions.threadId, threadId)));
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  async function open(threadId: string, body: Record<string, unknown> = {}) {
    return post(`/api/chat/${SLUG}/${threadId}/live-session`, { sdp: OFFER, ...body });
  }

  it("journals first, then creates, then records the charge — and answers with the SDP", async () => {
    const out = await open("spya-lgaaaa");
    expect(out.status).toBe(200);

    /* **The row was already there when OpenAI was asked**, with nothing billed
       and no provider id yet. Read from inside the create call. */
    expect(liveCreate.seen).toHaveLength(1);
    expect(liveCreate.seen[0]?.rowAtCreate).toMatchObject({
      model: GPT_LIVE_MODEL,
      backendModel: GPT_LIVE_BACKEND_MODEL,
      providerSessionId: null,
      voiceSecondsReported: 0,
      closedAt: null,
    });

    /* What OpenAI was sent: the session and the browser's offer, untouched. */
    const sent = liveCreate.seen[0]?.body as {
      session: { model: string; instructions: string; delegation: { responses: { instructions: string } } };
      transport: { type: string; sdp: string };
    };
    expect(sent.transport).toEqual({ type: "webrtc", sdp: OFFER });
    expect(sent.session.model).toBe(GPT_LIVE_MODEL);
    expect(sent.session.instructions).toContain("# Delegation policy");
    expect(sent.session.delegation.responses.instructions).toContain("THE ARTICLE");

    /* What the browser gets: four fields, and none of what the models were told. */
    expect(Object.keys(out.body).sort()).toEqual(["liveSessionId", "sdp", "sessionId", "tailId"]);
    expect(out.body.sdp).toBe("v=0 the answer");
    expect(out.body.liveSessionId).toBe("live_test_session");
    expect(out.body.tailId).toBeNull();

    const id = out.body.sessionId as string;
    const row = await session(id);
    expect(row?.model).toBe(GPT_LIVE_MODEL);
    expect(row?.backendModel).toBe(GPT_LIVE_BACKEND_MODEL);
    expect(row?.transcriptionModel).toBeNull();
    expect(row?.providerSessionId).toBe("live_test_session");
    expect(row?.articleSlug).toBe(SLUG);
    /* Twenty minutes, the same server-owned window a Realtime session gets. */
    expect(Date.parse(String(row?.acceptsUntil)) - Date.parse(String(row?.issuedAt))).toBe(20 * 60_000);
    /* Created is not connected: the data channel has not opened. */
    expect(row?.connectedAt).toBeNull();

    /* **The fifteen seconds the create billed are already a priced row.** */
    expect(row?.voiceSecondsReported).toBe(GPT_LIVE_CREATE_SECONDS);
    const rows = await ledger(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventKind).toBe("voice");
    expect(rows[0]?.voiceSeconds).toBe(15);
    expect(rows[0]?.computedCostNanos).toBe(12_500_000);
    expect(rows[0]?.costSource).toBe("computed");
    expect(rows[0]?.requestedModel).toBe(GPT_LIVE_MODEL);
    expect(rows[0]?.articleSlug).toBe(SLUG);
  });

  it("adds nothing for the browser's first report of 15, and thirteen seconds for 28", async () => {
    const id = (await open("spya-lgaaab")).body.sessionId as string;
    const voice = (seconds: number, eventId: string) =>
      post(`/api/live/${id}/usage`, { kind: "voice", seconds, eventId });

    /* The same cumulative figure the create already billed. */
    expect((await voice(15, "event_a")).status).toBe(200);
    expect(await ledger(id)).toHaveLength(1);

    expect((await voice(28, "event_b")).status).toBe(200);
    /* A retry of it, and an older report arriving late. */
    expect((await voice(28, "event_b")).status).toBe(200);
    expect((await voice(20, "event_c")).status).toBe(200);

    const seconds = (await ledger(id)).map((r) => r.voiceSeconds).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(seconds).toEqual([13, 15]);
    expect((await session(id))?.voiceSecondsReported).toBe(28);
    /* A report is evidence the channel opened, as it is for Realtime. */
    expect((await session(id))?.connectedAt).toBeTruthy();
  });

  it("prices a backend response once, however often it is reported", async () => {
    const id = (await open("spya-lgaaac")).body.sessionId as string;
    const report = {
      kind: "backend",
      responseId: "resp_backend_1",
      inputTokens: 811,
      cachedInputTokens: 0,
      outputTokens: 20,
    };
    expect((await post(`/api/live/${id}/usage`, report)).status).toBe(200);
    expect((await post(`/api/live/${id}/usage`, report)).status).toBe(200);
    const backend = (await ledger(id)).filter((r) => r.eventKind === "backend");
    expect(backend).toHaveLength(1);
    expect(backend[0]?.requestedModel).toBe(GPT_LIVE_BACKEND_MODEL);
    expect(backend[0]?.computedCostNanos).toBe(91_100);
    expect(backend[0]?.reportedInputTokens).toBe(811);
    /* It does not move the voice meter. */
    expect((await session(id))?.voiceSecondsReported).toBe(15);
  });

  it("refuses the other engine's reports, in both directions, and writes nothing", async () => {
    const gpt = (await open("spya-lgaaad")).body.sessionId as string;
    expect((await post(`/api/live/${gpt}/usage`, turn())).status).toBe(400);
    expect(await ledger(gpt)).toHaveLength(1);

    const realtime = await ticket("spya-lgaaae");
    const voice = await post(`/api/live/${realtime}/usage`, { kind: "voice", seconds: 15, eventId: "e" });
    expect(voice.status).toBe(400);
    const backend = await post(`/api/live/${realtime}/usage`, {
      kind: "backend",
      responseId: "r",
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
    });
    expect(backend.status).toBe(400);
    expect(await ledger(realtime)).toHaveLength(0);
    expect((await session(realtime))?.voiceSecondsReported).toBe(0);
  });

  it("closes the row, bills nothing and tells the reader plainly when OpenAI refuses", async () => {
    liveCreate.status = 400;
    liveCreate.answer = { error: { message: "SECRET-UPSTREAM-WORDS instructions too long" } };
    const out = await open("spya-lgaaaf");

    expect(out.status).toBeGreaterThanOrEqual(500);
    expect(out.body).not.toHaveProperty("sdp");
    /* The mint's sentence, with the code the browser looks for — and none of
       OpenAI's own words, which stay in the log. */
    expect(String(out.body.error)).toContain("[live-upstream]");
    expect(JSON.stringify(out.body)).not.toContain("SECRET-UPSTREAM-WORDS");

    const row = await rowForThread("spya-lgaaaf");
    expect(row?.closedAt).not.toBeNull();
    expect(row?.closeReason).toBe("create_failed");
    /* It never opened, so it must not read as a conversation that happened. */
    expect(row?.connectedAt).toBeNull();
    expect(row?.providerSessionId).toBeNull();
    expect(row?.voiceSecondsReported).toBe(0);
    expect(await ledger(String(row?.id))).toHaveLength(0);
  });

  it("closes the row when OpenAI cannot be reached at all", async () => {
    liveCreate.throws = true;
    const out = await open("spya-lgaaag");
    expect(out.status).toBeGreaterThanOrEqual(500);
    const row = await rowForThread("spya-lgaaag");
    expect(row?.closeReason).toBe("create_failed");
    expect(row?.connectedAt).toBeNull();
    expect(await ledger(String(row?.id))).toHaveLength(0);
  });

  it("never asks OpenAI when the journal write fails", async () => {
    /* The create bills. A session OpenAI made and we have no row for is spend
       nothing could ever see — so no row, no request. */
    const issue = vi
      .spyOn(realtimeSessionStore, "issue")
      .mockRejectedValue(new Error("the journal refused this row"));
    try {
      const out = await open("spya-lgaaah");
      expect(out.status).toBeGreaterThanOrEqual(500);
      expect(issue).toHaveBeenCalledTimes(1);
      expect(liveCreate.seen).toHaveLength(0);
    } finally {
      issue.mockRestore();
    }
  });

  it("checks the body before it journals or asks anything", async () => {
    const before = await journalled();
    for (const body of [
      {},
      { sdp: "" },
      { sdp: 12 },
      { sdp: "v=0 ".repeat(6000) },
      { sdp: OFFER, placement: "wibble" },
      { sdp: OFFER, useProfile: "yes" },
    ]) {
      const out = await post(`/api/chat/${SLUG}/spya-lgaaai/live-session`, body);
      expect(out.status, JSON.stringify(body).slice(0, 60)).toBeGreaterThanOrEqual(400);
      expect(out.status, JSON.stringify(body).slice(0, 60)).toBeLessThan(500);
    }
    expect(await journalled()).toBe(before);
    expect(liveCreate.seen).toHaveLength(0);

    /* A placement is accepted — one body shape for both engines — and unused. */
    const ok = await open("spya-lgaaaj", { placement: "headset", useProfile: false });
    expect(ok.status).toBe(200);
    expect(JSON.stringify(liveCreate.seen[0]?.body)).not.toMatch(/noise_reduction|near_field|headset/);
  });

  it("is behind the gate like the rest", async () => {
    const out = await post(`/api/chat/${SLUG}/spya-lgaaak/live-session`, { sdp: OFFER }, {});
    expect(out.status).toBe(401);
    expect(liveCreate.seen).toHaveLength(0);
  });
});
