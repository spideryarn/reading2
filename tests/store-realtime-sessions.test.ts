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
  columns: [{ table: "spideryarn.realtime_sessions", column: "accepts_until" }],
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
  const { realtimeSessions } = await import("../src/db/schema.js");
  const { eq } = await import("drizzle-orm");
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
