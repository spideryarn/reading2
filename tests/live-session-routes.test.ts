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
 * The flag is now pinned to `postgres` before any import, one article is seeded
 * under this slug, and every read-back goes through `realtimeSessionStore` — the
 * same object `src/routes.ts` holds.
 *
 * **What the move bought, and it is more than tidiness.** The Postgres `issue`
 * resolves `article_slug` to an `article_id` and writes a row under a real
 * `auth.users` owner; `find` filters on the owner *in the query*; `markConnected`
 * and `close` are conditional `UPDATE`s with `is null` guards doing the
 * earliest-wins and first-close-wins work that the filesystem adapter did in
 * JavaScript over an object it had just read. Every one of those can now be
 * wrong in a way a file could not be.
 *
 * **The ledger did not move, and that is deliberate rather than an oversight.**
 * `selected()` in src/store/ai-calls.ts returns the *filesystem* ledger whenever
 * `NODE_ENV === "test"`, whatever the flag says, because Postgres-mode route
 * suites once wrote 4,714 fixture rows into the development ledger. So
 * `SPIDERYARN_LEDGER` still redirects a disposable JSONL here, `fsCostStore` is
 * still what `ledger()` reads, and the two-lines-collapse-to-one assertion below
 * is unchanged and still true. Stage C of the plan above owns that redirect.
 *
 * ## The mutation, watched red on 2026-09-04
 *
 * `isNull(realtimeSessions.connectedAt)` deleted from `markConnected`'s `where`
 * in src/store/realtime-sessions-pg.ts — the earliest-wins predicate, which is
 * SQL the filesystem adapter has no counterpart for. *records the data channel
 * opening, and keeps the first time* fails with the two timestamps 14ms apart.
 *
 * **What it does not cover.** One predicate of one statement. The owner
 * condition beside it in the same `where` is **not** covered — nothing in this
 * file is cross-owner, so deleting `eq(ownerId)` from `markConnected`, from
 * `close` or from `find` leaves every case green, and the second bullet at the
 * top of this header (*the session is looked up for the authenticated owner*) is
 * therefore a claim this file states and does not test. `tests/owner-isolation.test.ts`
 * greps this directory for the unsanctioned spelling, which is a different and
 * weaker guarantee. Nor does it touch `close`'s `is null` first-close-wins
 * guard, its `coalesce` backfill, or `issue`'s slug-to-`article_id` resolution.
 *
 * `fetch` is stubbed, so nothing reaches OpenAI and no key is needed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres`, before **any** import runs — `src/store/live.ts`
 * reads the flag once and imports are hoisted above every statement, and
 * `src/store/index.ts` picks `realtimeSessionStore` at its own module load.
 */
const PREVIOUS_STORE_FLAG = vi.hoisted(() => {
  const previous = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return previous;
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { and, count, eq } from "drizzle-orm";

import type { AiCallRow } from "../src/ai-spend.js";
import { closeDb, getDb } from "../src/db/client.js";
import { realtimeSessions } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { LIVE_MODEL, LIVE_TRANSCRIBER } from "../src/live.js";
import { responseReport, transcriptionReport } from "../src/web/live/meter.js";
import { handleApi } from "../src/routes.js";
import { realtimeSessionStore, STORE } from "../src/store/index.js";
import type { RealtimeSession } from "../src/store/contracts.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

/* Put the flag back straight after the imports: vitest reuses a worker across
   files and does not reset `process.env` between them. */
if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

loadEnvLocal();

const SLUG = "test-live-session-routes";

const { reachable } = await pgReady({
  suite: "tests/live-session-routes.test.ts",
  tables: ["spideryarn.articles", "spideryarn.realtime_sessions"],
});

const when = reachable ? describe : describe.skip;

let scratch: string;
let article: ScratchArticle | undefined;
const realKey = process.env.OPENAI_API_KEY;
const realLedger = process.env.SPIDERYARN_LEDGER;

beforeAll(async () => {
  if (!reachable) return;
  scratch = await mkdtemp(path.join(tmpdir(), "spideryarn-live-"));
  process.env.SPIDERYARN_LEDGER = path.join(scratch, "ai-calls.jsonl");
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
  if (scratch) await rm(scratch, { recursive: true, force: true });
  if (realLedger === undefined) delete process.env.SPIDERYARN_LEDGER;
  else process.env.SPIDERYARN_LEDGER = realLedger;
}, 60_000);

describe("the store this journal is actually written to", () => {
  it("is the Postgres one", () => {
    /* Not gated on the database being up, deliberately: a control that vanishes
       when Postgres is missing vanishes exactly when it matters. A flag that
       failed to take looks precisely like this suite working — the filesystem
       journal answers every read below with the same fields. */
    expect(STORE).toBe("postgres");
  });
});

/** Whether OpenAI answers at all, so a test can drive the failure path. */
let mintFails = false;

beforeEach(() => {
  mintFails = false;
  process.env.OPENAI_API_KEY = "sk-test";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
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

/** Every ledger row this suite has written. */
async function ledger(): Promise<AiCallRow[]> {
  try {
    const text = await readFile(process.env.SPIDERYARN_LEDGER ?? "", "utf8");
    return text
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as AiCallRow);
  } catch {
    return [];
  }
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

when("the ticket writes the journal row before it releases the token", () => {
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

when("the acceptance endpoints", () => {
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
    const row = (await ledger()).find((r) => r.realtimeSessionId === id);
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
    const lines = (await ledger()).filter((r) => r.realtimeSessionId === id);
    /* Both lines are on disk, and that is correct: the file is append-only and
       is never rewritten, so the evidence that the browser posted twice
       survives. */
    expect(lines).toHaveLength(2);
    const { fsCostStore } = await import("../src/store/ai-calls-fs.js");
    const rows = (await fsCostStore.read()).rows.filter((r) => r.realtimeSessionId === id);
    /* **One row, on either store.** The row's id is derived from the event, so
       the retry collides: Postgres absorbs it on `on conflict do nothing`, and
       the filesystem ledger — which is append-only and has no unique key, so
       both lines really are on disk — collapses them by id on read
       (`fsCostStore.read`). Until 2026-09-03 this asserted only that the two
       copies shared an id, which was true and was not enough: `totalRows()`
       added both, and this test was green through it. GPT Sol. */
    expect(rows).toHaveLength(1);
  });

  it("refuses a report the server cannot believe, and writes nothing", async () => {
    const id = await ticket("spya-lbaaad");
    const before = (await ledger()).length;
    const out = await post(`/api/live/${id}/usage`, turn({ outputAudioTokens: 999_999 }));
    expect(out.status).toBe(400);
    expect(await ledger()).toHaveLength(before);
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

when("what the browser actually posts, end to end", () => {
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

    const row = (await ledger()).find((r) => r.providerEventId === "resp_browser_1");
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

    const row = (await ledger()).find((r) => r.providerEventId === "item_browser_1");
    expect(row?.requestedModel).toBe(LIVE_TRANSCRIBER);
    expect(row?.transcriptionSeconds).toBe(4);
    expect(row?.computedCostNanos).toBeGreaterThan(0);
    /* No matching start event exists, so the duration is null rather than a
       zero that would read as an instant call. */
    expect(row?.durationMs).toBeNull();
  });
});

when("the gate", () => {
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

when("deployed on its own, before the browser posts anything", () => {
  it("shows an issued session that reported nothing, rather than an absence", async () => {
    /* **The whole point of Stage 2A.** Until the browser half lands, every
       session will look exactly like this — and that is the honest state rather
       than a failure. Without the row there would be no gap to see, only a
       ledger that looked healthy while missing the most expensive thing the app
       does. docs/reusable/silent-success.md. */
    const id = await ticket("spya-lcaaaa");
    expect(await session(id)).not.toBeNull();
    expect((await ledger()).filter((r) => r.realtimeSessionId === id)).toHaveLength(0);
  });
});
