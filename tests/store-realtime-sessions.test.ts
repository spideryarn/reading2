/**
 * **The live-conversation journal** —
 * [realtime-sessions-pg.ts](../src/store/realtime-sessions-pg.ts).
 *
 * A second, filesystem journal stood beside it until 2026-09-05, and this file
 * was written to prove the two **agreed** — a difference between them was a
 * difference between a laptop and production, which is the shape of bug this
 * directory kept producing (see
 * docs/postmortems/260901e-claims-shipped-filesystem-only-and-returned-501-in-production.md).
 * There is one store now, so `bothStores` runs once; it stays a function rather
 * than being inlined because what it holds is the contract, and the next
 * adapter to be asked for it should be handed to it rather than copied out of
 * it.
 *
 * The three behaviours it pins are all "a second write must not undo the
 * first":
 *
 * - `issue` refuses a duplicate id rather than overwriting, because a collision
 *   would mean two conversations given one identity and the older one's reports
 *   landing on a row that describes a different conversation;
 * - `markConnected` keeps the **earliest** time, because a usage report backfills
 *   it in case the connected event was lost and arrives later by definition;
 * - `close` keeps the **first** close, because a `pagehide` beacon and an
 *   explicit hang-up both fire on the ordinary way out.
 *
 * ## No database is a failure, not a skip
 *
 * `pgReady` below throws when the table or `accepts_until` is missing, naming
 * the migration to run. There is no skip mechanism left in this file — a green
 * run means these seven cases executed. tests/helpers/pg-ready.ts.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RealtimeSession, RealtimeSessionStore } from "../src/store/contracts.js";
import { loadEnvLocal } from "../src/env.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/** Its own owner uuid — tests/fixture-ids.test.ts insists, and this file inserts rows. */
const OWNER = "00000000-0000-4000-8000-00000000ac0f";
/**
 * Somebody who is not the owner, for the four lookups that must come back empty.
 *
 * **Its own uuid rather than `owner-isolation.test.ts`'s `BOB`**, which is what
 * this was first written as. tests/fixture-ids.test.ts caught it: vitest runs
 * files in parallel against one database, so a shared id means whichever tears
 * down first deletes the other's fixture — and the rule is about the
 * *declaration*, not about whether this file happens to insert under it today.
 */
const STRANGER = "00000000-0000-4000-8000-00000000ac2f";
const ISSUED = "2026-09-02T10:00:00.000Z";

function session(over: Partial<RealtimeSession> = {}): RealtimeSession {
  return {
    id: "00000000-0000-4000-8000-0000000005f1",
    ownerId: OWNER,
    /* A slug nothing owns, so `article_id` comes back null and the row is still
       written. That is the designed behaviour: the slug is the historical fact
       and the id is the convenience. */
    articleSlug: "no-such-article-here",
    threadId: "spya-vaaaaa",
    model: "gpt-realtime-2.1",
    transcriptionModel: "gpt-live-transcribe",
    backendModel: null,
    providerSessionId: null,
    voiceSecondsReported: 0,
    issuedAt: ISSUED,
    acceptsUntil: "2026-09-02T10:20:00.000Z",
    connectedAt: null,
    closedAt: null,
    closeReason: null,
    ...over,
  };
}

/**
 * The behaviour a journal adapter owes, run against whichever is handed in.
 *
 * It is called once now that there is one store. Kept as a function because
 * what it holds is the contract rather than one adapter's behaviour — when two
 * of them existed, two copies of these assertions would have been two places
 * for them to stop agreeing without anything going red.
 */
