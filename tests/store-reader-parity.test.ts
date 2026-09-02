/**
 * **The two reader stores, asked the same questions about the switch.**
 *
 * `ReaderStore.readExperimental` / `writeExperimental` are two genuinely
 * different implementations of one promise, and the promise is subtle enough
 * that prose alone will not hold it:
 *
 *  - **on twice must not move the date.** Postgres does it with
 *    `coalesce(experimental_since, now())` inside `on conflict do update`; the
 *    filesystem does it by deciding inside its own write queue. No shared code,
 *    so the test has to be the shared part.
 *  - **the profile and the switch live on one row and one file**, so each write
 *    has to leave the other alone. The filesystem writer used to build the whole
 *    file from its single argument, which was correct with one field in it and
 *    would have deleted the switch the day a second arrived — with both writes
 *    reporting success. docs/reusable/silent-success.md.
 *
 * docs/project/experimental-features.md; docs/plans/experimental-features-toggle.md.
 *
 * ## Whose row Postgres writes to
 *
 * **Not the development owner's.** That row is Greg's own profile on his own
 * laptop, and a suite that writes it and tidies up afterwards is exactly what
 * wiped his profile twice in one session (src/profile.ts § `fileFor`). So this
 * file creates an `auth.users` row of its own, uses that, and deletes both rows
 * afterwards: it only ever touches what it made.
 *
 * The Postgres half **skips loudly** without a migrated database, and it skips
 * on the column this whole file is about — so an unmigrated laptop is told to
 * run `npm run db:migrate` rather than shown a confusing missing-column error.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { readerProfiles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { type OwnerId, runInRequest, setRequestOwner } from "../src/owner.js";
import type { ReaderStore } from "../src/store/contracts.js";
import { fsReaderStore } from "../src/store/fs.js";
import { pgReaderStore } from "../src/store/pg-reader.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/* At module load, so the skip is a real vitest skip rather than a green tick
   for having checked nothing. tests/helpers/pg-ready.ts. */
const { reachable: pgReachable } = await pgReady({
  suite: "tests/store-reader-parity.test.ts",
  columns: [{ table: "spideryarn.reader_profiles", column: "experimental_since" }],
});

/**
 * This suite's own reader, and nobody else's.
 *
 * `reader_profiles.owner_id` references `auth.users(id)`, so the row has to
 * exist before anything can be written for it, and it is deleted again at the
 * end. A `4` in the third group and an `8` in the fourth keeps it a well-formed
 * v4 uuid, like the synthetic owners in tests/owner-isolation.test.ts.
 *
 * **This id belongs to this file alone**, which tests/fixture-ids.test.ts
 * enforces and caught within one run: the first spelling was already
 * `store-export-isolation.test.ts`'s, and vitest runs files in parallel against
 * one database — so this suite's teardown would have deleted that one's owner
 * out from under it, and the failures would have landed in the *other* file.
 */
const OWNER = "00000000-0000-4000-8000-000000005e11" as OwnerId;

/** `data/_test-reader-parity.json`, for the same reason routes.test.ts has one. */
const FILE = path.resolve(import.meta.dirname, "..", "data", "_test-reader-parity.json");

/**
 * Run `body` with whatever the store under test needs around it.
 *
 * The filesystem store reads `SPIDERYARN_READER_FILE` at call time; the
 * Postgres one reads `currentOwnerId()`, which is why its half runs inside a
 * request scope. Wrapping both here is what lets every case below be written
 * once and mean the same thing twice — the point of a parity suite.
 */
function on(store: ReaderStore, body: () => Promise<void>): Promise<void> {
  if (store !== pgReaderStore) {
    process.env.SPIDERYARN_READER_FILE = FILE;
    return body().finally(() => {
      delete process.env.SPIDERYARN_READER_FILE;
    });
  }
  return runInRequest(async () => {
    setRequestOwner(OWNER);
    await body();
  });
}

/**
 * The `auth.users` row this suite's owner needs.
 *
 * `on conflict do nothing`, so a re-run after a crashed one is fine. The columns
 * are the shared helper's: four of Supabase's have no default and GoTrue reads
 * them as non-null strings, so a row that leaves them out makes the Auth
 * service 500 for the whole database — tests/helpers/seed-auth-user.ts.
 */
async function seedOwner(): Promise<void> {
  await seedAuthUser(getDb(), {
    id: OWNER,
    email: "reader-parity@example.invalid",
    onConflictDoNothing: true,
  });
}

afterAll(async () => {
  await rm(FILE, { force: true });
  if (!pgReachable) return;
  const db = getDb();
  await db.delete(readerProfiles).where(eq(readerProfiles.ownerId, OWNER));
  await db.execute(sql`delete from auth.users where id = ${OWNER}`);
  await closeDb();
});

const stores: [string, ReaderStore, boolean][] = [
  ["the filesystem store", fsReaderStore, true],
  ["Postgres", pgReaderStore, pgReachable],
];

for (const [name, store, available] of stores) {
  describe.skipIf(!available)(name, () => {
    beforeAll(async () => {
      if (store === pgReaderStore) await seedOwner();
    });

    /* Every case starts from off and unwritten, so none of them depends on the
       order the others ran in — and so a failure names the case that failed
       rather than the one before it. */
    beforeEach(async () => {
      await on(store, async () => {
        await store.writeExperimental(false);
        await store.writeProfile(null);
      });
    });

    it("is off until it is switched on", async () => {
      await on(store, async () => {
        expect(await store.readExperimental()).toBeNull();
      });
    });

    it("answers with a real date once it is on", async () => {
      await on(store, async () => {
        const since = await store.writeExperimental(true);
        expect(since).toBeTypeOf("string");
        expect(Number.isNaN(Date.parse(since as string))).toBe(false);
        expect(await store.readExperimental()).toBe(since);
      });
    });

    it("keeps the first date when it is switched on again", async () => {
      await on(store, async () => {
        const first = await store.writeExperimental(true);
        /* A real gap, so a re-stamp would be *visible*: two `now()`s inside the
           same millisecond compare equal, and this would pass against an
           implementation that restamps every time. */
        await new Promise((r) => setTimeout(r, 20));
        expect(await store.writeExperimental(true)).toBe(first);
        expect(await store.readExperimental()).toBe(first);
      });
    });

    it("clears it, and a later on is honestly a new date", async () => {
      await on(store, async () => {
        const first = await store.writeExperimental(true);
        expect(await store.writeExperimental(false)).toBeNull();
        await new Promise((r) => setTimeout(r, 20));
        expect(await store.writeExperimental(true)).not.toBe(first);
      });
    });

    it("keeps both when the two writes are started at once", async () => {
      /* **The concurrent version of the case above**, which is the one that
         tells you *where* the safety comes from. On the filesystem it is the
         write queue, and a read taken outside it would let each write build its
         merge from the same "before" and the second one win with a stale copy of
         the first's field. In Postgres each statement names one column. Neither
         mechanism is visible in a sequential test. GPT Sol, 2026-08-31. */
      await on(store, async () => {
        const [, since] = await Promise.all([
          store.writeProfile("A physicist."),
          store.writeExperimental(true),
        ]);
        expect(await store.readProfile()).toBe("A physicist.");
        expect(await store.readExperimental()).toBe(since);
      });
    });

    it("leaves the profile alone when the switch changes, and the other way round", async () => {
      await on(store, async () => {
        await store.writeProfile("A physicist.");
        const since = await store.writeExperimental(true);
        expect(await store.readProfile()).toBe("A physicist.");

        await store.writeProfile("A physicist, still.");
        expect(await store.readExperimental()).toBe(since);
      });
    });
  });
}
