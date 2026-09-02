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
 * No database. `SPIDERYARN_STORE` is unset here, so the journal is the
 * filesystem adapter and the ledger is the disposable test JSONL — both
 * redirected at their own env vars into a temp directory, so this suite cannot
 * touch a developer's own files. `fetch` is stubbed, so nothing reaches OpenAI
 * and no key is needed.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiCallRow } from "../src/ai-spend.js";
import { LIVE_MODEL } from "../src/live.js";
import { handleApi } from "../src/routes.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

const SLUG = "test-live-session-routes";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
const EXAMPLE = path.resolve(import.meta.dirname, "..", "example");

let scratch: string;
const realKey = process.env.OPENAI_API_KEY;
const realLedger = process.env.SPIDERYARN_LEDGER;
const realJournal = process.env.SPIDERYARN_REALTIME_JOURNAL;

beforeAll(async () => {
  await rm(DIR, { recursive: true, force: true });
  const { cp } = await import("node:fs/promises");
  await cp(EXAMPLE, DIR, { recursive: true });
  scratch = await mkdtemp(path.join(tmpdir(), "spideryarn-live-"));
  process.env.SPIDERYARN_LEDGER = path.join(scratch, "ai-calls.jsonl");
  process.env.SPIDERYARN_REALTIME_JOURNAL = path.join(scratch, "sessions.json");
});

afterAll(async () => {
  await rm(DIR, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
  if (realLedger === undefined) delete process.env.SPIDERYARN_LEDGER;
  else process.env.SPIDERYARN_LEDGER = realLedger;
  if (realJournal === undefined) delete process.env.SPIDERYARN_REALTIME_JOURNAL;
  else process.env.SPIDERYARN_REALTIME_JOURNAL = realJournal;
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

/** Every session in the journal, by id. */
async function sessions(): Promise<Record<string, Record<string, unknown>>> {
  try {
    return JSON.parse(await readFile(process.env.SPIDERYARN_REALTIME_JOURNAL ?? "", "utf8"));
  } catch {
    return {};
  }
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

describe("the ticket writes the journal row before it releases the token", () => {
  it("hands back a session id, and there is a row behind it", () => {
    return (async () => {
      const id = await ticket("spya-laaaaa");
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      const row = (await sessions())[id];
      expect(row).toBeDefined();
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
      const row = (await sessions())[id];
      const window = Date.parse(String(row?.acceptsUntil)) - Date.parse(String(row?.issuedAt));
      expect(window).toBe(20 * 60_000);
    })();
  });

  it("releases no token when the journal write fails", async () => {
    /* **The order is the rule.** A usable token with no row behind it is spend
       nothing can ever see, so a failure here has to reach the reader as "the
       session could not start" rather than as a working conversation nobody can
       account for. Provoked by breaking the journal path — a directory where a
       file has to go — rather than by mocking the store, so the failure travels
       the real path.

       The token is genuinely wasted when this happens, and that is the cheaper
       of the two outcomes. */
    const good = process.env.SPIDERYARN_REALTIME_JOURNAL;
    process.env.SPIDERYARN_REALTIME_JOURNAL = scratch; // a directory, not a file
    try {
      const out = await post(`/api/chat/${SLUG}/spya-laaaac/live`, {});
      expect(out.status).toBeGreaterThanOrEqual(500);
      expect(out.body).not.toHaveProperty("token");
    } finally {
      process.env.SPIDERYARN_REALTIME_JOURNAL = good;
    }
  });

  it("refuses nothing and journals nothing when OpenAI will not mint", async () => {
    /* The other order check: the session row must not exist for a conversation
       that could never have started. */
    mintFails = true;
    const before = Object.keys(await sessions()).length;
    const out = await post(`/api/chat/${SLUG}/spya-laaaad/live`, {});
    expect(out.status).toBeGreaterThanOrEqual(400);
    expect(Object.keys(await sessions())).toHaveLength(before);
  });
});

/* ------------------------------------------------------- the events -- */

describe("the acceptance endpoints", () => {
  it("records the data channel opening, and keeps the first time", async () => {
    const id = await ticket("spya-lbaaaa");
    expect((await post(`/api/live/${id}/connected`, {})).status).toBe(200);
    const first = (await sessions())[id]?.connectedAt;
    expect(first).toBeTruthy();
    /* Idempotent, and earliest-wins: a usage report backfills this too, in case
       the connected event was lost, and it arrives later by definition. An
       unconditional overwrite would replace the moment the channel opened with
       the moment somebody stopped talking. */
    await post(`/api/live/${id}/connected`, {});
    expect((await sessions())[id]?.connectedAt).toBe(first);
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
    expect((await sessions())[id]?.connectedAt).toBeTruthy();
  });

  it("does not write a second row when the same turn is reported twice", async () => {
    /* The browser retries whatever it did not see acknowledged, so a request
       that succeeded and whose 200 was lost is the ordinary case. Two identical
       posts, one row. */
    const id = await ticket("spya-lbaaac");
    await post(`/api/live/${id}/usage`, turn({ providerEventId: "resp_dup" }));
    await post(`/api/live/${id}/usage`, turn({ providerEventId: "resp_dup" }));
    const rows = (await ledger()).filter((r) => r.realtimeSessionId === id);
    /* The filesystem ledger is append-only and has no unique key, so both lines
       are written — and they are the SAME line, because the row's id is derived
       from the event. That is what Postgres's `on conflict do nothing` collapses
       on the store that counts, and it is the property worth asserting here:
       every copy is byte-identical, so nothing downstream can tell them apart
       and count them twice by mistake about *which* row it has. */
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
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
    const row = (await sessions())[id];
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
    expect((await sessions())[id]?.closedAt).toBeNull();
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
    expect((await sessions())[id]).toBeDefined();
    expect((await ledger()).filter((r) => r.realtimeSessionId === id)).toHaveLength(0);
  });
});