function bothStores(name: string, store: () => RealtimeSessionStore, id: (n: number) => string) {
  describe(name, () => {
    it("writes a session and hands it back for its owner", async () => {
      const s = session({ id: id(1) });
      await store().issue(s);
      const found = await store().find(id(1), OWNER);
      expect(found?.model).toBe("gpt-realtime-2.1");
      expect(found?.transcriptionModel).toBe("gpt-live-transcribe");
      expect(found?.issuedAt).toBe(ISSUED);
      expect(found?.acceptsUntil).toBe("2026-09-02T10:20:00.000Z");
      expect(found?.connectedAt).toBeNull();
      expect(found?.articleSlug).toBe("no-such-article-here");
    });

    it("hands nothing back to anybody else", async () => {
      /* The owner is part of the lookup rather than a check the caller makes.
         The session id travels through the browser and comes back on a request,
         so a lookup without the owner would answer for any session whose id
         somebody had — the same discipline `ownedSlug` enforces on articles, and
         the reason it exists is that the unfiltered lookup reads exactly like a
         working one. */
      await store().issue(session({ id: id(2) }));
      expect(await store().find(id(2), STRANGER)).toBeNull();
    });

    it("refuses a second session under one id rather than overwriting", async () => {
      await store().issue(session({ id: id(3) }));
      await expect(store().issue(session({ id: id(3) }))).rejects.toThrow();
    });

    it("keeps the earliest connected time", async () => {
      await store().issue(session({ id: id(4) }));
      await store().markConnected(id(4), OWNER, "2026-09-02T10:00:05.000Z");
      await store().markConnected(id(4), OWNER, "2026-09-02T10:09:00.000Z");
      expect((await store().find(id(4), OWNER))?.connectedAt).toBe("2026-09-02T10:00:05.000Z");
    });

    it("keeps the first close, with its reason", async () => {
      await store().issue(session({ id: id(5) }));
      await store().close(id(5), OWNER, "2026-09-02T10:10:00.000Z", "hung_up");
      await store().close(id(5), OWNER, "2026-09-02T10:11:00.000Z", "idle");
      const found = await store().find(id(5), OWNER);
      expect(found?.closedAt).toBe("2026-09-02T10:10:00.000Z");
      expect(found?.closeReason).toBe("hung_up");
    });

    it("treats a close as evidence the channel opened, without overwriting a real one", async () => {
      /* The `connected` event fires once, on a channel that has just become
         usable, and nothing retries it — so a dropped request loses it for good.
         A session that reached its own end certainly connected, which is a
         weaker inference and must never beat the real thing. */
      await store().issue(session({ id: id(6) }));
      await store().close(id(6), OWNER, "2026-09-02T10:10:00.000Z", null);
      expect((await store().find(id(6), OWNER))?.connectedAt).toBe("2026-09-02T10:10:00.000Z");

      await store().issue(session({ id: id(7) }));
      await store().markConnected(id(7), OWNER, "2026-09-02T10:00:03.000Z");
      await store().close(id(7), OWNER, "2026-09-02T10:10:00.000Z", null);
      expect((await store().find(id(7), OWNER))?.connectedAt).toBe("2026-09-02T10:00:03.000Z");
    });

    it("does nothing at all for somebody else's session", async () => {
      await store().issue(session({ id: id(8) }));
      await store().markConnected(id(8), STRANGER, "2026-09-02T10:00:05.000Z");
      await store().close(id(8), STRANGER, "2026-09-02T10:10:00.000Z", "hung_up");
      const found = await store().find(id(8), OWNER);
      expect(found?.connectedAt).toBeNull();
      expect(found?.closedAt).toBeNull();
    });
  });
}

/* ----------------------------------------------------------- Postgres -- */

/* **The column asked for is `accepts_until`, not just the table.** It is the one
   that carries the whole point — a server-owned deadline rather than the token's
   expiry — so a database one migration behind should say "run npm run
   db:migrate" rather than fail with a confusing column error from inside the
   store. Four other suites name a column here for the same reason; see
   tests/helpers/pg-ready.ts. */
await pgReady({
  suite: "tests/store-realtime-sessions.test.ts",
  tables: ["spideryarn.realtime_sessions"],
  columns: [
    { table: "spideryarn.realtime_sessions", column: "accepts_until" },
    { table: "spideryarn.realtime_sessions", column: "voice_seconds_reported" },
    { table: "spideryarn.ai_calls", column: "voice_seconds" },
  ],
  max: 2,
});

const { pgRealtimeSessionStore } = await import("../src/store/realtime-sessions-pg.js");

beforeAll(async () => {
  /* **`realtime_sessions.owner_id` is a foreign key into `auth.users`**, so a
     made-up uuid is a `23503`, not a row. This was invisible until the
     migration landed: the whole block skipped for want of the table, and a
     test that has never run is not evidence
     (docs/reusable/silent-success.md). All seven failed the first time they
     were allowed to execute.

     **Through `seedAuthUser`, never by hand.** Four of `auth.users`' token
     columns are nullable with no default, GoTrue scans them into non-null Go
     strings, and one row with them NULL makes `GET /auth/v1/admin/users`
     answer 500 for the **whole database** — every other suite and the dev
     server's /admin page with it. tests/helpers/seed-auth-user.ts has the
     reproduction. */
  const { getDb } = await import("../src/db/client.js");
  const { seedAuthUser } = await import("./helpers/seed-auth-user.js");
  for (const id of [OWNER, STRANGER]) {
    await seedAuthUser(getDb(), {
      id,
      email: `${id}@realtime-sessions.test`,
      onConflictDoNothing: true,
    });
  }
});

afterAll(async () => {
  /* **Explicit cleanup, because these rows are real.** Nothing deletes a
     session through the contract — a billing parent is not something the app
     removes — so the tidying has to go round it, exactly as
     tests/store-ai-calls.test.ts does for the ledger rows it writes. */
  const { getDb, closeDb } = await import("../src/db/client.js");
  const { aiCalls, realtimeSessions } = await import("../src/db/schema.js");
  const { eq } = await import("drizzle-orm");
  /* The voice meter's ledger rows first: they point at the sessions, and that
     foreign key is `on delete restrict`. */
  await getDb().delete(aiCalls).where(eq(aiCalls.ownerId, OWNER));
  await getDb().delete(realtimeSessions).where(eq(realtimeSessions.ownerId, OWNER));
  /* The seeded accounts go too, and after the sessions that point at them —
     a left-behind `auth.users` row is not inert here, it is the 500 above
     waiting for the next suite to run. */
  const { sql } = await import("drizzle-orm");
  await getDb().execute(sql`delete from auth.users where id in (${OWNER}, ${STRANGER})`);
  await closeDb();
});

bothStores(
  "the Postgres journal",
  () => pgRealtimeSessionStore,
  (n) => `00000000-0000-4000-8000-00000000f20${n}`,
);

/* ------------------------------------------ GPT-Live's voice meter -- */

/**
 * **The high-water mark, against real Postgres** —
 * `advanceVoiceSeconds` and `closeUnopened`, the two methods the second engine
 * added (docs/plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md
 * § The meter).
 *
 * GPT-Live reports voice seconds as a running total. The promise is that the
 * rows written for one session always add up to exactly the highest total
 * reported — whatever order the reports come in, however often one repeats,
 * and when several arrive at once. Only a database can break the last of
 * those, which is why this is here and not beside the arithmetic in
 * tests/realtime-usage.test.ts.
 *
 * The rows are built by `acceptRealtimeUsage`, the function the route uses, so
 * what is inserted is what production inserts and passes every CHECK it does.
 */
describe("the GPT-Live voice meter", () => {
  const vid = (n: number): string => `00000000-0000-4000-8000-00000000f21${n}`;
  const AT = new Date("2026-09-02T10:05:00.000Z");

  const gptSession = (n: number): RealtimeSession =>
    session({
      id: vid(n),
      model: "gpt-live-1",
      transcriptionModel: null,
      backendModel: "gpt-6-luna",
    });

  /** One `voice` report, through the store, priced by the real function. */
  async function report(n: number, seconds: number, eventId = `event_${seconds}`) {
    const { acceptRealtimeUsage } = await import("../src/live.js");
    return pgRealtimeSessionStore.advanceVoiceSeconds(vid(n), OWNER, {
      seconds,
      rowFor: (locked) =>
        acceptRealtimeUsage({
          session: locked,
          usage: { kind: "voice", seconds, eventId },
          receivedAt: AT,
        }),
    });
  }

  /** The seconds each of this session's ledger rows bills, in the order of their ranges. */
  async function billed(n: number): Promise<number[]> {
    const { getDb } = await import("../src/db/client.js");
    const { aiCalls } = await import("../src/db/schema.js");
    const { eq } = await import("drizzle-orm");
    const rows = await getDb()
      .select({ seconds: aiCalls.voiceSeconds, event: aiCalls.providerEventId, kind: aiCalls.eventKind })
      .from(aiCalls)
      .where(eq(aiCalls.realtimeSessionId, vid(n)));
    for (const r of rows) expect(r.kind).toBe("voice");
    return rows
      .sort((a, b) => Number(a.event?.split("-")[0]) - Number(b.event?.split("-")[0]))
      .map((r) => r.seconds ?? -1);
  }

  const mark = async (n: number): Promise<number | undefined> =>
    (await pgRealtimeSessionStore.find(vid(n), OWNER))?.voiceSecondsReported;

  it("starts at zero, and stores the backend model", async () => {
    await pgRealtimeSessionStore.issue(gptSession(1));
    const found = await pgRealtimeSessionStore.find(vid(1), OWNER);
    expect(found?.voiceSecondsReported).toBe(0);
    expect(found?.backendModel).toBe("gpt-6-luna");
    expect(found?.providerSessionId).toBeNull();
    expect(found?.transcriptionModel).toBeNull();
  });

  it("bills the difference, and nothing for a repeat or an older report", async () => {
    await pgRealtimeSessionStore.issue(gptSession(2));

    expect((await report(2, 15))?.voiceSeconds).toBe(15);
    expect(await mark(2)).toBe(15);

    /* The same figure again — the browser's first report after the create
       charge, or a retry. */
    expect(await report(2, 15)).toBeNull();
    expect(await report(2, 15, "another_event")).toBeNull();
    expect(await billed(2)).toEqual([15]);

    expect((await report(2, 28))?.voiceSeconds).toBe(13);
    expect(await mark(2)).toBe(28);

    /* An older report arriving late. */
    expect(await report(2, 20)).toBeNull();
    expect(await mark(2)).toBe(28);
    expect(await billed(2)).toEqual([15, 13]);
  });

  it("comes to the same total when the reports arrive out of order", async () => {
    await pgRealtimeSessionStore.issue(gptSession(3));
    expect((await report(3, 45))?.voiceSeconds).toBe(45);
    expect(await report(3, 15)).toBeNull();
    expect(await report(3, 30)).toBeNull();
    expect((await report(3, 60))?.voiceSeconds).toBe(15);
    expect(await billed(3)).toEqual([45, 15]);
    expect(await mark(3)).toBe(60);
  });

  it("bills each second once when reports arrive together", async () => {
    /* The case only a lock gets right. Without `for update`, two of these read
       the same mark, both take a difference from it, and both insert: seconds
       billed twice by rows that are each individually correct. */
    await pgRealtimeSessionStore.issue(gptSession(4));
    const totals = [15, 30, 30, 45, 45, 45, 60, 60, 15, 60];
    const rows = await Promise.all(totals.map((seconds, i) => report(4, seconds, `event_${i}`)));

    const written = rows.filter((r) => r !== null);
    const sum = written.reduce((n, r) => n + (r?.voiceSeconds ?? 0), 0);
    expect(sum).toBe(60);
    expect(await mark(4)).toBe(60);
    /* And what the calls said they wrote is what is in the table. */
    const inTable = await billed(4);
    expect(inTable.reduce((n, s) => n + s, 0)).toBe(60);
    expect(inTable).toHaveLength(written.length);
  });

  it("records OpenAI's session id in the same write", async () => {
    await pgRealtimeSessionStore.issue(gptSession(5));
    const { acceptRealtimeUsage } = await import("../src/live.js");
    await pgRealtimeSessionStore.advanceVoiceSeconds(vid(5), OWNER, {
      seconds: 15,
      providerSessionId: "live_u1_abc",
      rowFor: (locked) =>
        acceptRealtimeUsage({
          session: locked,
          usage: { kind: "voice", seconds: 15, eventId: "create" },
          receivedAt: AT,
        }),
    });
    const found = await pgRealtimeSessionStore.find(vid(5), OWNER);
    expect(found?.providerSessionId).toBe("live_u1_abc");
    expect(found?.voiceSecondsReported).toBe(15);
    /* A create charge is not a connection. */
    expect(found?.connectedAt).toBeNull();
    expect(await billed(5)).toEqual([15]);
  });

  it("writes nothing at all when the report is refused", async () => {
    await pgRealtimeSessionStore.issue(gptSession(6));
    const refusal = Object.assign(new Error("refused [live-report]"), { status: 400 });
    await expect(
      pgRealtimeSessionStore.advanceVoiceSeconds(vid(6), OWNER, {
        seconds: 15,
        providerSessionId: "live_never",
        rowFor: () => {
          throw refusal;
        },
      }),
      /* The refusal itself, not a scrubbed database error: it carries a status,
         so the guard lets it through and the route answers 400. */
    ).rejects.toBe(refusal);
    const found = await pgRealtimeSessionStore.find(vid(6), OWNER);
    expect(found?.voiceSecondsReported).toBe(0);
    expect(found?.providerSessionId).toBeNull();
    expect(await billed(6)).toEqual([]);
  });

  it("moves the mark back when the row cannot be written", async () => {
    /* The mark and the row are one fact. A row the database refuses — here,
       one claiming zero seconds, which `ai_calls_voice_seconds_on_voice_rows`
       forbids — must not leave seconds marked as billed with no bill. */
    await pgRealtimeSessionStore.issue(gptSession(7));
    const { acceptRealtimeUsage } = await import("../src/live.js");
    await expect(
      pgRealtimeSessionStore.advanceVoiceSeconds(vid(7), OWNER, {
        seconds: 15,
        rowFor: (locked) => {
          const row = acceptRealtimeUsage({
            session: locked,
            usage: { kind: "voice", seconds: 15, eventId: "e" },
            receivedAt: AT,
          });
          return row ? { ...row, voiceSeconds: 0 } : null;
        },
      }),
    ).rejects.toThrow();
    expect(await mark(7)).toBe(0);
    expect(await billed(7)).toEqual([]);
  });

  it("does nothing for somebody else's session, and never builds a row", async () => {
    await pgRealtimeSessionStore.issue(gptSession(8));
    let asked = 0;
    const out = await pgRealtimeSessionStore.advanceVoiceSeconds(vid(8), STRANGER, {
      seconds: 15,
      providerSessionId: "live_theirs",
      rowFor: () => {
        asked += 1;
        return null;
      },
    });
    expect(out).toBeNull();
    expect(asked).toBe(0);
    const found = await pgRealtimeSessionStore.find(vid(8), OWNER);
    expect(found?.voiceSecondsReported).toBe(0);
    expect(found?.providerSessionId).toBeNull();
  });

  it("closes a session that never opened without saying it connected", async () => {
    /* `close` backfills `connectedAt`, on the reasoning that a session which
       reached its end must have opened. One whose create OpenAI refused did
       not, and must not join the conversations that happened. */
    await pgRealtimeSessionStore.issue(gptSession(9));
    await pgRealtimeSessionStore.closeUnopened(vid(9), STRANGER, "2026-09-02T10:00:01.000Z", "create_failed");
    expect((await pgRealtimeSessionStore.find(vid(9), OWNER))?.closedAt).toBeNull();

    await pgRealtimeSessionStore.closeUnopened(vid(9), OWNER, "2026-09-02T10:00:02.000Z", "create_failed");
    await pgRealtimeSessionStore.closeUnopened(vid(9), OWNER, "2026-09-02T10:00:09.000Z", "later");
    const found = await pgRealtimeSessionStore.find(vid(9), OWNER);
    expect(found?.closedAt).toBe("2026-09-02T10:00:02.000Z");
    expect(found?.closeReason).toBe("create_failed");
    expect(found?.connectedAt).toBeNull();
  });
});
